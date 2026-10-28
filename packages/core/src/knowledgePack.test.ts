import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { config } from './config';
import { prisma } from '@mh/db';
import { chunksAllowedForProvider } from './generation';
import { embedKnowledge, retrieve } from './knowledge';
import { importKnowledgePack, loadKnowledgePack, PackValidationError } from './knowledgePack';
import { selectPlaybook } from './playbooks';

const example = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../knowledge-pack.example');
const orgs: string[] = [];

async function tempOrg(name: string) {
  const org = await prisma.organization.create({ data: { name, slug: `${name}-${Date.now()}-${Math.random().toString(16).slice(2)}` } });
  orgs.push(org.id);
  return org;
}

afterAll(async () => {
  for (const id of orgs) await prisma.organization.delete({ where: { id } }).catch(() => undefined);
});

describe('knowledge pack', () => {
  it('accepts the example pack and names the file when a field is wrong', async () => {
    const pack = await loadKnowledgePack(example);
    expect(pack.brand.companyName).toBe('Acme Field Robotics');
    expect(pack.playbooks).toHaveLength(1);
    expect(pack.examples[0]?.platform).toBe('linkedin');
    const dir = await mkdtemp(path.join(tmpdir(), 'bad-pack-'));
    await writeFile(path.join(dir, 'manifest.json'), JSON.stringify({ schemaVersion: 2, name: 'Nope', updatedAt: 'today' }));
    await writeFile(path.join(dir, 'brand.json'), '{}');
    await expect(loadKnowledgePack(dir)).rejects.toThrow(/manifest\.json/);
    await expect(loadKnowledgePack(dir)).rejects.toBeInstanceOf(PackValidationError);
    await rm(dir, { recursive: true, force: true });
  });

  it('imports once, skips the second time, and prunes only pack rows', async () => {
    const org = await tempOrg('pack');
    const first = await importKnowledgePack(org.id, example, { prune: true });
    expect(first.products.created).toBe(1);
    expect(first.playbooks.created).toBe(1);
    expect(first.claims.created).toBe(1);
    const second = await importKnowledgePack(org.id, example, { prune: true });
    expect(second.products.created + second.products.updated).toBe(0);
    expect(second.playbooks.created + second.playbooks.updated).toBe(0);
    expect(second.claims.created + second.claims.updated).toBe(0);
    expect(second.brand.created + second.brand.updated).toBe(0);
    await prisma.product.create({ data: { organizationId: org.id, name: 'Hand entered', features: [], links: [], origin: 'manual' } });
    const thin = await mkdtemp(path.join(tmpdir(), 'thin-pack-'));
    await writeFile(path.join(thin, 'manifest.json'), await readFile(path.join(example, 'manifest.json')));
    await writeFile(path.join(thin, 'brand.json'), await readFile(path.join(example, 'brand.json')));
    await mkdir(path.join(thin, 'playbooks'), { recursive: true });
    const pruned = await importKnowledgePack(org.id, thin, { prune: true });
    expect(pruned.products.removed).toBe(1);
    expect(await prisma.product.findFirst({ where: { organizationId: org.id, name: 'Hand entered' } })).toBeTruthy();
    expect(await prisma.product.findFirst({ where: { organizationId: org.id, origin: 'pack' } })).toBeNull();
    await rm(thin, { recursive: true, force: true });
  });

  it('keeps a second org out of the default company playbooks and claims', async () => {
    const org = await tempOrg('other');
    await importKnowledgePack(org.id, example);
    const { getDefaultOrgId } = await import('./org');
    const home = await getDefaultOrgId();
    const leaked = await prisma.claim.findFirst({ where: { organizationId: home, text: { contains: 'Row Scout covered 40 rows' } } });
    expect(leaked).toBeNull();
    const theirs = await selectPlaybook(org.id, 'linkedin', 'SOCIAL_POST', 'field-notes');
    const ours = await selectPlaybook(home, 'linkedin', 'SOCIAL_POST', 'field-notes');
    expect(theirs?.name).toBe('Field notes');
    expect(ours?.name).not.toBe('Field notes');
  });
});

describe('playbooks', () => {
  it('prefers the most specific template and falls back to the seed', async () => {
    const org = await tempOrg('playbook');
    const seeded = await selectPlaybook(org.id, 'linkedin', 'SOCIAL_POST', 'field-notes');
    expect(seeded?.origin).toBe('seed');
    expect(seeded?.platform).toBe('linkedin');
    await prisma.promptTemplate.create({
      data: {
        organizationId: org.id,
        externalKey: 'test:specific',
        name: 'Specific field note',
        body: 'Write about one row only.',
        platform: 'linkedin',
        contentType: 'SOCIAL_POST',
        pillar: 'field-notes',
        origin: 'manual',
      },
    });
    const specific = await selectPlaybook(org.id, 'linkedin', 'SOCIAL_POST', 'field-notes');
    expect(specific?.name).toBe('Specific field note');
    const broader = await selectPlaybook(org.id, 'x', 'EMAIL');
    expect(broader?.contentType).toBe('EMAIL');
  });
});

describe('sensitivity', () => {
  it('drops internal chunks for cloud models and keeps them for local', () => {
    const chunks = [
      { id: '1', sourceType: 'SOURCE', sourceId: 'a', text: 'public', sensitivity: 'PUBLIC' as const, score: 1 },
      { id: '2', sourceType: 'SOURCE', sourceId: 'b', text: 'internal', sensitivity: 'INTERNAL' as const, score: 1 },
    ];
    expect(chunksAllowedForProvider(chunks, 'openai').kept.map((c) => c.id)).toEqual(['1']);
    expect(chunksAllowedForProvider(chunks, 'anthropic').droppedInternal).toBe(true);
    expect(chunksAllowedForProvider(chunks, 'local').kept).toHaveLength(2);
    expect(chunksAllowedForProvider(chunks, 'mock').kept).toHaveLength(2);
  });

  it.skipIf(config.AI_EMBED_PROVIDER !== 'mock')('does not embed restricted text and retrieve stays in one org', async () => {
    const org = await tempOrg('embed');
    const hidden = await prisma.product.create({
      data: { organizationId: org.id, name: 'Secret rig', description: 'Do not index this', features: [], links: [], sensitivity: 'RESTRICTED' },
    });
    expect(await embedKnowledge('PRODUCT', hidden.id)).toBe(0);
    const shown = await prisma.product.create({
      data: { organizationId: org.id, name: 'Row Scout demo unit', description: 'Photographs crop rows for the demo', features: [], links: [], sensitivity: 'PUBLIC' },
    });
    expect(await embedKnowledge('PRODUCT', shown.id)).toBeGreaterThan(0);
    const { getDefaultOrgId } = await import('./org');
    const hits = await retrieve(await getDefaultOrgId(), 'Row Scout demo unit photographs');
    expect(hits.some((hit) => hit.text.includes('Secret rig') || hit.sourceId === shown.id)).toBe(false);
    const own = await retrieve(org.id, 'Row Scout demo unit photographs');
    expect(own.some((hit) => hit.sourceId === shown.id)).toBe(true);
  });
});

describe('migration', () => {
  it('keeps the original brand row on the default organization', async () => {
    const org = await prisma.organization.findUnique({ where: { slug: 'default' } });
    expect(org?.id).toBe('org_default');
    const brand = await prisma.brandProfile.findUnique({ where: { id: 'brand' } });
    expect(brand?.organizationId).toBe('org_default');
    const foreign = await prisma.knowledgeChunk.count({ where: { organizationId: { not: 'org_default' }, NOT: { organizationId: { in: orgs } } } });
    expect(foreign).toBe(0);
  });
});
