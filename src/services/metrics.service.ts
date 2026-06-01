import { Pool } from 'pg';
import { env } from '../config/env.js';
import { redis } from '../lib/redis.js';
import { auctionQueue, notificationQueue, embeddingQueue } from '../queues/index.js';
import { logger } from '../lib/logger.js';

const pool = new Pool({ connectionString: env.DATABASE_URL, max: 3 });

interface QueueMetrics { waiting: number; active: number; completed: number; failed: number; delayed: number; }
interface DatabaseMetrics { totalUsers: number; totalAuctions: number; activeAuctions: number; endedAuctions: number; totalBids: number; auctionsWithEmbeddings: number; }
interface RedisMetrics { connectedClients: number; usedMemoryHuman: string; keyspaceHits: number; keyspaceMisses: number; totalCommandsProcessed: number; }

export interface SystemMetrics {
  uptime: { seconds: number; human: string };
  database: DatabaseMetrics;
  queues: Record<string, QueueMetrics>;
  redis: RedisMetrics;
  timestamp: string;
}

function parseRedisInfo(info: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of info.split('\r\n')) {
    if (line && !line.startsWith('#')) {
      const colonIndex = line.indexOf(':');
      if (colonIndex > 0) result[line.slice(0, colonIndex).trim()] = line.slice(colonIndex + 1).trim();
    }
  }
  return result;
}

function formatUptime(s: number): string {
  const days = Math.floor(s / 86400), hours = Math.floor((s % 86400) / 3600), mins = Math.floor((s % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

async function safeQueueCounts(queue: typeof auctionQueue): Promise<QueueMetrics> {
  try {
    const c = await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
    return { waiting: c.waiting ?? 0, active: c.active ?? 0, completed: c.completed ?? 0, failed: c.failed ?? 0, delayed: c.delayed ?? 0 };
  } catch { return { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 }; }
}

export async function getSystemMetrics(): Promise<SystemMetrics> {
  const uptimeSeconds = Math.floor(process.uptime());

  const [dbResult, auctionCounts, notifCounts, embedCounts, redisInfo] = await Promise.all([
    pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM users)                                AS total_users,
        (SELECT COUNT(*)::int FROM auctions)                             AS total_auctions,
        (SELECT COUNT(*)::int FROM auctions WHERE status = 'active')     AS active_auctions,
        (SELECT COUNT(*)::int FROM auctions WHERE status = 'ended')      AS ended_auctions,
        (SELECT COUNT(*)::int FROM bids)                                 AS total_bids,
        (SELECT COUNT(*)::int FROM auctions WHERE embedding IS NOT NULL) AS auctions_with_embeddings
    `),
    safeQueueCounts(auctionQueue),
    safeQueueCounts(notificationQueue),
    safeQueueCounts(embeddingQueue),
    redis.info('all').catch(() => ''),
  ]);

  const row = dbResult.rows[0];
  const rInfo = parseRedisInfo(redisInfo);
  logger.debug({ uptimeSeconds }, 'Metrics collected');

  return {
    uptime: { seconds: uptimeSeconds, human: formatUptime(uptimeSeconds) },
    database: {
      totalUsers: row.total_users, totalAuctions: row.total_auctions,
      activeAuctions: row.active_auctions, endedAuctions: row.ended_auctions,
      totalBids: row.total_bids, auctionsWithEmbeddings: row.auctions_with_embeddings,
    },
    queues: { 'auction-jobs': auctionCounts, notifications: notifCounts, embeddings: embedCounts },
    redis: {
      connectedClients: Number(rInfo['connected_clients'] ?? 0),
      usedMemoryHuman: rInfo['used_memory_human'] ?? 'unknown',
      keyspaceHits: Number(rInfo['keyspace_hits'] ?? 0),
      keyspaceMisses: Number(rInfo['keyspace_misses'] ?? 0),
      totalCommandsProcessed: Number(rInfo['total_commands_processed'] ?? 0),
    },
    timestamp: new Date().toISOString(),
  };
}
