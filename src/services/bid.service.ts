import { eq, and, sql, desc, count } from 'drizzle-orm';
import { Decimal } from 'decimal.js';
import { db } from '../db/index.js';
import { auctions, bids, users } from '../db/schema.js';
import { AppError } from '../lib/errors.js';
import { broadcastToAuction } from '../lib/websocket.js';
import { notificationQueue } from '../queues/index.js';
import type { OutbidNotificationJob } from '../queues/index.js';
import { logger } from '../lib/logger.js';
import { writeBidAudit } from '../lib/bidAudit.js';
import type { BidOutcome } from '../lib/bidAudit.js';

interface AuctionRow {
  id: string; seller_id: string; status: string;
  current_price: string; reserve_price: string | null;
  end_time: Date | null; title: string;
}

interface BidRow {
  id: string; auction_id: string; bidder_id: string;
  amount: string; status: string; created_at: Date;
}

export async function placeBid(
  auctionId: string,
  bidderId: string,
  amount: number,
  correlationId?: string,
  idempotencyKey?: string,
  client = db,
) {
  const bidAmount = new Decimal(amount.toFixed(2));

  // ── Input validation ───────────────────────────────────────────────────
  if (amount <= 0 || !Number.isFinite(amount)) {
    await writeBidAudit({
      auctionId, bidderId,
      amount: '0.00',
      outcome: 'rejected_invalid_amount',
      rejectionReason: 'Non-positive or non-finite amount',
      correlationId,
    });
    throw AppError.badRequest('Invalid bid amount', 'INVALID_AMOUNT');
  }

  if (idempotencyKey !== undefined) {
    if (typeof idempotencyKey !== 'string' || idempotencyKey.trim() === '') {
      throw AppError.badRequest('Invalid idempotency key', 'INVALID_IDEMPOTENCY_KEY');
    }
    if (idempotencyKey.length > 255) {
      throw AppError.badRequest('Idempotency key too long', 'INVALID_IDEMPOTENCY_KEY');
    }
    if (/\s/.test(idempotencyKey)) {
      throw AppError.badRequest('Idempotency key contains invalid characters', 'INVALID_IDEMPOTENCY_KEY');
    }

    const requestPayload = { auctionId, bidderId, amount };
    const insertReq = await client.execute(sql`
      INSERT INTO bid_requests (id, idempotency_key, requester_id, auction_id, request_payload, status, created_at, updated_at)
      VALUES (gen_random_uuid(), ${idempotencyKey}, ${bidderId}, ${auctionId}, ${JSON.stringify(requestPayload)}::jsonb, 'pending', NOW(), NOW())
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING id, status
    `);

    if (insertReq.rows.length === 0) {
      const existing = await client.execute(sql`
        SELECT status FROM bid_requests WHERE idempotency_key = ${idempotencyKey}
      `);
      const row = existing.rows[0] as any | undefined;
      const status = row?.status;

      if (status === 'failed') {
        const reclaimed = await client.execute(sql`
          UPDATE bid_requests
          SET status = 'pending', request_payload = ${JSON.stringify(requestPayload)}::jsonb, updated_at = NOW()
          WHERE idempotency_key = ${idempotencyKey} AND status = 'failed'
          RETURNING id
        `);
        if (reclaimed.rows.length === 0) {
          throw AppError.conflict('Request already in progress', 'REQUEST_IN_PROGRESS');
        }
      } else {
        throw AppError.conflict('Request already in progress', 'REQUEST_IN_PROGRESS');
      }
    }
  }

  let result: any;
  try {
    result = await client.transaction(async (tx) => {

      // ── Step 1: Row-level lock ───────────────────────────────────────────
      logger.info({ auctionId, bidderId }, 'Starting transaction and acquiring row lock');
      const lockResult = await tx.execute(
        sql`SELECT id, seller_id, status, current_price, reserve_price, end_time, title
            FROM auctions WHERE id = ${auctionId} FOR UPDATE`,
      );
      const auction = lockResult.rows[0] as unknown as AuctionRow | undefined;

      // ── Step 2: Auction state validation ────────────────────────────────
      if (!auction) throw AppError.notFound('Auction');

      if (auction.status !== 'active') {
        throw AppError.badRequest(
          `Auction is not accepting bids (status: ${auction.status})`,
          'AUCTION_NOT_ACTIVE',
        );
      }

      if (auction.end_time && auction.end_time <= new Date()) {
        await tx.update(auctions).set({ status: 'ended', updatedAt: new Date() })
          .where(eq(auctions.id, auctionId));
        throw AppError.badRequest('Auction has ended', 'AUCTION_ENDED');
      }

      // ── Step 3: Business rule validation ────────────────────────────────
      if (auction.seller_id === bidderId) {
        throw AppError.badRequest('You cannot bid on your own auction', 'CANNOT_BID_OWN_AUCTION');
      }

      const lockedPrice = new Decimal(auction.current_price);
      if (bidAmount.lte(lockedPrice)) {
        throw AppError.badRequest(
          `Bid must exceed current price of ${lockedPrice.toFixed(2)}`, 'BID_TOO_LOW',
        );
      }

      // ── Step 3b: Idempotency / duplicate check ───────────────────────────
      const dupCheck = await tx.execute(sql`
        SELECT id, auction_id, bidder_id, amount, status, created_at
        FROM   bids
        WHERE  auction_id = ${auctionId}
          AND  bidder_id  = ${bidderId}
          AND  amount     = ${bidAmount.toFixed(2)}
          AND  status     = 'winning'
          AND  created_at > NOW() - INTERVAL '30 seconds'
        LIMIT 1
      `);

      if (dupCheck.rows.length > 0) {
        const existing = dupCheck.rows[0] as unknown as BidRow;
        logger.info({ auctionId, bidderId, correlationId }, 'Duplicate bid — returning existing (idempotent)');
        return {
          bid: {
            id: existing.id, auctionId: existing.auction_id, bidderId: existing.bidder_id,
            amount: existing.amount, status: existing.status as 'active', createdAt: existing.created_at,
          },
          outbidUserId: null, auctionTitle: auction.title, isDuplicate: true,
        };
      }

      // ── Step 4: Advisory lock — serialize bid finalization ───────────────
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${auctionId})::bigint)`);

      // ── Step 5: CAS gate ─────────────────────────────────────────────────
      const casResult = await tx.execute(sql`
        UPDATE auctions
        SET    current_price = ${bidAmount.toFixed(2)}, updated_at = NOW()
        WHERE  id = ${auctionId} AND status = 'active' AND current_price < ${bidAmount.toFixed(2)}
        RETURNING id, current_price AS new_price, title
      `);

      logger.info(
        { auctionId, bidderId, casRows: casResult.rows.length, bidAmount: bidAmount.toFixed(2) },
        'CAS result',
      );

      if (casResult.rows.length === 0) {
        const freshRead = await tx.execute(
          sql`SELECT current_price FROM auctions WHERE id = ${auctionId}`,
        );
        const freshPrice = new Decimal(
          (freshRead.rows[0] as any)?.current_price ?? lockedPrice.toFixed(2),
        );

        // Audit CAS rejection inside the transaction — rolls back if tx rolls back
        await writeBidAudit({
          auctionId, bidderId,
          amount: bidAmount.toFixed(2),
          outcome: 'rejected_cas_failed',
          rejectionReason: `CAS failed — current price is ${freshPrice.toFixed(2)}`,
          correlationId,
        }, tx);

        throw AppError.badRequest(
          `Bid must exceed current price of ${freshPrice.toFixed(2)}`, 'BID_TOO_LOW',
        );
      }

      // ── Step 6: Read current highest (informational) ─────────────────────
      const [currentHighest] = await tx
        .select({ id: bids.id, bidderId: bids.bidderId, amount: bids.amount })
        .from(bids)
        .where(and(eq(bids.auctionId, auctionId), sql`${bids.status} IN ('active', 'winning')`))
        .orderBy(desc(bids.amount))
        .limit(1);

      logger.info(
        { auctionId, currentHighest: currentHighest?.amount },
        'Current highest bid (pre-insert, best-effort)',
      );

      // ── Step 7: Mark existing candidate bids as outbid ──────────────────
      const preOutbid = await tx.execute(sql`
        UPDATE bids
        SET status = 'outbid'
        WHERE auction_id = ${auctionId}
          AND status IN ('active', 'winning')
        RETURNING id, bidder_id
      `);

      logger.info(
        { auctionId, preOutbidCount: preOutbid.rows.length },
        'Pre-insert outbid sweep completed',
      );

      // ── Step 8: Insert new winning bid ───────────────────────────────────
      let newBidRow: any | undefined;
      try {
        [newBidRow] = await tx.insert(bids)
          .values({ auctionId, bidderId, amount: bidAmount.toFixed(2), status: 'winning' })
          .returning();
      } catch (err: any) {
        if (err?.code === '23505') {
          logger.info(
            { auctionId, bidderId },
            'Unique violation on winning bid insert — sweeping others and retrying',
          );
          await tx.execute(sql`
            UPDATE bids SET status = 'outbid'
            WHERE auction_id = ${auctionId} AND status IN ('active', 'winning')
          `);
          [newBidRow] = await tx.insert(bids)
            .values({ auctionId, bidderId, amount: bidAmount.toFixed(2), status: 'winning' })
            .returning();
        } else {
          throw err;
        }
      }

      if (!newBidRow) throw AppError.internal('Bid record creation failed');

      logger.info(
        { auctionId, bidderId, bidId: newBidRow.id, amount: bidAmount.toFixed(2), correlationId },
        'Inserted new winning bid',
      );

      // ── Step 9: Post-insert cleanup sweep ────────────────────────────────
      try {
        await tx.execute(sql`
          UPDATE bids
          SET status = 'outbid'
          WHERE auction_id = ${auctionId}
            AND id != ${newBidRow.id}
            AND status IN ('active', 'winning')
        `);
      } catch (e) {
        logger.info({ auctionId, err: String(e) }, 'Post-insert outbid sweep failed');
      }

      // ── Step 10: Audit — accepted bid (inside tx, atomic with bid insert) ─
      await writeBidAudit({
        auctionId, bidderId,
        amount: bidAmount.toFixed(2),
        outcome: 'accepted',
        bidId: newBidRow.id,
        correlationId,
      }, tx);

      return {
        bid: newBidRow,
        outbidUserId: currentHighest?.bidderId ?? null,
        auctionTitle: auction.title,
        isDuplicate: false,
      };
    });

  } catch (err: any) {
    // ── Idempotency: persist failed state ──────────────────────────────────
    if (idempotencyKey) {
      try {
        await client.execute(sql`
          UPDATE bid_requests
          SET status = 'failed',
              response_payload = ${JSON.stringify({ error: String(err?.message ?? err) })}::jsonb,
              updated_at = NOW()
          WHERE idempotency_key = ${idempotencyKey}
        `);
      } catch (e) {
        logger.error({ err: e, idempotencyKey }, 'Failed to persist idempotency failed state');
      }
    }

    // ── Audit: rejection / error — outside tx, always persisted ───────────
    // Map AppError codes to structured outcomes. Everything else is internal.
    const outcome: BidOutcome = err instanceof AppError
      ? (err.code === 'BID_TOO_LOW'              ? 'rejected_too_low'
       : err.code === 'AUCTION_ENDED'            ? 'rejected_ended'
       : err.code === 'AUCTION_NOT_ACTIVE'       ? 'rejected_not_active'
       : err.code === 'CANNOT_BID_OWN_AUCTION'   ? 'rejected_own_auction'
       : err.code === 'REQUEST_IN_PROGRESS'      ? 'rejected_duplicate'
       : 'error_internal')
      : 'error_internal';

    // Skip double-auditing outcomes already written inside the transaction
    // (CAS failures are written inside the tx and will have already rolled
    // back — we still need to write them here via the global client).
    await writeBidAudit({
      auctionId, bidderId,
      amount: bidAmount.toFixed(2),
      outcome,
      rejectionReason: err?.message,
      correlationId,
    }); // global db — no tx client, always persisted

    throw err;
  }

  // ── Post-commit side effects ───────────────────────────────────────────
  // Only reached after successful commit. Rolled-back transactions never
  // reach here. Duplicates skip — events already fired on original request.
  if (!result.isDuplicate) {
    broadcastToAuction(auctionId, {
      type: 'bid_placed', auctionId, bidId: result.bid.id,
      amount: result.bid.amount, bidderId, currentPrice: result.bid.amount,
      timestamp: result.bid.createdAt.toISOString(),
    });

    if (result.outbidUserId && result.outbidUserId !== bidderId) {
      const [outbidUser] = await client
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, result.outbidUserId));

      if (outbidUser) {
        await notificationQueue.add('outbid', {
          userId: result.outbidUserId, auctionId, auctionTitle: result.auctionTitle,
          newAmount: result.bid.amount, previousBidderEmail: outbidUser.email,
          _correlationId: correlationId ?? '',
        } satisfies OutbidNotificationJob);
      }
    }
  }

  // ── Idempotency: persist completed response ────────────────────────────
  if (idempotencyKey) {
    try {
      await client.execute(sql`
        UPDATE bid_requests
        SET status = 'completed',
            response_payload = ${JSON.stringify({ bid: result.bid, auctionTitle: result.auctionTitle })}::jsonb,
            updated_at = NOW()
        WHERE idempotency_key = ${idempotencyKey}
      `);
    } catch (e) {
      logger.error({ err: e, idempotencyKey }, 'Failed to persist idempotency response');
    }
  }

  // ── Debug: log bid rows in test environment ────────────────────────────
  try {
    if (process.env.NODE_ENV === 'test') {
      const rows = await (client as any).select().from(bids).where(eq(bids.auctionId, auctionId));
      logger.info(
        { auctionId, bids: rows.map((r: any) => ({ id: r.id, amount: r.amount, status: r.status })) },
        'Post-commit bid rows for auction',
      );
    }
  } catch (e) {
    logger.error({ err: e, auctionId }, 'Failed to read bids for debug');
  }

  return result.bid;
}
// ── Get My Bids ───────────────────────────────────────────────────────────────

interface GetMyBidsOptions {
  page: number;
  limit: number;
  status?: string;
}

export async function getMyBids(bidderId: string, { page, limit, status }: GetMyBidsOptions) {
  const offset = (page - 1) * limit;

  const validStatuses = ['active', 'outbid', 'winning', 'won', 'invalid'] as const;
  type BidStatus = typeof validStatuses[number];

  const statusFilter =
    status && validStatuses.includes(status as BidStatus)
      ? eq(bids.status, status as BidStatus)
      : undefined;

  const whereClause = statusFilter
    ? and(eq(bids.bidderId, bidderId), statusFilter)
    : eq(bids.bidderId, bidderId);

  const [rows, countResult] = await Promise.all([
    db.select({
        id:        bids.id,
        amount:    bids.amount,
        status:    bids.status,
        createdAt: bids.createdAt,
        auction: {
          id:           auctions.id,
          title:        auctions.title,
          status:       auctions.status,
          currentPrice: auctions.currentPrice,
          endTime:      auctions.endTime,
        },
      })
      .from(bids)
      .innerJoin(auctions, eq(bids.auctionId, auctions.id))
      .where(whereClause)
      .orderBy(desc(bids.createdAt))
      .limit(limit)
      .offset(offset),

    db.select({ total: count() }).from(bids).where(whereClause),
  ]);

  return {
    bids: rows,
    pagination: {
      page,
      limit,
      total: Number(countResult?.[0]?.total ?? 0),
      pages: Math.ceil(Number(countResult?.[0]?.total ?? 0) / limit),
    },
  };
}

// ── Get Bid By ID ─────────────────────────────────────────────────────────────

export async function getBidById(bidId: string, requesterId: string, requesterRole: string) {
  const [row] = await db
    .select({
      id:        bids.id,
      amount:    bids.amount,
      status:    bids.status,
      createdAt: bids.createdAt,
      bidderId:  bids.bidderId,
      auction: {
        id:           auctions.id,
        title:        auctions.title,
        status:       auctions.status,
        currentPrice: auctions.currentPrice,
        endTime:      auctions.endTime,
      },
    })
    .from(bids)
    .innerJoin(auctions, eq(bids.auctionId, auctions.id))
    .where(eq(bids.id, bidId))
    .limit(1);

  if (!row) throw AppError.notFound('Bid');

  if (requesterRole !== 'admin' && row.bidderId !== requesterId) {
    throw AppError.forbidden('You do not have access to this bid');
  }

  return row;
}
