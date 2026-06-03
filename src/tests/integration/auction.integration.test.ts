import { describe, it, expect } from 'vitest';
import { runWithCommittedFixtures } from '../setup/transaction.js';
import { createTestUsers } from '../fixtures/userFactory.js';
import { createAuction, activateAuction, getAuctionById } from '../../services/auction.service.js';

describe('Auction', () => {
  it('creates auction', async () => {
    await runWithCommittedFixtures(
      async (db) => {
        const [seller] = await createTestUsers(db, 1);
        return { seller };
      },
      async (_tx, _withCommitted, setup) => {
        const { seller } = setup as any;
        const auction = await createAuction(seller.id, { title: 'X', description: 'desc', startingPrice: 10,  endTime: new Date(Date.now() + 60_000).toISOString() });
        expect(auction).toBeDefined();
        expect(auction.title).toBe('X');
      },
    );
  });

  it('activates auction', async () => {
    await runWithCommittedFixtures(
      async (db) => {
        const [seller] = await createTestUsers(db, 1);
        return { seller };
      },
      async (_tx, _withCommitted, setup) => {
        const { seller } = setup as any;
        const auction = await createAuction(seller.id, { title: 'Y', description: 'd', startingPrice: 20,  endTime: new Date(Date.now() + 60_000).toISOString() });
        const activated = await activateAuction(auction.id, seller.id);
        expect(activated.status).toBe('active');
      },
    );
  });

  it('gets auction details', async () => {
    await runWithCommittedFixtures(
      async (db) => {
        const [seller, bidder] = await createTestUsers(db, 2);
        return { seller, bidder };
      },
      async (_tx, _withCommitted, setup) => {
        const { seller } = setup as any;
        const auction = await createAuction(seller.id, { title: 'Z', description: 'dd', startingPrice: 30,  endTime: new Date(Date.now() + 60_000).toISOString() });
        await activateAuction(auction.id, seller.id);
        const details = await getAuctionById(auction.id);
        expect(details).toBeDefined();
        expect(details.id).toBe(auction.id);
      },
    );
  });
});