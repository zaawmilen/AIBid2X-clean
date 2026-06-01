import { WebSocketServer } from 'ws';
import type { Server } from 'http';
export type AuctionEvent = {
    type: 'connected';
    auctionId: string;
    watchers: number;
} | {
    type: 'bid_placed';
    auctionId: string;
    bidId: string;
    amount: string;
    bidderId: string;
    currentPrice: string;
    timestamp: string;
} | {
    type: 'auction_ended';
    auctionId: string;
    winnerId: string | null;
    finalPrice: string;
} | {
    type: 'watchers_updated';
    auctionId: string;
    count: number;
};
export declare function broadcastToAuction(auctionId: string, event: AuctionEvent): void;
export declare function createWebSocketServer(httpServer: Server): WebSocketServer;
//# sourceMappingURL=websocket.d.ts.map