import { describe, expect, it, vi } from 'vitest';
import type { ChatRequest, ChatResult, ToolCall } from './ai/chat';
import { runAssistantLoop, transcriptTurns } from './assistantLoop';

const tool = { name: 'create_task', description: 'Make a task', parameters: { type: 'object', properties: {} } };

/** A model that replies with the next scripted answer each time it is asked. */
function scripted(replies: Partial<ChatResult>[]) {
  const requests: ChatRequest[] = [];
  const chat = vi.fn(async (req: ChatRequest): Promise<ChatResult> => {
    requests.push(JSON.parse(JSON.stringify(req)) as ChatRequest);
    const next = replies.shift() ?? { text: '', toolCalls: [] };
    return { text: '', toolCalls: [], provider: 'openai', model: 'test', ...next };
  });
  return { chat, requests };
}

const call = (name: string, args: Record<string, unknown> = {}, id = `call-${name}`): ToolCall => ({ id, name, args });

describe('runAssistantLoop', () => {
  it('returns the model text when it answers without calling a tool', async () => {
    const { chat } = scripted([{ text: 'Happy to help.' }]);
    const execute = vi.fn();
    const result = await runAssistantLoop({ system: 'sys', turns: [{ role: 'user', content: 'hi' }], tools: [tool], chat, execute });
    expect(result).toEqual({ text: 'Happy to help.', actions: [], toolNames: [] });
    expect(execute).not.toHaveBeenCalled();
  });

  it('runs a tool, sends its result back to the model, and then answers', async () => {
    const { chat, requests } = scripted([
      { text: '', toolCalls: [call('create_task', { title: 'Footage' })] },
      { text: 'Created it.' },
    ]);
    const execute = vi.fn(async () => ({ result: { ok: true, id: 't1' }, action: { kind: 'task' as const, label: 'Task: Footage', link: '/tasks/t1' } }));
    const result = await runAssistantLoop({ system: 'sys', turns: [{ role: 'user', content: 'make a task' }], tools: [tool], chat, execute });

    expect(execute).toHaveBeenCalledWith(call('create_task', { title: 'Footage' }));
    expect(result.text).toBe('Created it.');
    expect(result.toolNames).toEqual(['create_task']);
    expect(result.actions).toEqual([{ kind: 'task', label: 'Task: Footage', link: '/tasks/t1' }]);
    // The second request must carry the tool result so the model can see the id it created.
    const followUp = requests[1]!.turns;
    expect(followUp.at(-1)).toEqual({ role: 'tool', toolCallId: 'call-create_task', name: 'create_task', content: '{"ok":true,"id":"t1"}' });
  });

  it('rejects a tool name that is not in the list and does not execute it', async () => {
    const { chat, requests } = scripted([
      { text: '', toolCalls: [call('approve_post')] },
      { text: 'I cannot do that.' },
    ]);
    const execute = vi.fn();
    const result = await runAssistantLoop({ system: 'sys', turns: [{ role: 'user', content: 'approve it' }], tools: [tool], chat, execute });

    expect(execute).not.toHaveBeenCalled();
    expect(requests[1]!.turns.at(-1)).toMatchObject({ role: 'tool', content: JSON.stringify({ ok: false, error: 'There is no tool named approve_post.' }) });
    expect(result.text).toBe('I cannot do that.');
  });

  it('reports a thrown tool error to the model instead of ending the chat', async () => {
    const { chat, requests } = scripted([
      { text: '', toolCalls: [call('create_task', { title: 'x' })] },
      { text: 'Who should it go to?' },
    ]);
    const execute = vi.fn(async () => { throw new Error('Nobody named "Pat" is on the team.'); });
    const result = await runAssistantLoop({ system: 'sys', turns: [{ role: 'user', content: 'task for Pat' }], tools: [tool], chat, execute });

    expect(requests[1]!.turns.at(-1)).toMatchObject({ role: 'tool', content: JSON.stringify({ ok: false, error: 'Nobody named "Pat" is on the team.' }) });
    expect(result.text).toBe('Who should it go to?');
  });

  it('stops after the round limit instead of looping forever', async () => {
    const forever = () => ({ text: '', toolCalls: [call('list_team', {}, `c${Math.random()}`)] });
    const { chat } = scripted([forever(), forever(), forever(), forever()]);
    const execute = vi.fn(async () => ({ result: [] }));
    const result = await runAssistantLoop({ system: 'sys', turns: [], tools: [{ ...tool, name: 'list_team' }], chat, execute, maxRounds: 3 });

    expect(chat).toHaveBeenCalledTimes(3);
    expect(result.text).toMatch(/stopped before finishing/);
    expect(result.toolNames).toHaveLength(3);
  });

  it('keeps one action per link when the same task is touched twice', async () => {
    const link = { kind: 'task' as const, label: 'Task: Footage', link: '/tasks/t1' };
    const { chat } = scripted([
      { text: '', toolCalls: [call('create_task', {}, 'a'), call('update_task', {}, 'b')] },
      { text: 'Done.' },
    ]);
    const execute = vi.fn(async () => ({ result: { ok: true }, action: link }));
    const result = await runAssistantLoop({ system: 'sys', turns: [], tools: [tool, { ...tool, name: 'update_task' }], chat, execute });
    expect(result.actions).toEqual([link]);
  });
});

describe('transcriptTurns', () => {
  it('keeps user lines and assistant lines in order', () => {
    const turns = transcriptTurns([
      { role: 'user', content: 'Make a task for Tony' },
      { role: 'assistant', content: 'Done.' },
    ]);
    expect(turns).toEqual([
      { role: 'user', content: 'Make a task for Tony' },
      { role: 'assistant', content: 'Done.' },
    ]);
  });

  it('adds the links and ids from earlier actions so follow-ups can refer to them', () => {
    const turns = transcriptTurns([
      { role: 'user', content: 'Make a task for Tony' },
      { role: 'assistant', content: 'Created it.', actions: [{ kind: 'task', label: 'Task: Footage', link: '/tasks/t1' }] },
      { role: 'user', content: 'Move that to Friday' },
    ]);
    expect(turns[1]).toEqual({ role: 'assistant', content: 'Created it.\n\n[Done in Mantis: Task: Footage (/tasks/t1)]' });
    expect(turns[2]).toEqual({ role: 'user', content: 'Move that to Friday' });
  });

  it('treats a missing or malformed actions field as no actions', () => {
    const turns = transcriptTurns([{ role: 'assistant', content: 'Hello', actions: 'oops' }]);
    expect(turns).toEqual([{ role: 'assistant', content: 'Hello' }]);
  });
});
