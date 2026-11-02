import { describe, expect, it } from 'vitest';
import { graphicColors, imageInstruction } from './visualIdentity';

const identity = [
  'Matte, not glossy. Real products, not 3D renders.',
  'Dark Theme, Patriot: (60%) #1C222E (30%) #A42131 (10%) #E4E4E4',
  'Dark Theme, Product Focus: (60%) #171717 (30%) #A42131 (10%) #E4E4E4',
  'Light Theme, Patriot: (60%) #E4E4E4 (30%) #1C222E (10%) #171717',
].join('\n');

describe('graphic colors from a visual identity', () => {
  it('uses the first theme so the large field is the 60% color and red stays the accent', () => {
    expect(graphicColors(identity, ['#a42131', '#e4e4e4'], false)).toEqual({
      background: '#1c222e',
      band: '#1c222e',
      accent: '#a42131',
      text: '#e4e4e4',
      themeName: 'Dark Theme, Patriot',
    });
  });

  it('uses the product theme when the graphic includes a product photo', () => {
    expect(graphicColors(identity, ['#a42131'], true).themeName).toBe('Dark Theme, Product Focus');
    expect(graphicColors(identity, ['#a42131'], true).band).toBe('#171717');
  });

  it('falls back to the palette when the identity names no color theme', () => {
    expect(graphicColors('Clean photography.', ['#111111', '#222222'], false)).toEqual({
      background: '#111111',
      band: '#111111',
      accent: '#222222',
      text: '#ffffff',
      themeName: null,
    });
  });
});

describe('image instruction', () => {
  it('puts the visual identity ahead of the scene and names the theme colors', () => {
    const prompt = imageInstruction({
      scene: 'a glossy 3D render of a robot',
      visualIdentity: identity,
      colors: [{ name: 'CR Red', hex: '#a42131' }],
      theme: { name: 'Dark Theme, Patriot', base: '#1c222e', accent: '#a42131', highlight: '#e4e4e4' },
    });
    expect(prompt.indexOf('Follow this visual identity')).toBeLessThan(prompt.indexOf('Scene:'));
    expect(prompt).toContain('Matte, not glossy');
    expect(prompt).toContain('mostly #1c222e, then #a42131, and a little #e4e4e4');
    expect(prompt).toContain('CR Red #a42131');
    expect(prompt).toContain('Scene: a glossy 3D render of a robot');
  });
});
