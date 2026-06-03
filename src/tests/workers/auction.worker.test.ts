import { describe, it, expect } from 'vitest';
import { createAuctionWorker } from '../../workers/auction.worker.js';

describe('Auction Worker', () => {
  it('exports createAuctionWorker factory', () => {
    expect(typeof createAuctionWorker).toBe('function');
  });
});