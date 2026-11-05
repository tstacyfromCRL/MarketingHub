import type { ChatRequest, ChatResult, ChatTool, ChatTurn, ToolCall } from './ai/chat';

/** Something the assistant made or changed, shown under its reply as a link. */
export interface AssistantAction {
  kind: 'task' | 'post' | 'link';
  label: string;
  link: string;
}

/** What one tool call returned: data for the model, and optionally a link for the person. */
export interface ToolOutcome {
  result: unknown;
  action?: AssistantAction;
}

export interface AssistantLoopResult {
  text: string;
  actions: AssistantAction[];
  /** The tool calls made this turn, so the transcript can remember ids the model looked up. */
  toolNames: string[];
}

const STOPPED = 'I took several steps and stopped before finishing. Tell me what you want next and I will pick up from here.';

/**
 * One assistant turn: ask the model, run any tools it calls, feed the results back, and repeat until
 * it answers in words. The model never touches the database. It can only call tools in `tools`,
 * and each one checks permissions itself.
 */
export async function runAssistantLoop(opts: {
  system: string;
  turns: ChatTurn[];
  tools: ChatTool[];
  chat: (req: ChatRequest) => Promise<ChatResult>;
  execute: (call: ToolCall) => Promise<ToolOutcome>;
  maxRounds?: number;
}): Promise<AssistantLoopResult> {
  const turns = [...opts.turns];
  const allowed = new Set(opts.tools.map((tool) => tool.name));
  const actions = new Map<string, AssistantAction>();
  const toolNames: string[] = [];
  const maxRounds = opts.maxRounds ?? 6;

  for (let round = 0; round < maxRounds; round++) {
    const reply = await opts.chat({ system: opts.system, turns, tools: opts.tools });
    if (!reply.toolCalls.length) {
      const text = reply.text.trim() || (actions.size ? 'Done.' : 'I did not have anything to add. What would you like to do?');
      return { text, actions: [...actions.values()], toolNames };
    }
    turns.push({ role: 'assistant', content: reply.text, toolCalls: reply.toolCalls });
    for (const call of reply.toolCalls) {
      toolNames.push(call.name);
      let outcome: ToolOutcome;
      if (!allowed.has(call.name)) {
        outcome = { result: { ok: false, error: `There is no tool named ${call.name}.` } };
      } else {
        try {
          outcome = await opts.execute(call);
        } catch (err) {
          // A failed tool is reported to the model so it can explain or ask, instead of ending the chat.
          outcome = { result: { ok: false, error: (err as Error).message || 'That did not go through.' } };
        }
      }
      if (outcome.action) actions.set(outcome.action.link, outcome.action);
      turns.push({ role: 'tool', toolCallId: call.id, name: call.name, content: JSON.stringify(outcome.result ?? null) });
    }
  }
  return { text: STOPPED, actions: [...actions.values()], toolNames };
}

/**
 * Earlier replies are replayed as plain text. Links the assistant produced are appended with their
 * ids, so "move that task to Friday" still resolves after the tool calls themselves are gone.
 */
export function transcriptTurns(messages: { role: string; content: string; actions?: unknown }[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  for (const message of messages) {
    if (message.role === 'user') {
      turns.push({ role: 'user', content: message.content });
      continue;
    }
    const actions = Array.isArray(message.actions) ? (message.actions as AssistantAction[]) : [];
    const refs = actions.map((action) => `${action.label} (${action.link})`).join('; ');
    turns.push({ role: 'assistant', content: refs ? `${message.content}\n\n[Done in Mantis: ${refs}]` : message.content });
  }
  return turns;
}
