import { v4 as uuidv4 } from 'uuid';
export function correlationId(req, res, next) {
    const id = req.headers['x-correlation-id'] ?? uuidv4();
    req.correlationId = id;
    res.setHeader('x-correlation-id', id);
    next();
}
//# sourceMappingURL=correlationId.js.map