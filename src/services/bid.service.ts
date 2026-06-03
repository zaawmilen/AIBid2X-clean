import { eq, and, sql, desc } from 'drizzle-orm';
import { Decimal } from 'decimal.js';
import { db } from '../db/index.js';
import { auctions, bids, users } from '../db/schema.js';
import { AppError } from '../lib/errors.js';
import { broadcastToAuction } from '../lib/websocket.js';
import { notificationQueue } from '../queues/index.js';
import type { OutbidNotificationJob } from '../queues/index.js';
import { logger } from '../lib/logger.js';


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
  // Use the provided `client` (defaults to the global `db`). Tests that need
  // transactional visibility should pass an explicit `client` argument.

  // Validate inputs
  if (amount <= 0 || !Number.isFinite(amount)) {
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

    // Claim the idempotency key by inserting a pending row. Do this outside
    // the bid-processing transaction so we can persist a failed state if
    // processing errors occur. If the key already exists and is not in a
    // 'failed' state we return 409 Conflict to indicate another worker is
    // handling or has completed the request.
    const requestPayload = { auctionId, bidderId, amount };
    const insertReq = await client.execute(sql`
      INSERT INTO bid_requests (id, idempotency_key, requester_id, auction_id, request_payload, status, created_at, updated_at)
      VALUES (gen_random_uuid(), ${idempotencyKey}, ${bidderId}, ${auctionId}, ${JSON.stringify(requestPayload)}::jsonb, 'pending', NOW(), NOW())
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING id, status
    `);

    if (insertReq.rows.length === 0) {
      // Key already exists. Inspect its status. If 'failed' try to reclaim
      // the key (allow retry). Otherwise return 409 Conflict.
      const existing = await client.execute(sql`SELECT status FROM bid_requests WHERE idempotency_key = ${idempotencyKey}`);
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

    // ── Step 1: Row-level lock ─────────────────────────────────────────────
    logger.info({ auctionId, bidderId }, 'Starting transaction and acquiring row lock');
    const lockResult = await tx.execute(
      sql`SELECT id, seller_id, status, current_price, reserve_price, end_time, title
          FROM auctions WHERE id = ${auctionId} FOR UPDATE`,
    );
    const auction = lockResult.rows[0] as unknown as AuctionRow | undefined;

    // ── Step 2: Auction state validation ──────────────────────────────────
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

    // ── Step 3: Business rule validation ──────────────────────────────────
    if (auction.seller_id === bidderId) {
      throw AppError.badRequest('You cannot bid on your own auction', 'CANNOT_BID_OWN_AUCTION');
    }

    const lockedPrice = new Decimal(auction.current_price);
    if (bidAmount.lte(lockedPrice)) {
      throw AppError.badRequest(
        `Bid must exceed current price of ${lockedPrice.toFixed(2)}`, 'BID_TOO_LOW',
      );
    }

    // ── Step 3b: Idempotency check ─────────────────────────────────────────
    // Guards against network retries / double-clicks submitting the same bid twice.
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
        bid: { id: existing.id, auctionId: existing.auction_id, bidderId: existing.bidder_id,
               amount: existing.amount, status: existing.status as 'active', createdAt: existing.created_at },
        outbidUserId: null, auctionTitle: auction.title, isDuplicate: true,
      };
    }

    // ── Step 4: Acquire per-auction advisory lock to serialize bid finalization
    // Acquire the advisory lock before the CAS so competing transactions
    // execute the price-claim and finalization serially. This reduces races
    // where multiple transactions could simultaneously pass the CAS.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${auctionId})::bigint)`);

    // ── Step 5: CAS gate — atomic conditional price update ─────────────────
    // Second gate covering pgBouncer transaction mode + multi-instance deploys.
    // WHERE current_price < bidAmount is evaluated atomically by Postgres.
    // Zero rows = a concurrent winner already claimed this price slot.
    const casResult = await tx.execute(sql`
      UPDATE auctions
      SET    current_price = ${bidAmount.toFixed(2)}, updated_at = NOW()
      WHERE  id = ${auctionId} AND status = 'active' AND current_price < ${bidAmount.toFixed(2)}
      RETURNING id, current_price AS new_price, title
    `);

    logger.info({ auctionId, bidderId, casRows: casResult.rows.length, bidAmount: bidAmount.toFixed(2) }, 'CAS result');

    if (casResult.rows.length === 0) {
      // Re-read actual current price for an accurate error message (not stale)
      const freshRead = await tx.execute(sql`SELECT current_price FROM auctions WHERE id = ${auctionId}`);
      const freshPrice = new Decimal((freshRead.rows[0] as any)?.current_price ?? lockedPrice.toFixed(2));
      throw AppError.badRequest(
        `Bid must exceed current price of ${freshPrice.toFixed(2)}`, 'BID_TOO_LOW',
      );
    }

    // (lock already acquired above)

    // ── Step 6: Identify current highest bid (best-effort, informative) ───
    // We still read the current highest for logging / notification purposes,
    // but do not rely on it for correctness. The definitive outbid cleanup
    // happens after we insert the new winning bid and updates all other
    // candidate rows atomically in the same transaction.
    const [currentHighest] = await tx
      .select({ id: bids.id, bidderId: bids.bidderId, amount: bids.amount })
      .from(bids)
      .where(and(eq(bids.auctionId, auctionId), sql`${bids.status} IN ('active', 'winning')`))
      .orderBy(desc(bids.amount))
      .limit(1);

    logger.info({ auctionId, currentHighest: currentHighest?.amount }, 'Current highest bid (pre-insert, best-effort)');

    // ── Step 7: Mark any existing candidate bids as 'outbid' before inserting
    // the new winning bid. Doing this before the insert ensures a clean
    // transition: after we insert the new `winning` row there should be no
    // other rows still marked as `winning`.
    const preOutbid = await tx.execute(sql`
      UPDATE bids
      SET status = 'outbid'
      WHERE auction_id = ${auctionId}
        AND status IN ('active', 'winning')
      RETURNING id, bidder_id
    `);

    logger.info({ auctionId, preOutbidCount: preOutbid.rows.length }, 'Pre-insert outbid sweep completed');

    // ── Step 7: Insert new winning bid. Try once; on unique-violation
    // sweep others to 'outbid' and retry the insert once.
    let newBidRow: any | undefined;
    try {
      [newBidRow] = await tx.insert(bids)
        .values({ auctionId, bidderId, amount: bidAmount.toFixed(2), status: 'winning' })
        .returning();
    } catch (err: any) {
      if (err?.code === '23505') {
        logger.info({ auctionId, bidderId }, 'Unique violation on winning bid insert — sweeping others and retrying');
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

    logger.info({ auctionId, bidderId, bidId: newBidRow.id, amount: bidAmount.toFixed(2), correlationId }, 'Inserted new winning bid');

    // (diagnostic reads removed)

    // ── Step 8: Post-insert cleanup — ensure no other rows remain 'winning'
    // This is a final defensive sweep inside the same transaction (lock held)
    // which marks any other candidate rows as 'outbid'. With the advisory
    // lock acquired earlier this should be a no-op in properly ordered flows,
    // but it's harmless and guarantees the invariant at commit time.
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

    return {
      bid: newBidRow,
      outbidUserId: currentHighest?.bidderId ?? null,
      auctionTitle: auction.title,
      isDuplicate: false,
    };
    });
  } catch (err: any) {
    if (idempotencyKey) {
      try {
        await client.execute(sql`
          UPDATE bid_requests
          SET status = 'failed', response_payload = ${JSON.stringify({ error: String(err?.message ?? err) })}::jsonb, updated_at = NOW()
          WHERE idempotency_key = ${idempotencyKey}
        `);
      } catch (e) {
        logger.error({ err: e, idempotencyKey }, 'Failed to persist idempotency failed state');
      }
    }
    throw err;
  }

  // ── Post-commit side effects ───────────────────────────────────────────
  // Only after successful commit. Duplicates skip — already fired on original.
  // Rolled-back transactions never reach here — no phantom events.

  if (!result.isDuplicate) {
    broadcastToAuction(auctionId, {
      type: 'bid_placed', auctionId, bidId: result.bid.id,
      amount: result.bid.amount, bidderId, currentPrice: result.bid.amount,
      timestamp: result.bid.createdAt.toISOString(),
    });

    if (result.outbidUserId && result.outbidUserId !== bidderId) {
      const [outbidUser] = await client.select({ email: users.email }).from(users)
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

  // Persist idempotency response for subsequent retries if a key was used.
  if (idempotencyKey) {
    try {
      await client.execute(sql`
        UPDATE bid_requests
        SET status = 'completed', response_payload = ${JSON.stringify({ bid: result.bid, auctionTitle: result.auctionTitle })}::jsonb, updated_at = NOW()
        WHERE idempotency_key = ${idempotencyKey}
      `);
    } catch (e) {
      logger.error({ err: e, idempotencyKey }, 'Failed to persist idempotency response');
    }
  }

  return result.bid;
}
