/**
 * auth.service.ts
 *
 * Core authentication logic: credential validation, permission resolution,
 * and last-login tracking. No HTTP concerns — pure DB operations.
 */

import { type PrismaClient, Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LoginResult {
  userId: string;
  organizationId: string;
  name: string;
  email: string;
  permissions: string[];
}

// Internal error codes — translated to HTTP status codes in the route handler
type AuthError = 'INVALID_CREDENTIALS' | 'ACCOUNT_INACTIVE';

// ─── Login ────────────────────────────────────────────────────────────────────

/**
 * Validates email/password credentials and returns user info + permissions.
 *
 * Throws a string error code so the route handler can map it to the
 * correct HTTP status without leaking internal details to the client.
 */
export async function loginUser(
  prisma: PrismaClient,
  email: string,
  password: string
): Promise<LoginResult> {
  // Use $queryRaw instead of prisma.user.findUnique() because the users table
  // uses PostgreSQL custom enum types (user_status_enum, kyc_status_enum) which
  // Prisma's ORM layer cannot automatically convert to String fields.
  const rows = await prisma.$queryRaw<Array<{
    id: string;
    organization_id: string;
    name: string;
    email: string;
    password_hash: string;
    status: string;
  }>>(
    Prisma.sql`SELECT id, organization_id, name, email, password_hash, status::text
               FROM users WHERE email = ${email} LIMIT 1`
  );

  const user = rows[0];

  if (!user) {
    throw new Error('INVALID_CREDENTIALS' satisfies AuthError);
  }

  if (user.status !== 'active') {
    throw new Error('ACCOUNT_INACTIVE' satisfies AuthError);
  }

  const passwordMatch = await bcrypt.compare(password, user.password_hash);
  if (!passwordMatch) {
    throw new Error('INVALID_CREDENTIALS' satisfies AuthError);
  }

  // 2. Resolve permissions from DB
  const permissions = await resolvePermissions(prisma, user.id);

  // 3. Stamp last_login — non-critical, do not let failure block login
  prisma.$queryRaw(
    Prisma.sql`UPDATE users SET last_login = now() WHERE id = ${user.id}::uuid`
  ).catch(() => { /* swallow — last_login is informational only */ });

  return {
    userId: user.id,
    organizationId: user.organization_id,
    name: user.name,
    email: user.email,
    permissions,
  };
}


// ─── Permission resolution ────────────────────────────────────────────────────

/**
 * Resolves the current set of permission keys for a user by joining
 * user_roles → role_permissions → permissions.
 *
 * This is the canonical permission query, shared by:
 *   - loginUser()          (to populate the JWT payload for the client)
 *   - requirePermission()  (to enforce server-side, live from DB)
 *
 * Using $queryRaw for an efficient single-round-trip join instead of
 * Prisma's nested includes (which would generate N+1 queries).
 */
export async function resolvePermissions(
  prisma: PrismaClient,
  userId: string
): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ key: string }>>(
    Prisma.sql`
      SELECT DISTINCT p.key
      FROM   permissions      p
      JOIN   role_permissions rp ON p.id  = rp.permission_id
      JOIN   user_roles       ur ON ur.role_id = rp.role_id
      WHERE  ur.user_id = ${userId}::uuid
      ORDER  BY p.key
    `
  );

  return rows.map((r) => r.key);
}
