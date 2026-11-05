import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, MessageSquarePlus, Send, Trash2 } from 'lucide-react';
import { api, queryClient } from '../lib/api';
import { useAssistantStore } from '../lib/assistantStore';
import { Button, ErrorText, Spinner } from './ui';

interface AssistantAction { kind: 'task' | 'post' | 'link'; label: string; link: string }
interface AssistantMessage { id: string; role: 'user' | 'assistant'; content: string; actions: AssistantAction[]; createdAt: string }
interface ThreadSummary { id: string; title: string; updatedAt: string }
interface ThreadDetail extends ThreadSummary { messages: AssistantMessage[] }
interface AssistantStatus { conversational: boolean; model: string }
interface SendResult { thread: ThreadSummary; messages: AssistantMessage[] }

const EXAMPLES = [
  'Make a task for Tony to film the booth on Friday',
  'Draft a LinkedIn post about our new Row Scout',
  'What is on the board that is due this week?',
];

/**
 * Mantis's chat, docked at the bottom of every screen. It is a conversation: earlier messages are
 * sent back with each new one, so follow-ups like "make it shorter" work. The panel sends the screen
 * the person has open so "this post" means the post on screen.
 */
export function AssistantPanel() {
  const location = useLocation();
  const page = `${location.pathname}${location.search}`;
  const open = useAssistantStore((s) => s.open);
  const setOpen = useAssistantStore((s) => s.setOpen);
  const draft = useAssistantStore((s) => s.draft);
  const takeDraft = useAssistantStore((s) => s.takeDraft);

  const [threadId, setThreadId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const status = useQuery({ queryKey: ['assistant', 'status'], queryFn: () => api.get<AssistantStatus>('/assistant/status'), staleTime: Infinity });
  const threads = useQuery({ queryKey: ['assistant', 'threads'], queryFn: () => api.get<ThreadSummary[]>('/assistant/threads'), enabled: open });
  const thread = useQuery({
    queryKey: ['assistant', 'thread', threadId],
    queryFn: () => api.get<ThreadDetail>(`/assistant/threads/${threadId}`),
    enabled: open && !!threadId,
  });

  // A screen (such as a post's Rewrite button) can hand the panel a starting message.
  useEffect(() => {
    if (draft === null) return;
    setText(takeDraft() ?? '');
    inputRef.current?.focus();
  }, [draft, takeDraft]);

  // Keep the newest message in view.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [thread.data?.messages.length, pending, open]);

  const send = useMutation({
    mutationFn: (message: string) => api.post<SendResult>('/assistant/messages', { threadId: threadId ?? undefined, message, page }),
    onMutate: (message) => setPending(message),
    onSuccess: (result) => {
      setThreadId(result.thread.id);
      void queryClient.invalidateQueries({ queryKey: ['assistant', 'thread', result.thread.id] });
      void queryClient.invalidateQueries({ queryKey: ['assistant', 'threads'] });
      // Anything the assistant created or changed should show up on its screen straight away.
      for (const action of result.messages.flatMap((m) => m.actions)) {
        if (action.link.startsWith('/tasks')) void queryClient.invalidateQueries({ queryKey: ['tasks'] });
        if (action.link.startsWith('/posts')) void queryClient.invalidateQueries({ queryKey: ['posts'] });
      }
    },
    onError: (_error, message) => setText(message),
    onSettled: () => setPending(null),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/assistant/threads/${id}`),
    onSuccess: () => {
      setThreadId(null);
      void queryClient.invalidateQueries({ queryKey: ['assistant', 'threads'] });
    },
  });

  function submit() {
    const message = text.trim();
    if (!message || send.isPending) return;
    setText('');
    send.mutate(message);
  }

  const messages = thread.data?.messages ?? [];
  const conversational = status.data?.conversational ?? true;

  return (
    <div className="shrink-0 border-t border-white/5 bg-chrome">
      {open && (
        <div className="flex h-[min(60vh,560px)] flex-col border-b border-white/5">
          <header className="flex items-center gap-2 px-6 py-2">
            <select
              aria-label="Conversation"
              className="input max-w-xs py-1 text-sm"
              value={threadId ?? ''}
              onChange={(event) => setThreadId(event.target.value || null)}
            >
              <option value="">New conversation</option>
              {(threads.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
            </select>
            <Button variant="ghost" size="sm" onClick={() => setThreadId(null)} title="Start a new conversation"><MessageSquarePlus className="h-3.5 w-3.5" /> New</Button>
            {threadId && (
              <Button variant="ghost" size="sm" title="Delete this conversation" onClick={() => confirm('Delete this conversation?') && remove.mutate(threadId)}>
                <Trash2 className="h-3.5 w-3.5 text-rose-400" />
              </Button>
            )}
            <span className="ml-auto text-xs text-mist/60">{status.data?.model ?? ''}</span>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)} title="Hide the chat"><ChevronDown className="h-4 w-4" /></Button>
          </header>

          {!conversational && (
            <p className="mx-6 mb-2 rounded-sm bg-amber-900/30 px-3 py-2 text-xs text-amber-100">
              No AI key is set on the server, so I can only start one draft or one task at a time. Add an OpenAI or Claude key to talk about anything else.
            </p>
          )}

          <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-auto px-6 py-2">
            {!threadId && !pending && (
              <div className="text-sm text-mist/70">
                <p>Ask me anything about the team's work, or have me start something.</p>
                <ul className="mt-2 space-y-1 text-mist/50">
                  {EXAMPLES.map((example) => (
                    <li key={example}><button type="button" className="hover:text-mist" onClick={() => { setText(example); inputRef.current?.focus(); }}>{example}</button></li>
                  ))}
                </ul>
              </div>
            )}
            {messages.map((m) => <Bubble key={m.id} message={m} />)}
            {pending && (
              <>
                <Bubble message={{ id: 'pending-user', role: 'user', content: pending, actions: [], createdAt: '' }} />
                <p className="flex items-center gap-2 text-sm text-mist/60"><Spinner label="Mantis is working…" /></p>
              </>
            )}
            <ErrorText error={send.error} />
            {thread.isError && <ErrorText error={thread.error} />}
          </div>
        </div>
      )}

      <form
        className="flex items-end gap-2 px-6 py-3"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        {!open && (
          <button type="button" onClick={() => setOpen(true)} className="mb-1 text-mist/70 hover:text-mist" title="Open the chat">
            <ChevronUp className="h-4 w-4" />
          </button>
        )}
        <label className="sr-only" htmlFor="assistant-input">Message Mantis</label>
        <textarea
          id="assistant-input"
          ref={inputRef}
          rows={1}
          className="input min-h-[2.5rem] flex-1 resize-none py-2"
          value={text}
          placeholder="Ask Mantis anything, or have it start a draft or a task"
          onFocus={() => setOpen(true)}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit();
            } else if (event.key === 'Escape') {
              setOpen(false);
            }
          }}
        />
        <Button type="submit" disabled={!text.trim() || send.isPending} title="Send"><Send className="h-4 w-4" /></Button>
      </form>
    </div>
  );
}

function Bubble({ message }: { message: AssistantMessage }) {
  const mine = message.role === 'user';
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[75%] rounded-md px-3 py-2 text-sm whitespace-pre-wrap ${mine ? 'bg-sage/20 text-mist' : 'bg-white/5 text-mist/90'}`}>
        {message.content}
        {message.actions.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {message.actions.map((action) => (
              <Link key={action.link} to={action.link} className="rounded-sm border border-sage/40 px-2 py-0.5 text-xs text-sage hover:bg-sage/10">
                {action.label}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
