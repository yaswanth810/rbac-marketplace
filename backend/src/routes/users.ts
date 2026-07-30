/**
 * users.ts — User self-service routes
 * Registered under /api/users prefix in app.ts
 *
 * PATCH /api/users/me/wallet
 *   — Saves a MetaMask wallet address for the calling user.
 *   — Any authenticated user (no specific permission required beyond valid JWT).
 *   — Validates the address is a valid EVM address (checksummed via ethers).
 *   — Used by the WalletConnect component in the investor frontend.
 *
 * GET /api/users/me
 *   — Returns the calling user's profile including wallet_address.
 *   — Used by the WalletConnect component to show current connected wallet.
 */

import { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import { ethers } from 'ethers';
import { Prisma } from '@prisma/client';

// Minimal JWT auth guard — only requires a valid token, no specific permission.
// Same pattern used by the logout route in auth.ts.
async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch {
    return reply.status(401).send({
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Missing or invalid authentication token',
    });
  }
}

export default async function usersRoutes(app: FastifyInstance): Promise<void> {

  // ── GET /api/users/me ─────────────────────────────────────────────────────
  // Returns the calling user's profile: id, email, name, wallet_address.
  app.get(
    '/me',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const rows = await request.server.prisma.$queryRaw<Array<{
        id: string;
        email: string;
        name: string | null;
        wallet_address: string | null;
      }>>(
        Prisma.sql`
          SELECT id, email, name, wallet_address
          FROM   users
          WHERE  id = ${request.user.userId}::uuid
        `
      );

      const user = rows[0];
      if (!user) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'User not found' });

      return reply.status(200).send(user);
    }
  );

  // ── PATCH /api/users/me/wallet ────────────────────────────────────────────
  // Saves the caller's MetaMask wallet address.
  // Body: { walletAddress: string }  — must be a valid EVM address.
  // Response: { walletAddress: string }
  app.patch(
    '/me/wallet',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const body = request.body as { walletAddress?: string };

      if (!body.walletAddress) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: '"walletAddress" is required',
        });
      }

      // Validate EVM address format — ethers.isAddress handles both checksummed
      // and lowercase (0x...) formats.
      if (!ethers.isAddress(body.walletAddress)) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: `"${body.walletAddress}" is not a valid EVM address`,
        });
      }

      // Store as checksummed (EIP-55) for consistency.
      const checksummed = ethers.getAddress(body.walletAddress);

      await request.server.prisma.$queryRaw(
        Prisma.sql`
          UPDATE users
          SET    wallet_address = ${checksummed}
          WHERE  id             = ${request.user.userId}::uuid
        `
      );

      await request.server.prisma.$queryRaw(
        Prisma.sql`
          INSERT INTO audit_logs
            (user_id, action, resource_type, resource_id, organization_id, new_state)
          VALUES
            (${request.user.userId}::uuid,
             'user.wallet_connected',
             'user',
             ${request.user.userId}::uuid,
             ${request.user.organizationId}::uuid,
             ${JSON.stringify({ walletAddress: checksummed })}::jsonb)
        `
      );

      return reply.status(200).send({ walletAddress: checksummed });
    }
  );
}
