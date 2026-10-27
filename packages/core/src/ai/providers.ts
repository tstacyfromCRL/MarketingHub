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

export interface TextUsage {
  promptTokens?: number;
  outputTokens?: number;
}

/** What a provider call produced. Phase 1 logs this; callers that only need the string use generateText(). */
export interface TextResult {
  text: string;
  provider: 'mock' | 'openai' | 'anthropic' | 'local';
  model: string;
  usage?: TextUsage;
}

export interface LocalModelHealth {
  inUse: boolean;
  baseUrl: string;
  textModel: string;
  embedModel: string;
  visionModel: string | null;
  reachable: boolean;
  models: string[];
  textModelReady: boolean;
  embedModelReady: boolean;
  visionModelReady: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

export async function generateText(req: TextRequest): Promise<string> {
  return (await generateTextDetailed(req)).text;
}

export async function generateTextDetailed(req: TextRequest): Promise<TextResult> {
  switch (config.AI_TEXT_PROVIDER) {
    case 'mock':
      return { text: req.mock(), provider: 'mock', model: 'mock' };
    case 'openai':
      return openAiCompatibleChat({
        baseUrl: 'https://api.openai.com/v1',
        apiKey: requiredKey(config.OPENAI_API_KEY, 'OPENAI_API_KEY'),
        model: config.OPENAI_TEXT_MODEL,
        system: req.system,
        parts: [{ type: 'text', text: req.prompt }],
        json: req.json,
        maxTokens: req.maxTokens,
        tokenField: 'max_completion_tokens',
        provider: 'openai',
      });
    case 'anthropic':
      return anthropicMessage(req.system, [{ type: 'text', text: req.prompt }], req.json, req.maxTokens);
    case 'local':
      return openAiCompatibleChat({
        baseUrl: config.LOCAL_LLM_BASE_URL,
        apiKey: config.LOCAL_LLM_API_KEY,
        model: config.LOCAL_TEXT_MODEL,
        system: req.system,
        parts: [{ type: 'text', text: req.prompt }],
        json: req.json,
        maxTokens: req.maxTokens,
        tokenField: 'max_tokens',
        timeoutMs: config.LOCAL_LLM_TIMEOUT_MS,
        provider: 'local',
        unwrapJson: true,
      });
  }
}

type Part = { type: 'text'; text: string } | { type: 'image'; png: Buffer };

interface CompatibleChat {
  baseUrl: string;
  apiKey?: string;
  model: string;
  system: string;
  parts: Part[];
  json?: boolean;
  maxTokens?: number;
  /** Ollama and some other compatible servers reject max_completion_tokens. */
  tokenField: 'max_tokens' | 'max_completion_tokens';
  timeoutMs?: number;
  provider: 'openai' | 'local';
  /** Small local models sometimes wrap a JSON object in prose. */
  unwrapJson?: boolean;
}

export async function openAiCompatibleChat(opts: CompatibleChat): Promise<TextResult> {
  const content = opts.parts.map((p) =>
    p.type === 'text' ? { type: 'text', text: p.text } : { type: 'image_url', image_url: { url: `data:image/png;base64,${p.png.toString('base64')}` } },
  );
  const maxTokens = opts.maxTokens ?? 2000;
  const res = await fetch(endpoint(opts.baseUrl, 'chat/completions'), {
    method: 'POST',
    headers: jsonHeaders(opts.apiKey),
    signal: opts.timeoutMs ? AbortSignal.timeout(opts.timeoutMs) : undefined,
    body: JSON.stringify({
      model: opts.model,
      [opts.tokenField]: maxTokens,
      response_format: opts.json ? { type: 'json_object' } : undefined,
      messages: [
        { role: 'system', content: opts.system },
        { role: 'user', content },
      ],
    }),
  });
  if (!res.ok) throw new Error(`${opts.provider === 'openai' ? 'OpenAI' : 'Local model'} error ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as {
    choices: { message: { content: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const raw = data.choices[0]?.message?.content ?? '';
  return {
    text: opts.json && opts.unwrapJson ? extractJson(raw) : raw,
    provider: opts.provider,
    model: opts.model,
    usage: usageFrom(data.usage?.prompt_tokens, data.usage?.completion_tokens),
  };
}

async function anthropicMessage(system: string, parts: Part[], json = false, maxTokens = 2000): Promise<TextResult> {
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
  const data = (await res.json()) as { content: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } };
  const text = data.content.filter((c) => c.type === 'text').map((c) => c.text).join('');
  return {
    text: json ? extractJson(text) : text,
    provider: 'anthropic',
    model: config.ANTHROPIC_MODEL,
    usage: usageFrom(data.usage?.input_tokens, data.usage?.output_tokens),
  };
}

function usageFrom(prompt?: number, output?: number): TextUsage | undefined {
  if (prompt == null && output == null) return undefined;
  return { promptTokens: prompt, outputTokens: output };
}

function requiredKey(key: string | undefined, name: string): string {
  if (!key) throw new Error(`${name} is not set`);
  return key;
}

function jsonHeaders(apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

/** True when an Ollama id and a configured tag name the same model (`name` and `name:latest`). */
export function sameLocalModel(listed: string, wanted: string): boolean {
  const canonical = (name: string) => name.toLowerCase().replace(/:latest$/, '');
  return canonical(listed) === canonical(wanted);
}

/** GET {LOCAL_LLM_BASE_URL}/models. Skips the network call when no provider is set to local. */
export async function localModelHealth(): Promise<LocalModelHealth> {
  const inUse = config.AI_TEXT_PROVIDER === 'local' || config.AI_EMBED_PROVIDER === 'local' || config.AI_VISION_PROVIDER === 'local';
  const base: LocalModelHealth = {
    inUse,
    baseUrl: config.LOCAL_LLM_BASE_URL,
    textModel: config.LOCAL_TEXT_MODEL,
    embedModel: config.LOCAL_EMBED_MODEL,
    visionModel: config.LOCAL_VISION_MODEL ?? null,
    reachable: false,
    models: [],
    textModelReady: false,
    embedModelReady: false,
    visionModelReady: false,
  };
  if (!inUse) return base;
  try {
    const res = await fetch(endpoint(config.LOCAL_LLM_BASE_URL, 'models'), {
      headers: jsonHeaders(config.LOCAL_LLM_API_KEY),
      signal: AbortSignal.timeout(Math.min(config.LOCAL_LLM_TIMEOUT_MS, 8_000)),
    });
    if (!res.ok) throw new Error(`Local model server returned ${res.status}`);
    const data = (await res.json()) as { data?: { id?: string }[] };
    const models = (data.data ?? []).map((row) => row.id).filter((id): id is string => Boolean(id));
    const listed = (name: string | undefined) => Boolean(name) && models.some((id) => sameLocalModel(id, name!));
    return {
      ...base,
      reachable: true,
      models,
      textModelReady: config.AI_TEXT_PROVIDER !== 'local' || listed(config.LOCAL_TEXT_MODEL),
      embedModelReady: config.AI_EMBED_PROVIDER !== 'local' || listed(config.LOCAL_EMBED_MODEL),
      visionModelReady: config.AI_VISION_PROVIDER !== 'local' || listed(config.LOCAL_VISION_MODEL),
    };
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message : 'Local model server is unreachable' };
  }
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
/** text-embedding-3-small's default width when the request does not pass `dimensions`. */
const OPENAI_EMBED_DIMS = 1536;

export function expectedEmbedDims(): number {
  switch (config.AI_EMBED_PROVIDER) {
    case 'mock':
      return MOCK_DIMS;
    case 'openai':
      return OPENAI_EMBED_DIMS;
    case 'local':
      return config.LOCAL_EMBED_DIMS;
  }
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (config.AI_EMBED_PROVIDER === 'openai') {
    return openAiCompatibleEmbeddings({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: requiredKey(config.OPENAI_API_KEY, 'OPENAI_API_KEY'),
      model: config.OPENAI_EMBED_MODEL,
      input: texts,
      label: 'OpenAI',
    });
  }
  if (config.AI_EMBED_PROVIDER === 'local') {
    const vectors = await openAiCompatibleEmbeddings({
      baseUrl: config.LOCAL_LLM_BASE_URL,
      apiKey: config.LOCAL_LLM_API_KEY,
      model: config.LOCAL_EMBED_MODEL,
      input: texts,
      timeoutMs: config.LOCAL_LLM_TIMEOUT_MS,
      label: 'Local model',
    });
    const width = vectors.find((v) => v.length !== config.LOCAL_EMBED_DIMS);
    if (width) throw new Error(`Local embedding model returned ${width.length} dimensions, but LOCAL_EMBED_DIMS is ${config.LOCAL_EMBED_DIMS}`);
    return vectors;
  }
  return texts.map(hashEmbed);
}

async function openAiCompatibleEmbeddings(opts: {
  baseUrl: string;
  apiKey?: string;
  model: string;
  input: string[];
  timeoutMs?: number;
  label: string;
}): Promise<number[][]> {
  const res = await fetch(endpoint(opts.baseUrl, 'embeddings'), {
    method: 'POST',
    headers: jsonHeaders(opts.apiKey),
    signal: opts.timeoutMs ? AbortSignal.timeout(opts.timeoutMs) : undefined,
    body: JSON.stringify({ model: opts.model, input: opts.input }),
  });
  if (!res.ok) throw new Error(`${opts.label} embeddings error ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { data: { embedding: number[]; index?: number }[] };
  return data.data.slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map((d) => d.embedding);
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
  const parsed = parseJson<Partial<VisionResult>>((await visionText(system, parts)).text);
  return { description: String(parsed.description ?? ''), tags: (parsed.tags ?? []).map(String).slice(0, 12) };
}

function visionText(system: string, parts: Part[]): Promise<TextResult> {
  switch (config.AI_VISION_PROVIDER) {
    case 'mock':
      throw new Error('Vision provider is mock');
    case 'openai':
      return openAiCompatibleChat({
        baseUrl: 'https://api.openai.com/v1',
        apiKey: requiredKey(config.OPENAI_API_KEY, 'OPENAI_API_KEY'),
        model: config.OPENAI_TEXT_MODEL,
        system,
        parts,
        json: true,
        maxTokens: 400,
        tokenField: 'max_completion_tokens',
        provider: 'openai',
      });
    case 'anthropic':
      return anthropicMessage(system, parts, true, 400);
    case 'local':
      if (!config.LOCAL_VISION_MODEL) throw new Error('LOCAL_VISION_MODEL is not set');
      return openAiCompatibleChat({
        baseUrl: config.LOCAL_LLM_BASE_URL,
        apiKey: config.LOCAL_LLM_API_KEY,
        model: config.LOCAL_VISION_MODEL,
        system,
        parts,
        json: true,
        maxTokens: 400,
        tokenField: 'max_tokens',
        timeoutMs: config.LOCAL_LLM_TIMEOUT_MS,
        provider: 'local',
        unwrapJson: true,
      });
  }
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
