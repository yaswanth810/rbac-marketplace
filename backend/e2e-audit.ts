/**
 * e2e-audit.ts
 *
 * Full end-to-end audit + test script.
 *
 * Tests:
 *   A. Asset creation → submit → 3-stage approval chain (no wallet/token involved)
 *   B. Investor wallet registration via PATCH /api/users/me/wallet
 *
 * Run:
 *   cd E:\Future_Transformation\backend
 *   npx tsx e2e-audit.ts
 *
 * Prerequisites: backend running on :3001 (npm run dev in backend/)
 */

import * as dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ethers } from 'ethers';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
dotenv.config({ path: resolve(__dirname, '.env') });

const BASE = 'http://localhost:3001';

// ── Helpers ────────────────────────────────────────────────────────────────────

type AnyJSON = Record<string, unknown>;

async function api(
  method: string,
  path: string,
  token?: string,
  body?: unknown
): Promise<{ status: number; json: AnyJSON }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json: AnyJSON = {};
  try { json = await res.json() as AnyJSON; } catch { /* empty body */ }
  return { status: res.status, json };
}

function pass(label: string, detail = '') {
  console.log(`  ✅ PASS  ${label}${detail ? ' — ' + detail : ''}`);
}
function fail(label: string, detail = '') {
  console.log(`  ❌ FAIL  ${label}${detail ? ' — ' + detail : ''}`);
}
function info(label: string) {
  console.log(`  ℹ️       ${label}`);
}
function section(title: string) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('─'.repeat(60));
}

// ── TEST A: Approval chain ─────────────────────────────────────────────────────

async function testApprovalChain() {
  section('TEST A: Asset Creation → Submit → 3-Stage Approval Chain');

  // Health check
  const health = await api('GET', '/health');
  if (health.status === 200) {
    pass('Server health', 'API is up');
  } else {
    fail('Server health', `Got ${health.status}`);
    console.log('  ⛔ Cannot continue — backend not running on :3001');
    return;
  }

  // Step 1: Login as issuer
  let issuerToken = '';
  for (const creds of [
    { email: 'issuer@demo.com',  password: 'RolePass1!' },
    { email: 'issuer@demo.com',  password: 'Demo1234!'  },
  ]) {
    const r = await api('POST', '/api/auth/login', undefined, creds);
    if (r.status === 200 && r.json['token']) {
      issuerToken = r.json['token'] as string;
      pass('Issuer login', `${creds.email} (${creds.password})`);
      break;
    }
  }
  if (!issuerToken) {
    fail('Issuer login', 'All credential attempts failed');
    return;
  }

  // Step 2: Create asset
  let assetId = '';
  const createR = await api('POST', '/api/assets', issuerToken, {
    name:        `E2E-Audit-${Date.now()}`,
    asset_type:  'bond',
    description: 'Automated audit E2E test asset',
    currency:    'USD',
    total_value: 100000,
  });
  if (createR.status === 201 && createR.json['id']) {
    assetId = createR.json['id'] as string;
    pass('Create asset', `id=${assetId} status=${createR.json['status']}`);
  } else {
    fail('Create asset', `status=${createR.status} body=${JSON.stringify(createR.json)}`);
    return;
  }

  // Step 3: Submit
  const submitR = await api('POST', `/api/assets/${assetId}/submit`, issuerToken, {});
  if (submitR.status === 200 && submitR.json['status'] === 'pending_compliance') {
    pass('Submit for review', `status=${submitR.json['status']}`);
  } else {
    fail('Submit for review', `status=${submitR.status} body=${JSON.stringify(submitR.json)}`);
    return;
  }

  // Step 4a: Login as compliance
  let compToken = '';
  for (const creds of [
    { email: 'compliance@roles.test', password: 'RolePass1!' },
    { email: 'compliance@demo.com',   password: 'Demo1234!'  },
  ]) {
    const r = await api('POST', '/api/auth/login', undefined, creds);
    if (r.status === 200 && r.json['token']) {
      compToken = r.json['token'] as string;
      pass('Compliance login', creds.email);
      break;
    }
  }
  if (!compToken) { fail('Compliance login', 'All attempts failed'); return; }

  // Step 4b: Compliance approve
  const compR = await api('POST', `/api/assets/${assetId}/approve`, compToken, {});
  if (compR.status === 200 && (compR.json['asset'] as AnyJSON)?.['status'] === 'pending_legal') {
    pass('Compliance approve', `asset.status=${(compR.json['asset'] as AnyJSON)['status']}`);
  } else {
    fail('Compliance approve', `status=${compR.status} body=${JSON.stringify(compR.json)}`);
  }

  // Step 5a: Login as legal
  let legalToken = '';
  for (const creds of [
    { email: 'legal@roles.test', password: 'RolePass1!' },
    { email: 'legal@demo.com',   password: 'Demo1234!'  },
  ]) {
    const r = await api('POST', '/api/auth/login', undefined, creds);
    if (r.status === 200 && r.json['token']) {
      legalToken = r.json['token'] as string;
      pass('Legal login', creds.email);
      break;
    }
  }
  if (!legalToken) { fail('Legal login', 'All attempts failed'); return; }

  // Step 5b: Legal approve
  const legalR = await api('POST', `/api/assets/${assetId}/approve`, legalToken, {});
  if (legalR.status === 200 && (legalR.json['asset'] as AnyJSON)?.['status'] === 'pending_admin') {
    pass('Legal approve', `asset.status=${(legalR.json['asset'] as AnyJSON)['status']}`);
  } else {
    fail('Legal approve', `status=${legalR.status} body=${JSON.stringify(legalR.json)}`);
  }

  // Step 6a: Login as admin
  let adminToken = '';
  for (const creds of [
    { email: 'admin@demo.com', password: 'RolePass1!' },
    { email: 'admin@demo.com', password: 'Demo1234!'  },
  ]) {
    const r = await api('POST', '/api/auth/login', undefined, creds);
    if (r.status === 200 && r.json['token']) {
      adminToken = r.json['token'] as string;
      pass('Admin login', creds.email);
      break;
    }
  }
  if (!adminToken) { fail('Admin login', 'All attempts failed'); return; }

  // Step 6b: Admin final approval
  const adminR = await api('POST', `/api/assets/${assetId}/approve`, adminToken, {});
  if (adminR.status === 200 && (adminR.json['asset'] as AnyJSON)?.['status'] === 'approved') {
    pass('Admin final approve', `asset.status=${(adminR.json['asset'] as AnyJSON)['status']} ✓ FULLY APPROVED`);
  } else {
    fail('Admin final approve', `status=${adminR.status} body=${JSON.stringify(adminR.json)}`);
  }

  // Step 7: Cross-role rejection guard — compliance trying to approve at pending_admin should get 409
  // (Re-create a fresh asset and submit it to pending_compliance for this test)
  const freshR = await api('POST', '/api/assets', issuerToken, {
    name: `E2E-RoleGuard-${Date.now()}`,
    asset_type: 'equity',
  });
  if (freshR.status === 201) {
    const freshId = freshR.json['id'] as string;
    await api('POST', `/api/assets/${freshId}/submit`, issuerToken, {});
    // compliance approves to move to pending_legal
    await api('POST', `/api/assets/${freshId}/approve`, compToken, {});
    // Now try compliance trying to approve at pending_legal (wrong stage)
    const wrongStageR = await api('POST', `/api/assets/${freshId}/approve`, compToken, {});
    if (wrongStageR.status === 409) {
      pass('Stage role guard', `Compliance correctly rejected at pending_legal (409): "${(wrongStageR.json as AnyJSON)['message']}"`);
    } else {
      fail('Stage role guard', `Expected 409 but got ${wrongStageR.status}`);
    }
  }

  // Step 8: Issuer cannot approve (missing asset.approve permission) → 403
  const issuerApproveR = await api('POST', `/api/assets/${assetId}/approve`, issuerToken, {});
  if (issuerApproveR.status === 403) {
    pass('Issuer blocked from approve (403)', `"${(issuerApproveR.json as AnyJSON)['message']}"`);
  } else {
    fail('Issuer blocked from approve', `Expected 403 but got ${issuerApproveR.status}`);
  }

  info(`Cleanup: test asset ${assetId} left in 'approved' state in DB (safe)`);
}

// ── TEST B: Wallet registration ────────────────────────────────────────────────

async function testWalletRegistration() {
  section('TEST B: Investor MetaMask Wallet Registration');

  // Login as investor
  let token = '';
  for (const creds of [
    { email: 'investor@roles.test', password: 'RolePass1!' },
    { email: 'investor@demo.com',   password: 'RolePass1!' },
    { email: 'investor@demo.com',   password: 'Demo1234!'  },
  ]) {
    const r = await api('POST', '/api/auth/login', undefined, creds);
    if (r.status === 200 && r.json['token']) {
      token = r.json['token'] as string;
      pass('Investor login', creds.email);
      break;
    }
  }
  if (!token) { fail('Investor login', 'All attempts failed'); return; }

  // GET /api/users/me — profile endpoint
  const meR = await api('GET', '/api/users/me', token);
  if (meR.status === 200 && meR.json['id']) {
    pass('GET /api/users/me', `id=${meR.json['id']} current_wallet=${meR.json['wallet_address'] ?? 'none'}`);
  } else {
    fail('GET /api/users/me', `status=${meR.status} body=${JSON.stringify(meR.json)}`);
  }

  // PATCH /api/users/me/wallet — fresh random address (never in DB)
  // Using ethers.Wallet.createRandom() guarantees a valid EVM address
  // that has never been registered, avoiding the unique-constraint error
  // that occurs when reusing a known Hardhat wallet already assigned to another user.
  const INVESTOR_WALLET = ethers.Wallet.createRandom().address;
  info(`Using fresh random wallet: ${INVESTOR_WALLET}`);
  const walletR = await api('PATCH', '/api/users/me/wallet', token, { walletAddress: INVESTOR_WALLET });
  if (walletR.status === 200 && walletR.json['walletAddress'] === INVESTOR_WALLET) {
    pass('PATCH /api/users/me/wallet (valid)', `saved=${walletR.json['walletAddress']}`);
  } else {
    fail('PATCH /api/users/me/wallet (valid)', `status=${walletR.status} body=${JSON.stringify(walletR.json)}`);
  }

  // PATCH with invalid address → 400
  const badR = await api('PATCH', '/api/users/me/wallet', token, { walletAddress: 'not-an-address' });
  if (badR.status === 400) {
    pass('PATCH /api/users/me/wallet (invalid) → 400', `"${(badR.json as AnyJSON)['message']}"`);
  } else {
    fail('PATCH /api/users/me/wallet (invalid)', `Expected 400 but got ${badR.status}`);
  }

  // PATCH without JWT → 401
  const noAuthR = await api('PATCH', '/api/users/me/wallet', undefined, { walletAddress: INVESTOR_WALLET });
  if (noAuthR.status === 401) {
    pass('PATCH /api/users/me/wallet (no token) → 401');
  } else {
    fail('PATCH /api/users/me/wallet (no token)', `Expected 401 but got ${noAuthR.status}`);
  }

  // Verify wallet saved in profile
  const me2R = await api('GET', '/api/users/me', token);
  if (me2R.status === 200 && me2R.json['wallet_address'] === INVESTOR_WALLET) {
    pass('Wallet persisted in DB', `wallet_address=${me2R.json['wallet_address']}`);
  } else {
    fail('Wallet persisted in DB', `wallet_address=${me2R.json['wallet_address']}`);
  }

  // Non-investor (issuer) can also save wallet → wallet endpoint is role-agnostic
  // Use another fresh random address so we don't collide with anything in the DB.
  let issuerToken = '';
  for (const creds of [
    { email: 'issuer@demo.com', password: 'RolePass1!' },
    { email: 'issuer@demo.com', password: 'Demo1234!'  },
  ]) {
    const r = await api('POST', '/api/auth/login', undefined, creds);
    if (r.status === 200 && r.json['token']) { issuerToken = r.json['token'] as string; break; }
  }
  if (issuerToken) {
    const freshIssuerWallet = ethers.Wallet.createRandom().address;
    info(`Using fresh random wallet for issuer test: ${freshIssuerWallet}`);
    const issuerWalletR = await api('PATCH', '/api/users/me/wallet', issuerToken, {
      walletAddress: freshIssuerWallet,
    });
    if (issuerWalletR.status === 200) {
      pass('Any role can register wallet (issuer)', `wallet endpoint not restricted to investors — saved ${freshIssuerWallet}`);
    } else {
      fail('Non-investor wallet registration', `status=${issuerWalletR.status} body=${JSON.stringify(issuerWalletR.json)}`);
    }
  }
}

// ── TEST C: Permission isolation ───────────────────────────────────────────────

async function testPermissionIsolation() {
  section('TEST C: RBAC Isolation — Wrong Role Cannot Cross Stages');

  let compToken = '';
  let adminToken = '';

  for (const creds of [
    { email: 'compliance@roles.test', password: 'RolePass1!' },
    { email: 'compliance@demo.com',   password: 'Demo1234!'  },
  ]) {
    const r = await api('POST', '/api/auth/login', undefined, creds);
    if (r.status === 200 && r.json['token']) { compToken = r.json['token'] as string; break; }
  }

  for (const creds of [
    { email: 'admin@demo.com', password: 'RolePass1!' },
    { email: 'admin@demo.com', password: 'Demo1234!'  },
  ]) {
    const r = await api('POST', '/api/auth/login', undefined, creds);
    if (r.status === 200 && r.json['token']) { adminToken = r.json['token'] as string; break; }
  }

  if (!compToken || !adminToken) {
    fail('Test C setup', 'Could not obtain tokens');
    return;
  }

  // Admin trying to read tokens (needs asset.read now - should pass)
  const assetListR = await api('GET', '/api/assets', adminToken);
  if (assetListR.status === 200) {
    pass('Admin can read assets (200)');
  } else {
    fail('Admin read assets', `status=${assetListR.status}`);
  }

  // Investor cannot access /api/assets (they have asset.read - should pass)
  let investorToken = '';
  for (const creds of [
    { email: 'investor@roles.test', password: 'RolePass1!' },
    { email: 'investor@demo.com',   password: 'Demo1234!'  },
  ]) {
    const r = await api('POST', '/api/auth/login', undefined, creds);
    if (r.status === 200 && r.json['token']) { investorToken = r.json['token'] as string; break; }
  }

  if (investorToken) {
    const invAssetsR = await api('GET', '/api/assets', investorToken);
    if (invAssetsR.status === 200) {
      pass('Investor can read assets (200 - correct: investor has asset.read)');
    } else {
      fail('Investor read assets', `Expected 200 but got ${invAssetsR.status}`);
    }

    // Investor cannot create asset → 403
    const invCreateR = await api('POST', '/api/assets', investorToken, { name: 'x', asset_type: 'bond' });
    if (invCreateR.status === 403) {
      pass('Investor cannot create asset (403)');
    } else {
      fail('Investor blocked from create', `Expected 403 but got ${invCreateR.status}`);
    }

    // Investor cannot access Tokens configure → 403 (token.configure required)
    const invConfigR = await api('POST', '/api/tokens/configure', investorToken, {
      assetId: '00000000-0000-0000-0000-000000000000',
      tokenSymbol: 'X',
      totalSupply: 1000,
      chainId: 31337,
    });
    if (invConfigR.status === 403) {
      pass('Investor cannot configure token (403)');
    } else {
      fail('Investor blocked from token.configure', `Expected 403 but got ${invConfigR.status}`);
    }
  }
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const onlyB = args.includes('--only-b');

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║           RBAC Marketplace — E2E Audit Script           ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`  Target: ${BASE}`);
  console.log(`  Mode:   ${onlyB ? 'Test B only (--only-b)' : 'Full suite (A + B + C)'}`);
  console.log(`  Time:   ${new Date().toISOString()}\n`);

  if (onlyB) {
    await testWalletRegistration();
  } else {
    await testApprovalChain();
    await testWalletRegistration();
    await testPermissionIsolation();
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log('  Done. Review results above.');
  console.log('  ✅ = pass  ❌ = fail  ℹ️ = informational');
  console.log(`${'═'.repeat(60)}\n`);
}

main().catch(console.error);
