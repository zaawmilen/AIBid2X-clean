import { Worker } from 'bullmq';
import type { GenerateEmbeddingJob } from '../queues/index.js';
export declare function createEmbeddingWorker(): Worker<GenerateEmbeddingJob, any, string>;
//# sourceMappingURL=embedding.worker.d.ts.map