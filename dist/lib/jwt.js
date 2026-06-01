import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { env } from '../config/env.js';
export function signAccessToken(payload) {
    const options = {};
    if (env.JWT_ACCESS_EXPIRES_IN) {
        options.expiresIn = env.JWT_ACCESS_EXPIRES_IN;
    }
    return jwt.sign({ ...payload, jti: uuidv4() }, env.JWT_ACCESS_SECRET, options);
}
export function verifyAccessToken(token) {
    return jwt.verify(token, env.JWT_ACCESS_SECRET);
}
//# sourceMappingURL=jwt.js.map