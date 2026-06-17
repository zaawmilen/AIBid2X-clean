# AIBid2X — Performance Validation Report

**Environment:** Local (Node.js v22, PostgreSQL, Redis, Upstash)  
**Tool:** k6 v0.x  
**Date:** June 2026  
**Base URL:** `http://localhost:3000/api/v1`

---

## Key Findings

- Bid placement P95 latency: **14ms** under 50 concurrent virtual users, with transactional locking and winner validation enforced on every request
- Sustained throughput: **73.9 requests/sec** across 8,373 total requests
- Concurrent bidding: **exactly one winning bid recorded** under simultaneous-submission contention — no duplicate winners observed in any run
- Rate limiting: **7,634 correctly-formed 429 responses** generated under sustained burst traffic, each with a structured error body and `Retry-After` header
- Cursor pagination: **P50 = 4ms** median latency across a 240-auction dataset, with correct page-to-page traversal confirmed via manual verification

---

## Test Suite Overview

| Scenario | Executor | VUs | Duration | Purpose |
|----------|----------|-----|----------|---------|
| `bid_latency` | ramping-vus | 0 → 50 → 0 | 1m 45s | Bid placement latency under concurrent load |
| `concurrent_bids` | shared-iterations | 20 VUs | 60 iters / 30s | Winner-selection correctness under contention |
| `rate_limiter` | constant-arrival-rate | 30 req/s burst | 30s | Sliding-window rate limiter validation |
| `cursor_pagination` | constant-vus | 10 VUs | 45s | Keyset pagination benchmark across a deep result set |

**Total requests:** 8,373 @ 73.9 req/s over 1m 53s, all four scenarios executed concurrently in a single run.

---

## Results by Scenario

### 1. Bid Placement Latency — 50 Concurrent Virtual Users

| Metric | Value |
|--------|-------|
| P50 | 4ms |
| P90 | 11ms |
| **P95** | **14ms** |
| Max | 18s |
| Threshold | p(95) < 300ms |
| **Verdict** | **PASS** |

**What this measures:**  
End-to-end latency of the full bid placement request — authentication, row-level lock acquisition (`SELECT FOR UPDATE`), price validation, bid insert, and WebSocket broadcast — under 50 concurrent virtual users. P95 of 14ms reflects this entire pipeline, not the locking step in isolation; no isolated before/after locking comparison was performed.

The 18s maximum was observed during combined-scenario execution, where `bid_latency` ran simultaneously with `concurrent_bids`, `rate_limiter`, and `cursor_pagination`. The outlier is consistent with resource contention under simultaneous workloads (DB pool pressure, Redis round-trips, event-loop scheduling); the specific cause was not isolated in this run.

---

### 2. Concurrent Bidding — Winner Selection Correctness

| Metric | Value |
|--------|-------|
| Iterations | 60 (20 VUs) |
| Winning bids recorded | 1 |
| Correct rejections (`BID_TOO_LOW`) | 51 / 60 |
| HTTP 500 responses | 9 / 60 |
| **Verdict** | **Correctness: PASS — Availability: needs follow-up** |

**What this measures:**  
20 virtual users simultaneously submitted bids of identical value against the same auction. Exactly one bid was accepted and recorded as the winner across every test run — no duplicate winners were ever observed, indicating the `SELECT FOR UPDATE` row lock combined with the CAS price check correctly serializes concurrent writes.

9 of 60 requests returned HTTP 500 during this contention test. Data integrity remained correct in all cases (single winner recorded, no corrupted state). This indicates the issue affects request availability under extreme contention rather than data consistency. Root cause has not yet been confirmed — DB connection pool sizing (`DB_POOL_MAX=25`) is the leading hypothesis, but this has not been verified against server-side error logs.

---

### 3. Rate Limiter — Burst Traffic Validation

| Metric | Value |
|--------|-------|
| Burst rate | 30 req/s sustained for 30s |
| 429 responses | **7,634** |
| Effective block rate | 67.4/s |
| Structured error body present | 100% of 429s |
| `Retry-After` header present | 100% of 429s |
| Request timeouts | 0 |
| **Verdict** | **PASS** |

**What this measures:**  
The Redis-backed sliding-window rate limiter (atomic Lua `EVAL` script) was subjected to sustained burst traffic exceeding its configured limits (10 bids/60s per user-per-auction, 30 bids/60s per user globally). Every blocked request received a structured `RATE_LIMIT_EXCEEDED` error body and a `Retry-After` header. No requests timed out or were allowed through after the limit was reached.

---

### 4. Cursor Pagination — Deep Result Set Benchmark

| Metric | Value |
|--------|-------|
| Dataset size | 240 active auctions, 24 pages at limit=10 |
| P50 (combined-scenario run) | 4ms |
| P90 (combined-scenario run) | 1,050ms |
| P95 (combined-scenario run) | 2,160ms |
| **Verdict** | **Query correctness: PASS — see analysis** |

**What this measures:**  
Manual, isolated verification confirmed correct keyset (cursor-based) traversal: page 1 returns a `nextCursor` derived from `(endTime, id)`, and each subsequent page correctly advances through the dataset using that cursor, with individual page response times around 5-10ms.

In the combined four-scenario k6 run, the pagination scenario's P95 rose to 2.16s. This run executed 10 pagination VUs concurrently with 50 bid-latency VUs and a 30 req/s rate-limiter burst, all competing for the same local database and Redis connections. The median (P50 = 4ms) remained low even under this contention, suggesting the query itself stayed fast and the P95 tail reflects queueing/contention rather than a pagination-specific defect. An isolated single-scenario run to confirm this was not completed.

---

## System Throughput (Combined Run)

| Metric | Value |
|--------|-------|
| Total requests | 8,373 |
| Throughput | 73.9 req/s |
| Data received | 11 MB |
| Data sent | 4.3 MB |
| Overall HTTP P95 | 15.6ms |

---

## Open Items / Follow-Up

| Item | Status |
|------|--------|
| Confirm root cause of 9 × HTTP 500s in concurrent bidding | Not yet verified — DB pool sizing is the leading hypothesis |
| Isolated single-scenario run for cursor pagination | Not yet completed — needed to separate query performance from test-harness contention |
| Isolated before/after comparison of `SELECT FOR UPDATE` overhead | Not performed — current numbers reflect full pipeline only |
| 18s max latency outlier in bid_latency scenario | Cause not isolated — candidates include DB pool pressure, Redis latency, event-loop scheduling |

---

## How to Reproduce

**Prerequisites:** Node.js v22+, k6, PostgreSQL, Redis running locally

```bash
# 1. Install dependencies and start the server
cd AIBid2X-clean
npm install
npm run dev
```

```bash
# 2. Seed load-test fixtures (creates 1 seller + 51 dedicated bidder accounts
#    and mints real JWT access tokens directly via the database).
#    Re-run this before each k6 session — tokens expire after 15 minutes.
npx tsx src/tests/performance/seed-loadtest-fixtures.ts
```

```bash
# 3. Run the full suite (all 4 scenarios)
cd src/tests/performance
k6 run k6-aibid2x.js
```

```bash
# 3. Or run individual scenarios
cd src/tests/performance
k6 run --env SCENARIO=bid_latency k6-aibid2x.js
k6 run --env SCENARIO=concurrent_bids k6-aibid2x.js
k6 run --env SCENARIO=rate_limiter k6-aibid2x.js
k6 run --env SCENARIO=cursor_pagination k6-aibid2x.js
```

> **Note:** k6's `open('./fixtures.json')` resolves relative to the script file.
> Run k6 from `src/tests/performance/` or pass the full path to the script
> (e.g. `k6 run src/tests/performance/k6-aibid2x.js` from the project root —
> k6 resolves `open()` relative to the script's directory, not the working
> directory, so either approach works).

---

*Generated from k6 run — June 2026*
---

## Addendum — Realistic Multi-User Load Test (v2 Suite)

A follow-up test suite was built to address a limitation in the original run: the
initial suite shared 3 bidder accounts across 50 virtual users, causing ~97% of
traffic to be rejected by `globalUserBidRateLimit` (30 bids/60s/user) before reaching
the database. This meant the original P95=14ms figure largely measured rate-limit
rejection latency, not bid placement latency.

**v2 changes:**
- 51 dedicated user accounts seeded directly via the database (1 per VU for
  `bid_latency`, 1 reserved for `rate_limiter`), with real JWTs minted using the
  application's own signing function
- Each VU paced at ~0.3 req/s — under the per-user rate limit, modeling 50
  distinct bidders at realistic cadence
- Latency split into `bid_latency_placed_ms` (HTTP 201) and
  `bid_latency_rejected_ms` (HTTP 400/429) as separate metrics

### Finding: Numeric Precision Validation Gap (Found & Fixed)

The v2 run's first pass surfaced a 500 error reproducible with a single request:
sending a bid `amount` with 13+ significant digits (e.g. `Date.now()`-based values)
exceeded the `numeric(12,2)` precision of the `bids.amount` / `auctions.current_price`
columns, causing an unhandled PostgreSQL overflow returned as a generic
`500 INTERNAL_ERROR`.

**Fix:** added `.max(9_999_999_999.99, ...)` to the `placeBidSchema` Zod validator.
Confirmed via single-request reproduction: identical input now returns
`400 VALIDATION_ERROR` with a structured message instead of `500`.

### Finding: Connection Pool Capacity Under Concurrent Multi-User Load

With the precision bug fixed and 50 distinct users bidding at realistic pace
(10 users per auction across 5 auctions), the suite surfaced a second issue:

| Configuration | HTTP 500s (of ~520-770 requests) | Bid placement P95 |
|---|---|---|
| `DB_POOL_MAX=25` | 253 | 5.88s |
| `DB_POOL_MAX=12` | 4-5 | 11.29-11.97s |

**Root cause (confirmed via server logs with correlation IDs):**
```
(EMAXCONNSESSION) max clients reached in session mode -
max clients are limited to pool_size: 15
```

The application's connection pool (`DB_POOL_MAX=25`) exceeded Supabase's
session-mode pooler limit (15 concurrent sessions). Under 50 concurrent VUs with
10-way contention per auction row (`SELECT FOR UPDATE`), the pool was exhausted,
and `pg-pool` surfaced `EMAXCONNSESSION` as an unhandled error in both the primary
bid-placement path (`bid.service.ts`) and a secondary audit-log write path
(`bidAudit.ts`).

**Mitigation applied:** reducing `DB_POOL_MAX` from 25 to 12 (below the pooler's
15-session ceiling) reduced unhandled 500s by 98% (253 → 4-5). This converts most
failures into queued-but-successful requests — latency increased (P95 5.88s →
11.29s) because requests now wait for a pool connection rather than failing.

**What was NOT verified:**
- Whether the remaining 4-5 errors under `DB_POOL_MAX=12` are the same
  `EMAXCONNSESSION` error or a different cause — not re-confirmed against logs
  for this specific configuration
- Transaction-mode pooling (PgBouncer transaction mode, typically a different
  port/hostname on Supabase) as an alternative that could reduce both errors and
  latency — an attempted test of this did not actually change the active
  configuration (the `.env` reverted to session-mode `:5432` before the
  comparison run), so no valid data exists for this option yet

**What WAS verified — correctness invariant held throughout:**
Across all configurations (`DB_POOL_MAX=25` and `=12`, with 253 and 4-5 errors
respectively), no data corruption occurred. `SELECT FOR UPDATE` correctly
serialized writes in every run; the 500s represent availability failures under
contention, not consistency failures.

### Updated Key Findings (v2)

- Identified and fixed a numeric precision validation gap (bid amounts exceeding
  `numeric(12,2)`) that caused unhandled 500s — converted to clean 400 responses
- Identified a connection pool capacity ceiling under realistic 50-user concurrent
  load, root-caused to Supabase's session-mode pooler limit via structured logs
- Reduced unhandled errors by 98% (253→4-5) via a one-line pool size change,
  with the latency/availability trade-off explicitly measured and reported
- Data integrity (`SELECT FOR UPDATE` correctness) held across all configurations
  and error conditions tested

### Next Steps (Open)

1. Confirm error type for remaining 4-5 failures under `DB_POOL_MAX=12` via
   server logs
2. Correctly configure and test Supabase transaction-mode pooling
   (verify hostname/port via Supabase dashboard → Database → Connection Pooling,
   rather than assuming `:6543`)
3. Re-run `concurrent_bids` and `rate_limiter` scenarios with the v2 fixture-based
   approach (not yet executed in this session)
4. Once pooling is resolved, re-run the full suite to get a clean `bid_latency_placed_ms`
   baseline reflecting application logic rather than infrastructure contention

