import { prisma, type SocialAccount } from '@mh/db';
import { PLATFORM_PRESETS, type Platform } from '@mh/shared';
import { config } from './config';
import { renderDesignMedia, signedMediaUrl } from './designs';
import { applyPostAction } from './posts';
import { accessTokenFor } from './social';

const GRAPH = 'https://graph.facebook.com/v21.0';
export const MAX_PUBLISH_ATTEMPTS = 3;

export interface PublishResult {
  externalId: string;
  url?: string;
}

interface Media {
  key: string;
  png: Buffer;
}

/** Copies into a plain ArrayBuffer-backed view, as Blob and fetch bodies require. */
const bytes = (buf: Buffer) => new Uint8Array(buf);

async function ok<T>(res: Response, what: string): Promise<T> {
  const text = await res.text();
  if (!res.ok) throw new Error(`${what} failed (HTTP ${res.status}): ${text.slice(0, 400)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

// ---------------------------------------------------------------------------
// Per-platform publishers (official APIs)
// ---------------------------------------------------------------------------

async function publishFacebook(acct: SocialAccount, token: string, text: string, media: Media | null): Promise<PublishResult> {
  if (!media) {
    const r = await ok<{ id: string }>(await fetch(`${GRAPH}/${acct.externalId}/feed`, { method: 'POST', body: new URLSearchParams({ message: text, access_token: token }) }), 'Facebook post');
    return { externalId: r.id, url: `https://www.facebook.com/${r.id}` };
  }
  const form = new FormData();
  form.set('message', text);
  form.set('access_token', token);
  form.set('source', new Blob([bytes(media.png)], { type: 'image/png' }), 'post.png');
  const r = await ok<{ id: string; post_id?: string }>(await fetch(`${GRAPH}/${acct.externalId}/photos`, { method: 'POST', body: form }), 'Facebook photo');
  return { externalId: r.post_id ?? r.id, url: `https://www.facebook.com/${r.post_id ?? r.id}` };
}

async function publishInstagram(acct: SocialAccount, token: string, text: string, media: Media | null): Promise<PublishResult> {
  if (!media) throw new Error('Instagram posts need an image');
  const container = await ok<{ id: string }>(
    await fetch(`${GRAPH}/${acct.externalId}/media`, { method: 'POST', body: new URLSearchParams({ image_url: signedMediaUrl(media.key), caption: text, access_token: token }) }),
    'Instagram media container',
  );
  const published = await ok<{ id: string }>(
    await fetch(`${GRAPH}/${acct.externalId}/media_publish`, { method: 'POST', body: new URLSearchParams({ creation_id: container.id, access_token: token }) }),
    'Instagram publish',
  );
  const info = await ok<{ permalink?: string }>(await fetch(`${GRAPH}/${published.id}?fields=permalink&access_token=${token}`), 'Instagram permalink').catch(() => ({ permalink: undefined }));
  return { externalId: published.id, url: info.permalink };
}

async function publishLinkedIn(acct: SocialAccount, token: string, text: string, media: Media | null): Promise<PublishResult> {
  const urn = String((acct.meta as { urn?: string }).urn ?? acct.externalId);
  const headers = { Authorization: `Bearer ${token}`, 'LinkedIn-Version': '202409', 'X-Restli-Protocol-Version': '2.0.0', 'Content-Type': 'application/json' };
  let content: unknown;
  if (media) {
    const init = await ok<{ value: { uploadUrl: string; image: string } }>(
      await fetch('https://api.linkedin.com/rest/images?action=initializeUpload', { method: 'POST', headers, body: JSON.stringify({ initializeUploadRequest: { owner: urn } }) }),
      'LinkedIn image upload init',
    );
    const put = await fetch(init.value.uploadUrl, { method: 'PUT', headers: { Authorization: `Bearer ${token}` }, body: bytes(media.png) });
    if (!put.ok) throw new Error(`LinkedIn image upload failed (HTTP ${put.status})`);
    content = { media: { id: init.value.image } };
  }
  const res = await fetch('https://api.linkedin.com/rest/posts', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      author: urn,
      commentary: text.replace(/([\\|{}@\[\]()<>#*_~])/g, '\\$1'),
      visibility: 'PUBLIC',
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      content,
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    }),
  });
  await ok(res, 'LinkedIn post');
  const id = res.headers.get('x-restli-id') ?? '';
  return { externalId: id, url: id ? `https://www.linkedin.com/feed/update/${id}` : undefined };
}

async function publishX(_acct: SocialAccount, token: string, text: string, media: Media | null): Promise<PublishResult> {
  let mediaIds: string[] | undefined;
  if (media) {
    const form = new FormData();
    form.set('media', new Blob([bytes(media.png)], { type: 'image/png' }), 'post.png');
    form.set('media_category', 'tweet_image');
    const up = await ok<{ data: { id: string } }>(await fetch('https://api.x.com/2/media/upload', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form }), 'X media upload');
    mediaIds = [up.data.id];
  }
  const r = await ok<{ data: { id: string } }>(
    await fetch('https://api.x.com/2/tweets', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, media: mediaIds ? { media_ids: mediaIds } : undefined }),
    }),
    'X post',
  );
  return { externalId: r.data.id, url: `https://x.com/i/web/status/${r.data.id}` };
}

async function publishTikTok(_acct: SocialAccount, token: string, text: string, media: Media | null): Promise<PublishResult> {
  if (!media) throw new Error('TikTok posts need an image or video');
  const r = await ok<{ data: { publish_id: string } }>(
    await fetch('https://open.tiktokapis.com/v2/post/publish/content/init/', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({
        post_info: { title: text.slice(0, 90), description: text.slice(0, 4000), privacy_level: 'PUBLIC_TO_EVERYONE', auto_add_music: true },
        source_info: { source: 'PULL_FROM_URL', photo_images: [signedMediaUrl(media.key, 6 * 3600)], photo_cover_index: 0 },
        post_mode: 'DIRECT_POST',
        media_type: 'PHOTO',
      }),
    }),
    'TikTok post',
  );
  return { externalId: r.data.publish_id };
}

async function publishYouTube(): Promise<PublishResult> {
  throw new Error('YouTube only accepts video uploads; image posts cannot be published there');
}

const PUBLISHERS: Record<Platform, (a: SocialAccount, token: string, text: string, media: Media | null) => Promise<PublishResult>> = {
  facebook: publishFacebook,
  instagram: publishInstagram,
  linkedin: publishLinkedIn,
  x: publishX,
  tiktok: publishTikTok,
  youtube: publishYouTube,
};

/** Aggregator stopgap while platform app reviews are pending. */
async function publishViaAyrshare(platforms: Platform[], text: string, media: Media | null): Promise<Record<string, PublishResult>> {
  if (!config.AYRSHARE_API_KEY) throw new Error('AYRSHARE_API_KEY is not set');
  const map: Record<Platform, string> = { facebook: 'facebook', instagram: 'instagram', linkedin: 'linkedin', x: 'twitter', tiktok: 'tiktok', youtube: 'youtube' };
  const r = await ok<{ postIds?: { platform: string; id: string; postUrl?: string }[] }>(
    await fetch('https://api.ayrshare.com/api/post', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.AYRSHARE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ post: text, platforms: platforms.map((p) => map[p]), mediaUrls: media ? [signedMediaUrl(media.key, 6 * 3600)] : undefined }),
    }),
    'Ayrshare post',
  );
  const out: Record<string, PublishResult> = {};
  for (const p of platforms) {
    const hit = r.postIds?.find((x) => x.platform === map[p]);
    if (hit) out[p] = { externalId: hit.id, url: hit.postUrl };
  }
  return out;
}

export async function defaultAccountFor(platform: string): Promise<SocialAccount | null> {
  const setting = await prisma.appSetting.findUnique({ where: { key: 'defaultAccounts' } });
  const preferred = (setting?.value as Record<string, string> | undefined)?.[platform];
  if (preferred) {
    const acct = await prisma.socialAccount.findUnique({ where: { id: preferred } });
    if (acct) return acct;
  }
  return prisma.socialAccount.findFirst({ where: { platform }, orderBy: { createdAt: 'asc' } });
}

const inFlight = new Set<string>();

/**
 * Publishes every pending variant of a scheduled post. Throws if something failed but can
 * still be retried (so the queue retries it); after the last attempt the post becomes Failed.
 */
export async function publishPost(postId: string): Promise<void> {
  if (inFlight.has(postId)) return;
  inFlight.add(postId);
  try {
    const post = await prisma.post.findUnique({ where: { id: postId }, include: { variants: true } });
    if (!post || post.status !== 'SCHEDULED') return;
    if (post.scheduledAt && post.scheduledAt.getTime() > Date.now() + 60_000) return;

    const pending = post.variants.filter((v) => v.status !== 'POSTED');
    const mediaCache = new Map<string, Media>();
    const mediaFor = async (designId: string | null) => {
      const id = designId ?? post.designId;
      if (!id) return null;
      if (!mediaCache.has(id)) mediaCache.set(id, await renderDesignMedia(id));
      return mediaCache.get(id)!;
    };

    if (config.PUBLISH_MODE === 'ayrshare' && pending.length) {
      await prisma.postVariant.updateMany({ where: { id: { in: pending.map((v) => v.id) } }, data: { attempts: { increment: 1 } } });
      try {
        const results = await publishViaAyrshare(pending.map((v) => v.platform as Platform), pending[0].body, await mediaFor(pending[0].designId));
        for (const v of pending) {
          const r = results[v.platform];
          await prisma.postVariant.update({
            where: { id: v.id },
            data: r ? { status: 'POSTED', externalId: r.externalId, externalUrl: r.url, postedAt: new Date(), error: null } : { status: 'FAILED', error: 'Not returned by Ayrshare' },
          });
        }
      } catch (err) {
        await prisma.postVariant.updateMany({ where: { id: { in: pending.map((v) => v.id) } }, data: { status: 'FAILED', error: (err as Error).message } });
      }
    } else {
      for (const v of pending) {
        const attempts = v.attempts + 1;
        try {
          const acct = await defaultAccountFor(v.platform);
          if (!acct) throw new Error(`No ${PLATFORM_PRESETS[v.platform as Platform]?.label ?? v.platform} account is connected`);
          const token = await accessTokenFor(acct);
          const r = await PUBLISHERS[v.platform as Platform](acct, token, v.body, await mediaFor(v.designId));
          await prisma.postVariant.update({
            where: { id: v.id },
            data: { status: 'POSTED', attempts, externalId: r.externalId, externalUrl: r.url, postedAt: new Date(), error: null },
          });
        } catch (err) {
          await prisma.postVariant.update({ where: { id: v.id }, data: { status: 'FAILED', attempts, error: (err as Error).message } });
        }
      }
    }

    const variants = await prisma.postVariant.findMany({ where: { postId } });
    const failed = variants.filter((v) => v.status !== 'POSTED');
    const links = variants.filter((v) => v.externalUrl).map((v) => `${PLATFORM_PRESETS[v.platform as Platform]?.label ?? v.platform}: ${v.externalUrl}`);
    if (failed.length === 0) {
      await applyPostAction(postId, 'publishSucceeded', 'SYSTEM', { summaryExtra: links.length ? `. Links: ${links.join(' | ')}` : '' });
      return;
    }
    const exhausted = failed.every((v) => v.attempts >= MAX_PUBLISH_ATTEMPTS);
    if (exhausted) {
      const reasons = failed.map((v) => `${v.platform}: ${v.error ?? 'unknown error'}`).join('; ');
      await applyPostAction(postId, 'publishFailed', 'SYSTEM', { summaryExtra: ` (${reasons})` });
      return;
    }
    throw new Error(`Publishing incomplete for ${failed.map((v) => v.platform).join(', ')}; will retry`);
  } finally {
    inFlight.delete(postId);
  }
}

/**
 * Due scheduled posts that have not been attempted yet; the sweep enqueues them in case a
 * delayed job was lost. Posts already mid-retry are left to the queue's backoff.
 */
export async function duePostIds(): Promise<string[]> {
  const posts = await prisma.post.findMany({
    where: { status: 'SCHEDULED', scheduledAt: { lte: new Date() }, variants: { every: { attempts: 0 } } },
    select: { id: true },
  });
  return posts.map((p) => p.id);
}
