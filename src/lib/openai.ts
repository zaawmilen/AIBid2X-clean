import { env } from '../config/env.js';
import { logger } from './logger.js';

export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIMENSIONS = 1536;

function generateMockEmbedding(text: string): number[] {
  const vector = new Array(EMBEDDING_DIMENSIONS).fill(0);
  const normalized = text.toLowerCase();
  for (let i = 0; i < normalized.length; i++) {
    const code = normalized.charCodeAt(i);
    for (let d = 0; d < 8; d++) {
      const dim = (code * 31 + i * 17 + d * 7) % EMBEDDING_DIMENSIONS;
      vector[dim] += Math.sin(code * (d + 1) * 0.1) * 0.1;
    }
  }
  const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  return magnitude > 0 ? vector.map((v) => v / magnitude) : vector;
}

async function generateRealEmbedding(text: string, context: { auctionId?: string }): Promise<number[]> {
  const OpenAI = (await import('openai')).default;
  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  const response = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
    dimensions: EMBEDDING_DIMENSIONS,
  });
  const usage = response.usage;
  logger.info({
    model: EMBEDDING_MODEL,
    promptTokens: usage.prompt_tokens,
    totalTokens: usage.total_tokens,
    estimatedCostUSD: ((usage.total_tokens / 1_000_000) * 0.02).toFixed(6),
    ...context,
  }, 'Embedding generated');
  return response.data[0]?.embedding ?? [];
}

export async function embedText(
  text: string,
  context: { auctionId?: string } = {},
): Promise<number[]> {
  if (env.OPENAI_API_KEY && env.OPENAI_API_KEY !== 'mock') {
    return generateRealEmbedding(text, context);
  }
  logger.info({ textLength: text.length, ...context }, '[EMBED] Using mock embedding (no OPENAI_API_KEY)');
  return generateMockEmbedding(text);
}
