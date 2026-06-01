import * as Redis from 'ioredis';
import { env } from '../config/env.js';
import { logger } from './logger.js';
export const AUCTION_EVENTS_CHANNEL = 'auction:events';
export async function publishAuctionEvent(publisher, event) {
    await publisher.publish(AUCTION_EVENTS_CHANNEL, JSON.stringify(event));
    logger.debug({ type: event.type, auctionId: event.auctionId }, 'Event published to Redis channel');
}
export function startAuctionEventSubscriber(onEvent) {
    const subscriber = new Redis.Redis(env.REDIS_URL, { lazyConnect: false, maxRetriesPerRequest: null });
    subscriber.subscribe(AUCTION_EVENTS_CHANNEL, (err) => {
        if (err) {
            logger.error({ err }, 'Failed to subscribe to auction:events');
            return;
        }
        logger.info('Subscribed to auction:events Redis channel');
    });
    subscriber.on('message', (_channel, message) => {
        try {
            const event = JSON.parse(message);
            onEvent(event);
        }
        catch (err) {
            logger.error({ err }, 'Failed to parse auction event from pub/sub');
        }
    });
    subscriber.on('error', (err) => logger.error({ err }, 'Subscriber connection error'));
    return subscriber;
}
//# sourceMappingURL=pubsub.js.map