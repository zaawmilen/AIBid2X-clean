import { describe, it, expect } from 'vitest';
import { runWithCommittedFixtures } from '../../setup/transaction.js';
import { createTestUsers } from '../../fixtures/userFactory.js';
import { createTestAuction } from '../../fixtures/auctionFactory.js';
import { placeBid } from '../../../services/bid.service.js';
import { auctions } from '../../../db/schema.js';
import { eq } from 'drizzle-orm';

describe('Bids', () => {
  it(
    'places bid',
    async () => {
      await runWithCommittedFixtures(
        async (db) => {
          const [seller, bidder] = await createTestUsers(db, 2);

          const auction = await createTestAuction(db, {
            startingPrice: 50,
          });

          await db
            .update(auctions)
            .set({ status: 'active' })
            .where(eq(auctions.id, auction.id));

          return { seller, bidder, auction };
        },

        async (tx, _withCommitted, setup) => {
          const { bidder, auction } = setup as any;

          const bid = await placeBid(
            auction.id,
            bidder.id,
            75,
          );

          expect(bid).toBeDefined();
          expect(bid.amount).toBe('75.00');

          const [updated] = await tx
            .select()
            .from(auctions)
            .where(eq(auctions.id, auction.id))
            .limit(1);

          expect(updated).toBeDefined();
          expect(updated!.currentPrice).toBe('75.00');
        }
      );
    },
    20000
  );

  it(
    'rejects lower bid',
    async () => {
      await runWithCommittedFixtures(
        async (db) => {
          const [seller, bidder] = await createTestUsers(db, 2);

          const auction = await createTestAuction(db, {
            startingPrice: 100,
          });

          await db
            .update(auctions)
            .set({ status: 'active' })
            .where(eq(auctions.id, auction.id));

          return { seller, bidder, auction };
        },

        async (_tx, _withCommitted, setup) => {
          const { bidder, auction } = setup as any;

          let thrown = false;

          try {
            await placeBid(
              auction.id,
              bidder.id,
              50,
            );
          } catch (e: any) {
            thrown = true;

            expect(e).toBeInstanceOf(Error);
            expect(e.code).toBe('BID_TOO_LOW');
          }

          expect(thrown).toBe(true);
        }
      );
    },
    20000
  );
});