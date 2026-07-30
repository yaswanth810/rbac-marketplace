/**
 * Auth routes — registered under /api/auth prefix in app.ts
 *
 * POST /api/auth/login   — validates credentials, returns signed JWT
 * POST /api/auth/logout  — requires valid JWT, confirms client-side token discard
 */

import { type FastifyInstance } from 'fastify';
import { loginUser } from '../modules/auth/auth.service.js';
import { loginSchema } from '../modules/auth/auth.schemas.js';

export default async function authRoutes(app: FastifyInstance): Promise<void> {
  // ── POST /api/auth/login ──────────────────────────────────────────────────

  app.post(
    '/login',
    { schema: loginSchema },
    async (request, reply) => {
      const { email, password } = request.body as { email: string; password: string };

      let result;
      try {
        result = await loginUser(app.prisma, email, password);
      } catch (err) {
        if (err instanceof Error) {
          if (err.message === 'INVALID_CREDENTIALS') {
            return reply.status(401).send({
              statusCode: 401,
              error: 'Unauthorized',
              message: 'Invalid email or password',
            });
          }
          if (err.message === 'ACCOUNT_INACTIVE') {
            return reply.status(403).send({
              statusCode: 403,
              error: 'Forbidden',
              message: 'Account is inactive or suspended. Contact your administrator.',
            });
          }
        }
        // Unexpected error — re-throw so Fastify's error handler logs it
        throw err;
      }

      const token = await reply.jwtSign({
        userId: result.userId,
        organizationId: result.organizationId,
        permissions: result.permissions,
      });

      return reply.status(200).send({
        token,
        expiresIn: process.env['JWT_EXPIRES_IN'] ?? '7d',
        user: {
          id: result.userId,
          name: result.name,
          email: result.email,
          organizationId: result.organizationId,
          permissions: result.permissions,
        },
      });
    }
  );

  // ── POST /api/auth/logout ─────────────────────────────────────────────────
  // Requires a valid JWT (per spec — 401 for missing/invalid token).
  // Stateless: no server-side token blacklist. The client discards the token.
  // A Redis blacklist / short expiry + refresh-token strategy can be added later.

  app.post(
    '/logout',
    {
      preHandler: [
        async (request, reply) => {
          try {
            await request.jwtVerify();
          } catch {
            return reply.status(401).send({
              statusCode: 401,
              error: 'Unauthorized',
              message: 'Missing or invalid authentication token',
            });
          }
        },
      ],
    },
    async (_request, reply) => {
      return reply.status(200).send({ message: 'Logged out successfully' });
    }
  );
}
