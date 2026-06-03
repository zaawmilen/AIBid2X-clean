import { Queue } from 'bullmq';
import { env } from '../config/env.js';

export function getQueueConnection() {
  const url = new URL(env.REDIS_URL);
  const isTLS = env.REDIS_URL.startsWith('rediss://');
  return {
    host: url.hostname,
    port: parseInt(url.port) || 6379,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    username: url.username ? decodeURIComponent(url.username) : undefined,
    maxRetriesPerRequest: null,
    enableOfflineQueue: true,
    retryStrategy: (times: number) => Math.min(times * 100, 3000),
    ...(isTLS && { tls: {} }),
  };
}

const connection = getQueueConnection();
const defaultJobOptions = {
  removeOnComplete: { count: 100 }, removeOnFail: { count: 50 },
  attempts: 3, backoff: { type: 'exponential' as const, delay: 2_000 },
};

export const auctionQueue      = new Queue('auction-jobs',  { connection, defaultJobOptions });
export const notificationQueue = new Queue('notifications', { connection, defaultJobOptions });
export const embeddingQueue    = new Queue('embeddings',    { connection, defaultJobOptions });

export interface ExpireAuctionJob { auctionId: string; _correlationId?: string; }
export interface OutbidNotificationJob { userId: string; auctionId: string; auctionTitle: string; newAmount: string; previousBidderEmail: string; _correlationId?: string; }
export interface AuctionWonJob { userId: string; auctionId: string; auctionTitle: string; finalAmount: string; _correlationId?: string; }
export interface GenerateEmbeddingJob { auctionId: string; text: string; _correlationId?: string; }
