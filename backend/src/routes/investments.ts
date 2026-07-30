/**
 * Investment routes — registered under /api/investments prefix in app.ts
 *
 * POST /api/investments               investment.create  — KYC=approved, asset='listed'
 * POST /api/investments/:id/approve   investment.approve — whitelist + mint on-chain; 502 on chain fail
 * GET  /api/investments/:id           investment.view    — Investor sees own; other roles see org-wide
 * GET  /api/investments               investment.view    — same scoping
 *
 * isOrgStaff scoping
 * ──────────────────
 * Determined by whether the caller holds the system "Investor" role (DB query).
 * Investor → own investments only.
 * Any other role with investment.view (Auditor, Operations Manager, Marketplace Manager,
 * Enterprise Admin…) → all investments in their org.
 * This check runs inside each handler that needs scoping, using the live DB
 * (requirePermission already refreshed request.user.permissions).
 */

import { type FastifyInstance, type FastifyReply } from 'fastify';
import { Prisma } from '@prisma/client';
import { requirePermission } from '../hooks/requirePermission.js';
import {
  BlockchainError,
  createInvestment,
  approveInvestment,
  getInvestment,
  listInvestments,
  type InvestmentScope,
} from '../modules/investments/investment.service.js';
import { AppError } from '../modules/assets/asset.service.js';

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
  if (err instanceof BlockchainError) {
    // Blockchain failures are surfaced as 502 Bad Gateway, not 500.
    // The investment is left at 'paid' status for ops to investigate/retry.
    return reply.status(502).send({
      statusCode: 502,
      error: 'BadGateway',
      message: `On-chain operation failed: ${err.message}`,
    });
  }
  throw err; // unexpected — let Fastify log it as 500
}

// ── Shared: check if caller holds the system "Investor" role ──────────────────
// Investor → scope to own investments only.
// Any other role with investment.view → scope to all in org.

async function resolveInvestmentScope(
  app: FastifyInstance,
  userId: string,
  organizationId: string
): Promise<InvestmentScope> {
  const rows = await app.prisma.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`
      SELECT r.id
      FROM   user_roles ur
      JOIN   roles      r ON ur.role_id = r.id
      WHERE  ur.user_id         = ${userId}::uuid
        AND  r.name             = 'Investor'
        AND  r.organization_id IS NULL
    `
  );
  return {
    isInvestorRole: rows.length > 0,
    requesterId: userId,
    organizationId,
  };
}

// ── Route plugin ──────────────────────────────────────────────────────────────

export default async function investmentRoutes(app: FastifyInstance): Promise<void> {

  // ── POST /api/investments ──────────────────────────────────────────────────
  // Creates an investment in 'pending' status.
  // Body: { assetId, amount, paymentMethod }
  app.post(
    '/',
    { preHandler: [requirePermission('investment.create')] },
    async (request, reply) => {
      const body = request.body as {
        assetId: string;
        amount: number | string;
        paymentMethod: string;
      };

      if (!body.assetId || body.amount == null || !body.paymentMethod) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: '"assetId", "amount", and "paymentMethod" are required',
        });
      }

      try {
        const investment = await createInvestment(request.server.prisma, {
          assetId: body.assetId,
          organizationId: request.user.organizationId,
          investorId: request.user.userId,
          amount: body.amount,
          paymentMethod: body.paymentMethod,
        });
        return reply.status(201).send(investment);
      } catch (err) {
        return sendError(reply, err);
      }
    }
  );

  // ── POST /api/investments/:id/approve ─────────────────────────────────────
  // Two-phase approval: commits 'paid' first, then whitelists + mints on-chain,
  // then advances to 'confirmed'. On-chain failure leaves investment at 'paid'.
  app.post(
    '/:id/approve',
    { preHandler: [requirePermission('investment.approve')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      try {
        const result = await approveInvestment(request.server.prisma, {
          id,
          organizationId: request.user.organizationId,
          approverId: request.user.userId,
        });
        return reply.status(200).send(result);
      } catch (err) {
        return sendError(reply, err);
      }
    }
  );

  // ── GET /api/investments/:id ───────────────────────────────────────────────
  // Investor sees own only; org staff see all in their org.
  app.get(
    '/:id',
    { preHandler: [requirePermission('investment.view')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      try {
        const scope = await resolveInvestmentScope(
          request.server,
          request.user.userId,
          request.user.organizationId
        );

        const investment = await getInvestment(request.server.prisma, id, scope);
        if (!investment) {
          // 403 not 404 — consistent with cross-org access convention.
          // Returning 404 would confirm the ID exists in another org.
          return reply.status(403).send({
            statusCode: 403,
            error: 'Forbidden',
            message: 'Cross-organization access denied',
          });
        }
        return reply.status(200).send(investment);
      } catch (err) {
        return sendError(reply, err);
      }
    }
  );

  // ── GET /api/investments ───────────────────────────────────────────────────
  // List with same scoping as GET /:id.
  app.get(
    '/',
    { preHandler: [requirePermission('investment.view')] },
    async (request, reply) => {
      try {
        const scope = await resolveInvestmentScope(
          request.server,
          request.user.userId,
          request.user.organizationId
        );

        const investments = await listInvestments(request.server.prisma, scope);
        return reply.status(200).send(investments);
      } catch (err) {
        return sendError(reply, err);
      }
    }
  );
}
