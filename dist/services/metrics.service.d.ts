interface QueueMetrics {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
}
interface DatabaseMetrics {
    totalUsers: number;
    totalAuctions: number;
    activeAuctions: number;
    endedAuctions: number;
    totalBids: number;
    auctionsWithEmbeddings: number;
}
interface RedisMetrics {
    connectedClients: number;
    usedMemoryHuman: string;
    keyspaceHits: number;
    keyspaceMisses: number;
    totalCommandsProcessed: number;
}
export interface SystemMetrics {
    uptime: {
        seconds: number;
        human: string;
    };
    database: DatabaseMetrics;
    queues: Record<string, QueueMetrics>;
    redis: RedisMetrics;
    timestamp: string;
}
export declare function getSystemMetrics(): Promise<SystemMetrics>;
export {};
//# sourceMappingURL=metrics.service.d.ts.map