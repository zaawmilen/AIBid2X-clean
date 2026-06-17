import "dotenv/config";
import http from "http";

import { app } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { redis } from "./lib/redis.js";
import { closeDatabasePool } from "./db/index.js";

import { createWebSocketServer, broadcastToAuction } from "./lib/websocket.js";
import { startAuctionEventSubscriber } from "./lib/pubsub.js";

import { auctionQueue, notificationQueue, embeddingQueue } from "./queues/index.js";

async function bootstrap() {
  // const app = createApp();

  await redis.connect();
  logger.info("Redis connected");

  startAuctionEventSubscriber((event) =>
    broadcastToAuction(event.auctionId, event)
  );

  const httpServer = http.createServer(app);

  createWebSocketServer(httpServer);

  httpServer.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, "Server running");
  });

  const shutdown = (signal: string) => {
  logger.info({ signal }, 'Shutdown signal received — draining');

  // Stop accepting new connections immediately.
  // Track and destroy open keep-alive connections so we don't wait
  // for idle clients to close on their own.
  const openSockets = new Set<import('net').Socket>();

  httpServer.on('connection', (socket) => {
    openSockets.add(socket);
    socket.once('close', () => openSockets.delete(socket));
  });

  httpServer.close(async () => {
    logger.info('HTTP server closed — shutting down subsystems');
    try {
      await Promise.all([
        closeDatabasePool(),
        redis.quit?.() ?? redis.disconnect?.(),
        auctionQueue.close(),
        notificationQueue.close(),
        embeddingQueue.close(),
      ]);
      logger.info('Shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  });

  // Destroy open keep-alive sockets so httpServer.close() callback fires
  // promptly instead of waiting up to the OS keep-alive timeout.
  for (const socket of openSockets) {
    socket.destroy();
  }

  // Hard kill after 10s — ensures the process always exits even if a
  // subsystem (e.g. a stuck BullMQ worker) hangs during shutdown.
  setTimeout(() => {
    logger.error('Shutdown timeout — forcing exit');
    process.exit(1);
  }, 10_000).unref(); // .unref() so this timer doesn't prevent normal exit
};

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

bootstrap().catch((err) => {
  logger.error({ err }, "Failed to start server");
  process.exit(1);
});