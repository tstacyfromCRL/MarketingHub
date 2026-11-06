/**
 * Studio social-post fields. Re-Write asks for one of these at a time, and hashtag
 * suggestions stay out of the copy until someone adds them.
 */
export const SOCIAL_DRAFT_FIELDS = ['brief', 'title', 'tagline', 'subTagline', 'body'] as const;
export type SocialDraftField = (typeof SOCIAL_DRAFT_FIELDS)[number];

/** Graphic lines and the internal title stay short. The post copy is not capped here. */
export const SOCIAL_FIELD_WORD_CAP: Partial<Record<SocialDraftField, number>> = {
  brief: 60,
  title: 8,
  tagline: 8,
  subTagline: 14,
};

export function limitWords(text: string, max: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!max || words.length <= max) return words.join(' ');
  return words.slice(0, max).join(' ');
}

/** Turns model output into unique #tags, in the order they were suggested. */
export function normalizeHashtags(values: string[], limit = 8): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const value of values) {
    for (const piece of value.split(/[\s,]+/)) {
      const word = piece.trim().replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, '');
      if (!word) continue;
      const key = word.toLocaleLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      tags.push(`#${word}`);
      if (tags.length >= limit) return tags;
    }
  }
  return tags;
}

/** Adds a hashtag once, at the end of the copy. A tag already there is left as it is. */
export function appendHashtag(body: string, tag: string): string {
  const [normalized] = normalizeHashtags([tag], 1);
  if (!normalized) return body;
  const pattern = new RegExp(`(^|\\s)${normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`, 'i');
  if (pattern.test(body)) return body;
  const trimmed = body.replace(/\s+$/, '');
  return trimmed ? `${trimmed} ${normalized}` : normalized;
}
