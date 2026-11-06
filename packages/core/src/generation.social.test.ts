import { describe, expect, it } from 'vitest';
import { generateSocialDraftSchema, rewriteSocialFieldSchema, suggestHashtagsSchema } from '@mh/shared';

describe('social draft request', () => {
  it('accepts a brief and optional products for the studio flow', () => {
    expect(generateSocialDraftSchema.parse({ brief: 'Spring Expo booth' })).toEqual({
      brief: 'Spring Expo booth',
      productIds: [],
    });
    expect(generateSocialDraftSchema.parse({
      brief: 'Launch X200',
      platform: 'linkedin',
      productIds: ['prod-1'],
    })).toMatchObject({ platform: 'linkedin', productIds: ['prod-1'] });
  });

  it('asks to rewrite one field and to suggest hashtags from the current draft', () => {
    expect(rewriteSocialFieldSchema.parse({ field: 'tagline', brief: 'Spring Expo booth' })).toMatchObject({
      field: 'tagline',
      brief: 'Spring Expo booth',
      title: '',
      body: '',
      productIds: [],
    });
    expect(suggestHashtagsSchema.parse({
      brief: 'Spring Expo booth',
      body: 'Stop by the booth.',
      platform: 'instagram',
    })).toMatchObject({ body: 'Stop by the booth.', platform: 'instagram' });
  });
});
