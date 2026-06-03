DO $$ BEGIN
 CREATE EXTENSION IF NOT EXISTS pgcrypto;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "bid_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "idempotency_key" text UNIQUE NOT NULL,
  "requester_id" uuid NOT NULL,
  "auction_id" uuid NOT NULL,
  "request_payload" jsonb NOT NULL,
  "response_payload" jsonb,
  "status" text NOT NULL DEFAULT 'pending', -- pending | completed | failed
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "bid_requests" ADD CONSTRAINT "bid_requests_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "bid_requests" ADD CONSTRAINT "bid_requests_auction_id_auctions_id_fk" FOREIGN KEY ("auction_id") REFERENCES "public"."auctions"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "bid_requests_idempotency_key_idx" ON "bid_requests" USING btree ("idempotency_key");
--> statement-breakpoint
