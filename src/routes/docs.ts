import { Router } from 'express';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import { openApiSpec } from '../lib/openapi.js';

const router = Router();

// Override CSP for docs route only — Swagger UI needs inline scripts and
// its own bundled assets. All other routes keep the strict 'none' policy.
router.use(helmet.contentSecurityPolicy({
  directives: {
    defaultSrc:     ["'self'"],
    scriptSrc:      ["'self'", "'unsafe-inline'"],
    styleSrc:       ["'self'", "'unsafe-inline'"],
    imgSrc:         ["'self'", 'data:'],
    connectSrc:     ["'self'", 'https://aibid2x.fly.dev'],
    frameAncestors: ["'none'"],
  },
}));

// Serve the raw JSON spec
router.get('/openapi.json', (_req, res) => {
  res.json(openApiSpec);
});

// Serve Swagger UI
router.use('/', swaggerUi.serve);
router.get('/', swaggerUi.setup(openApiSpec, {
  customSiteTitle: 'AIBid2X API Docs',
  customCss: '.swagger-ui .topbar { background-color: #1a1a2e; }',
  swaggerOptions: {
    persistAuthorization: true,
    displayRequestDuration: true,
    docExpansion: 'list',
    filter: true,
  },
}));

export { router as docsRouter };