-- Ensure at most one 'winning' bid exists per auction
CREATE UNIQUE INDEX IF NOT EXISTS one_winner_per_auction
ON bids (auction_id)
WHERE status = 'winning';
