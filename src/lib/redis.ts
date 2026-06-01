import Redis from 'ioredis';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

let ioredisAvailable = false;

// ioredis (legacy - NOT blocking startup)
// Fix for TS: ioredis import may not be recognized as constructable depending on tsconfig
const RedisClient = Redis as unknown as new (connection: string, opts?: Record<string, unknown>) => any;

export const redis = new RedisClient(env.REDIS_URL, {
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
  lazyConnect: true,
});

redis.on('ready', () => {
  ioredisAvailable = true;
  logger.info('ioredis ready');
});

redis.on('error', (err: Error) => {
  ioredisAvailable = false;
  logger.warn({ err }, 'ioredis error (non-fatal)');
});

// SAFE wrappers
export async function safeRedisGet(key: string) {
  if (!ioredisAvailable) return null;
  try {
    return await redis.get(key);
  } catch {
    return null;
  }
}

export async function safeRedisSet(key: string, value: string, ttl?: number) {
  if (!ioredisAvailable) return;
  try {
    if (ttl) await redis.set(key, value, 'EX', ttl);
    else await redis.set(key, value);
  } catch {}
}