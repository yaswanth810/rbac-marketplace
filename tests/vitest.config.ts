/**
 * vitest.config.ts
 *
 * Key decisions:
 *   - pool: 'forks'  — each test file runs in a separate Node.js process,
 *     which is required for ESM + native pg + Fastify to work cleanly.
 *
 *   - env.DATABASE_URL is set to TEST_DATABASE_URL from tests/.env so the
 *     backend's PrismaClient (which reads DATABASE_URL) targets the test DB,
 *     not the development DB — with no code changes in the backend.
 *
 *   - NODE_ENV=test disables pino-pretty in app.ts and silences Fastify logs
 *     so test output only shows test results.
 *
 *   - JWT_SECRET is a known value so tests can verify token claims if needed.
 */

import { defineConfig } from 'vitest/config';
import * as dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load tests/.env before building the config
const testEnv = dotenv.config({ path: resolve(__dirname, '.env') }).parsed ?? {};

const testDbUrl = testEnv['TEST_DATABASE_URL'] ?? '';
if (!testDbUrl) {
  console.warn(
    '\n⚠  TEST_DATABASE_URL is not set in tests/.env\n' +
    '   Copy tests/.env.example → tests/.env and configure it.\n'
  );
}

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',

    // Runs once before all test files: verifies the test DB is ready
    globalSetup: ['./integration/globalSetup.ts'],

    // Only run files under integration/
    include: ['integration/**/*.test.ts'],

    // Separate process per file — required for ESM + Fastify + pg
    pool: 'forks',

    // Timeouts generous for DB operations
    testTimeout: 30_000,
    hookTimeout: 30_000,

    // Inject env vars into every test worker process
    env: {
      // Route backend's PrismaClient to the test database
      DATABASE_URL: testDbUrl,
      TEST_DATABASE_URL: testDbUrl,

      NODE_ENV: 'test',

      // Auth
      JWT_SECRET: testEnv['JWT_SECRET'] ?? 'test_jwt_secret_for_rbac_tests_32char',
      JWT_EXPIRES_IN: '1h',

      // Server (not needed for supertest, included for completeness)
      HOST: '127.0.0.1',
      PORT: '0',
      CORS_ORIGIN: '*',
    },
  },
});
