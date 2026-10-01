import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ExternalLink, Plus, Trash2 } from 'lucide-react';
import { POST_STATUS_LABELS, PLATFORM_PRESETS, type Platform, type PostStatus } from '@mh/shared';
import { api, errorMessage, queryClient } from '../lib/api';
import { isManager, useSession } from '../lib/session';
import { formatDate, formatTime } from '../lib/format';
import type { ActivityEvent, Category, QuickLink } from '../lib/types';
import { Badge, Button, Card, Empty, ErrorText, Field, Modal, PageHeader, Spinner, STATUS_COLORS } from '../components/ui';
import { WorkLogLine } from './WorkLog';

interface DashboardData {
  myTasks: { id: string; title: string; dueDate: string | null; stage: { name: string; color: string }; categories: Category[] }[];
  upcomingPosts: { id: string; title: string; status: PostStatus; scheduledAt: string; platforms: Platform[] }[];
  activity: ActivityEvent[];
  links: QuickLink[];
  awaitingReview: number;
  unreadNotifications: number;
}

function groupByDay<T extends { scheduledAt: string }>(items: T[]) {
  const map = new Map<string, T[]>();
  for (const i of items) {
    const key = new Date(i.scheduledAt).toDateString();
    map.set(key, [...(map.get(key) ?? []), i]);
  }
  return [...map.entries()];
}

export function DashboardPage() {
  const { user } = useSession();
  const { data, isLoading } = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<DashboardData>('/dashboard') });
  const [addLink, setAddLink] = useState(false);

  if (isLoading || !data) return <Spinner />;
  const overdue = (d: string | null) => d && new Date(d) < new Date();

  return (
    <div>
      <PageHeader
        title={`Welcome back, ${user?.name.split(' ')[0]}`}
        subtitle={new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        actions={
          <>
            <Link to="/studio"><Button variant="secondary">New post</Button></Link>
            <Link to="/campaigns/new"><Button>New campaign</Button></Link>
          </>
        }
      />

      {isManager(user) && data.awaitingReview > 0 && (
        <Link to="/approvals" className="mb-6 flex items-center justify-between rounded-lg border border-violet-800/60 bg-violet-950/40 px-4 py-3 hover:bg-violet-950/70">
          <span className="text-sm"><strong>{data.awaitingReview}</strong> post{data.awaitingReview === 1 ? '' : 's'} waiting for manager review</span>
          <span className="text-sm text-violet-300">Review now →</span>
        </Link>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card title="Social calendar: next 14 days" className="xl:col-span-2" actions={<Link to="/calendar" className="text-xs text-indigo-300 hover:underline">Full calendar</Link>}>
          {data.upcomingPosts.length === 0 ? (
            <Empty>No posts scheduled in the next two weeks.</Empty>
          ) : (
            <div className="space-y-4">
              {groupByDay(data.upcomingPosts).map(([day, posts]) => (
                <div key={day}>
                  <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{formatDate(day)}</div>
                  <div className="space-y-1">
                    {posts.map((p) => (
                      <Link key={p.id} to={`/posts/${p.id}`} className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-slate-800/60">
                        <span className="w-16 text-xs text-slate-400">{formatTime(p.scheduledAt)}</span>
                        <span className="flex-1 truncate text-sm">{p.title}</span>
                        <span className="text-xs text-slate-500">{p.platforms.map((x) => PLATFORM_PRESETS[x].label).join(', ')}</span>
                        <Badge color={STATUS_COLORS[p.status]}>{POST_STATUS_LABELS[p.status]}</Badge>
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="My tasks" actions={<Link to="/tasks" className="text-xs text-indigo-300 hover:underline">Board</Link>}>
          {data.myTasks.length === 0 ? (
            <Empty>You're all caught up.</Empty>
          ) : (
            <div className="space-y-1">
              {data.myTasks.map((t) => (
                <Link key={t.id} to={`/tasks/${t.id}`} className="block rounded-md px-2 py-1.5 hover:bg-slate-800/60">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: t.stage.color }} />
                    <span className="flex-1 truncate text-sm">{t.title}</span>
                  </div>
                  <div className="ml-4 mt-0.5 flex gap-2 text-xs text-slate-500">
                    <span>{t.stage.name}</span>
                    {t.dueDate && <span className={overdue(t.dueDate) ? 'text-rose-400' : ''}>Due {formatDate(t.dueDate)}</span>}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Card>

        <Card title="Work log" className="xl:col-span-2" actions={<Link to="/activity" className="text-xs text-indigo-300 hover:underline">View all</Link>}>
          {data.activity.length === 0 ? <Empty>No activity yet.</Empty> : <div className="space-y-2">{data.activity.map((e) => <WorkLogLine key={e.id} event={e} />)}</div>}
        </Card>

        <Card title="Quick links" actions={<Button size="sm" variant="ghost" onClick={() => setAddLink(true)}><Plus className="h-3.5 w-3.5" /> Add</Button>}>
          <QuickLinks links={data.links} />
        </Card>
      </div>
      <AddLinkModal open={addLink} onClose={() => setAddLink(false)} />
    </div>
  );
}

function QuickLinks({ links }: { links: QuickLink[] }) {
  const { user } = useSession();
  const del = useMutation({
    mutationFn: (id: string) => api.del(`/quick-links/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
  });
  if (links.length === 0) return <Empty>Add your company's social pages, website and handy tools.</Empty>;
  const company = links.filter((l) => !l.userId);
  const mine = links.filter((l) => l.userId);
  const section = (title: string, items: QuickLink[], canDelete: boolean) =>
    items.length > 0 && (
      <div>
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</div>
        {items.map((l) => (
          <div key={l.id} className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-slate-800/60">
            <button onClick={() => void window.api.app.openExternal(l.url)} className="flex flex-1 items-center gap-2 truncate text-left text-sm">
              <ExternalLink className="h-3.5 w-3.5 text-slate-500" /> {l.label}
            </button>
            {canDelete && (
              <button onClick={() => del.mutate(l.id)} className="hidden text-slate-500 hover:text-rose-400 group-hover:block">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>
    );
  return (
    <div className="space-y-3">
      {section('Company', company, isManager(user))}
      {section('Mine', mine, true)}
    </div>
  );
}

function AddLinkModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useSession();
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('https://');
  const [shared, setShared] = useState(false);
  const save = useMutation({
    mutationFn: () => api.post('/quick-links', { label, url, shared }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setLabel('');
      setUrl('https://');
      onClose();
    },
  });
  return (
    <Modal open={open} onClose={onClose} title="Add quick link">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <Field label="Label"><input className="input" value={label} onChange={(e) => setLabel(e.target.value)} required placeholder="Company LinkedIn" /></Field>
        <Field label="URL"><input className="input" value={url} onChange={(e) => setUrl(e.target.value)} required type="url" /></Field>
        {isManager(user) && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} /> Show to the whole team
          </label>
        )}
        {save.error && <ErrorText error={errorMessage(save.error)} />}
        <div className="flex justify-end"><Button type="submit" loading={save.isPending}>Add link</Button></div>
      </form>
    </Modal>
  );
}
