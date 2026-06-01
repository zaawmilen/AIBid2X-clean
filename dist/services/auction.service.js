import { eq, desc, and, count, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { auctions, bids } from '../db/schema.js';
import { AppError } from '../lib/errors.js';
import { auctionQueue, embeddingQueue } from '../queues/index.js';
import { logger } from '../lib/logger.js';
export async function createAuction(sellerId, input) {
    console.log('1. Starting createAuction');
    const startingPriceStr = input.startingPrice.toFixed(2);
    const [auction] = await db.insert(auctions).values({
        title: input.title,
        description: input.description ?? null,
        sellerId,
        startingPrice: startingPriceStr,
        reservePrice: input.reservePrice?.toFixed(2) ?? null,
        currentPrice: startingPriceStr,
        status: 'draft',
        endTime: new Date(input.endTime),
    }).returning();
    console.log('2. Database insert complete');
    if (!auction)
        throw AppError.internal('Failed to create auction');
    const embeddingText = [auction.title, auction.description].filter(Boolean).join(' ');
    console.log('3. Adding to embedding queue');
    try {
        embeddingQueue.add('generate-embedding', { auctionId: auction.id, text: embeddingText });
        console.log('4. Auction created successfully');
    }
    catch (error) {
        logger.error('Failed to add embedding job:');
    }
    return auction;
}
export async function activateAuction(auctionId, sellerId) {
    const auction = await db.query.auctions.findFirst({ where: eq(auctions.id, auctionId) });
    if (!auction)
        throw AppError.notFound('Auction');
    if (auction.sellerId !== sellerId)
        throw AppError.forbidden('You do not own this auction');
    if (auction.status !== 'draft')
        throw AppError.conflict(`Cannot activate from status: ${auction.status}`, 'INVALID_STATUS_TRANSITION');
    if (!auction.endTime || auction.endTime <= new Date())
        throw AppError.badRequest('endTime must be in the future', 'INVALID_END_TIME');
    const [updated] = await db.update(auctions)
        .set({ status: 'active', startTime: new Date(), updatedAt: new Date() })
        .where(eq(auctions.id, auctionId)).returning();
    const delay = auction.endTime.getTime() - Date.now();
    await auctionQueue.add('expire-auction', { auctionId }, {
        delay: Math.max(0, delay),
        jobId: `expire-${auctionId}`,
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
    });
    return updated;
}
export async function listAuctions(query) {
    const { status = 'active', page, limit } = query;
    const offset = (page - 1) * limit;
    const [rows, totalRows] = await Promise.all([
        db.query.auctions.findMany({
            where: eq(auctions.status, status),
            orderBy: [desc(auctions.endTime)],
            limit, offset,
            with: { seller: { columns: { id: true, email: true } } },
        }),
        db.select({ total: count() }).from(auctions).where(eq(auctions.status, status)),
    ]);
    const total = Number(totalRows?.[0]?.total ?? 0);
    return { auctions: rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}
export async function getAuctionById(auctionId) {
    const auction = await db.query.auctions.findFirst({
        where: eq(auctions.id, auctionId),
        with: { seller: { columns: { id: true, email: true } } },
    });
    if (!auction)
        throw AppError.notFound('Auction');
    const [bidStats] = await db.select({ bidCount: count(), highestBid: sql `MAX(${bids.amount})` })
        .from(bids).where(and(eq(bids.auctionId, auctionId)));
    const bidCount = Number(bidStats?.bidCount ?? 0);
    return { ...auction, bidCount, highestBid: bidStats?.highestBid ?? null };
}
export async function getAuctionBids(auctionId) {
    const auction = await db.query.auctions.findFirst({ where: eq(auctions.id, auctionId), columns: { id: true } });
    if (!auction)
        throw AppError.notFound('Auction');
    return db.query.bids.findMany({
        where: eq(bids.auctionId, auctionId),
        orderBy: [desc(bids.createdAt)],
        with: { bidder: { columns: { id: true, email: true } } },
    });
}
//# sourceMappingURL=auction.service.js.map