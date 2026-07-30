/**
 * helpers/fixtures.ts
 *
 * Fixture helpers for creating isolated test data.
 *
 * Design principles:
 *   - Each test suite creates one org; deleting it cascades to all children.
 *   - Unique emails use Date.now() + Math.random() to survive parallel workers.
 *   - bcrypt salt rounds = 4 (vs production 10) for fast test execution.
 *   - All helpers are idempotent where possible (ON CONFLICT DO NOTHING).
 */

import { type Client } from 'pg';
import bcrypt from 'bcryptjs';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TestOrg {
  id: string;
  name: string;
}

export interface TestUser {
  id: string;
  email: string;
  /** Plaintext password — needed to call POST /api/auth/login in tests */
  password: string;
}

export interface TestAsset {
  id: string;
  organizationId: string;
}

// ─── Organization ─────────────────────────────────────────────────────────────

export async function createOrg(client: Client, name: string): Promise<TestOrg> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO organizations (name) VALUES ($1) RETURNING id`,
    [name]
  );
  return { id: rows[0]!.id, name };
}

/** Deletes the org and all child records (users, assets, roles, etc.) via CASCADE. */
export async function deleteOrg(client: Client, orgId: string): Promise<void> {
  await client.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);
}

// ─── Users ────────────────────────────────────────────────────────────────────

export interface CreateUserOptions {
  name?: string;
  email?: string;
  password?: string;
  /** user_status_enum value — default 'active' */
  status?: 'active' | 'inactive' | 'suspended';
  /** kyc_status_enum value — default 'approved' */
  kycStatus?: 'pending' | 'submitted' | 'approved' | 'rejected';
}

export async function createUser(
  client: Client,
  orgId: string,
  options: CreateUserOptions = {}
): Promise<TestUser> {
  const password = options.password ?? 'TestPass123!';
  const email =
    options.email ?? `test-${Date.now()}-${Math.floor(Math.random() * 1e6)}@rbac.test`;

  // Low rounds (4) so bcrypt doesn't slow down tests
  const passwordHash = await bcrypt.hash(password, 4);

  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO users
       (organization_id, name, email, password_hash, status, kyc_status)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      orgId,
      options.name ?? 'Test User',
      email,
      passwordHash,
      options.status ?? 'active',
      options.kycStatus ?? 'approved',
    ]
  );

  return { id: rows[0]!.id, email, password };
}

// ─── Roles ────────────────────────────────────────────────────────────────────

/**
 * Assigns a platform system role (organization_id IS NULL) to a user by name.
 * Roles must exist (populated by seed.ts) before this is called.
 */
export async function assignRoleByName(
  client: Client,
  userId: string,
  roleName: string
): Promise<void> {
  const { rows } = await client.query<{ id: string }>(
    `SELECT id FROM roles
     WHERE  name = $1
       AND  organization_id IS NULL
       AND  is_system_role  = true`,
    [roleName]
  );

  if (rows.length === 0) {
    throw new Error(
      `System role "${roleName}" not found. Ensure seed.ts has been run on the test database.`
    );
  }

  await client.query(
    `INSERT INTO user_roles (user_id, role_id)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [userId, rows[0]!.id]
  );
}

/**
 * Removes a platform system role from a user.
 * Used by Test 5 (role removal takes immediate effect).
 */
export async function removeRoleByName(
  client: Client,
  userId: string,
  roleName: string
): Promise<void> {
  await client.query(
    `DELETE FROM user_roles ur
     USING  roles r
     WHERE  ur.role_id = r.id
       AND  ur.user_id = $1
       AND  r.name     = $2
       AND  r.organization_id IS NULL`,
    [userId, roleName]
  );
}

// ─── Assets ───────────────────────────────────────────────────────────────────

/**
 * Inserts an asset record directly into the DB (bypasses the API).
 * Used by Test 4 (cross-org isolation) to create an asset in Org B
 * without going through the POST /api/assets endpoint.
 */
export async function createTestAsset(
  client: Client,
  orgId: string,
  issuerId: string
): Promise<TestAsset> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO assets (organization_id, name, asset_type, issuer_id, status)
     VALUES ($1, $2, 'equity', $3, 'draft')
     RETURNING id`,
    [orgId, `Test Asset ${Date.now()}`, issuerId]
  );

  return { id: rows[0]!.id, organizationId: orgId };
}
