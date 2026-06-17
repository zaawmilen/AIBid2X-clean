/**
 * AIBid2X — k6 Performance Test Suite (v2)
 * ─────────────────────────────────────────────────────────────────────────────
 * Scenarios:
 *   1. bid_latency      — bid placement latency under 50 concurrent dedicated bidders
 *   2. concurrent_bids  — deterministic winner selection under simultaneous contention
 *   3. rate_limiter     — sliding-window rate limiter behaviour under burst traffic
 *   4. cursor_pagination — keyset pagination benchmarked across a deep result set
 *
 * Prerequisite:
 *   npx tsx src/scripts/seed-loadtest-fixtures.ts
 *   (generates ./fixtures.json — 1 seller + 51 dedicated bidder accounts/tokens)
 *
 * Run all:   k6 run k6-aibid2x.js
 * Run one:   k6 run --env SCENARIO=bid_latency k6-aibid2x.js
 *
 * ── Design notes vs v1 ──────────────────────────────────────────────────────
 * v1 shared 3 bidder accounts across 50 VUs. With globalUserBidRateLimit =
 * 30 bids/60s per user, 50 VUs sharing 3 accounts exhausted each account's
 * budget almost instantly — ~97% of "bid_latency" traffic became 429s, and
 * the reported P95 was effectively measuring rate-limit rejection latency,
 * not bid placement latency.
 *
 * v2 gives each VU its own dedicated user (50 distinct accounts) and paces
 * requests at ~1 every 2.5-3.5s per VU (~0.3-0.4 req/s) — comfortably under
 * the 0.5 req/s (30/60s) global limit. This models 50 distinct bidders each
 * bidding at a realistic human cadence during a bid war, while the SEPARATE
 * rate_limiter scenario (using a 51st, unshared account) explicitly tests
 * burst/abuse behaviour. Latency is now split into `placed` (201) vs
 * `rejected` (400/429) so each has its own clean, defensible P95.
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000/api/v1';
const SCENARIO = __ENV.SCENARIO || 'all';

// Pre-minted fixtures — see seed-loadtest-fixtures.ts
const fixtures = JSON.parse(open('./fixtures.json'));
const SELLER         = fixtures.seller;
const BIDDER_POOL    = fixtures.bidders.slice(0, 50);  // 1 per bid_latency VU
const RATE_LIMIT_USER = fixtures.bidders[50];           // reserved, unshared

// ── Custom metrics ────────────────────────────────────────────────────────────

const bidLatencyPlaced   = new Trend('bid_latency_placed_ms',   true);
const bidLatencyRejected = new Trend('bid_latency_rejected_ms', true);
const bidServerErrors    = new Counter('bid_server_errors_5xx');

const concurrentWinners      = new Counter('concurrent_winners');
const concurrentServerErrors = new Counter('concurrent_server_errors_5xx');

const rateLimit429s    = new Counter('rate_limiter_429s');
const rateLimiterFails = new Counter('rate_limiter_unexpected');

const paginationLatency = new Trend('pagination_latency_ms', true);
const paginationErrors  = new Counter('pagination_errors');

// ── Scenario definitions ──────────────────────────────────────────────────────

const SCENARIOS = {

  bid_latency: {
    executor:        'ramping-vus',
    startVUs:        0,
    stages: [
      { duration: '30s', target: 50 },
      { duration: '60s', target: 50 },
      { duration: '15s', target: 0  },
    ],
    gracefulRampDown: '5s',
    exec:             'bidLatencyScenario',
    tags:             { scenario: 'bid_latency' },
  },

  concurrent_bids: {
    executor:    'shared-iterations',
    vus:         20,
    iterations:  60,
    maxDuration: '30s',
    exec:        'concurrentBidsScenario',
    tags:        { scenario: 'concurrent_bids' },
  },

  rate_limiter: {
    executor:         'constant-arrival-rate',
    rate:             30,
    timeUnit:         '1s',
    duration:         '30s',
    preAllocatedVUs:  20,
    maxVUs:           40,
    exec:             'rateLimiterScenario',
    tags:             { scenario: 'rate_limiter' },
  },

  cursor_pagination: {
    executor: 'constant-vus',
    vus:      10,
    duration: '45s',
    exec:     'cursorPaginationScenario',
    tags:     { scenario: 'cursor_pagination' },
  },
};

export const options = {
  scenarios: SCENARIO === 'all'
    ? SCENARIOS
    : { [SCENARIO]: SCENARIOS[SCENARIO] },

  thresholds: {
    // Primary metric of interest — actual DB-write bid placements.
    // Loose bound: this is investigative. If it fails, DB_POOL_MAX (currently
    // 25) under 50 concurrent VUs is the leading hypothesis to tune next.
    'bid_latency_placed_ms':     ['p(95)<2000'],

    // The numeric(12,2) overflow bug (fixed via Zod .max()) must not
    // regress — any 5xx here is a real defect, zero tolerance.
    'bid_server_errors_5xx':     ['count==0'],

    // Core correctness invariant: SELECT FOR UPDATE must yield exactly
    // one winner under simultaneous identical-amount contention.
    'concurrent_winners':        ['count==1'],

    // Rate limiter must demonstrably fire under sustained burst.
    'rate_limiter_429s':          ['count>20'],
    'rate_limiter_unexpected':    ['count==0'],

    // Keyset pagination should stay fast at depth.
    'pagination_latency_ms{scenario:cursor_pagination}': ['p(95)<200'],
    'pagination_errors':          ['count==0'],
  },
};

// ── setup() — runs once, creates fresh auctions using pre-minted seller token ──
// No HTTP login here — sellerToken comes from fixtures.json (bcrypt already
// paid during seeding), so setup() only measures auction-creation endpoints.

export function setup() {
  const authHeaders = {
    'Content-Type':  'application/json',
    'Authorization': `Bearer ${SELLER.accessToken}`,
  };

  // ── 5 dedicated auctions for bid_latency, fixed known startingPrice ─────────
  const auctionIds = [];
  for (let i = 1; i <= 5; i++) {
    const createRes = http.post(
      `${BASE_URL}/auctions`,
      JSON.stringify({
        title:         `k6 Load Test Auction ${i}`,
        startingPrice: 1000,
        endTime:       '2027-12-31T23:59:59.000Z',
      }),
      { headers: authHeaders },
    );
    const id = createRes.json('auction.id');
    if (!id) throw new Error(`Failed to create bid_latency auction ${i}: ${createRes.body}`);

    const activateRes = http.patch(`${BASE_URL}/auctions/${id}/activate`, null, { headers: authHeaders });
    if (activateRes.status !== 200) throw new Error(`Failed to activate auction ${i}: ${activateRes.body}`);

    auctionIds.push(id);
  }

  // ── 1 dedicated auction for concurrent_bids ──────────────────────────────────
  const concCreate = http.post(
    `${BASE_URL}/auctions`,
    JSON.stringify({
      title:         'k6 Concurrent Bids Auction',
      startingPrice: 100,
      endTime:       '2027-12-31T23:59:59.000Z',
    }),
    { headers: authHeaders },
  );
  const concurrentAuctionId = concCreate.json('auction.id');
  if (!concurrentAuctionId) throw new Error(`Failed to create concurrent auction: ${concCreate.body}`);

  const concActivate = http.patch(`${BASE_URL}/auctions/${concurrentAuctionId}/activate`, null, { headers: authHeaders });
  if (concActivate.status !== 200) throw new Error(`Failed to activate concurrent auction: ${concActivate.body}`);

  // ── 1 dedicated auction for rate_limiter ─────────────────────────────────────
  const rlCreate = http.post(
    `${BASE_URL}/auctions`,
    JSON.stringify({
      title:         'k6 Rate Limiter Auction',
      startingPrice: 100,
      endTime:       '2027-12-31T23:59:59.000Z',
    }),
    { headers: authHeaders },
  );
  const rateLimiterAuctionId = rlCreate.json('auction.id');
  if (!rateLimiterAuctionId) throw new Error(`Failed to create rate limiter auction: ${rlCreate.body}`);

  const rlActivate = http.patch(`${BASE_URL}/auctions/${rateLimiterAuctionId}/activate`, null, { headers: authHeaders });
  if (rlActivate.status !== 200) throw new Error(`Failed to activate rate limiter auction: ${rlActivate.body}`);

  console.log(
    `Setup complete — ${auctionIds.length} bid_latency auctions, ` +
    `concurrent auction: ${concurrentAuctionId}, rate_limiter auction: ${rateLimiterAuctionId}`,
  );

  return { auctionIds, concurrentAuctionId, rateLimiterAuctionId };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function authHeaders(token) {
  return {
    'Content-Type':  'application/json',
    'Authorization': `Bearer ${token}`,
  };
}

// ── Scenario 1: Bid Latency (per-VU dedicated user) ───────────────────────────
//
// Each VU owns exactly one bidder account for the entire run (BIDDER_POOL[VU-1])
// and one of 5 auctions ((VU-1) % 5). Amounts use a per-VU "lane"
// (1000 + VU*100,000 + iteration*100) so each VU's bids are monotonically
// increasing — across the ~42 iterations a 105s run produces per VU, lanes
// stay well within numeric(12,2) bounds (max lane ≈ 5,004,200).
//
// 10 VUs share each auction, so within an auction the VU with the
// highest-numbered lane will dominate (win) while lower-lane VUs receive
// BID_TOO_LOW for the remainder of the run — a realistic "priced out" bidder
// pattern. ~0.3 req/s per VU keeps every user under the 30/60s global limit.

let bidIteration = 0;

export function bidLatencyScenario(data) {
  const bidder    = BIDDER_POOL[(__VU - 1) % BIDDER_POOL.length];
  const auctionId = data.auctionIds[(__VU - 1) % data.auctionIds.length];

  bidIteration++;
  const amount = 1000 + __VU * 100_000 + bidIteration * 100;

  const start = Date.now();
  const res = http.post(
    `${BASE_URL}/auctions/${auctionId}/bids`,
    JSON.stringify({ amount }),
    { headers: authHeaders(bidder.accessToken), tags: { name: 'place_bid' } },
  );
  const latency = Date.now() - start;

  if (res.status === 201) {
    bidLatencyPlaced.add(latency);
    check(res.json(), {
      'bid: has id':          (b) => !!b.bid?.id,
      'bid: status is valid': (b) => ['active', 'outbid', 'winning'].includes(b.bid?.status),
    });
  } else if (res.status === 400 || res.status === 429) {
    bidLatencyRejected.add(latency);
  } else if (res.status >= 500) {
    bidServerErrors.add(1);
  }

  check(res, {
    'bid: status is 201, 400, or 429': (r) => [201, 400, 429].includes(r.status),
    'bid: has JSON body': (r) => (r.headers['Content-Type'] || '').includes('application/json'),
  });

  // ~0.3 req/s per VU — well under the 0.5 req/s (30/60s) global bid limit
  sleep(2.5 + Math.random());
}

// ── Scenario 2: Concurrent Bids — Winner Determinism ─────────────────────────
// 20 VUs hammer the SAME dedicated auction with the SAME amount simultaneously.
// Exactly one should win (201); the rest get BID_TOO_LOW (400).
// Amount (1e9) is well under the numeric(12,2) ceiling (~9.999e9).

export function concurrentBidsScenario(data) {
  const bidder    = BIDDER_POOL[__VU % BIDDER_POOL.length];
  const auctionId = data.concurrentAuctionId;
  const amount    = 1_000_000_000;

  const res = http.post(
    `${BASE_URL}/auctions/${auctionId}/bids`,
    JSON.stringify({ amount }),
    { headers: authHeaders(bidder.accessToken), tags: { name: 'concurrent_bid' } },
  );

  if (res.status === 201) concurrentWinners.add(1);
  if (res.status >= 500)  concurrentServerErrors.add(1);

  check(res, {
    'concurrent: 201, 400, or 429': (r) => [201, 400, 429].includes(r.status),
  });
}

// ── Scenario 3: Rate Limiter Burst ───────────────────────────────────────────
// 30 req/s from a single RESERVED user (not used by any other scenario)
// against a dedicated auction. Per-user bidRateLimit = 10/60s and
// globalUserBidRateLimit = 30/60s → 429s should fire within the first second.

export function rateLimiterScenario(data) {
  const auctionId = data.rateLimiterAuctionId;
  const amount    = 1000 + Math.floor(Math.random() * 1000); // small, valid range

  const res = http.post(
    `${BASE_URL}/auctions/${auctionId}/bids`,
    JSON.stringify({ amount }),
    { headers: authHeaders(RATE_LIMIT_USER.accessToken), tags: { name: 'rate_limit_burst' } },
  );

  if (res.status === 429) {
    rateLimit429s.add(1);
    check(res, {
      'rate: structured error on 429': (r) => r.json('error.code') === 'RATE_LIMIT_EXCEEDED',
      'rate: Retry-After on 429':      (r) => r.headers['Retry-After'] !== undefined,
    });
  } else if (![201, 400].includes(res.status)) {
    rateLimiterFails.add(1);
  }
}

// ── Scenario 4: Cursor Pagination Depth ──────────────────────────────────────
// Walks up to 10 pages using nextCursor from each response. Public endpoint —
// no auth dependency. Unchanged from v1 (this scenario's logic was already
// confirmed correct via manual verification).

export function cursorPaginationScenario() {
  const LIMIT     = 10;
  const MAX_PAGES = 10;
  let cursor      = null;
  let page        = 0;

  while (page < MAX_PAGES) {
    const url = cursor
      ? `${BASE_URL}/auctions?status=active&limit=${LIMIT}&cursor=${cursor}`
      : `${BASE_URL}/auctions?status=active&limit=${LIMIT}`;

    const start   = Date.now();
    const res     = http.get(url, { tags: { name: `pagination_page_${page + 1}` } });
    const latency = Date.now() - start;
    paginationLatency.add(latency);

    const ok = check(res, {
      'pagination: status 200':         (r) => r.status === 200,
      'pagination: has auctions array': (r) => Array.isArray(r.json('auctions')),
      'pagination: has pagination obj': (r) => !!r.json('pagination'),
    });

    if (!ok) paginationErrors.add(1);
    if (res.status !== 200) break;

    const pagination = res.json('pagination');
    cursor = (pagination && pagination.nextCursor) ? pagination.nextCursor : null;
    page++;
    if (!cursor) break;

    sleep(0.1);
  }

  sleep(0.5);
}

// ── Default export ────────────────────────────────────────────────────────────

export default function (data) {
  bidLatencyScenario(data);
}
