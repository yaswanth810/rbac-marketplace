/**
 * asset.service.ts
 *
 * Business logic for the asset lifecycle and maker-checker approval workflow.
 * No HTTP / Fastify concerns — all reply handling lives in routes/assets.ts.
 *
 * Design notes
 * ────────────
 * • All state-mutating operations wrap DB writes in a Prisma interactive
 *   transaction so the asset row, asset_approvals row, and audit_log row
 *   are always committed atomically.
 *
 * • READS run outside the transaction (no TOCTOU risk in practice because
 *   the approval flow is human-speed, not high-frequency trading).
 *
 * • The status-transition map (APPROVE_TRANSITIONS) lives exclusively
 *   server-side — it is never derived from client input.
 *
 * • The role required for each stage is looked up from approval_stage_roles
 *   at request time so that changes to that table take effect immediately.
 *
 * • 403 is returned for "asset not found" to avoid confirming that an ID
 *   exists in another org (consistent with assertOrgAccess convention).
 */

import { type PrismaClient, Prisma } from '@prisma/client';

// ── Application-level error ────────────────────────────────────────────────────

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly error: string = 'Error'
  ) {
    super(message);
    this.name = 'AppError';
  }
}

// ── Row shapes returned by $queryRaw (snake_case, PostgreSQL types) ────────────

export interface AssetRow {
  id: string;
  organization_id: string;
  name: string;
  asset_type: string;
  description: string | null;
  status: string;
  issuer_id: string;
  jurisdiction: string | null;
  currency: string | null;
  /** NUMERIC(20,6) cast to text in every SELECT to prevent Prisma Decimal wrapping */
  total_value: string | null;
  /** JSONB returned as a parsed JS object by Prisma $queryRaw */
  metadata: unknown;
  created_at: Date;
}

export interface ApprovalRow {
  id: string;
  asset_id: string;
  stage: string;
  approver_id: string;
  decision: string;
  comment: string | null;
  created_at: Date;
}

// ── Input types ────────────────────────────────────────────────────────────────

export interface CreateAssetInput {
  organizationId: string;
  issuerId: string;
  name: string;
  assetType: string;
  description?: string | null;
  jurisdiction?: string | null;
  currency?: string | null;
  totalValue?: number | string | null;
  metadata?: Record<string, unknown> | null;
}

export interface UpdateAssetInput {
  name?: string | null;
  description?: string | null;
  jurisdiction?: string | null;
  currency?: string | null;
  totalValue?: number | string | null;
  metadata?: Record<string, unknown> | null;
}

// ── Status transition map ──────────────────────────────────────────────────────
// Source of truth for the approval chain; client can never influence this.

const APPROVE_TRANSITIONS: Record<string, string> = {
  pending_compliance: 'pending_legal',
  pending_legal: 'pending_admin',
  pending_admin: 'approved',
};

// ── Private helpers ────────────────────────────────────────────────────────────

/** Looks up the role required for a given approval stage from the DB. */
async function resolveStageRole(
  prisma: PrismaClient,
  stage: string
): Promise<{ role_name: string; label: string } | null> {
  const rows = await prisma.$queryRaw<Array<{ role_name: string; label: string }>>(
    Prisma.sql`
      SELECT role_name, label
      FROM   approval_stage_roles
      WHERE  stage = ${stage}
    `
  );
  return rows[0] ?? null;
}

/** Returns true if the given user holds ANY role (system or org-scoped) with roleName. */
async function callerHoldsRole(
  prisma: PrismaClient,
  userId: string,
  roleName: string
): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`
      SELECT r.id
      FROM   user_roles ur
      JOIN   roles      r ON ur.role_id = r.id
      WHERE  ur.user_id = ${userId}::uuid
        AND  r.name     = ${roleName}
    `
  );
  return rows.length > 0;
}

// ── SELECT column list (reused across queries) ─────────────────────────────────
// Casts total_value to text to prevent Prisma wrapping it in a Decimal object.
// Defined as a function (not a const) so Prisma.sql is called lazily at
// query time — not at module import time before Prisma client is generated.
function assetCols() {
  return Prisma.sql`
    id, organization_id, name, asset_type, description,
    status, issuer_id, jurisdiction, currency,
    total_value::text AS total_value, metadata, created_at
  `;
}

// ── Read operations ────────────────────────────────────────────────────────────

export async function getAsset(
  prisma: PrismaClient,
  id: string
): Promise<AssetRow | null> {
  const rows = await prisma.$queryRaw<AssetRow[]>(
    Prisma.sql`SELECT ${assetCols()} FROM assets WHERE id = ${id}::uuid`
  );
  return rows[0] ?? null;
}

export async function listAssets(
  prisma: PrismaClient,
  organizationId: string,
  statusFilter?: string | null
): Promise<AssetRow[]> {
  if (statusFilter) {
    return prisma.$queryRaw<AssetRow[]>(
      Prisma.sql`
        SELECT ${assetCols()}
        FROM   assets
        WHERE  organization_id = ${organizationId}::uuid
          AND  status::text    = ${statusFilter}
        ORDER  BY created_at DESC
      `
    );
  }
  return prisma.$queryRaw<AssetRow[]>(
    Prisma.sql`
      SELECT ${assetCols()}
      FROM   assets
      WHERE  organization_id = ${organizationId}::uuid
      ORDER  BY created_at DESC
    `
  );
}

/**
 * Returns assets that are pending approval AND the calling user holds the
 * role mapped to that stage in approval_stage_roles.
 *
 * Example: a Compliance Officer sees only pending_compliance assets.
 *          An admin assigned all 3 roles sees all 3 stages.
 *          A user with no approval role gets an empty array.
 *
 * Used exclusively by the Approvals page (GET /api/assets?pending_approval=true).
 */
export async function listAssetsForApproval(
  prisma: PrismaClient,
  organizationId: string,
  userId: string
): Promise<AssetRow[]> {
  // Find which stages this user is authorised to approve by joining their
  // roles against the approval_stage_roles mapping table.
  const stageRows = await prisma.$queryRaw<Array<{ stage: string }>>(
    Prisma.sql`
      SELECT DISTINCT asr.stage
      FROM   approval_stage_roles asr
      JOIN   roles      r  ON r.name = asr.role_name
                          AND r.organization_id IS NULL
      JOIN   user_roles ur ON ur.role_id = r.id
                          AND ur.user_id  = ${userId}::uuid
    `
  );

  if (stageRows.length === 0) return []; // user holds no approval role

  // Build a VALUES list of approvable stages for the IN clause.
  // Prisma.sql doesn't support dynamic IN with arrays directly, so we
  // construct it manually using Prisma.join.
  const stages = stageRows.map(r => r.stage);
  const stageList = Prisma.join(stages.map(s => Prisma.sql`${s}`));

  return prisma.$queryRaw<AssetRow[]>(
    Prisma.sql`
      SELECT ${assetCols()}
      FROM   assets
      WHERE  organization_id = ${organizationId}::uuid
        AND  status::text IN (${stageList})
      ORDER  BY created_at ASC
    `
  );
}

// ── Create ────────────────────────────────────────────────────────────────────

export async function createAsset(
  prisma: PrismaClient,
  input: CreateAssetInput
): Promise<AssetRow> {
  const metadataJson = JSON.stringify(input.metadata ?? {});

  const rows = await prisma.$queryRaw<AssetRow[]>(
    Prisma.sql`
      INSERT INTO assets
        (organization_id, issuer_id, name, asset_type, description,
         jurisdiction, currency, total_value, metadata)
      VALUES
        (${input.organizationId}::uuid,
         ${input.issuerId}::uuid,
         ${input.name},
         ${input.assetType}::asset_type_enum,
         ${input.description ?? null},
         ${input.jurisdiction ?? null},
         ${input.currency ?? null},
         ${input.totalValue ?? null},
         ${metadataJson}::jsonb)
      RETURNING ${assetCols()}
    `
  );
  return rows[0]!;
}

// ── Update (draft-only) ───────────────────────────────────────────────────────

export async function updateAsset(
  prisma: PrismaClient,
  id: string,
  organizationId: string,
  input: UpdateAssetInput
): Promise<AssetRow> {
  const asset = await getAsset(prisma, id);
  if (!asset || asset.organization_id !== organizationId) {
    throw new AppError(403, 'Cross-organization access denied', 'Forbidden');
  }
  if (asset.status !== 'draft') {
    throw new AppError(
      409,
      `Asset can only be updated in 'draft' status (current: '${asset.status}')`,
      'Conflict'
    );
  }

  const metadataJson =
    input.metadata != null ? JSON.stringify(input.metadata) : null;

  const rows = await prisma.$queryRaw<AssetRow[]>(
    Prisma.sql`
      UPDATE assets
      SET
        name         = COALESCE(${input.name         ?? null}, name),
        description  = COALESCE(${input.description  ?? null}, description),
        jurisdiction = COALESCE(${input.jurisdiction ?? null}, jurisdiction),
        currency     = COALESCE(${input.currency     ?? null}, currency),
        total_value  = COALESCE(${input.totalValue   ?? null}, total_value),
        metadata     = COALESCE(${metadataJson}::jsonb,        metadata)
      WHERE id = ${id}::uuid
      RETURNING ${assetCols()}
    `
  );
  return rows[0]!;
}

// ── Submit (draft → pending_compliance) ───────────────────────────────────────

export async function submitAsset(
  prisma: PrismaClient,
  id: string,
  organizationId: string,
  userId: string
): Promise<AssetRow> {
  const asset = await getAsset(prisma, id);
  if (!asset || asset.organization_id !== organizationId) {
    throw new AppError(403, 'Cross-organization access denied', 'Forbidden');
  }
  if (asset.status !== 'draft') {
    throw new AppError(
      409,
      `Submit is only valid from 'draft' status (current: '${asset.status}')`,
      'Conflict'
    );
  }

  const previousState = JSON.stringify({ status: asset.status });
  const newState = JSON.stringify({ status: 'pending_compliance' });

  return prisma.$transaction(async (tx) => {
    const [updated] = await tx.$queryRaw<AssetRow[]>(
      Prisma.sql`
        UPDATE assets SET status = 'pending_compliance'
        WHERE  id = ${id}::uuid
        RETURNING ${assetCols()}
      `
    );
    await tx.$queryRaw(
      Prisma.sql`
        INSERT INTO audit_logs
          (user_id, action, resource_type, resource_id, organization_id,
           previous_state, new_state)
        VALUES
          (${userId}::uuid, 'asset.submit', 'asset', ${id}::uuid,
           ${organizationId}::uuid,
           ${previousState}::jsonb, ${newState}::jsonb)
      `
    );
    return updated!;
  });
}

// ── Approve ───────────────────────────────────────────────────────────────────

interface ApprovalInput {
  id: string;
  organizationId: string;
  approverId: string;
  comment?: string | null;
}

export async function approveAsset(
  prisma: PrismaClient,
  input: ApprovalInput
): Promise<{ asset: AssetRow; approval: ApprovalRow }> {
  const { id, organizationId, approverId, comment } = input;

  // ── Pre-transaction reads ────────────────────────────────────────────────────

  const asset = await getAsset(prisma, id);
  if (!asset || asset.organization_id !== organizationId) {
    throw new AppError(403, 'Cross-organization access denied', 'Forbidden');
  }

  const stageRole = await resolveStageRole(prisma, asset.status);
  if (!stageRole) {
    throw new AppError(
      409,
      `Asset is not in an approvable state (current status: '${asset.status}')`,
      'Conflict'
    );
  }

  const hasRole = await callerHoldsRole(prisma, approverId, stageRole.role_name);
  if (!hasRole) {
    throw new AppError(
      409,
      `Asset is in status '${asset.status}' (${stageRole.label}), which requires the '${stageRole.role_name}' role`,
      'Conflict'
    );
  }

  const nextStatus = APPROVE_TRANSITIONS[asset.status];
  if (!nextStatus) {
    throw new AppError(
      409,
      `No approval transition defined from status '${asset.status}'`,
      'Conflict'
    );
  }

  const currentStage = asset.status;
  const previousState = JSON.stringify({ status: asset.status });
  const newState = JSON.stringify({ status: nextStatus });

  // ── Atomic write ─────────────────────────────────────────────────────────────

  return prisma.$transaction(async (tx) => {
    const [updatedAsset] = await tx.$queryRaw<AssetRow[]>(
      Prisma.sql`
        UPDATE assets SET status = ${nextStatus}
        WHERE  id = ${id}::uuid
        RETURNING ${assetCols()}
      `
    );

    const [approval] = await tx.$queryRaw<ApprovalRow[]>(
      Prisma.sql`
        INSERT INTO asset_approvals
          (asset_id, stage, approver_id, decision, comment)
        VALUES
          (${id}::uuid, ${currentStage}, ${approverId}::uuid,
           'approved'::approval_decision_enum, ${comment ?? null})
        RETURNING id, asset_id, stage, approver_id, decision, comment, created_at
      `
    );

    await tx.$queryRaw(
      Prisma.sql`
        INSERT INTO audit_logs
          (user_id, action, resource_type, resource_id, organization_id,
           previous_state, new_state)
        VALUES
          (${approverId}::uuid, 'asset.approve', 'asset', ${id}::uuid,
           ${organizationId}::uuid,
           ${previousState}::jsonb, ${newState}::jsonb)
      `
    );

    return { asset: updatedAsset!, approval: approval! };
  });
}

// ── Reject ────────────────────────────────────────────────────────────────────

interface RejectionInput {
  id: string;
  organizationId: string;
  approverId: string;
  reason: string;
}

export async function rejectAsset(
  prisma: PrismaClient,
  input: RejectionInput
): Promise<{ asset: AssetRow; approval: ApprovalRow }> {
  const { id, organizationId, approverId, reason } = input;

  // ── Pre-transaction reads ────────────────────────────────────────────────────

  const asset = await getAsset(prisma, id);
  if (!asset || asset.organization_id !== organizationId) {
    throw new AppError(403, 'Cross-organization access denied', 'Forbidden');
  }

  const stageRole = await resolveStageRole(prisma, asset.status);
  if (!stageRole) {
    throw new AppError(
      409,
      `Asset is not in a rejectable state (current status: '${asset.status}')`,
      'Conflict'
    );
  }

  const hasRole = await callerHoldsRole(prisma, approverId, stageRole.role_name);
  if (!hasRole) {
    throw new AppError(
      409,
      `Asset is in status '${asset.status}' (${stageRole.label}), which requires the '${stageRole.role_name}' role`,
      'Conflict'
    );
  }

  const currentStage = asset.status;
  const previousState = JSON.stringify({ status: asset.status });
  const newState = JSON.stringify({ status: 'rejected' });

  // ── Atomic write ─────────────────────────────────────────────────────────────

  return prisma.$transaction(async (tx) => {
    const [updatedAsset] = await tx.$queryRaw<AssetRow[]>(
      Prisma.sql`
        UPDATE assets SET status = 'rejected'
        WHERE  id = ${id}::uuid
        RETURNING ${assetCols()}
      `
    );

    const [approval] = await tx.$queryRaw<ApprovalRow[]>(
      Prisma.sql`
        INSERT INTO asset_approvals
          (asset_id, stage, approver_id, decision, comment)
        VALUES
          (${id}::uuid, ${currentStage}, ${approverId}::uuid,
           'rejected'::approval_decision_enum, ${reason})
        RETURNING id, asset_id, stage, approver_id, decision, comment, created_at
      `
    );

    await tx.$queryRaw(
      Prisma.sql`
        INSERT INTO audit_logs
          (user_id, action, resource_type, resource_id, organization_id,
           previous_state, new_state)
        VALUES
          (${approverId}::uuid, 'asset.reject', 'asset', ${id}::uuid,
           ${organizationId}::uuid,
           ${previousState}::jsonb, ${newState}::jsonb)
      `
    );

    return { asset: updatedAsset!, approval: approval! };
  });
}
