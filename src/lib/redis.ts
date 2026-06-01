import Redis from 'ioredis';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableOfflineQueue: false,
  lazyConnect: true,

  retryStrategy(times: number) {
    const delay = Math.min(times * 100, 2000);
    logger.warn(`Redis reconnect attempt #${times} in ${delay}ms`);
    return delay;
  }
});

// --------------------
// NON-FATAL CONNECTION
// --------------------
let redisReady = false;

redis.on('connect', () => logger.info('Redis connecting...'));

redis.on('ready', () => {
  redisReady = true;
  logger.info('Redis ready');
});

redis.on('error', (err: Error) => {
  redisReady = false;
  logger.error({ err }, 'Redis error (non-fatal)');
});

redis.on('close', () => {
  redisReady = false;
  logger.warn('Redis connection closed');
});

redis.on('reconnecting', () => {
  logger.warn('Redis reconnecting...');
});

// --------------------
// SAFE CONNECTION CHECK
// --------------------
export async function checkRedisConnection(): Promise<void> {
  try {
    const pong = await redis.ping();
    if (pong !== 'PONG') {
      logger.warn(`Unexpected Redis response: ${pong}`);
    } else {
      redisReady = true;
    }
  } catch (err) {
    redisReady = false;
    logger.warn({ err }, 'Redis not available (continuing without cache)');
  }
}

// --------------------
// SAFE QUIT
// --------------------
export async function closeRedis(): Promise<void> {
  try {
    await redis.quit();
    logger.info('Redis connection closed');
  } catch (err) {
    logger.warn({ err }, 'Error closing Redis (ignored)');
  }
}

// --------------------
// OPTIONAL HELPER (IMPORTANT)
// --------------------
export function isRedisReady(): boolean {
  return redisReady;
}