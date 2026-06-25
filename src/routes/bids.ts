import { Router, Request, Response, NextFunction } from 'express';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireRole } from '../middleware/requireRole.js';
// import { bidRateLimit } from '../middleware/rateLimiter.js';
import { placeBidSchema, auctionIdParamSchema, listBidsQuerySchema } from '../validators/auction.js';
import * as BidService from '../services/bid.service.js';
import type { AccessTokenPayload } from '../lib/jwt.js';

interface AuthenticatedRequest extends Request {
  user?: AccessTokenPayload;
}

const router = Router();

/**
 * GET /api/v1/bids/my
 * Bidder's own bid history across all auctions (Copart-style "My Bids")
 * Auth: bidder only
 */
router.get('/my', requireAuth, requireRole('bidder', 'admin'),
  validate(listBidsQuerySchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { page = 1, limit = 20, status } = req.query as {
        page?: number; limit?: number; status?: string;
      };
      const result = await BidService.getMyBids(req.user!.sub, { page: Number(page), limit: Number(limit), ...(status && { status }) });
      res.status(200).json(result);
    } catch (err) { next(err); }
  }
);

/**
 * GET /api/v1/bids/:id
 * Get a single bid by ID
 * Auth: authenticated users (bidder sees own, admin sees all)
 */
router.get('/:id', requireAuth,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const bid = await BidService.getBidById(req.params.id!, req.user!.sub, req.user!.role);
      res.status(200).json({ bid });
    } catch (err) { next(err); }
  }
);

export { router as bidsRouter };
