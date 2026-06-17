CREATE TABLE IF NOT EXISTS bid_events (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_id       UUID          NOT NULL,
  bidder_id        UUID          NOT NULL,
  amount           NUMERIC(12,2) NOT NULL,
  outcome          TEXT          NOT NULL,
  rejection_reason TEXT          NULL,
  bid_id           UUID          NULL,
  correlation_id   TEXT          NULL,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bid_events_auction_id_created_at
  ON bid_events (auction_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bid_events_bidder_id
  ON bid_events (bidder_id);

CREATE INDEX IF NOT EXISTS idx_bid_events_accepted
  ON bid_events (auction_id, created_at DESC)
  WHERE outcome = 'accepted';

COMMENT ON TABLE bid_events IS
  'Append-only audit log of every bid attempt. Never updated or deleted.';
COMMENT ON COLUMN bid_events.outcome IS
  'accepted | rejected_too_low | rejected_ended | rejected_own_auction |
   rejected_not_active | rejected_duplicate | rejected_invalid_amount |
   rejected_cas_failed | error_internal';