import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractText } from './extractText';

const require = createRequire(import.meta.url);

describe('extractText', () => {
  it('reads an uploaded pdf without opening the parser demo file', async () => {
    const sample = path.join(path.dirname(require.resolve('pdf-parse/package.json')), 'test/data/05-versions-space.pdf');
    const text = await extractText(readFileSync(sample), 'manual.pdf');
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toMatch(/ENOENT/);
  });
});
