/**
 * seed-role-users.ts
 *
 * Creates one dedicated user account per system role, all in the SAME
 * organization as the first existing organization in the database.
 *
 * If the organization doesn't exist yet (fresh DB), it creates one.
 *
 * Idempotent — uses ON CONFLICT DO NOTHING so it's safe to re-run.
 *
 * Run:
 *   cd backend
 *   npx tsx seed-role-users.ts
 *
 * After running, log in with any of the credentials printed at the end.
 * All passwords: RolePass1!
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
if (!DATABASE_URL) { console.error('DATABASE_URL missing'); process.exit(1); }

// One user per system role — email pattern is <slug>@roles.test
const ROLE_USERS: Array<{ name: string; email: string; role: string }> = [
  { name: 'Alice Admin',          email: 'e2e-admin@test.com',         role: 'Enterprise Admin'   },
  { name: 'Alice Admin',          email: 'admin@demo.com',             role: 'Enterprise Admin'   },
  { name: 'Isaac Issuer',         email: 'issuer@demo.com',            role: 'Asset Issuer'       },
  { name: 'Compliance Chris',     email: 'compliance@roles.test',      role: 'Compliance Officer' },
  { name: 'Legal Lara',           email: 'legal@roles.test',           role: 'Legal Officer'      },
  { name: 'Treasury Theo',        email: 'treasury@roles.test',        role: 'Treasury Officer'   },
  { name: 'Market Maya',          email: 'marketplace@roles.test',     role: 'Marketplace Manager'},
  { name: 'Ops Oliver',           email: 'ops@roles.test',             role: 'Operations Manager' },
  { name: 'Auditor Ava',          email: 'auditor@roles.test',         role: 'Auditor'            },
  { name: 'Investor Ivan',        email: 'investor@demo.com',          role: 'Investor'           },
  { name: 'Investor Isla',        email: 'investor@roles.test',        role: 'Investor'           },
];

const PASSWORD = 'RolePass1!';

async function main() {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  console.log('✓  Connected\n');

  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  try {
    // ── Get or create organization ─────────────────────────────────────────────
    const { rows: orgs } = await client.query<{ id: string; name: string }>(
      `SELECT id, name FROM organizations LIMIT 1`
    );

    let orgId: string;
    if (orgs.length > 0) {
      orgId = orgs[0]!.id;
      console.log(`Using existing org: "${orgs[0]!.name}" (${orgId})\n`);
    } else {
      const { rows: newOrg } = await client.query<{ id: string }>(
        `INSERT INTO organizations (name) VALUES ('Demo Capital Partners') RETURNING id`
      );
      orgId = newOrg[0]!.id;
      console.log(`Created new org: "Demo Capital Partners" (${orgId})\n`);
    }

    // ── Fetch system roles ─────────────────────────────────────────────────────
    const { rows: roleRows } = await client.query<{ id: string; name: string }>(
      `SELECT id, name FROM roles WHERE organization_id IS NULL AND is_system_role = true`
    );
    const roleByName = Object.fromEntries(roleRows.map(r => [r.name, r.id]));

    const missing = [...new Set(ROLE_USERS.map(u => u.role))].filter(r => !roleByName[r]);
    if (missing.length > 0) {
      console.error(`✗  Missing system roles in DB: ${missing.join(', ')}`);
      console.error('   Run: cd database && npx tsx seed.ts  first.\n');
      process.exit(1);
    }

    // ── Insert users + assign roles ────────────────────────────────────────────
    console.log('Creating users and assigning roles:\n');
    const created: Array<{ email: string; role: string; status: string }> = [];

    for (const u of ROLE_USERS) {
      // Insert user (skip if email already exists)
      const { rows: userRows } = await client.query<{ id: string }>(
        `INSERT INTO users
           (organization_id, name, email, password_hash, kyc_status, status)
         VALUES
           ($1::uuid, $2, $3, $4, 'approved', 'active')
         ON CONFLICT (email) DO NOTHING
         RETURNING id`,
        [orgId, u.name, u.email, passwordHash]
      );

      let userId: string;
      let userStatus: string;

      if (userRows[0]) {
        userId = userRows[0].id;
        userStatus = 'created';
      } else {
        // User already exists — look them up
        const { rows: existing } = await client.query<{ id: string }>(
          `SELECT id FROM users WHERE email = $1`, [u.email]
        );
        userId = existing[0]!.id;
        userStatus = 'already existed';
      }

      // Assign role (skip if already assigned)
      const roleId = roleByName[u.role]!;
      await client.query(
        `INSERT INTO user_roles (user_id, role_id)
         VALUES ($1::uuid, $2::uuid)
         ON CONFLICT DO NOTHING`,
        [userId, roleId]
      );

      created.push({ email: u.email, role: u.role, status: userStatus });
      console.log(`  ${userStatus === 'created' ? '✓' : '·'} ${u.email.padEnd(30)} → ${u.role} (${userStatus})`);
    }

    // ── Print login table ──────────────────────────────────────────────────────
    console.log('\n' + '═'.repeat(70));
    console.log('  LOGIN CREDENTIALS (all passwords: RolePass1!)');
    console.log('═'.repeat(70));
    console.log(`  ${'EMAIL'.padEnd(35)} ROLE`);
    console.log('─'.repeat(70));
    for (const u of ROLE_USERS) {
      console.log(`  ${u.email.padEnd(35)} ${u.role}`);
    }
    console.log('═'.repeat(70));
    console.log('\n✅  Done! You can now log in as any of the above users.\n');
    console.log('  Approval flow:');
    console.log('  1. Log in as issuer@demo.com → create asset → submit for review');
    console.log('  2. Log in as compliance@roles.test → approve');
    console.log('  3. Log in as legal@roles.test → approve');
    console.log('  4. Log in as admin@demo.com (or e2e-admin@test.com) → final approval');
    console.log('  5. Log in as treasury@roles.test → configure + deploy token');
    console.log('  6. Log in as marketplace@roles.test → create listing + publish');
    console.log('  7. Log in as investor@roles.test → browse + invest\n');

  } finally {
    await client.end();
  }
}

main().catch(err => { console.error('✗  Fatal:', err); process.exit(1); });
