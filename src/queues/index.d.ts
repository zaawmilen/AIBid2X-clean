import { Queue } from 'bullmq';
export declare function getQueueConnection(): {
    host: string;
    port: number;
    password: string | undefined;
};
export declare const auctionQueue: Queue<any, any, string, any, any, string>;
export declare const notificationQueue: Queue<any, any, string, any, any, string>;
export declare const embeddingQueue: Queue<any, any, string, any, any, string>;
export interface ExpireAuctionJob {
    auctionId: string;
}
export interface OutbidNotificationJob {
    userId: string;
    auctionId: string;
    auctionTitle: string;
    newAmount: string;
    previousBidderEmail: string;
}
export interface AuctionWonJob {
    userId: string;
    auctionId: string;
    auctionTitle: string;
    finalAmount: string;
}
export interface GenerateEmbeddingJob {
    auctionId: string;
    text: string;
}
//# sourceMappingURL=index.d.ts.map