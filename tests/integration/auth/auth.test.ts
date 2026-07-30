/**
 * auth.test.ts — Integration tests for POST /api/auth/login and /logout
 *
 * Tests run against a real Fastify instance + real PostgreSQL test DB.
 * No mocks. Each beforeEach creates isolated fixtures; afterEach cascades them.
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
  deleteOrg,
  type TestUser,
} from '../helpers/fixtures.js';
import type { FastifyInstance } from 'fastify';

describe('Auth Endpoints', () => {
  let app: FastifyInstance;
  let http: ReturnType<typeof supertest>;
  let db: Client;
  let testOrgId: string;
  let viewer: TestUser;

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
    const org = await createOrg(db, `Auth Test Org ${Date.now()}`);
    testOrgId = org.id;
    viewer = await createUser(db, testOrgId, {
      email: `viewer-${Date.now()}@auth.test`,
    });
    await assignRoleByName(db, viewer.id, 'Viewer');
  });

  afterEach(async () => {
    await deleteOrg(db, testOrgId);
  });

  // ── POST /api/auth/login ────────────────────────────────────────────────────

  describe('POST /api/auth/login', () => {
    it('returns 200 with a JWT and user info for valid credentials', async () => {
      const res = await http
        .post('/api/auth/login')
        .send({ email: viewer.email, password: viewer.password });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        token: expect.any(String),
        expiresIn: expect.any(String),
        user: {
          id: viewer.id,
          email: viewer.email,
          organizationId: testOrgId,
          permissions: expect.arrayContaining(['organization.read', 'asset.read']),
        },
      });
      // JWT should be a valid 3-part structure
      expect(res.body.token.split('.')).toHaveLength(3);
    });

    it('updates last_login on successful login', async () => {
      await http
        .post('/api/auth/login')
        .send({ email: viewer.email, password: viewer.password });

      const { rows } = await db.query<{ last_login: Date | null }>(
        `SELECT last_login FROM users WHERE id = $1`,
        [viewer.id]
      );
      expect(rows[0]!.last_login).not.toBeNull();
    });

    it('returns 401 for wrong password', async () => {
      const res = await http
        .post('/api/auth/login')
        .send({ email: viewer.email, password: 'wrong-password!' });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Unauthorized');
    });

    it('returns 401 for unknown email (same shape as wrong password — no enumeration)', async () => {
      const res = await http
        .post('/api/auth/login')
        .send({ email: 'nobody@nobody.invalid', password: 'anything' });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Unauthorized');
    });

    it('returns 400 for missing password field', async () => {
      const res = await http
        .post('/api/auth/login')
        .send({ email: viewer.email });

      expect(res.status).toBe(400);
    });

    it('returns 400 for missing email field', async () => {
      const res = await http
        .post('/api/auth/login')
        .send({ password: viewer.password });

      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid email format', async () => {
      const res = await http
        .post('/api/auth/login')
        .send({ email: 'not-an-email', password: viewer.password });

      expect(res.status).toBe(400);
    });

    it('returns 403 for a suspended user', async () => {
      const suspended = await createUser(db, testOrgId, {
        email: `suspended-${Date.now()}@auth.test`,
        status: 'suspended',
      });

      const res = await http
        .post('/api/auth/login')
        .send({ email: suspended.email, password: suspended.password });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Forbidden');
    });

    it('returns 403 for an inactive user', async () => {
      const inactive = await createUser(db, testOrgId, {
        email: `inactive-${Date.now()}@auth.test`,
        status: 'inactive',
      });

      const res = await http
        .post('/api/auth/login')
        .send({ email: inactive.email, password: inactive.password });

      expect(res.status).toBe(403);
    });
  });

  // ── POST /api/auth/logout ───────────────────────────────────────────────────

  describe('POST /api/auth/logout', () => {
    async function loginAndGetToken(): Promise<string> {
      const res = await http
        .post('/api/auth/login')
        .send({ email: viewer.email, password: viewer.password });
      return res.body.token as string;
    }

    it('returns 200 for a valid JWT', async () => {
      const token = await loginAndGetToken();

      const res = await http
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/logged out/i);
    });

    it('returns 401 when no Authorization header is provided', async () => {
      const res = await http.post('/api/auth/logout');
      expect(res.status).toBe(401);
    });

    it('returns 401 for a malformed token', async () => {
      const res = await http
        .post('/api/auth/logout')
        .set('Authorization', 'Bearer not.a.jwt');

      expect(res.status).toBe(401);
    });

    it('returns 401 for a token with a wrong signature', async () => {
      const token = await loginAndGetToken();
      const parts = token.split('.');
      // Corrupt the signature part
      const tampered = `${parts[0]}.${parts[1]}.INVALIDSIGNATURE`;

      const res = await http
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${tampered}`);

      expect(res.status).toBe(401);
    });
  });
});
