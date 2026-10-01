import sharp from 'sharp';
import crypto from 'node:crypto';
import { config } from '../config';

export interface TextRequest {
  system: string;
  prompt: string;
  /** Ask the model for a JSON object response. */
  json?: boolean;
  maxTokens?: number;
  /** Deterministic output used by the mock provider (dev without API keys). */
  mock: () => string;
}

export interface VisionResult {
  description: string;
  tags: string[];
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

export async function generateText(req: TextRequest): Promise<string> {
  switch (config.AI_TEXT_PROVIDER) {
    case 'mock':
      return req.mock();
    case 'openai':
      return openAiChat(req.system, [{ type: 'text', text: req.prompt }], req.json, req.maxTokens);
    case 'anthropic':
      return anthropicMessage(req.system, [{ type: 'text', text: req.prompt }], req.json, req.maxTokens);
  }
}

type Part = { type: 'text'; text: string } | { type: 'image'; png: Buffer };

async function openAiChat(system: string, parts: Part[], json = false, maxTokens = 2000): Promise<string> {
  if (!config.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set');
  const content = parts.map((p) =>
    p.type === 'text' ? { type: 'text', text: p.text } : { type: 'image_url', image_url: { url: `data:image/png;base64,${p.png.toString('base64')}` } },
  );
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.OPENAI_TEXT_MODEL,
      max_completion_tokens: maxTokens,
      response_format: json ? { type: 'json_object' } : undefined,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  return data.choices[0].message.content;
}

async function anthropicMessage(system: string, parts: Part[], json = false, maxTokens = 2000): Promise<string> {
  if (!config.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
  const content = parts.map((p) =>
    p.type === 'text'
      ? { type: 'text', text: p.text }
      : { type: 'image', source: { type: 'base64', media_type: 'image/png', data: p.png.toString('base64') } },
  );
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': config.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.ANTHROPIC_MODEL,
      max_tokens: maxTokens,
      system: json ? `${system}\n\nRespond with a single valid JSON object and nothing else.` : system,
      messages: [{ role: 'user', content }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic error ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { content: { type: string; text?: string }[] };
  const text = data.content.filter((c) => c.type === 'text').map((c) => c.text).join('');
  return json ? extractJson(text) : text;
}

/** Pulls the first {...} block out of a model response. */
export function extractJson(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
}

export function parseJson<T>(text: string): T {
  return JSON.parse(extractJson(text)) as T;
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

/** Generates an image and crops it to exactly width x height. */
export async function generateImage(prompt: string, width: number, height: number, palette: string[] = []): Promise<Buffer> {
  let raw: Buffer;
  if (config.AI_IMAGE_PROVIDER === 'openai') {
    if (!config.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set');
    const ratio = width / height;
    const size = ratio > 1.2 ? '1536x1024' : ratio < 0.83 ? '1024x1536' : '1024x1024';
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: config.OPENAI_IMAGE_MODEL, prompt, size, n: 1 }),
    });
    if (!res.ok) throw new Error(`OpenAI image error ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { data: { b64_json?: string; url?: string }[] };
    const item = data.data[0];
    raw = item.b64_json ? Buffer.from(item.b64_json, 'base64') : Buffer.from(await (await fetch(item.url!)).arrayBuffer());
  } else {
    raw = await mockImage(prompt, width, height, palette);
  }
  return sharp(raw).resize(width, height, { fit: 'cover' }).png().toBuffer();
}

async function mockImage(prompt: string, width: number, height: number, palette: string[]): Promise<Buffer> {
  const h = crypto.createHash('md5').update(prompt).digest();
  const c1 = palette[0] ?? `#${h.subarray(0, 3).toString('hex')}`;
  const c2 = palette[1] ?? `#${h.subarray(3, 6).toString('hex')}`;
  const circles = Array.from({ length: 6 }, (_, i) => {
    const cx = (h[i + 6] / 255) * width;
    const cy = (h[i + 7] / 255) * height;
    const r = ((h[i + 8] / 255) * 0.3 + 0.1) * Math.max(width, height);
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#ffffff" opacity="0.08"/>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>${circles}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

// ---------------------------------------------------------------------------
// Text embeddings
// ---------------------------------------------------------------------------

const MOCK_DIMS = 256;

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (config.AI_EMBED_PROVIDER === 'openai') {
    if (!config.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set');
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: config.OPENAI_EMBED_MODEL, input: texts }),
    });
    if (!res.ok) throw new Error(`OpenAI embeddings error ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { data: { embedding: number[] }[] };
    return data.data.map((d) => d.embedding);
  }
  return texts.map(hashEmbed);
}

/** Hashing-trick bag of words; lets retrieval work offline with keyword-level similarity. */
function hashEmbed(text: string): number[] {
  const v = new Array<number>(MOCK_DIMS).fill(0);
  const words = text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];
  for (const w of words) {
    const h = crypto.createHash('md5').update(w).digest();
    v[h.readUInt16LE(0) % MOCK_DIMS] += h[2] & 1 ? 1 : -1;
  }
  return normalize(v);
}

export function normalize(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / n);
}

// ---------------------------------------------------------------------------
// Vision (asset tagging)
// ---------------------------------------------------------------------------

const VISION_PROMPT = (hint: string) =>
  `Describe this marketing asset in one sentence, then list up to 12 short lowercase tags (objects, setting, colors, style, people, product type). ` +
  `File path for context: "${hint}". Respond as JSON: {"description": string, "tags": string[]}`;

export async function describeImage(png: Buffer, pathHint: string): Promise<VisionResult> {
  if (config.AI_VISION_PROVIDER === 'mock') return mockVision(png, pathHint);
  const system = 'You tag images for a marketing team asset library.';
  const parts: Part[] = [{ type: 'image', png }, { type: 'text', text: VISION_PROMPT(pathHint) }];
  const text =
    config.AI_VISION_PROVIDER === 'openai' ? await openAiChat(system, parts, true, 400) : await anthropicMessage(system, parts, true, 400);
  const parsed = parseJson<Partial<VisionResult>>(text);
  return { description: String(parsed.description ?? ''), tags: (parsed.tags ?? []).map(String).slice(0, 12) };
}

async function mockVision(png: Buffer, pathHint: string): Promise<VisionResult> {
  const { dominant, isOpaque } = await sharp(png).stats();
  const meta = await sharp(png).metadata();
  const orientation = (meta.width ?? 1) >= (meta.height ?? 1) ? 'landscape' : 'portrait';
  const color = nearestColorName(dominant.r, dominant.g, dominant.b);
  const pathTags = pathHint
    .toLowerCase()
    .split(/[\\/._\-\s]+/)
    .filter((w) => w.length > 2 && !/^\d+$/.test(w) && !['jpg', 'jpeg', 'png', 'mp4', 'mov', 'tif', 'tiff', 'webp'].includes(w));
  const tags = [...new Set([...pathTags, orientation, color, isOpaque ? 'photo' : 'transparent'])].slice(0, 12);
  return { description: `${orientation} image, mostly ${color}`, tags };
}

function nearestColorName(r: number, g: number, b: number): string {
  const names: [string, number, number, number][] = [
    ['black', 0, 0, 0], ['white', 255, 255, 255], ['gray', 128, 128, 128], ['red', 220, 40, 40], ['orange', 240, 140, 30],
    ['yellow', 240, 220, 40], ['green', 50, 170, 70], ['blue', 40, 90, 220], ['purple', 140, 60, 180], ['pink', 240, 120, 180], ['brown', 130, 80, 40],
  ];
  let best = names[0];
  let bestD = Infinity;
  for (const n of names) {
    const d = (n[1] - r) ** 2 + (n[2] - g) ** 2 + (n[3] - b) ** 2;
    if (d < bestD) {
      bestD = d;
      best = n;
    }
  }
  return best[0];
}
