import { describe, it, expect } from 'vitest';
import { embedText, EMBEDDING_DIMENSIONS } from '../../lib/openai.js';

describe('Embedding Worker', () => {
  it('generate mock embedding when OPENAI_API_KEY is not set', async () => {
    const text = 'Hello world embedding test';
    const emb = await embedText(text, { auctionId: 'test' });
    expect(Array.isArray(emb)).toBe(true);
    expect(emb.length).toBe(EMBEDDING_DIMENSIONS);
    // Values should be finite numbers between -1 and 1
    for (const v of emb) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});