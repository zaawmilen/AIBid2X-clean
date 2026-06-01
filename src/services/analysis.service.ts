import { Pool } from 'pg';
import { env } from '../config/env.js';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { findSimilarAuctions, assembleAnalysisPrompt } from '../lib/rag.js';
import type { AuctionContext, AuctionBid } from '../lib/rag.js';
import { streamAnalysis, streamMockAnalysis } from '../lib/anthropic.js';

const pool = new Pool({ connectionString: env.DATABASE_URL, max: 3 });

async function fetchAuctionContext(auctionId: string): Promise<AuctionContext | null> {
  const auctionResult = await pool.query(
    `SELECT id, title, description, starting_price, current_price,
            reserve_price, status, end_time, embedding
     FROM auctions WHERE id = $1`,
    [auctionId],
  );
  if (auctionResult.rows.length === 0) return null;
  const row = auctionResult.rows[0];

  const bidsResult = await pool.query(
    `SELECT b.id, b.amount, b.created_at, u.email AS bidder_email
     FROM bids b JOIN users u ON u.id = b.bidder_id
     WHERE b.auction_id = $1 ORDER BY b.created_at DESC LIMIT 20`,
    [auctionId],
  );

  const bids: AuctionBid[] = bidsResult.rows.map((b) => ({
    id: b.id, amount: b.amount, createdAt: b.created_at, bidderEmail: b.bidder_email,
  }));

  let embedding: number[] | null = null;
  if (row.embedding) {
    try {
      const raw = typeof row.embedding === 'string' ? row.embedding : JSON.stringify(row.embedding);
      embedding = JSON.parse(raw);
    } catch { embedding = null; }
  }

  return {
    id: row.id, title: row.title, description: row.description,
    startingPrice: row.starting_price, currentPrice: row.current_price,
    reservePrice: row.reserve_price, status: row.status,
    endTime: row.end_time ? new Date(row.end_time) : null,
    embedding, bids,
  };
}

export async function streamAuctionAnalysis(
  auctionId: string,
  onText: (text: string) => void,
  onDone: (usage: { inputTokens: number; outputTokens: number }) => void,
): Promise<void> {
  const auction = await fetchAuctionContext(auctionId);
  if (!auction) throw AppError.notFound('Auction');

  logger.info({ auctionId, bidCount: auction.bids.length, hasEmbedding: !!auction.embedding }, 'Starting auction analysis');

  const searchText = [auction.title, auction.description].filter(Boolean).join(' ');
  const similarAuctions = await findSimilarAuctions(auctionId, searchText, auction.embedding, 5);

  logger.info({ auctionId, similarFound: similarAuctions.length }, 'RAG context assembled');

  const timeRemaining = auction.endTime
    ? Math.max(0, Math.floor((auction.endTime.getTime() - Date.now()) / 60_000))
    : null;

  if (env.ANTHROPIC_API_KEY) {
    const prompt = assembleAnalysisPrompt(auction, similarAuctions);
    await streamAnalysis(prompt, onText, onDone);
  } else {
    await streamMockAnalysis(
      auction.currentPrice, auction.startingPrice, auction.reservePrice,
      auction.bids.length, timeRemaining, similarAuctions.length,
      onText, onDone,
    );
  }
}
