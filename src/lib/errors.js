export class AppError extends Error {
    statusCode;
    code;
    details;
    isOperational;
    constructor(message, statusCode, code, details, isOperational = true) {
        super(message);
        this.name = 'AppError';
        this.statusCode = statusCode;
        this.code = code;
        this.details = details;
        this.isOperational = isOperational;
        Object.setPrototypeOf(this, new.target.prototype);
        Error.captureStackTrace(this, this.constructor);
    }
    static badRequest(message, code = 'BAD_REQUEST', details) {
        return new AppError(message, 400, code, details);
    }
    static unauthorized(message = 'Unauthorized') {
        return new AppError(message, 401, 'UNAUTHORIZED');
    }
    static forbidden(message = 'Forbidden') {
        return new AppError(message, 403, 'FORBIDDEN');
    }
    static notFound(resource) {
        return new AppError(`${resource} not found`, 404, 'NOT_FOUND');
    }
    static conflict(message, code = 'CONFLICT') {
        return new AppError(message, 409, code);
    }
    static internal(message = 'Internal server error') {
        return new AppError(message, 500, 'INTERNAL_ERROR', undefined, false);
    }
}
//# sourceMappingURL=errors.js.map