import { describe, expect, it } from 'vitest';
import { validateOutput } from './validate';

const base = {
  playbook: { hashtagMin: 2, hashtagMax: 4, maxChars: 80 },
  facts: ['Product Row Scout: photographs crop rows. SKU ACME-ROW-1.'],
  claims: ['In a 2025 demo, Row Scout covered 40 rows in one afternoon.'],
  confidentialTerms: [{ term: 'Northwind Grain', aliases: ['Northwind'] }],
  donts: ['game-changing'],
  ignoreTexts: ['Row Scout', 'ACME-ROW-1'],
};

describe('validateOutput', () => {
  it('flags a secret name, an unsupported number, too many hashtags, and a brand dont', () => {
    const text = 'Northwind saw a game-changing 12x jump. #One #Two #Three #Four #Five';
    const codes = validateOutput(text, base).map((w) => w.code);
    expect(codes).toContain('CONFIDENTIAL_TERM');
    expect(codes).toContain('UNSUPPORTED_NUMBER');
    expect(codes).toContain('HASHTAG_COUNT');
    expect(codes).toContain('BRAND_DONT');
  });

  it('allows years, dates, SKUs, and numbers that appear in claims', () => {
    const text = 'On 2025-09-01 Row Scout (ACME-ROW-1) covered 40 rows. #Field #Notes';
    const codes = validateOutput(text, { ...base, playbook: { hashtagMin: 2, hashtagMax: 4, maxChars: 200 } }).map((w) => w.code);
    expect(codes).not.toContain('UNSUPPORTED_NUMBER');
    expect(codes).not.toContain('CONFIDENTIAL_TERM');
    expect(codes).not.toContain('HASHTAG_COUNT');
  });

  it('flags copy that is over the limit', () => {
    const warnings = validateOutput('x'.repeat(90), { ...base, confidentialTerms: [], donts: [] });
    expect(warnings.map((w) => w.code)).toContain('TOO_LONG');
  });
});
