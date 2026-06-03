import { runWithCommittedFixtures } from '../setup/transaction.js';
import { createTestUsers } from '../fixtures/userFactory.js';
import { createTestAuction } from '../fixtures/auctionFactory.js';
import { placeBid } from '../../services/bid.service.js';
import { auctions, bids } from '../../db/schema.js';
import { eq } from 'drizzle-orm';

describe('bid lifecycle', () => {
  it('accepts a valid bid and updates auction price', async () => {
    await runWithCommittedFixtures(
      async (db) => {
        const [seller, bidder] = await createTestUsers(db, 2);
        const auction = await createTestAuction(db, { startingPrice: 100 });
        await db.update(auctions).set({ status: 'active' }).where(eq(auctions.id, auction.id));
        return { seller, bidder, auction };
      },
      async (tx, _withCommitted, setup) => {
        const { seller, bidder, auction } = setup as any;
        const bid = await placeBid(auction.id, bidder.id, 120);

      expect(bid.amount).toBe('120.00');

      const [updated] = await tx
        .select()
        .from(auctions)
        .where(eq(auctions.id, auction.id))
        .limit(1);

      if (!updated) {
        throw new Error('Auction not found');
      }

      expect(updated.currentPrice).toBe('120.00');
    });
  });
});