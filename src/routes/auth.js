import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { authRateLimit } from '../middleware/rateLimiter.js';
import { registerSchema, loginSchema, refreshSchema, logoutSchema } from '../validators/auth.js';
import * as AuthService from '../services/auth.service.js';
const router = Router();
router.post('/register', authRateLimit, validate(registerSchema), async (req, res, next) => {
    try {
        res.status(201).json({ user: await AuthService.register(req.body) });
    }
    catch (err) {
        next(err);
    }
});
router.post('/login', authRateLimit, validate(loginSchema), async (req, res, next) => {
    try {
        res.status(200).json(await AuthService.login(req.body));
    }
    catch (err) {
        next(err);
    }
});
router.post('/refresh', validate(refreshSchema), async (req, res, next) => {
    try {
        res.status(200).json(await AuthService.refresh(req.body.refreshToken));
    }
    catch (err) {
        next(err);
    }
});
router.post('/logout', validate(logoutSchema), async (req, res, next) => {
    try {
        await AuthService.logout(req.body.refreshToken);
        res.status(204).send();
    }
    catch (err) {
        next(err);
    }
});
router.get('/me', requireAuth, (req, res) => {
    res.status(200).json({ user: { id: req.user.sub, email: req.user.email, role: req.user.role } });
});
export { router as authRouter };
//# sourceMappingURL=auth.js.map