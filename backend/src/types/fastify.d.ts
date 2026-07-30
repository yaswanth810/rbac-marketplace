/**
 * Fastify type augmentations for the RBAC marketplace backend.
 *
 * Extends FastifyRequest with `req.user` (decoded JWT payload)
 * and augments @fastify/jwt so the payload type is inferred correctly
 * wherever `request.jwtVerify()` or `reply.jwtSign()` is called.
 */

import 'fastify';
import '@fastify/jwt';

/** Shape of the JWT payload signed on login and decoded on every request. */
export interface JWTPayload {
  /** UUID of the authenticated user */
  userId: string;
  /** UUID of the user's organization — used for org scoping in all queries */
  organizationId: string;
  /**
   * Permission keys at login time (e.g. ['asset.create', 'token.deploy']).
   * NOTE: These are for the CLIENT (drive UI visibility).
   * Server-side enforcement always re-queries the DB — see requirePermission.ts.
   */
  permissions: string[];
}

// Augment @fastify/jwt so jwtVerify() / jwtSign() are typed against JWTPayload
declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JWTPayload;
    user: JWTPayload;
  }
}

// Augment FastifyRequest so req.user is typed without casts in route handlers
declare module 'fastify' {
  interface FastifyRequest {
    user: JWTPayload;
  }
}
