import { upstashRedis } from './redis.upstash.js';
import { safeRedisGet, safeRedisSet } from './redis.js';
// FEATURE SWITCH
const USE_UPSTASH = true;
export async function cacheGet(key) {
    if (USE_UPSTASH) {
        try {
            return await upstashRedis.get(key);
        }
        catch {
            return null;
        }
    }
    return safeRedisGet(key);
}
export async function cacheSet(key, value, ttl) {
    if (USE_UPSTASH) {
        try {
            const opts = ttl !== undefined ? { ex: ttl } : undefined;
            return await upstashRedis.set(key, value, opts);
        }
        catch {
            return;
        }
    }
    return safeRedisSet(key, JSON.stringify(value), ttl);
}
//# sourceMappingURL=cache.js.map