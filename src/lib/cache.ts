import { upstashRedis } from './redis.upstash.js';
import { redis as ioredis } from './redis.js';
import { logger } from '../lib/logger.js';

const USE_UPSTASH = true;

// ----------------------
// SAFE INIT (NON-BLOCKING)
// ----------------------
export async function initCache() {
  if (!USE_UPSTASH && ioredis) {
    try {
      await ioredis.connect?.();
      logger.info('ioredis connected');
    } catch (err) {
      logger.warn({ err }, 'ioredis init failed (non-fatal)');
    }
  }
}

// ----------------------
// SAFE SHUTDOWN (IMPORTANT)
// ----------------------
export async function closeCache() {
  try {
    if (USE_UPSTASH) {
      // Upstash REST: nothing to close
      return;
    }

    if (ioredis) {
      if (typeof (ioredis as any).quit === 'function') {
        await (ioredis as any).quit();
      } else if (typeof (ioredis as any).disconnect === 'function') {
        await (ioredis as any).disconnect();
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Cache shutdown failed (ignored)');
  }
}