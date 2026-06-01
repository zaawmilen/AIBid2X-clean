export interface RefreshTokenData {
    userId: string;
    email: string;
    role: string;
}
export declare function storeRefreshToken(data: RefreshTokenData): Promise<string>;
export declare function getRefreshToken(tokenId: string): Promise<RefreshTokenData | null>;
export declare function revokeRefreshToken(tokenId: string): Promise<void>;
export declare function rotateRefreshToken(oldTokenId: string): Promise<{
    newTokenId: string;
    data: RefreshTokenData;
} | null>;
//# sourceMappingURL=tokens.d.ts.map