export declare const redis: any;
export declare function checkRedisConnection(): Promise<void>;
export declare function closeRedis(): Promise<void>;
export declare function safeRedisGet(key: string): Promise<string | null>;
export declare function safeRedisSet(key: string, value: string, ttlSeconds?: number): Promise<void>;
//# sourceMappingURL=redis.d.ts.map