/**
 * Marketplace routes — registered under /api/marketplace prefix in app.ts
 *
 * POST /api/marketplace/listings             marketplace.create  — asset must be 'tokenized'
 * POST /api/marketplace/listings/:id/publish marketplace.publish — listing → 'published'; asset → 'listed'
 * GET  /api/marketplace                      (JWT required, no perm gate) — browse published listings
 *
 * Org scoping: marketplace_listings has no org column; org is always
 * derived through the JOIN marketplace_listings → assets → organization_id.
 */

import { type FastifyInstance, type FastifyReply } from 'fastify';
import { Prisma } from '@prisma/client';
import { requirePermission } from '../hooks/requirePermission.js';
import { createListing, publishListing, listPublishedListings } from '../modules/marketplace/marketplace.service.js';
import { AppError } from '../modules/assets/asset.service.js';

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
  throw err;
}

export default async function marketplaceRoutes(app: FastifyInstance): Promise<void> {

  // ── GET /api/marketplace/listings?assetId=:assetId ────────────────────────
  // Returns listing rows for a specific asset (0 or 1 rows in practice).
  // Used by the asset detail page to show pipeline status to all users.
  // Permission: asset.read — any user who can view the asset can see listing
  // status. Create/publish are separately gated by marketplace.create/.publish.
  app.get(
    '/listings',
    { preHandler: [requirePermission('asset.read')] },
    async (request, reply) => {
      const query = request.query as { assetId?: string };
      if (!query.assetId) {
        return reply.status(400).send({
          statusCode: 400, error: 'Bad Request', message: '"assetId" query param is required',
        });
      }

      try {
        const rows = await request.server.prisma.$queryRaw<Array<{
          id: string;
          asset_id: string;
          status: string;
          published_at: Date | null;
        }>>(
          Prisma.sql`
            SELECT ml.id, ml.asset_id, ml.status::text, ml.published_at
            FROM   marketplace_listings ml
            JOIN   assets a ON a.id = ml.asset_id
            WHERE  ml.asset_id       = ${query.assetId}::uuid
              AND  a.organization_id = ${request.user.organizationId}::uuid
            ORDER BY ml.created_at DESC
            LIMIT  1
          `
        );
        return reply.status(200).send(rows);
      } catch (err) {
        return sendError(reply, err);
      }
    }
  );

  // ── POST /api/marketplace/listings ────────────────────────────────────────
  // Creates a listing in 'draft' state for a tokenized asset.
  // Body: { assetId }
  app.post(
    '/listings',
    { preHandler: [requirePermission('marketplace.create')] },
    async (request, reply) => {
      const body = request.body as { assetId: string };

      if (!body.assetId) {
        return reply.status(400).send({
          statusCode: 400, error: 'Bad Request', message: '"assetId" is required',
        });
      }

      try {
        const listing = await createListing(request.server.prisma, {
          assetId: body.assetId,
          organizationId: request.user.organizationId,
          userId: request.user.userId,
        });
        return reply.status(201).send(listing);
      } catch (err) {
        return sendError(reply, err);
      }
    }
  );

  // ── POST /api/marketplace/listings/:id/publish ─────────────────────────────
  // Publishes a listing: listing status → 'published'; asset status → 'listed'.
  app.post(
    '/listings/:id/publish',
    { preHandler: [requirePermission('marketplace.publish')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      try {
        const listing = await publishListing(request.server.prisma, {
          id,
          organizationId: request.user.organizationId,
          userId: request.user.userId,
        });
        return reply.status(200).send(listing);
      } catch (err) {
        return sendError(reply, err);
      }
    }
  );

  // ── GET /api/marketplace ──────────────────────────────────────────────────
  // Browse published listings in the caller's org.
  // JWT required but no specific permission needed — any authenticated user
  // within the org can browse the marketplace.
  //
  // Query params: asset_class, issuer, currency, risk (all optional)
  app.get(
    '/',
    {
      preHandler: [
        async (request, reply) => {
          try {
            await request.jwtVerify();
          } catch {
            return reply.status(401).send({
              statusCode: 401, error: 'Unauthorized',
              message: 'Missing or invalid authentication token',
            });
          }
        },
      ],
    },
    async (request, reply) => {
      const query = request.query as {
        asset_class?: string;
        issuer?: string;
        currency?: string;
        risk?: string;
      };

      try {
        const listings = await listPublishedListings(
          request.server.prisma,
          request.user.organizationId,
          {
            assetClass: query.asset_class ?? null,
            issuerId: query.issuer ?? null,
            currency: query.currency ?? null,
            risk: query.risk ?? null,
          }
        );
        return reply.status(200).send(listings);
      } catch (err) {
        return sendError(reply, err);
      }
    }
  );
}
