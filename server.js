import 'dotenv/config';
import express from 'express';
import { env } from './src/config/env.js';
import { logger } from './src/lib/logger.js';
import { redis, closeRedis } from './src/lib/redis.js';
import { closeDatabasePool } from './src/db/index.js';
import { correlationId } from './src//middleware/correlationId.js';
import { requestLogger } from './src/middleware/requestLogger.js';
import { errorHandler } from './src//middleware/errorHandler.js';
import { healthRouter } from './src/routes/health.js';
async function bootstrap() {
    const app = express();
    // ── Connect dependencies first ─────────────────────────────────────────
    // Fail fast before accepting any traffic — don't boot a broken server.
    await redis.connect();
    logger.info('Redis connected');
    // ── Middleware stack ───────────────────────────────────────────────────
    // Order matters: correlation IDs must be stamped before anything logs.
    // Stamp every request with a traceable ID
    app.use(correlationId);
    // Structured request/response logging
    app.use(requestLogger);
    // Parse JSON bodies — cap at 1mb to prevent large payload attacks
    app.use(express.json({ limit: '1mb' }));
    // ── Routes ─────────────────────────────────────────────────────────────
    // Health checks sit at root — no /api/v1 prefix (load balancers expect bare paths)
    app.use(healthRouter);
    // All application routes are versioned under /api/v1
    // Additional routers (auctions, bids, auth) will be mounted here in future sessions
    app.use('/api/v1', (_req, res) => {
        res.status(200).json({ message: 'Auction API v1' });
    });
    // 404 handler — must come after all routes
    app.use((_req, res) => {
        res.status(404).json({
            error: { code: 'NOT_FOUND', message: 'Route not found' },
        });
    });
    // Error handler — must be last, and must have 4 parameters
    app.use(errorHandler);
    // ── Start listening ────────────────────────────────────────────────────
    const server = app.listen(env.PORT, () => {
        logger.info({ port: env.PORT, env: env.NODE_ENV }, `Server listening`);
    });
    // ── Graceful shutdown ──────────────────────────────────────────────────
    // On SIGTERM (Fly.io/Docker sends this before killing the process):
    // 1. Stop accepting new connections
    // 2. Wait for in-flight requests to complete (up to 10s)
    // 3. Close DB pool and Redis — release resources cleanly
    const shutdown = (signal) => {
        logger.info({ signal }, 'Shutdown signal received — draining connections');
        server.close(async () => {
            logger.info('HTTP server closed');
            try {
                await Promise.all([
                    closeDatabasePool(),
                    closeRedis(),
                ]);
                logger.info('All connections closed — exiting');
                process.exit(0);
            }
            catch (err) {
                logger.error({ err }, 'Error during shutdown');
                process.exit(1);
            }
        });
        // Force-quit if drain takes too long
        setTimeout(() => {
            logger.error('Graceful shutdown timed out — forcing exit');
            process.exit(1);
        }, 10_000);
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    // Log unhandled promise rejections instead of silently swallowing them
    process.on('unhandledRejection', (reason) => {
        logger.error({ reason }, 'Unhandled promise rejection');
    });
}
bootstrap().catch((err) => {
    logger.error({ err }, 'Failed to start server');
    process.exit(1);
});
//# sourceMappingURL=server.js.map