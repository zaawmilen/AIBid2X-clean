import type { RegisterInput, LoginInput } from '../validators/auth.js';
export declare function register(input: RegisterInput): Promise<{
    id: string;
    email: string;
    role: "bidder" | "seller" | "admin";
    createdAt: Date;
} | undefined>;
export declare function login(input: LoginInput): Promise<{
    accessToken: string;
    refreshToken: string;
    user: {
        id: string;
        email: string;
        role: "bidder" | "seller" | "admin";
    };
}>;
export declare function refresh(oldTokenId: string): Promise<{
    accessToken: string;
    refreshToken: string;
}>;
export declare function logout(tokenId: string): Promise<void>;
//# sourceMappingURL=auth.service.d.ts.map