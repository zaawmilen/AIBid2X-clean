import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { eq, sql } from 'drizzle-orm';
import bcrypt from 'bcrypt';
import { users, auctions, bids } from './schema.js';
import { env } from '../config/env.js';
import { embedText } from '../lib/openai.js';

const pool = new Pool({ connectionString: env.DATABASE_URL });
const db   = drizzle(pool);

// ── Helpers ────────────────────────────────────────────────────────────────────
const hash = (pw: string) => bcrypt.hash(pw, 12);

function future(hours: number): Date {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}
function past(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

// ── Auction catalogue ──────────────────────────────────────────────────────────
// Modelled on real Copart listings — mix of active, ended, and draft
const CATALOGUE = [
  // ── Active auctions (ending soon — recruiter can see live bidding)
  {
    title: '2019 Ford Mustang GT — Clean Title, 38k Miles',
    description: 'V8 5.0L Coyote engine, 6-speed manual, Magnetic Grey Metallic. Minor front bumper scuff. Runs and drives perfectly. All original miles. CARFAX available.',
    startingPrice: 18_000,
    reservePrice:  22_000,
    hoursRemaining: 2,
  },
  {
    title: '2021 Tesla Model 3 Long Range AWD — Salvage Title',
    description: 'Rear-end collision damage, airbags deployed. Autopilot hardware intact. Battery state of health 94%. Ideal for parts or rebuild. No keys.',
    startingPrice: 8_500,
    reservePrice:  null,
    hoursRemaining: 4,
  },
  {
    title: '2020 Toyota Tacoma TRD Off-Road — Flood Damage',
    description: 'Water intrusion up to dash level. Engine seized. Frame and body in excellent condition. 4x4 drivetrain intact. Great parts donor or ambitious rebuild project.',
    startingPrice: 6_000,
    reservePrice:  9_000,
    hoursRemaining: 6,
  },
  {
    title: '2018 BMW M3 Competition — Rebuilt Title, 61k Miles',
    description: 'S55 twin-turbo inline-6, DCT transmission. Previous front collision, professionally repaired. Clean alignment. Brakes and tires new. MSport suspension.',
    startingPrice: 28_000,
    reservePrice:  34_000,
    hoursRemaining: 8,
  },
  {
    title: '2022 Chevrolet Silverado 1500 LTZ — Hail Damage',
    description: '5.3L EcoTec3 V8, 4WD. Cosmetic hail damage only — no structural damage, no glass broken. Z71 package, trailer tow package. 14k miles.',
    startingPrice: 24_000,
    reservePrice:  28_000,
    hoursRemaining: 12,
  },
  {
    title: '2017 Porsche 911 Carrera S — Side Impact Damage',
    description: 'Passenger side structural damage. PDK transmission, sport exhaust. Engine bay undamaged. Certificate of title available. 43k miles.',
    startingPrice: 35_000,
    reservePrice:  null,
    hoursRemaining: 24,
  },
  {
    title: '2023 Honda Civic Type R — Clean Title, 8k Miles',
    description: 'Championship White, 6-speed manual. Factory warranty remaining. Minor wheel curb rash only. Full service history. No accidents.',
    startingPrice: 32_000,
    reservePrice:  36_000,
    hoursRemaining: 48,
  },
  {
    title: '2016 Jeep Wrangler Unlimited Rubicon — Rollover',
    description: 'Body damage on all sides. Frame checked straight. 3.6L Pentastar V6, 6-speed manual. Dana 44 axles intact. Excellent parts vehicle.',
    startingPrice: 7_000,
    reservePrice:  null,
    hoursRemaining: 72,
  },

  // ── Ended auctions (show historical data)
  {
    title: '2015 Subaru WRX STI — Rear Collision',
    description: 'EJ257 boxer engine, 6-speed manual. Rear quarter panel damage. Engine and transmission undamaged. 78k miles.',
    startingPrice: 9_000,
    reservePrice:  12_000,
    hoursRemaining: -24, // ended
  },
  {
    title: '2019 RAM 1500 Limited — Fire Damage',
    description: 'Engine bay fire. Cab interior intact. 5.7L HEMI V8. Frame undamaged. Airbags not deployed.',
    startingPrice: 4_000,
    reservePrice:  null,
    hoursRemaining: -48, // ended
  },
];

// ── Bid war scenarios ──────────────────────────────────────────────────────────
// Each entry maps auction index → array of (bidderIndex, amount) tuples
// Simulates realistic competitive bidding
const BID_WARS: Record<number, Array<[number, number]>> = {
  0: [ // Mustang — tight competition
    [0, 18_500], [1, 19_000], [0, 19_800], [2, 20_500],
    [1, 21_000], [0, 21_500], [2, 22_000], [1, 22_800],
  ],
  1: [ // Tesla — quick escalation
    [1, 9_000], [2, 9_500], [3, 10_200], [1, 11_000],
  ],
  2: [ // Tacoma — steady climb
    [0, 6_500], [3, 7_000], [2, 7_800], [0, 8_500],
  ],
  3: [ // BMW M3 — high value war
    [2, 29_000], [3, 30_500], [1, 31_000], [2, 32_500],
    [3, 33_000], [1, 34_500],
  ],
  4: [ // Silverado — competitive
    [0, 25_000], [1, 25_800], [3, 26_500], [0, 27_200],
  ],
  8: [ // Ended WRX
    [0, 9_500], [1, 10_200], [2, 11_000], [3, 11_800], [0, 12_500],
  ],
  9: [ // Ended RAM
    [1, 4_500], [2, 5_000], [0, 5_800],
  ],
};

async function seed() {
  console.log('🌱 Starting seed...\n');

  // ── 1. Clean slate ─────────────────────────────────────────────────────────
  console.log('🧹 Clearing existing seed data...');
  await db.execute(sql`
    DELETE FROM bids      WHERE bidder_id  IN (SELECT id FROM users WHERE email LIKE '%@aibid2x.demo');
    DELETE FROM auctions  WHERE seller_id  IN (SELECT id FROM users WHERE email LIKE '%@aibid2x.demo');
    DELETE FROM users     WHERE email LIKE '%@aibid2x.demo';
  `);

  // ── 2. Users ───────────────────────────────────────────────────────────────
  console.log('👤 Creating users...');
  const password = await hash('Demo1234!');

  const [seller] = await db.insert(users).values({
    email:        'seller@aibid2x.demo',
    passwordHash: password,
    role:         'seller',
  }).returning();

  const bidderRows = await db.insert(users).values([
    { email: 'alice@aibid2x.demo',   passwordHash: password, role: 'bidder' },
    { email: 'bob@aibid2x.demo',     passwordHash: password, role: 'bidder' },
    { email: 'charlie@aibid2x.demo', passwordHash: password, role: 'bidder' },
    { email: 'diana@aibid2x.demo',   passwordHash: password, role: 'bidder' },
  ]).returning();

  console.log(`   ✓ seller@aibid2x.demo`);
  bidderRows.forEach(b => console.log(`   ✓ ${b.email}`));

  // ── 3. Auctions ────────────────────────────────────────────────────────────
  console.log('\n🏷️  Creating auctions + embeddings...');
  const auctionRows: (typeof auctions.$inferSelect)[] = [];

  for (let i = 0; i < CATALOGUE.length; i++) {
    const item    = CATALOGUE[i]!;
    const ended   = item.hoursRemaining < 0;
    const endTime = ended ? past(Math.abs(item.hoursRemaining)) : future(item.hoursRemaining);

    // Generate embedding for AI search
    let embedding: number[] | null = null;
    try {
      embedding = await embedText(`${item.title} ${item.description}`, {});
      process.stdout.write('.');
    } catch {
      process.stdout.write('x');
    }

    const [auction] = await db.insert(auctions).values({
      title:         item.title,
      description:   item.description,
      sellerId:      seller!.id,
      startingPrice: item.startingPrice.toFixed(2),
      reservePrice:  item.reservePrice?.toFixed(2) ?? null,
      currentPrice:  item.startingPrice.toFixed(2),
      status:        ended ? 'ended' : 'active',
      startTime:     past(72),
      endTime,
      embedding,
    }).returning();

    auctionRows.push(auction!);
    console.log(`\n   ✓ [${ended ? 'ended' : 'active'}] ${item.title.slice(0, 55)}...`);
  }

  // ── 4. Bids ────────────────────────────────────────────────────────────────
  console.log('\n💰 Simulating bid wars...');
  const bidderIds = bidderRows.map(b => b.id);

  for (const [auctionIdx, bidSequence] of Object.entries(BID_WARS)) {
    const auction = auctionRows[Number(auctionIdx)];
    if (!auction) continue;

    let highestAmount = 0;
    const insertedBidIds: string[] = [];

    for (const [bidderIdx, amount] of bidSequence) {
      const bidderId = bidderIds[bidderIdx]!;
      const isLast   = amount === Math.max(...bidSequence.map(([, a]) => a));

      const [bid] = await db.insert(bids).values({
        auctionId: auction.id,
        bidderId,
        amount:    amount.toFixed(2),
        status:    'outbid', // will fix the winner below
      }).returning();

      insertedBidIds.push(bid!.id);
      if (amount > highestAmount) highestAmount = amount;
    }

    // Mark the highest bid as winning (or won for ended auctions)
    const winningStatus = auction.status === 'ended' ? 'won' : 'winning';
    const winningAmount = Math.max(...bidSequence.map(([, a]) => a));

    await db.execute(sql`
      UPDATE bids
      SET status = ${winningStatus}
      WHERE id = (
        SELECT id FROM bids
        WHERE auction_id = ${auction.id}
          AND amount = ${winningAmount.toFixed(2)}
          AND status = 'outbid'
        ORDER BY created_at DESC
        LIMIT 1
      )
    `);

    // Update auction current price
    await db.update(auctions)
      .set({ currentPrice: highestAmount.toFixed(2), updatedAt: new Date() })
      .where(eq(auctions.id, auction.id));

    console.log(`   ✓ ${auction.title.slice(0, 45)}... → $${highestAmount.toLocaleString()} (${bidSequence.length} bids)`);
  }

  // ── 5. Summary ────────────────────────────────────────────────────────────
  const activeCount = auctionRows.filter(a => a.status === 'active').length;
  const endedCount  = auctionRows.filter(a => a.status === 'ended').length;
  const totalBids   = Object.values(BID_WARS).reduce((sum, b) => sum + b.length, 0);

  console.log(`
✅ Seed complete!

   Users     : 1 seller + 4 bidders (password: Demo1234!)
   Auctions  : ${activeCount} active, ${endedCount} ended
   Bids      : ${totalBids} across ${Object.keys(BID_WARS).length} auctions

   Demo credentials:
   ┌─────────────────────────────┬──────────────┬──────────┐
   │ Email                       │ Role         │ Password │
   ├─────────────────────────────┼──────────────┼──────────┤
   │ seller@aibid2x.demo         │ seller       │ Demo1234!│
   │ alice@aibid2x.demo          │ bidder       │ Demo1234!│
   │ bob@aibid2x.demo            │ bidder       │ Demo1234!│
   │ charlie@aibid2x.demo        │ bidder       │ Demo1234!│
   │ diana@aibid2x.demo          │ bidder       │ Demo1234!│
   └─────────────────────────────┴──────────────┴──────────┘

   Try it: https://aibid2x-clean.fly.dev/api/v1/docs
  `);

  await pool.end();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  pool.end();
  process.exit(1);
});