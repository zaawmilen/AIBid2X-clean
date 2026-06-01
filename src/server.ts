import 'dotenv/config';
import http from 'http';
import express from 'express';

import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';

import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { redis, closeRedis } from './lib/redis.js';
import { closeDatabasePool } from './db/index.js';

import { correlationId } from './middleware/correlationId.js';
import { requestLogger } from './middleware/requestLogger.js';
import { errorHandler } from './middleware/errorHandler.js';

import { requireAuth } from './middleware/requireAuth.js';
import { apiRateLimit } from './middleware/rateLimiter.js';

import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { auctionRouter } from './routes/auctions.js';
import { analysisRouter } from './routes/analysis.js';
import { searchRouter } from './routes/search.js';
import { metricsRouter } from './routes/metrics.js';
import { createWebSocketServer, broadcastToAuction } from './lib/websocket.js';
import { startAuctionEventSubscriber } from './lib/pubsub.js';

import { auctionQueue, notificationQueue, embeddingQueue } from './queues/index.js';

/**
 * FIX ADDITION #1:
 * Router safety check
 * WHY: prevents silent production failure when a router import is broken
 */
function assertRouter(name: string, router: any) {
  if (!router) {
    throw new Error(`Router missing or undefined: ${name}`);
  }
}

async function bootstrap() {
  const app = express();

  await redis.connect();

  logger.info('Redis connected');

  startAuctionEventSubscriber((event) =>
    broadcastToAuction(event.auctionId, event),
  );

  const boardAdapter = new ExpressAdapter();
  boardAdapter.setBasePath('/admin/queues');

  createBullBoard({
    queues: [
      new BullMQAdapter(auctionQueue),
      new BullMQAdapter(notificationQueue),
      new BullMQAdapter(embeddingQueue),
    ],
    serverAdapter: boardAdapter,
  });

  // ── Core middleware stack ─────────────────────────────
  app.use(correlationId);
  app.use(requestLogger);
  app.use(express.json({ limit: '1mb' }));

  // ── ROUTES ─────────────────────────────────────────────

  app.use(healthRouter);

  app.use('/admin/queues', requireAuth, boardAdapter.getRouter());

  app.use('/api/v1/auth', apiRateLimit, authRouter);
  app.use('/api/v1/auctions', apiRateLimit, auctionRouter);
  app.use('/api/v1/auctions/:id/analysis', analysisRouter);
  app.use('/api/v1/search', searchRouter);
  app.use('/api/v1/metrics', metricsRouter);

  /**
   * FIX ADDITION #2:
   * Validate routers are actually loaded
   * WHY: catches broken imports BEFORE production silently fails
   */
  assertRouter('authRouter', authRouter);
  assertRouter('auctionRouter', auctionRouter);
  assertRouter('analysisRouter', analysisRouter);
  assertRouter('searchRouter', searchRouter);
  assertRouter('metricsRouter', metricsRouter);
  /**
   * FIX ADDITION #3:
   * Improved 404 logging for debugging production routing issues
   * WHY: helps detect wrong route prefix or missing router mount
   */
  app.use((req, res) => {
    logger.warn(
      { method: req.method, url: req.url },
      'Route not found',
    );

    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: `Route not found: ${req.method} ${req.url}`,
      },
    });
  });

  app.use(errorHandler);

  const httpServer = http.createServer(app);

  createWebSocketServer(httpServer);

  httpServer.listen(env.PORT, () => {
    logger.info(
      { port: env.PORT, env: env.NODE_ENV },
      'Server listening',
    );
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received');

    httpServer.close(async () => {
      await Promise.all([
        closeDatabasePool(),
        closeRedis(),
        auctionQueue.close(),
        notificationQueue.close(),
        embeddingQueue.close(),
      ]);

      logger.info('All connections closed — exiting');
      process.exit(0);
    });

    setTimeout(() => process.exit(1), 10_000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled rejection');
  });
}

bootstrap().catch((err) => {
  logger.error({ err }, 'Failed to start server');
  process.exit(1);
});