/** A 60-30-10 recipe written in the brand kit visual identity. */
export interface ColorTheme {
  name: string;
  /** The color that should cover most of the graphic. */
  base: string;
  /** The strong accent. It should not become the large field. */
  accent: string;
  /** The small remainder, used for type. */
  highlight: string;
}

export interface GraphicColors {
  background: string;
  band: string;
  accent: string;
  text: string;
  themeName: string | null;
}

const THEME = /(?:^|\n)\s*([^:\n]{2,80}?):\s*\(60%\)\s*(#[0-9a-fA-F]{6})\s*\(30%\)\s*(#[0-9a-fA-F]{6})\s*\(10%\)\s*(#[0-9a-fA-F]{6})/g;

/** Reads every "Name: (60%) #hex (30%) #hex (10%) #hex" line out of the visual identity. */
export function colorThemes(visualIdentity: string): ColorTheme[] {
  const themes: ColorTheme[] = [];
  for (const match of visualIdentity.matchAll(THEME)) {
    themes.push({
      name: match[1].trim(),
      base: match[2].toLowerCase(),
      accent: match[3].toLowerCase(),
      highlight: match[4].toLowerCase(),
    });
  }
  return themes;
}

/**
 * Colors for the composed graphic. A written theme wins over swatch order, because the first
 * swatch is often the accent and must not be painted across the type field.
 * A product photo uses a theme whose name says "product" when one is written.
 */
export function graphicColors(visualIdentity: string, palette: string[], hasProduct: boolean): GraphicColors {
  const themes = colorThemes(visualIdentity);
  const chosen = (hasProduct && themes.find((theme) => /product/i.test(theme.name))) || themes[0];
  if (chosen) {
    return { background: chosen.base, band: chosen.base, accent: chosen.accent, text: chosen.highlight, themeName: chosen.name };
  }
  const background = palette[0] ?? '#1e293b';
  return { background, band: background, accent: palette[1] ?? '#f59e0b', text: '#ffffff', themeName: null };
}

/**
 * The image request. The visual identity comes first so a scene that asks for a different look
 * does not outrank the brand kit.
 */
export function imageInstruction(input: {
  scene: string;
  visualIdentity: string;
  colors: { name: string; hex: string }[];
  theme: ColorTheme | null;
  styleNote?: string;
}): string {
  const parts: string[] = [];
  const identity = input.visualIdentity.trim();
  if (identity) parts.push(`Follow this visual identity. When it conflicts with the scene, follow the identity.\n${identity}`);
  if (input.theme) {
    parts.push(`Use the "${input.theme.name}" colors: mostly ${input.theme.base}, then ${input.theme.accent}, and a little ${input.theme.highlight}.`);
  }
  const named = input.colors.filter((color) => color.hex);
  if (named.length) parts.push(`Brand colors: ${named.map((color) => `${color.name || 'Color'} ${color.hex}`).join(', ')}.`);
  if (input.styleNote) parts.push(input.styleNote);
  parts.push(`Scene: ${input.scene.trim()}`);
  parts.push('No text, letters, or logos in the image.');
  return parts.join('\n\n');
}
