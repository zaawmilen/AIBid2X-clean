import { Pool } from 'pg';
import { env } from '../config/env.js';
import { logger } from './logger.js';
const ragPool = new Pool({ connectionString: env.DATABASE_URL, max: 3 });
export async function findSimilarAuctions(auctionId, searchText, embedding, limit = 5) {
    try {
        if (embedding && embedding.length > 0) {
            const vectorLiteral = `[${embedding.join(',')}]`;
            const result = await ragPool.query(`WITH semantic_search AS (
          SELECT id, ROW_NUMBER() OVER (ORDER BY embedding <=> $1::vector) AS rank
          FROM auctions
          WHERE embedding IS NOT NULL AND status = 'active' AND id != $2
          LIMIT 20
        ),
        lexical_search AS (
          SELECT id,
            ROW_NUMBER() OVER (
              ORDER BY ts_rank(
                to_tsvector('english', title || ' ' || COALESCE(description, '')),
                plainto_tsquery('english', $3)
              ) DESC
            ) AS rank
          FROM auctions
          WHERE to_tsvector('english', title || ' ' || COALESCE(description, ''))
                @@ plainto_tsquery('english', $3)
            AND status = 'active' AND id != $2
          LIMIT 20
        )
        SELECT
          a.id, a.title, a.description, a.current_price, a.status,
          ROUND((COALESCE(1.0/(60+ss.rank),0)+COALESCE(1.0/(60+ls.rank),0))::numeric,6) AS rrf_score,
          ROUND(COALESCE(1-(a.embedding<=>$1::vector),0)::numeric,4) AS semantic_score,
          ROUND(COALESCE(1.0/(60+ls.rank),0)::numeric,6) AS lexical_score
        FROM auctions a
        LEFT JOIN semantic_search ss ON a.id = ss.id
        LEFT JOIN lexical_search ls ON a.id = ls.id
        WHERE ss.id IS NOT NULL OR ls.id IS NOT NULL
        ORDER BY rrf_score DESC
        LIMIT $4`, [vectorLiteral, auctionId, searchText, limit]);
            logger.debug({ auctionId, found: result.rows.length, mode: 'hybrid' }, 'RAG search completed');
            return result.rows;
        }
        else {
            const result = await ragPool.query(`SELECT a.id, a.title, a.description, a.current_price, a.status,
          ROUND(ts_rank(to_tsvector('english', a.title||' '||COALESCE(a.description,'')),
            plainto_tsquery('english',$1))::numeric,6) AS rrf_score,
          0::numeric AS semantic_score,
          ROUND(ts_rank(to_tsvector('english', a.title||' '||COALESCE(a.description,'')),
            plainto_tsquery('english',$1))::numeric,6) AS lexical_score
        FROM auctions a
        WHERE to_tsvector('english', a.title||' '||COALESCE(a.description,''))
              @@ plainto_tsquery('english', $1)
          AND a.status = 'active' AND a.id != $2
        ORDER BY rrf_score DESC LIMIT $3`, [searchText, auctionId, limit]);
            logger.debug({ auctionId, found: result.rows.length, mode: 'lexical' }, 'RAG search completed');
            return result.rows;
        }
    }
    catch (err) {
        logger.error({ err, auctionId }, 'RAG search failed — continuing with empty context');
        return [];
    }
}
export function assembleAnalysisPrompt(auction, similarAuctions) {
    const timeRemaining = auction.endTime
        ? Math.max(0, Math.floor((auction.endTime.getTime() - Date.now()) / 60_000))
        : null;
    const bidHistoryText = auction.bids.length > 0
        ? auction.bids.slice(0, 10).map(b => `  • $${b.amount} — ${new Date(b.createdAt).toISOString().replace('T', ' ').slice(0, 19)} UTC`).join('\n')
        : '  No bids placed yet';
    const marketContextText = similarAuctions.length > 0
        ? similarAuctions.map(a => `  • "${a.title}" — $${a.current_price} (${a.status}) [semantic:${a.semantic_score} lexical:${a.lexical_score}]`).join('\n')
        : '  No comparable active auctions found';
    return `Analyze this auction and provide actionable insights.

AUCTION:
  Title:          ${auction.title}
  Description:    ${auction.description ?? 'Not provided'}
  Starting Price: $${auction.startingPrice}
  Current Price:  $${auction.currentPrice}
  Reserve Price:  ${auction.reservePrice ? `$${auction.reservePrice}` : 'None (guaranteed sale)'}
  Status:         ${auction.status}
  Time Remaining: ${timeRemaining !== null ? `${timeRemaining} minutes` : 'Unknown'}
  Total Bids:     ${auction.bids.length}

BID HISTORY (most recent first, max 10):
${bidHistoryText}

COMPARABLE MARKET DATA (hybrid semantic + full-text search):
${marketContextText}

Provide analysis in exactly these four sections with bold headers:

**Bidding Momentum** — Analyse the bid pattern. Is activity accelerating or stalling?

**Market Positioning** — How does the current price compare to comparable items?

**Price Forecast** — What is the realistic final price range? Give specific numbers.

**Key Observations** — Flag reserve risk, sniping opportunity, or unusual patterns.

Keep each section to 2-3 sentences. Reference actual numbers.`;
}
//# sourceMappingURL=rag.js.map