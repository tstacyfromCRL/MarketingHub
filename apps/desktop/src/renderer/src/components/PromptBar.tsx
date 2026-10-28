import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { api, queryClient } from '../lib/api';
import { ErrorText } from './ui';

interface PromptReply {
  reply: string;
  link?: string;
  linkLabel?: string;
  needsDetail: boolean;
  context?: string;
}

/**
 * A one-line box for plain language.
 * The server may start a draft or a task. Publishing, approving, and deleting stay on their buttons.
 */
export function PromptBar() {
  const [text, setText] = useState('');
  const [context, setContext] = useState<string | undefined>();
  const [result, setResult] = useState<PromptReply | null>(null);

  const send = useMutation({
    mutationFn: (message: string) => api.post<PromptReply>('/prompt', { message, context }),
    onSuccess: (data) => {
      setResult(data);
      setText('');
      setContext(data.needsDetail ? data.context : undefined);
      if (data.link?.startsWith('/tasks')) queryClient.invalidateQueries({ queryKey: ['tasks'] });
      if (data.link?.startsWith('/posts')) queryClient.invalidateQueries({ queryKey: ['posts'] });
    },
  });

  function submit() {
    const message = text.trim();
    if (!message || send.isPending) return;
    send.mutate(message);
  }

  return (
    <form
      className="shrink-0 border-t border-white/5 bg-chrome px-6 py-3"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <label className="sr-only" htmlFor="workflow-prompt">
        Tell Mantis what to start
      </label>
      <input
        id="workflow-prompt"
        className="input"
        value={text}
        placeholder="Start a draft or a task in plain language"
        disabled={send.isPending}
        onChange={(event) => setText(event.target.value)}
      />
      {send.isPending && <p className="mt-2 text-sm text-mist/70">Working on that…</p>}
      {send.isError && <div className="mt-2"><ErrorText error={send.error} /></div>}
      {result && !send.isPending && (
        <p className="mt-2 text-sm text-mist/80">
          {result.reply}{' '}
          {result.link && (
            <Link to={result.link} className="text-accent hover:underline">
              {result.linkLabel ?? 'Open it'}
            </Link>
          )}
        </p>
      )}
    </form>
  );
}
