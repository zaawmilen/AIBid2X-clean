import type { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

// Every request gets a correlation ID — either propagated from an upstream
// service (x-correlation-id header) or generated fresh.
// This ID flows through logs, queue jobs, and AI call records so you can
// trace a single user action across every system it touches.

declare global {
  namespace Express {
    interface Request {
      correlationId: string;
    }
  }
}

export function correlationId(req: Request, res: Response, next: NextFunction) {
  const id =
    (req.headers['x-correlation-id'] as string | undefined) ?? uuidv4();

  req.correlationId = id;
  // Echo it back so clients can correlate their own logs
  res.setHeader('x-correlation-id', id);

  next();
}
