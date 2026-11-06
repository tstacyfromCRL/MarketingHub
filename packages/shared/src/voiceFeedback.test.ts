import { describe, expect, it } from 'vitest';
import { rephraseSchema, voiceFeedbackSchema } from './api';
import { replaceRange, voiceGuidance } from './voiceFeedback';

describe('selected passage and voice notes', () => {
  it('replaces only the selected passage', () => {
    expect(replaceRange('Keep this. Change me. Keep that.', 11, 21, 'Rewrite me.')).toBe('Keep this. Rewrite me. Keep that.');
    expect(replaceRange('Hello', 5, 9, '!')).toBe('Hello!');
  });

  it('turns likes and dislikes into guidance, and stays quiet when there are none', () => {
    expect(voiceGuidance([])).toBe('');
    const text = voiceGuidance([
      { rating: 'up', field: 'social.tagline', text: 'See the X200', note: 'Short and specific' },
      { rating: 'down', field: 'social.body', text: 'Amazing deal!!!', note: 'Too salesy' },
    ]);
    expect(text).toMatch(/Liked/);
    expect(text).toMatch(/See the X200/);
    expect(text).toMatch(/Short and specific/);
    expect(text).toMatch(/Disliked/);
    expect(text).toMatch(/Too salesy/);
  });

  it('accepts a passage to rephrase and a thumb with an optional note', () => {
    expect(rephraseSchema.parse({ text: 'Stop by the booth.', field: 'social.body' })).toMatchObject({ field: 'social.body' });
    expect(voiceFeedbackSchema.parse({ field: 'content.body', text: 'Hello', rating: 'down', note: 'Too vague' })).toMatchObject({
      rating: 'down',
      note: 'Too vague',
    });
    expect(voiceFeedbackSchema.parse({ field: 'social.tagline', text: 'See you there', rating: 'up' }).note).toBe('');
  });
});