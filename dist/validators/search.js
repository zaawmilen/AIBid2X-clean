import { z } from 'zod';
export const semanticSearchSchema = z.object({
    query: z.object({
        q: z.string().min(2).max(500),
        limit: z.coerce.number().int().positive().max(50).default(10),
        // Allow negative values for mock embeddings — real embeddings score 0.0–1.0
        minSimilarity: z.coerce.number().min(-1).max(1).default(-1),
    }),
});
//# sourceMappingURL=search.js.map