export declare function placeBid(auctionId: string, bidderId: string, amount: number): Promise<{
    status: "active" | "outbid" | "winning" | "won" | "invalid";
    id: string;
    createdAt: Date;
    auctionId: string;
    bidderId: string;
    amount: string;
}>;
interface GetMyBidsOptions {
    page: number;
    limit: number;
    status?: string;
}
export declare function getMyBids(bidderId: string, { page, limit, status }: GetMyBidsOptions): Promise<{
    bids: {
        id: string;
        amount: string;
        status: "active" | "outbid" | "winning" | "won" | "invalid";
        createdAt: Date;
        auction: {
            status: "draft" | "active" | "ended" | "cancelled";
            id: string;
            title: string;
            currentPrice: string;
            endTime: Date | null;
        };
    }[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        pages: number;
    };
}>;
export declare function getBidById(bidId: string, requesterId: string, requesterRole: string): Promise<{
    id: string;
    amount: string;
    status: "active" | "outbid" | "winning" | "won" | "invalid";
    createdAt: Date;
    bidderId: string;
    auction: {
        status: "draft" | "active" | "ended" | "cancelled";
        id: string;
        title: string;
        currentPrice: string;
        endTime: Date | null;
    };
}>;
export {};
//# sourceMappingURL=bid.service.d.ts.map