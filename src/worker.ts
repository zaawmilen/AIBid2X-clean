import 'dotenv/config';
import { logger } from './lib/logger.js';
import { createAuctionWorker } from './workers/auction.worker.js';
import { createNotificationWorker } from './workers/notification.worker.js';
import { createEmbeddingWorker } from './workers/embedding.worker.js';

async function startWorker() {
  logger.info('Starting worker process');
  const workers = [createAuctionWorker(), createNotificationWorker(), createEmbeddingWorker()];
  logger.info({ queues: ['auction-jobs', 'notifications', 'embeddings'] }, 'All workers started');

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Worker shutdown signal received');
    await Promise.all(workers.map((w) => w.close()));
    logger.info('All workers closed');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => logger.error({ reason }, 'Unhandled rejection'));
}

startWorker().catch((err) => { logger.error({ err }, 'Failed to start worker'); process.exit(1); });
