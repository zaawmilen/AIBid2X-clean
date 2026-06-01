export interface AccessTokenPayload {
    sub: string;
    email: string;
    role: string;
    jti: string;
}
export declare function signAccessToken(payload: Omit<AccessTokenPayload, 'jti'>): string;
export declare function verifyAccessToken(token: string): AccessTokenPayload;
//# sourceMappingURL=jwt.d.ts.map