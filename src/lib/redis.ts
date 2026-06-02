import Redis from 'ioredis';
import type { Redis as RedisClient } from 'ioredis';
import { env } from '../config/env.js';
import { logger } from './logger.js';

const isTLS = env.REDIS_URL.startsWith('rediss://');

// `ioredis`'s module type can sometimes not expose a construct signature to TS.
// Cast to a constructor type to satisfy the compiler while keeping runtime behavior.
export const redis = new (Redis as unknown as new (url: string, opts?: any) => RedisClient)(
  env.REDIS_URL,
  {
  maxRetriesPerRequest: 3,
  // true = queue commands while reconnecting instead of failing them immediately.
  // Upstash closes idle connections — we need to tolerate brief disconnects.
  enableOfflineQueue: true,
  lazyConnect: true,
  // Retry with exponential backoff, capped at 2s
  retryStrategy(times: number) {
    if (times > 10) return null; // give up after 10 attempts
    return Math.min(times * 100, 2000);
  },
  reconnectOnError(err: Error) {
    // Reconnect on ECONNRESET and ETIMEDOUT — common with Upstash idle timeouts
    return err.message.includes('ECONNRESET') || err.message.includes('ETIMEDOUT');
  },
  ...(isTLS && { tls: {} }),
});

redis.on('connect',     () => logger.info('Redis connected'));
redis.on('ready',       () => logger.debug('Redis ready'));
redis.on('error', (err: unknown) => {
  // err may not be a JS Error with a `code` property; guard access to avoid TS error
  const code = (err as any)?.code as string | undefined;
  if (code !== 'ECONNRESET') logger.error({ err }, 'Redis error');
});
redis.on('close',       () => logger.warn('Redis connection closed'));
redis.on('reconnecting',() => logger.warn('Redis reconnecting'));

export async function checkRedisConnection(): Promise<void> {
  const pong = await redis.ping();
  if (pong !== 'PONG') throw new Error(`Unexpected Redis ping response: ${pong}`);
}

export async function closeRedis(): Promise<void> {
  await redis.quit();
  logger.info('Redis connection closed');
}
