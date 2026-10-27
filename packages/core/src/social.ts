import crypto from 'node:crypto';
import { prisma, type SocialAccount } from '@mh/db';
import type { Platform } from '@mh/shared';
import { config } from './config';
import { decrypt, encrypt, randomToken } from './crypto';

export const redirectUri = (platform: string) => `${config.PUBLIC_API_URL}/social/callback/${platform}`;

const GRAPH = 'https://graph.facebook.com/v21.0';

interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
}

interface DiscoveredAccount {
  platform: Platform;
  externalId: string;
  displayName: string;
  token: TokenSet;
  meta?: Record<string, unknown>;
}

/** OAuth client settings; a platform is connectable only if its credentials are configured. */
export function oauthClient(platform: Platform): { id: string; secret: string } | null {
  const pick = (id?: string, secret?: string) => (id && secret ? { id, secret } : null);
  switch (platform) {
    case 'facebook':
    case 'instagram':
      return pick(config.META_APP_ID, config.META_APP_SECRET);
    case 'linkedin':
      return pick(config.LINKEDIN_CLIENT_ID, config.LINKEDIN_CLIENT_SECRET);
    case 'x':
      return pick(config.X_CLIENT_ID, config.X_CLIENT_SECRET);
    case 'youtube':
      return pick(config.GOOGLE_CLIENT_ID, config.GOOGLE_CLIENT_SECRET);
    case 'tiktok':
      return pick(config.TIKTOK_CLIENT_KEY, config.TIKTOK_CLIENT_SECRET);
  }
}

function pkce() {
  const verifier = randomToken(48);
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/** Starts an OAuth flow; returns the provider URL to open in the user's browser. */
export async function startOAuth(platform: Platform, userId: string): Promise<string> {
  const client = oauthClient(platform);
  if (!client) throw new Error(`${platform} is not configured on the server. Add its app credentials to .env.`);
  const state = randomToken(24);
  const { verifier, challenge } = pkce();
  await prisma.oAuthState.create({ data: { state, platform, userId, verifier } });
  const redirect = encodeURIComponent(redirectUri(platform));
  switch (platform) {
    case 'facebook':
    case 'instagram': {
      const scope = 'pages_show_list,pages_manage_posts,pages_read_engagement,instagram_basic,instagram_content_publish,business_management';
      return `https://www.facebook.com/v21.0/dialog/oauth?client_id=${client.id}&redirect_uri=${redirect}&state=${state}&scope=${scope}`;
    }
    case 'linkedin':
      return `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${client.id}&redirect_uri=${redirect}&state=${state}&scope=${encodeURIComponent(config.LINKEDIN_SCOPES)}`;
    case 'x':
      return `https://x.com/i/oauth2/authorize?response_type=code&client_id=${client.id}&redirect_uri=${redirect}&state=${state}&scope=${encodeURIComponent('tweet.read tweet.write users.read media.write offline.access')}&code_challenge=${challenge}&code_challenge_method=S256`;
    case 'youtube':
      return `https://accounts.google.com/o/oauth2/v2/auth?client_id=${client.id}&redirect_uri=${redirect}&response_type=code&access_type=offline&prompt=consent&state=${state}&scope=${encodeURIComponent('https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly')}`;
    case 'tiktok':
      return `https://www.tiktok.com/v2/auth/authorize/?client_key=${client.id}&response_type=code&redirect_uri=${redirect}&state=${state}&scope=${encodeURIComponent('user.info.basic,video.publish')}`;
  }
}

async function json<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

async function exchangeCode(platform: Platform, code: string, verifier: string | null): Promise<TokenSet> {
  const client = oauthClient(platform)!;
  const redirect = redirectUri(platform);
  const form = (body: Record<string, string>) => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  switch (platform) {
    case 'facebook':
    case 'instagram': {
      const short = await json<{ access_token: string }>(
        await fetch(`${GRAPH}/oauth/access_token?client_id=${client.id}&client_secret=${client.secret}&redirect_uri=${encodeURIComponent(redirect)}&code=${code}`),
      );
      const long = await json<{ access_token: string; expires_in?: number }>(
        await fetch(`${GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${client.id}&client_secret=${client.secret}&fb_exchange_token=${short.access_token}`),
      );
      return { accessToken: long.access_token, expiresIn: long.expires_in };
    }
    case 'linkedin': {
      const t = await json<{ access_token: string; refresh_token?: string; expires_in: number }>(
        await fetch('https://www.linkedin.com/oauth/v2/accessToken', form({ grant_type: 'authorization_code', code, redirect_uri: redirect, client_id: client.id, client_secret: client.secret })),
      );
      return { accessToken: t.access_token, refreshToken: t.refresh_token, expiresIn: t.expires_in };
    }
    case 'x': {
      const res = await fetch('https://api.x.com/2/oauth2/token', {
        ...form({ grant_type: 'authorization_code', code, redirect_uri: redirect, code_verifier: verifier ?? '', client_id: client.id }),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${Buffer.from(`${client.id}:${client.secret}`).toString('base64')}` },
      });
      const t = await json<{ access_token: string; refresh_token?: string; expires_in: number }>(res);
      return { accessToken: t.access_token, refreshToken: t.refresh_token, expiresIn: t.expires_in };
    }
    case 'youtube': {
      const t = await json<{ access_token: string; refresh_token?: string; expires_in: number }>(
        await fetch('https://oauth2.googleapis.com/token', form({ grant_type: 'authorization_code', code, redirect_uri: redirect, client_id: client.id, client_secret: client.secret })),
      );
      return { accessToken: t.access_token, refreshToken: t.refresh_token, expiresIn: t.expires_in };
    }
    case 'tiktok': {
      const t = await json<{ access_token: string; refresh_token?: string; expires_in: number }>(
        await fetch('https://open.tiktokapis.com/v2/oauth/token/', form({ grant_type: 'authorization_code', code, redirect_uri: redirect, client_key: client.id, client_secret: client.secret })),
      );
      return { accessToken: t.access_token, refreshToken: t.refresh_token, expiresIn: t.expires_in };
    }
  }
}

/** Finds the pages / profiles / channels the user can post as. */
async function discoverAccounts(platform: Platform, token: TokenSet): Promise<DiscoveredAccount[]> {
  const bearer = { Authorization: `Bearer ${token.accessToken}` };
  switch (platform) {
    case 'facebook':
    case 'instagram': {
      const pages = await json<{ data: { id: string; name: string; access_token: string; instagram_business_account?: { id: string; username?: string } }[] }>(
        await fetch(`${GRAPH}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&access_token=${token.accessToken}`),
      );
      return pages.data.flatMap((p) => {
        const out: DiscoveredAccount[] = [{ platform: 'facebook', externalId: p.id, displayName: p.name, token: { accessToken: p.access_token } }];
        if (p.instagram_business_account) {
          out.push({
            platform: 'instagram',
            externalId: p.instagram_business_account.id,
            displayName: `@${p.instagram_business_account.username ?? p.name}`,
            token: { accessToken: p.access_token },
            meta: { pageId: p.id },
          });
        }
        return out;
      });
    }
    case 'linkedin': {
      const headers = { ...bearer, 'LinkedIn-Version': '202409', 'X-Restli-Protocol-Version': '2.0.0' };
      const me = await json<{ sub: string; name: string }>(await fetch('https://api.linkedin.com/v2/userinfo', { headers: bearer }));
      const out: DiscoveredAccount[] = [{ platform: 'linkedin', externalId: `urn:li:person:${me.sub}`, displayName: me.name, token, meta: { urn: `urn:li:person:${me.sub}` } }];
      try {
        const acls = await json<{ elements: { organization: string }[] }>(
          await fetch('https://api.linkedin.com/rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED', { headers }),
        );
        for (const a of acls.elements) {
          const orgId = a.organization.split(':').pop();
          const org = await json<{ localizedName?: string }>(await fetch(`https://api.linkedin.com/rest/organizations/${orgId}`, { headers })).catch(() => ({ localizedName: undefined }));
          out.push({ platform: 'linkedin', externalId: a.organization, displayName: org.localizedName ?? a.organization, token, meta: { urn: a.organization } });
        }
      } catch {
        // No organization access granted; personal profile only.
      }
      return out;
    }
    case 'x': {
      const me = await json<{ data: { id: string; username: string } }>(await fetch('https://api.x.com/2/users/me', { headers: bearer }));
      return [{ platform: 'x', externalId: me.data.id, displayName: `@${me.data.username}`, token }];
    }
    case 'youtube': {
      const ch = await json<{ items: { id: string; snippet: { title: string } }[] }>(
        await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers: bearer }),
      );
      return ch.items.map((c) => ({ platform: 'youtube' as const, externalId: c.id, displayName: c.snippet.title, token }));
    }
    case 'tiktok': {
      const me = await json<{ data: { user: { open_id: string; display_name: string } } }>(
        await fetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name', { headers: bearer }),
      );
      return [{ platform: 'tiktok', externalId: me.data.user.open_id, displayName: me.data.user.display_name, token }];
    }
  }
}

/** Completes an OAuth callback and stores (encrypted) every account discovered. */
export async function completeOAuth(platform: Platform, code: string, state: string): Promise<{ accounts: string[]; userId: string }> {
  const saved = await prisma.oAuthState.findUnique({ where: { state } });
  if (!saved || saved.platform !== platform || Date.now() - saved.createdAt.getTime() > 15 * 60_000) {
    throw new Error('This connection link expired. Start again from Mantis.');
  }
  await prisma.oAuthState.delete({ where: { state } });
  const token = await exchangeCode(platform, code, saved.verifier);
  const accounts = await discoverAccounts(platform, token);
  for (const a of accounts) {
    const data = {
      displayName: a.displayName,
      accessTokenEnc: encrypt(a.token.accessToken),
      refreshTokenEnc: a.token.refreshToken ? encrypt(a.token.refreshToken) : null,
      expiresAt: a.token.expiresIn ? new Date(Date.now() + a.token.expiresIn * 1000) : null,
      meta: (a.meta ?? {}) as object,
      connectedById: saved.userId,
    };
    await prisma.socialAccount.upsert({
      where: { platform_externalId: { platform: a.platform, externalId: a.externalId } },
      update: data,
      create: { platform: a.platform, externalId: a.externalId, ...data },
    });
  }
  return { accounts: accounts.map((a) => `${a.platform}: ${a.displayName}`), userId: saved.userId };
}

/** Returns a valid access token, refreshing it first if it is about to expire. */
export async function accessTokenFor(account: SocialAccount): Promise<string> {
  const soon = account.expiresAt && account.expiresAt.getTime() < Date.now() + 5 * 60_000;
  if (!soon || !account.refreshTokenEnc) return decrypt(account.accessTokenEnc);
  const client = oauthClient(account.platform as Platform);
  if (!client) return decrypt(account.accessTokenEnc);
  const refresh = decrypt(account.refreshTokenEnc);
  const form = (body: Record<string, string>, extra: Record<string, string> = {}) => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...extra },
    body: new URLSearchParams(body).toString(),
  });
  let t: { access_token: string; refresh_token?: string; expires_in?: number };
  switch (account.platform) {
    case 'x':
      t = await json(await fetch('https://api.x.com/2/oauth2/token', form({ grant_type: 'refresh_token', refresh_token: refresh, client_id: client.id }, { Authorization: `Basic ${Buffer.from(`${client.id}:${client.secret}`).toString('base64')}` })));
      break;
    case 'youtube':
      t = await json(await fetch('https://oauth2.googleapis.com/token', form({ grant_type: 'refresh_token', refresh_token: refresh, client_id: client.id, client_secret: client.secret })));
      break;
    case 'linkedin':
      t = await json(await fetch('https://www.linkedin.com/oauth/v2/accessToken', form({ grant_type: 'refresh_token', refresh_token: refresh, client_id: client.id, client_secret: client.secret })));
      break;
    case 'tiktok':
      t = await json(await fetch('https://open.tiktokapis.com/v2/oauth/token/', form({ grant_type: 'refresh_token', refresh_token: refresh, client_key: client.id, client_secret: client.secret })));
      break;
    default:
      return decrypt(account.accessTokenEnc);
  }
  await prisma.socialAccount.update({
    where: { id: account.id },
    data: {
      accessTokenEnc: encrypt(t.access_token),
      refreshTokenEnc: t.refresh_token ? encrypt(t.refresh_token) : account.refreshTokenEnc,
      expiresAt: t.expires_in ? new Date(Date.now() + t.expires_in * 1000) : null,
    },
  });
  return t.access_token;
}
