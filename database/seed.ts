/**
 * database/seed.ts
 *
 * Idempotent seed script — safe to run multiple times.
 * Uses ON CONFLICT DO NOTHING (or DO UPDATE for upserts).
 *
 * Inserts:
 *   • 34 permissions
 *   • 10 platform system roles (organization_id = NULL)
 *   • role → permission mappings (least-privilege)
 *   • 3 approval stage → role entries
 *
 * Run:
 *   cd database
 *   npx tsx seed.ts
 *
 * Prerequisites:
 *   • .env file with DATABASE_URL set
 *   • All 10 migrations applied (run migrate.ts first)
 */

import { Client } from 'pg';
import * as dotenv from 'dotenv';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: resolve(__dirname, '.env') });

const DATABASE_URL = process.env['DATABASE_URL'];
if (!DATABASE_URL) {
  console.error('✗  DATABASE_URL is required. Copy .env.example → .env and set it.');
  process.exit(1);
}

// ─── 1. All 34 permission keys ────────────────────────────────────────────────

const PERMISSIONS: string[] = [
  // Organization
  'organization.read',
  'organization.update',
  // Users
  'user.create',
  'user.read',
  'user.update',
  'user.delete',
  // Roles & permissions
  'role.create',
  'role.update',
  'role.assign',
  'permission.manage',
  // Assets
  'asset.create',
  'asset.read',
  'asset.update',
  'asset.submit',
  'asset.approve',
  'asset.reject',
  // Tokens
  'token.configure',
  'token.deploy',
  'token.mint',
  'token.burn',
  'token.pause',
  // Compliance
  'compliance.review',
  'compliance.approve',
  'compliance.reject',
  // Marketplace
  'marketplace.create',
  'marketplace.publish',
  'marketplace.unpublish',
  // Investments
  'investment.view',
  'investment.create',
  'investment.approve',
  // Transactions
  'transaction.view',
  'transaction.approve',
  // Audit
  'audit.view',
  'report.export',
];

// ─── 2. Role → Permission mapping (least-privilege) ───────────────────────────
//
// Rationale per role:
//
//   Platform Admin    — all permissions; system-level superuser
//   Enterprise Admin  — org + user + role management, asset approval gate,
//                       read-only financials; asset.approve/reject added per spec
//   Asset Issuer      — full asset lifecycle up to submit; token config only
//                       (not deploy — that's Treasury's job)
//   Compliance Officer— drives compliance gate; can approve/reject at that stage
//   Legal Officer     — legal sign-off stage; can see compliance reviews but
//                       cannot issue compliance decisions
//   Treasury Officer  — full token lifecycle + transaction settlement
//   Marketplace Mgr   — listing management + investor onboarding approval
//   Operations Manager— wide read + reporting; no write/approval rights
//   Auditor           — widest read footprint; no write at all
//   Investor          — browse + invest; nothing else
//   Viewer            — narrowest read-only access

const ROLE_PERMISSIONS: Record<string, string[]> = {
  'Platform Admin': [...PERMISSIONS], // all 34

  'Enterprise Admin': [
    'organization.read',
    'organization.update',
    'user.create',
    'user.read',
    'user.update',
    'user.delete',
    'role.create',
    'role.update',
    'role.assign',
    'asset.read',
    'asset.approve',    // ← added per spec (final approval stage in demo)
    'asset.reject',     // ← added per spec
    'investment.view',
    'transaction.view',
    'audit.view',
    'report.export',
  ],

  'Asset Issuer': [
    'asset.create',
    'asset.read',
    'asset.update',
    'asset.submit',
    'token.configure',  // configure params, but NOT deploy
    'investment.view',
  ],

  'Compliance Officer': [
    'compliance.review',
    'compliance.approve',
    'compliance.reject',
    'asset.read',
    'asset.approve',    // approve at compliance stage
    'asset.reject',     // reject at compliance stage
    'audit.view',
  ],

  'Legal Officer': [
    'asset.read',
    'asset.approve',    // approve at legal stage
    'asset.reject',     // reject at legal stage
    'compliance.review', // can view compliance findings, cannot issue decisions
    'audit.view',
  ],

  'Treasury Officer': [
    'token.configure',
    'token.deploy',
    'token.mint',
    'token.burn',
    'token.pause',
    'transaction.view',
    'transaction.approve',
    'asset.read',
  ],

  'Marketplace Manager': [
    'marketplace.create',
    'marketplace.publish',
    'marketplace.unpublish',
    'asset.read',
    'investment.view',
    'investment.approve',
  ],

  'Operations Manager': [
    'organization.read',
    'user.read',
    'asset.read',
    'investment.view',
    'transaction.view',
    'audit.view',
    'report.export',
  ],

  'Auditor': [
    'organization.read',
    'user.read',
    'asset.read',
    'investment.view',
    'transaction.view',
    'audit.view',
    'report.export',
  ],

  'Investor': [
    'asset.read',
    'investment.view',
    'investment.create',
  ],

  'Viewer': [
    'organization.read',
    'asset.read',
  ],
};

// ─── 3. Approval stage → role mapping ────────────────────────────────────────
// Used by the asset approval endpoint to enforce that only the
// role mapped to a stage can act on it (not just anyone with asset.approve).

interface ApprovalStageRole {
  stage: string;
  role_name: string;
  label: string;
}

const APPROVAL_STAGE_ROLES: ApprovalStageRole[] = [
  {
    stage: 'pending_compliance',
    role_name: 'Compliance Officer',
    label: 'Compliance Review',
  },
  {
    stage: 'pending_legal',
    role_name: 'Legal Officer',
    label: 'Legal Review',
  },
  {
    stage: 'pending_admin',
    role_name: 'Enterprise Admin',
    label: 'Administrative Approval',
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pad(str: string, len: number): string {
  return str.padEnd(len);
}

// ─── Seed ─────────────────────────────────────────────────────────────────────

async function seed(): Promise<void> {
  const client = new Client({ connectionString: DATABASE_URL });

  try {
    await client.connect();
    console.log('✓  Connected to database\n');

    await client.query('BEGIN');

    // ── Step 1: Permissions ───────────────────────────────────────────────────
    console.log('→  Seeding permissions...');
    for (const key of PERMISSIONS) {
      await client.query(
        `INSERT INTO permissions (key)
         VALUES ($1)
         ON CONFLICT (key) DO NOTHING`,
        [key]
      );
    }
    const { rows: permRows } = await client.query<{ id: string; key: string }>(
      'SELECT id, key FROM permissions'
    );
    const permIdByKey = Object.fromEntries(permRows.map((r) => [r.key, r.id]));
    console.log(`   ✓  ${permRows.length} permissions ready\n`);

    // ── Step 2: Roles (platform system roles, organization_id = NULL) ─────────
    console.log('→  Seeding roles...');
    for (const roleName of Object.keys(ROLE_PERMISSIONS)) {
      await client.query(
        `INSERT INTO roles (name, organization_id, is_system_role)
         VALUES ($1, NULL, true)
         ON CONFLICT (name) WHERE organization_id IS NULL DO NOTHING`,
        [roleName]
      );
    }
    const { rows: roleRows } = await client.query<{ id: string; name: string }>(
      `SELECT id, name FROM roles WHERE organization_id IS NULL AND is_system_role = true`
    );
    const roleIdByName = Object.fromEntries(roleRows.map((r) => [r.name, r.id]));
    console.log(`   ✓  ${roleRows.length} system roles ready\n`);

    // ── Step 3: Role → Permission mappings ───────────────────────────────────
    console.log('→  Seeding role_permissions...');
    let rpInserted = 0;
    const rpErrors: string[] = [];

    for (const [roleName, permKeys] of Object.entries(ROLE_PERMISSIONS)) {
      const roleId = roleIdByName[roleName];
      if (!roleId) {
        rpErrors.push(`  ⚠  Role not found in DB: "${roleName}"`);
        continue;
      }
      for (const permKey of permKeys) {
        const permId = permIdByKey[permKey];
        if (!permId) {
          rpErrors.push(`  ⚠  Permission not found in DB: "${permKey}" (role: ${roleName})`);
          continue;
        }
        await client.query(
          `INSERT INTO role_permissions (role_id, permission_id)
           VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [roleId, permId]
        );
        rpInserted++;
      }
    }

    if (rpErrors.length > 0) {
      rpErrors.forEach((e) => console.warn(e));
    }
    console.log(`   ✓  ${rpInserted} role_permission mappings processed\n`);

    // ── Step 4: Approval stage → role ────────────────────────────────────────
    console.log('→  Seeding approval_stage_roles...');
    for (const asr of APPROVAL_STAGE_ROLES) {
      await client.query(
        `INSERT INTO approval_stage_roles (stage, role_name, label)
         VALUES ($1, $2, $3)
         ON CONFLICT (stage) DO UPDATE
           SET role_name = EXCLUDED.role_name,
               label     = EXCLUDED.label`,
        [asr.stage, asr.role_name, asr.label]
      );
    }
    console.log(`   ✓  ${APPROVAL_STAGE_ROLES.length} approval stages seeded\n`);

    await client.query('COMMIT');
    console.log('✅  Seed complete!\n');

    // ── Summary table ─────────────────────────────────────────────────────────
    const { rows: summary } = await client.query<{ role: string; permission_count: string }>(
      `SELECT
         r.name                      AS role,
         COUNT(rp.permission_id)::text AS permission_count
       FROM roles r
       LEFT JOIN role_permissions rp ON r.id = rp.role_id
       WHERE r.organization_id IS NULL
       GROUP BY r.name
       ORDER BY COUNT(rp.permission_id) DESC, r.name`
    );

    console.log('Role permission summary:');
    console.log('─'.repeat(45));
    for (const row of summary) {
      console.log(`  ${pad(row.role, 28)} ${row.permission_count.padStart(3)} permissions`);
    }
    console.log('─'.repeat(45));

    const { rows: stageRows } = await client.query(
      'SELECT stage, role_name, label FROM approval_stage_roles ORDER BY stage'
    );
    console.log('\nApproval stage gating:');
    console.log('─'.repeat(55));
    for (const row of stageRows) {
      console.log(`  ${pad(row.stage, 25)} → ${row.role_name}`);
    }
    console.log('─'.repeat(55));
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n✗  Seed failed — rolled back.\n', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

seed();
