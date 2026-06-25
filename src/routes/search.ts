import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { embedText } from '../lib/openai.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  try {
    const q = String(req.query.q ?? '');
    if (q.length < 2) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'q must be at least 2 characters' } });
    }
    const limit = Math.min(Number(req.query.limit) || 10, 50);
    const minSimilarity = Number(req.query.minSimilarity ?? -1);
    const searchStart = Date.now();

    const queryEmbedding = await embedText(q);
    const isMockEmbedding = queryEmbedding.every(v => v === 0);

    const pool = new Pool({ connectionString: env.DATABASE_URL, max: 2 });
    let result;

    if (!isMockEmbedding) {
      // ── Vector path (real OpenAI embeddings available) ──────────────────
      const vectorLiteral = `[${queryEmbedding.join(',')}]`;
      result = await pool.query(
        `SELECT
          a.id, a.title, a.description, a.current_price,
          a.status, a.end_time, u.email AS seller_email,
          ROUND((1 - (a.embedding <=> $1::vector))::numeric, 4) AS similarity
         FROM auctions a
         JOIN users u ON u.id = a.seller_id
         WHERE a.status = 'active'
           AND a.embedding IS NOT NULL
           AND (1 - (a.embedding <=> $1::vector)) >= $2
         ORDER BY a.embedding <=> $1::vector
         LIMIT $3`,
        [vectorLiteral, minSimilarity, limit],
      );
    } else {
      // ── FTS fallback (mock embeddings — keyword search only) ─────────────
      result = await pool.query(
        `SELECT
          a.id, a.title, a.description, a.current_price,
          a.status, a.end_time, u.email AS seller_email,
          ROUND(ts_rank(
            to_tsvector('english', a.title || ' ' || COALESCE(a.description, '')),
            plainto_tsquery('english', $1)
          )::numeric, 4) AS similarity
         FROM auctions a
         JOIN users u ON u.id = a.seller_id
         WHERE a.status = 'active'
           AND to_tsvector('english', a.title || ' ' || COALESCE(a.description, ''))
               @@ plainto_tsquery('english', $1)
         ORDER BY similarity DESC
         LIMIT $2`,
        [q, limit],
      );
    }
    await pool.end();

    logger.info({ query: q, resultsCount: result.rows.length, searchDurationMs: Date.now() - searchStart }, 'Semantic search completed');
    return res.status(200).json({ query: q, results: result.rows, meta: { count: result.rows.length, minSimilarity } });
  } catch (err: unknown) {
    const error = err as Error;
    logger.error({ err: error.message }, 'Search error');
    return res.status(500).json({ error: { code: 'SEARCH_ERROR', message: error.message } });
  }
});

export { router as searchRouter };
