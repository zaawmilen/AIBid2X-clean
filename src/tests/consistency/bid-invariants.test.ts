import { runWithCommittedFixtures } from '../setup/transaction.js';
import { createTestUsers } from '../fixtures/userFactory.js';
import { createTestAuction } from '../fixtures/auctionFactory.js';
import { placeBid } from '../../services/bid.service.js';
import { bids, auctions } from '../../db/schema.js';
import { eq, and } from 'drizzle-orm';

describe('bid invariants', () => {
  it('never allows multiple winning bids', async () => {
    await runWithCommittedFixtures(
      async (db) => {
        const bidders = await createTestUsers(db, 5);
        const auction = await createTestAuction(db, { startingPrice: 100 });
        await db.update(auctions).set({ status: 'active' }).where(eq(auctions.id, auction.id));
        return { bidders, auction };
      },
      async (tx, _withCommitted, setup) => {
        const { bidders, auction } = setup as any;

        await Promise.all(
          bidders.map((b: any, i: number) =>
            placeBid(auction.id, b.id, 110 + i).catch(() => {})
          )
        );

        const winners = await tx
          .select()
          .from(bids)
          .where(and(eq(bids.status, 'winning'), eq(bids.auctionId, auction.id)));

        expect(winners.length).toBe(1);
      }
    );
  });
});