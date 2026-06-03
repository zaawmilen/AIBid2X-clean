import { describe, it, expect } from 'vitest';
import { runInTransaction, runWithCommittedFixtures } from './transaction.js';
import { db } from '../../db/index.js';
import { users } from '../../db/schema.js';
import { eq } from 'drizzle-orm';

describe('transaction helpers', () => {
  it('runInTransaction rolls back changes', async () => {
    const email = `tx-test-${Date.now()}@example.com`;
    await runInTransaction(async (tx) => {
      await tx.insert(users).values({ email, passwordHash: 'x', role: 'bidder' });
    });

    const found = await db.query.users.findFirst({ where: eq(users.email, email) });
    // should not find the user since transaction rolled back
    expect(found).toBeUndefined();
  });

  it('runWithCommittedFixtures exposes committed setup to test transaction', async () => {
    await runWithCommittedFixtures(
      async (dbCommit) => {
        const email = `fixture-${Date.now()}@example.com`;
        const [u] = await dbCommit.insert(users).values({ email, passwordHash: 'x', role: 'bidder' }).returning();
        return { userEmail: u!.email };
      },
      async (tx, _withCommitted, setup) => {
        const { userEmail } = setup as any;
        // inside transaction the committed fixture should be visible
        const found = await tx.select().from(users).where(eq(users.email, userEmail)).limit(1);
        expect(found.length).toBeGreaterThan(0);
      },
    );
  });
});
