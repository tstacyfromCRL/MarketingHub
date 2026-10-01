// End-to-end API smoke test against a fresh database.
// Usage: node scripts/smoke-test.mjs [http://localhost:4000]
import assert from 'node:assert/strict';

const API = process.argv[2] ?? 'http://localhost:4000';
let token = '';

async function call(method, path, body, t = token) {
  const res = await fetch(API + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(t ? { Authorization: `Bearer ${t}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const type = res.headers.get('content-type') ?? '';
  const data = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(data)}`);
  return data;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, what, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await sleep(300);
  }
  throw new Error(`Timed out waiting for ${what}`);
}
const step = (s) => console.log(`- ${s}`);

// 1x1 PNG
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const status = await call('GET', '/auth/status');
let admin;
if (status.needsBootstrap) {
  admin = await call('POST', '/auth/bootstrap', { email: 'admin@example.com', name: 'Avery Admin', password: 'password123' });
} else {
  admin = await call('POST', '/auth/login', { email: 'admin@example.com', password: 'password123' });
}
token = admin.token;
step('admin signed in');

const users = await call('GET', '/users');
const ensureUser = async (email, name, role) =>
  users.find((u) => u.email === email) ?? (await call('POST', '/users', { email, name, role, password: 'password123' }));
const manager = await ensureUser('manager@example.com', 'Morgan Manager', 'MANAGER');
const creator = await ensureUser('creator@example.com', 'Casey Creator', 'CREATOR');
const creatorToken = (await call('POST', '/auth/login', { email: creator.email, password: 'password123' })).token;
const managerToken = (await call('POST', '/auth/login', { email: manager.email, password: 'password123' })).token;
step('manager + creator exist');

// ---- Invites ("Create New User") ----
await assert.rejects(call('POST', '/invites', { role: 'CREATOR' }, creatorToken), /403/);
const invite = await call('POST', '/invites', { role: 'MANAGER' });
assert.match(invite.code, /^MH-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
const joinerEmail = `joiner${Date.now()}@example.com`;
await assert.rejects(call('POST', '/auth/join', { code: 'MH-NOPE-NOPE', email: joinerEmail, name: 'Jo', password: 'password123' }, ''), /400/);
const joined = await call('POST', '/auth/join', { code: invite.code.toLowerCase(), email: joinerEmail, name: 'Jo Joiner', password: 'password123' }, '');
assert.equal(joined.user.role, 'MANAGER');
await assert.rejects(call('POST', '/auth/join', { code: invite.code, email: `x${joinerEmail}`, name: 'Again', password: 'password123' }, ''), /409/);
assert.ok(!(await call('GET', '/invites')).some((i) => i.id === invite.id), 'used invite is no longer pending');
step('invites: admin-only, code sets role, single use');

// ---- Kanban ----
const board = await call('GET', '/board');
assert.ok(board.stages.length >= 3);
await assert.rejects(call('POST', '/stages', { name: 'Blocked' }, creatorToken), /403/);
const stage = await call('POST', '/stages', { name: `QA ${Date.now() % 1000}`, color: '#123456' });
const task = await call('POST', '/tasks', { title: 'Shoot product photos', stageId: board.stages[0].id, assigneeId: creator.id, categoryIds: [board.categories[0].id] });
await call('PUT', `/tasks/${task.id}/move`, { stageId: board.stages[1].id, order: 500 }, creatorToken);
await call('DELETE', `/stages/${stage.id}`);
const notes = await call('GET', '/notifications', undefined, creatorToken);
assert.ok(notes.some((n) => n.title.includes('assigned')));
step('kanban: admin-only stages, task assign/move, notification delivered');

// ---- Library ----
const existingLib = await call('GET', '/library');
if (!existingLib.location) {
  const set = await call('PUT', '/library', { name: 'Marketing & Media Drive', rootPath: 'V:\\', uncPath: '\\\\files\\marketing-and-media' });
  assert.equal(set.location.uncPath, '\\\\files\\marketing-and-media');
}
await assert.rejects(call('PUT', '/library', { rootPath: 'C:\\' }, creatorToken), /403/);
const lease = await call('POST', '/library/lease', { machine: 'SMOKE-PC' }, creatorToken);
await assert.rejects(call('POST', '/library/lease', { machine: 'OTHER-PC' }, managerToken), /409/);
await call('POST', '/library/assets/batch', {
  leaseToken: lease.token,
  assets: [
    { relPath: 'Products/Aurora Lamp/hero.jpg', size: 1000, mtime: new Date().toISOString(), kind: 'IMAGE', thumbnail: PNG },
    { relPath: 'Video/launch.mp4', size: 5000, mtime: new Date().toISOString(), kind: 'VIDEO' },
  ],
}, creatorToken);
await call('POST', '/library/scan-complete', { leaseToken: lease.token, seenPaths: ['Products/Aurora Lamp/hero.jpg', 'Video/launch.mp4'] }, creatorToken);
step('library: single scan lease enforced, assets indexed');

// ---- Knowledge base ----
await call('PUT', '/brand', {
  companyName: 'Lumen Co', tagline: 'Light, simplified', voice: 'Warm, confident, plain-spoken', audience: 'Homeowners',
  colors: [{ name: 'Navy', hex: '#1e3a5f' }, { name: 'Amber', hex: '#f5a524' }], fonts: [{ role: 'Heading', family: 'Arial' }], dos: ['Use active voice'], donts: ['Use jargon'],
});
const product = await call('POST', '/products', { name: 'Aurora Lamp', sku: 'AUR-1', description: 'A smart lamp that adapts to daylight.', features: ['Auto dimming', '10-year LED'] });
await call('POST', '/accomplishments', { title: 'Won 2026 Design Award', date: '2026-05-01', description: 'Aurora Lamp won the national design award.' });
await call('POST', '/sources', { kind: 'MANUAL', title: 'Press release', content: 'Lumen Co opened a new factory in Pittsburgh employing 120 people.' });
await assert.rejects(call('POST', '/sources', { kind: 'WEBSITE', url: 'https://www.linkedin.com/company/x' }), /LinkedIn/);
const hits = await waitFor(async () => {
  const r = await call('GET', '/knowledge/search?q=' + encodeURIComponent('Pittsburgh factory'));
  return r.some((x) => x.text.includes('Pittsburgh')) && r;
}, 'knowledge embedding');
const matched = await waitFor(async () => {
  const r = await call('GET', `/library/assets?productId=${product.id}`);
  return r.items.length > 0 && r.items;
}, 'product match');
await call('PUT', `/library/assets/${matched[0].id}/products`, { productId: product.id, confirmed: true });
step(`knowledge: RAG retrieval works (${hits.length} hits), asset auto-matched to product and confirmed`);

// ---- Company setup wizard ----
await assert.rejects(call('PUT', '/onboarding', { step: 'about' }, creatorToken), /403/);
await call('PUT', '/onboarding', { step: 'about', completedAt: null });
await call('PATCH', '/brand', { companyName: 'Lumen Co' });
await assert.rejects(call('POST', '/onboarding/summarize', { description: '' }), /400/);
const drafted = await call('POST', '/onboarding/summarize', { description: 'Lumen Co designs smart lamps that adapt to daylight for homeowners.' });
assert.ok(drafted.summary.summary.includes('smart lamps'));
const kit = await call('PATCH', '/brand', {
  summary: drafted.summary.summary,
  colors: [
    { name: 'Navy', hex: '#1e3a5f', tier: 'PRIMARY', format: 'CMYK', value: '68, 39, 0, 63' },
    { name: 'Amber', hex: '#f5a524', tier: 'SECONDARY', format: 'HEX', value: '#f5a524' },
    { name: 'Pantone Red', hex: '#c8102e', tier: 'TERTIARY', format: 'PANTONE', value: '186 C' },
  ],
});
assert.equal(kit.colors.length, 3);
assert.equal(kit.companyName, 'Lumen Co');
await assert.rejects(call('PATCH', '/brand', { colors: Array.from({ length: 21 }, () => ({ hex: '#ffffff', tier: 'PRIMARY' })) }), /400/);
await call('POST', '/sources', { kind: 'SAMPLE_POST', platform: 'linkedin', content: 'Good light changes everything. Our Aurora Lamp follows the sun so you do not have to. #LumenCo' });
await call('POST', '/onboarding/analyze', { voiceNotes: 'Warm, confident, plain-spoken. Light humor.' });
const analysis = await waitFor(async () => {
  const r = await call('GET', '/onboarding');
  if (r.analysis.state === 'error') throw new Error(r.analysis.error);
  return r.analysis.state === 'done' && r.analysis;
}, 'brand analysis');
assert.deepEqual(analysis.done, ['website', 'samples', 'logos', 'voice']);
await call('PUT', '/onboarding', { step: 'done', completedAt: new Date().toISOString() });
assert.ok((await call('GET', '/onboarding')).state.completedAt);
const sources = await call('GET', '/sources');
assert.ok(sources.some((s) => s.kind === 'SAMPLE_POST' && s.platform === 'linkedin'));
assert.ok(sources.some((s) => s.kind === 'MANUAL' && s.title.includes('brand voice')));
const priced = await call('PATCH', `/products/${product.id}`, { pricing: '$129' });
assert.equal(priced.pricing, '$129');
const proposal = await call('POST', '/brand/summary/refresh', undefined, managerToken);
assert.ok(typeof proposal.summary === 'string');
step('setup wizard: summary drafted, tiered colors saved (20 per tier cap), voice analysis finished, sample posts stored');

// ---- Generation + designs ----
const gen = await call('POST', '/generate/text', { type: 'EMAIL', brief: 'Announce the Aurora Lamp award', productIds: [product.id] });
assert.match(gen.text, /Subject:/);
const social = await call('POST', '/generate/text', { type: 'SOCIAL_POST', platform: 'linkedin', brief: 'Aurora Lamp follows daylight', productIds: [product.id] });
assert.ok(social.text.length > 20);
const { doc } = await call('POST', '/designs/compose', { headline: 'Award-winning light', subline: 'Meet Aurora', platform: 'instagram', imagePrompt: 'cozy living room at dusk', productAssetId: matched[0].id });
assert.equal(doc.width, 1080);
const design = await call('POST', '/designs', { name: 'Smoke design', doc });
for (const f of ['png', 'psd', 'svg', 'pdf', 'idml']) {
  const file = await call('GET', `/designs/${design.id}/export/${f}`);
  assert.ok(file.length > 100, `${f} export is empty`);
}
step('generation: email copy, composed layered design, all 5 export formats');

// ---- Post workflow ----
const post = await call('POST', '/posts', {
  title: 'Award post', body: 'We won! Aurora Lamp took home the 2026 Design Award. #design', platforms: ['linkedin', 'x', 'instagram'],
  perPlatformFiles: true, graphic: { headline: 'Award-winning light', subline: 'Meet Aurora', imagePrompt: 'lamp on a desk' },
}, creatorToken);
assert.equal(post.variants.length, 3);
assert.ok(new Set(post.variants.map((v) => v.designId)).size === 3, 'expected one design per platform');
assert.ok(post.variants.find((v) => v.platform === 'x').body.length <= 280);
await assert.rejects(call('POST', `/posts/${post.id}/transition`, { action: 'startReview' }, creatorToken), /400/);
await call('POST', `/posts/${post.id}/transition`, { action: 'creatorApprove' }, creatorToken);
await call('POST', `/posts/${post.id}/transition`, { action: 'startReview' }, managerToken);
await call('POST', `/posts/${post.id}/transition`, { action: 'returnToCreator', note: 'Mention the factory' }, managerToken);
await call('PATCH', `/posts/${post.id}`, { body: 'We won! Built in our Pittsburgh factory. #design' }, creatorToken);
await call('POST', `/posts/${post.id}/transition`, { action: 'creatorApprove' }, creatorToken);
await call('POST', `/posts/${post.id}/transition`, { action: 'startReview' }, managerToken);
await call('PATCH', `/posts/${post.id}`, { title: 'Award post (final)' }, managerToken);
const when = new Date(Date.now() + 1500).toISOString();
const approved = await call('POST', `/posts/${post.id}/transition`, { action: 'approve', scheduledAt: when }, managerToken);
assert.equal(approved.status, 'SCHEDULED');
const attempted = await waitFor(async () => {
  const p = await call('GET', `/posts/${post.id}`);
  return p.variants.every((v) => v.attempts >= 1) && p;
}, 'publish attempt', 45000);
assert.ok(attempted.variants.every((v) => v.error?.includes('No ')), 'expected "no account connected" errors');
const history = attempted.history.map((h) => h.verb);
for (const v of ['create', 'creatorApprove', 'startReview', 'returnToCreator', 'managerEdit', 'approve']) assert.ok(history.includes(v), `missing ${v} in history`);
step('workflow: creator approve -> review -> return -> edit -> approve -> scheduled -> publish attempted (no accounts connected)');

// ---- Campaign ----
const campaign = await call('POST', '/campaigns', {
  name: 'Fall week', brief: 'Promote Aurora Lamp for cozy fall evenings', startDate: '2026-10-05', endDate: '2026-10-11',
  postDays: [1, 3, 5], postTimes: ['10:00'], utcOffsetMinutes: -240, platforms: ['facebook', 'linkedin'], perPlatformFiles: true, productIds: [product.id], generateGraphics: true,
}, creatorToken);
const ready = await waitFor(async () => {
  const c = await call('GET', `/campaigns/${campaign.id}`, undefined, creatorToken);
  if (c.status === 'FAILED') throw new Error(c.error);
  return c.status === 'READY' && c;
}, 'campaign generation', 60000);
assert.equal(ready.posts.length, 3);
assert.equal(ready.posts[0].scheduledAt, '2026-10-05T14:00:00.000Z');
const bulk = await call('POST', '/posts/bulk-transition', { ids: ready.posts.map((p) => p.id), action: 'creatorApprove' }, creatorToken);
assert.ok(bulk.results.every((r) => r.ok));
step('campaign: 3 drafts on Mon/Wed/Fri at 10:00 local, per-platform graphics, bulk creator approval');

// ---- Calendar, work log, analytics, search, backup ----
await call('POST', '/schedule', { title: 'PTO', startsAt: '2026-10-06T00:00:00.000Z', endsAt: '2026-10-07T00:00:00.000Z', allDay: true }, creatorToken);
const cal = await call('GET', '/calendar?from=2026-10-01T00:00:00.000Z&to=2026-10-31T00:00:00.000Z');
assert.ok(cal.posts.length >= 3 && cal.schedule.length >= 1);
const log = await call('GET', '/activity?limit=100');
assert.ok(log.items.some((e) => /approved post "Award post \(final\)" for \d\d\/\d\d\/\d{4}/.test(e.summary) && e.link === `/posts/${post.id}`));
const analytics = await call('GET', '/analytics');
assert.ok(analytics.totals.posts >= 4);
const search = await call('GET', '/search?q=aurora');
assert.ok(search.products.length >= 1);
const backup = await call('GET', '/admin/backup');
assert.ok(backup.data.posts.length >= 4 && !('passwordHash' in backup.data.users[0]));
await assert.rejects(call('GET', '/admin/backup', undefined, creatorToken), /403/);
const dash = await call('GET', '/dashboard', undefined, managerToken);
assert.ok(dash.awaitingReview >= 3);
step('calendar, work log (dated approval entry with link), analytics, search, admin-only backup, dashboard');

console.log('\nSMOKE TEST PASSED');
