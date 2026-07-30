/**
 * Asset routes — registered under /api/assets prefix in app.ts
 *
 * POST   /api/assets          asset.create  — creates asset in 'draft', org-scoped
 * GET    /api/assets          asset.read    — lists org-scoped assets
 * GET    /api/assets/:id      asset.read    — single asset, org-scoped
 * PATCH  /api/assets/:id      asset.update  — draft only
 * POST   /api/assets/:id/submit  asset.submit  — draft → pending_compliance
 * POST   /api/assets/:id/approve asset.approve — stage-role gated (409 on wrong stage)
 * POST   /api/assets/:id/reject  asset.reject  — stage-role gated, reason required
 *
 * Approval / rejection design
 * ───────────────────────────
 * • requirePermission('asset.approve') is the FIRST gate (does this user hold
 *   the permission at all?).
 * • Inside the handler, asset.service.ts performs a SECOND gate:
 *     – Is the asset in an approvable/rejectable status?
 *     – Does the caller hold the SPECIFIC ROLE mapped to that stage?
 *   This prevents a Compliance Officer from acting at the Legal stage even
 *   though both roles share the 'asset.approve' permission key.
 * • Wrong-stage attempts return 409 Conflict, not 403.
 */

import { type FastifyInstance, type FastifyReply } from 'fastify';
import { Prisma } from '@prisma/client';
import { requirePermission, assertOrgAccess } from '../hooks/requirePermission.js';
import {
  AppError,
  createAsset,
  listAssets,
  listAssetsForApproval,
  getAsset,
  updateAsset,
  submitAsset,
  approveAsset,
  rejectAsset,
} from '../modules/assets/asset.service.js';

// ── Error → reply helper ───────────────────────────────────────────────────────

function sendError(
  reply: FastifyReply,
  err: unknown
): ReturnType<typeof reply.send> {
  if (err instanceof AppError) {
    return reply.status(err.statusCode).send({
      statusCode: err.statusCode,
      error: err.error,
      message: err.message,
    });
  }
  throw err; // unexpected — let Fastify's error handler log it as 500
}

// ── Route plugin ──────────────────────────────────────────────────────────────

export default async function assetRoutes(app: FastifyInstance): Promise<void> {
  // ── POST /api/assets ───────────────────────────────────────────────────────
  app.post(
    '/',
    { preHandler: [requirePermission('asset.create')] },
    async (request, reply) => {
      const body = request.body as {
        name: string;
        asset_type: string;
        description?: string;
        jurisdiction?: string;
        currency?: string;
        total_value?: number | string;
        metadata?: Record<string, unknown>;
      };

      if (!body.name || !body.asset_type) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Fields "name" and "asset_type" are required',
        });
      }

      try {
        const asset = await createAsset(request.server.prisma, {
          organizationId: request.user.organizationId,
          issuerId: request.user.userId,
          name: body.name,
          assetType: body.asset_type,
          description: body.description,
          jurisdiction: body.jurisdiction,
          currency: body.currency,
          totalValue: body.total_value,
          metadata: body.metadata,
        });
        return reply.status(201).send(asset);
      } catch (err) {
        return sendError(reply, err);
      }
    }
  );

  // ── GET /api/assets ────────────────────────────────────────────────────────
  // Query params:
  //   pending_approval=true  — return only assets pending THIS caller's approval,
  //                            filtered server-side by the caller's roles.
  //                            Used by the Approvals page. Returns [] for users
  //                            with no approval role.
  //   status=<value>         — filter by exact asset status (e.g. 'approved',
  //                            'tokenized'). Used by work-queue sections for
  //                            Treasury Officer and Marketplace Manager.
  app.get(
    '/',
    { preHandler: [requirePermission('asset.read')] },
    async (request, reply) => {
      const query = request.query as { pending_approval?: string; status?: string };
      const pendingOnly = query.pending_approval === 'true';
      const statusFilter = query.status?.trim() || null;

      try {
        let assets;
        if (pendingOnly) {
          assets = await listAssetsForApproval(
            request.server.prisma,
            request.user.organizationId,
            request.user.userId
          );
        } else if (statusFilter) {
          assets = await listAssets(
            request.server.prisma,
            request.user.organizationId,
            statusFilter
          );
        } else {
          assets = await listAssets(
            request.server.prisma,
            request.user.organizationId
          );
        }
        return reply.status(200).send(assets);
      } catch (err) {
        return sendError(reply, err);
      }
    }
  );

  // ── GET /api/assets/:id ────────────────────────────────────────────────────
  app.get(
    '/:id',
    { preHandler: [requirePermission('asset.read')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      try {
        const asset = await getAsset(request.server.prisma, id);

        // assertOrgAccess returns false AND sends 403 when access is denied.
        // Passing null/undefined (not found) also triggers 403 — intentional:
        // 404 would leak that the resource exists in another org.
        if (!assertOrgAccess(asset?.organization_id, request, reply)) return;

        return reply.status(200).send(asset);
      } catch (err) {
        return sendError(reply, err);
      }
    }
  );

  // ── PATCH /api/assets/:id ──────────────────────────────────────────────────
  app.patch(
    '/:id',
    { preHandler: [requirePermission('asset.update')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as {
        name?: string;
        description?: string;
        jurisdiction?: string;
        currency?: string;
        total_value?: number | string;
        metadata?: Record<string, unknown>;
      };

      try {
        const asset = await updateAsset(
          request.server.prisma,
          id,
          request.user.organizationId,
          {
            name: body.name,
            description: body.description,
            jurisdiction: body.jurisdiction,
            currency: body.currency,
            totalValue: body.total_value,
            metadata: body.metadata,
          }
        );
        return reply.status(200).send(asset);
      } catch (err) {
        return sendError(reply, err);
      }
    }
  );

  // ── POST /api/assets/:id/submit ────────────────────────────────────────────
  app.post(
    '/:id/submit',
    { preHandler: [requirePermission('asset.submit')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      try {
        const asset = await submitAsset(
          request.server.prisma,
          id,
          request.user.organizationId,
          request.user.userId
        );
        return reply.status(200).send(asset);
      } catch (err) {
        return sendError(reply, err);
      }
    }
  );

  // ── POST /api/assets/:id/approve ───────────────────────────────────────────
  // requirePermission is the first gate (does user hold asset.approve at all?).
  // The service performs the second gate: stage-specific role check.
  // Wrong-stage attempts return 409, not 403.
  app.post(
    '/:id/approve',
    { preHandler: [requirePermission('asset.approve')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { comment } = (request.body ?? {}) as { comment?: string };

      try {
        const result = await approveAsset(request.server.prisma, {
          id,
          organizationId: request.user.organizationId,
          approverId: request.user.userId,
          comment,
        });
        return reply.status(200).send(result);
      } catch (err) {
        return sendError(reply, err);
      }
    }
  );

  // ── POST /api/assets/:id/reject ────────────────────────────────────────────
  app.post(
    '/:id/reject',
    { preHandler: [requirePermission('asset.reject')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { reason } = (request.body ?? {}) as { reason?: string };

      if (!reason?.trim()) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Field "reason" is required for rejection',
        });
      }

      try {
        const result = await rejectAsset(request.server.prisma, {
          id,
          organizationId: request.user.organizationId,
          approverId: request.user.userId,
          reason,
        });
        return reply.status(200).send(result);
      } catch (err) {
        return sendError(reply, err);
      }
    }
  );

  // ── GET /api/assets/:id/approvals ──────────────────────────────────────────
  // Returns all asset_approvals rows for the asset in chronological order.
  // Org-scoped: access is validated through the parent asset's organization_id.
  // Permission: asset.read (same gate as GET /api/assets/:id).
  app.get(
    '/:id/approvals',
    { preHandler: [requirePermission('asset.read')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      try {
        // Validate org access through the parent asset (403 = not found OR wrong org)
        const asset = await getAsset(request.server.prisma, id);
        if (!assertOrgAccess(asset?.organization_id, request, reply)) return;

        // Return all approvals with approver name for display
        const approvals = await request.server.prisma.$queryRaw<Array<{
          id: string;
          asset_id: string;
          stage: string;
          approver_id: string;
          approver_name: string | null;
          decision: string;
          comment: string | null;
          created_at: Date;
        }>>(
          // Import Prisma inline — it's already imported at the top of this module
          // via the service functions, but we need Prisma.sql here directly.
          // Use a parameterised query to keep it safe.
          Prisma.sql`
            SELECT
              aa.id,
              aa.asset_id,
              aa.stage,
              aa.approver_id,
              u.name  AS approver_name,
              aa.decision::text,
              aa.comment,
              aa.created_at
            FROM  asset_approvals aa
            LEFT  JOIN users u ON aa.approver_id = u.id
            WHERE aa.asset_id = ${id}::uuid
            ORDER BY aa.created_at ASC
          `
        );

        return reply.status(200).send(approvals);
      } catch (err) {
        return sendError(reply, err);
      }
    }
  );
}
