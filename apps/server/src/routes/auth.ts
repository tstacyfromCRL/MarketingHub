import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma, ensureDefaults } from '@mh/db';
import { bootstrapSchema, joinSchema, loginSchema, notificationPrefsSchema, DEFAULT_NOTIFICATION_PREFS } from '@mh/shared';
import { recordEvent } from '@mh/core';
import { authenticate, badRequest, conflict, HttpError } from '../http';

function publicUser(u: { id: string; email: string; name: string; role: string; slackUserId: string | null; notificationPrefs: unknown; libraryConfigured: boolean }) {
  const prefs = notificationPrefsSchema.safeParse(u.notificationPrefs);
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    slackUserId: u.slackUserId,
    libraryConfigured: u.libraryConfigured,
    notificationPrefs: prefs.success ? prefs.data : DEFAULT_NOTIFICATION_PREFS,
  };
}
export { publicUser };

export async function authRoutes(app: FastifyInstance) {
  /** Whether the first admin still needs to be created. */
  app.get('/auth/status', async () => ({ needsBootstrap: (await prisma.user.count()) === 0 }));

  app.post('/auth/bootstrap', async (req) => {
    const body = bootstrapSchema.parse(req.body);
    if ((await prisma.user.count()) > 0) throw conflict('Setup has already been completed');
    await ensureDefaults();
    const user = await prisma.user.create({
      data: { email: body.email.toLowerCase(), name: body.name, passwordHash: await bcrypt.hash(body.password, 11), role: 'ADMIN' },
    });
    await recordEvent({ actorId: user.id, verb: 'bootstrap', entityType: 'user', entityId: user.id, summary: `Marketing Hub set up by ${user.name}` });
    return { token: app.jwt.sign({ sub: user.id }, { expiresIn: '12h' }), user: publicUser(user) };
  });

  /** "Create New User": sign up with an invite code from an admin. The invite decides the role. */
  app.post('/auth/join', async (req) => {
    const body = joinSchema.parse(req.body);
    const email = body.email.toLowerCase();
    const code = body.code.trim().toUpperCase();
    const invite = await prisma.invite.findUnique({ where: { code } });
    if (!invite) throw badRequest("That invite code isn't valid. Check it with your admin.");
    if (invite.usedAt) throw conflict('That invite code has already been used. Ask your admin for a new one.');
    if (invite.expiresAt < new Date()) throw badRequest('That invite code has expired. Ask your admin for a new one.');
    if (invite.email && invite.email.toLowerCase() !== email) throw badRequest(`That invite is for ${invite.email}.`);
    if (await prisma.user.findUnique({ where: { email } })) throw conflict('An account with that email already exists. Use Login instead.');

    const passwordHash = await bcrypt.hash(body.password, 11);
    const user = await prisma.$transaction(async (tx) => {
      const claimed = await tx.invite.updateMany({ where: { id: invite.id, usedAt: null }, data: { usedAt: new Date() } });
      if (claimed.count !== 1) throw conflict('That invite code has already been used. Ask your admin for a new one.');
      const u = await tx.user.create({ data: { email, name: body.name, passwordHash, role: invite.role } });
      await tx.invite.update({ where: { id: invite.id }, data: { usedById: u.id } });
      return u;
    });
    await recordEvent({ actorId: user.id, verb: 'join', entityType: 'user', entityId: user.id, summary: `${user.name} joined as ${user.role.toLowerCase()} with an invite`, link: '/settings/users' });
    return { token: app.jwt.sign({ sub: user.id }, { expiresIn: '12h' }), user: publicUser(user) };
  });

  app.post('/auth/login', async (req) => {
    const body = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
    if (!user || !user.active || !(await bcrypt.compare(body.password, user.passwordHash))) {
      throw new HttpError(401, 'Incorrect email or password');
    }
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return { token: app.jwt.sign({ sub: user.id }, { expiresIn: '12h' }), user: publicUser(user) };
  });

  app.post('/auth/refresh', { preHandler: authenticate }, async (req) => ({
    token: app.jwt.sign({ sub: req.user.id }, { expiresIn: '12h' }),
  }));

  app.get('/me', { preHandler: authenticate }, async (req) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user.id } });
    return publicUser(user);
  });

  app.patch('/me/preferences', { preHandler: authenticate }, async (req) => {
    const { slackUserId, ...prefs } = notificationPrefsSchema.extend({ slackUserId: z.string().trim().nullable().optional() }).parse(req.body);
    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: { notificationPrefs: prefs, slackUserId: slackUserId === undefined ? undefined : slackUserId || null },
    });
    return publicUser(user);
  });
}
