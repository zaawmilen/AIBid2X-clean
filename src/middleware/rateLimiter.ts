import { Request, Response, NextFunction } from 'express';
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';

type AuthenticatedRequest = Request & { user?: { sub?: string } };

const SLIDING_WINDOW_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window_start = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local window_ms = tonumber(ARGV[4])
local member = ARGV[5]
redis.call('ZREMRANGEBYSCORE', key, 0, window_start)
local count = redis.call('ZCARD', key)
if count >= limit then return {0, 0} end
redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, window_ms)
return {1, limit - count - 1}
`;

async function checkRateLimit(key: string, limit: number, windowMs: number): Promise<{ allowed: boolean; remaining: number }> {
  const now = Date.now();
  const windowStart = now - windowMs;
  const member = `${now}:${Math.random().toString(36).slice(2, 8)}`;
  const result = await redis.eval(SLIDING_WINDOW_SCRIPT, 1, key, String(now), String(windowStart), String(limit), String(windowMs), member) as [number, number];
  return { allowed: result[0] === 1, remaining: result[1] };
}

export function rateLimiter(limit: number, windowMs: number) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const identifier = req.user?.sub ?? req.ip ?? 'anonymous';
      const routeKey = `${req.method}:${req.route?.path ?? req.path}`;
      const key = `rate_limit:${routeKey}:${identifier}`;
      const { allowed, remaining } = await checkRateLimit(key, limit, windowMs);
      res.setHeader('X-RateLimit-Limit', limit);
      res.setHeader('X-RateLimit-Remaining', remaining);
      res.setHeader('X-RateLimit-Window-Ms', windowMs);
      if (!allowed) {
        logger.warn({ identifier, routeKey }, 'Rate limit exceeded');
        return res.status(429).json({ error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests — please slow down', retryAfterMs: windowMs } });
      }
      next();
    } catch (err) {
      logger.error({ err }, 'Rate limiter error — failing open');
      return next();
    }
  };
}

export const bidRateLimit = rateLimiter(10, 60_000);
export const authRateLimit = rateLimiter(10, 15 * 60_000);
export const apiRateLimit = rateLimiter(120, 60_000);
