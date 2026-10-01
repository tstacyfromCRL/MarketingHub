import type { FastifyReply, FastifyRequest } from 'fastify';
import { hasRole, type Role } from '@mh/shared';
import { prisma } from '@mh/db';

export class HttpError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

export const badRequest = (m: string) => new HttpError(400, m);
export const forbidden = (m = 'You do not have permission to do that') => new HttpError(403, m);
export const notFound = (m = 'Not found') => new HttpError(404, m);
export const conflict = (m: string) => new HttpError(409, m);

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string };
    user: AuthUser;
  }
}

/** preHandler: verifies the bearer token (or ?token= for <img> and WebSocket URLs) and loads the user. */
export async function authenticate(req: FastifyRequest, _reply: FastifyReply) {
  const queryToken = (req.query as Record<string, string> | undefined)?.token;
  let payload: { sub: string };
  try {
    payload = queryToken ? req.server.jwt.verify<{ sub: string }>(queryToken) : await req.jwtVerify<{ sub: string }>();
  } catch {
    throw new HttpError(401, 'Please sign in again');
  }
  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user || !user.active) throw new HttpError(401, 'Account disabled');
  req.user = { id: user.id, name: user.name, email: user.email, role: user.role as Role };
}

export function requireRole(role: Role) {
  return async (req: FastifyRequest) => {
    if (!hasRole(req.user.role, role)) throw forbidden();
  };
}

export function isManager(user: AuthUser) {
  return hasRole(user.role, 'MANAGER');
}
