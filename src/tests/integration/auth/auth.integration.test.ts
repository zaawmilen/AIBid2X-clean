import { describe, it, expect } from 'vitest';
import { runInTransaction } from '../../setup/transaction.js';
import { register, login } from '../../../services/auth.service.js';
import { AppError } from '../../../lib/errors.js';

describe('Auth', () => {
  it('registers user',
     { timeout: 20000 },
    async () => {
    await runInTransaction(async (tx) => {
      const user = await register({ email: `t-${Date.now()}@example.com`, password: 'password123', role: 'bidder' });
      expect(user).toBeDefined();
      expect(user!.email).toMatch(/@example.com$/);
    });
  });

  it('rejects duplicate email', async () => {
    await runInTransaction(async (tx) => {
      const email = `dup-${Date.now()}@example.com`;
      await register({ email, password: 'password', role: 'bidder' });
      let thrown = false;
      try {
        await register({ email, password: 'password', role: 'bidder' });
      } catch (e: any) {
        thrown = true;
        expect(e).toBeInstanceOf(AppError);
        expect((e as AppError).code).toBe('EMAIL_TAKEN');
      }
      expect(thrown).toBe(true);
    });
  });

  it('logs in user', async () => {
    await runInTransaction(async (tx) => {
      const email = `login-${Date.now()}@example.com`;
      const password = 'pw12345';
      await register({ email, password, role: 'bidder' });
      const session = await login({ email, password });
      expect(session).toBeDefined();
      expect(session.user.email).toBe(email);
      expect(typeof session.accessToken).toBe('string');
    });
  });
});