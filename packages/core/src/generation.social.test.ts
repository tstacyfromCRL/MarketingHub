import { describe, expect, it } from 'vitest';
import { generateSocialDraftSchema } from '@mh/shared';

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
});
