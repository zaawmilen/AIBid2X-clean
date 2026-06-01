import { Worker } from 'bullmq';
import { getQueueConnection } from '../queues/index.js';
import { logger } from '../lib/logger.js';
export function createNotificationWorker() {
    const connection = getQueueConnection();
    const worker = new Worker('notifications', async (job) => {
        if (job.name === 'outbid') {
            const data = job.data;
            logger.info({ userId: data.userId, auctionId: data.auctionId, newAmount: data.newAmount }, '[NOTIFY] User outbid');
            return { notified: true, channel: 'log' };
        }
        if (job.name === 'auction-won') {
            const data = job.data;
            logger.info({ userId: data.userId, auctionId: data.auctionId, finalAmount: data.finalAmount }, `[NOTIFY] Auction won: "${data.auctionTitle}"`);
            return { notified: true, channel: 'log' };
        }
        logger.warn({ jobName: job.name }, 'Unknown notification job — skipping');
        return { skipped: true };
    }, { connection, concurrency: 10 });
    worker.on('failed', (job, err) => logger.error({ jobId: job?.id, err }, 'Notification job failed'));
    return worker;
}
//# sourceMappingURL=notification.worker.js.map