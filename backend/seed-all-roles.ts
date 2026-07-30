/**
 * seed-all-roles.ts
 *
 * Creates one demo user for every platform role.
 * Safe to re-run — uses INSERT … ON CONFLICT DO NOTHING.
 *
 * Run: npx tsx seed-all-roles.ts
 * Prereq: backend/.env has DATABASE_URL pointing at the running Postgres.
 */

import { Client } from 'pg';
import bcrypt from 'bcryptjs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
dotenv.config({ path: resolve(__dirname, '.env') });

const DATABASE_URL = process.env['DATABASE_URL'];
if (!DATABASE_URL) {
  console.error('✗  DATABASE_URL missing — copy backend/.env and set it.');
  process.exit(1);
}

// ── Config ────────────────────────────────────────────────────────────────────
const PASSWORD     = 'Demo1234!';
const ORG_NAME     = 'Demo Organization';

// Every platform role gets a user.
// wallet_address is set for Admin (deployer) and Investor (hardhat acct[1]).
const ROLE_USERS = [
  {
    role:    'Platform Admin',
    name:    'Platform Admin',
    email:   'platform-admin@demo.com',
    wallet:  null,
    kyc:     'approved',
  },
  {
    role:    'Enterprise Admin',
    name:    'Enterprise Admin',
    email:   'admin@demo.com',
    wallet:  '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', // hardhat acct[0]
    kyc:     'approved',
  },
  {
    role:    'Treasury Officer',
    name:    'Treasury Officer',
    email:   'treasury@demo.com',
    wallet:  null,
    kyc:     'approved',
  },
  {
    role:    'Asset Issuer',
    name:    'Asset Issuer',
    email:   'issuer@demo.com',
    wallet:  null,
    kyc:     'submitted',
  },
  {
    role:    'Compliance Officer',
    name:    'Compliance Officer',
    email:   'compliance@demo.com',
    wallet:  null,
    kyc:     'submitted',
  },
  {
    role:    'Legal Officer',
    name:    'Legal Officer',
    email:   'legal@demo.com',
    wallet:  null,
    kyc:     'submitted',
  },
  {
    role:    'Marketplace Manager',
    name:    'Marketplace Manager',
    email:   'marketplace@demo.com',
    wallet:  null,
    kyc:     'submitted',
  },
  {
    role:    'Operations Manager',
    name:    'Operations Manager',
    email:   'operations@demo.com',
    wallet:  null,
    kyc:     'submitted',
  },
  {
    role:    'Auditor',
    name:    'Auditor',
    email:   'auditor@demo.com',
    wallet:  null,
    kyc:     'submitted',
  },
  {
    role:    'Investor',
    name:    'Investor',
    email:   'investor@demo.com',
    wallet:  '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', // hardhat acct[1]
    kyc:     'approved',
  },
  {
    role:    'Viewer',
    name:    'Viewer',
    email:   'viewer@demo.com',
    wallet:  null,
    kyc:     'submitted',
  },
];

// ── Padding helper ────────────────────────────────────────────────────────────
function pad(s: string, n: number) { return s.padEnd(n); }

async function main() {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  console.log('✓  Connected\n');

  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  try {
    await client.query('BEGIN');

    // 1. Ensure org exists
    const orgRes = await client.query<{ id: string }>(
      `INSERT INTO organizations (name)
       VALUES ($1)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [ORG_NAME]
    );
    let orgId: string;
    if (orgRes.rows.length > 0) {
      orgId = orgRes.rows[0]!.id;
    } else {
      const found = await client.query<{ id: string }>(
        `SELECT id FROM organizations WHERE name = $1`,
        [ORG_NAME]
      );
      orgId = found.rows[0]!.id;
    }
    console.log(`Org: ${ORG_NAME}  (${orgId})\n`);

    // 2. Fetch all system roles
    const { rows: roleRows } = await client.query<{ id: string; name: string }>(
      `SELECT id, name FROM roles WHERE organization_id IS NULL AND is_system_role = true`
    );
    const roleIdByName = Object.fromEntries(roleRows.map(r => [r.name, r.id]));

    // 3. Upsert users + assign roles
    const results: Array<{ role: string; email: string; password: string; userId: string; note: string }> = [];

    for (const u of ROLE_USERS) {
      // Insert user (skip if email already exists)
      const userRes = await client.query<{ id: string }>(
        `INSERT INTO users
           (organization_id, name, email, password_hash, kyc_status, status, wallet_address)
         VALUES
           ($1, $2, $3, $4, $5::kyc_status_enum, 'active'::user_status_enum, $6)
         ON CONFLICT (email) DO NOTHING
         RETURNING id`,
        [orgId, u.name, u.email, passwordHash, u.kyc, u.wallet]
      );

      let userId: string;
      if (userRes.rows.length > 0) {
        userId = userRes.rows[0]!.id;
      } else {
        const existing = await client.query<{ id: string }>(
          `SELECT id FROM users WHERE email = $1`,
          [u.email]
        );
        userId = existing.rows[0]!.id;
      }

      // Assign role (skip if already assigned)
      const roleId = roleIdByName[u.role];
      if (roleId) {
        await client.query(
          `INSERT INTO user_roles (user_id, role_id)
           VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [userId, roleId]
        );
      } else {
        console.warn(`  ⚠  Role not found: ${u.role}`);
      }

      results.push({
        role: u.role,
        email: u.email,
        password: PASSWORD,
        userId,
        note: u.kyc === 'approved' && u.wallet
          ? `kyc=approved, wallet=${u.wallet.slice(0, 10)}…`
          : u.kyc === 'approved'
            ? 'kyc=approved'
            : '',
      });
    }

    await client.query('COMMIT');

    // ── Print credentials table ───────────────────────────────────────────────
    console.log('═'.repeat(90));
    console.log('  ALL-ROLE DEMO CREDENTIALS');
    console.log('═'.repeat(90));
    console.log(`  ${'Role'.padEnd(24)} ${'Email'.padEnd(28)} ${'Password'.padEnd(14)} Notes`);
    console.log('─'.repeat(90));
    for (const r of results) {
      console.log(`  ${pad(r.role, 24)} ${pad(r.email, 28)} ${pad(r.password, 14)} ${r.note}`);
    }
    console.log('═'.repeat(90));
    console.log(`\n  Organization: ${ORG_NAME}`);
    console.log(`  All passwords: ${PASSWORD}`);
    console.log('');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('✗  Failed:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
