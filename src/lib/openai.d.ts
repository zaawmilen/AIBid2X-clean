export declare const EMBEDDING_MODEL = "text-embedding-3-small";
export declare const EMBEDDING_DIMENSIONS = 1536;
export declare function embedText(text: string, context?: {
    auctionId?: string;
}): Promise<number[]>;
//# sourceMappingURL=openai.d.ts.map