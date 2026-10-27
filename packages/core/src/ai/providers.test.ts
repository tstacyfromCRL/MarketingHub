import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

function useEnv(values: Record<string, string>) {
  vi.stubEnv('DATABASE_URL', 'postgresql://localhost:5432/postgres');
  vi.stubEnv('JWT_SECRET', 'test-secret-test-secret');
  for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
}

async function loadProviders(values: Record<string, string>) {
  useEnv(values);
  vi.resetModules();
  return import('./providers');
}

type FetchCall = [string, RequestInit];

function sent(mock: { mock: { calls: unknown[] } }, index = 0): FetchCall {
  return (mock.mock.calls as unknown as FetchCall[])[index];
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

const req = { system: 'You write for Carnegie Robotics.', prompt: 'Write a post about autonomy.', mock: () => 'mock draft' };

describe('local provider', () => {
  it('maps a chat call onto the OpenAI-compatible server with max_tokens', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(new AbortController().signal);
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        choices: [{ message: { content: 'Here is the post.\n{"posts":[{"title":"Autonomy"}]}' } }],
        usage: { prompt_tokens: 12, completion_tokens: 8 },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { generateText, generateTextDetailed } = await loadProviders({
      AI_TEXT_PROVIDER: 'local',
      LOCAL_LLM_BASE_URL: 'http://gpu-box:11434/v1/',
      LOCAL_LLM_API_KEY: '',
      LOCAL_TEXT_MODEL: 'qwen2.5:7b',
      LOCAL_LLM_TIMEOUT_MS: '120000',
    });

    const detailed = await generateTextDetailed({ ...req, json: true });
    expect(detailed).toMatchObject({
      text: '{"posts":[{"title":"Autonomy"}]}',
      provider: 'local',
      model: 'qwen2.5:7b',
      usage: { promptTokens: 12, outputTokens: 8 },
    });
    expect(await generateText(req)).toBe('Here is the post.\n{"posts":[{"title":"Autonomy"}]}');
    expect(timeout).toHaveBeenCalledWith(120000);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = sent(fetchMock);
    expect(url).toBe('http://gpu-box:11434/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(init.signal).toBeDefined();
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe('qwen2.5:7b');
    expect(body.max_tokens).toBe(2000);
    expect(body.max_completion_tokens).toBeUndefined();
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages).toEqual([
      { role: 'system', content: req.system },
      { role: 'user', content: [{ type: 'text', text: req.prompt }] },
    ]);
    expect(JSON.parse(String(sent(fetchMock, 1)[1].body)).response_format).toBeUndefined();
  });

  it('sends a bearer token when LOCAL_LLM_API_KEY is set', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ choices: [{ message: { content: 'ok' } }] }));
    vi.stubGlobal('fetch', fetchMock);
    const { generateTextDetailed } = await loadProviders({
      AI_TEXT_PROVIDER: 'local',
      LOCAL_LLM_API_KEY: 'vllm-secret',
      LOCAL_TEXT_MODEL: 'mh-writer:latest',
    });
    await generateTextDetailed(req);
    const init = sent(fetchMock)[1];
    expect(init.headers).toMatchObject({ Authorization: 'Bearer vllm-secret' });
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe('mh-writer:latest');
  });

  it('embeds through /v1/embeddings and rejects a width that is not LOCAL_EMBED_DIMS', async () => {
    const good = vi.fn(async () =>
      jsonResponse({
        data: [
          { index: 1, embedding: Array(768).fill(0.2) },
          { index: 0, embedding: Array(768).fill(0.1) },
        ],
      }),
    );
    vi.stubGlobal('fetch', good);
    const { embedTexts } = await loadProviders({
      AI_EMBED_PROVIDER: 'local',
      LOCAL_LLM_BASE_URL: 'http://gpu-box:11434/v1',
      LOCAL_EMBED_MODEL: 'nomic-embed-text',
      LOCAL_EMBED_DIMS: '768',
    });
    const vectors = await embedTexts(['autonomy', 'lidar']);
    expect(vectors[0][0]).toBe(0.1);
    expect(vectors[1][0]).toBe(0.2);
    const [url, init] = sent(good);
    expect(url).toBe('http://gpu-box:11434/v1/embeddings');
    expect(JSON.parse(String(init.body))).toEqual({ model: 'nomic-embed-text', input: ['autonomy', 'lidar'] });

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ data: [{ embedding: [1, 0, 0], index: 0 }] })));
    await expect(embedTexts(['autonomy'])).rejects.toThrow(/LOCAL_EMBED_DIMS is 768/);
  });

  it('reports whether the configured models are loaded', async () => {
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(new AbortController().signal);
    const fetchMock = vi.fn(async () => jsonResponse({ data: [{ id: 'qwen2.5:7b' }, { id: 'nomic-embed-text:latest' }] }));
    vi.stubGlobal('fetch', fetchMock);
    const { localModelHealth, sameLocalModel } = await loadProviders({
      AI_TEXT_PROVIDER: 'local',
      AI_EMBED_PROVIDER: 'local',
      LOCAL_LLM_BASE_URL: 'http://gpu-box:11434/v1',
      LOCAL_TEXT_MODEL: 'qwen2.5:7b',
      LOCAL_EMBED_MODEL: 'nomic-embed-text',
    });
    expect(sameLocalModel('nomic-embed-text:latest', 'nomic-embed-text')).toBe(true);
    const health = await localModelHealth();
    expect(health.reachable).toBe(true);
    expect(health.textModelReady).toBe(true);
    expect(health.embedModelReady).toBe(true);
    expect(AbortSignal.timeout).toHaveBeenCalledWith(8000);
    expect(sent(fetchMock)[0]).toBe('http://gpu-box:11434/v1/models');
  });
});

describe('cloud and mock providers stay on their own APIs', () => {
  it('keeps mock offline', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { generateText, generateTextDetailed, embedTexts, expectedEmbedDims } = await loadProviders({
      AI_TEXT_PROVIDER: 'mock',
      AI_EMBED_PROVIDER: 'mock',
    });
    expect(await generateText(req)).toBe('mock draft');
    expect(await generateTextDetailed(req)).toMatchObject({ text: 'mock draft', provider: 'mock', model: 'mock' });
    expect((await embedTexts(['lidar sensor'])).every((v) => v.length === 256)).toBe(true);
    expect(expectedEmbedDims()).toBe(256);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends max_completion_tokens to OpenAI and max_tokens to Anthropic', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('anthropic')) {
        return jsonResponse({ content: [{ type: 'text', text: 'Sure {"ideas":[1]}' }], usage: { input_tokens: 3, output_tokens: 2 } });
      }
      return jsonResponse({
        choices: [{ message: { content: 'openai draft' } }],
        usage: { prompt_tokens: 4, completion_tokens: 5 },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const openai = await loadProviders({ AI_TEXT_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-test', OPENAI_TEXT_MODEL: 'gpt-4o' });
    const openResult = await openai.generateTextDetailed(req);
    expect(openResult).toMatchObject({ text: 'openai draft', provider: 'openai', model: 'gpt-4o', usage: { promptTokens: 4, outputTokens: 5 } });
    const [openUrl, openInit] = sent(fetchMock);
    const openBody = JSON.parse(String(openInit.body));
    expect(openUrl).toBe('https://api.openai.com/v1/chat/completions');
    expect(openBody.max_completion_tokens).toBe(2000);
    expect(openBody.max_tokens).toBeUndefined();
    expect(openInit.headers).toMatchObject({ Authorization: 'Bearer sk-test' });

    const anthropic = await loadProviders({ AI_TEXT_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'ant-test', ANTHROPIC_MODEL: 'claude-sonnet-4-5' });
    const antResult = await anthropic.generateTextDetailed({ ...req, json: true });
    expect(antResult).toMatchObject({ text: '{"ideas":[1]}', provider: 'anthropic', model: 'claude-sonnet-4-5', usage: { promptTokens: 3, outputTokens: 2 } });
    const antCalls = fetchMock.mock.calls as unknown as FetchCall[];
    const [antUrl, antInit] = antCalls.at(-1)!;
    expect(antUrl).toBe('https://api.anthropic.com/v1/messages');
    expect(antInit.headers).toMatchObject({ 'x-api-key': 'ant-test' });
    expect(JSON.parse(String(antInit.body)).max_tokens).toBe(2000);
  });

  it('sends image parts as data URLs for a local vision model', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ choices: [{ message: { content: '{"description":"a robot","tags":["robot"]}' } }] }));
    vi.stubGlobal('fetch', fetchMock);
    const { openAiCompatibleChat } = await loadProviders({});
    const png = Buffer.from([1, 2, 3]);
    const result = await openAiCompatibleChat({
      baseUrl: 'http://gpu-box:11434/v1',
      model: 'qwen2.5vl:7b',
      system: 'Tag images.',
      parts: [{ type: 'image', png }, { type: 'text', text: 'describe' }],
      json: true,
      maxTokens: 400,
      tokenField: 'max_tokens',
      timeoutMs: 120000,
      provider: 'local',
      unwrapJson: true,
    });
    expect(result.text).toBe('{"description":"a robot","tags":["robot"]}');
    const body = JSON.parse(String(sent(fetchMock)[1].body));
    expect(body.max_tokens).toBe(400);
    expect(body.messages[1].content[0].type).toBe('image_url');
    expect(body.messages[1].content[0].image_url.url).toBe(`data:image/png;base64,${png.toString('base64')}`);
  });
});
