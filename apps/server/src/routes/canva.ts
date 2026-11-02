import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { z } from 'zod';
import { prisma } from '@mh/db';
import { newLayerId, type DesignDoc } from '@mh/shared';
import {
  CanvaError, canvaEditLink, canvaEditUrl, canvaStatus, createCanvaGraphic, disconnectCanva, finishCanvaConnect,
  importCanvaReturn, listCanvaTemplates, newStorageKey, recordEvent, saveDesign, startCanvaConnect, storage,
} from '@mh/core';
import { authenticate, badRequest, requireRole } from '../http';

const page = (title: string, message: string) => {
  const text = (value: string) => value.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch] ?? ch);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${text(title)}</title><style>body{font-family:Segoe UI,Arial,sans-serif;background:#0f172a;color:#e2e8f0;display:grid;place-items:center;height:100vh;margin:0}div{max-width:480px;text-align:center}h1{font-size:22px}</style></head><body><div><h1>${text(title)}</h1><p>${text(message)}</p><p>You can close this window and return to Mantis.</p></div></body></html>`;
};

function fail(err: unknown): never {
  if (err instanceof CanvaError) throw badRequest(err.message);
  throw err;
}

/** The graphic keeps the latest Canva export as one full-frame picture. */
async function pictureDoc(png: Buffer, key: string): Promise<DesignDoc> {
  const meta = await sharp(png).metadata();
  const width = meta.width ?? 1080;
  const height = meta.height ?? 1080;
  return {
    version: 1,
    width,
    height,
    background: '#ffffff',
    layers: [{
      id: newLayerId(),
      name: 'Canva',
      type: 'image',
      src: key,
      fit: 'cover',
      role: 'generated',
      x: 0,
      y: 0,
      width,
      height,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
    }],
  };
}

export async function canvaRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { code?: string; state?: string; error?: string; error_description?: string } }>('/canva/callback', async (req, reply) => {
    reply.type('text/html');
    if (req.query.error || !req.query.code || !req.query.state) {
      return page('Connection cancelled', req.query.error_description ?? req.query.error ?? 'No authorization code was returned.');
    }
    try {
      const connected = await finishCanvaConnect(req.query.code, req.query.state);
      const user = await prisma.user.findUnique({ where: { id: connected.userId } });
      await recordEvent({ actorId: connected.userId, verb: 'connect', entityType: 'canva', entityId: connected.userId, summary: `Canva connected by ${user?.name ?? 'a user'}`, link: '/settings/social' });
      return page('Canva connected', `Connected ${connected.displayName}.`);
    } catch (err) {
      req.log.error(err);
      return page('Connection failed', err instanceof Error ? err.message : 'Canva could not be connected.');
    }
  });

  app.get<{ Querystring: { correlation_jwt?: string } }>('/canva/return', async (req, reply) => {
    reply.type('text/html');
    if (!req.query.correlation_jwt) return page('Nothing to save', 'Canva did not send a design back.');
    try {
      const imported = await importCanvaReturn(req.query.correlation_jwt);
      const design = await prisma.design.findUnique({ where: { id: imported.mantisDesignId } });
      if (!design || design.canvaDesignId !== imported.canvaDesignId) return page('Graphic not found', 'That design is not one of the graphics in Mantis.');
      const key = newStorageKey('canva', 'png');
      await storage.put(key, imported.png, 'image/png');
      await saveDesign({ id: design.id, name: design.name, doc: await pictureDoc(imported.png, key), userId: design.createdById });
      return page('Saved', 'The graphic in Mantis now shows this Canva design.');
    } catch (err) {
      req.log.error(err);
      return page('Could not save', err instanceof Error ? err.message : 'The Canva design could not be saved.');
    }
  });

  app.register(async (auth) => {
    auth.addHook('preHandler', authenticate);

    auth.get('/canva/status', async () => canvaStatus());

    auth.post('/canva/connect', { preHandler: requireRole('MANAGER') }, async (req) => {
      try {
        return { url: await startCanvaConnect(req.user.id) };
      } catch (err) {
        fail(err);
      }
    });

    auth.delete<{ Params: { id: string } }>('/canva/accounts/:id', { preHandler: requireRole('MANAGER') }, async (req) => {
      await disconnectCanva(req.params.id);
      await recordEvent({ actorId: req.user.id, verb: 'disconnect', entityType: 'canva', entityId: req.params.id, summary: `Canva disconnected by ${req.user.name}`, link: '/settings/social' });
      return { ok: true };
    });

    auth.get('/canva/templates', async () => {
      try {
        return listCanvaTemplates();
      } catch (err) {
        fail(err);
      }
    });

    auth.post('/canva/graphics', async (req) => {
      const body = z.object({
        title: z.string().trim().min(1).max(120),
        templateId: z.string().optional(),
        headline: z.string().max(500).optional(),
        libraryAssetId: z.string().optional(),
        width: z.number().int().min(40).max(8000).default(1080),
        height: z.number().int().min(40).max(8000).default(1080),
        folderId: z.string().nullable().optional(),
      }).parse(req.body);
      let image: { name: string; bytes: Buffer } | undefined;
      if (body.libraryAssetId) {
        const asset = await prisma.asset.findUnique({ where: { id: body.libraryAssetId } });
        if (!asset) throw badRequest('That library file was not found.');
        if (asset.notForPublicUse) throw badRequest('That library file is not for public use.');
        if (!asset.storedKey) throw badRequest('That file has not been uploaded from the shared drive.');
        image = { name: asset.relPath.split('/').pop() ?? 'image', bytes: await storage.get(asset.storedKey) };
      }
      try {
        const created = await createCanvaGraphic({
          title: body.title,
          templateId: body.templateId,
          headline: body.headline,
          image,
          width: body.width,
          height: body.height,
        });
        const key = newStorageKey('canva', 'png');
        await storage.put(key, created.png, 'image/png');
        const saved = await saveDesign({ name: body.title, doc: await pictureDoc(created.png, key), userId: req.user.id });
        await prisma.design.update({
          where: { id: saved.id },
          data: { canvaDesignId: created.canvaDesignId, ...(body.folderId ? { folderId: body.folderId } : {}) },
        });
        await recordEvent({ actorId: req.user.id, verb: 'create', entityType: 'design', entityId: saved.id, summary: `Canva graphic "${body.title}" created by ${req.user.name}`, link: `/designs/${saved.id}` });
        return { id: saved.id, editUrl: canvaEditLink(created.editUrl, saved.id), filled: created.filled };
      } catch (err) {
        fail(err);
      }
    });

    auth.post<{ Params: { id: string } }>('/canva/graphics/:id/edit', async (req) => {
      const design = await prisma.design.findUnique({ where: { id: req.params.id } });
      if (!design?.canvaDesignId) throw badRequest('This graphic is not a Canva design.');
      try {
        return { url: await canvaEditUrl(design.canvaDesignId, design.id) };
      } catch (err) {
        fail(err);
      }
    });
  });
}
