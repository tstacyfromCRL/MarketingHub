import { describe, expect, it } from 'vitest';
import { canSaveSocialDraft, socialDraftTitle } from './socialDraft';

describe('social draft save', () => {
  it('saves from the copy alone, and names the post from the title or the tagline', () => {
    expect(canSaveSocialDraft({ title: 'Expo', tagline: '', body: 'Stop by the booth.', platforms: ['linkedin'] })).toBe(true);
    expect(canSaveSocialDraft({ title: '', tagline: 'See you there', body: 'Stop by the booth.', platforms: ['linkedin'] })).toBe(true);
    expect(canSaveSocialDraft({ title: 'Expo', tagline: 'See you there', body: '   ', platforms: ['linkedin'] })).toBe(false);
    expect(canSaveSocialDraft({ title: 'Expo', tagline: '', body: 'Stop by the booth.', platforms: [] })).toBe(false);
    expect(socialDraftTitle('  Expo  ', 'See you there')).toBe('Expo');
    expect(socialDraftTitle('  ', 'See you there')).toBe('See you there');
    expect(socialDraftTitle(' ', ' ')).toBe('Social post');
  });
});