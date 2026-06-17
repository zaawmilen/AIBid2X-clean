# Architecture Decision Records

## Purpose

This document captures significant architectural decisions made during the design and implementation of AIBid2X. The goal is to preserve the reasoning behind key technical choices, document trade-offs, and provide future contributors with context when evolving the system.

---

# ADR-001: Monetary Precision — NUMERIC instead of float

**Status:** Accepted

## Context

Auction bids and monetary values require exact decimal arithmetic. IEEE 754 floating-point numbers cannot represent many decimal values exactly:

```
0.1 + 0.2 = 0.30000000000000004
```

Using floating-point values for bids could cause incorrect comparisons and non-deterministic auction outcomes.

## Decision

All monetary values are stored as `NUMERIC(12,2)`. PostgreSQL `NUMERIC` values are returned by the `pg` driver as strings. All monetary arithmetic uses `Decimal.js` — native JavaScript arithmetic and `Number()` conversion are prohibited for monetary calculations.

## Alternatives considered

- `float8` — rejected (precision loss)
- Integer cents — rejected (additional conversion complexity at every boundary)
- `text` — rejected (no numeric constraints or range enforcement)

## Consequences

- Monetary values are handled as strings at database boundaries.
- `Decimal.js` becomes a required dependency for bid calculations.
- Supports values up to $9,999,999,999.99.
- Load testing surfaced that values exceeding this ceiling (e.g. `Date.now()`-scale integers) cause a PostgreSQL `numeric_field_overflow` error. Mitigated by adding `.max(9_999_999_999.99)` to the Zod `placeBidSchema` — converts the error from an unhandled 500 to a clean 400 `VALIDATION_ERROR`.

---

# ADR-002: Bid Concurrency — Dual-Gate Locking Model

**Status:** Accepted

## Context

Concurrent bids may read the same current price simultaneously and incorrectly believe they are winning. Without protection, multiple bids can pass validation, final auction state becomes non-deterministic, and multiple active winners may appear.

## Decision

Two concurrency gates are applied within a single database transaction.

**Gate 1 — row-level lock:**
```sql
SELECT ... FROM auctions WHERE id = $id FOR UPDATE
```
Serializes access to the auction row. No other transaction can read or modify this row until the current transaction commits or rolls back.

**Gate 2 — compare-and-swap:**
```sql
UPDATE auctions
SET current_price = $bidAmount
WHERE id = $id AND current_price < $bidAmount
RETURNING id
```
Acts as a CAS guard. If zero rows are returned, a concurrent winner already set a higher price — the bid is rejected as `BID_TOO_LOW` and the current price is re-read for the response.

## Alternatives considered

- Optimistic locking — rejected (requires retry logic in application code; harder to reason about under high concurrency)
- Redis mutex — rejected (introduces a distributed lock with network latency and expiry risk; PostgreSQL already provides row-level locking)
- Single-writer queue — rejected (adds infrastructure complexity; correct but over-engineered for this concurrency pattern)

## Consequences

- Deterministic winner selection verified under k6 concurrent load testing (20 VUs, same bid amount, same auction — exactly one winner in every run).
- Safe under high concurrency and consistent across single-instance and horizontally scaled deployments.
- Side effects (WebSocket broadcast, outbid notification queue) execute only after successful commit.
- Transactions serialize writes to the same auction row — throughput per auction is bounded by transaction duration. Acceptable for auction bid patterns; would require sharding for order-book style markets.

---

# ADR-003: Authentication — JWT + Redis Refresh Token Rotation

**Status:** Accepted

## Context

The system requires stateless authentication, session revocation capability, and protection against refresh-token replay attacks.

## Decision

- Short-lived JWT access token (15 minutes, HS256)
- Opaque UUID refresh token (7 days, stored in Redis)

Refresh tokens are rotated on every use — each `/auth/refresh` call atomically invalidates the old token and issues a new pair. A replay attempt with an already-used token fails immediately because the token no longer exists in Redis.

## Alternatives considered

- Session store in database — rejected (read on every request; connection overhead)
- Long-lived JWT — rejected (no revocation capability)
- OAuth2/OIDC — rejected (over-engineered for a self-contained API with no third-party identity)
- Paseto — rejected (sufficient security with HS256 for this use case; less ecosystem tooling)

## Consequences

- Maximum access-token exposure window: 15 minutes.
- Immediate revocation capability via Redis key deletion.
- Redis becomes a dependency for session management — outage would block token refresh but not validation of existing access tokens (stateless).

---

# ADR-004: Rate Limiting — Redis Sliding Window via Lua Script

**Status:** Accepted

## Context

Rate limiting must remain correct under concurrent requests from the same user. Simple read-modify-write approaches (GET count → check → SET count) introduce a race condition where two simultaneous requests both read a count below the limit and both proceed.

## Decision

Redis sorted sets with an atomic Lua `EVAL` script. Each script execution performs four operations atomically:

1. Remove expired entries (`ZREMRANGEBYSCORE`)
2. Count active entries (`ZCARD`)
3. Add the current request if below the limit (`ZADD`)
4. Update the key TTL (`PEXPIRE`)

Two independent rate-limit layers are applied to bid placement:

| Layer | Key | Limit | Window |
|-------|-----|-------|--------|
| Per-user-per-auction | `rate_limit:POST:/:id/bids:<userId>` | 10 requests | 60s |
| Global per-user | `rate_limit:global_bids:<userId>` | 30 requests | 60s |
| Auth endpoints | `rate_limit:POST:/login:<ip>` | 10 requests | 15 min |
| Other API routes | `rate_limit:*:<userId/ip>` | 120 requests | 60s |

## Alternatives considered

- Fixed window — rejected (burst exploitation at window boundaries)
- Token bucket — rejected (more complex implementation; similar guarantees)
- In-memory limiter — rejected (does not survive process restarts; incorrect under multiple instances)

## Consequences

- True sliding-window behavior — no boundary burst exploitation.
- Automatic expiration of rate-limit keys via `PEXPIRE`.
- Redis outage fails open (rate limiter catches errors and calls `next()`).
- Validated under k6 burst testing: 7,634 correctly-formed 429 responses at 67.4 blocks/s under 30 req/s sustained load.

---

# ADR-005: Async Processing — BullMQ Worker Architecture

**Status:** Accepted

## Context

Long-running or unreliable operations (embedding generation, outbid notifications, auction expiry) must not block HTTP request processing. A 500ms OpenAI API call in the bid placement path would make the bid endpoint unusable under load.

## Decision

BullMQ with three dedicated queues:

| Queue | Job | Trigger |
|-------|-----|---------|
| `auction-jobs` | `expire-auction` | Scheduled at auction activation with `delay` = `endTime - now()` |
| `embeddings` | `generate-embedding` | Fire-and-forget on auction create/update |
| `notifications` | `outbid` | Post-commit, after a bid displaces the previous highest bidder |

Workers run in a separate process (`npm run worker`). Auction expiry jobs use deterministic IDs (`expire-{auctionId}`) to prevent duplicate scheduling on restart.

All queue calls are wrapped in `safeQueueAdd()` — a timeout-protected fire-and-forget (3s timeout) that logs failures but never propagates them to the HTTP response path.

Retry configuration: 3 attempts, exponential backoff (2s → 4s → 8s).

## Alternatives considered

- AWS SQS — rejected (external dependency; adds IAM/credential complexity for a portfolio project)
- `pg-boss` — rejected (PostgreSQL-based queuing adds write pressure to the primary DB)
- `setTimeout` — rejected (lost on process restart; no observability)
- Temporal — rejected (significant operational overhead; over-engineered for this workload)

## Consequences

- Jobs survive application restarts (persisted in Redis).
- Workers scale independently of the API process.
- Queue state is observable through Bull Board (`/admin/queues`).
- `safeQueueAdd()` means queue failures are silent from the client's perspective — an embedding job that fails does not surface as a bid placement error.

---

# ADR-006: AI Pipeline — Hybrid Retrieval Architecture

**Status:** Accepted

## Context

Semantic search alone misses exact keyword matches (a search for "VIN 1HGBH41JXMN109186" returns conceptually similar results, not the specific vehicle). Keyword search alone misses conceptual similarity ("sports car" does not match "Porsche 911"). Embedding generation via the OpenAI API cannot block auction creation — latency is unpredictable.

## Decision

Three-stage pipeline:

**Stage 1 — Asynchronous embedding generation:**
BullMQ `embeddings` queue generates `text-embedding-3-small` vectors after auction creation. Stored in pgvector. Falls back to keyword-only search if embedding is not yet available.

**Stage 2 — Hybrid retrieval:**
Combines pgvector cosine similarity and PostgreSQL full-text search (`tsvector` + `ts_rank`). Results merged using Reciprocal Rank Fusion (RRF) — a rank-based fusion algorithm that does not require score normalization across the two signals.

**Stage 3 — Streaming analysis:**
RAG context assembled from hybrid search results and streamed through Server-Sent Events (SSE) via Anthropic Claude.

## Alternatives considered

- Pinecone / external vector store — rejected (adds infrastructure dependency; pgvector sufficient for this dataset size)
- Synchronous embeddings — rejected (blocks auction creation on OpenAI API latency)
- REST polling for analysis — rejected (worse UX than streaming; requires client-side retry logic)
- Semantic-only retrieval — rejected (poor recall on exact identifiers like VINs, lot numbers)

## Consequences

- Lower infrastructure complexity — pgvector co-located with application data.
- Better retrieval quality than either signal alone.
- Graceful degradation when AI services are unavailable (falls back to keyword search).
- Embedding staleness window: time between auction creation and worker processing (typically seconds on a warm worker).

---

# ADR-007: Real-Time Event Delivery — WebSocket + Redis Pub/Sub

**Status:** Accepted

## Context

BullMQ workers run in a separate process and cannot directly access WebSocket connections held by the API process. Auction lifecycle events (bid placed, auction ended) must be delivered to connected clients in real time.

## Decision

Redis Pub/Sub acts as a cross-process event bridge:

- Workers and the API server publish events to the `auction:events` channel after successful transaction commits
- API server instances subscribe to `auction:events` and rebroadcast to WebSocket clients grouped by auction room
- Requires a dedicated Redis connection for the subscriber (cannot share with the command connection)

## Alternatives considered

- HTTP callbacks between processes — rejected (tight coupling; requires service discovery)
- Single-process deployment — rejected (workers and API competing for resources; not representative of production topology)
- Socket.IO — rejected (abstraction overhead; native WebSocket sufficient)
- Polling — rejected (latency; unnecessary load)

## Consequences

- Multiple API instances remain synchronized — any instance can receive a Redis event and broadcast to its connected clients.
- Events are published only after successful transaction commits — no phantom events from rolled-back transactions.
- Requires a dedicated Redis subscriber connection per API instance.

---

# ADR-008: Deployment Topology — Render + Supabase + Upstash

**Status:** Accepted  
*(Supersedes initial Fly.io decision — migrated to Render for simpler process group management)*

## Context

Requirements:
- Separate API and worker processes
- PostgreSQL with pgvector extension
- Managed Redis with TLS
- Cost-efficient deployment suitable for portfolio and low-traffic production

## Decision

| Layer | Service |
|-------|---------|
| Compute | Render (two web services: `api` + `worker`) |
| Database | Supabase PostgreSQL + pgvector |
| Redis | Upstash Redis (TLS, `rediss://`) |

Deployment: `render.yaml` defines both services. `dist/` is committed to the repository to ensure the service starts correctly even if the Render build step is misconfigured.

`DB_POOL_MAX=12` — kept below Supabase's session-mode pooler ceiling (15 concurrent sessions), identified via load testing. Switching to Supabase's transaction-mode pooler (port 6543) is the recommended next step for higher concurrency.

## Alternatives considered

- Fly.io — initially used; migrated to Render for simpler configuration and process management
- Railway — evaluated; less flexible process separation
- Neon — evaluated; pgvector support available but less mature at time of decision
- Redis Cloud — evaluated; Upstash preferred for serverless billing model

## Consequences

- Separate deployment lifecycle for API and workers (two Render services).
- Managed infrastructure with minimal operational overhead.
- `DB_POOL_MAX=12` limits concurrency under high load — transaction-mode pooling is the next infrastructure improvement.

---

# Guiding Principles

1. PostgreSQL is the single source of truth.
2. Redis is a coordination and acceleration layer, not a system of record.
3. Side effects occur only after successful transaction commits.
4. Deterministic behavior is preferred over eventual correction.
5. Concurrency correctness takes priority over throughput.
6. Asynchronous work must never block user-facing requests.
7. Infrastructure should remain replaceable without changing domain behavior.

---

# Revision Policy

New ADRs should be created when introducing new infrastructure dependencies, new consistency models, new communication patterns, new security boundaries, or significant architectural trade-offs.

Accepted ADRs are not deleted. If a decision changes, a superseding ADR references the previous record.
