import { describe, it, expect } from 'vitest';
import { runWithCommittedFixtures } from '../../setup/transaction.js';
import { createTestUsers } from '../../fixtures/userFactory.js';
import { createAuction, activateAuction } from '../../../services/auction.service.js';
import { AppError } from '../../../lib/errors.js';

describe('auction lifecycle', () => {
  it('activates only by the seller', 
    { timeout: 20000 },
    async () => {
    await runWithCommittedFixtures(
      async (db) => {
        const [seller, other] = await createTestUsers(db, 2);
        return { seller, other };
      },
      async (_tx, _withCommitted, setup) => {
        const { seller, other } = setup as any;
        const auction = await createAuction(seller.id, { title: 'L', description: 'd', startingPrice: 5, endTime: new Date(Date.now() + 60_000).toISOString() });
        await activateAuction(auction.id, seller.id);
        let thrown = false;
        try {
          await activateAuction(auction.id, other.id);
        } catch (e: any) {
          thrown = true;
          expect(e).toBeInstanceOf(AppError);
          expect((e as AppError).statusCode).toBe(403);
        }
        expect(thrown).toBe(true);
      },
    );
  });
});