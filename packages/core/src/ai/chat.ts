import { config } from '../config';

/**
 * Multi-turn chat with tool calling, for the assistant. generateText() is one prompt in and one
 * answer out; this keeps a conversation and lets the model call Mantis functions between turns.
 * Turns are provider-neutral so the same history can go to OpenAI, Claude, or a local server.
 */

export interface ChatTool {
  name: string;
  description: string;
  /** JSON Schema for the arguments object. */
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export type ChatTurn =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string };

export interface ChatRequest {
  system: string;
  turns: ChatTurn[];
  tools: ChatTool[];
  maxTokens?: number;
}

export interface ChatResult {
  text: string;
  toolCalls: ToolCall[];
  provider: 'openai' | 'anthropic' | 'local';
  model: string;
}

/** True when the configured text provider can hold a conversation and call tools. */
export function assistantCanChat(): boolean {
  return config.AI_TEXT_PROVIDER !== 'mock';
}

export function assistantModelLabel(): string {
  switch (config.AI_TEXT_PROVIDER) {
    case 'openai':
      return `OpenAI ${config.OPENAI_ASSISTANT_MODEL ?? config.OPENAI_TEXT_MODEL}`;
    case 'anthropic':
      return `Claude ${config.ANTHROPIC_ASSISTANT_MODEL ?? config.ANTHROPIC_MODEL}`;
    case 'local':
      return `Local ${config.LOCAL_TEXT_MODEL}`;
    case 'mock':
      return 'Mock (no AI key)';
  }
}

export async function chatWithTools(req: ChatRequest): Promise<ChatResult> {
  switch (config.AI_TEXT_PROVIDER) {
    case 'openai': {
      if (!config.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set');
      return openAiCompatibleToolChat(req, {
        baseUrl: 'https://api.openai.com/v1',
        apiKey: config.OPENAI_API_KEY,
        model: config.OPENAI_ASSISTANT_MODEL ?? config.OPENAI_TEXT_MODEL,
        tokenField: 'max_completion_tokens',
        provider: 'openai',
      });
    }
    case 'anthropic':
      return anthropicToolChat(req);
    case 'local':
      return openAiCompatibleToolChat(req, {
        baseUrl: config.LOCAL_LLM_BASE_URL,
        apiKey: config.LOCAL_LLM_API_KEY,
        model: config.LOCAL_TEXT_MODEL,
        tokenField: 'max_tokens',
        provider: 'local',
        timeoutMs: config.LOCAL_LLM_TIMEOUT_MS,
      });
    case 'mock':
      throw new Error('The assistant needs AI_TEXT_PROVIDER set to openai, anthropic, or local.');
  }
}

// ---------------------------------------------------------------------------
// OpenAI chat completions (also Ollama / vLLM, which speak the same format)
// ---------------------------------------------------------------------------

export function toOpenAiMessages(system: string, turns: ChatTurn[]): Record<string, unknown>[] {
  const messages: Record<string, unknown>[] = [{ role: 'system', content: system }];
  for (const turn of turns) {
    if (turn.role === 'user') messages.push({ role: 'user', content: turn.content });
    else if (turn.role === 'assistant') {
      messages.push({
        role: 'assistant',
        content: turn.content || null,
        ...(turn.toolCalls?.length
          ? { tool_calls: turn.toolCalls.map((call) => ({ id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) } })) }
          : {}),
      });
    } else {
      messages.push({ role: 'tool', tool_call_id: turn.toolCallId, content: turn.content });
    }
  }
  return messages;
}

export function fromOpenAiMessage(message: { content?: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } | undefined): Pick<ChatResult, 'text' | 'toolCalls'> {
  const toolCalls = (message?.tool_calls ?? []).map((call) => ({ id: call.id, name: call.function.name, args: parseArgs(call.function.arguments) }));
  return { text: message?.content ?? '', toolCalls };
}

async function openAiCompatibleToolChat(
  req: ChatRequest,
  opts: { baseUrl: string; apiKey?: string; model: string; tokenField: 'max_tokens' | 'max_completion_tokens'; provider: 'openai' | 'local'; timeoutMs?: number },
): Promise<ChatResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.apiKey) headers.Authorization = `Bearer ${opts.apiKey}`;
  const res = await fetch(`${opts.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers,
    signal: opts.timeoutMs ? AbortSignal.timeout(opts.timeoutMs) : undefined,
    body: JSON.stringify({
      model: opts.model,
      [opts.tokenField]: req.maxTokens ?? 1500,
      messages: toOpenAiMessages(req.system, req.turns),
      ...(req.tools.length
        ? { tools: req.tools.map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } })) }
        : {}),
    }),
  });
  if (!res.ok) throw new Error(`${opts.provider === 'openai' ? 'OpenAI' : 'Local model'} error ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { choices: { message?: Parameters<typeof fromOpenAiMessage>[0] }[] };
  return { ...fromOpenAiMessage(data.choices[0]?.message), provider: opts.provider, model: opts.model };
}

// ---------------------------------------------------------------------------
// Anthropic messages
// ---------------------------------------------------------------------------

type AnthropicBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string };

/** Claude wants every tool result for one assistant step inside a single user message. */
export function toAnthropicMessages(turns: ChatTurn[]): { role: 'user' | 'assistant'; content: AnthropicBlock[] }[] {
  const out: { role: 'user' | 'assistant'; content: AnthropicBlock[] }[] = [];
  for (const turn of turns) {
    if (turn.role === 'user') out.push({ role: 'user', content: [{ type: 'text', text: turn.content }] });
    else if (turn.role === 'assistant') {
      const content: AnthropicBlock[] = [];
      if (turn.content) content.push({ type: 'text', text: turn.content });
      for (const call of turn.toolCalls ?? []) content.push({ type: 'tool_use', id: call.id, name: call.name, input: call.args });
      if (content.length) out.push({ role: 'assistant', content });
    } else {
      const block: AnthropicBlock = { type: 'tool_result', tool_use_id: turn.toolCallId, content: turn.content };
      const last = out[out.length - 1];
      if (last?.role === 'user' && last.content.every((item) => item.type === 'tool_result')) last.content.push(block);
      else out.push({ role: 'user', content: [block] });
    }
  }
  return out;
}

export function fromAnthropicContent(content: { type: string; text?: string; id?: string; name?: string; input?: unknown }[]): Pick<ChatResult, 'text' | 'toolCalls'> {
  const text = content.filter((block) => block.type === 'text').map((block) => block.text ?? '').join('');
  const toolCalls = content
    .filter((block) => block.type === 'tool_use' && block.id && block.name)
    .map((block) => ({ id: block.id!, name: block.name!, args: (block.input as Record<string, unknown>) ?? {} }));
  return { text, toolCalls };
}

async function anthropicToolChat(req: ChatRequest): Promise<ChatResult> {
  if (!config.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
  const model = config.ANTHROPIC_ASSISTANT_MODEL ?? config.ANTHROPIC_MODEL;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': config.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      max_tokens: req.maxTokens ?? 1500,
      system: req.system,
      messages: toAnthropicMessages(req.turns),
      ...(req.tools.length ? { tools: req.tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.parameters })) } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Anthropic error ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { content: Parameters<typeof fromAnthropicContent>[0] };
  return { ...fromAnthropicContent(data.content ?? []), provider: 'anthropic', model };
}

function parseArgs(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
