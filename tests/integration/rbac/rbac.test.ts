/**
 * rbac.test.ts — Integration tests for requirePermission middleware
 *
 * Tests the 6 RBAC scenarios specified in the implementation plan.
 * All tests use real HTTP requests against a live Fastify + PostgreSQL stack.
 * No mocks — permissions are enforced via live DB queries in requirePermission().
 *
 * Test index:
 *   1. Asset Issuer CAN create an asset (asset.create → 201)
 *   2. Investor CANNOT create an asset (no asset.create → 403)
 *   3a. Compliance Officer CAN reach the compliance approval endpoint
 *   3b. Compliance Officer CANNOT deploy tokens (no token.deploy → 403)
 *   4. Cross-org isolation (Org A user cannot access Org B asset → 403, not 404)
 *   5. Role removal immediately revokes permissions (same JWT, next request → 403)
 *   6a. No JWT → 401
 *   6b. Invalid/tampered JWT → 401
 *   6c. Valid JWT, missing permission → 403
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import supertest from 'supertest';
import { type Client } from 'pg';
import { getTestApp, closeTestApp } from '../helpers/app.js';
import { createTestDbClient } from '../helpers/db.js';
import {
  createOrg,
  createUser,
  assignRoleByName,
  removeRoleByName,
  createTestAsset,
  deleteOrg,
} from '../helpers/fixtures.js';
import type { FastifyInstance } from 'fastify';

describe('RBAC Integration Tests', () => {
  let app: FastifyInstance;
  let http: ReturnType<typeof supertest>;
  let db: Client;

  /** Primary test org — created fresh per test, deleted in afterEach. */
  let testOrgId: string;

  beforeAll(async () => {
    app = await getTestApp();
    http = supertest(app.server);
    db = await createTestDbClient();
  });

  afterAll(async () => {
    await db.end();
    await closeTestApp();
  });

  beforeEach(async () => {
    const org = await createOrg(db, `RBAC Test Org ${Date.now()}`);
    testOrgId = org.id;
  });

  afterEach(async () => {
    // Cascade-deletes all users, user_roles, assets, etc. under this org
    await deleteOrg(db, testOrgId);
  });

  // ── Shared helper ──────────────────────────────────────────────────────────

  async function loginAs(email: string, password: string): Promise<string> {
    const res = await http.post('/api/auth/login').send({ email, password });
    if (res.status !== 200) {
      throw new Error(
        `loginAs(${email}) failed with ${res.status}: ${JSON.stringify(res.body)}`
      );
    }
    return res.body.token as string;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Test 1: Asset Issuer CAN create an asset
  // ══════════════════════════════════════════════════════════════════════════

  it('Test 1: Asset Issuer can create an asset (asset.create → 201)', async () => {
    const issuer = await createUser(db, testOrgId, {
      email: `issuer-${Date.now()}@rbac.test`,
    });
    await assignRoleByName(db, issuer.id, 'Asset Issuer');

    const token = await loginAs(issuer.email, issuer.password);

    const res = await http
      .post('/api/assets')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Green Energy Bond', asset_type: 'bond' });

    expect(res.status).toBe(201);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Test 2: Investor CANNOT create an asset
  // ══════════════════════════════════════════════════════════════════════════

  it('Test 2: Investor cannot create an asset (no asset.create → 403)', async () => {
    const investor = await createUser(db, testOrgId, {
      email: `investor-${Date.now()}@rbac.test`,
    });
    await assignRoleByName(db, investor.id, 'Investor');

    const token = await loginAs(investor.email, investor.password);

    const res = await http
      .post('/api/assets')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Green Energy Bond', asset_type: 'bond' });

    expect(res.status).toBe(403);
    expect(res.body.message).toContain('asset.create');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Test 3a: Compliance Officer CAN approve at the compliance stage
  // ══════════════════════════════════════════════════════════════════════════

  it('Test 3a: Compliance Officer can call the compliance approve endpoint (200)', async () => {
    const co = await createUser(db, testOrgId, {
      email: `co-${Date.now()}@rbac.test`,
    });
    await assignRoleByName(db, co.id, 'Compliance Officer');

    const token = await loginAs(co.email, co.password);

    const res = await http
      .post('/api/compliance/00000000-0000-0000-0000-000000000001/approve')
      .set('Authorization', `Bearer ${token}`);

    // Stub returns 200 when the permission check passes
    expect(res.status).toBe(200);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Test 3b: Compliance Officer CANNOT deploy tokens (no token.deploy)
  // ══════════════════════════════════════════════════════════════════════════

  it('Test 3b: Compliance Officer cannot deploy tokens (no token.deploy → 403)', async () => {
    const co = await createUser(db, testOrgId, {
      email: `co2-${Date.now()}@rbac.test`,
    });
    await assignRoleByName(db, co.id, 'Compliance Officer');

    const token = await loginAs(co.email, co.password);

    const res = await http
      .post('/api/tokens/00000000-0000-0000-0000-000000000001/deploy')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.message).toContain('token.deploy');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Test 4: Cross-organization asset isolation
  // ══════════════════════════════════════════════════════════════════════════

  it('Test 4: Org A user cannot access Org B asset (403, not 404)', async () => {
    // Create a second, independent org (Org B)
    const orgB = await createOrg(db, `Org B ${Date.now()}`);

    try {
      // Alice is in Org A (testOrgId) — Auditor has asset.read
      const alice = await createUser(db, testOrgId, {
        email: `alice-${Date.now()}@rbac.test`,
      });
      await assignRoleByName(db, alice.id, 'Auditor');

      // Create an issuer and an asset in Org B (direct DB insert — no API)
      const orgBIssuer = await createUser(db, orgB.id, {
        email: `orgb-issuer-${Date.now()}@rbac.test`,
      });
      const orgBAsset = await createTestAsset(db, orgB.id, orgBIssuer.id);

      // Alice (Org A) tries to read Org B's asset
      const token = await loginAs(alice.email, alice.password);

      const res = await http
        .get(`/api/assets/${orgBAsset.id}`)
        .set('Authorization', `Bearer ${token}`);

      // Must be 403, not 404 — 404 would confirm the resource exists
      expect(res.status).toBe(403);
      expect(res.body.message).toContain('Cross-organization');
    } finally {
      // Org B is not under testOrgId, so afterEach won't clean it up
      await deleteOrg(db, orgB.id);
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Test 5: Role removal immediately revokes permissions (same JWT)
  // ══════════════════════════════════════════════════════════════════════════

  it('Test 5: Removing a role immediately revokes access — same JWT, next request', async () => {
    const issuer = await createUser(db, testOrgId, {
      email: `issuer2-${Date.now()}@rbac.test`,
    });
    await assignRoleByName(db, issuer.id, 'Asset Issuer');

    // Login once — capture JWT
    const token = await loginAs(issuer.email, issuer.password);

    // Confirm access works with this JWT
    const before = await http
      .post('/api/assets')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Test Asset', asset_type: 'equity' });
    expect(before.status).toBe(201);

    // Remove role directly in DB — do NOT re-login (same JWT will be reused)
    await removeRoleByName(db, issuer.id, 'Asset Issuer');

    // Same JWT, next request → requirePermission re-queries DB → 403
    // This proves enforcement is DB-live, not JWT-cached.
    const after = await http
      .post('/api/assets')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Test Asset 2', asset_type: 'equity' });
    expect(after.status).toBe(403);
    expect(after.body.message).toContain('asset.create');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Test 6a: No JWT → 401
  // ══════════════════════════════════════════════════════════════════════════

  it('Test 6a: Request with no Authorization header returns 401', async () => {
    const res = await http
      .post('/api/assets')
      .send({ name: 'Test', asset_type: 'equity' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Unauthorized');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Test 6b: Invalid / tampered JWT → 401
  // ══════════════════════════════════════════════════════════════════════════

  it('Test 6b: Request with a malformed JWT returns 401', async () => {
    const res = await http
      .post('/api/assets')
      .set('Authorization', 'Bearer this.is.not.a.valid.jwt')
      .send({ name: 'Test', asset_type: 'equity' });

    expect(res.status).toBe(401);
  });

  it('Test 6b: Request with a tampered JWT signature returns 401', async () => {
    const viewer = await createUser(db, testOrgId, {
      email: `viewer-${Date.now()}@rbac.test`,
    });
    await assignRoleByName(db, viewer.id, 'Viewer');

    const token = await loginAs(viewer.email, viewer.password);
    const parts = token.split('.');
    const tampered = `${parts[0]}.${parts[1]}.CORRUPTEDSIGNATURE`;

    const res = await http
      .post('/api/assets')
      .set('Authorization', `Bearer ${tampered}`)
      .send({ name: 'Test', asset_type: 'equity' });

    expect(res.status).toBe(401);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Test 6c: Valid JWT, insufficient permission → 403
  // ══════════════════════════════════════════════════════════════════════════

  it('Test 6c: Valid JWT with missing permission returns 403 (not 401)', async () => {
    // Viewer has only org.read + asset.read — NOT asset.create
    const viewer = await createUser(db, testOrgId, {
      email: `viewer2-${Date.now()}@rbac.test`,
    });
    await assignRoleByName(db, viewer.id, 'Viewer');

    const token = await loginAs(viewer.email, viewer.password);

    const res = await http
      .post('/api/assets')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Test', asset_type: 'equity' });

    // 403 (valid identity, insufficient privilege) — NOT 401
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Forbidden');
    expect(res.body.message).toContain('asset.create');
  });
});
