import { z } from 'zod';

export const COLOR_TIERS = ['PRIMARY', 'SECONDARY', 'TERTIARY'] as const;
export type ColorTier = (typeof COLOR_TIERS)[number];
export const COLOR_TIER_LABELS: Record<ColorTier, string> = { PRIMARY: 'Primary', SECONDARY: 'Secondary', TERTIARY: 'Tertiary' };
export const MAX_COLORS_PER_TIER = 20;

export const COLOR_FORMATS = ['HEX', 'RGB', 'CMYK', 'PANTONE'] as const;
export type ColorFormat = (typeof COLOR_FORMATS)[number];

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/**
 * A brand color as the user entered it (`format`/`value`) plus the screen hex the app uses.
 * Colors saved before tiers existed only have `name` and `hex`, so the rest have defaults.
 */
export const brandColorSchema = z.object({
  name: z.string().default(''),
  hex: hexColor,
  tier: z.enum(COLOR_TIERS).default('PRIMARY'),
  format: z.enum(COLOR_FORMATS).default('HEX'),
  value: z.string().default(''),
});
export type BrandColor = z.infer<typeof brandColorSchema>;

export const brandColorsSchema = z
  .array(brandColorSchema)
  .default([])
  .refine((colors) => COLOR_TIERS.every((t) => colors.filter((c) => c.tier === t).length <= MAX_COLORS_PER_TIER), {
    message: `Up to ${MAX_COLORS_PER_TIER} colors per tier`,
  });

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const hex2 = (n: number) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0');
const numbers = (value: string) => (value.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);

/**
 * Screen hex for a color typed as hex ("#1a2b3c", "1A2B3C", "#abc"), RGB ("26, 43, 60" or "rgb(26 43 60)")
 * or CMYK percentages ("100, 50, 0, 10"). Returns null if the value can't be read.
 * Pantone has no free official conversion table, so it always returns null.
 */
export function toHex(format: ColorFormat, value: string): string | null {
  const v = value.trim();
  switch (format) {
    case 'HEX': {
      const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
      if (!m) return null;
      const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
      return `#${h.toLowerCase()}`;
    }
    case 'RGB': {
      const n = numbers(v);
      if (n.length !== 3 || n.some((x) => x < 0 || x > 255)) return null;
      return `#${n.map(hex2).join('')}`;
    }
    case 'CMYK': {
      const n = numbers(v);
      if (n.length !== 4 || n.some((x) => x < 0 || x > 100)) return null;
      const [c, m, y, k] = n.map((x) => x / 100);
      return `#${[c, m, y].map((x) => hex2(255 * (1 - x) * (1 - k))).join('')}`;
    }
    case 'PANTONE':
      return null;
  }
}

/** Palette in priority order (primary first), as used for designs and image prompts. */
export function paletteInOrder(colors: BrandColor[]): string[] {
  return COLOR_TIERS.flatMap((t) => colors.filter((c) => (c.tier ?? 'PRIMARY') === t).map((c) => c.hex));
}
