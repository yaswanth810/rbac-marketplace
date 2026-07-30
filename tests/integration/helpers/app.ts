/**
 * helpers/app.ts
 *
 * Builds a Fastify app instance suitable for supertest — no listen() call,
 * just app.ready(). Supertest injects requests directly via app.server
 * (Node's http.IncomingMessage interface), so no port is bound.
 *
 * The env vars injected by vitest.config.ts (DATABASE_URL, JWT_SECRET, etc.)
 * are already set before this module is imported, so PrismaClient and the JWT
 * plugin pick up the test values automatically.
 */

import { buildApp } from '../../../backend/src/app.js';
import type { FastifyInstance } from 'fastify';

let _app: FastifyInstance | null = null;

/**
 * Returns a ready Fastify instance. Reuses the existing instance within the
 * same worker process (one instance per test file with pool: 'forks').
 */
export async function getTestApp(): Promise<FastifyInstance> {
  if (!_app) {
    _app = await buildApp();
    await _app.ready();
  }
  return _app;
}

/**
 * Closes the Fastify instance and resets the singleton.
 * Call in afterAll() of each test suite.
 */
export async function closeTestApp(): Promise<void> {
  if (_app) {
    await _app.close();
    _app = null;
  }
}
