import { Redis } from "@upstash/redis";
export const upstashRedis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
});
//# sourceMappingURL=redis.upstash.js.map