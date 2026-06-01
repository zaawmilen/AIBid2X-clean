export declare function placeBid(auctionId: string, bidderId: string, amount: number): Promise<{
    status: "active" | "outbid" | "winning" | "won" | "invalid";
    id: string;
    createdAt: Date;
    auctionId: string;
    bidderId: string;
    amount: string;
}>;
//# sourceMappingURL=bid.service.d.ts.map