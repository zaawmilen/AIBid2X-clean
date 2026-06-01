import { Worker } from 'bullmq';
import type { ExpireAuctionJob } from '../queues/index.js';
export declare function createAuctionWorker(): Worker<ExpireAuctionJob, any, string>;
//# sourceMappingURL=auction.worker.d.ts.map