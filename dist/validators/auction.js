import { z } from 'zod';
export const createAuctionSchema = z.object({
    body: z.object({
        title: z.string().min(3, 'Title must be at least 3 characters').max(500),
        description: z.string().max(5000).optional(),
        startingPrice: z
            .number({ invalid_type_error: 'startingPrice must be a number' })
            .positive('Starting price must be positive')
            .multipleOf(0.01, 'Price cannot have more than 2 decimal places'),
        reservePrice: z.number().positive().multipleOf(0.01).optional(),
        endTime: z
            .string()
            .datetime({ message: 'endTime must be a valid ISO 8601 datetime' })
            .refine((val) => new Date(val) > new Date(), { message: 'endTime must be in the future' }),
    }).refine((data) => data.reservePrice === undefined || data.reservePrice >= data.startingPrice, { message: 'reservePrice must be >= startingPrice', path: ['reservePrice'] }),
});
export const listAuctionsSchema = z.object({
    query: z.object({
        status: z.enum(['draft', 'active', 'ended', 'cancelled']).optional(),
        page: z.coerce.number().int().positive().default(1),
        limit: z.coerce.number().int().positive().max(100).default(20),
    }),
});
export const auctionIdParamSchema = z.object({
    params: z.object({ id: z.string().uuid('Invalid auction ID') }),
});
export const placeBidSchema = z.object({
    params: z.object({ id: z.string().uuid('Invalid auction ID') }),
    body: z.object({
        amount: z
            .number({ invalid_type_error: 'amount must be a number' })
            .positive('Bid amount must be positive')
            .multipleOf(0.01, 'Amount cannot have more than 2 decimal places'),
    }),
});
// ── NEW: List bids query (for GET /api/v1/bids/my) ────────────────────────────
export const listBidsQuerySchema = z.object({
    query: z.object({
        status: z.enum(['active', 'outbid', 'winning', 'won', 'invalid']).optional(),
        page: z.coerce.number().int().positive().default(1),
        limit: z.coerce.number().int().positive().max(100).default(20),
    }),
});
//# sourceMappingURL=auction.js.map