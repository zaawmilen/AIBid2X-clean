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
// ── APPEND to the bottom of src/lib/redis.ts ─────────────────────────────────

export async function safeRedisGet(key: string): Promise<string | null> {
  try {
    return await redis.get(key);
  } catch (err) {
    logger.warn({ err, key }, 'Redis GET failed — cache miss');
    return null;
  }
}

export async function safeRedisSet(key: string, value: string, ttlSeconds?: number): Promise<void> {
  try {
    if (ttlSeconds !== undefined) {
      await redis.set(key, value, 'EX', ttlSeconds);
    } else {
      await redis.set(key, value);
    }
  } catch (err) {
    logger.warn({ err, key }, 'Redis SET failed — skipping cache write');
  }
}
