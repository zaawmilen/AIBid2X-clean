import { pinoHttp } from 'pino-http';
import { logger } from '../lib/logger.js';
export const requestLogger = pinoHttp({
    logger,
    genReqId: (req) => req.correlationId ?? 'unknown',
    customProps: (req) => ({
        correlationId: req.correlationId,
    }),
    autoLogging: {
        ignore: (req) => req.url === '/healthz' || req.url === '/readyz',
    },
    serializers: {
        req(req) {
            return { method: req.method, url: req.url };
        },
        res(res) {
            return { statusCode: res.statusCode };
        },
    },
});
//# sourceMappingURL=requestLogger.js.map