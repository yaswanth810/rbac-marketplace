/**
 * Audit routes — registered under /api/audit prefix in app.ts
 *
 * GET /api/audit — returns the 100 most recent audit log entries for the
 *                  caller's organization, newest first.
 *
 * Gated on audit.view permission. Read-only — no mutations here.
 */

import { type FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { requirePermission } from '../hooks/requirePermission.js';

export default async function auditRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/',
    { preHandler: [requirePermission('audit.view')] },
    async (request, reply) => {
      const { organizationId } = request.user;

      const logs = await request.server.prisma.$queryRaw(
        Prisma.sql`
          SELECT
            id, user_id, action, resource_type, resource_id, organization_id,
            previous_state, new_state, ip_address, created_at
          FROM   audit_logs
          WHERE  organization_id = ${organizationId}::uuid
          ORDER  BY created_at DESC
          LIMIT  100
        `
      );

      return reply.status(200).send(logs);
    }
  );
}
