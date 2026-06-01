import { Router, Request, Response, NextFunction } from 'express';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireRole } from '../middleware/requireRole.js';
import { bidRateLimit } from '../middleware/rateLimiter.js';
import { createAuctionSchema, listAuctionsSchema, auctionIdParamSchema, placeBidSchema } from '../validators/auction.js';
import * as AuctionService from '../services/auction.service.js';
import * as BidService from '../services/bid.service.js';

import type { AccessTokenPayload } from '../lib/jwt.js';

interface AuthenticatedRequest extends Request {
  user?: AccessTokenPayload;
}
const router = Router();

router.post('/', requireAuth, requireRole('seller', 'admin'), validate(createAuctionSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try { res.status(201).json({ auction: await AuctionService.createAuction(req.user!.sub, req.body) }); }
    catch (err) { next(err); }
  }
);

router.get('/', validate(listAuctionsSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try { res.status(200).json(await AuctionService.listAuctions(req.query as never)); }
    catch (err) { next(err); }
  }
);

router.get('/:id', validate(auctionIdParamSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try { res.status(200).json({ auction: await AuctionService.getAuctionById(req.params.id!) }); }
    catch (err) { next(err); }
  }
);

router.patch('/:id/activate', requireAuth, requireRole('seller', 'admin'), validate(auctionIdParamSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try { res.status(200).json({ auction: await AuctionService.activateAuction(req.params.id!, req.user!.sub) }); }
    catch (err) { next(err); }
  }
);

router.get('/:id/bids', validate(auctionIdParamSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try { res.status(200).json({ bids: await AuctionService.getAuctionBids(req.params.id!) }); }
    catch (err) { next(err); }
  }
);

// Bid route: tighter rate limit (10/60s) on top of global apiRateLimit
router.post('/:id/bids', requireAuth, requireRole('bidder', 'admin'), bidRateLimit, validate(placeBidSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try { res.status(201).json({ bid: await BidService.placeBid(req.params.id!, req.user!.sub, req.body.amount) }); }
    catch (err) { next(err); }
  }
);

export { router as auctionRouter };
