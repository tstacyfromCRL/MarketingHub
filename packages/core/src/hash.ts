import { createHash } from 'node:crypto';

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Same content always hashes the same, so an import can skip rows that did not change. */
export function contentHash(value: unknown): string {
  return createHash('sha256').update(stable(value)).digest('hex');
}
