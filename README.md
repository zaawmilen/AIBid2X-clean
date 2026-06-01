# Auction Platform

AI-enhanced real-time auction infrastructure. Built to signal backend complexity, AI integration, system design, and operational thinking.

## Tech stack

- **Runtime:** Node.js 20, TypeScript (strict mode)
- **Framework:** Express
- **Database:** PostgreSQL 16 + pgvector
- **Cache / Queue:** Redis 7 + BullMQ (Month 1 Week 3)
- **ORM:** Drizzle ORM
- **AI:** OpenAI Embeddings + Anthropic Messages API (Month 2)
- **Deploy:** Docker → Fly.io + Supabase

## Local setup

### Prerequisites
- Node.js 20+
- Docker Desktop

### 1. Clone and install
```bash
git clone <repo>
cd auction-platform
npm install
```

### 2. Environment variables
```bash
cp .env.example .env
# Edit .env — the defaults work with the Docker Compose services below
```

### 3. Start infrastructure
```bash
docker compose up -d
# Wait for both services to be healthy:
docker compose ps
```

### 4. Generate and run migrations
```bash
npm run db:generate   # generates SQL from schema.ts
npm run db:migrate    # applies migrations to the DB
```

### 5. Start the dev server
```bash
npm run dev
```

Server starts on `http://localhost:3000`.

### Verify it works
```bash
curl http://localhost:3000/healthz
# {"status":"ok"}

curl http://localhost:3000/readyz
# {"status":"ready","checks":{"database":"ok","redis":"ok"},...}
```

## npm scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Dev server with hot reload (tsx watch) |
| `npm run build` | Compile TypeScript to dist/ |
| `npm run start` | Run compiled output (production) |
| `npm run typecheck` | Type check without emitting |
| `npm run db:generate` | Generate Drizzle migration files from schema |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:studio` | Open Drizzle Studio (visual DB browser) |

## Project structure

```
src/
├── config/
│   └── env.ts          # Zod-validated environment variables
├── db/
│   ├── index.ts        # pg Pool + Drizzle instance
│   ├── migrate.ts      # Migration runner
│   ├── schema.ts       # All table definitions + types
│   └── migrations/     # Generated SQL migration files (committed to git)
├── lib/
│   ├── errors.ts       # AppError class
│   ├── logger.ts       # Pino logger
│   └── redis.ts        # ioredis client
├── middleware/
│   ├── correlationId.ts  # x-correlation-id on every request
│   ├── errorHandler.ts   # Serialises AppError, logs unknowns
│   └── requestLogger.ts  # pino-http per-request logging
└── routes/
    └── health.ts       # GET /healthz and GET /readyz
```

## Architecture decisions

See `docs/` for Architecture Decision Records (ADRs).

- [ADR-001: Core schema design](docs/adr-001-schema-design.md)
