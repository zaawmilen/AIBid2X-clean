/**
 * Seed Load-Test Fixtures
 * ─────────────────────────────────────────────────────────────────────────────
 * Creates 1 seller + 51 dedicated bidder accounts directly in the database
 * (bypassing /auth/register and authRateLimit entirely), then mints real JWT
 * access tokens using the same signAccessToken() the live API uses.
 *
 * Why 51 bidders:
 *   - 50 are used by bid_latency (one per VU — avoids exhausting any single
 *     user's globalUserBidRateLimit of 30 bids/60s when 50 VUs run concurrently)
 *   - 1 is reserved exclusively for rate_limiter, so its intentional burst
 *     traffic doesn't bleed into another scenario's rate-limit budget
 *
 * Output: src/tests/performance/fixtures.json
 *   { seller: {id,email,accessToken}, bidders: [{id,email,accessToken}, ...51] }
 *
 * Run:   npx tsx src/scripts/seed-loadtest-fixtures.ts
 *
 * Note: tokens expire per JWT_ACCESS_EXPIRES_IN (typically 15m).
 *       Re-run this script if k6 reports 401s due to expired tokens.
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { eq } from 'drizzle-orm';
import { db, closeDatabasePool } from '../../db/index.js';
import { users } from '../../db/schema.js';
import { hashPassword } from '../../lib/password.js';
import { signAccessToken } from '../../lib/jwt.js';

const PASSWORD = 'Test@1234';
const BIDDER_COUNT = 51; // 50 for bid_latency + 1 reserved for rate_limiter
const OUT_PATH = path.resolve('src/tests/performance/fixtures.json');

async function upsertUser(email: string, role: 'bidder' | 'seller', passwordHash: string) {
  const [existing] = await db.select().from(users).where(eq(users.email, email));
  if (existing) return existing;
  const [created] = await db.insert(users).values({ email, passwordHash, role }).returning();
  if (!created) throw new Error(`Failed to create user ${email}`);
  return created;
}

async function main() {
  console.log('Hashing shared test password (bcrypt cost=12, one-time)...');
  const passwordHash = await hashPassword(PASSWORD);

  console.log('Upserting seller...');
  const seller = await upsertUser('k6seller@aibid2x.com', 'seller', passwordHash);
  const sellerToken = signAccessToken({ sub: seller.id, email: seller.email, role: seller.role });

  console.log(`Upserting ${BIDDER_COUNT} dedicated bidders...`);
  const bidders: { id: string; email: string; accessToken: string }[] = [];
  for (let i = 1; i <= BIDDER_COUNT; i++) {
    const email = `k6loadtest.bidder${String(i).padStart(2, '0')}@aibid2x.com`;
    const user = await upsertUser(email, 'bidder', passwordHash);
    const accessToken = signAccessToken({ sub: user.id, email: user.email, role: user.role });
    bidders.push({ id: user.id, email: user.email, accessToken });
    if (i % 10 === 0 || i === BIDDER_COUNT) console.log(`  ${i}/${BIDDER_COUNT}`);
  }

  const fixtures = {
    generatedAt: new Date().toISOString(),
    note: 'bidders[0..49] = bid_latency pool (1 per VU). bidders[50] = reserved for rate_limiter.',
    seller: { id: seller.id, email: seller.email, accessToken: sellerToken },
    bidders,
  };

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(fixtures, null, 2));
  console.log(`\nWrote ${bidders.length} bidder fixtures + 1 seller to ${OUT_PATH}`);
  console.log('Tokens valid per JWT_ACCESS_EXPIRES_IN — re-run before each k6 session if expired.');

  await closeDatabasePool();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
