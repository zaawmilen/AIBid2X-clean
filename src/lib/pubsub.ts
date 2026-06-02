import Redis from 'ioredis';
import { env } from '../config/env';
import { logger } from './logger';
import type { AuctionEvent } from './websocket';

export const AUCTION_EVENTS_CHANNEL = 'auction:events';

export async function publishAuctionEvent(publisher: Redis, event: AuctionEvent): Promise<void> {
  await publisher.publish(AUCTION_EVENTS_CHANNEL, JSON.stringify(event));
  logger.debug({ type: event.type, auctionId: event.auctionId }, 'Event published to Redis channel');
}

export function startAuctionEventSubscriber(onEvent: (event: AuctionEvent) => void): Redis {
  const isTLS = env.REDIS_URL.startsWith('rediss://');

  const subscriber = new Redis(env.REDIS_URL, {
    lazyConnect: false,
    maxRetriesPerRequest: null, // subscriber must retry indefinitely
    enableOfflineQueue: true,
    retryStrategy(times) {
      return Math.min(times * 100, 3000);
    },
    reconnectOnError(err) {
      return err.message.includes('ECONNRESET') || err.message.includes('ETIMEDOUT');
    },
    ...(isTLS && { tls: {} }),
  });

  subscriber.subscribe(AUCTION_EVENTS_CHANNEL, (err) => {
    if (err) { logger.error({ err }, 'Failed to subscribe to auction:events'); return; }
    logger.info('Subscribed to auction:events Redis channel');
  });

  // Re-subscribe after reconnect — ioredis drops subscriptions on reconnect
  subscriber.on('ready', () => {
    subscriber.subscribe(AUCTION_EVENTS_CHANNEL).catch((err) => {
      logger.error({ err }, 'Failed to re-subscribe after reconnect');
    });
  });

  subscriber.on('message', (_channel, message) => {
    try {
      const event = JSON.parse(message) as AuctionEvent;
      onEvent(event);
    } catch (err) {
      logger.error({ err }, 'Failed to parse auction event from pub/sub');
    }
  });

  subscriber.on('error', (err) => logger.error({ err }, 'Subscriber connection error'));
  return subscriber;
}
