/**
 * database/migrate.ts
 *
 * Runs all SQL migration files in numerical order against the
 * configured DATABASE_URL. Each file is executed as a single
 * query (the files themselves wrap DDL in BEGIN/COMMIT).
 *
 * Run:
 *   cd database
 *   npx tsx migrate.ts
 *
 * Idempotency note:
 *   Migrations are NOT idempotent by default (CREATE TABLE will
 *   fail on re-run). Use this script on a fresh database, or
 *   add IF NOT EXISTS clauses manually if you need re-runs.
 *   For production, layer a proper migration tracker on top.
 */

import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '.env') });

const DATABASE_URL = process.env['DATABASE_URL'];
if (!DATABASE_URL) {
  console.error('✗  DATABASE_URL is required. Copy .env.example → .env and set it.');
  process.exit(1);
}

const MIGRATIONS_DIR = path.resolve(__dirname, 'migrations');

async function migrate(): Promise<void> {
  const client = new Client({ connectionString: DATABASE_URL });

  try {
    await client.connect();
    console.log('✓  Connected to database\n');

    // Read migration files, sorted numerically by the NNN_ prefix
    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql') && !f.startsWith('.'))
      .sort(); // lexicographic sort works because files are zero-padded (001_, 002_, …)

    console.log(`Found ${files.length} migration file(s):\n`);

    for (const file of files) {
      const filePath = path.join(MIGRATIONS_DIR, file);
      const sql = fs.readFileSync(filePath, 'utf-8');

      process.stdout.write(`  Running ${file} ... `);
      try {
        await client.query(sql);
        console.log('✓');
      } catch (err) {
        console.log('✗');
        throw new Error(
          `Migration failed: ${file}\n${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    console.log('\n✅  All migrations applied successfully.');
  } catch (err) {
    console.error('\n✗  Migration runner failed:\n', err instanceof Error ? err.message : err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

migrate();
