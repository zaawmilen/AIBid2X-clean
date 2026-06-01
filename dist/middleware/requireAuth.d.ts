import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../lib/jwt.js';
type AccessTokenPayload = ReturnType<typeof verifyAccessToken>;
declare global {
    namespace Express {
        interface Request {
            user?: AccessTokenPayload;
        }
    }
}
export declare function requireAuth(req: Request, _res: Response, next: NextFunction): void;
export {};
//# sourceMappingURL=requireAuth.d.ts.map