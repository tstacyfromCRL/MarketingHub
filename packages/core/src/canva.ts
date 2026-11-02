import { prisma } from '@mh/db';
import { config } from './config';
import { decrypt, encrypt, randomToken } from './crypto';
import { canvaAutofillData, canvaAuthorizeUrl, canvaEditLink, canvaMissingImageFrame, canvaTemplateUsesAutofill, verifyCanvaReturnJwt, type CanvaField } from './canvaConnect';

const API = 'https://api.canva.com/rest/v1';

export class CanvaError extends Error {}

export function canvaConfigured(): boolean {
  return Boolean(config.CANVA_CLIENT_ID && config.CANVA_CLIENT_SECRET);
}

function credentials(): { id: string; secret: string } {
  if (!config.CANVA_CLIENT_ID || !config.CANVA_CLIENT_SECRET) throw new CanvaError('Canva is not configured on the server.');
  return { id: config.CANVA_CLIENT_ID, secret: config.CANVA_CLIENT_SECRET };
}

function redirectUri(): string {
  return `${config.PUBLIC_API_URL}/canva/callback`;
}

/** Sends the person to Canva to approve access. The verifier stays on the server. */
export async function startCanvaConnect(userId: string): Promise<string> {
  const client = credentials();
  const verifier = randomToken(64);
  const state = randomToken(24);
  await prisma.oAuthState.create({ data: { state, platform: 'canva', userId, verifier } });
  return canvaAuthorizeUrl({ clientId: client.id, redirectUri: redirectUri(), state, verifier });
}

async function tokenRequest(body: URLSearchParams): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  const client = credentials();
  const res = await fetch(`${API}/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${client.id}:${client.secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const json = await res.json().catch(() => ({})) as { access_token?: string; refresh_token?: string; expires_in?: number; message?: string };
  if (!res.ok || !json.access_token || !json.refresh_token) throw new CanvaError(json.message ?? 'Canva did not return a token.');
  return { access_token: json.access_token, refresh_token: json.refresh_token, expires_in: json.expires_in ?? 14400 };
}

/** Exchanges the browser code for tokens and keeps one connection for that Canva user. */
export async function finishCanvaConnect(code: string, state: string): Promise<{ userId: string; displayName: string }> {
  const pending = await prisma.oAuthState.findUnique({ where: { state } });
  if (!pending || pending.platform !== 'canva' || !pending.verifier) throw new CanvaError('This Canva connection request is no longer valid.');
  await prisma.oAuthState.delete({ where: { state } });
  const tokens = await tokenRequest(new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    code_verifier: pending.verifier,
    redirect_uri: redirectUri(),
  }));
  const me = await canvaFetch(tokens.access_token, 'GET', '/users/me') as {
    team_user?: { user_id?: string; team_id?: string; display_name?: string };
    profile?: { display_name?: string };
  };
  const canvaUserId = me.team_user?.user_id;
  if (!canvaUserId) throw new CanvaError('Canva did not identify the account.');
  const displayName = me.profile?.display_name ?? me.team_user?.display_name ?? 'Canva';
  const data = {
    displayName,
    teamId: me.team_user?.team_id,
    accessTokenEnc: encrypt(tokens.access_token),
    refreshTokenEnc: encrypt(tokens.refresh_token),
    expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    connectedById: pending.userId,
  };
  await prisma.canvaAccount.upsert({
    where: { canvaUserId },
    update: data,
    create: { canvaUserId, ...data },
  });
  return { userId: pending.userId, displayName };
}

export async function canvaStatus() {
  const account = await prisma.canvaAccount.findFirst({
    orderBy: { updatedAt: 'desc' },
    select: { id: true, displayName: true, connectedBy: { select: { name: true } } },
  });
  return {
    configured: canvaConfigured(),
    connected: Boolean(account),
    account: account ? { id: account.id, displayName: account.displayName, connectedBy: account.connectedBy.name } : null,
  };
}

export async function disconnectCanva(id: string) {
  await prisma.canvaAccount.delete({ where: { id } });
}

async function accessToken(): Promise<string> {
  const account = await prisma.canvaAccount.findFirst({ orderBy: { updatedAt: 'desc' } });
  if (!account) throw new CanvaError('Connect Canva in Settings first.');
  if (account.expiresAt.getTime() > Date.now() + 60_000) return decrypt(account.accessTokenEnc);
  const tokens = await tokenRequest(new URLSearchParams({ grant_type: 'refresh_token', refresh_token: decrypt(account.refreshTokenEnc) }));
  await prisma.canvaAccount.update({
    where: { id: account.id },
    data: {
      accessTokenEnc: encrypt(tokens.access_token),
      refreshTokenEnc: encrypt(tokens.refresh_token),
      expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    },
  });
  return tokens.access_token;
}

async function canvaFetch(token: string, method: string, path: string, init: { json?: unknown; body?: Buffer; headers?: Record<string, string> } = {}): Promise<unknown> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, ...init.headers };
  let body: BodyInit | undefined;
  if (init.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(init.json);
  } else if (init.body) {
    body = new Uint8Array(init.body);
  }
  const res = await fetch(`${API}${path}`, { method, headers, body });
  const json = await res.json().catch(() => ({})) as { message?: string };
  if (!res.ok) throw new CanvaError(json.message ?? `Canva returned ${res.status}.`);
  return json;
}

async function pollJob(token: string, path: string): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const body = await canvaFetch(token, 'GET', path) as { job?: { status?: string; error?: { message?: string } } };
    const status = body.job?.status;
    if (status === 'success') return body.job as Record<string, unknown>;
    if (status === 'failed') throw new CanvaError(body.job?.error?.message ?? 'Canva could not finish that job.');
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new CanvaError('Canva is still working. Try again in a moment.');
}

export async function listCanvaTemplates(): Promise<{ id: string; title: string; thumbnailUrl: string | null }[]> {
  const token = await accessToken();
  const body = await canvaFetch(token, 'GET', '/brand-templates?limit=50&ownership=any&sort_by=title_ascending') as {
    items?: { id: string; title: string; thumbnail?: { url?: string } }[];
  };
  return (body.items ?? []).map((item) => ({ id: item.id, title: item.title, thumbnailUrl: item.thumbnail?.url ?? null }));
}

async function uploadAsset(token: string, name: string, bytes: Buffer): Promise<string> {
  const safe = name.replace(/[^\w.\- ]+/g, '').trim().slice(0, 50) || 'image';
  const started = await canvaFetch(token, 'POST', '/asset-uploads', {
    body: bytes,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Asset-Upload-Metadata': JSON.stringify({ name_base64: Buffer.from(safe).toString('base64') }),
    },
  }) as { job?: { id?: string; status?: string; asset?: { id?: string } } };
  if (started.job?.status === 'success' && started.job.asset?.id) return started.job.asset.id;
  if (!started.job?.id) throw new CanvaError('Canva did not accept the image.');
  const done = await pollJob(token, `/asset-uploads/${started.job.id}`) as { asset?: { id?: string } };
  if (!done.asset?.id) throw new CanvaError('Canva did not finish uploading the image.');
  return done.asset.id;
}

async function exportPng(token: string, canvaDesignId: string): Promise<Buffer> {
  const started = await canvaFetch(token, 'POST', '/exports', { json: { design_id: canvaDesignId, format: { type: 'png' } } }) as { job?: { id?: string } };
  if (!started.job?.id) throw new CanvaError('Canva did not start the export.');
  const done = await pollJob(token, `/exports/${started.job.id}`) as { urls?: string[] };
  const url = done.urls?.[0];
  if (!url) throw new CanvaError('Canva did not return the exported file.');
  const res = await fetch(url);
  if (!res.ok) throw new CanvaError('Canva export could not be downloaded.');
  return Buffer.from(await res.arrayBuffer());
}

export interface CanvaDraft {
  title: string;
  templateId?: string;
  headline?: string;
  image?: { name: string; bytes: Buffer };
  width: number;
  height: number;
}

/** A brand template without fill-in fields is copied. Autofill is only for templates that have those fields. */
async function designFromTemplate(token: string, draft: CanvaDraft): Promise<{ canvaDesignId: string; filled: boolean }> {
  const templateId = draft.templateId!;
  let fields: CanvaField[] = [];
  try {
    const dataset = await canvaFetch(token, 'GET', `/brand-templates/${encodeURIComponent(templateId)}/dataset`) as { dataset?: Record<string, { type?: string }> };
    fields = Object.entries(dataset.dataset ?? {}).map(([name, field]) => ({ name, type: field.type ?? 'text' }));
  } catch (err) {
    if (!(err instanceof CanvaError) || !/autofill/i.test(err.message)) throw err;
  }
  if (canvaMissingImageFrame(fields, Boolean(draft.image))) {
    throw new CanvaError('That template has no image frame set up to take a photo. In Canva, select the image frame, open Apps, search for Bulk Create, choose Labels, and add a data field. Then choose the image again.');
  }
  const assetId = draft.image ? await uploadAsset(token, draft.image.name, draft.image.bytes) : undefined;
  const data = canvaAutofillData(fields, { headline: draft.headline, assetId });
  if (!canvaTemplateUsesAutofill(fields, { headline: draft.headline, assetId })) {
    return { canvaDesignId: await copyBrandTemplate(token, templateId, draft.title), filled: false };
  }
  try {
    const started = await canvaFetch(token, 'POST', '/autofills', { json: { brand_template_id: templateId, data } }) as { job?: { id?: string } };
    if (!started.job?.id) throw new CanvaError('Canva did not start the template.');
    const done = await pollJob(token, `/autofills/${started.job.id}`) as { result?: { design?: { id?: string } }; design?: { id?: string } };
    const canvaDesignId = done.result?.design?.id ?? done.design?.id ?? '';
    if (!canvaDesignId) throw new CanvaError('Canva did not return the new design.');
    return { canvaDesignId, filled: true };
  } catch (err) {
    if (draft.image || !(err instanceof CanvaError) || !/autofill/i.test(err.message)) throw err;
    return { canvaDesignId: await copyBrandTemplate(token, templateId, draft.title), filled: false };
  }
}

async function copyBrandTemplate(token: string, templateId: string, title: string): Promise<string> {
  const created = await canvaFetch(token, 'POST', '/designs', {
    json: { type: 'brand_template', brand_template_id: templateId, title },
  }) as { design?: { id?: string } };
  if (!created.design?.id) throw new CanvaError('Canva did not create a design from that template.');
  return created.design.id;
}

/** Creates a Canva design, from a brand template when one is chosen, and exports a PNG. */
export async function createCanvaGraphic(draft: CanvaDraft): Promise<{ canvaDesignId: string; png: Buffer; editUrl: string; filled: boolean }> {
  const token = await accessToken();
  let canvaDesignId: string;
  let filled = false;
  if (draft.templateId) {
    const created = await designFromTemplate(token, draft);
    canvaDesignId = created.canvaDesignId;
    filled = created.filled;
  } else {
    const created = await canvaFetch(token, 'POST', '/designs', {
      json: { title: draft.title, design_type: { type: 'custom', width: draft.width, height: draft.height } },
    }) as { design?: { id?: string } };
    if (!created.design?.id) throw new CanvaError('Canva did not create a design.');
    canvaDesignId = created.design.id;
  }
  const png = await exportPng(token, canvaDesignId);
  const design = await canvaFetch(token, 'GET', `/designs/${encodeURIComponent(canvaDesignId)}`) as { design?: { urls?: { edit_url?: string } } };
  const editUrl = design.design?.urls?.edit_url;
  if (!editUrl) throw new CanvaError('Canva did not return an edit link.');
  return { canvaDesignId, png, editUrl, filled };
}

export async function canvaEditUrl(canvaDesignId: string, mantisDesignId: string): Promise<string> {
  const token = await accessToken();
  const design = await canvaFetch(token, 'GET', `/designs/${encodeURIComponent(canvaDesignId)}`) as { design?: { urls?: { edit_url?: string } } };
  const editUrl = design.design?.urls?.edit_url;
  if (!editUrl) throw new CanvaError('Canva did not return an edit link.');
  return canvaEditLink(editUrl, mantisDesignId);
}

/** Checks the return token, then downloads a fresh PNG of that Canva design. */
export async function importCanvaReturn(jwt: string): Promise<{ canvaDesignId: string; mantisDesignId: string; png: Buffer }> {
  const keys = await fetch(`${API}/connect/keys`).then((res) => res.json()) as { keys?: (JsonWebKey & { kid?: string })[] };
  const claims = verifyCanvaReturnJwt(jwt, keys.keys ?? []);
  const token = await accessToken();
  const png = await exportPng(token, claims.designId);
  return { canvaDesignId: claims.designId, mantisDesignId: claims.correlationState, png };
}
