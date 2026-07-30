/**
 * helpers/db.ts
 *
 * Thin wrapper around node-postgres for fixture setup/teardown.
 * Tests create a Client per suite (beforeAll) and close it (afterAll).
 * Using a raw pg Client (not Prisma) keeps test helpers independent
 * of the backend's generated client and avoids import side-effects.
 */

import { Client } from 'pg';

/**
 * Creates and connects a pg Client targeting the test database.
 * Caller is responsible for calling client.end() in afterAll.
 */
export async function createTestDbClient(): Promise<Client> {
  const connectionString =
    process.env['TEST_DATABASE_URL'] ?? process.env['DATABASE_URL'];

  if (!connectionString) {
    throw new Error(
      'TEST_DATABASE_URL or DATABASE_URL must be set. Check tests/.env'
    );
  }

  const client = new Client({ connectionString });
  await client.connect();
  return client;
}
