import { pool } from '../../db/index.js';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema.js';
import { transactionContext } from '../../lib/transactionContext.js';

// runInTransaction provides tests with a transactional `txDb` that will be
// rolled back at the end, and a helper `withCommitted` that runs callbacks
// on a separate committed connection. Use `withCommitted` to create fixtures
// that must be visible to other DB sessions (concurrency tests).
export async function runInTransaction<T>(fn: (txDb: ReturnType<typeof drizzle>, withCommitted: <R>(cb: (db: ReturnType<typeof drizzle>) => Promise<R>) => Promise<R>) => Promise<T>) {
  const client = await pool.connect();
  const committedClient = await pool.connect();
  try {
    // Ensure test DB enforces single 'winning' bid per auction.
    // First clean up any existing duplicates by keeping the highest bid
    // per auction and marking the rest as 'outbid'. This lets the CREATE
    // UNIQUE INDEX succeed even if the DB already has inconsistent rows.
    await committedClient.query(`
      WITH winners AS (
        SELECT DISTINCT ON (auction_id) id
        FROM bids
        WHERE status = 'winning'
        ORDER BY auction_id, amount DESC, created_at DESC
      )
      UPDATE bids
      SET status = 'outbid'
      WHERE status = 'winning' AND id NOT IN (SELECT id FROM winners)
    `);

    // Idempotent index creation (run on committed connection)
    await committedClient.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS one_winner_per_auction
      ON bids (auction_id)
      WHERE status = 'winning'
    `);

    // Helper to run an async callback on the separate committed connection.
    const committedDb = drizzle(committedClient, { schema });
    async function withCommitted<R>(cb: (db: ReturnType<typeof drizzle>) => Promise<R>) {
      return cb(committedDb);
    }

    // Start the transactional client after fixtures/index are prepared.
    await client.query('BEGIN');
    const txDb = drizzle(client, { schema });

    // Run the test callback inside the AsyncLocalStorage so services can
    // access the transactional client for visibility checks when needed.
    return await transactionContext.run({ txDb, client }, async () => {
      try {
        const res = await fn(txDb, withCommitted);
        await client.query('ROLLBACK');
        return res;
      } finally {
        // no-op
      }
    });
  } finally {
    committedClient.release();
    client.release();
  }
}

export default runInTransaction;

// Helper: run a committed fixture setup first, then run the test inside a
// rollback-wrapped transaction. This is handy for concurrency tests where
// fixtures must be visible to separate DB sessions.
export async function runWithCommittedFixtures<T, S>(
  setup: (db: ReturnType<typeof drizzle>) => Promise<S>,
  fn: (txDb: ReturnType<typeof drizzle>, withCommitted: <R>(cb: (db: ReturnType<typeof drizzle>) => Promise<R>) => Promise<R>, setupResult: S) => Promise<T>,
) {
  const fixtureClient = await pool.connect();
  let setupResult: S;
  try {
    const fixtureDb = drizzle(fixtureClient, { schema });
    setupResult = await setup(fixtureDb);
  } finally {
    fixtureClient.release();
  }

  return runInTransaction(async (tx, withCommitted) => fn(tx, withCommitted, setupResult));
}
