import * as Redis from 'ioredis';
import type { AuctionEvent } from './websocket.js';
export declare const AUCTION_EVENTS_CHANNEL = "auction:events";
export declare function publishAuctionEvent(publisher: Redis.Redis, event: AuctionEvent): Promise<void>;
export declare function startAuctionEventSubscriber(onEvent: (event: AuctionEvent) => void): Redis.Redis;
//# sourceMappingURL=pubsub.d.ts.map