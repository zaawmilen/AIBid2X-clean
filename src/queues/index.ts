import { Queue } from 'bullmq';
import { env } from '../config/env.js';

export function getQueueConnection() {
  const url = new URL(env.REDIS_URL);
  return {
    host: url.hostname,
    port: parseInt(url.port) || 6379,
    password: url.password ? decodeURIComponent(url.password) : undefined,
  };
}

const connection = getQueueConnection();
const defaultJobOptions = {
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 50 },
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 2_000 },
};

export const auctionQueue = new Queue('auction-jobs', { connection, defaultJobOptions });
export const notificationQueue = new Queue('notifications', { connection, defaultJobOptions });
export const embeddingQueue = new Queue('embeddings', { connection, defaultJobOptions });

export interface ExpireAuctionJob { auctionId: string; }
export interface OutbidNotificationJob { userId: string; auctionId: string; auctionTitle: string; newAmount: string; previousBidderEmail: string; }
export interface AuctionWonJob { userId: string; auctionId: string; auctionTitle: string; finalAmount: string; }
export interface GenerateEmbeddingJob { auctionId: string; text: string; }
