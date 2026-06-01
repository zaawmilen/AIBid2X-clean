import { Request, Response, NextFunction } from 'express';
type Role = 'bidder' | 'seller' | 'admin';
export declare function requireRole(...roles: Role[]): (req: Request, _res: Response, next: NextFunction) => void;
export {};
//# sourceMappingURL=requireRole.d.ts.map