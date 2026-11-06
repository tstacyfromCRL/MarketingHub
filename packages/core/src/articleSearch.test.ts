import { describe, expect, it } from 'vitest';
import { decodeResultUrl, dueSearchIds, isPublicArticleUrl, isSearchDue, parseSearchResults } from './articleSearch';

const PAGE = `
<div class="result results_links">
  <a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fnews.example.com%2Fstory&amp;rut=1">Robot <b>arm</b> review</a>
  <a class="result__snippet" href="https://duckduckgo.com/">A useful <b>summary</b>.</a>
</div>
<div class="result">
  <a class="result__a" href="https://duckduckgo.com/l/?uddg=http%3A%2F%2F127.0.0.1%2Fsecret">Local admin</a>
</div>
<div class="result">
  <a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fnews.example.com%2Fstory">Same story again</a>
</div>
<div class="result">
  <a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.industry.example%2Ffield-note">Field note</a>
  <a class="result__snippet" href="https://duckduckgo.com/">From the plant floor.</a>
</div>
`;

describe('parseSearchResults', () => {
  it('keeps public articles and drops private or repeated addresses', () => {
    const hits = parseSearchResults(PAGE);
    expect(hits.map((hit) => hit.url)).toEqual(['https://news.example.com/story', 'https://www.industry.example/field-note']);
    expect(hits[0]).toMatchObject({ title: 'Robot arm review', snippet: 'A useful summary.' });
  });

  it('rejects addresses that are not public web pages', () => {
    expect(isPublicArticleUrl('https://news.example.com/a')).toBe(true);
    expect(isPublicArticleUrl('http://127.0.0.1/secret')).toBe(false);
    expect(isPublicArticleUrl('http://192.168.1.5/')).toBe(false);
    expect(isPublicArticleUrl('http://169.254.169.254/latest')).toBe(false);
    expect(isPublicArticleUrl('file:///c/windows')).toBe(false);
    expect(decodeResultUrl('https://duckduckgo.com/l/?uddg=https%3A%2F%2Fnews.example.com%2Fa')).toBe('https://news.example.com/a');
  });
});

describe('isSearchDue', () => {
  const now = new Date('2026-11-06T12:00:00Z');

  it('runs a schedule only after its interval, and never runs a manual search by itself', () => {
    expect(isSearchDue(null, null, now)).toBe(false);
    expect(isSearchDue(1, null, now)).toBe(true);
    expect(isSearchDue(1, new Date('2026-11-06T00:00:00Z'), now)).toBe(false);
    expect(isSearchDue(1, new Date('2026-11-05T11:00:00Z'), now)).toBe(true);
    expect(isSearchDue(7, new Date('2026-11-01T12:00:00Z'), now)).toBe(false);
    expect(isSearchDue(30, new Date('2026-10-01T12:00:00Z'), now)).toBe(true);
    expect(dueSearchIds([
      { id: 'manual', intervalDays: null, lastRunAt: null },
      { id: 'due', intervalDays: 1, lastRunAt: null },
      { id: 'fresh', intervalDays: 7, lastRunAt: now },
    ], now)).toEqual(['due']);
  });
});
