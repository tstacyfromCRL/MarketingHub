import { describe, expect, it } from 'vitest';
import { fromAnthropicContent, fromOpenAiMessage, toAnthropicMessages, toOpenAiMessages, type ChatTurn } from './chat';

describe('OpenAI message mapping', () => {
  it('puts the system prompt first and keeps the conversation order', () => {
    const messages = toOpenAiMessages('You are Mantis.', [
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello.' },
    ]);
    expect(messages).toEqual([
      { role: 'system', content: 'You are Mantis.' },
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello.' },
    ]);
  });

  it('sends an assistant tool call as tool_calls with JSON arguments, then the matching tool result', () => {
    const turns: ChatTurn[] = [
      { role: 'assistant', content: '', toolCalls: [{ id: 'call_1', name: 'create_task', args: { title: 'Footage' } }] },
      { role: 'tool', toolCallId: 'call_1', name: 'create_task', content: '{"ok":true}' },
    ];
    const messages = toOpenAiMessages('sys', turns);
    expect(messages[1]).toEqual({
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'create_task', arguments: '{"title":"Footage"}' } }],
    });
    expect(messages[2]).toEqual({ role: 'tool', tool_call_id: 'call_1', content: '{"ok":true}' });
  });

  it('reads a text reply and tool calls from a response, parsing the arguments', () => {
    const parsed = fromOpenAiMessage({
      content: 'Let me check.',
      tool_calls: [{ id: 'call_9', function: { name: 'find_tasks', arguments: '{"query":"footage"}' } }],
    });
    expect(parsed).toEqual({ text: 'Let me check.', toolCalls: [{ id: 'call_9', name: 'find_tasks', args: { query: 'footage' } }] });
  });

  it('treats malformed arguments as empty instead of throwing', () => {
    const parsed = fromOpenAiMessage({ content: null, tool_calls: [{ id: 'c', function: { name: 'list_team', arguments: '{not json' } }] });
    expect(parsed).toEqual({ text: '', toolCalls: [{ id: 'c', name: 'list_team', args: {} }] });
  });

  it('handles a missing message as an empty reply', () => {
    expect(fromOpenAiMessage(undefined)).toEqual({ text: '', toolCalls: [] });
  });
});

describe('Anthropic message mapping', () => {
  it('sends every tool result for one step inside a single user message', () => {
    const messages = toAnthropicMessages([
      { role: 'user', content: 'Assign two tasks' },
      {
        role: 'assistant',
        content: 'On it.',
        toolCalls: [
          { id: 'tu_1', name: 'create_task', args: { title: 'A' } },
          { id: 'tu_2', name: 'create_task', args: { title: 'B' } },
        ],
      },
      { role: 'tool', toolCallId: 'tu_1', name: 'create_task', content: '{"ok":true,"id":"a"}' },
      { role: 'tool', toolCallId: 'tu_2', name: 'create_task', content: '{"ok":true,"id":"b"}' },
    ]);
    expect(messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'Assign two tasks' }] },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'On it.' },
          { type: 'tool_use', id: 'tu_1', name: 'create_task', input: { title: 'A' } },
          { type: 'tool_use', id: 'tu_2', name: 'create_task', input: { title: 'B' } },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'tu_1', content: '{"ok":true,"id":"a"}' },
          { type: 'tool_result', tool_use_id: 'tu_2', content: '{"ok":true,"id":"b"}' },
        ],
      },
    ]);
  });

  it('drops an empty assistant turn rather than sending a blank message', () => {
    const messages = toAnthropicMessages([
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: '' },
      { role: 'user', content: 'Still there?' },
    ]);
    expect(messages.map((m) => m.role)).toEqual(['user', 'user']);
  });

  it('joins text blocks and collects tool_use blocks from a response', () => {
    const parsed = fromAnthropicContent([
      { type: 'text', text: 'Created ' },
      { type: 'tool_use', id: 'tu_3', name: 'create_task', input: { title: 'Footage' } },
      { type: 'text', text: 'it.' },
    ]);
    expect(parsed).toEqual({ text: 'Created it.', toolCalls: [{ id: 'tu_3', name: 'create_task', args: { title: 'Footage' } }] });
  });
});
