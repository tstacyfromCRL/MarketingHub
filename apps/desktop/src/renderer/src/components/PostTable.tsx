import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { ImageIcon } from 'lucide-react';
import { POST_STATUS_LABELS, PLATFORM_PRESETS, type PostAction } from '@mh/shared';
import { api, errorMessage, fileUrl, queryClient } from '../lib/api';
import { formatWhen } from '../lib/format';
import type { Post } from '../lib/types';
import { Badge, Button, Empty, ErrorText, STATUS_COLORS } from './ui';

const BULK_LABELS: Partial<Record<PostAction, string>> = {
  creatorApprove: 'Approve drafts',
  startReview: 'Start review',
  approve: 'Approve & schedule',
  unschedule: 'Unschedule',
  retry: 'Retry',
};

/** Selectable list of posts with bulk workflow actions (e.g. approving a whole campaign). */
export function PostTable({ posts, bulkActions = [], empty }: { posts: Post[]; bulkActions?: PostAction[]; empty?: string }) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const bulk = useMutation({
    mutationFn: (action: PostAction) => api.post<{ results: { id: string; ok: boolean; error?: string }[] }>('/posts/bulk-transition', { ids: [...sel], action }),
    onSuccess: (r) => {
      const failed = r.results.filter((x) => !x.ok);
      setResult(
        failed.length
          ? { ok: false, msg: `${r.results.length - failed.length} updated, ${failed.length} skipped: ${failed[0].error}` }
          : { ok: true, msg: `${r.results.length} updated` },
      );
      setSel(new Set());
      void queryClient.invalidateQueries({ queryKey: ['posts'] });
      void queryClient.invalidateQueries({ queryKey: ['campaign'] });
      void queryClient.invalidateQueries({ queryKey: ['campaigns'] });
    },
    onError: (e) => setResult({ ok: false, msg: errorMessage(e) }),
  });

  if (posts.length === 0) return <Empty>{empty ?? 'No posts.'}</Empty>;
  const all = sel.size === posts.length;
  const toggle = (id: string) => {
    const next = new Set(sel);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSel(next);
  };

  return (
    <div>
      {bulkActions.length > 0 && (
        <div className="mb-2 flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-slate-400">
            <input type="checkbox" checked={all} onChange={() => setSel(all ? new Set() : new Set(posts.map((p) => p.id)))} /> {sel.size ? `${sel.size} selected` : 'Select all'}
          </label>
          <div className="flex-1" />
          {bulkActions.map((a) => (
            <Button key={a} size="sm" variant="secondary" disabled={!sel.size} loading={bulk.isPending && bulk.variables === a} onClick={() => bulk.mutate(a)}>{BULK_LABELS[a] ?? a}</Button>
          ))}
        </div>
      )}
      {result && <div className="mb-2">{result.ok ? <p className="text-sm text-emerald-400">{result.msg}</p> : <ErrorText error={result.msg} />}</div>}
      <div className="card divide-y divide-slate-800">
        {posts.map((p) => {
          const preview = p.design?.previewKey ?? p.variants.find((v) => v.design?.previewKey)?.design?.previewKey;
          return (
            <div key={p.id} className="flex items-center gap-3 px-3 py-2">
              {bulkActions.length > 0 && <input type="checkbox" checked={sel.has(p.id)} onChange={() => toggle(p.id)} />}
              <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded bg-slate-900">
                {preview ? <img src={fileUrl(preview)} className="h-full w-full object-cover" /> : <ImageIcon className="h-5 w-5 text-slate-700" />}
              </div>
              <Link to={`/posts/${p.id}`} className="min-w-0 flex-1 hover:underline">
                <div className="truncate text-sm">{p.title}</div>
                <div className="truncate text-xs text-slate-500">{p.body.slice(0, 120)}</div>
              </Link>
              <div className="w-40 text-xs text-slate-500">{p.platforms.map((x) => PLATFORM_PRESETS[x].label).join(', ')}</div>
              <div className="w-40 text-xs text-slate-400">{p.scheduledAt ? formatWhen(p.scheduledAt) : 'No time set'}</div>
              <Badge color={STATUS_COLORS[p.status]}>{POST_STATUS_LABELS[p.status]}</Badge>
            </div>
          );
        })}
      </div>
    </div>
  );
}
