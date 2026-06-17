import { eq, and, sql } from 'drizzle-orm';
import { Decimal } from 'decimal.js';
import { db } from '../db/index.js';
import { auctions, bids, users } from '../db/schema.js';
import { AppError } from '../lib/errors.js';
import { broadcastToAuction } from '../lib/websocket.js';
import { notificationQueue } from '../queues/index.js';
import { logger } from '../lib/logger.js';
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
            .values({ auctionId, bidderId, amount: bidAmount.toFixed(2), status: 'winning' })
            .returning();
        const [bid] = insertedBids;
        if (!bid)
            throw AppError.badRequest('Failed to place bid', 'BID_CREATION_FAILED');
        await tx.update(auctions).set({ currentPrice: bidAmount.toFixed(2), updatedAt: new Date() }).where(eq(auctions.id, auctionId));
        logger.info({ auctionId, bidderId, amount: bidAmount.toFixed(2) }, 'Bid placed');

        // Test-only debug: log bid rows for this auction so we can diagnose
        // intermittent failures where no bid is left in 'winning' state.
        try {
            if (process.env.NODE_ENV === 'test') {
                const rows = await tx.select().from(bids).where(eq(bids.auctionId, auctionId));
                logger.info({ auctionId, bids: rows.map(function (r) { return ({ id: r.id, amount: r.amount, status: r.status }); }) }, 'Post-insert bid rows (tx)');
            }
        } catch (e) {
            logger.error({ err: e, auctionId: auctionId }, 'Failed to read bids for debug');
        }
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
//# sourceMappingURL=bid.service.js.map