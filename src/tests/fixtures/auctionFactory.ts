import { auctions, users } from '../../db/schema.js';

export async function createTestAuction(txDb: any, opts: { startingPrice?: number } = {}) {
  const startingPrice = (opts.startingPrice ?? 100).toFixed(2);
  const [auction] = await txDb.insert(auctions).values({
    title: `Test Auction ${Date.now()}`,
    description: 'Fixture auction',
    sellerId: (await txDb.select({ id: users.id }).from(users).limit(1))[0]?.id ?? null,
    startingPrice,
    currentPrice: startingPrice,
    status: 'draft',
    endTime: new Date(Date.now() + 1000 * 60 * 60),
  }).returning();

  return auction;
}

export default createTestAuction;
