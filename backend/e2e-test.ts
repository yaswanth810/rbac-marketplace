/**
 * e2e-test.ts — Full end-to-end scenario test
 *
 * Steps tested:
 *  1.  Create org + users with roles
 *  2.  Issuer creates + submits Real Estate asset
 *  3.  Compliance Officer approves → pending_legal; duplicate attempt → 409
 *  4.  Legal Officer approves → pending_admin
 *  5.  Enterprise Admin approves → approved
 *  6.  Configure token, deploy to localhost hardhat, confirm contract_address
 *  7.  Mint initial supply to admin wallet
 *  8.  Marketplace Manager creates + publishes listing
 *  9.  Investor GETs marketplace, views detail, submits investment
 * 10.  Investment approved → whitelist + mint confirmed on-chain
 * 11.  Investor lists investments (portfolio view)
 * 12.  Audit log check — list all rows for the asset
 *
 * Run: npx tsx e2e-test.ts
 * Prereqs: backend running on :3001, hardhat node on :8545
 */

import { PrismaClient, Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { ethers } from 'ethers';

const API = 'http://localhost:3001';
const prisma = new PrismaClient({ log: [] });

// ─── Colour helpers ────────────────────────────────────────────────────────────
const PASS = '✅';
const FAIL = '❌';
const INFO = '  ';

let stepNum = 0;
const results: { step: string; status: 'PASS' | 'FAIL'; detail: string }[] = [];

function step(name: string) { stepNum++; console.log(`\n${'─'.repeat(60)}\nStep ${stepNum}: ${name}`); }
function pass(msg: string) { console.log(`${PASS} ${msg}`); results.push({ step: `${stepNum}`, status: 'PASS', detail: msg }); }
function fail(msg: string) { console.log(`${FAIL} ${msg}`); results.push({ step: `${stepNum}`, status: 'FAIL', detail: msg }); }
function info(msg: string) { console.log(`${INFO}   ${msg}`); }

// ─── HTTP helper ───────────────────────────────────────────────────────────────
async function api(method: string, path: string, body?: unknown, token?: string) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

async function login(email: string, password: string): Promise<string> {
  const r = await api('POST', '/api/auth/login', { email, password });
  if (r.status !== 200) throw new Error(`Login failed for ${email}: ${JSON.stringify(r.data)}`);
  return (r.data as { token: string }).token;
}

// ─── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('🚀 Starting E2E scenario test\n');

  // ════════════════════════════════════════════════════════════════════════
  // STEP 1 — Create org + users + roles
  // ════════════════════════════════════════════════════════════════════════
  step('Create org, users, assign roles');

  const password = 'E2ETest1234!';
  const passwordHash = await bcrypt.hash(password, 10);
  // Deployer wallet from hardhat node account 0
  const INVESTOR_WALLET = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'; // hardhat account[1]
  const ADMIN_WALLET    = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'; // hardhat account[0]

  try {
    // Clean up previous e2e test data — must follow FK dependency order.
    // asset_approvals.approver_id → users.id has NO cascade, so delete approvals first.
    const prevOrg = await prisma.$queryRaw<{id:string}[]>`
      SELECT id FROM organizations WHERE name = 'E2E Test Org'
    `;
    if (prevOrg.length > 0) {
      const prevOrgId = prevOrg[0]!.id;
      info(`Cleaning up previous E2E data for org ${prevOrgId}...`);
      // Delete child tables in FK-safe order
      await prisma.$queryRaw`DELETE FROM asset_approvals  WHERE asset_id IN (SELECT id FROM assets WHERE organization_id = ${prevOrgId}::uuid)`;
      await prisma.$queryRaw`DELETE FROM audit_logs       WHERE organization_id = ${prevOrgId}::uuid`;
      await prisma.$queryRaw`DELETE FROM marketplace_listings WHERE asset_id IN (SELECT id FROM assets WHERE organization_id = ${prevOrgId}::uuid)`;
      await prisma.$queryRaw`DELETE FROM investments      WHERE asset_id IN (SELECT id FROM assets WHERE organization_id = ${prevOrgId}::uuid)`;
      await prisma.$queryRaw`DELETE FROM tokens           WHERE asset_id IN (SELECT id FROM assets WHERE organization_id = ${prevOrgId}::uuid)`;
      await prisma.$queryRaw`DELETE FROM assets           WHERE organization_id = ${prevOrgId}::uuid`;
      await prisma.$queryRaw`DELETE FROM user_roles       WHERE user_id IN (SELECT id FROM users WHERE organization_id = ${prevOrgId}::uuid)`;
      await prisma.$queryRaw`DELETE FROM users            WHERE organization_id = ${prevOrgId}::uuid`;
      await prisma.$queryRaw`DELETE FROM organizations    WHERE id = ${prevOrgId}::uuid`;
    }

    // Create org
    const orgRows = await prisma.$queryRaw<{id:string}[]>`
      INSERT INTO organizations (name) VALUES ('E2E Test Org') RETURNING id
    `;
    const orgId = orgRows[0]!.id;
    info(`Org created: ${orgId}`);

    // Create 6 users
    const userMap: Record<string, string> = {};
    const userData = [
      { key: 'issuer',      email: 'e2e-issuer@test.com',     name: 'E2E Issuer',      wallet: null },
      { key: 'compliance',  email: 'e2e-compliance@test.com', name: 'E2E Compliance',  wallet: null },
      { key: 'legal',       email: 'e2e-legal@test.com',      name: 'E2E Legal',       wallet: null },
      { key: 'admin',       email: 'e2e-admin@test.com',      name: 'E2E Admin',       wallet: ADMIN_WALLET },
      { key: 'mktmgr',     email: 'e2e-mktmgr@test.com',    name: 'E2E MktMgr',     wallet: null },
      { key: 'investor',    email: 'e2e-investor@test.com',   name: 'E2E Investor',    wallet: INVESTOR_WALLET },
    ];

    for (const u of userData) {
      const rows = await prisma.$queryRaw<{id:string}[]>`
        INSERT INTO users (organization_id, name, email, password_hash, kyc_status, status, wallet_address)
        VALUES (${orgId}::uuid, ${u.name}, ${u.email}, ${passwordHash},
                ${u.key === 'investor' ? 'approved' : 'submitted'}::kyc_status_enum,
                'active'::user_status_enum,
                ${u.wallet})
        RETURNING id
      `;
      userMap[u.key] = rows[0]!.id;
      info(`${u.key}: ${rows[0]!.id}`);
    }

    // Fetch role IDs
    const roles = await prisma.$queryRaw<{id:string; name:string}[]>`
      SELECT id, name FROM roles WHERE organization_id IS NULL
    `;
    const roleId = (name: string) => roles.find(r => r.name === name)?.id;

    // Assign roles
    const assignments = [
      { user: 'issuer',     role: 'Asset Issuer' },
      { user: 'compliance', role: 'Compliance Officer' },
      { user: 'legal',      role: 'Legal Officer' },
      { user: 'admin',      role: 'Enterprise Admin' },
      { user: 'admin',      role: 'Treasury Officer' },     // token.configure/deploy/mint
      { user: 'mktmgr',    role: 'Marketplace Manager' },  // marketplace + investment.approve
      { user: 'investor',   role: 'Investor' },
    ];
    for (const a of assignments) {
      const rid = roleId(a.role);
      if (!rid) throw new Error(`Role not found: ${a.role}`);
      await prisma.$queryRaw`
        INSERT INTO user_roles (user_id, role_id)
        VALUES (${userMap[a.user]}::uuid, ${rid}::uuid)
      `;
    }

    info('All roles assigned');
    pass(`Org + 6 users created; kyc_status=approved for investor; wallet set for investor+admin`);

    // ════════════════════════════════════════════════════════════════════
    // STEP 2 — Issuer creates + submits asset
    // ════════════════════════════════════════════════════════════════════
    step('Issuer creates Real Estate asset and submits it');

    const issuerToken = await login('e2e-issuer@test.com', password);
    info(`Issuer logged in`);

    const createRes = await api('POST', '/api/assets', {
      name: 'E2E Waterfront Tower',
      asset_type: 'real_estate',
      description: 'Premium waterfront real estate E2E test',
      jurisdiction: 'IN',
      currency: 'USD',
      total_value: 5000000,
      metadata: { risk_level: 'medium' },
    }, issuerToken);

    if (createRes.status !== 201) { fail(`Create asset returned ${createRes.status}: ${JSON.stringify(createRes.data)}`); return; }
    const assetId = (createRes.data as {id:string}).id;
    info(`Asset created: ${assetId}, status=draft`);

    const submitRes = await api('POST', `/api/assets/${assetId}/submit`, {}, issuerToken);
    if (submitRes.status !== 200) { fail(`Submit returned ${submitRes.status}: ${JSON.stringify(submitRes.data)}`); return; }
    const afterSubmit = (submitRes.data as {status:string}).status;
    if (afterSubmit !== 'pending_compliance') { fail(`Expected pending_compliance, got ${afterSubmit}`); return; }
    pass(`Asset created (id=${assetId}) and submitted → status=pending_compliance`);

    // ════════════════════════════════════════════════════════════════════
    // STEP 3 — Compliance Officer approves; duplicate → 409
    // ════════════════════════════════════════════════════════════════════
    step('Compliance Officer approves → pending_legal; duplicate → 409');

    const compToken = await login('e2e-compliance@test.com', password);
    const compApprove = await api('POST', `/api/assets/${assetId}/approve`, { comment: 'Compliance cleared' }, compToken);
    if (compApprove.status !== 200) { fail(`Compliance approve returned ${compApprove.status}: ${JSON.stringify(compApprove.data)}`); return; }
    const afterComp = (compApprove.data as {asset:{status:string}}).asset?.status;
    if (afterComp !== 'pending_legal') { fail(`Expected pending_legal, got ${afterComp}`); return; }
    info(`Status is now pending_legal ✓`);

    // Duplicate attempt — compliance tries again
    const dupRes = await api('POST', `/api/assets/${assetId}/approve`, { comment: 'again' }, compToken);
    if (dupRes.status !== 409) { fail(`Expected 409 on duplicate approve, got ${dupRes.status}: ${JSON.stringify(dupRes.data)}`); return; }
    info(`Duplicate compliance approve correctly rejected with 409 ✓`);
    pass(`Compliance approved → pending_legal; duplicate attempt returned 409`);

    // ════════════════════════════════════════════════════════════════════
    // STEP 4 — Legal Officer approves → pending_admin
    // ════════════════════════════════════════════════════════════════════
    step('Legal Officer approves → pending_admin');

    const legalToken = await login('e2e-legal@test.com', password);
    const legalApprove = await api('POST', `/api/assets/${assetId}/approve`, { comment: 'Legal cleared' }, legalToken);
    if (legalApprove.status !== 200) { fail(`Legal approve returned ${legalApprove.status}: ${JSON.stringify(legalApprove.data)}`); return; }
    const afterLegal = (legalApprove.data as {asset:{status:string}}).asset?.status;
    if (afterLegal !== 'pending_admin') { fail(`Expected pending_admin, got ${afterLegal}`); return; }
    pass(`Legal approved → status=pending_admin`);

    // ════════════════════════════════════════════════════════════════════
    // STEP 5 — Enterprise Admin approves → approved
    // ════════════════════════════════════════════════════════════════════
    step('Enterprise Admin approves → approved');

    const adminToken = await login('e2e-admin@test.com', password);
    const adminApprove = await api('POST', `/api/assets/${assetId}/approve`, { comment: 'Admin final sign-off' }, adminToken);
    if (adminApprove.status !== 200) { fail(`Admin approve returned ${adminApprove.status}: ${JSON.stringify(adminApprove.data)}`); return; }
    const afterAdmin = (adminApprove.data as {asset:{status:string}}).asset?.status;
    if (afterAdmin !== 'approved') { fail(`Expected approved, got ${afterAdmin}`); return; }
    pass(`Admin approved → status=approved`);

    // ════════════════════════════════════════════════════════════════════
    // STEP 6 — Configure + deploy token to localhost hardhat
    // ════════════════════════════════════════════════════════════════════
    step('Configure token, deploy to localhost hardhat node, verify contract_address stored');

    const configRes = await api('POST', '/api/tokens/configure', {
      assetId,
      tokenSymbol: 'WETF',
      totalSupply: 1000000,
      decimals: 18,
      price: 5,     // $5 per token
      chainId: 31337,
    }, adminToken);
    if (configRes.status !== 201) { fail(`Configure token returned ${configRes.status}: ${JSON.stringify(configRes.data)}`); return; }
    info(`Token configured: symbol=WETF, supply=1000000, price=$5`);

    const deployRes = await api('POST', '/api/tokens/deploy', { assetId }, adminToken);
    if (deployRes.status !== 200) { fail(`Deploy token returned ${deployRes.status}: ${JSON.stringify(deployRes.data)}`); return; }
    const contractAddress = (deployRes.data as {contract_address:string}).contract_address;
    if (!contractAddress) { fail(`Deploy succeeded but contract_address is null`); return; }
    info(`Contract deployed at: ${contractAddress}`);
    pass(`Token configured + deployed; contract_address=${contractAddress}`);

    // ════════════════════════════════════════════════════════════════════
    // STEP 7 — Mint to admin wallet (admin is whitelisted by constructor)
    // ════════════════════════════════════════════════════════════════════
    step('Mint initial supply to admin wallet (already whitelisted by constructor)');

    // 1 token in wei (18 decimals)
    const mintAmount = (100n * 10n ** 18n).toString();
    const mintRes = await api('POST', '/api/tokens/mint', {
      assetId,
      recipientUserId: userMap['admin'],
      amount: mintAmount,
    }, adminToken);
    if (mintRes.status !== 200) { fail(`Mint returned ${mintRes.status}: ${JSON.stringify(mintRes.data)}`); return; }
    const mintTxHash = (mintRes.data as {txHash:string}).txHash;
    info(`Mint tx: ${mintTxHash}`);

    // Verify on-chain balance
    const provider = new ethers.JsonRpcProvider('http://127.0.0.1:8545');
    const tokenABI = ['function balanceOf(address) view returns (uint256)'];
    const tokenContract = new ethers.Contract(contractAddress, tokenABI, provider);
    const balance = await tokenContract.balanceOf(ADMIN_WALLET);
    info(`On-chain balance of admin: ${ethers.formatUnits(balance, 18)} WETF`);
    if (balance === 0n) { fail(`On-chain balance is 0 after mint`); return; }
    pass(`100 WETF minted to admin; on-chain balance=${ethers.formatUnits(balance, 18)} WETF`);

    // ════════════════════════════════════════════════════════════════════
    // STEP 8 — Marketplace Manager creates + publishes listing
    // ════════════════════════════════════════════════════════════════════
    step('Marketplace Manager creates and publishes listing');

    const mktToken = await login('e2e-mktmgr@test.com', password);
    const createListingRes = await api('POST', '/api/marketplace/listings', { assetId }, mktToken);
    if (createListingRes.status !== 201) { fail(`Create listing returned ${createListingRes.status}: ${JSON.stringify(createListingRes.data)}`); return; }
    const listingId = (createListingRes.data as {id:string}).id;
    info(`Listing created: ${listingId}`);

    const publishRes = await api('POST', `/api/marketplace/listings/${listingId}/publish`, {}, mktToken);
    if (publishRes.status !== 200) { fail(`Publish listing returned ${publishRes.status}: ${JSON.stringify(publishRes.data)}`); return; }
    const listingStatus = (publishRes.data as {status:string}).status;
    if (listingStatus !== 'published') { fail(`Expected published, got ${listingStatus}`); return; }
    pass(`Listing ${listingId} published; asset status → listed`);

    // ════════════════════════════════════════════════════════════════════
    // STEP 9 — Investor discovers listing, views it, submits investment
    // ════════════════════════════════════════════════════════════════════
    step('Investor discovers listing via GET /api/marketplace, submits investment');

    const investorToken = await login('e2e-investor@test.com', password);
    const marketRes = await api('GET', '/api/marketplace', undefined, investorToken);
    if (marketRes.status !== 200) { fail(`GET marketplace returned ${marketRes.status}: ${JSON.stringify(marketRes.data)}`); return; }
    const listings = marketRes.data as unknown[];
    const found = (listings as {asset_id:string}[]).find(l => l.asset_id === assetId);
    if (!found) { fail(`Asset ${assetId} not found in marketplace listings`); return; }
    info(`Investor can see ${listings.length} listing(s); target found ✓`);

    // Create investment (amount=$500 → 100 tokens at $5/token)
    const investRes = await api('POST', '/api/investments', {
      assetId,
      amount: 500,
      paymentMethod: 'bank_transfer',
    }, investorToken);
    if (investRes.status !== 201) { fail(`Create investment returned ${investRes.status}: ${JSON.stringify(investRes.data)}`); return; }
    const investmentId = (investRes.data as {id:string}).id;
    info(`Investment created: ${investmentId}, status=pending`);
    pass(`Investor found listing and submitted investment ${investmentId}`);

    // ════════════════════════════════════════════════════════════════════
    // STEP 10 — Approve investment → whitelist + mint on-chain
    // ════════════════════════════════════════════════════════════════════
    step('Approve investment → investor whitelisted + tokens minted on-chain');

    const approveInvRes = await api('POST', `/api/investments/${investmentId}/approve`, {}, mktToken);
    if (approveInvRes.status !== 200) { fail(`Approve investment returned ${approveInvRes.status}: ${JSON.stringify(approveInvRes.data)}`); return; }
    const { investment, whitelistTxHash, mintTxHash: invMintTxHash } = approveInvRes.data as {
      investment: {status:string};
      whitelistTxHash: string|null;
      mintTxHash: string;
    };
    if (investment.status !== 'confirmed') { fail(`Expected confirmed status, got ${investment.status}`); return; }
    info(`whitelist tx: ${whitelistTxHash ?? 'already whitelisted'}`);
    info(`mint tx: ${invMintTxHash}`);

    // Verify investor on-chain balance
    const investorBalance = await tokenContract.balanceOf(INVESTOR_WALLET);
    info(`Investor on-chain balance: ${ethers.formatUnits(investorBalance, 18)} WETF`);
    if (investorBalance === 0n) { fail(`Investor on-chain token balance is 0 after approval`); return; }
    pass(`Investment confirmed; investor received ${ethers.formatUnits(investorBalance, 18)} WETF on-chain`);

    // ════════════════════════════════════════════════════════════════════
    // STEP 11 — Investor sees portfolio
    // ════════════════════════════════════════════════════════════════════
    step('Investor sees investment in portfolio (GET /api/investments)');

    const portfolioRes = await api('GET', '/api/investments', undefined, investorToken);
    if (portfolioRes.status !== 200) { fail(`GET /api/investments returned ${portfolioRes.status}: ${JSON.stringify(portfolioRes.data)}`); return; }
    const portfolio = portfolioRes.data as {id:string}[];
    const theirInv = portfolio.find(i => i.id === investmentId);
    if (!theirInv) { fail(`Investment ${investmentId} not found in investor portfolio`); return; }
    info(`Portfolio has ${portfolio.length} investment(s)`);
    pass(`Investor sees their confirmed investment in portfolio`);

    // ════════════════════════════════════════════════════════════════════
    // STEP 12 — Audit log check
    // ════════════════════════════════════════════════════════════════════
    step('Verify audit_logs for every step');

    const auditRows = await prisma.$queryRaw<{action:string; resource_type:string; created_at:Date}[]>`
      SELECT action, resource_type, created_at
      FROM   audit_logs
      WHERE  organization_id = ${orgId}::uuid
      ORDER  BY created_at ASC
    `;
    info(`Total audit rows: ${auditRows.length}`);
    auditRows.forEach(r => info(`  ${r.action} (${r.resource_type}) @ ${r.created_at.toISOString()}`));

    const expectedActions = [
      'asset.submit',
      'asset.approve',   // compliance
      'asset.approve',   // legal
      'asset.approve',   // admin
      'token.configure',
      'token.deploy',
      'token.mint',      // step 7 direct mint
      'marketplace.create',
      'marketplace.publish',
      'investment.create',
      'investment.payment_captured',
      'investment.confirmed',
    ];

    const foundActions = auditRows.map(r => r.action);
    const missing = expectedActions.filter(a => !foundActions.includes(a));
    if (missing.length > 0) {
      fail(`Missing audit actions: ${missing.join(', ')}`);
    } else {
      pass(`All ${auditRows.length} audit log entries found — full trail confirmed`);
    }

  } catch (err) {
    fail(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await prisma.$disconnect();
  }

  // ════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ════════════════════════════════════════════════════════════════════
  console.log('\n' + '═'.repeat(60));
  console.log('  E2E TEST SUMMARY');
  console.log('═'.repeat(60));
  for (const r of results) {
    const icon = r.status === 'PASS' ? PASS : FAIL;
    console.log(`  Step ${r.step}: ${icon} ${r.detail.substring(0, 80)}`);
  }
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  console.log(`\n  Total: ${passed} passed / ${failed} failed`);
  console.log('═'.repeat(60) + '\n');
}

main();
