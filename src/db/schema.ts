import {
  customType, index, numeric, pgEnum, pgTable,
  text, timestamp, uuid, varchar,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

const vector = (name: string, dimensions: number) =>
  customType<{ data: number[]; driverData: string }>({
    dataType() { return `vector(${dimensions})`; },
    toDriver(value: number[]) { return `[${value.join(',')}]`; },
    fromDriver(value: string) { return value.slice(1, -1).split(',').map(Number); },
  })(name);

export const userRoleEnum = pgEnum('user_role', ['bidder', 'seller', 'admin']);
export const auctionStatusEnum = pgEnum('auction_status', ['draft', 'active', 'ended', 'cancelled']);
export const bidStatusEnum = pgEnum('bid_status', ['active', 'outbid', 'winning', 'won', 'invalid']);

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
  sellerId: uuid('seller_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  startingPrice: numeric('starting_price', { precision: 12, scale: 2 }).notNull(),
  reservePrice: numeric('reserve_price', { precision: 12, scale: 2 }),
  currentPrice: numeric('current_price', { precision: 12, scale: 2 }).notNull(),
  status: auctionStatusEnum('status').notNull().default('draft'),
  startTime: timestamp('start_time'),
  endTime: timestamp('end_time'),
  embedding: vector('embedding', 1536),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  sellerIdx: index('auctions_seller_id_idx').on(t.sellerId),
  statusIdx: index('auctions_status_idx').on(t.status),
  statusEndTimeIdx: index('auctions_status_end_time_idx').on(t.status, t.endTime),
}));

export const bids = pgTable('bids', {
  id: uuid('id').primaryKey().defaultRandom(),
  auctionId: uuid('auction_id').notNull().references(() => auctions.id, { onDelete: 'cascade' }),
  bidderId: uuid('bidder_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  status: bidStatusEnum('status').notNull().default('active'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  auctionIdx: index('bids_auction_id_idx').on(t.auctionId),
  bidderIdx: index('bids_bidder_id_idx').on(t.bidderId),
  auctionAmountIdx: index('bids_auction_amount_idx').on(t.auctionId, t.amount),
}));

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

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Auction = typeof auctions.$inferSelect;
export type NewAuction = typeof auctions.$inferInsert;
export type Bid = typeof bids.$inferSelect;
export type NewBid = typeof bids.$inferInsert;
