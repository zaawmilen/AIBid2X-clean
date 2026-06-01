import type { CreateAuctionInput, ListAuctionsQuery } from '../validators/auction.js';
export declare function createAuction(sellerId: string, input: CreateAuctionInput): Promise<{
    status: "draft" | "active" | "ended" | "cancelled";
    id: string;
    createdAt: Date;
    updatedAt: Date;
    title: string;
    description: string | null;
    sellerId: string;
    startingPrice: string;
    reservePrice: string | null;
    currentPrice: string;
    startTime: Date | null;
    endTime: Date | null;
    embedding: number[] | null;
}>;
export declare function activateAuction(auctionId: string, sellerId: string): Promise<{
    status: "draft" | "active" | "ended" | "cancelled";
    id: string;
    createdAt: Date;
    updatedAt: Date;
    title: string;
    description: string | null;
    sellerId: string;
    startingPrice: string;
    reservePrice: string | null;
    currentPrice: string;
    startTime: Date | null;
    endTime: Date | null;
    embedding: number[] | null;
} | undefined>;
export declare function listAuctions(query: ListAuctionsQuery): Promise<{
    auctions: {
        status: "draft" | "active" | "ended" | "cancelled";
        id: string;
        createdAt: Date;
        updatedAt: Date;
        title: string;
        description: string | null;
        sellerId: string;
        startingPrice: string;
        reservePrice: string | null;
        currentPrice: string;
        startTime: Date | null;
        endTime: Date | null;
        embedding: number[] | null;
        seller: {
            id: string;
            email: string;
        };
    }[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        pages: number;
    };
}>;
export declare function getAuctionById(auctionId: string): Promise<{
    bidCount: number;
    highestBid: string | null;
    status: "draft" | "active" | "ended" | "cancelled";
    id: string;
    createdAt: Date;
    updatedAt: Date;
    title: string;
    description: string | null;
    sellerId: string;
    startingPrice: string;
    reservePrice: string | null;
    currentPrice: string;
    startTime: Date | null;
    endTime: Date | null;
    embedding: number[] | null;
    seller: {
        id: string;
        email: string;
    };
}>;
export declare function getAuctionBids(auctionId: string): Promise<{
    status: "active" | "outbid" | "winning" | "won" | "invalid";
    id: string;
    createdAt: Date;
    auctionId: string;
    bidderId: string;
    amount: string;
    bidder: {
        id: string;
        email: string;
    };
}[]>;
//# sourceMappingURL=auction.service.d.ts.map