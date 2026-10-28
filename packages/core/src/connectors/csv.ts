import { z } from 'zod';
import type { NormalizedProduct, ProductSourceConnector } from './types';

export const csvConfigSchema = z.object({
  format: z.enum(['csv', 'json']).default('csv'),
  /** The file contents, passed for one sync. Not stored. */
  inlineText: z.string().optional(),
});

/** CSV or JSON product file → the shared product shape. Features are semicolon-separated in CSV. */
export function parseProductFile(text: string, format: 'csv' | 'json'): NormalizedProduct[] {
  if (format === 'json') {
    const rows = z.array(z.record(z.string(), z.unknown())).parse(JSON.parse(text));
    return rows.map((row, i) => fromRecord(row, i));
  }
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const headers = splitCsv(lines[0]).map((h) => h.trim().toLowerCase());
  return lines.slice(1).map((line, i) => {
    const cells = splitCsv(line);
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = cells[index] ?? '';
    });
    return fromRecord(row, i);
  });
}

function fromRecord(row: Record<string, unknown>, index: number): NormalizedProduct {
  const str = (key: string) => String(row[key] ?? row[key.toLowerCase()] ?? '').trim();
  const features = str('features');
  return {
    externalId: str('sku') || str('id') || String(index + 1),
    name: str('name') || `Product ${index + 1}`,
    sku: str('sku'),
    description: str('description'),
    pricing: str('price') || str('pricing'),
    url: str('url'),
    features: features ? features.split(';').map((part) => part.trim()).filter(Boolean) : [],
    active: str('status').toLowerCase() !== 'archived',
  };
}

/** Minimal CSV split that keeps quoted commas inside a cell. */
export function splitCsv(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      cells.push(current);
      current = '';
    } else current += ch;
  }
  cells.push(current);
  return cells;
}

async function* fetchCsv(config: unknown): AsyncIterable<NormalizedProduct> {
  const parsed = csvConfigSchema.parse(config);
  if (!parsed.inlineText) return;
  for (const product of parseProductFile(parsed.inlineText, parsed.format)) yield product;
}

export const csvConnector: ProductSourceConnector = {
  id: 'csv',
  displayName: 'CSV or JSON file',
  secretFields: [],
  configSchema: csvConfigSchema,
  fetchProducts: fetchCsv,
};
