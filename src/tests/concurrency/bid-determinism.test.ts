import { describe, it, expect } from 'vitest';
import { db } from '../../db/index.js';
import { auctions, bids } from '../../db/schema.js';
import { eq } from 'drizzle-orm';

import { createTestUsers } from '../fixtures/userFactory.js';
import { createTestAuction } from '../fixtures/auctionFactory.js';
import { placeBid } from '../../services/bid.service.js';

describe('bid determinism', () => {
  it('repeated concurrent runs deterministically produce single winner', async () => {
    for (let run = 0; run < 3; run++) {
      const bidders = await createTestUsers(db, 10);

      const auction = await createTestAuction(db, { startingPrice: 100 });

      await db.update(auctions).set({ status: 'active', startTime: new Date(), updatedAt: new Date() }).where(eq(auctions.id, auction.id));

      const results = await Promise.allSettled(
        bidders.map((b: { id: string }, i: number) => placeBid(auction.id, b.id, 101 + i))
      );

      const fulfilled = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<any>[];
      const failed = results.filter((r) => r.status === 'rejected');

      // At least one should succeed and the sum should equal number of bidders
      expect(fulfilled.length).toBeGreaterThan(0);
      expect(fulfilled.length + failed.length).toBe(bidders.length);

      const [updated] = await db.select().from(auctions).where(eq(auctions.id, auction.id)).limit(1);
      expect(updated).toBeDefined();

      // highest bid should be the max amount offered
      expect(Number(updated!.currentPrice)).toBe(101 + bidders.length - 1);

      // ensure only one winning bid per auction
      const winningRows = await db.select().from(bids).where(eq(bids.auctionId, auction.id));
      const winners = winningRows.filter((r: any) => r.status === 'winning');
      expect(winners.length).toBe(1);
    }
  });
});
