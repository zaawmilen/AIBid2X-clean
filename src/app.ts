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