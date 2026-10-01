import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { prisma } from '@mh/db';
import { createUserSchema, inviteSchema, updateUserSchema } from '@mh/shared';
import { recordEvent } from '@mh/core';
import { authenticate, badRequest, conflict, requireRole } from '../http';
import { publicUser } from './auth';

export async function userRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  /** Directory of teammates, visible to everyone (for assigning tasks, the team calendar, etc). */
  app.get('/users', async () => {
    const users = await prisma.user.findMany({ orderBy: { name: 'asc' } });
    return users.map((u) => ({ ...publicUser(u), active: u.active, lastLoginAt: u.lastLoginAt }));
  });

  app.post('/users', { preHandler: requireRole('ADMIN') }, async (req) => {
    const body = createUserSchema.parse(req.body);
    const email = body.email.toLowerCase();
    if (await prisma.user.findUnique({ where: { email } })) throw conflict('A user with that email already exists');
    const user = await prisma.user.create({
      data: { email, name: body.name, role: body.role, slackUserId: body.slackUserId, passwordHash: await bcrypt.hash(body.password, 11) },
    });
    await recordEvent({ actorId: req.user.id, verb: 'create', entityType: 'user', entityId: user.id, summary: `${user.name} (${user.role.toLowerCase()}) added by ${req.user.name}`, link: '/settings/users' });
    return publicUser(user);
  });

  app.patch<{ Params: { id: string } }>('/users/:id', { preHandler: requireRole('ADMIN') }, async (req) => {
    const body = updateUserSchema.parse(req.body);
    if (req.params.id === req.user.id && (body.role && body.role !== 'ADMIN' || body.active === false)) {
      throw badRequest('You cannot remove your own admin access');
    }
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: {
        name: body.name,
        role: body.role,
        active: body.active,
        slackUserId: body.slackUserId,
        passwordHash: body.password ? await bcrypt.hash(body.password, 11) : undefined,
      },
    });
    const changes = [body.role && `role ${body.role.toLowerCase()}`, body.active === false && 'deactivated', body.active === true && 'reactivated', body.password && 'password reset']
      .filter(Boolean)
      .join(', ');
    await recordEvent({ actorId: req.user.id, verb: 'update', entityType: 'user', entityId: user.id, summary: `${user.name} updated by ${req.user.name}${changes ? ` (${changes})` : ''}`, link: '/settings/users' });
    return publicUser(user);
  });

  // ---- Invites ("Create New User" on the welcome screen) ----
  app.get('/invites', { preHandler: requireRole('ADMIN') }, async () =>
    prisma.invite.findMany({ where: { usedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } }),
  );

  app.post('/invites', { preHandler: requireRole('ADMIN') }, async (req) => {
    const body = inviteSchema.parse(req.body);
    const invite = await prisma.invite.create({
      data: {
        code: newInviteCode(),
        role: body.role,
        email: body.email?.toLowerCase(),
        createdById: req.user.id,
        expiresAt: new Date(Date.now() + body.expiresInDays * 86_400_000),
      },
    });
    await recordEvent({
      actorId: req.user.id, verb: 'create', entityType: 'invite', entityId: invite.id, link: '/settings/users',
      summary: `${body.role.toLowerCase()} invite${body.email ? ` for ${body.email}` : ''} created by ${req.user.name}`,
    });
    return invite;
  });

  app.delete<{ Params: { id: string } }>('/invites/:id', { preHandler: requireRole('ADMIN') }, async (req) => {
    await prisma.invite.deleteMany({ where: { id: req.params.id, usedAt: null } });
    return { ok: true };
  });
}

/** Readable code like MH-7K3Q-92LD (no 0/O/1/I to avoid misreading). */
function newInviteCode(): string {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const bytes = randomBytes(8);
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
  return `MH-${chars.slice(0, 4)}-${chars.slice(4)}`;
}
