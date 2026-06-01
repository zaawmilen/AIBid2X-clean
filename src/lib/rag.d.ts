export interface SimilarAuction {
    id: string;
    title: string;
    description: string | null;
    current_price: string;
    status: string;
    rrf_score: number;
    semantic_score: number;
    lexical_score: number;
}
export interface AuctionBid {
    id: string;
    amount: string;
    createdAt: Date;
    bidderEmail: string;
}
export interface AuctionContext {
    id: string;
    title: string;
    description: string | null;
    startingPrice: string;
    currentPrice: string;
    reservePrice: string | null;
    status: string;
    endTime: Date | null;
    embedding: number[] | null;
    bids: AuctionBid[];
}
export declare function findSimilarAuctions(auctionId: string, searchText: string, embedding: number[] | null, limit?: number): Promise<SimilarAuction[]>;
export declare function assembleAnalysisPrompt(auction: AuctionContext, similarAuctions: SimilarAuction[]): string;
//# sourceMappingURL=rag.d.ts.map