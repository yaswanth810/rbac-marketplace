/**
 * investment.service.ts
 *
 * Business logic for the investment lifecycle:
 *   create → approve (whitelist + mint on-chain) → view / list
 *
 * Two-phase approval (correction #2 from review)
 * ─────────────────────────────────────────────
 * 1. Commit status='paid' (mocked payment) in its OWN transaction BEFORE
 *    any on-chain operation. This ensures payment is always persisted
 *    even if the blockchain step fails.
 * 2. Call addToWhitelistOnChain + mintOnChain (from token.service.ts).
 * 3. Commit status='confirmed' with full audit log.
 *
 * If the on-chain step fails, the investment stays at 'paid' — payment
 * is captured, token allocation is still pending. Ops can retry or
 * investigate without the payment state being ambiguous.
 *
 * isOrgStaff scoping (correction #1 from review)
 * ───────────────────────────────────────────────
 * Determined by whether the caller holds the system "Investor" role.
 * Investor → see own investments only.
 * Any other role (Auditor, Operations Manager, Marketplace Manager, etc.)
 * with investment.view → see all investments in their org.
 * This is checked in the route handler (one DB query) and passed in.
 *
 * Single mint code path (correction #4 from review)
 * ──────────────────────────────────────────────────
 * This service imports addToWhitelistOnChain and mintOnChain from
 * token.service.ts and uses them directly. There is no duplicate
 * ethers/contract setup code here.
 */

import { type PrismaClient, Prisma } from '@prisma/client';
import { AppError } from '../assets/asset.service.js';
import {
  addToWhitelistOnChain,
  mintOnChain,
  BlockchainError,
} from '../tokens/token.service.js';

// ── Row shapes ────────────────────────────────────────────────────────────────

export interface InvestmentRow {
  id: string;
  asset_id: string;
  investor_id: string;
  amount: string;        // NUMERIC returned as string
  status: string;
  payment_method: string | null;
  created_at: Date;
  // Enriched fields (joined)
  asset_name: string | null;
  token_symbol: string | null;
  token_decimals: number | null;
  token_price: string | null;
  mint_tx_hash: string | null;
  whitelist_tx_hash: string | null;
  token_amount: string | null;  // raw wei amount minted
}

// ── Re-export BlockchainError so route handlers can import from one place ─────
export { BlockchainError };

// ── Create investment ─────────────────────────────────────────────────────────

interface CreateInvestmentInput {
  assetId: string;
  organizationId: string;
  investorId: string;
  amount: number | string;
  paymentMethod: string;
}

const VALID_PAYMENT_METHODS = ['bank_transfer', 'crypto', 'card', 'stablecoin'] as const;

export async function createInvestment(
  prisma: PrismaClient,
  input: CreateInvestmentInput
): Promise<InvestmentRow> {
  const { assetId, organizationId, investorId, amount, paymentMethod } = input;

  // 1. Validate payment method.
  if (!VALID_PAYMENT_METHODS.includes(paymentMethod as (typeof VALID_PAYMENT_METHODS)[number])) {
    throw new AppError(
      400,
      `Invalid payment_method. Must be one of: ${VALID_PAYMENT_METHODS.join(', ')}`,
      'Bad Request'
    );
  }

  // 2. Check investor KYC status (403 if not approved — not 404 to avoid enumeration).
  const investorRows = await prisma.$queryRaw<
    Array<{ kyc_status: string; organization_id: string }>
  >(
    Prisma.sql`SELECT kyc_status::text, organization_id FROM users WHERE id = ${investorId}::uuid`
  );
  const investor = investorRows[0];
  if (!investor) {
    throw new AppError(403, 'Investor not found', 'Forbidden');
  }
  if (investor.kyc_status !== 'approved') {
    throw new AppError(
      403,
      `Investor KYC status must be 'approved' before investing (current: '${investor.kyc_status}')`,
      'Forbidden'
    );
  }

  // 3. Verify asset belongs to org and is 'listed'.
  const assetRows = await prisma.$queryRaw<
    Array<{ organization_id: string; status: string }>
  >(
    Prisma.sql`SELECT organization_id, status FROM assets WHERE id = ${assetId}::uuid`
  );
  const asset = assetRows[0];
  if (!asset || asset.organization_id !== organizationId) {
    throw new AppError(403, 'Cross-organization access denied', 'Forbidden');
  }
  if (asset.status !== 'listed') {
    throw new AppError(
      409,
      `Investments can only be made on 'listed' assets (current status: '${asset.status}')`,
      'Conflict'
    );
  }

  // 4. Insert investment row (status = 'pending').
  const rows = await prisma.$queryRaw<InvestmentRow[]>(
    Prisma.sql`
      INSERT INTO investments (asset_id, investor_id, amount, status, payment_method)
      VALUES (${assetId}::uuid, ${investorId}::uuid, ${amount}, 'pending', ${paymentMethod}::payment_method_enum)
      RETURNING id, asset_id, investor_id, amount::text, status, payment_method, created_at
    `
  );

  // 5. Audit log.
  await prisma.$queryRaw(
    Prisma.sql`
      INSERT INTO audit_logs
        (user_id, action, resource_type, resource_id, organization_id, new_state)
      VALUES
        (${investorId}::uuid, 'investment.create', 'investment', ${rows[0]!.id}::uuid,
         ${organizationId}::uuid,
         ${JSON.stringify({ assetId, amount, paymentMethod, status: 'pending' })}::jsonb)
    `
  );

  return rows[0]!;
}

// ── Approve investment ────────────────────────────────────────────────────────

interface ApproveInvestmentInput {
  id: string;
  organizationId: string;
  approverId: string;
}

export async function approveInvestment(
  prisma: PrismaClient,
  input: ApproveInvestmentInput
): Promise<{ investment: InvestmentRow; whitelistTxHash: string | null; mintTxHash: string }> {
  const { id, organizationId, approverId } = input;

  // ── 1. Fetch and validate ──────────────────────────────────────────────────

  // Investment → asset (org check via asset.organization_id)
  const investmentRows = await prisma.$queryRaw<
    Array<{
      id: string;
      asset_id: string;
      investor_id: string;
      amount: string;
      status: string;
      payment_method: string | null;
      created_at: Date;
      asset_status: string;
      asset_org_id: string;
      contract_address: string | null;
      token_price: string | null;
      token_decimals: number;
      token_chain_id: number;
      wallet_address: string | null;
    }>
  >(
    Prisma.sql`
      SELECT
        i.id, i.asset_id, i.investor_id, i.amount::text AS amount,
        i.status, i.payment_method, i.created_at,
        a.status         AS asset_status,
        a.organization_id AS asset_org_id,
        tk.contract_address,
        tk.price::text   AS token_price,
        tk.decimals      AS token_decimals,
        tk.chain_id      AS token_chain_id,
        u.wallet_address
      FROM   investments i
      JOIN   assets      a  ON i.asset_id    = a.id
      LEFT   JOIN tokens tk ON tk.asset_id   = a.id
      LEFT   JOIN users  u  ON u.id          = i.investor_id
      WHERE  i.id = ${id}::uuid
    `
  );
  const inv = investmentRows[0];

  if (!inv || inv.asset_org_id !== organizationId) {
    throw new AppError(403, 'Cross-organization access denied', 'Forbidden');
  }
  if (inv.status !== 'pending') {
    throw new AppError(
      409,
      `Only 'pending' investments can be approved (current status: '${inv.status}')`,
      'Conflict'
    );
  }
  if (inv.asset_status !== 'listed') {
    throw new AppError(
      409,
      `Investment approval requires asset to be 'listed' (current: '${inv.asset_status}')`,
      'Conflict'
    );
  }
  if (!inv.contract_address) {
    throw new AppError(409, 'Token has not been deployed for this asset.', 'Conflict');
  }
  if (!inv.wallet_address) {
    throw new AppError(
      409,
      'Investor has no wallet address registered. Add one before approving.',
      'Conflict'
    );
  }
  if (!inv.token_price || Number(inv.token_price) <= 0) {
    throw new AppError(
      409,
      'Token price is not configured or is zero — cannot calculate token allocation.',
      'Conflict'
    );
  }

  // ── 2. Calculate token allocation ─────────────────────────────────────────
  // MVP: floating-point arithmetic is acceptable for this demo.
  // TODO (production): replace with decimal.js to avoid precision loss
  //   on large NUMERIC(20,6) values.
  const tokenCount = Math.floor(Number(inv.amount) / Number(inv.token_price));
  if (tokenCount <= 0) {
    throw new AppError(
      409,
      'Investment amount is less than the minimum token price — no tokens to allocate.',
      'Conflict'
    );
  }
  const tokenAmount = BigInt(tokenCount) * (10n ** BigInt(inv.token_decimals));

  // ── 3. MOCK PAYMENT — commit status='paid' BEFORE on-chain operations ──────
  // Correction #2: payment is committed in its own transaction first.
  // A failed mint leaves the investment at 'paid' (recoverable state).
  // ── Note: payment is mocked per MVP spec — integrate real payment gateway in Prompt 6. ──
  await prisma.$transaction([
    prisma.$queryRaw(
      Prisma.sql`
        UPDATE investments
        SET status = 'paid', payment_method = 'bank_transfer'::payment_method_enum
        WHERE id = ${id}::uuid
      `
    ),
    prisma.$queryRaw(
      Prisma.sql`
        INSERT INTO audit_logs
          (user_id, action, resource_type, resource_id, organization_id,
           previous_state, new_state)
        VALUES
          (${approverId}::uuid, 'investment.payment_captured', 'investment', ${id}::uuid,
           ${organizationId}::uuid,
           ${JSON.stringify({ status: 'pending' })}::jsonb,
           ${JSON.stringify({ status: 'paid', mocked: true, note: 'MVP mock payment' })}::jsonb)
      `
    ),
  ]);

  // ── 4. On-chain operations — whitelist then mint ───────────────────────────
  // Uses exported helpers from token.service.ts (single code path).
  // If either call throws BlockchainError, the investment stays at 'paid'.
  let whitelistTxHash: string | null = null;
  let mintTxHash: string;

  // addToWhitelistOnChain is idempotent — safe even if already whitelisted.
  const whitelistResult = await addToWhitelistOnChain(
    inv.contract_address,
    inv.wallet_address,
    inv.token_chain_id ?? 31337
  );
  whitelistTxHash = whitelistResult.txHash;

  const mintResult = await mintOnChain(
    inv.contract_address,
    inv.wallet_address,
    tokenAmount,
    inv.token_chain_id ?? 31337
  );
  mintTxHash = mintResult.txHash;

  // ── 5. Commit confirmed status + full audit log ────────────────────────────
  const [confirmedRows] = await prisma.$transaction([
    prisma.$queryRaw<InvestmentRow[]>(
      Prisma.sql`
        UPDATE investments SET status = 'confirmed'
        WHERE  id = ${id}::uuid
        RETURNING id, asset_id, investor_id, amount::text, status,
                  payment_method, created_at
      `
    ),
    prisma.$queryRaw(
      Prisma.sql`
        INSERT INTO audit_logs
          (user_id, action, resource_type, resource_id, organization_id,
           previous_state, new_state)
        VALUES
          (${approverId}::uuid, 'investment.confirmed', 'investment', ${id}::uuid,
           ${organizationId}::uuid,
           ${JSON.stringify({ status: 'paid' })}::jsonb,
           ${JSON.stringify({
             status: 'confirmed',
             wallet: inv.wallet_address,
             tokenAmount: tokenAmount.toString(),
             whitelistTxHash,
             mintTxHash,
           })}::jsonb)
      `
    ),
  ]);

  return {
    investment: ((confirmedRows as InvestmentRow[])[0])!,
    whitelistTxHash,
    mintTxHash,
  };
}

// ── View / List investments ───────────────────────────────────────────────────

/** Whether the caller is scoped to their own investments only. */
export interface InvestmentScope {
  /** Caller holds the system "Investor" role — see own investments only. */
  isInvestorRole: boolean;
  requesterId: string;
  organizationId: string;
}

export async function getInvestment(
  prisma: PrismaClient,
  id: string,
  scope: InvestmentScope
): Promise<InvestmentRow | null> {
  const { isInvestorRole, requesterId, organizationId } = scope;

  const rows = await prisma.$queryRaw<InvestmentRow[]>(
    Prisma.sql`
      SELECT
        i.id,
        i.asset_id,
        i.investor_id,
        i.amount::text,
        i.status,
        i.payment_method,
        i.created_at,
        a.name                                      AS asset_name,
        tk.symbol                                   AS token_symbol,
        tk.decimals                                 AS token_decimals,
        tk.price::text                              AS token_price,
        (al.new_state->>'mintTxHash')               AS mint_tx_hash,
        (al.new_state->>'whitelistTxHash')          AS whitelist_tx_hash,
        (al.new_state->>'tokenAmount')              AS token_amount
      FROM   investments i
      JOIN   assets      a   ON i.asset_id  = a.id
      LEFT   JOIN tokens tk  ON tk.asset_id = a.id
      LEFT   JOIN audit_logs al
             ON  al.resource_type = 'investment'
             AND al.resource_id   = i.id
             AND al.action        = 'investment.confirmed'
      WHERE  i.id = ${id}::uuid
        AND  a.organization_id = ${organizationId}::uuid
        AND  (${isInvestorRole ? 'TRUE' : 'FALSE'}::boolean = false OR i.investor_id = ${requesterId}::uuid)
    `
  );

  // Return null (not 403) — the route handler converts null to 403
  // to avoid leaking whether the resource exists in another org.
  return rows[0] ?? null;
}

export async function listInvestments(
  prisma: PrismaClient,
  scope: InvestmentScope
): Promise<InvestmentRow[]> {
  const { isInvestorRole, requesterId, organizationId } = scope;

  return prisma.$queryRaw<InvestmentRow[]>(
    Prisma.sql`
      SELECT
        i.id,
        i.asset_id,
        i.investor_id,
        i.amount::text,
        i.status,
        i.payment_method,
        i.created_at,
        a.name                                      AS asset_name,
        tk.symbol                                   AS token_symbol,
        tk.decimals                                 AS token_decimals,
        tk.price::text                              AS token_price,
        (al.new_state->>'mintTxHash')               AS mint_tx_hash,
        (al.new_state->>'whitelistTxHash')          AS whitelist_tx_hash,
        (al.new_state->>'tokenAmount')              AS token_amount
      FROM   investments i
      JOIN   assets      a   ON i.asset_id  = a.id
      LEFT   JOIN tokens tk  ON tk.asset_id = a.id
      LEFT   JOIN audit_logs al
             ON  al.resource_type = 'investment'
             AND al.resource_id   = i.id
             AND al.action        = 'investment.confirmed'
      WHERE  a.organization_id = ${organizationId}::uuid
        AND  (${isInvestorRole ? 'TRUE' : 'FALSE'}::boolean = false OR i.investor_id = ${requesterId}::uuid)
      ORDER  BY i.created_at DESC
    `
  );
}
