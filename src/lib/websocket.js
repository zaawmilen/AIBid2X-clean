import { WebSocketServer, WebSocket } from 'ws';
import { logger } from './logger.js';
const rooms = new Map();
function joinRoom(auctionId, ws) {
    if (!rooms.has(auctionId))
        rooms.set(auctionId, new Set());
    rooms.get(auctionId).add(ws);
}
function leaveRoom(auctionId, ws) {
    const room = rooms.get(auctionId);
    if (!room)
        return;
    room.delete(ws);
    if (room.size === 0)
        rooms.delete(auctionId);
}
function roomSize(auctionId) {
    return rooms.get(auctionId)?.size ?? 0;
}
export function broadcastToAuction(auctionId, event) {
    const clients = rooms.get(auctionId);
    if (!clients?.size)
        return;
    const message = JSON.stringify(event);
    const dead = [];
    for (const client of clients) {
        if (client.readyState === WebSocket.OPEN)
            client.send(message);
        else
            dead.push(client);
    }
    dead.forEach((ws) => leaveRoom(auctionId, ws));
    logger.debug({ auctionId, sent: clients.size - dead.length }, 'WebSocket broadcast');
}
export function createWebSocketServer(httpServer) {
    const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
    wss.on('connection', (ws, req) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const auctionId = url.searchParams.get('auctionId');
        if (!auctionId) {
            ws.close(1008, 'auctionId required');
            return;
        }
        joinRoom(auctionId, ws);
        const count = roomSize(auctionId);
        logger.debug({ auctionId, watchers: count }, 'WebSocket client joined');
        ws.send(JSON.stringify({ type: 'connected', auctionId, watchers: count }));
        broadcastToAuction(auctionId, { type: 'watchers_updated', auctionId, count });
        ws.on('close', () => {
            leaveRoom(auctionId, ws);
            const remaining = roomSize(auctionId);
            if (remaining > 0)
                broadcastToAuction(auctionId, { type: 'watchers_updated', auctionId, count: remaining });
        });
        ws.on('error', (err) => { logger.error({ err, auctionId }, 'WebSocket error'); leaveRoom(auctionId, ws); });
    });
    logger.info('WebSocket server attached at /ws');
    return wss;
}
//# sourceMappingURL=websocket.js.map