import type { Request, Response, NextFunction } from 'express';
declare global {
    namespace Express {
        interface Request {
            correlationId: string;
        }
    }
}
export declare function correlationId(req: Request, res: Response, next: NextFunction): void;
//# sourceMappingURL=correlationId.d.ts.map