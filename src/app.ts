import express from "express";
import helmet from "helmet";
import { correlationId } from "./middleware/correlationId.js";
import { requestLogger } from "./middleware/requestLogger.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { apiRateLimit } from "./middleware/rateLimiter.js";
import { requireAuth } from "./middleware/requireAuth.js";
import { healthRouter } from "./routes/health.js";
import { authRouter } from "./routes/auth.js";
import { auctionRouter } from "./routes/auctions.js";
import { analysisRouter } from "./routes/analysis.js";
import { searchRouter } from "./routes/search.js";
import { metricsRouter } from "./routes/metrics.js";
import { bidsRouter } from "./routes/bids.js";
import { docsRouter } from './routes/docs.js';

function assertRouter(name: string, router: any) {
  if (!router) throw new Error(`Router missing: ${name}`);
}

export const app = express();

// ── Security headers ───────────────────────────────────────────────────────────
// Must be first — before any response can be sent
app.disable('x-powered-by'); // belt-and-suspenders alongside helmet

app.use(helmet({
  // Strict Transport Security — tells browsers to only use HTTPS for 1 year.
  // includeSubDomains covers any subdomains. preload opts into browser preload lists.
  strictTransportSecurity: {
    maxAge: 31_536_000,
    includeSubDomains: true,
    preload: true,
  },
  // Prevents browsers from MIME-sniffing the content-type.
  // Stops e.g. a JSON response being interpreted as HTML/script.
  noSniff: true,
  // Blocks the page from being framed — prevents clickjacking.
  frameguard: { action: 'deny' },
  // Disables the browser's built-in XSS filter (it can introduce vulnerabilities).
  // Modern apps rely on CSP instead.
  xssFilter: false,
  // Hides detailed referrer info when navigating away from the API.
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  // Content Security Policy — restrictive since this is a pure JSON API,
  // no HTML/scripts served directly. Blocks any attempts to render content.
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'none'"],
      scriptSrc:   ["'none'"],
      objectSrc:   ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  // Cross-Origin policies — prevents cross-origin resource leakage
  crossOriginEmbedderPolicy: true,
  crossOriginOpenerPolicy:   { policy: 'same-origin' },
  crossOriginResourcePolicy: { policy: 'same-origin' },
}));

// ── Body parsing ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));

// ── Core middleware ────────────────────────────────────────────────────────────
app.use(correlationId);
app.use(requestLogger);

// ── Routes ────────────────────────────────────────────────────────────────────
// Health check — no rate limit (used by load balancers / uptime monitors)
app.use(healthRouter);

// All other routes get the global rate limit
app.use('/api/v1/auth',              apiRateLimit, authRouter);
app.use('/api/v1/auctions',          apiRateLimit, auctionRouter);
app.use('/api/v1/auctions/:id/analysis', apiRateLimit, analysisRouter);
app.use('/api/v1/bids',              apiRateLimit, requireAuth, bidsRouter);
app.use('/api/v1/search',            apiRateLimit, searchRouter);
app.use('/api/v1/metrics',           metricsRouter);
app.use('/api/v1/docs',              docsRouter); // no rate limit on docs

// Note: individual routes can have additional rate limits (e.g. auth, bids).
// ── Router safety checks ──────────────────────────────────────────────────────
assertRouter('authRouter',     authRouter);
assertRouter('auctionRouter',  auctionRouter);
assertRouter('analysisRouter', analysisRouter);
assertRouter('bidsRouter',     bidsRouter);
assertRouter('searchRouter',   searchRouter);
assertRouter('metricsRouter',  metricsRouter);
assertRouter('docsRouter',     docsRouter);

app.get("/", (_, res) => {
  const version = process.env.npm_package_version || "1.0.0";

  res.type("html").send(`
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">

<title>AIBid2X API</title>

<style>

*{
    margin:0;
    padding:0;
    box-sizing:border-box;
}

body{
    background:#0f172a;
    color:#e2e8f0;
    font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
    line-height:1.6;
}

.container{
    max-width:1100px;
    margin:auto;
    padding:60px 25px;
}

.hero{
    margin-bottom:40px;
}

.badge{
    display:inline-block;
    background:#1e293b;
    color:#38bdf8;
    border:1px solid #334155;
    padding:6px 12px;
    border-radius:999px;
    font-size:13px;
    margin-bottom:18px;
}

h1{
    font-size:54px;
    margin-bottom:12px;
}

.subtitle{
    font-size:20px;
    color:#94a3b8;
    max-width:800px;
}

.grid{
    display:grid;
    grid-template-columns:repeat(auto-fit,minmax(320px,1fr));
    gap:24px;
    margin-top:40px;
}

.card{
    background:#111827;
    border:1px solid #1f2937;
    border-radius:14px;
    padding:24px;
}

.card h2{
    margin-bottom:16px;
    font-size:22px;
}

.card p{
    color:#cbd5e1;
}

ul{
    padding-left:18px;
}

li{
    margin-bottom:10px;
}

a{
    color:#38bdf8;
    text-decoration:none;
}

a:hover{
    text-decoration:underline;
}

.button{
    display:inline-block;
    margin-top:12px;
    background:#2563eb;
    color:white;
    padding:10px 18px;
    border-radius:8px;
    text-decoration:none;
}

.button:hover{
    background:#1d4ed8;
}

.footer{
    margin-top:60px;
    text-align:center;
    color:#64748b;
    font-size:14px;
}

code{
    color:#7dd3fc;
}

.status{
    color:#22c55e;
    font-weight:bold;
}

.tech{
    display:flex;
    flex-wrap:wrap;
    gap:10px;
    margin-top:15px;
}

.tech span{
    background:#1e293b;
    padding:8px 12px;
    border-radius:999px;
    font-size:14px;
}

</style>
</head>

<body>

<div class="container">

<div class="hero">

<div class="badge">
🚀 Production API
</div>

<h1>AIBid2X</h1>

<p class="subtitle">
Distributed Real-Time Auction Platform built with TypeScript, Express,
PostgreSQL, Redis, BullMQ and WebSockets.
Designed to demonstrate production-grade backend engineering,
system design, scalability, and deterministic auction processing.
</p>

</div>

<div class="grid">

<div class="card">

<h2>📚 Developer Resources</h2>

<p>
Explore the API and project resources.
</p>

<p><br>

<strong>Swagger UI</strong><br>
<a href="/api-docs">/api-docs</a>

</p>

<p><br>

<strong>Health Check</strong><br>
<a href="/health">/health</a>

</p>

<p><br>

<strong>Readiness Probe</strong><br>
<a href="/ready">/ready</a>

</p>

<p><br>

<strong>GitHub Repository</strong><br>
<a href="https://github.com/zaawmilen/AIBid2X-clean.git" target="_blank">
github.com/zaawmilen/AIBid2X-clean
</a>

</p>

</div>

<div class="card">

<h2>🟢 Deployment</h2>

<p>

<b>Status</b><br>
<span class="status">● API Online</span>

</p>

<p><br>

<b>Platform</b><br>
Fly.io

</p>

<p><br>

<b>Runtime</b><br>
Node.js

</p>

<p><br>

<b>Version</b><br>
<code>${version}</code>

</p>

</div>

<div class="card">

<h2>🏗 Architecture</h2>

<ul>

<li>REST API using Express</li>

<li>JWT Authentication</li>

<li>Role-Based Authorization</li>

<li>PostgreSQL with Drizzle ORM</li>

<li>Redis Caching</li>

<li>BullMQ Background Workers</li>

<li>WebSocket Live Auction Updates</li>

<li>Deterministic Winner Selection</li>

<li>Structured Logging</li>

<li>Graceful Shutdown</li>

</ul>

</div>

<div class="card">

<h2>⚡ Engineering Highlights</h2>

<ul>

<li>Race-condition resistant bidding workflow</li>

<li>Transactional consistency</li>

<li>Rate limiting</li>

<li>Centralized error handling</li>

<li>Input validation</li>

<li>Dockerized deployment</li>

<li>Production-ready configuration</li>

<li>Health & readiness probes</li>

<li>Architecture Decision Records (ADRs)</li>

<li>Comprehensive Swagger documentation</li>

</ul>

</div>

</div>

<div class="footer">

Built by <strong>Zaaw</strong><br><br>

AIBid2X demonstrates modern backend engineering practices including
distributed processing, asynchronous job execution, scalable architecture,
observability, and production deployment.

</div>

</div>

</body>
</html>
`);
});


// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    error: {
      code:    'NOT_FOUND',
      message: `Route not found: ${req.method} ${req.url}`,
    },
  });
});

// ── Error handler — must be last ──────────────────────────────────────────────
app.use(errorHandler);

export default app;