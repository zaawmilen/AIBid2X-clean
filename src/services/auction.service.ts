import { eq, desc, and, count, sql, lt, or } from 'drizzle-orm';
import { db } from '../db/index.js';
import { auctions, bids } from '../db/schema.js';
import { AppError } from '../lib/errors.js';
import { auctionQueue, embeddingQueue } from '../queues/index.js';
import type { CreateAuctionInput, ListAuctionsQuery } from '../validators/auction.js';
import { logger } from '../lib/logger.js';

// ── Cursor helpers ─────────────────────────────────────────────────────────────
// Cursor format: base64("<endTime ISO>:<uuid>")
// Two fields because endTime alone is not unique — ties are broken by id.
// Using endTime + id means the cursor is stable even if rows are updated.

function encodeCursor(endTime: Date | null, id: string): string {
  const ts = endTime ? endTime.toISOString() : 'null';
  return Buffer.from(`${ts}:${id}`).toString('base64url');
}

function decodeCursor(cursor: string): { endTime: Date | null; id: string } | null {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const colonIdx = decoded.lastIndexOf(':');          // uuid contains no colon
    if (colonIdx === -1) return null;
    const ts  = decoded.slice(0, colonIdx);
    const id  = decoded.slice(colonIdx + 1);
    if (!id) return null;
    return { endTime: ts === 'null' ? null : new Date(ts), id };
  } catch {
    return null;
  }
}

// ── Helper: fire-and-forget queue job with timeout protection ──────────────────
async function safeQueueAdd(
  queueName: string,
  fn: () => Promise<unknown>,
  timeoutMs = 3000,
): Promise<void> {
  try {
    await Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Queue ${queueName} timed out after ${timeoutMs}ms`)),
          timeoutMs,
        ),
      ),
    ]);
  } catch (err) {
    logger.warn({ err, queueName }, 'Queue job failed — continuing without it');
  }
}

// ── Create Auction ─────────────────────────────────────────────────────────────

export async function createAuction(sellerId: string, input: CreateAuctionInput) {
  const startingPriceStr = input.startingPrice.toFixed(2);

  const [auction] = await db.insert(auctions).values({
    title:         input.title,
    description:   input.description ?? null,
    sellerId,
    startingPrice: startingPriceStr,
    reservePrice:  input.reservePrice?.toFixed(2) ?? null,
    currentPrice:  startingPriceStr,
    status:        'draft',
    endTime:       new Date(input.endTime),
  }).returning();

  if (!auction) throw AppError.internal('Failed to create auction');

  const embeddingText = [auction.title, auction.description].filter(Boolean).join(' ');
  safeQueueAdd('embeddingQueue', () =>
    embeddingQueue.add('generate-embedding', { auctionId: auction.id, text: embeddingText }),
  );

  logger.info({ auctionId: auction.id, sellerId }, 'Auction created');
  return auction;
}

// ── Activate Auction ───────────────────────────────────────────────────────────

export async function activateAuction(auctionId: string, sellerId: string) {
  const auction = await db.query.auctions.findFirst({
    where: eq(auctions.id, auctionId),
  });

  if (!auction) throw AppError.notFound('Auction');
  if (auction.sellerId !== sellerId) throw AppError.forbidden('You do not own this auction');
  if (auction.status !== 'draft')
    throw AppError.conflict(
      `Cannot activate from status: ${auction.status}`,
      'INVALID_STATUS_TRANSITION',
    );
  if (!auction.endTime || auction.endTime <= new Date())
    throw AppError.badRequest('endTime must be in the future', 'INVALID_END_TIME');

  const [updated] = await db.update(auctions)
    .set({ status: 'active', startTime: new Date(), updatedAt: new Date() })
    .where(eq(auctions.id, auctionId))
    .returning();

  if (!updated) throw AppError.internal('Failed to activate auction');

  const delay = auction.endTime.getTime() - Date.now();
  safeQueueAdd('auctionQueue', () =>
    auctionQueue.add('expire-auction', { auctionId }, {
      delay:             Math.max(0, delay),
      jobId:             `expire-${auctionId}`,
      removeOnComplete:  { count: 100 },
      removeOnFail:      { count: 50 },
    }),
  );

  logger.info({ auctionId, sellerId }, 'Auction activated');
  return updated;
}

// ── List Auctions ──────────────────────────────────────────────────────────────

export async function listAuctions(query: ListAuctionsQuery) {
  const { status = 'active', cursor, limit, page } = query;

  // ── Cursor path (keyset pagination) ─────────────────────────────────────
  if (cursor) {
    const decoded = decodeCursor(cursor);
    if (!decoded) throw AppError.badRequest('Invalid pagination cursor', 'INVALID_CURSOR');

    // Keyset condition: rows that come AFTER the cursor position in
    // (endTime DESC, id ASC) order.
    //
    // "After" in descending endTime means:
    //   endTime < cursor.endTime                          (earlier endTime)
    //   OR (endTime = cursor.endTime AND id > cursor.id)  (same endTime, next id)
    //
    // We fetch limit+1 to detect whether a next page exists without a
    // separate COUNT query — much cheaper at scale.
    const cursorEndTime = decoded.endTime?.toISOString() ?? null;

    const rows = await db.execute(sql`
      SELECT
        a.id, a.title, a.description, a.status,
        a.current_price, a.starting_price, a.end_time,
        a.created_at, a.updated_at,
        json_build_object('id', u.id, 'email', u.email) AS seller
      FROM auctions a
      JOIN users u ON u.id = a.seller_id
      WHERE a.status = ${status}
        AND (
          a.end_time < ${cursorEndTime}::timestamptz
          OR (a.end_time = ${cursorEndTime}::timestamptz AND a.id > ${decoded.id}::uuid)
        )
      ORDER BY a.end_time DESC, a.id ASC
      LIMIT ${limit + 1}
    `);

    const items = rows.rows as any[];
    const hasMore = items.length > limit;
    const page_items = hasMore ? items.slice(0, limit) : items;
    const last = page_items[page_items.length - 1];

    return {
      auctions:   page_items,
      pagination: {
        limit,
        hasMore,
        // nextCursor is only present when there are more results
        ...(hasMore && last
          ? { nextCursor: encodeCursor(new Date(last.end_time), last.id) }
          : {}),
      },
    };
  }

  // ── Offset path (backward compat) ────────────────────────────────────────
  const offset = (page - 1) * limit;

  const [rows, totalRows] = await Promise.all([
    db.query.auctions.findMany({
      where:   eq(auctions.status, status),
      orderBy: [desc(auctions.endTime)],
      limit, offset,
      columns: {
        id:           true,
        title:        true,
        description:  true,
        status:       true,
        sellerId:     true,
        startingPrice: true,
        currentPrice: true,
        startTime:    true,
        endTime:      true,
        createdAt:    true,
        updatedAt:    true,
        // embedding and reservePrice intentionally excluded
      },
      with: { seller: { columns: { id: true, email: true } } },
    }),
    db.select({ total: count() }).from(auctions).where(eq(auctions.status, status)),
  ]);

  const total = Number(totalRows?.[0]?.total ?? 0);
  const lastRow = rows[rows.length - 1];
  const hasMore = rows.length === limit && offset + limit < total;
  return {
    auctions: rows,
    pagination: {
      page, limit, total,
      pages:   Math.ceil(total / limit),
      hasMore,
      ...(hasMore && lastRow
        ? { nextCursor: encodeCursor(lastRow.endTime, lastRow.id) }
        : {}),
    },
  };
}

// ── Get Auction By ID ──────────────────────────────────────────────────────────

export async function getAuctionById(auctionId: string) {
  const auction = await db.query.auctions.findFirst({
    where: eq(auctions.id, auctionId),
    with:  { seller: { columns: { id: true, email: true } } },
  });

  if (!auction) throw AppError.notFound('Auction');

  const [bidStats] = await db
    .select({ bidCount: count(), highestBid: sql<string>`MAX(${bids.amount})` })
    .from(bids)
    .where(and(eq(bids.auctionId, auctionId)));

  return {
    ...auction,
    embedding:    undefined,
    reservePrice: undefined,
    bidCount:     Number(bidStats?.bidCount ?? 0),
    highestBid:   bidStats?.highestBid ?? null,
  };
}

// ── Get Auction Bids ───────────────────────────────────────────────────────────

export async function getAuctionBids(auctionId: string) {
  const auction = await db.query.auctions.findFirst({
    where:   eq(auctions.id, auctionId),
    columns: { id: true },
  });

  if (!auction) throw AppError.notFound('Auction');

  return db.query.bids.findMany({
    where:   eq(bids.auctionId, auctionId),
    orderBy: [desc(bids.createdAt)],
    with:    { bidder: { columns: { id: true, email: true } } },
  });
}