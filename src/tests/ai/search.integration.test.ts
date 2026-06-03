import { describe, it, expect } from 'vitest';
import { assembleAnalysisPrompt, AuctionContext, SimilarAuction } from '../../lib/rag.js';

describe('AI Search', () => {
  it('assembleAnalysisPrompt contains required sections and numbers', () => {
    const auction: AuctionContext = {
      id: 'a1',
      title: 'Vintage Vase',
      description: 'A lovely antique vase',
      startingPrice: '50.00',
      currentPrice: '75.00',
      reservePrice: null,
      status: 'active',
      endTime: new Date(Date.now() + 20 * 60_000),
      embedding: null,
      bids: [
        { id: 'b1', amount: '70.00', createdAt: new Date(), bidderEmail: 'x@example.com' },
      ],
    };

    const similar: SimilarAuction[] = [
      { id: 's1', title: 'Antique Vase', description: null, current_price: '80.00', status: 'active', rrf_score: 0.1, semantic_score: 0.2, lexical_score: 0.3 },
    ];

    const prompt = assembleAnalysisPrompt(auction, similar);
    expect(prompt).toContain('**Bidding Momentum**');
    expect(prompt).toContain('**Market Positioning**');
    expect(prompt).toContain('**Price Forecast**');
    expect(prompt).toContain('**Key Observations**');
    expect(prompt).toContain('$75.00');
    expect(prompt).toContain('$80.00');
  });
});