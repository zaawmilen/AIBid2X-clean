import { customType, index, numeric, pgEnum, pgTable, text, timestamp, uuid, varchar, } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
// ── pgvector custom type ───────────────────────────────────────────────────
// Drizzle doesn't ship a native vector column yet, so we define one.
// The vector column is nullable — it's populated by the embedding pipeline
// in Month 2. Defining it now avoids a breaking ALTER TABLE migration later.
const vector = (name, dimensions) => customType({
    dataType() {
        return `vector(${dimensions})`;
    },
    toDriver(value) {
        // pgvector expects the format [0.1,0.2,...] — not JSON-encoded
        return `[${value.join(',')}]`;
    },
    fromDriver(value) {
        return value
            .slice(1, -1)
            .split(',')
            .map(Number);
    },
})(name);
// ── Enums ──────────────────────────────────────────────────────────────────
// Postgres enums are faster than varchar for status columns and enforce
// valid values at the DB layer — not just in application code.
export const userRoleEnum = pgEnum('user_role', ['bidder', 'seller', 'admin']);
export const auctionStatusEnum = pgEnum('auction_status', [
    'draft', // created, not yet live
    'active', // accepting bids
    'ended', // past end_time, winner determined
    'cancelled',
]);
export const bidStatusEnum = pgEnum('bid_status', [
    'active', // current highest bid
    'outbid', // superseded by a higher bid
    'winning', // still highest as auction nears end
    'won', // final winner
    'invalid', // rejected (duplicate, below reserve, etc.)
]);
// ── Tables ────────────────────────────────────────────────────────────────
export const users = pgTable('users', {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 255 }).notNull().unique(),
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    role: userRoleEnum('role').notNull().default('bidder'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
export const auctions = pgTable('auctions', {
    id: uuid('id').primaryKey().defaultRandom(),
    title: varchar('title', { length: 500 }).notNull(),
    description: text('description'),
    sellerId: uuid('seller_id')
        .notNull()
        .references(() => users.id, { onDelete: 'restrict' }),
    // Price fields stored as numeric (not float) to avoid rounding errors
    startingPrice: numeric('starting_price', { precision: 12, scale: 2 }).notNull(),
    // reservePrice: hidden minimum — null means no reserve
    reservePrice: numeric('reserve_price', { precision: 12, scale: 2 }),
    // currentPrice mirrors the highest bid amount; initialised to startingPrice
    currentPrice: numeric('current_price', { precision: 12, scale: 2 }).notNull(),
    status: auctionStatusEnum('status').notNull().default('draft'),
    startTime: timestamp('start_time'),
    endTime: timestamp('end_time'),
    // AI embedding vector — populated by background job once text is available.
    // 1536 dimensions = OpenAI text-embedding-3-small output size.
    // Set to null until the embedding pipeline processes this row.
    embedding: vector('embedding', 1536),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
    // Index every column that appears in WHERE clauses or JOINs
    sellerIdx: index('auctions_seller_id_idx').on(t.sellerId),
    statusIdx: index('auctions_status_idx').on(t.status),
    // Compound index for "find active auctions ending soon" queries
    statusEndTimeIdx: index('auctions_status_end_time_idx').on(t.status, t.endTime),
    // The vector index (hnsw) is created in migration after pgvector is enabled
    // See: 0002_add_embedding_hnsw_index.sql (Month 2 migration)
}));
export const bids = pgTable('bids', {
    id: uuid('id').primaryKey().defaultRandom(),
    auctionId: uuid('auction_id')
        .notNull()
        .references(() => auctions.id, { onDelete: 'cascade' }),
    bidderId: uuid('bidder_id')
        .notNull()
        .references(() => users.id, { onDelete: 'restrict' }),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    status: bidStatusEnum('status').notNull().default('active'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
    auctionIdx: index('bids_auction_id_idx').on(t.auctionId),
    bidderIdx: index('bids_bidder_id_idx').on(t.bidderId),
    // Used by "find highest bid for an auction" query — the most frequent read
    auctionAmountIdx: index('bids_auction_amount_idx').on(t.auctionId, t.amount),
}));
// ── Relations (for Drizzle query API joins) ───────────────────────────────
export const usersRelations = relations(users, ({ many }) => ({
    auctions: many(auctions),
    bids: many(bids),
}));
export const auctionsRelations = relations(auctions, ({ one, many }) => ({
    seller: one(users, { fields: [auctions.sellerId], references: [users.id] }),
    bids: many(bids),
}));
export const bidsRelations = relations(bids, ({ one }) => ({
    auction: one(auctions, { fields: [bids.auctionId], references: [auctions.id] }),
    bidder: one(users, { fields: [bids.bidderId], references: [users.id] }),
}));
//# sourceMappingURL=schema.js.map