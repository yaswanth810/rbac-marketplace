/**
 * Token routes — registered under /api/tokens prefix in app.ts
 *
 * POST /api/tokens/configure  token.configure — stores token params; asset must be 'approved'
 * POST /api/tokens/deploy     token.deploy    — deploys RWAToken on-chain; asset → 'tokenized'
 * POST /api/tokens/mint       token.mint      — mints to a whitelisted wallet; 409 if not whitelisted
 *
 * Replaces the Prompt-2 stub (/api/tokens/:assetId/deploy) entirely.
 * The asset ID is now passed in the request body, not the URL, because
 * configure/deploy/mint are fleet-level Treasury operations — not
 * sub-resources of a single asset REST path.
 */

import { type FastifyInstance, type FastifyReply } from 'fastify';
import { Prisma } from '@prisma/client';
import { requirePermission } from '../hooks/requirePermission.js';
import { configureToken, deployToken, mintTokens } from '../modules/tokens/token.service.js';
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
  throw err;
}

// ── Route plugin ──────────────────────────────────────────────────────────────

export default async function tokenRoutes(app: FastifyInstance): Promise<void> {

  // ── POST /api/tokens/configure ─────────────────────────────────────────────
  // Stores symbol / total_supply / decimals / price in the tokens table.
  // Asset must be in 'approved' status. Only one config per asset (UNIQUE key).
  //
  // Body: { assetId, tokenSymbol, totalSupply, decimals?, price?, chainId }
  //   totalSupply — whole-token units (e.g. 1_000_000). The RWAToken constructor
  //                 multiplies by 10**decimals internally; do NOT pass wei here.
  app.post(
    '/configure',
    { preHandler: [requirePermission('token.configure')] },
    async (request, reply) => {
      const body = request.body as {
        assetId: string;
        tokenSymbol: string;
        totalSupply: number;
        decimals?: number;
        price?: number;
        chainId: number;
      };

      if (!body.assetId || !body.tokenSymbol || body.totalSupply == null || !body.chainId) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Fields "assetId", "tokenSymbol", "totalSupply", and "chainId" are required',
        });
      }

      try {
        const token = await configureToken(request.server.prisma, {
          assetId: body.assetId,
          organizationId: request.user.organizationId,
          userId: request.user.userId,
          tokenSymbol: body.tokenSymbol,
          totalSupply: body.totalSupply,
          decimals: body.decimals ?? 18,
          price: body.price,
          chainId: body.chainId,
        });
        return reply.status(201).send(token);
      } catch (err) {
        return sendError(reply, err);
      }
    }
  );

  // ── POST /api/tokens/deploy ────────────────────────────────────────────────
  // Deploys the RWAToken contract on-chain using ethers v6.
  // Reads constructor args (name, symbol, supplyCap, admin) from the DB —
  // NOT from the client. Sets asset status → 'tokenized'.
  // Requires BLOCKCHAIN_RPC_URL and DEPLOYER_PRIVATE_KEY in environment.
  //
  // Body: { assetId }
  app.post(
    '/deploy',
    { preHandler: [requirePermission('token.deploy')] },
    async (request, reply) => {
      const body = request.body as { assetId: string };

      if (!body.assetId) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Field "assetId" is required',
        });
      }

      try {
        const token = await deployToken(request.server.prisma, {
          assetId: body.assetId,
          organizationId: request.user.organizationId,
          userId: request.user.userId,
        });
        return reply.status(200).send(token);
      } catch (err) {
        return sendError(reply, err);
      }
    }
  );

  // ── POST /api/tokens/mint ──────────────────────────────────────────────────
  // Calls the deployed contract's mint() function via ethers v6.
  // The recipient's wallet must already be whitelisted on-chain.
  // This endpoint does NOT auto-whitelist — that happens at investment
  // approval time (Prompt 5). Returns 409 if not whitelisted.
  //
  // Body: { assetId, recipientUserId, amount }
  //   amount — token amount in wei, as a STRING to prevent double-precision loss
  //            (e.g. "1000000000000000000" for 1 token with 18 decimals)
  app.post(
    '/mint',
    { preHandler: [requirePermission('token.mint')] },
    async (request, reply) => {
      const body = request.body as {
        assetId: string;
        recipientUserId: string;
        amount: string;
      };

      if (!body.assetId || !body.recipientUserId || !body.amount) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Fields "assetId", "recipientUserId", and "amount" are required',
        });
      }

      // Validate that amount is a valid non-negative integer string
      if (!/^\d+$/.test(body.amount) || BigInt(body.amount) === 0n) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: '"amount" must be a positive integer string in wei (e.g. "1000000000000000000")',
        });
      }

      try {
        const result = await mintTokens(request.server.prisma, {
          assetId: body.assetId,
          organizationId: request.user.organizationId,
          userId: request.user.userId,
          recipientUserId: body.recipientUserId,
          amount: body.amount,
        });
        return reply.status(200).send(result);
      } catch (err) {
        return sendError(reply, err);
      }
    }
  );

  // ── GET /api/tokens/:assetId ───────────────────────────────────────────────
  // Returns the token configuration row for an asset, or 404 if not configured.
  // Permission: asset.read — any user who can view the asset can see its token
  // configuration for pipeline display purposes. Write operations (configure,
  // deploy, mint) are separately gated by their own permissions.
  app.get(
    '/:assetId',
    { preHandler: [requirePermission('asset.read')] },
    async (request, reply) => {
      const { assetId } = request.params as { assetId: string };

      try {
        const rows = await request.server.prisma.$queryRaw<Array<{
          id: string;
          asset_id: string;
          contract_address: string | null;
          token_symbol: string;
          total_supply: string | null;
          decimals: number;
          price: string | null;
          chain_id: number;
        }>>(
          Prisma.sql`
            SELECT id, asset_id, contract_address, token_symbol,
                   total_supply::text, decimals, price::text, chain_id
            FROM   tokens
            WHERE  asset_id = ${assetId}::uuid
          `
        );

        if (!rows[0]) {
          return reply.status(404).send({
            statusCode: 404,
            error: 'Not Found',
            message: 'Token not yet configured for this asset',
          });
        }

        return reply.status(200).send(rows[0]);
      } catch (err) {
        return sendError(reply, err);
      }
    }
  );
}
