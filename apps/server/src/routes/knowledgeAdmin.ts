import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma, type Prisma } from '@mh/db';
import { SENSITIVITIES } from '@mh/shared';
import {
  PackValidationError,
  config,
  connectorById,
  decrypt,
  encrypt,
  enqueue,
  exportKnowledgePack,
  extractText,
  getDefaultOrgId,
  importKnowledgePack,
  listConnectorMeta,
  newStorageKey,
  recordEvent,
  selectPlaybook,
  storage,
  syncProducts,
  unzipToDirectory,
  zipDirectory,
} from '@mh/core';
import { authenticate, badRequest, requireRole } from '../http';

const sensitivity = z.enum(SENSITIVITIES);

/** Manager tools for playbooks, claims, documents, connectors and the knowledge pack. */
export async function knowledgeAdminRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/knowledge/playbooks', async () => {
    const organizationId = await getDefaultOrgId();
    return prisma.promptTemplate.findMany({ where: { organizationId }, orderBy: [{ platform: 'asc' }, { name: 'asc' }] });
  });

  app.get<{ Querystring: { platform?: string; contentType?: string; pillar?: string } }>('/knowledge/playbooks/match', async (req) => {
    const playbook = await selectPlaybook(await getDefaultOrgId(), req.query.platform || null, req.query.contentType || null, req.query.pillar || null);
    return { playbook };
  });

  app.put<{ Params: { id: string } }>('/knowledge/playbooks/:id', { preHandler: requireRole('MANAGER') }, async (req) => {
    const body = z.object({
      name: z.string().min(1).optional(),
      body: z.string().min(1).optional(),
      platform: z.string().nullable().optional(),
      contentType: z.string().nullable().optional(),
      pillar: z.string().nullable().optional(),
      hashtagMin: z.number().int().nullable().optional(),
      hashtagMax: z.number().int().nullable().optional(),
      maxChars: z.number().int().nullable().optional(),
      active: z.boolean().optional(),
    }).parse(req.body);
    const row = await prisma.promptTemplate.update({ where: { id: req.params.id }, data: { ...body, version: { increment: 1 } } });
    await recordEvent({ actorId: req.user.id, verb: 'update', entityType: 'playbook', entityId: row.id, summary: `Playbook "${row.name}" updated by ${req.user.name}`, link: '/knowledge/playbooks' });
    return row;
  });

  app.get('/knowledge/claims', async () => {
    const organizationId = await getDefaultOrgId();
    return prisma.claim.findMany({ where: { organizationId }, orderBy: { updatedAt: 'desc' } });
  });

  app.post('/knowledge/claims', { preHandler: requireRole('MANAGER') }, async (req) => {
    const body = z.object({
      text: z.string().min(1),
      sourceUrl: z.string().default(''),
      asOf: z.string().nullable().optional(),
      expiresAt: z.string().nullable().optional(),
      productIds: z.array(z.string()).default([]),
      sensitivity: sensitivity.default('PUBLIC'),
    }).parse(req.body);
    const organizationId = await getDefaultOrgId();
    const row = await prisma.claim.create({
      data: {
        organizationId,
        text: body.text,
        sourceUrl: body.sourceUrl,
        asOf: body.asOf ? new Date(body.asOf) : null,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
        productIds: body.productIds,
        sensitivity: body.sensitivity,
        origin: 'manual',
      },
    });
    await enqueue('embed-knowledge', { orgId: organizationId, sourceType: 'CLAIM', sourceId: row.id }).catch(() => undefined);
    await recordEvent({ actorId: req.user.id, verb: 'create', entityType: 'claim', entityId: row.id, summary: `Claim added by ${req.user.name}`, link: '/knowledge/claims' });
    return row;
  });

  app.patch<{ Params: { id: string } }>('/knowledge/claims/:id', { preHandler: requireRole('MANAGER') }, async (req) => {
    const body = z.object({ status: z.enum(['APPROVED', 'RETIRED']).optional(), text: z.string().min(1).optional(), expiresAt: z.string().nullable().optional() }).parse(req.body);
    const row = await prisma.claim.update({
      where: { id: req.params.id },
      data: { status: body.status, text: body.text, expiresAt: body.expiresAt === undefined ? undefined : body.expiresAt ? new Date(body.expiresAt) : null },
    });
    await enqueue('embed-knowledge', { orgId: row.organizationId, sourceType: 'CLAIM', sourceId: row.id }).catch(() => undefined);
    await recordEvent({ actorId: req.user.id, verb: 'update', entityType: 'claim', entityId: row.id, summary: `Claim ${row.status === 'RETIRED' ? 'retired' : 'updated'} by ${req.user.name}`, link: '/knowledge/claims' });
    return row;
  });

  app.get('/knowledge/confidential', async () => {
    const organizationId = await getDefaultOrgId();
    return prisma.confidentialTerm.findMany({ where: { organizationId }, orderBy: { term: 'asc' } });
  });

  app.post('/knowledge/confidential', { preHandler: requireRole('MANAGER') }, async (req) => {
    const body = z.object({ term: z.string().min(1), aliases: z.array(z.string()).default([]), note: z.string().default('') }).parse(req.body);
    const row = await prisma.confidentialTerm.create({ data: { organizationId: await getDefaultOrgId(), term: body.term, aliases: body.aliases, note: body.note, origin: 'manual' } });
    await recordEvent({ actorId: req.user.id, verb: 'create', entityType: 'confidential', entityId: row.id, summary: `Confidential term added by ${req.user.name}`, link: '/knowledge/confidential' });
    return row;
  });

  app.patch<{ Params: { id: string } }>('/knowledge/confidential/:id', { preHandler: requireRole('MANAGER') }, async (req) => {
    const body = z.object({ term: z.string().min(1).optional(), aliases: z.array(z.string()).optional(), note: z.string().optional() }).parse(req.body);
    return prisma.confidentialTerm.update({ where: { id: req.params.id }, data: body });
  });

  app.delete<{ Params: { id: string } }>('/knowledge/confidential/:id', { preHandler: requireRole('MANAGER') }, async (req) => {
    const row = await prisma.confidentialTerm.delete({ where: { id: req.params.id } });
    await recordEvent({ actorId: req.user.id, verb: 'delete', entityType: 'confidential', entityId: row.id, summary: `Confidential term removed by ${req.user.name}`, link: '/knowledge/confidential' });
    return { ok: true };
  });

  app.get('/knowledge/documents', async () => {
    const organizationId = await getDefaultOrgId();
    return prisma.source.findMany({
      where: { organizationId, kind: 'DOCUMENT' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, title: true, sensitivity: true, origin: true, status: true, createdAt: true, contentHash: true },
    });
  });

  app.post<{ Querystring: { sensitivity?: string } }>('/knowledge/documents', { preHandler: requireRole('MANAGER') }, async (req) => {
    const file = await req.file();
    if (!file) throw badRequest('No file uploaded');
    const level = sensitivity.parse(req.query.sensitivity ?? 'PUBLIC');
    const bytes = await file.toBuffer();
    const text = await extractText(bytes, file.filename).catch((err: Error) => {
      throw badRequest(err.message);
    });
    const organizationId = await getDefaultOrgId();
    const ext = file.filename.split('.').pop() ?? 'bin';
    const storageKey = newStorageKey(`orgs/${organizationId}/documents`, ext);
    await storage.put(storageKey, bytes, file.mimetype || 'application/octet-stream');
    const row = await prisma.source.create({
      data: {
        organizationId,
        kind: 'DOCUMENT',
        title: file.filename,
        content: text,
        status: 'OK',
        sensitivity: level,
        origin: 'upload',
        url: `storage:${storageKey}`,
      },
    });
    await enqueue('embed-knowledge', { orgId: organizationId, sourceType: 'SOURCE', sourceId: row.id }).catch(() => undefined);
    await recordEvent({ actorId: req.user.id, verb: 'upload', entityType: 'document', entityId: row.id, summary: `Document "${file.filename}" added by ${req.user.name}`, link: '/knowledge/documents' });
    return row;
  });

  app.patch<{ Params: { id: string } }>('/knowledge/documents/:id', { preHandler: requireRole('MANAGER') }, async (req) => {
    const body = z.object({ sensitivity: sensitivity }).parse(req.body);
    const row = await prisma.source.update({ where: { id: req.params.id }, data: { sensitivity: body.sensitivity } });
    await enqueue('embed-knowledge', { orgId: row.organizationId, sourceType: 'SOURCE', sourceId: row.id }).catch(() => undefined);
    return row;
  });

  app.delete<{ Params: { id: string } }>('/knowledge/documents/:id', { preHandler: requireRole('MANAGER') }, async (req) => {
    const row = await prisma.source.delete({ where: { id: req.params.id } });
    await prisma.knowledgeChunk.deleteMany({ where: { sourceId: row.id } });
    await recordEvent({ actorId: req.user.id, verb: 'delete', entityType: 'document', entityId: row.id, summary: `Document "${row.title}" removed by ${req.user.name}`, link: '/knowledge/documents' });
    return { ok: true };
  });

  app.get('/knowledge/integrations', async () => {
    const organizationId = await getDefaultOrgId();
    const saved = await prisma.integrationSetting.findMany({ where: { organizationId } });
    return listConnectorMeta().map((connector) => {
      const row = saved.find((item) => item.connectorId === connector.id);
      const raw = row ? (JSON.parse(decrypt(row.configEncrypted)) as Record<string, unknown>) : {};
      const configView: Record<string, unknown> = { ...raw };
      for (const field of connector.secretFields) configView[field] = raw[field] ? 'set' : 'not set';
      return {
        id: connector.id,
        displayName: connector.displayName,
        enabled: row?.enabled ?? false,
        secretFields: connector.secretFields,
        config: configView,
        envFallback: connector.id === 'shopify' && !row && Boolean(config.SHOPIFY_STORE_DOMAIN && config.SHOPIFY_ADMIN_TOKEN),
      };
    });
  });

  app.put<{ Params: { connectorId: string } }>('/knowledge/integrations/:connectorId', { preHandler: requireRole('MANAGER') }, async (req) => {
    const connector = connectorById(req.params.connectorId);
    if (!connector) throw badRequest('Unknown connector');
    const body = z.object({ enabled: z.boolean(), config: z.record(z.string(), z.unknown()).default({}) }).parse(req.body);
    const organizationId = await getDefaultOrgId();
    const existing = await prisma.integrationSetting.findUnique({ where: { organizationId_connectorId: { organizationId, connectorId: connector.id } } });
    const previous = existing ? (JSON.parse(decrypt(existing.configEncrypted)) as Record<string, unknown>) : {};
    const next = { ...body.config };
    for (const field of connector.secretFields) {
      const incoming = next[field];
      if (incoming === undefined || incoming === '' || incoming === 'set' || incoming === 'not set') next[field] = previous[field] ?? '';
    }
    const parsed = connector.configSchema.safeParse(next);
    if (!parsed.success && body.enabled) throw badRequest(parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '));
    const stored = parsed.success ? parsed.data : next;
    const row = await prisma.integrationSetting.upsert({
      where: { organizationId_connectorId: { organizationId, connectorId: connector.id } },
      update: { enabled: body.enabled, configEncrypted: encrypt(JSON.stringify(stored)) },
      create: { organizationId, connectorId: connector.id, enabled: body.enabled, configEncrypted: encrypt(JSON.stringify(stored)) },
    });
    await recordEvent({ actorId: req.user.id, verb: 'update', entityType: 'integration', entityId: row.id, summary: `${connector.displayName} ${body.enabled ? 'enabled' : 'updated'} by ${req.user.name}`, link: '/knowledge/integrations' });
    return { ok: true };
  });

  app.post('/knowledge/products/sync', { preHandler: requireRole('MANAGER') }, async (req) => {
    const organizationId = await getDefaultOrgId();
    const report = await syncProducts(organizationId);
    await recordEvent({ actorId: req.user.id, verb: 'sync', entityType: 'product', entityId: organizationId, summary: `Product sync started by ${req.user.name}`, link: '/knowledge/products' });
    return report;
  });

  app.post<{ Querystring: { format?: string } }>('/knowledge/products/import', { preHandler: requireRole('MANAGER') }, async (req) => {
    const file = await req.file();
    if (!file) throw badRequest('No file uploaded');
    const format = req.query.format === 'json' || file.filename.endsWith('.json') ? 'json' : 'csv';
    const text = (await file.toBuffer()).toString('utf8');
    return syncProducts(await getDefaultOrgId(), { connectorId: 'csv', inlineText: text, format });
  });

  app.post<{ Querystring: { dryRun?: string } }>('/knowledge/pack/import', { preHandler: requireRole('MANAGER') }, async (req) => {
    const file = await req.file();
    if (!file) throw badRequest('Upload a knowledge pack zip');
    const dryRun = req.query.dryRun === '1' || req.query.dryRun === 'true';
    const dir = await mkdtemp(path.join(tmpdir(), 'mantis-pack-'));
    try {
      await unzipToDirectory(await file.toBuffer(), dir);
      const report = await importKnowledgePack(await getDefaultOrgId(), dir, { dryRun, prune: !dryRun });
      if (!dryRun) {
        await recordEvent({
          actorId: req.user.id,
          verb: 'import',
          entityType: 'knowledge-pack',
          entityId: await getDefaultOrgId(),
          summary: `Knowledge pack imported by ${req.user.name}`,
          link: '/knowledge/pack',
          meta: report as unknown as Prisma.InputJsonValue,
        });
      }
      return report;
    } catch (err) {
      if (err instanceof PackValidationError) throw badRequest(err.message);
      throw err;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  app.get('/knowledge/pack/export', { preHandler: requireRole('MANAGER') }, async (req, reply) => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mantis-pack-'));
    try {
      await exportKnowledgePack(await getDefaultOrgId(), dir);
      const zip = await zipDirectory(dir);
      reply.header('Content-Type', 'application/zip');
      reply.header('Content-Disposition', 'attachment; filename="knowledge-pack.zip"');
      return reply.send(zip);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}
