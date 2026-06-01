import { eq, and, sql, count, desc } from 'drizzle-orm';
import { Decimal } from 'decimal.js';
import { db } from '../db/index.js';
import { auctions, bids, users } from '../db/schema.js';
import { AppError } from '../lib/errors.js';
import { broadcastToAuction } from '../lib/websocket.js';
import { notificationQueue } from '../queues/index.js';
import { logger } from '../lib/logger.js';
// ── Place Bid ─────────────────────────────────────────────────────────────────
export async function placeBid(auctionId, bidderId, amount) {
    const bidAmount = new Decimal(amount.toFixed(2));
    const newBid = await db.transaction(async (tx) => {
        const result = await tx.execute(sql `SELECT id, seller_id, status, current_price, reserve_price, end_time, title
          FROM auctions WHERE id = ${auctionId} FOR UPDATE`);
        const auction = result.rows[0];
        if (!auction)
            throw AppError.notFound('Auction');
        if (auction.status !== 'active')
            throw AppError.badRequest(`Auction is not accepting bids (status: ${auction.status})`, 'AUCTION_NOT_ACTIVE');
        if (auction.end_time && auction.end_time <= new Date()) {
            await tx.update(auctions).set({ status: 'ended', updatedAt: new Date() }).where(eq(auctions.id, auctionId));
            throw AppError.badRequest('Auction has ended', 'AUCTION_ENDED');
        }
        if (auction.seller_id === bidderId)
            throw AppError.badRequest('You cannot bid on your own auction', 'CANNOT_BID_OWN_AUCTION');
        const currentPrice = new Decimal(auction.current_price);
        if (bidAmount.lte(currentPrice))
            throw AppError.badRequest(`Bid must exceed current price of ${currentPrice.toFixed(2)}`, 'BID_TOO_LOW');
        const [previousHighest] = await tx.select({ bidderId: bids.bidderId }).from(bids)
            .where(and(eq(bids.auctionId, auctionId), sql `${bids.status} IN ('active', 'winning')`)).limit(1);
        await tx.update(bids).set({ status: 'outbid' })
            .where(and(eq(bids.auctionId, auctionId), sql `${bids.status} IN ('active', 'winning')`));
        const insertedBids = await tx.insert(bids)
            .values({ auctionId, bidderId, amount: bidAmount.toFixed(2), status: 'active' })
            .returning();
        const [bid] = insertedBids;
        if (!bid)
            throw AppError.badRequest('Failed to place bid', 'BID_CREATION_FAILED');
        await tx.update(auctions).set({ currentPrice: bidAmount.toFixed(2), updatedAt: new Date() }).where(eq(auctions.id, auctionId));
        logger.info({ auctionId, bidderId, amount: bidAmount.toFixed(2) }, 'Bid placed');
        return { bid, previousHighestBidderId: previousHighest?.bidderId ?? null, auctionTitle: auction.title };
    });
    broadcastToAuction(auctionId, {
        type: 'bid_placed', auctionId, bidId: newBid.bid.id,
        amount: newBid.bid.amount, bidderId, currentPrice: newBid.bid.amount,
        timestamp: newBid.bid.createdAt.toISOString(),
    });
    if (newBid.previousHighestBidderId && newBid.previousHighestBidderId !== bidderId) {
        const [outbidUser] = await db.select({ email: users.email }).from(users).where(eq(users.id, newBid.previousHighestBidderId));
        if (outbidUser) {
            await notificationQueue.add('outbid', {
                userId: newBid.previousHighestBidderId, auctionId, auctionTitle: newBid.auctionTitle,
                newAmount: newBid.bid.amount, previousBidderEmail: outbidUser.email,
            });
        }
    }
    return newBid.bid;
}
export async function getMyBids(bidderId, { page, limit, status }) {
    const offset = (page - 1) * limit;
    // Build status filter — valid bid statuses: active | outbid | winning | won | invalid
    const validStatuses = ['active', 'outbid', 'winning', 'won', 'invalid'];
    const statusFilter = status && validStatuses.includes(status)
        ? eq(bids.status, status)
        : undefined;
    const whereClause = statusFilter
        ? and(eq(bids.bidderId, bidderId), statusFilter)
        : eq(bids.bidderId, bidderId);
    const [rows, totalRows] = await Promise.all([
        db
            .select({
            id: bids.id,
            amount: bids.amount,
            status: bids.status,
            createdAt: bids.createdAt,
            auction: {
                id: auctions.id,
                title: auctions.title,
                status: auctions.status,
                currentPrice: auctions.currentPrice,
                endTime: auctions.endTime,
            },
        })
            .from(bids)
            .innerJoin(auctions, eq(bids.auctionId, auctions.id))
            .where(whereClause)
            .orderBy(desc(bids.createdAt))
            .limit(limit)
            .offset(offset),
        db
            .select({ total: count() })
            .from(bids)
            .where(whereClause),
    ]);
    const total = Number(totalRows?.[0]?.total ?? 0);
    return {
        bids: rows,
        pagination: {
            page,
            limit,
            total,
            pages: Math.ceil(total / limit),
        },
    };
}
// ── Get Single Bid by ID ──────────────────────────────────────────────────────
export async function getBidById(bidId, requesterId, requesterRole) {
    const [row] = await db
        .select({
        id: bids.id,
        amount: bids.amount,
        status: bids.status,
        createdAt: bids.createdAt,
        bidderId: bids.bidderId,
        auction: {
            id: auctions.id,
            title: auctions.title,
            status: auctions.status,
            currentPrice: auctions.currentPrice,
            endTime: auctions.endTime,
        },
    })
        .from(bids)
        .innerJoin(auctions, eq(bids.auctionId, auctions.id))
        .where(eq(bids.id, bidId))
        .limit(1);
    if (!row)
        throw AppError.notFound('Bid');
    // Bidders can only view their own bids; admins can view any
    if (requesterRole !== 'admin' && row.bidderId !== requesterId) {
        throw AppError.forbidden('You do not have access to this bid');
    }
    return row;
}
//# sourceMappingURL=bid.service.js.map