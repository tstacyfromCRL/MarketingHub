import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { formatWhen } from '../lib/format';
import { useUsers } from '../lib/hooks';
import type { ActivityEvent } from '../lib/types';
import { Button, Card, Empty, PageHeader, Spinner } from '../components/ui';

const LINK_LABELS: Record<string, string> = {
  post: 'go to post',
  task: 'go to task',
  campaign: 'go to campaign',
  design: 'go to design',
  content: 'go to document',
  source: 'go to source',
  product: 'go to product',
};

/** One line in the format "09/30/2026 10:15 AM: Jane approved post ... Link: go to post". */
export function WorkLogLine({ event }: { event: ActivityEvent }) {
  return (
    <div className="text-sm leading-relaxed">
      <span className="font-mono text-xs text-slate-500">{formatWhen(event.createdAt)}:</span>{' '}
      <span className="text-slate-200">{event.summary}</span>
      {event.link && (
        <>
          {' '}
          <span className="text-slate-500">Link:</span>{' '}
          <Link to={event.link} className="text-indigo-300 hover:underline">{LINK_LABELS[event.entityType] ?? 'open'}</Link>
        </>
      )}
    </div>
  );
}

const TYPES = ['post', 'campaign', 'task', 'design', 'content', 'source', 'product', 'user', 'library', 'social', 'stage', 'category', 'schedule'];

export function WorkLogPage() {
  const users = useUsers();
  const [q, setQ] = useState('');
  const [entityType, setEntityType] = useState('');
  const [actorId, setActorId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (entityType) params.set('entityType', entityType);
  if (actorId) params.set('actorId', actorId);
  if (from) params.set('from', new Date(from).toISOString());
  if (to) params.set('to', new Date(`${to}T23:59:59`).toISOString());

  const query = useInfiniteQuery({
    queryKey: ['activity', params.toString()],
    queryFn: ({ pageParam }) =>
      api.get<{ items: ActivityEvent[]; nextCursor: string | null }>(`/activity?${params.toString()}${pageParam ? `&cursor=${pageParam}` : ''}`),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div>
      <PageHeader title="Work log" subtitle="Every significant action across the team, newest first." />
      <div className="mb-4 flex flex-wrap gap-2">
        <input className="input max-w-xs" placeholder="Search the log..." value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input w-40" value={entityType} onChange={(e) => setEntityType(e.target.value)}>
          <option value="">All types</option>
          {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className="input w-44" value={actorId} onChange={(e) => setActorId(e.target.value)}>
          <option value="">Everyone</option>
          {users.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <input type="date" className="input w-40" value={from} onChange={(e) => setFrom(e.target.value)} title="From" />
        <input type="date" className="input w-40" value={to} onChange={(e) => setTo(e.target.value)} title="To" />
      </div>
      <Card>
        {query.isLoading ? (
          <Spinner />
        ) : items.length === 0 ? (
          <Empty>No matching activity.</Empty>
        ) : (
          <div className="space-y-2">
            {items.map((e) => <WorkLogLine key={e.id} event={e} />)}
            {query.hasNextPage && (
              <div className="pt-2 text-center">
                <Button variant="secondary" size="sm" onClick={() => void query.fetchNextPage()} loading={query.isFetchingNextPage}>Load more</Button>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
