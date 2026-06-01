import { z } from 'zod';
export declare const semanticSearchSchema: z.ZodObject<{
    query: z.ZodObject<{
        q: z.ZodString;
        limit: z.ZodDefault<z.ZodNumber>;
        minSimilarity: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        limit: number;
        q: string;
        minSimilarity: number;
    }, {
        q: string;
        limit?: number | undefined;
        minSimilarity?: number | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    query: {
        limit: number;
        q: string;
        minSimilarity: number;
    };
}, {
    query: {
        q: string;
        limit?: number | undefined;
        minSimilarity?: number | undefined;
    };
}>;
export type SemanticSearchQuery = z.infer<typeof semanticSearchSchema>['query'];
//# sourceMappingURL=search.d.ts.map