# AIBid2X

Production-grade auction platform with AI-powered search. Built as a portfolio project to demonstrate backend engineering depth — not a tutorial clone.

**Live API:** https://aibid2x.onrender.com/api/v1/docs  
**Health:** https://aibid2x.onrender.com/readyz

---

## What this demonstrates

### Concurrency-safe bidding

Placing a bid under concurrent load is a classic distributed systems problem. AIBid2X solves it with two layered guarantees inside a single PostgreSQL transaction:

1. `SELECT FOR UPDATE` — row-level lock prevents dirty reads on the auction row during the transaction
2. CAS gate — `UPDATE auctions SET current_price = $bid WHERE current_price < $bid` is atomic; zero rows returned means a concurrent winner already claimed the slot before this transaction committed

This combination is correct across multiple application instances and survives network retries without producing duplicate winners — verified under k6 concurrent load testing (see [Performance](#performance--load-testing)).

 AI-powered search

Search is implemented as a hybrid pipeline combining two signals:

- Semantic search — OpenAI `text-embedding-3-small` vectors stored in pgvector, queried by cosine similarity
- Full-text search — PostgreSQL `tsvector` with `ts_rank`
- Reciprocal Rank Fusion — merges and re-ranks both result sets without requiring score normalization

Embeddings are generated asynchronously via a BullMQ worker — the HTTP response never blocks on OpenAI latency. Falls back to keyword-only search if the embedding service is unavailable.

### Queue architecture

Three BullMQ queues handle async work:

| Queue | Job | Trigger |
|-------|-----|---------|
| `auction-jobs` | `expire-auction` | Scheduled at activation with `delay` matching `endTime` |
| `embeddings` | `generate-embedding` | Fire-and-forget on auction create |
| `notifications` | `outbid` | Post-commit after a winning bid displaces another bidder |

All queue calls are wrapped in `safeQueueAdd()` — a timeout-protected fire-and-forget that never blocks the HTTP response path.

### Append-only bid audit log

Every bid attempt — accepted or rejected — is written to an immutable `bid_events` table. Accepted bids are written inside the same transaction as the bid insert (atomic). Rejections are written outside any transaction (always persisted, even on rollback).

Outcomes tracked: `accepted` · `rejected_too_low` · `rejected_ended` · `rejected_not_active` · `rejected_own_auction` · `rejected_duplicate` · `rejected_cas_failed` · `error_internal`

### Operational features

- Correlation IDs — every request tagged with `x-correlation-id`, propagated into logs, error responses, and the audit log
- Structured logging — pino JSON logs with per-request context; pino-pretty in development
- Error fingerprinting — unhandled errors tagged with `code::METHOD /route` for log aggregator grouping
- Graceful shutdown — SIGTERM drains keep-alive connections, closes BullMQ workers cleanly, then closes DB pool and Redis
- Cursor-based pagination — keyset pagination on `(endTime DESC, id ASC)` for auction listings; avoids `OFFSET` scan at scale
- Dual-layer rate limiting — per-user-per-auction (10 bids/60s) + global per-user (30 bids/60s) via Redis sliding window (Lua script, atomic)
- Security headers — helmet.js with strict CSP (`default-src 'none'`), HSTS with preload, DENY framing, no `x-powered-by`
- Refresh token rotation — single-use refresh tokens stored in Redis; each `/auth/refresh` call atomically invalidates the old token and issues a new pair. Replay attacks return 401 immediately
- Input validation — Zod schemas on all endpoints including explicit `.max()` bounds on numeric fields aligned to database column precision (`numeric(12,2)`)
- Secrets management — all secrets validated at startup via Zod; process exits with a clear error if any required variable is missing or too short

---

## Tech stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js 22, TypeScript (strict mode) |
| Framework | Express |
| Database | PostgreSQL 16 + pgvector (Supabase) |
| Cache / queues | Redis 7 + BullMQ (Upstash) |
| ORM | Drizzle ORM |
| AI — embeddings | OpenAI `text-embedding-3-small` |
| AI — analysis | Anthropic Claude (streaming SSE) |
| Validation | Zod |
| Logging | Pino + pino-http |
| Load testing | k6 |
| Deploy | Render + Supabase + Upstash |

---

## API

Interactive docs (Swagger UI): **https://aibid2x.onrender.com/api/v1/docs**

### Demo credentials

| Email | Role | Password |
|-------|------|----------|
| `k6seller@aibid2x.com` | seller | `Test@1234` |
| `k6bidder1@aibid2x.com` | bidder | `Test@1234` |
| `k6bidder2@aibid2x.com` | bidder | `Test@1234` |

### Key endpoints

```
POST   /api/v1/auth/register               # register (bidder or seller)
POST   /api/v1/auth/login                  # get JWT access + refresh token
POST   /api/v1/auth/refresh                # rotate refresh token
POST   /api/v1/auth/logout                 # revoke refresh token
GET    /api/v1/auth/me                     # current user

GET    /api/v1/auctions                    # list (cursor or offset pagination)
POST   /api/v1/auctions                    # create draft (seller)
GET    /api/v1/auctions/:id                # get single auction
PATCH  /api/v1/auctions/:id/activate       # activate draft (seller, owner only)
GET    /api/v1/auctions/:id/bids           # bid history for auction
POST   /api/v1/auctions/:id/bids           # place bid (bidder, rate-limited)

GET    /api/v1/bids/my                     # bidder's own bid history
GET    /api/v1/bids/:id                    # single bid detail (owner or admin)

GET    /api/v1/search?q=ford+mustang       # hybrid semantic + full-text search
GET    /api/v1/auctions/:id/analysis       # streaming AI analysis (SSE)

GET    /api/v1/metrics                     # queue depths + system stats
GET    /api/v1/docs                        # Swagger UI
GET    /healthz                            # liveness
GET    /readyz                             # readiness (DB + Redis)

```
> **Note on AI features:** The search and analysis endpoints are fully implemented
> but use mock embeddings in the current deployment. To enable live AI features,
> set `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` — no code changes required.
---

## Local setup

### Prerequisites

- Node.js 22+
- A Supabase project (free tier works)
- An Upstash Redis instance (free tier works)
- k6 (for load testing only) — [install guide](https://k6.io/docs/get-started/installation/)

### 1. Clone and install

```bash
git clone <repo>
cd AIBid2X-clean
npm install
```

### 2. Environment variables

```bash
cp .env.example .env
```

Required variables:

```env
DATABASE_URL=         # Supabase connection string (session mode :5432 or transaction mode :6543)
REDIS_URL=            # Upstash Redis URL (rediss:// for TLS)
JWT_ACCESS_SECRET=    # min 32 chars random string
JWT_REFRESH_SECRET=   # min 32 chars random string (different from ACCESS_SECRET)
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
OPENAI_API_KEY=       # optional — falls back to mock embeddings if absent
ANTHROPIC_API_KEY=    # required for /analysis endpoints
DB_POOL_MAX=12        # keep below Supabase session-mode pooler limit (15)
PORT=3000
NODE_ENV=development
```

### 3. Run migrations

```bash
npm run db:migrate
```

### 4. Start the server

```bash
npm run dev          # development (hot reload via tsx watch)
```

### 5. Start workers (separate process)

```bash
npm run worker
```

### 6. Verify

```bash
curl http://localhost:3000/readyz
# {"status":"ready","checks":{"database":"ok","redis":"ok"}}

curl "http://localhost:3000/api/v1/auctions?limit=3" | jq '.pagination'
```

---

## Performance & load testing

Load-tested with a custom k6 suite covering four scenarios. Full methodology and findings in [`docs/performance/PERFORMANCE_REPORT.md`](docs/performance/PERFORMANCE_REPORT.md).

### Key results

| Metric | Result |
|--------|--------|
| Bid endpoint P95 | 14ms under 50 concurrent VUs |
| Throughput | 73.9 req/s sustained |
| Concurrent bidding | Single winner verified — `SELECT FOR UPDATE` + CAS correct under contention |
| Rate limiter | 7,634 correctly-formed 429 responses at 67.4 blocks/s |
| Cursor pagination | P50 = 4ms across a 240-auction, 24-page dataset |

### Bugs found via load testing

**Numeric precision overflow (fixed):** bid amounts exceeding `numeric(12,2)` column precision caused unhandled PostgreSQL overflow errors returned as generic 500s. Fixed by adding `.max(9_999_999_999.99)` to the Zod `placeBidSchema` — converting the failure from a 500 to a clean 400 `VALIDATION_ERROR`.

**Connection pool ceiling (mitigated):** under 50 realistic concurrent bidders, the app-level pool (`DB_POOL_MAX=25`) exceeded Supabase's session-mode pooler limit (15 sessions), producing `EMAXCONNSESSION` errors. Root-caused via structured server logs with correlation IDs. Reducing `DB_POOL_MAX` to 12 reduced unhandled 500s by 98% (253 → 4-5). Transaction-mode pooling (port 6543) is the recommended next step.

### Running the load tests

```bash
# Step 1 — seed 1 seller + 51 dedicated bidder accounts with real JWTs
# Re-run before every k6 session — tokens expire after JWT_ACCESS_EXPIRES_IN (default 15m)
npx tsx src/tests/performance/seed-loadtest-fixtures.ts

# Step 2 — run from the performance directory
# k6's open() resolves relative to the script file location
cd src/tests/performance

# All 4 scenarios
k6 run k6-aibid2x.js

# Individual scenarios
k6 run --env SCENARIO=bid_latency k6-aibid2x.js
k6 run --env SCENARIO=concurrent_bids k6-aibid2x.js
k6 run --env SCENARIO=rate_limiter k6-aibid2x.js
k6 run --env SCENARIO=cursor_pagination k6-aibid2x.js
```

---

## Project structure

Source files only (`.ts`). Compiled output (`dist/`, `.js`, `.d.ts`, `.map`) is excluded.

```
src/
├── app.ts                              # Express app factory
├── server.ts                           # HTTP server + graceful shutdown
├── worker.ts                           # Worker process entry point
│
├── config/
│   └── env.ts                          # Zod-validated environment config
│
├── db/
│   ├── index.ts                        # pg Pool + Drizzle instance
│   ├── schema.ts                       # Table definitions, enums, relations, types
│   ├── migrate.ts                      # Migration runner
│   ├── seed.ts                         # Demo data seed script
│   └── createVectorIndex.ts            # pgvector HNSW index creation
│
├── lib/
│   ├── anthropic.ts                    # Streaming RAG analysis (SSE)
│   ├── bidAudit.ts                     # Append-only bid_events writer
│   ├── cache.ts                        # Upstash/Redis cache abstraction
│   ├── errors.ts                       # AppError (operational vs unexpected)
│   ├── jwt.ts                          # Token signing + verification
│   ├── logger.ts                       # Pino structured logger
│   ├── openai.ts                       # Embedding generation (real + mock fallback)
│   ├── openapi.ts                      # OpenAPI 3.0.3 spec
│   ├── password.ts                     # bcrypt hash + compare
│   ├── pubsub.ts                       # Redis pub/sub for cross-process events
│   ├── rag.ts                          # Hybrid search + RRF pipeline
│   ├── redis.ts                        # ioredis client + safeRedisGet/Set
│   ├── redis.upstash.ts                # Upstash REST client
│   ├── tokens.ts                       # Refresh token store (Redis)
│   ├── transactionContext.ts           # Async-local transaction context
│   └── websocket.ts                    # WebSocket server + auction room broadcast
│
├── middleware/
│   ├── correlationId.ts                # x-correlation-id propagation
│   ├── errorHandler.ts                 # Fingerprinted error logging + safe responses
│   ├── rateLimiter.ts                  # Sliding window (Lua) — global + per-auction
│   ├── requestLogger.ts                # pino-http per-request logging
│   ├── requireAuth.ts                  # JWT verification
│   ├── requireRole.ts                  # Role-based access control
│   └── validate.ts                     # Zod schema validation middleware
│
├── queues/
│   └── index.ts                        # BullMQ queue + job type definitions
│
├── routes/
│   ├── analysis.ts                     # GET /auctions/:id/analysis (SSE)
│   ├── auctions.ts                     # Auction CRUD + bid placement
│   ├── auth.ts                         # Register, login, refresh, logout, /me
│   ├── bids.ts                         # GET /bids/my + GET /bids/:id
│   ├── docs.ts                         # Swagger UI
│   ├── health.ts                       # /healthz + /readyz
│   ├── metrics.ts                      # System metrics
│   └── search.ts                       # Hybrid semantic search
│
├── services/
│   ├── analysis.service.ts             # RAG pipeline orchestration
│   ├── auction.service.ts              # Auction business logic + cursor pagination
│   ├── auth.service.ts                 # Auth + refresh token rotation
│   ├── bid.service.ts                  # Bid placement (locking + CAS + audit)
│   └── metrics.service.ts              # Queue depth + system stats aggregation
│
├── validators/
│   ├── auction.ts                      # createAuction, listAuctions, placeBid schemas
│   ├── auth.ts                         # register, login, refresh, logout schemas
│   └── search.ts                       # search query schema
│
├── workers/
│   ├── auction.worker.ts               # Auction expiry processor
│   ├── embedding.worker.ts             # Async embedding generation
│   └── notification.worker.ts          # Outbid notification dispatch
│
└── tests/
    ├── ai/
    │   └── search.integration.test.ts
    ├── concurrency/
    │   ├── bid-determinism.test.ts     # SELECT FOR UPDATE correctness
    │   ├── bid-race.test.ts            # Concurrent bid race scenarios
    │   └── deadlock-prevention.test.ts
    ├── contracts/
    │   └── auction.contract.test.ts
    ├── domain-rules/
    │   └── bid-lifecycle.test.ts
    ├── e2e/
    │   └── auction-flow.e2e.test.ts
    ├── fixtures/
    │   ├── auctionFactory.ts
    │   ├── bidFactory.ts
    │   └── userFactory.ts
    ├── integration/
    │   ├── auctions/
    │   ├── auth/
    │   ├── bids/
    │   └── health.test.ts
    ├── invariants/
    │   └── bid-invariants.test.ts
    ├── performance/
    │   ├── k6-aibid2x.js               # k6 load test suite (4 scenarios)
    │   ├── seed-loadtest-fixtures.ts   # Mint 51 test users directly via DB
    │   └── fixtures.json               # Generated — do not edit manually
    ├── security/
    │   ├── auth.test.ts
    │   ├── injection.test.ts
    │   └── rate-limit.test.ts
    ├── setup/
    │   ├── globalSetup.ts
    │   ├── fallbackSchema.ts
    │   ├── migrate.ts
    │   ├── transaction.ts
    │   └── transaction.test.ts
    └── workers/
        ├── auction.worker.test.ts
        └── embedding.worker.test.ts
```

---

## npm scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Dev server with hot reload (tsx watch) |
| `npm run build` | Compile TypeScript → `dist/` |
| `npm start` | Run compiled output |
| `npm run worker` | Start BullMQ worker process |
| `npm run typecheck` | Type-check without emitting |
| `npm run db:generate` | Generate Drizzle migration from schema changes |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:migrate:prod` | Apply migrations in production |
| `npm run db:studio` | Drizzle Studio (visual DB browser) |
| `npm run db:vector-index` | Create pgvector index |

---

## Architecture decisions

Full decision records with context, alternatives considered, and consequences: [`docs/architecture/ADR.md`](docs/architecture/ADR.md).

| ADR | Decision | Key trade-off |
|-----|----------|---------------|
| ADR-001 | `NUMERIC(12,2)` + Decimal.js for all monetary values | Exact arithmetic; string conversion at every DB boundary |
| ADR-002 | `SELECT FOR UPDATE` + CAS dual-gate | Deterministic winner selection; serializes writes to the same auction row |
| ADR-003 | JWT access tokens + opaque refresh tokens in Redis | Stateless auth with revocation; Redis dependency for session management |
| ADR-004 | Redis sliding-window rate limiting via Lua `EVAL` | Atomic; no read-modify-write race; fails open on Redis outage |
| ADR-005 | BullMQ with `safeQueueAdd()` fire-and-forget | Queue failures never surface to the HTTP response path |
| ADR-006 | Hybrid search (pgvector + FTS) + Reciprocal Rank Fusion | Better recall than either signal alone; no external search infrastructure |
| ADR-007 | Redis pub/sub as cross-process WebSocket event bridge | Workers fan out to all WebSocket clients via API instances |
| ADR-008 | Render + Supabase + Upstash | Separate API and worker processes; managed pgvector and Redis |

---

## Deployment

Deployed on **Render** with **Supabase** (PostgreSQL + pgvector) and **Upstash** (Redis).

- `DB_POOL_MAX=12` — kept below Supabase's session-mode pooler ceiling (15). Transaction-mode pooling (port 6543) is the recommended next step for higher concurrency
- Redis uses `rediss://` (TLS) — required by Upstash
- Workers run as a separate Render service (`npm run worker`)
- `dist/` is committed to git — ensures the service starts even if the Render build step is misconfigured

---

*Built to signal production engineering thinking, not framework familiarity.*
