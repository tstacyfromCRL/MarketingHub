import { describe, expect, it } from 'vitest';
import { appendArticleLink } from './articleLink';

describe('appendArticleLink', () => {
  it('adds the title and address, and does not add the same address twice', () => {
    expect(appendArticleLink('', 'Field note', 'https://news.example.com/a')).toBe('Field note: https://news.example.com/a');
    const once = appendArticleLink('The launch is next week.', 'Field note', 'https://news.example.com/a');
    expect(once).toBe('The launch is next week.\n\nField note: https://news.example.com/a');
    expect(appendArticleLink(once, 'Field note', 'https://news.example.com/a')).toBe(once);
  });
});
