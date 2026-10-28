export type OutputWarningCode = 'CONFIDENTIAL_TERM' | 'UNSUPPORTED_NUMBER' | 'HASHTAG_COUNT' | 'TOO_LONG' | 'BRAND_DONT' | 'INTERNAL_OMITTED';

export interface OutputWarning {
  code: OutputWarningCode;
  message: string;
}

export interface ValidateInput {
  platform?: string | null;
  playbook?: { hashtagMin?: number | null; hashtagMax?: number | null; maxChars?: number | null } | null;
  /** Character limit from the platform preset, used when the playbook does not set one. */
  maxChars?: number | null;
  facts: string[];
  claims: string[];
  confidentialTerms: { term: string; aliases?: string[] }[];
  donts: string[];
  /** Product names and SKUs. Numbers inside them are not treated as claims. */
  ignoreTexts?: string[];
}

const HASHTAG = /#[\p{L}\p{N}_]+/gu;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Years, calendar dates and list markers are not statistics. */
function stripIgnored(text: string, ignoreTexts: string[]): string {
  let out = text
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ')
    .replace(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g, ' ')
    .replace(/\b(?:19|20)\d{2}\b/g, ' ')
    .replace(/^\s*\d+[.)]\s+/gm, ' ');
  for (const known of ignoreTexts) {
    const trimmed = known.trim();
    if (trimmed.length < 2) continue;
    out = out.replace(new RegExp(escapeRegExp(trimmed), 'gi'), ' ');
  }
  return out;
}

function corpusHasNumber(corpus: string, digits: string): boolean {
  const n = digits.replace(/,/g, '');
  if (!n) return true;
  return new RegExp(`(?<![\\d])${escapeRegExp(n)}(?![\\d])`).test(corpus.replace(/,/g, ''));
}

/**
 * Checks a draft against the knowledge it was allowed to use.
 * Warnings are shown to the writer. They do not stop the draft from being saved.
 */
export function validateOutput(text: string, input: ValidateInput): OutputWarning[] {
  const warnings: OutputWarning[] = [];
  const lower = text.toLowerCase();

  for (const entry of input.confidentialTerms) {
    const names = [entry.term, ...(entry.aliases ?? [])].map((n) => n.trim()).filter(Boolean);
    for (const name of names) {
      const hit = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(name)}(?![\\p{L}\\p{N}])`, 'iu').test(text);
      if (hit) {
        warnings.push({ code: 'CONFIDENTIAL_TERM', message: `Remove the confidential name "${name}".` });
        break;
      }
    }
  }

  const corpus = [...input.facts, ...input.claims].join('\n');
  const scanned = stripIgnored(text, input.ignoreTexts ?? []);
  const seen = new Set<string>();
  const numberPattern = /\$\d[\d,]*(?:\.\d+)?|\b\d+(?:\.\d+)?%|\b\d+(?:\.\d+)?[xX]\b|\b\d[\d,]*(?:\.\d+)?\b/g;
  for (const match of scanned.matchAll(numberPattern)) {
    const raw = match[0];
    const digits = raw.replace(/[$,%xX]/g, '');
    if (seen.has(digits)) continue;
    seen.add(digits);
    if (!corpusHasNumber(corpus, digits)) {
      warnings.push({ code: 'UNSUPPORTED_NUMBER', message: `"${raw}" is not in the approved claims or company knowledge.` });
    }
  }

  const min = input.playbook?.hashtagMin;
  const max = input.playbook?.hashtagMax;
  if (min != null || max != null) {
    const count = text.match(HASHTAG)?.length ?? 0;
    const tooFew = min != null && count < min;
    const tooMany = max != null && count > max;
    if (tooFew || tooMany) {
      const range = min != null && max != null ? `${min}–${max}` : min != null ? `at least ${min}` : `at most ${max}`;
      warnings.push({ code: 'HASHTAG_COUNT', message: `${count} hashtag${count === 1 ? '' : 's'}; this playbook expects ${range}.` });
    }
  }

  const limit = input.playbook?.maxChars ?? input.maxChars;
  if (limit != null && text.length > limit) {
    warnings.push({ code: 'TOO_LONG', message: `${text.length} characters is over the ${limit} character limit.` });
  }

  for (const phrase of input.donts) {
    const trimmed = phrase.trim();
    if (trimmed && lower.includes(trimmed.toLowerCase())) {
      warnings.push({ code: 'BRAND_DONT', message: `This uses "${trimmed}", which the brand says not to.` });
    }
  }

  return warnings;
}
