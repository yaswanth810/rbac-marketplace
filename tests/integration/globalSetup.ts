/**
 * globalSetup.ts — Vitest global setup (runs once before all test files)
 *
 * Validates that the test database is ready:
 *   1. Migrations have been applied (organizations table exists)
 *   2. Seed data is present (system roles exist)
 *
 * This setup does NOT apply migrations itself — that must be done manually
 * before running tests (see tests/.env.example for instructions).
 * This keeps test startup fast and prevents accidental schema changes.
 */

import { Client } from 'pg';
import * as dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: resolve(__dirname, '../.env') });

export async function setup(): Promise<void> {
  const testDbUrl = process.env['TEST_DATABASE_URL'];

  if (!testDbUrl) {
    throw new Error(
      '\n✗  TEST_DATABASE_URL is not configured.\n' +
      '   Copy tests/.env.example → tests/.env and set TEST_DATABASE_URL.\n'
    );
  }

  const client = new Client({ connectionString: testDbUrl });

  try {
    await client.connect();

    // 1. Verify migrations have been applied
    const { rows: tableRows } = await client.query<{ exists: number }>(`
      SELECT 1 AS exists
      FROM   information_schema.tables
      WHERE  table_schema = 'public'
        AND  table_name   = 'organizations'
    `);

    if (tableRows.length === 0) {
      throw new Error(
        '\n✗  Test database is missing schema.\n' +
        '   Apply migrations first:\n\n' +
        '   cd database\n' +
        '   # Edit .env to point DATABASE_URL at the test DB\n' +
        '   npx tsx migrate.ts\n' +
        '   npx tsx seed.ts\n'
      );
    }

    // 2. Verify seed data (system roles) exists
    const { rows: roleRows } = await client.query<{ cnt: string }>(`
      SELECT count(*)::text AS cnt
      FROM   roles
      WHERE  is_system_role = true
    `);

    const roleCount = parseInt(roleRows[0]?.cnt ?? '0', 10);
    if (roleCount === 0) {
      throw new Error(
        '\n✗  Seed data is missing from the test database.\n' +
        '   Run: cd database && npx tsx seed.ts\n'
      );
    }

    console.log(`\n✓  Test database ready (${roleCount} system roles found)\n`);
  } finally {
    await client.end();
  }
}

export async function teardown(): Promise<void> {
  // No global teardown needed.
  // Each test suite cleans up its fixtures in afterEach via deleteOrg() (cascade).
}
