import { AppError } from '../lib/errors.js';
export function requireRole(...roles) {
    return (req, _res, next) => {
        if (!req.user)
            return next(AppError.unauthorized());
        if (!roles.includes(req.user.role)) {
            return next(AppError.forbidden(`This action requires role: ${roles.join(' or ')}`));
        }
        next();
    };
}
//# sourceMappingURL=requireRole.js.map