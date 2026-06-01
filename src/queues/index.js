import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../config/env.js';

export const connection = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  tls: env.REDIS_URL.startsWith('rediss://') ? {} : undefined,
});

const defaultJobOptions = {
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 50 },
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 },
};

export const auctionQueue = new Queue('auction-jobs', {
  connection,
  defaultJobOptions,
});

export const notificationQueue = new Queue('notifications', {
  connection,
  defaultJobOptions,
});

export const embeddingQueue = new Queue('embeddings', {
  connection,
  defaultJobOptions,
});