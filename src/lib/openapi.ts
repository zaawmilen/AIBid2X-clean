import type { OpenAPIV3 } from 'openapi-types';

export const openApiSpec: OpenAPIV3.Document = {
  openapi: '3.0.3',
  info: {
    title: 'AIBid2X API',
    version: '1.0.0',
    description: `
## AIBid2X — Production-grade auction platform with AI-powered search

A portfolio project demonstrating backend engineering depth:
- **Real-time bidding** with WebSocket broadcasting
- **Concurrency safety** via SELECT FOR UPDATE + CAS gate + advisory locks
- **AI search** using pgvector embeddings + hybrid RAG (Reciprocal Rank Fusion)
- **Queue architecture** with BullMQ (auction expiry, embeddings, notifications)
- **Append-only audit log** on every bid attempt
- **Cursor-based pagination** for scalable auction listings

Built with: Node.js · TypeScript · Express · PostgreSQL · pgvector · Redis · BullMQ · OpenAI · Anthropic

### Try it out
| Email | Role | Password |
|-------|------|----------|
| k6seller@aibid2x.com | seller | Test@1234 |
| k6bidder1@aibid2x.com | bidder | Test@1234 |
| k6bidder2@aibid2x.com | bidder | Test@1234 |

> **Note:** AI search and analysis use mock fallback in production. Architecture is fully implemented — set OPENAI_API_KEY and ANTHROPIC_API_KEY to enable live AI features.
    `.trim(),
    contact: { name: 'AIBid2X', url: 'https://aibid2x-clean.fly.dev' },
    // 👇 Custom UI metadata

    'x-theme': {
      primaryColor: '#3b82f6',
      secondaryColor: '#6366f1',
      fontFamily: 'Inter, Roboto, sans-serif',
      layout: 'sidebar', // sidebar navigation
      darkMode: true     // enable dark mode toggle
    }
  } as any, 
  servers: [
    { url: 'https://aibid2x-clean.fly.dev/api/v1',  description: 'Production (Fly.io)' },
    { url: 'http://localhost:3000/api/v1',      description: 'Local development' },
  ],
  tags: [
    { name: 'Health',    description: 'Liveness and readiness probes' },
    { name: 'Auth',      description: 'Registration, login, token refresh' },
    { name: 'Auctions',  description: 'Auction lifecycle management' },
    { name: 'Bids',      description: 'Bid placement and history' },
    { name: 'Search',    description: 'AI-powered semantic auction search' },
    { name: 'Analysis',  description: 'Anthropic-powered streaming auction analysis' },
    { name: 'Metrics',   description: 'System health and performance metrics' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Access token from /auth/login. Expires in 15 minutes.',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        required: ['error'],
        properties: {
          error: {
            type: 'object',
            required: ['code', 'message'],
            properties: {
              code:          { type: 'string', example: 'VALIDATION_ERROR' },
              message:       { type: 'string', example: 'Request validation failed' },
              correlationId: { type: 'string', format: 'uuid' },
              details:       { type: 'array', items: { type: 'object' } },
            },
          },
        },
      },
      Auction: {
        type: 'object',
        properties: {
          id:            { type: 'string', format: 'uuid' },
          title:         { type: 'string', example: '2019 Ford Mustang GT' },
          description:   { type: 'string', nullable: true },
          status:        { type: 'string', enum: ['draft', 'active', 'ended', 'cancelled'] },
          startingPrice: { type: 'string', example: '5000.00' },
          currentPrice:  { type: 'string', example: '7500.00' },
          endTime:       { type: 'string', format: 'date-time' },
          createdAt:     { type: 'string', format: 'date-time' },
          seller: {
            type: 'object',
            properties: {
              id:    { type: 'string', format: 'uuid' },
              email: { type: 'string', format: 'email' },
            },
          },
        },
      },
      Bid: {
        type: 'object',
        properties: {
          id:        { type: 'string', format: 'uuid' },
          auctionId: { type: 'string', format: 'uuid' },
          bidderId:  { type: 'string', format: 'uuid' },
          amount:    { type: 'string', example: '7500.00' },
          status:    { type: 'string', enum: ['winning', 'outbid', 'won', 'invalid'] },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      PaginationCursor: {
        type: 'object',
        properties: {
          limit:      { type: 'integer', example: 20 },
          hasMore:    { type: 'boolean' },
          nextCursor: { type: 'string', description: 'Pass as `cursor` param to get next page' },
        },
      },
      PaginationOffset: {
        type: 'object',
        properties: {
          page:  { type: 'integer', example: 1 },
          limit: { type: 'integer', example: 20 },
          total: { type: 'integer', example: 156 },
          pages: { type: 'integer', example: 8 },
        },
      },
    },
  },

  paths: {
    // ── Health ──────────────────────────────────────────────────────────────
    '/healthz': {
      get: {
        tags: ['Health'],
        summary: 'Liveness probe',
        description: 'Returns 200 if the process is alive. Used by load balancers.',
        responses: {
          '200': { description: 'Process is alive', content: { 'application/json': { schema: { type: 'object', properties: { status: { type: 'string', example: 'ok' } } } } } },
        },
      },
    },
    '/readyz': {
      get: {
        tags: ['Health'],
        summary: 'Readiness probe',
        description: 'Checks database and Redis connectivity. Returns 503 if any dependency is unhealthy.',
        responses: {
          '200': {
            description: 'All dependencies healthy',
            content: { 'application/json': { schema: { type: 'object', properties: {
              status:    { type: 'string', example: 'ready' },
              checks:    { type: 'object', properties: { database: { type: 'string', enum: ['ok', 'error'] }, redis: { type: 'string', enum: ['ok', 'error'] } } },
              timestamp: { type: 'string', format: 'date-time' },
            } } } },
          },
          '503': { description: 'One or more dependencies unhealthy' },
        },
      },
    },

    // ── Auth ────────────────────────────────────────────────────────────────
    '/auth/register': {
      post: {
        tags: ['Auth'],
        summary: 'Register a new user',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['email', 'password', 'role'], properties: {
            email:    { type: 'string', format: 'email' },
            password: { type: 'string', minLength: 8, description: 'Min 8 characters' },
            role:     { type: 'string', enum: ['bidder', 'seller'] },
          } } } },
        },
        responses: {
          '201': { description: 'User registered successfully' },
          '409': { description: 'Email already in use', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Login and receive tokens',
        description: 'Returns a short-lived access token (15min) and a single-use refresh token (7d). Refresh tokens are Redis-backed and rotate on each use.',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['email', 'password'], properties: {
            email:    { type: 'string', format: 'email', example: 'bidder@example.com' },
            password: { type: 'string', example: 'password123' },
          } } } },
        },
        responses: {
          '200': {
            description: 'Login successful',
            content: { 'application/json': { schema: { type: 'object', properties: {
              token:        { type: 'string', description: 'JWT access token (15min)' },
              refreshToken: { type: 'string', description: 'Single-use refresh token (7d)' },
            } } } },
          },
          '401': { description: 'Invalid credentials' },
        },
      },
    },
    '/auth/refresh': {
      post: {
        tags: ['Auth'],
        summary: 'Refresh access token',
        description: 'Exchanges a refresh token for a new access + refresh token pair. The old refresh token is immediately invalidated (rotation).',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['refreshToken'], properties: { refreshToken: { type: 'string' } } } } },
        },
        responses: {
          '200': { description: 'New token pair issued' },
          '401': { description: 'Refresh token invalid or already used' },
        },
      },
    },
    '/auth/logout': {
      post: {
        tags: ['Auth'],
        summary: 'Logout — invalidate refresh token',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['refreshToken'], properties: { refreshToken: { type: 'string' } } } } },
        },
        responses: {
          '200': { description: 'Logged out successfully' },
        },
      },
    },
    '/auth/me': {
      get: {
        tags: ['Auth'],
        summary: 'Get current user',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': { description: 'Current user profile' },
          '401': { description: 'Unauthorized' },
        },
      },
    },

    // ── Auctions ────────────────────────────────────────────────────────────
    '/auctions': {
      get: {
        tags: ['Auctions'],
        summary: 'List auctions',
        description: `Supports both cursor-based (keyset) and offset pagination.

**Cursor pagination** (recommended for production):
Pass \`cursor\` from a previous response's \`nextCursor\` to page forward.
Cursor is a base64-encoded \`endTime:id\` pair — stable and efficient at scale.

**Offset pagination** (backward compat):
Use \`page\` + \`limit\`. Returns \`total\` and \`pages\`.`,
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['draft', 'active', 'ended', 'cancelled'], default: 'active' } },
          { name: 'cursor', in: 'query', schema: { type: 'string' }, description: 'Keyset cursor from previous response' },
          { name: 'limit',  in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } },
          { name: 'page',   in: 'query', schema: { type: 'integer', default: 1 }, description: 'Ignored when cursor is present' },
        ],
        responses: {
          '200': {
            description: 'Auction list with pagination metadata',
            content: { 'application/json': { schema: { type: 'object', properties: {
              auctions:   { type: 'array', items: { $ref: '#/components/schemas/Auction' } },
              pagination: {
                oneOf: [
                  { $ref: '#/components/schemas/PaginationCursor' },
                  { $ref: '#/components/schemas/PaginationOffset' },
                ],
              },
            } } } },
          },
        },
      },
      post: {
        tags: ['Auctions'],
        summary: 'Create auction (seller/admin)',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['title', 'startingPrice', 'endTime'], properties: {
            title:         { type: 'string', minLength: 3, maxLength: 500, example: '2019 Ford Mustang GT' },
            description:   { type: 'string', maxLength: 5000 },
            startingPrice: { type: 'number', example: 5000.00 },
            reservePrice:  { type: 'number', description: 'Must be >= startingPrice', example: 7000.00 },
            endTime:       { type: 'string', format: 'date-time', description: 'Must be in the future' },
          } } } },
        },
        responses: {
          '201': { description: 'Auction created in draft status' },
          '400': { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '403': { description: 'Insufficient role' },
        },
      },
    },
    '/auctions/{id}': {
      get: {
        tags: ['Auctions'],
        summary: 'Get auction by ID',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          '200': { description: 'Auction detail with bid stats', content: { 'application/json': { schema: { allOf: [
            { $ref: '#/components/schemas/Auction' },
            { type: 'object', properties: { bidCount: { type: 'integer' }, highestBid: { type: 'string', nullable: true } } },
          ] } } } },
          '404': { description: 'Auction not found' },
        },
      },
    },
    '/auctions/{id}/activate': {
      patch: {
        tags: ['Auctions'],
        summary: 'Activate auction (seller/admin)',
        description: 'Transitions auction from `draft` → `active`. Schedules expiry job in BullMQ.',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          '200': { description: 'Auction activated' },
          '409': { description: 'Invalid status transition' },
        },
      },
    },
    '/auctions/{id}/bids': {
      get: {
        tags: ['Bids'],
        summary: 'Get bids for an auction',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          '200': { description: 'List of bids ordered by time descending', content: { 'application/json': { schema: { type: 'object', properties: { bids: { type: 'array', items: { $ref: '#/components/schemas/Bid' } } } } } } },
          '404': { description: 'Auction not found' },
        },
      },
      post: {
        tags: ['Bids'],
        summary: 'Place a bid',
        description: `Places a bid on an active auction.

**Concurrency safety**: Uses SELECT FOR UPDATE row-level locking + CAS (Compare-And-Swap) gate to guarantee exactly one winner under concurrent load across multiple application instances.

**Rate limits**: 10 bids/min per auction + 30 bids/min globally per user.

**Idempotency**: Pass \`x-idempotency-key\` header to safely retry on network failure.

**Audit**: Every attempt (accepted or rejected) is written to an append-only \`bid_events\` table.`,
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'x-idempotency-key', in: 'header', schema: { type: 'string' }, description: 'Optional. Enables safe retries.' },
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['amount'], properties: {
            amount: { type: 'number', example: 7500.00, description: 'Must exceed current price' },
          } } } },
        },
        responses: {
          '201': { description: 'Bid placed successfully', content: { 'application/json': { schema: { type: 'object', properties: { bid: { $ref: '#/components/schemas/Bid' } } } } } },
          '400': { description: 'Bid too low, auction ended, or invalid amount' },
          '409': { description: 'Duplicate request in progress (idempotency)' },
          '429': { description: 'Rate limit exceeded' },
        },
      },
    },

    // ── Bids ────────────────────────────────────────────────────────────────
    '/bids/my': {
      get: {
        tags: ['Bids'],
        summary: 'Get my bids',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['active', 'outbid', 'winning', 'won', 'invalid'] } },
          { name: 'limit',  in: 'query', schema: { type: 'integer', default: 20 } },
          { name: 'page',   in: 'query', schema: { type: 'integer', default: 1 } },
        ],
        responses: {
          '200': { description: 'Paginated list of the authenticated user\'s bids' },
          '401': { description: 'Unauthorized' },
        },
      },
    },
    '/bids/{id}': {
      get: {
        tags: ['Bids'],
        summary: 'Get bid by ID',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          '200': { description: 'Bid detail' },
          '404': { description: 'Bid not found' },
        },
      },
    },

    // ── Search ──────────────────────────────────────────────────────────────
    '/search': {
      get: {
        tags: ['Search'],
        summary: 'Semantic auction search',
        description: `Hybrid search combining:
- **pgvector cosine similarity** on OpenAI embeddings
- **PostgreSQL full-text search** (tsvector)
- **Reciprocal Rank Fusion** to merge and re-rank results

Falls back to keyword-only search if embeddings are unavailable.`,
        parameters: [
          { name: 'q', in: 'query', required: true, schema: { type: 'string', example: 'ford mustang low mileage' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 10, maximum: 50 } },
        ],
        responses: {
          '200': { description: 'Ranked search results with relevance scores' },
          '400': { description: 'Missing or empty query' },
        },
      },
    },

    // ── Analysis ────────────────────────────────────────────────────────────
    '/auctions/{id}/analysis': {
      get: {
        tags: ['Analysis'],
        summary: 'AI auction analysis (streaming)',
        description: 'Streams an Anthropic Claude analysis of the auction via Server-Sent Events (SSE). Includes market context retrieved via RAG from similar auctions.',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          '200': {
            description: 'SSE stream of analysis chunks',
            content: { 'text/event-stream': { schema: { type: 'string', description: 'Server-Sent Events stream. Each event contains a text delta.' } } },
          },
          '404': { description: 'Auction not found' },
        },
      },
    },

    // ── Metrics ─────────────────────────────────────────────────────────────
    '/metrics': {
      get: {
        tags: ['Metrics'],
        summary: 'System metrics',
        description: 'Returns queue depths, bid counts, active auction count, and process uptime.',
        responses: {
          '200': { description: 'Current system metrics snapshot' },
        },
      },
    },
  },
  'x-swagger-ui': {
    filter: true,              // enable search bar
    docExpansion: 'none',      // collapse by default
    displayRequestDuration: true,
    syntaxHighlight: { theme: 'monokai' },
    tryItOutEnabled: true,
    showExtensions: true,
    showCommonExtensions: true
  }
} as any;