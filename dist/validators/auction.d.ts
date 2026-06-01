import { z } from 'zod';
export declare const createAuctionSchema: z.ZodObject<{
    body: z.ZodEffects<z.ZodObject<{
        title: z.ZodString;
        description: z.ZodOptional<z.ZodString>;
        startingPrice: z.ZodNumber;
        reservePrice: z.ZodOptional<z.ZodNumber>;
        endTime: z.ZodEffects<z.ZodString, string, string>;
    }, "strip", z.ZodTypeAny, {
        title: string;
        startingPrice: number;
        endTime: string;
        description?: string | undefined;
        reservePrice?: number | undefined;
    }, {
        title: string;
        startingPrice: number;
        endTime: string;
        description?: string | undefined;
        reservePrice?: number | undefined;
    }>, {
        title: string;
        startingPrice: number;
        endTime: string;
        description?: string | undefined;
        reservePrice?: number | undefined;
    }, {
        title: string;
        startingPrice: number;
        endTime: string;
        description?: string | undefined;
        reservePrice?: number | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    body: {
        title: string;
        startingPrice: number;
        endTime: string;
        description?: string | undefined;
        reservePrice?: number | undefined;
    };
}, {
    body: {
        title: string;
        startingPrice: number;
        endTime: string;
        description?: string | undefined;
        reservePrice?: number | undefined;
    };
}>;
export declare const listAuctionsSchema: z.ZodObject<{
    query: z.ZodObject<{
        status: z.ZodOptional<z.ZodEnum<["draft", "active", "ended", "cancelled"]>>;
        page: z.ZodDefault<z.ZodNumber>;
        limit: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        limit: number;
        page: number;
        status?: "draft" | "active" | "ended" | "cancelled" | undefined;
    }, {
        status?: "draft" | "active" | "ended" | "cancelled" | undefined;
        limit?: number | undefined;
        page?: number | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    query: {
        limit: number;
        page: number;
        status?: "draft" | "active" | "ended" | "cancelled" | undefined;
    };
}, {
    query: {
        status?: "draft" | "active" | "ended" | "cancelled" | undefined;
        limit?: number | undefined;
        page?: number | undefined;
    };
}>;
export declare const auctionIdParamSchema: z.ZodObject<{
    params: z.ZodObject<{
        id: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        id: string;
    }, {
        id: string;
    }>;
}, "strip", z.ZodTypeAny, {
    params: {
        id: string;
    };
}, {
    params: {
        id: string;
    };
}>;
export declare const placeBidSchema: z.ZodObject<{
    params: z.ZodObject<{
        id: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        id: string;
    }, {
        id: string;
    }>;
    body: z.ZodObject<{
        amount: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        amount: number;
    }, {
        amount: number;
    }>;
}, "strip", z.ZodTypeAny, {
    params: {
        id: string;
    };
    body: {
        amount: number;
    };
}, {
    params: {
        id: string;
    };
    body: {
        amount: number;
    };
}>;
export declare const listBidsQuerySchema: z.ZodObject<{
    query: z.ZodObject<{
        status: z.ZodOptional<z.ZodEnum<["active", "outbid", "winning", "won", "invalid"]>>;
        page: z.ZodDefault<z.ZodNumber>;
        limit: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        limit: number;
        page: number;
        status?: "active" | "outbid" | "winning" | "won" | "invalid" | undefined;
    }, {
        status?: "active" | "outbid" | "winning" | "won" | "invalid" | undefined;
        limit?: number | undefined;
        page?: number | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    query: {
        limit: number;
        page: number;
        status?: "active" | "outbid" | "winning" | "won" | "invalid" | undefined;
    };
}, {
    query: {
        status?: "active" | "outbid" | "winning" | "won" | "invalid" | undefined;
        limit?: number | undefined;
        page?: number | undefined;
    };
}>;
export type CreateAuctionInput = z.infer<typeof createAuctionSchema>['body'];
export type ListAuctionsQuery = z.infer<typeof listAuctionsSchema>['query'];
export type PlaceBidInput = z.infer<typeof placeBidSchema>['body'];
export type ListBidsQuery = z.infer<typeof listBidsQuerySchema>['query'];
//# sourceMappingURL=auction.d.ts.map