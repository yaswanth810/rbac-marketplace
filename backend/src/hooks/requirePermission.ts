/**
 * requirePermission — Fastify preHandler factory
 *
 * Returns a preHandler hook that:
 *   1. Verifies the JWT (401 for missing/invalid/expired token)
 *   2. Queries the DB live for the user's CURRENT permissions (not JWT-cached)
 *   3. Checks that permissionKey is in the result (403 if not)
 *   4. Updates req.user.permissions with the fresh DB set for downstream use
 *
 * ── Why DB-live instead of JWT-cached? ───────────────────────────────────────
 * The JWT embeds permissions for the CLIENT (drives UI visibility without an
 * extra API call). Server-side enforcement always hits the DB so that role
 * changes (especially removals) take effect on the very next request — without
 * forcing the user to re-authenticate.
 *
 * ── Org scoping ──────────────────────────────────────────────────────────────
 * This hook sets req.user.organizationId (from the JWT, trusted after
 * signature verification). Downstream route handlers MUST use this value
 * to scope every query:
 *
 *   where: { organizationId: request.user.organizationId }
 *
 * For resource-level cross-org checks (e.g. GET /assets/:id), use the
 * assertOrgAccess() helper exported from this module.
 */

import { type FastifyRequest, type FastifyReply } from 'fastify';
import { Prisma } from '@prisma/client';

// ─── preHandler factory ───────────────────────────────────────────────────────

export function requirePermission(
  permissionKey: string
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async function preHandler(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    // ── Step 1: Verify JWT ──────────────────────────────────────────────────
    try {
      await request.jwtVerify();
    } catch {
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Missing or invalid authentication token',
      });
    }

    // ── Step 2: Live DB permission check ────────────────────────────────────
    // After jwtVerify(), request.user is populated with the JWT payload.
    // We use userId from the JWT (verified) but fetch permissions from the DB.
    const { userId } = request.user;

    let currentPermissions: string[];
    try {
      const rows = await request.server.prisma.$queryRaw<Array<{ key: string }>>(
        Prisma.sql`
          SELECT DISTINCT p.key
          FROM   permissions      p
          JOIN   role_permissions rp ON p.id      = rp.permission_id
          JOIN   user_roles       ur ON ur.role_id = rp.role_id
          WHERE  ur.user_id = ${userId}::uuid
          ORDER  BY p.key
        `
      );
      currentPermissions = rows.map((r) => r.key);
    } catch (dbErr) {
      request.server.log.error({ err: dbErr }, 'requirePermission: DB query failed');
      return reply.status(500).send({
        statusCode: 500,
        error: 'Internal Server Error',
        message: 'Failed to verify permissions',
      });
    }

    // ── Step 3: Check required permission ───────────────────────────────────
    if (!currentPermissions.includes(permissionKey)) {
      return reply.status(403).send({
        statusCode: 403,
        error: 'Forbidden',
        message: `Missing permission: ${permissionKey}`,
      });
    }

    // ── Step 4: Refresh req.user.permissions with live DB values ────────────
    // Downstream handlers that read req.user.permissions get the current set,
    // not the snapshot baked into the JWT at login time.
    request.user.permissions = currentPermissions;
  };
}

// ─── Org-scoping helper ───────────────────────────────────────────────────────

/**
 * Call this inside any route handler that fetches a resource by ID to enforce
 * org-level isolation.
 *
 * Returns 403 (not 404) regardless of whether the resource exists —
 * returning 404 would leak the fact that the resource exists in another org.
 *
 * Usage:
 *   const asset = await getAssetOrNull(id);
 *   assertOrgAccess(asset?.organizationId, request, reply);
 */
export function assertOrgAccess(
  resourceOrgId: string | null | undefined,
  request: FastifyRequest,
  reply: FastifyReply
): boolean {
  if (!resourceOrgId || resourceOrgId !== request.user.organizationId) {
    reply.status(403).send({
      statusCode: 403,
      error: 'Forbidden',
      message: 'Cross-organization access denied',
    });
    return false; // caller should return immediately
  }
  return true;
}
