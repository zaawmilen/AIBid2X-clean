import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { streamAuctionAnalysis } from '../services/analysis.service.js';

const router = Router({ mergeParams: true });

router.get('/', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  const id = req.params.id;

  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return next(AppError.badRequest('Invalid auction ID', 'INVALID_ID'));
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('x-correlation-id', req.correlationId);
  res.flushHeaders();

  let clientDisconnected = false;
  req.on('close', () => { clientDisconnected = true; });

  const write = (data: object) => {
    if (!clientDisconnected) res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    write({ type: 'start', auctionId: id });

    await streamAuctionAnalysis(
      id,
      (text) => write({ type: 'text', text }),
      (usage) => { write({ type: 'done', ...usage }); if (!clientDisconnected) res.end(); },
    );
  } catch (err) {
    const error = err as Error & { statusCode?: number; code?: string };
    if (res.headersSent) {
      logger.error({ err: error.message, auctionId: id }, 'Analysis stream error');
      write({ type: 'error', message: error.message, code: error.code ?? 'STREAM_ERROR' });
      res.end();
    } else {
      next(err);
    }
  }
});

export { router as analysisRouter };
