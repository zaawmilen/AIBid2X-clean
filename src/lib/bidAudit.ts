import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { logger } from './logger.js';

export type BidOutcome =
  | 'accepted'
  | 'rejected_too_low'
  | 'rejected_ended'
  | 'rejected_own_auction'
  | 'rejected_not_active'
  | 'rejected_duplicate'
  | 'rejected_invalid_amount'
  | 'rejected_cas_failed'
  | 'error_internal';

export interface AuditEntry {
  auctionId:       string;
  bidderId:        string;
  amount:          string;       // always a string — Decimal.toFixed(2)
  outcome:         BidOutcome;
  rejectionReason?: string | undefined; 
  bidId?:          string | undefined;       
  correlationId?:  string | undefined;
}

/**
 * Write a bid_events row. Called both from inside a transaction (accepted bids)
 * and from the catch block (rejected bids). Uses the passed `client` so that
 * accepted-bid entries are written atomically with the bid insert — if the
 * transaction rolls back, the audit row rolls back too.
 *
 * For rejections we call this with the global `db` outside any transaction,
 * so the rejection is always persisted regardless of what failed.
 */
export async function writeBidAudit(
  entry: AuditEntry,
  client: typeof db = db,
): Promise<void> {
  try {
    await client.execute(sql`
      INSERT INTO bid_events
        (auction_id, bidder_id, amount, outcome, rejection_reason, bid_id, correlation_id)
      VALUES
        (${entry.auctionId}::uuid,
         ${entry.bidderId}::uuid,
         ${entry.amount}::numeric,
         ${entry.outcome},
         ${entry.rejectionReason ?? null},
         ${entry.bidId ?? null}::uuid,
         ${entry.correlationId ?? null})
    `);
  } catch (auditErr) {
    // Audit failures must never crash the main flow.
    // Log and continue — a missing audit row is better than a broken bid.
    logger.error(
      { err: auditErr, auctionId: entry.auctionId, outcome: entry.outcome },
      'bid_events write failed — audit gap',
    );
  }
}