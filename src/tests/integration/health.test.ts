import { describe, it, expect } from 'vitest';
import { checkDatabaseConnection } from '../../db/index.js';

describe('test infrastructure', () => {
  it('db connects', async () => {
    await expect(checkDatabaseConnection()).resolves.not.toThrow();
  });
});