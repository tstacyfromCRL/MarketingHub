import { describe, expect, it } from 'vitest';
import { appendHashtag, limitWords, normalizeHashtags } from './socialCopy';

describe('social copy helpers', () => {
  it('keeps a tagline to a few words and leaves a short line alone', () => {
    expect(limitWords('  See   the new X200 at the booth today  ', 8)).toBe('See the new X200 at the booth today');
    expect(limitWords('Stop by', 8)).toBe('Stop by');
  });

  it('normalizes hashtag suggestions and drops repeats', () => {
    expect(normalizeHashtags(['expo', '#Expo', 'spring expo!', '#Robotics'], 8)).toEqual(['#expo', '#spring', '#Robotics']);
  });

  it('adds a hashtag to the copy once', () => {
    expect(appendHashtag('Stop by the booth.', 'expo')).toBe('Stop by the booth. #expo');
    expect(appendHashtag('Stop by the booth. #Expo', '#expo')).toBe('Stop by the booth. #Expo');
    expect(appendHashtag('', '#Robotics')).toBe('#Robotics');
  });
});