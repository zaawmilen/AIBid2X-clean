import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { hashPassword, comparePassword } from '../lib/password.js';
import { signAccessToken } from '../lib/jwt.js';
import { storeRefreshToken, rotateRefreshToken, revokeRefreshToken } from '../lib/tokens.js';
import { AppError } from '../lib/errors.js';
import type { RegisterInput, LoginInput } from '../validators/auth.js';

const DUMMY_HASH = '$2b$12$K8GpYyC7VpQLu5VyVnCHCuIqG5GjBd5KVHcJdX3o5tElYVqfV5g8e';

export async function register(input: RegisterInput) {
  const existing = await db.query.users.findFirst({
    where: eq(users.email, input.email),
    columns: { id: true },
  });
  if (existing) throw AppError.conflict('An account with this email already exists', 'EMAIL_TAKEN');

  const passwordHash = await hashPassword(input.password);
  const [user] = await db.insert(users).values({ email: input.email, passwordHash, role: input.role })
    .returning({ id: users.id, email: users.email, role: users.role, createdAt: users.createdAt });
  return user;
}

export async function login(input: LoginInput) {
  const user = await db.query.users.findFirst({ where: eq(users.email, input.email) });
  const passwordMatch = await comparePassword(input.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !passwordMatch) throw AppError.unauthorized('Invalid email or password');

  const accessToken = signAccessToken({ sub: user.id, email: user.email, role: user.role });
  const refreshToken = await storeRefreshToken({ userId: user.id, email: user.email, role: user.role });
  return { accessToken, refreshToken, user: { id: user.id, email: user.email, role: user.role } };
}

export async function refresh(oldTokenId: string) {
  const result = await rotateRefreshToken(oldTokenId);
  if (!result) throw AppError.unauthorized('Invalid or expired refresh token');
  const { newTokenId, data } = result;
  const accessToken = signAccessToken({ sub: data.userId, email: data.email, role: data.role });
  return { accessToken, refreshToken: newTokenId };
}

export async function logout(tokenId: string): Promise<void> {
  await revokeRefreshToken(tokenId);
}
