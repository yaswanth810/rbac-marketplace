/**
 * assign-admin-all-roles.ts
 *
 * Assigns all approval-relevant roles to the admin user so a single
 * account can drive the full workflow without switching logins.
 *
 * Roles assigned:
 *   Enterprise Admin     — already has this (admin approval stage)
 *   Compliance Officer   — needed for pending_compliance stage
 *   Legal Officer        — needed for pending_legal stage
 *   Treasury Officer     — needed for token.configure / token.deploy / token.mint
 *   Asset Issuer         — needed to create assets
 *   Marketplace Manager  — needed for marketplace listing + investment approval
 *
 * Idempotent — uses INSERT … ON CONFLICT DO NOTHING.
 *
 * Run:  npx tsx assign-admin-all-roles.ts
 */

import { Client } from 'pg';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
dotenv.config({ path: resolve(__dirname, '.env') });

const DATABASE_URL = process.env['DATABASE_URL'];
if (!DATABASE_URL) {
  console.error('✗  DATABASE_URL missing — set it in backend/.env');
  process.exit(1);
}

const ROLES_TO_ASSIGN = [
  'Enterprise Admin',
  'Compliance Officer',
  'Legal Officer',
  'Treasury Officer',
  'Asset Issuer',
  'Marketplace Manager',
];

// The admin email — first user created by the seed or e2e test.
// We find by wallet address (deployer = hardhat acct[0]) or fall back to
// the first Enterprise Admin in the org.
const ADMIN_WALLET = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

async function main() {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  console.log('✓  Connected\n');

  try {
    // Find the admin user — prefer by wallet, fall back to any Enterprise Admin
    let adminRes = await client.query<{ id: string; email: string }>(
      `SELECT u.id, u.email
       FROM   users u
       WHERE  lower(u.wallet_address) = lower($1)
       LIMIT  1`,
      [ADMIN_WALLET]
    );

    if (!adminRes.rows.length) {
      // Fallback: first user who already has Enterprise Admin role
      adminRes = await client.query<{ id: string; email: string }>(
        `SELECT u.id, u.email
         FROM   users u
         JOIN   user_roles ur ON ur.user_id = u.id
         JOIN   roles       r  ON r.id = ur.role_id
         WHERE  r.name = 'Enterprise Admin'
           AND  r.organization_id IS NULL
         LIMIT  1`
      );
    }

    if (!adminRes.rows.length) {
      console.error('✗  Could not find admin user. Run the seed script first.');
      process.exit(1);
    }

    const admin = adminRes.rows[0]!;
    console.log(`Admin user: ${admin.email} (${admin.id})\n`);

    // Fetch role IDs for all roles we want to assign
    const { rows: roleRows } = await client.query<{ id: string; name: string }>(
      `SELECT id, name FROM roles
       WHERE  name = ANY($1::text[])
         AND  organization_id IS NULL
         AND  is_system_role = true`,
      [ROLES_TO_ASSIGN]
    );

    const found = roleRows.map(r => r.name);
    const missing = ROLES_TO_ASSIGN.filter(n => !found.includes(n));
    if (missing.length) {
      console.warn(`  ⚠  Roles not found in DB (run database seed first): ${missing.join(', ')}`);
    }

    let assigned = 0;
    for (const role of roleRows) {
      const res = await client.query(
        `INSERT INTO user_roles (user_id, role_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [admin.id, role.id]
      );
      const isNew = res.rowCount && res.rowCount > 0;
      console.log(`  ${isNew ? '✓ assigned' : '· already '} — ${role.name}`);
      if (isNew) assigned++;
    }

    console.log(`\n✅  Done. ${assigned} new role(s) assigned to ${admin.email}.`);
    console.log('   You can now approve all stages with this single account.\n');
    console.log('   Stage → Required role:');
    console.log('     pending_compliance → Compliance Officer  ✓');
    console.log('     pending_legal      → Legal Officer       ✓');
    console.log('     pending_admin      → Enterprise Admin    ✓');
    console.log('     token.configure    → Treasury Officer    ✓');
    console.log('     marketplace.*      → Marketplace Manager ✓\n');

  } finally {
    await client.end();
  }
}

main().catch(err => {
  console.error('✗  Fatal:', err);
  process.exit(1);
});
