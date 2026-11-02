import { describe, expect, it } from 'vitest';
import { availableActions, transitionPost } from './postWorkflow';
import { planCampaignSlots } from './campaign';
import { assetHiddenFromAi, collapseLibraryImports, resolveLibraryPath, toRelPath, toUncPath } from './library';
import { brandColorsSchema, paletteInOrder, toHex } from './colors';
import { marketLinkSchema, productSchema, taskSchema, taskUpdateSchema } from './api';
import { isProductDocumentationLink, marketChannel, marketKnowledgeText, productKnowledgeText } from './productKnowledge';
import { placeBrandPiece, type DesignDoc } from './design';

describe('brand colors', () => {
  it('converts hex, RGB and CMYK to screen hex', () => {
    expect(toHex('HEX', '#1A2B3C')).toBe('#1a2b3c');
    expect(toHex('HEX', 'abc')).toBe('#aabbcc');
    expect(toHex('RGB', 'rgb(26, 43, 60)')).toBe('#1a2b3c');
    expect(toHex('RGB', '0 128 255')).toBe('#0080ff');
    expect(toHex('CMYK', '0, 0, 0, 0')).toBe('#ffffff');
    expect(toHex('CMYK', '100 0 100 0')).toBe('#00ff00');
    expect(toHex('CMYK', '0%, 0%, 0%, 100%')).toBe('#000000');
  });

  it('rejects unreadable values and never guesses Pantone', () => {
    expect(toHex('HEX', '#12345')).toBeNull();
    expect(toHex('RGB', '300, 0, 0')).toBeNull();
    expect(toHex('CMYK', '10, 20, 30')).toBeNull();
    expect(toHex('PANTONE', '186 C')).toBeNull();
  });

  it('upgrades old {name, hex} colors, caps each tier at 20 and orders the palette', () => {
    const old = brandColorsSchema.parse([{ name: 'Navy', hex: '#000080' }]);
    expect(old[0]).toMatchObject({ tier: 'PRIMARY', format: 'HEX' });
    const many = Array.from({ length: 21 }, () => ({ hex: '#ffffff', tier: 'SECONDARY' }));
    expect(brandColorsSchema.safeParse(many).success).toBe(false);
    expect(brandColorsSchema.safeParse(many.slice(1)).success).toBe(true);
    expect(paletteInOrder(brandColorsSchema.parse([{ hex: '#333333', tier: 'TERTIARY' }, { hex: '#111111', tier: 'PRIMARY' }]))).toEqual(['#111111', '#333333']);
  });
});

describe('product knowledge', () => {
  it('keeps usage and part numbers optional so older product saves still parse', () => {
    expect(productSchema.parse({ name: 'Ranger' }).usage).toBeUndefined();
    expect(productSchema.parse({ name: 'Ranger', usage: 'Walks crop rows', partNumbers: ['PN-10'], pricing: '$1200' })).toMatchObject({
      usage: 'Walks crop rows',
      partNumbers: ['PN-10'],
      pricing: '$1200',
    });
  });

  it('writes what it does, how it is used, and labels outside companies', () => {
    const text = productKnowledgeText({
      name: 'Ranger',
      sku: 'PN-10',
      partNumbers: ['PN-10', 'PN-11'],
      description: 'Carries sensors down a row.',
      usage: 'An operator drives it from the field laptop.',
      pricing: '$1200',
      competitors: [{ name: 'Acme', url: 'https://acme.example' }],
    });
    expect(text).toContain('What it does: Carries sensors down a row.');
    expect(text).toContain('How it is used: An operator drives it from the field laptop.');
    expect(text).toContain('part numbers PN-10, PN-11');
    expect(text).toContain('Price: $1200');
    expect(text).toContain('Competitors, not our company: Acme (https://acme.example)');
    expect(marketKnowledgeText([{ role: 'PARTNER', name: 'Beta', url: 'https://beta.example' }])).toContain('Partners, not our company');
  });

  it('tells a website from a social page, and does not treat uploads or market pages as documentation links', () => {
    expect(marketChannel('https://www.linkedin.com/company/acme')).toBe('linkedin');
    expect(marketChannel('https://docs.example.com/ranger')).toBe('website');
    expect(marketLinkSchema.parse({ name: 'Acme', role: 'COMPETITOR', url: 'https://acme.example' }).role).toBe('COMPETITOR');
    expect(isProductDocumentationLink({ origin: 'product-link', kind: 'WEBSITE' })).toBe(true);
    expect(isProductDocumentationLink({ origin: 'manual', kind: 'WEBSITE' })).toBe(true);
    expect(isProductDocumentationLink({ origin: 'upload', kind: 'DOCUMENT' })).toBe(false);
    expect(isProductDocumentationLink({ origin: 'market', kind: 'WEBSITE' })).toBe(false);
    expect(isProductDocumentationLink({ origin: 'market', kind: 'MANUAL' })).toBe(false);
  });
});

describe('tasks', () => {
  it('archives through an update and does not require that flag on a new task', () => {
    expect(taskSchema.parse({ title: 'Write the booth post', stageId: 'stage' })).not.toHaveProperty('active');
    expect(taskUpdateSchema.parse({ active: false }).active).toBe(false);
  });
});

describe('post workflow', () => {
  it('follows creator -> manager -> scheduled -> posted', () => {
    const creator = { role: 'CREATOR' as const, isCreator: true };
    const manager = { role: 'MANAGER' as const, isCreator: false };
    expect(transitionPost('DRAFT', 'creatorApprove', creator)).toEqual({ ok: true, to: 'CREATOR_APPROVED' });
    expect(transitionPost('CREATOR_APPROVED', 'startReview', creator).ok).toBe(false);
    expect(transitionPost('CREATOR_APPROVED', 'startReview', manager)).toEqual({ ok: true, to: 'IN_REVIEW' });
    expect(transitionPost('IN_REVIEW', 'returnToCreator', manager)).toEqual({ ok: true, to: 'DRAFT' });
    expect(transitionPost('IN_REVIEW', 'approve', manager)).toEqual({ ok: true, to: 'SCHEDULED' });
    expect(transitionPost('SCHEDULED', 'publishSucceeded', manager).ok).toBe(false);
    expect(transitionPost('SCHEDULED', 'publishSucceeded', { role: 'SYSTEM', isCreator: false }).ok).toBe(true);
  });

  it('does not let another creator approve someone else draft', () => {
    expect(transitionPost('DRAFT', 'creatorApprove', { role: 'CREATOR', isCreator: false }).ok).toBe(false);
    expect(availableActions('DRAFT', { role: 'CREATOR', isCreator: true })).toEqual(['creatorApprove']);
  });
});

describe('campaign slots', () => {
  it('schedules posts on selected weekdays at local times', () => {
    // 2026-10-05 is a Monday. Mon + Wed, 10:00 local, UTC-4.
    const slots = planCampaignSlots({
      startDate: '2026-10-05',
      endDate: '2026-10-11',
      postDays: [1, 3],
      postTimes: ['10:00'],
      utcOffsetMinutes: -240,
    });
    expect(slots.map((d) => d.toISOString())).toEqual(['2026-10-05T14:00:00.000Z', '2026-10-07T14:00:00.000Z']);
  });
});

describe('toRelPath', () => {
  it('produces the same relative path for mapped drives and UNC paths', () => {
    expect(toRelPath('M:\\Media', 'M:\\Media\\Products\\hero.jpg')).toBe('Products/hero.jpg');
    expect(toRelPath('\\\\srv\\share\\Media\\', '\\\\srv\\share\\Media\\Products\\hero.jpg')).toBe('Products/hero.jpg');
    expect(() => toRelPath('M:\\Media', 'M:\\Other\\x.jpg')).toThrow();
  });
});

describe('library import collapsing', () => {
  const folder = (relPath: string) => ({ relPath, kind: 'FOLDER' as const });
  const file = (relPath: string) => ({ relPath, kind: 'FILE' as const });

  it('drops files and folders that sit inside an imported folder', () => {
    const kept = collapseLibraryImports([
      folder('Products'),
      file('Products/Aurora Lamp/hero.jpg'),
      folder('Products/Aurora Lamp'),
      file('Video/launch.mp4'),
    ]);
    expect(kept.map((i) => i.relPath).sort()).toEqual(['Products', 'Video/launch.mp4']);
  });

  it('replaces narrower imports when a parent folder is added', () => {
    const kept = collapseLibraryImports([
      file('Campaigns/Spring/a.jpg'),
      folder('Campaigns/Spring/Photos'),
      folder('Campaigns'),
    ]);
    expect(kept).toEqual([folder('Campaigns')]);
  });

  it('treats the drive root as covering everything, and prefers a folder over a file at the same path', () => {
    expect(collapseLibraryImports([file('Brand'), folder(''), file('Brand/logo.png')])).toEqual([folder('')]);
    expect(collapseLibraryImports([file('Brand/logo.png'), folder('Brand/logo.png')])).toEqual([folder('Brand/logo.png')]);
  });
});

describe('files kept out of AI', () => {
  const folder = (relPath: string) => ({ relPath, kind: 'FOLDER' as const });
  const file = (relPath: string) => ({ relPath, kind: 'FILE' as const });

  it('hides a flagged file, a flagged folder, and everything inside that folder', () => {
    const holds = [file('Brand/logo.png'), folder('Internal')];
    expect(assetHiddenFromAi('Brand/logo.png', holds)).toBe(true);
    expect(assetHiddenFromAi('brand/LOGO.PNG', holds)).toBe(true);
    expect(assetHiddenFromAi('Internal/shot.jpg', holds)).toBe(true);
    expect(assetHiddenFromAi('Internal/nested/shot.jpg', holds)).toBe(true);
    expect(assetHiddenFromAi('Internal', holds)).toBe(true);
    expect(assetHiddenFromAi('InternalOther/shot.jpg', holds)).toBe(false);
    expect(assetHiddenFromAi('Brand/other.png', holds)).toBe(false);
  });

  it('treats a hold on the drive root as covering every file', () => {
    expect(assetHiddenFromAi('Anything/a.jpg', [folder('')])).toBe(true);
  });
});

describe('library drive resolution', () => {
  const share = '\\\\CRL-PGH-LOGAWS-3.crl.local\\marketing-and-media';
  const adminPc = [{ letter: 'V', remote: share }, { letter: 'X', remote: '\\\\crl-pgh-data-1\\Z' }];

  it('records the network path of the folder the admin picked', () => {
    expect(toUncPath('V:\\', adminPc)).toBe(share);
    expect(toUncPath('V:\\Brand Assets', adminPc)).toBe(`${share}\\Brand Assets`);
    expect(toUncPath('C:\\Temp', adminPc)).toBeNull();
  });

  it('finds the drive on another PC even under a different letter', () => {
    const loc = { rootPath: 'V:\\Brand Assets', uncPath: `${share}\\Brand Assets` };
    expect(resolveLibraryPath(loc, adminPc)).toBe('V:\\Brand Assets');
    expect(resolveLibraryPath(loc, [{ letter: 'm', remote: share.toLowerCase() + '\\' }])).toBe('M:\\Brand Assets');
    expect(resolveLibraryPath({ rootPath: 'V:\\', uncPath: share }, [{ letter: 'M', remote: share }])).toBe('M:\\');
  });

  it('returns null when the share is not mapped on this PC', () => {
    const loc = { rootPath: 'V:\\', uncPath: share };
    expect(resolveLibraryPath(loc, [])).toBeNull();
    expect(resolveLibraryPath(loc, [{ letter: 'V', remote: '\\\\other\\share' }])).toBeNull();
    expect(resolveLibraryPath({ rootPath: 'V:\\', uncPath: share }, [{ letter: 'V', remote: `${share}-archive` }])).toBeNull();
  });

  it('uses a network path directly when the admin picked one without a drive letter', () => {
    const unc = `${share}\\Photos`;
    expect(resolveLibraryPath({ rootPath: unc, uncPath: unc }, [])).toBe(unc);
  });
});

describe('placing a brand piece on a graphic', () => {
  const canvas = (): DesignDoc => ({
    version: 1,
    width: 100,
    height: 80,
    background: '#111111',
    layers: [{ id: 'text', name: 'Headline', type: 'text', text: 'Hi', x: 0, y: 0, width: 40, height: 20, rotation: 0, opacity: 1, visible: true, locked: false, fontFamily: 'Arial', fontSize: 12, fontWeight: 'bold', italic: false, color: '#ffffff', align: 'left', lineHeight: 1 }],
  });

  it('puts a background behind everything and replaces the previous background', () => {
    const first = placeBrandPiece(canvas(), { src: 'bg-a', name: 'Night', slot: 'background' });
    const second = placeBrandPiece(first.doc, { src: 'bg-b', name: 'Day', slot: 'background' });
    expect(second.doc.layers[0]).toMatchObject({ src: 'bg-b', role: 'background', width: 100, height: 80 });
    expect(second.doc.layers.filter((layer) => layer.type === 'image' && layer.role === 'background')).toHaveLength(1);
    expect(second.doc.layers.at(-1)?.type).toBe('text');
  });

  it('covers the canvas with an overlay and leaves it in front', () => {
    const placed = placeBrandPiece(canvas(), { src: 'pattern', name: 'Cubes', slot: 'overlay' });
    expect(placed.doc.layers.at(-1)).toMatchObject({ src: 'pattern', role: 'other', x: 0, y: 0, width: 100, height: 80 });
    expect(placed.layerId).toBe(placed.doc.layers.at(-1)?.id);
  });
});
