/**
 * Prisma plugin — registers a single PrismaClient instance on the Fastify app.
 *
 * Usage in route handlers:
 *   const user = await request.server.prisma.user.findUnique(...)
 *
 * Usage in hooks (e.g. requirePermission):
 *   const rows = await request.server.prisma.$queryRaw(...)
 *
 * fastify-plugin is required so the decoration escapes the plugin's encapsulated
 * scope and is visible on the root app instance (and all child contexts).
 */

import fp from 'fastify-plugin';
import { PrismaClient } from '@prisma/client';
import { type FastifyInstance } from 'fastify';

// Extend FastifyInstance so app.prisma is typed across the codebase
declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

async function prismaPlugin(app: FastifyInstance): Promise<void> {
  const prisma = new PrismaClient({
    log:
      process.env['NODE_ENV'] === 'development'
        ? [{ emit: 'stdout', level: 'query' }, 'warn', 'error']
        : ['warn', 'error'],
  });

  await prisma.$connect();

  // Decorate so any part of the app can do: app.prisma / request.server.prisma
  app.decorate('prisma', prisma);

  // Graceful disconnect when the server closes
  app.addHook('onClose', async () => {
    await prisma.$disconnect();
  });
}

export default fp(prismaPlugin, {
  name: 'prisma',
  fastify: '4.x',
});
