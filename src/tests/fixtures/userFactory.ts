import { users } from '../../db/schema.js';
import { randomUUID } from 'crypto';

export async function createTestUsers(txDb: any, count = 10, role = 'bidder') {
  const rows = Array.from({ length: count }).map((_, i) => ({
    email: `test-${role}-${randomUUID()}-${i}@example.com`,
    passwordHash: 'testhash',
    role,
  }));

  const inserted = await txDb.insert(users).values(rows).returning();
  return inserted;
}

export async function createTestUser(txDb: any, overrides: Partial<{ email: string; role: string }> = {}) {
  const row = {
    email: overrides.email ?? `test-user-${randomUUID()}@example.com`,
    passwordHash: 'testhash',
    role: overrides.role ?? 'bidder',
  };
  const [inserted] = await txDb.insert(users).values(row).returning();
  return inserted;
}

export default createTestUsers;
