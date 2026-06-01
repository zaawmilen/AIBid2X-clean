import Redis from 'ioredis';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

export const redis = new (Redis as any)(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableOfflineQueue: false,
  lazyConnect: true,
  retryStrategy(times: number) {
    const delay = Math.min(times * 100, 2000);
    logger.warn(`Redis connection lost. Attempting to reconnect (#${times}) in ${delay}ms...`);
    return delay;
  }
});

redis.on('connect', () => logger.info('Redis connected'));
redis.on('ready', () => logger.debug('Redis ready'));
redis.on('error', (err: Error) => logger.error({ err }, 'Redis error'));
redis.on('close', () => logger.warn('Redis connection closed'));
redis.on('reconnecting', () => logger.warn('Redis reconnecting'));

export async function checkRedisConnection(): Promise<void> {
  const pong = await redis.ping();
  if (pong !== 'PONG') throw new Error(`Unexpected Redis ping response: ${pong}`);
}

export async function closeRedis(): Promise<void> {
  await redis.quit();
  logger.info('Redis connection closed');
}
