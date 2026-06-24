import { Worker, Job } from 'bullmq';
import { Redis } from 'ioredis';
import { eq, desc, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { auctions, bids } from '../db/schema.js';
import { notificationQueue, getQueueConnection } from '../queues/index.js';
import type { ExpireAuctionJob, AuctionWonJob } from '../queues/index.js';
import { publishAuctionEvent } from '../lib/pubsub.js';
import { logger } from '../lib/logger.js';
import { env } from '../config/env.js';

export function createAuctionWorker() {
  const connection = getQueueConnection();
  const publisher = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableOfflineQueue: false,
    lazyConnect: true,
  },);

  const worker = new Worker<ExpireAuctionJob>('auction-jobs', async (job: Job<ExpireAuctionJob>) => {
    const { auctionId } = job.data;
    logger.info({ auctionId, jobId: job.id }, 'Processing auction expiry');

    const [ended] = await db.update(auctions)
      .set({ status: 'ended', updatedAt: new Date() })
      .where(and(eq(auctions.id, auctionId), eq(auctions.status, 'active')))
      .returning();

    if (!ended) {
      logger.info({ auctionId }, 'Auction already ended — skipping');
      return { skipped: true };
    }

    const [winningBid] = await db.select().from(bids)
      .where(eq(bids.auctionId, auctionId))
      .orderBy(desc(bids.amount)).limit(1);

    if (winningBid) {
      await db.update(bids).set({ status: 'won' }).where(eq(bids.id, winningBid.id));
      await notificationQueue.add('auction-won', {
        userId: winningBid.bidderId, auctionId, auctionTitle: ended.title, finalAmount: winningBid.amount,
      } satisfies AuctionWonJob);
    }

    await publishAuctionEvent(publisher, {
      type: 'auction_ended', auctionId,
      winnerId: winningBid?.bidderId ?? null,
      finalPrice: winningBid?.amount ?? ended.currentPrice,
    });

    logger.info({ auctionId, winnerId: winningBid?.bidderId ?? null }, 'Auction expired and ended');
    return { winnerId: winningBid?.bidderId ?? null };
  }, { connection, concurrency: 5, drainDelay: 5000 });

  worker.on('completed', (job) => logger.info({ jobId: job.id }, 'Auction expiry completed'));
  worker.on('failed', (job, err) => logger.error({ jobId: job?.id, err }, 'Auction expiry failed'));
  return worker;
}
