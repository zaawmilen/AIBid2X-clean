export declare class AppError extends Error {
    readonly statusCode: number;
    readonly code: string;
    readonly details?: unknown;
    readonly isOperational: boolean;
    constructor(message: string, statusCode: number, code: string, details?: unknown, isOperational?: boolean);
    static badRequest(message: string, code?: string, details?: unknown): AppError;
    static unauthorized(message?: string): AppError;
    static forbidden(message?: string): AppError;
    static notFound(resource: string): AppError;
    static conflict(message: string, code?: string): AppError;
    static internal(message?: string): AppError;
}
//# sourceMappingURL=errors.d.ts.map