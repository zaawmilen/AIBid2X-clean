import { Router } from 'express';
import { getSystemMetrics } from '../services/metrics.service.js';
import { logger } from '../lib/logger.js';
const router = Router();
// GET /api/v1/metrics — public, no auth required
router.get('/', async (_req, res, next) => {
    try {
        const metrics = await getSystemMetrics();
        res.setHeader('Cache-Control', 'public, max-age=10');
        res.status(200).json(metrics);
    }
    catch (err) {
        logger.error({ err }, 'Failed to collect system metrics');
        next(err);
    }
});
export { router as metricsRouter };
//# sourceMappingURL=metrics.js.map