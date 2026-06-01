import { Worker } from 'bullmq';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { auctions } from '../db/schema.js';
import { getQueueConnection } from '../queues/index.js';
import { embedText } from '../lib/openai.js';
import { logger } from '../lib/logger.js';
export function createEmbeddingWorker() {
    const connection = getQueueConnection();
    const worker = new Worker('embeddings', async (job) => {
        const { auctionId, text } = job.data;
        logger.info({ auctionId, textLength: text.length }, '[EMBED] Generating embedding');
        // Uses real OpenAI if OPENAI_API_KEY is set, mock otherwise
        const embedding = await embedText(text, { auctionId });
        await db
            .update(auctions)
            .set({ embedding: embedding, updatedAt: new Date() })
            .where(eq(auctions.id, auctionId));
        logger.info({ auctionId, dimensions: embedding.length }, '[EMBED] Embedding stored in pgvector');
        return { auctionId, status: 'embedded', dimensions: embedding.length };
    }, { connection, concurrency: 3 });
    worker.on('completed', (job, result) => logger.info({ jobId: job.id, result }, 'Embedding job completed'));
    worker.on('failed', (job, err) => logger.error({ jobId: job?.id, err }, 'Embedding job failed'));
    return worker;
}
//# sourceMappingURL=embedding.worker.js.map