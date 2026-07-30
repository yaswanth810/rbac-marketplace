/**
 * app.ts — Fastify application factory
 *
 * Registers plugins and routes. Called by src/index.ts (server start)
 * and by tests/integration/helpers/app.ts (supertest, no listen()).
 */

import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';

// Plugins
import prismaPlugin from './plugins/prisma.js';

// Routes
import authRoutes from './routes/auth.js';
import assetRoutes from './routes/assets.js';
import tokenRoutes from './routes/tokens.js';
import marketplaceRoutes from './routes/marketplace.js';
import investmentRoutes from './routes/investments.js';
import auditRoutes from './routes/audit.js';
import usersRoutes from './routes/users.js';


export async function buildApp(): Promise<FastifyInstance> {
  const isTest = process.env['NODE_ENV'] === 'test';
  const isProd = process.env['NODE_ENV'] === 'production';

  const app = Fastify({
    // Disable logging in test mode to keep test output clean
    logger: isTest
      ? false
      : {
          level: isProd ? 'info' : 'debug',
          transport: !isProd
            ? { target: 'pino-pretty', options: { colorize: true } }
            : undefined,
        },
  });

  // ─── Core Plugins ──────────────────────────────────────────────────────────

  const allowedOrigins = process.env['CORS_ORIGIN']
    ?.split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  await app.register(cors, {
    origin: allowedOrigins?.length ? allowedOrigins : '*',
    credentials: true,
  });

  // JWT_SECRET is required in production — crash early rather than run with a weak default.
  const jwtSecret = process.env['JWT_SECRET'];
  if (!jwtSecret && process.env['NODE_ENV'] === 'production') {
    throw new Error('JWT_SECRET environment variable is required in production.');
  }

  await app.register(jwt, {
    secret: jwtSecret ?? 'fallback_dev_secret_DO_NOT_USE_IN_PRODUCTION',
    sign: {
      expiresIn: process.env['JWT_EXPIRES_IN'] ?? '7d',
    },
  });


  // PrismaClient singleton — decorated as app.prisma / request.server.prisma
  await app.register(prismaPlugin);

  // ─── Health Check ──────────────────────────────────────────────────────────

  app.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env['NODE_ENV'] ?? 'development',
  }));

  // ─── Routes ────────────────────────────────────────────────────────────────

  await app.register(authRoutes,       { prefix: '/api/auth' });
  await app.register(assetRoutes,       { prefix: '/api/assets' });
  await app.register(tokenRoutes,       { prefix: '/api/tokens' });
  await app.register(marketplaceRoutes, { prefix: '/api/marketplace' });
  await app.register(investmentRoutes,  { prefix: '/api/investments' });
  await app.register(auditRoutes,       { prefix: '/api/audit' });
  await app.register(usersRoutes,       { prefix: '/api/users' });

  return app;
}
