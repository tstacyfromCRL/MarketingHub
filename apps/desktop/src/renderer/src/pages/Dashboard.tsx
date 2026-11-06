import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { closestCenter, DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ExternalLink, GripVertical, Minus, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import { POST_STATUS_LABELS, PLATFORM_PRESETS, type Platform, type PostStatus } from '@mh/shared';
import { api, errorMessage, queryClient } from '../lib/api';
import { isManager, useSession } from '../lib/session';
import { formatDate, formatTime, timeAgo } from '../lib/format';
import type { ActivityEvent, Category, Notification, QuickLink } from '../lib/types';
import { Badge, Button, Card, Empty, ErrorText, Field, Modal, PageHeader, Spinner, STATUS_COLORS } from '../components/ui';
import { WorkLogLine } from './WorkLog';
import {
  addHomeWidget,
  canShrinkHomeColumns,
  canShrinkHomeRows,
  defaultHomeLayout,
  homeWidget,
  loadHomeLayout,
  MAX_HOME_COLUMNS,
  MAX_HOME_ROWS,
  MIN_HOME_COLUMNS,
  MIN_HOME_ROWS,
  moveHomeWidget,
  removeHomeWidget,
  saveHomeLayout,
  setHomeColumns,
  setHomeRows,
  widgetsAvailableToAdd,
  type HomeLayout,
  type HomeWidgetId,
} from '../lib/homeLayout';

type CampaignStatus = 'GENERATING' | 'READY' | 'FAILED';

interface DashboardData {
  myTasks: { id: string; title: string; dueDate: string | null; stage: { name: string; color: string }; categories: Category[] }[];
  upcomingPosts: { id: string; title: string; status: PostStatus; scheduledAt: string; platforms: Platform[] }[];
  activity: ActivityEvent[];
  links: QuickLink[];
  awaitingReview: number;
  unreadNotifications: number;
  drafts: { id: string; title: string; platforms: Platform[]; createdAt: string }[];
  draftCount: number;
  notifications: Pick<Notification, 'id' | 'title' | 'body' | 'link' | 'createdAt'>[];
  campaigns: { id: string; name: string; startDate: string; endDate: string; status: CampaignStatus; _count: { posts: number } }[];
  articles: { id: string; title: string; url: string; filedAt: string | null }[];
  teamEvents: { id: string; title: string; startsAt: string; endsAt: string; allDay: boolean; user: { id: string; name: string } }[];
}

const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = { GENERATING: 'Writing posts', READY: 'Ready', FAILED: 'Failed' };

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
  const manager = isManager(user);
  const { data, isLoading } = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<DashboardData>('/dashboard') });
  const [addLink, setAddLink] = useState(false);
  const [editing, setEditing] = useState(false);
  const [layout, setLayout] = useState<HomeLayout>(() => defaultHomeLayout(manager));
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  // Reload when the signed-in person changes, so one account does not keep another's arrangement.
  useEffect(() => {
    if (!user) return;
    setLayout(loadHomeLayout(user.id, manager, localStorage));
  }, [user, manager]);

  if (isLoading || !data || !user) return <Spinner />;

  function commit(next: HomeLayout) {
    setLayout(next);
    saveHomeLayout(user!.id, next, localStorage);
  }

  function onDragEnd(event: DragEndEvent) {
    const overId = event.over?.id;
    if (!overId) return;
    commit(moveHomeWidget(layout, String(event.active.id), String(overId)));
  }

  const shown = layout.widgets;
  const available = widgetsAvailableToAdd(layout, manager);
  const emptyCells = Math.max(0, layout.columns * layout.rows - shown.length);

  return (
    <div>
      <PageHeader
        title={`Welcome back, ${user.name.split(' ')[0]}`}
        subtitle={new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        actions={
          <>
            <Button variant="ghost" onClick={() => setEditing((value) => !value)}>{editing ? 'Done' : 'Customize'}</Button>
            <Link to="/studio"><Button variant="secondary">New post</Button></Link>
            <Link to="/campaigns/new"><Button>New campaign</Button></Link>
          </>
        }
      />

      {editing && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <GridSizeControl
            label="Columns"
            value={layout.columns}
            min={MIN_HOME_COLUMNS}
            max={MAX_HOME_COLUMNS}
            canShrink={canShrinkHomeColumns(layout)}
            onChange={(columns) => commit(setHomeColumns(layout, columns))}
          />
          <GridSizeControl
            label="Rows"
            value={layout.rows}
            min={MIN_HOME_ROWS}
            max={MAX_HOME_ROWS}
            canShrink={canShrinkHomeRows(layout)}
            onChange={(rows) => commit(setHomeRows(layout, rows))}
          />
          {available.map((id) => (
            <Button key={id} size="sm" variant="secondary" onClick={() => commit(addHomeWidget(layout, id, manager))}>
              <Plus className="h-3.5 w-3.5" /> {homeWidget(id).title}
            </Button>
          ))}
          <Button size="sm" variant="ghost" onClick={() => commit(defaultHomeLayout(manager))}><RotateCcw className="h-3.5 w-3.5" /> Reset layout</Button>
          {available.length === 0 && <span className="text-xs text-slate-500">Every widget is on the page. Drag one to move it, or remove it.</span>}
        </div>
      )}

      {shown.length === 0 && (
        <p className="mb-3 text-sm text-slate-500">Nothing is on your home page. Choose Customize and add a widget.</p>
      )}
      {/* One cell per widget, plus the empty cells, so every section stays the same size. */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={shown} strategy={rectSortingStrategy}>
          <div
            className="grid gap-4"
            style={{
              gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${layout.rows}, minmax(15rem, 1fr))`,
            }}
          >
            {shown.map((id) => (
              <HomeWidget key={id} id={id} editing={editing} onRemove={() => commit(removeHomeWidget(layout, id))}>
                {id === 'review' && <ReviewWidget count={data.awaitingReview} />}
                {id === 'calendar' && <CalendarWidget posts={data.upcomingPosts} />}
                {id === 'tasks' && <TasksWidget tasks={data.myTasks} />}
                {id === 'activity' && <ActivityWidget events={data.activity} />}
                {id === 'links' && <Card className="h-full" title="Quick links" actions={<Button size="sm" variant="ghost" onClick={() => setAddLink(true)}><Plus className="h-3.5 w-3.5" /> Add</Button>}><QuickLinks links={data.links} /></Card>}
                {id === 'drafts' && <DraftsWidget drafts={data.drafts} total={data.draftCount} />}
                {id === 'notifications' && <NotificationsWidget items={data.notifications} />}
                {id === 'campaigns' && <CampaignsWidget campaigns={data.campaigns} />}
                {id === 'articles' && <ArticlesWidget articles={data.articles} />}
                {id === 'events' && <TeamEventsWidget events={data.teamEvents} />}
              </HomeWidget>
            ))}
            {Array.from({ length: emptyCells }, (_, index) => (
              <div key={`empty-${index}`} className="rounded-lg border border-dashed border-white/10" />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <AddLinkModal open={addLink} onClose={() => setAddLink(false)} />
    </div>
  );
}

function GridSizeControl({ label, value, min, max, canShrink, onChange }: { label: string; value: number; min: number; max: number; canShrink: boolean; onChange: (next: number) => void }) {
  return (
    <div className="flex items-center gap-1 rounded-md border border-white/10 px-2 py-1">
      <span className="text-xs text-slate-400">{label}</span>
      <button type="button" className="rounded p-1 text-slate-300 hover:text-white disabled:cursor-not-allowed disabled:opacity-30" disabled={value <= min || !canShrink} title={canShrink ? `Fewer ${label.toLowerCase()}` : 'Remove a widget before making the grid smaller'} onClick={() => onChange(value - 1)}>
        <Minus className="h-3.5 w-3.5" />
      </button>
      <span className="w-4 text-center text-sm">{value}</span>
      <button type="button" className="rounded p-1 text-slate-300 hover:text-white disabled:cursor-not-allowed disabled:opacity-30" disabled={value >= max} title={`More ${label.toLowerCase()}`} onClick={() => onChange(value + 1)}>
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function HomeWidget({ id, editing, onRemove, children }: { id: HomeWidgetId; editing: boolean; onRemove: () => void; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: !editing });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`relative h-full min-h-0 ${isDragging ? 'z-10 opacity-70' : ''}`}
    >
      {editing && (
        <div className="absolute bottom-2 right-2 z-10 flex gap-1 rounded-md bg-chrome/90 p-0.5">
          <button type="button" className="cursor-grab rounded p-1 text-slate-400 hover:text-slate-200" title="Drag to move" {...attributes} {...listeners}>
            <GripVertical className="h-4 w-4" />
          </button>
          <button type="button" className="rounded p-1 text-slate-400 hover:text-rose-400" title="Remove from home" onClick={onRemove}>
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      <div className="h-full min-h-0 [&_.card]:flex [&_.card]:h-full [&_.card]:min-h-0 [&_.card]:flex-col [&_.card]:overflow-hidden [&_.card>div:last-child]:min-h-0 [&_.card>div:last-child]:flex-1 [&_.card>div:last-child]:overflow-auto">
        {children}
      </div>
    </div>
  );
}

function ReviewWidget({ count }: { count: number }) {
  if (count === 0) {
    return <Card title="Waiting for review"><Empty>Nothing is waiting for review.</Empty></Card>;
  }
  return (
    <Link to="/approvals" className="flex h-full items-center justify-between rounded-lg border border-violet-800/60 bg-violet-950/40 px-4 py-3 hover:bg-violet-950/70">
      <span className="text-sm"><strong>{count}</strong> post{count === 1 ? '' : 's'} waiting for manager review</span>
      <span className="text-sm text-violet-300">Review now →</span>
    </Link>
  );
}

function CalendarWidget({ posts }: { posts: DashboardData['upcomingPosts'] }) {
  return (
    <Card title="Social calendar: next 14 days" actions={<Link to="/calendar" className="text-xs text-indigo-300 hover:underline">Full calendar</Link>}>
      {posts.length === 0 ? (
        <Empty>No posts scheduled in the next two weeks.</Empty>
      ) : (
        <div className="space-y-4">
          {groupByDay(posts).map(([day, dayPosts]) => (
            <div key={day}>
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{formatDate(day)}</div>
              <div className="space-y-1">
                {dayPosts.map((post) => (
                  <Link key={post.id} to={`/posts/${post.id}`} className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-slate-800/60">
                    <span className="w-16 text-xs text-slate-400">{formatTime(post.scheduledAt)}</span>
                    <span className="flex-1 truncate text-sm">{post.title}</span>
                    <span className="text-xs text-slate-500">{post.platforms.map((platform) => PLATFORM_PRESETS[platform].label).join(', ')}</span>
                    <Badge color={STATUS_COLORS[post.status]}>{POST_STATUS_LABELS[post.status]}</Badge>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function TasksWidget({ tasks }: { tasks: DashboardData['myTasks'] }) {
  const overdue = (due: string | null) => due && new Date(due) < new Date();
  return (
    <Card title="My tasks" actions={<Link to="/tasks" className="text-xs text-indigo-300 hover:underline">Board</Link>}>
      {tasks.length === 0 ? (
        <Empty>You're all caught up.</Empty>
      ) : (
        <div className="space-y-1">
          {tasks.map((task) => (
            <Link key={task.id} to={`/tasks/${task.id}`} className="block rounded-md px-2 py-1.5 hover:bg-slate-800/60">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: task.stage.color }} />
                <span className="flex-1 truncate text-sm">{task.title}</span>
              </div>
              <div className="ml-4 mt-0.5 flex gap-2 text-xs text-slate-500">
                <span>{task.stage.name}</span>
                {task.dueDate && <span className={overdue(task.dueDate) ? 'text-rose-400' : ''}>Due {formatDate(task.dueDate)}</span>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </Card>
  );
}

function DraftsWidget({ drafts, total }: { drafts: DashboardData['drafts']; total: number }) {
  return (
    <Card title={`My drafts${total > 0 ? ` (${total})` : ''}`} actions={<Link to="/studio?tab=drafts" className="text-xs text-indigo-300 hover:underline">All drafts</Link>}>
      {drafts.length === 0 ? (
        <Empty>No drafts. Posts you create wait here until you send them for approval.</Empty>
      ) : (
        <div className="space-y-1">
          {drafts.map((post) => (
            <Link key={post.id} to={`/posts/${post.id}`} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-slate-800/60">
              <span className="flex-1 truncate text-sm">{post.title}</span>
              <span className="text-xs text-slate-500">{post.platforms.map((platform) => PLATFORM_PRESETS[platform].label).join(', ')}</span>
            </Link>
          ))}
        </div>
      )}
    </Card>
  );
}

function NotificationsWidget({ items }: { items: DashboardData['notifications'] }) {
  // Marking read updates the bell in the top bar too, so both caches are refreshed.
  const markRead = useMutation({
    mutationFn: (ids: string[]) => api.post('/notifications/read', { ids }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
  return (
    <Card
      title="Notifications"
      actions={items.length > 0 ? <button type="button" className="text-xs text-indigo-300 hover:underline" onClick={() => markRead.mutate(items.map((n) => n.id))}>Mark all read</button> : undefined}
    >
      {items.length === 0 ? (
        <Empty>Nothing new.</Empty>
      ) : (
        <div className="space-y-1">
          {items.map((n) => (
            <Link key={n.id} to={n.link ?? '/'} onClick={() => markRead.mutate([n.id])} className="block rounded-md px-2 py-1.5 hover:bg-slate-800/60">
              <div className="truncate text-sm">{n.title}</div>
              {n.body && <div className="truncate text-xs text-slate-500">{n.body}</div>}
              <div className="text-xs text-slate-500">{timeAgo(n.createdAt)}</div>
            </Link>
          ))}
        </div>
      )}
    </Card>
  );
}

function CampaignsWidget({ campaigns }: { campaigns: DashboardData['campaigns'] }) {
  return (
    <Card title="Campaigns" actions={<Link to="/campaigns" className="text-xs text-indigo-300 hover:underline">All</Link>}>
      {campaigns.length === 0 ? (
        <Empty>No campaigns are running or coming up.</Empty>
      ) : (
        <div className="space-y-1">
          {campaigns.map((campaign) => (
            <Link key={campaign.id} to={`/campaigns/${campaign.id}`} className="block rounded-md px-2 py-1.5 hover:bg-slate-800/60">
              <div className="flex items-center gap-2">
                <span className="flex-1 truncate text-sm">{campaign.name}</span>
                <span className="text-xs text-slate-500">{CAMPAIGN_STATUS_LABELS[campaign.status]}</span>
              </div>
              <div className="text-xs text-slate-500">
                {formatDate(campaign.startDate)} to {formatDate(campaign.endDate)} · {campaign._count.posts} post{campaign._count.posts === 1 ? '' : 's'}
              </div>
            </Link>
          ))}
        </div>
      )}
    </Card>
  );
}

function ArticlesWidget({ articles }: { articles: DashboardData['articles'] }) {
  return (
    <Card title="Recent articles" actions={<Link to="/knowledge/articles" className="text-xs text-indigo-300 hover:underline">Articles</Link>}>
      {articles.length === 0 ? (
        <Empty>No articles filed yet. Run a keyword search on the Articles tab, then save the ones you want.</Empty>
      ) : (
        <div className="space-y-1">
          {articles.map((article) => (
            <button key={article.id} type="button" onClick={() => void window.api.app.openExternal(article.url)} className="block w-full rounded-md px-2 py-1.5 text-left hover:bg-slate-800/60">
              <div className="flex items-center gap-2">
                <span className="flex-1 truncate text-sm">{article.title}</span>
                <ExternalLink className="h-3 w-3 shrink-0 text-slate-500" />
              </div>
              {article.filedAt && <div className="text-xs text-slate-500">Filed {formatDate(article.filedAt)}</div>}
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}

function TeamEventsWidget({ events }: { events: DashboardData['teamEvents'] }) {
  return (
    <Card title="Team events" actions={<Link to="/calendar" className="text-xs text-indigo-300 hover:underline">Calendar</Link>}>
      {events.length === 0 ? (
        <Empty>Nothing on the team schedule for the next two weeks.</Empty>
      ) : (
        <div className="space-y-1">
          {events.map((event) => (
            <Link key={event.id} to="/calendar" className="block rounded-md px-2 py-1.5 hover:bg-slate-800/60">
              <div className="truncate text-sm">{event.title}</div>
              <div className="text-xs text-slate-500">
                {event.user.name} · {event.allDay ? formatDate(event.startsAt) : `${formatDate(event.startsAt)} ${formatTime(event.startsAt)}`}
              </div>
            </Link>
          ))}
        </div>
      )}
    </Card>
  );
}

function ActivityWidget({ events }: { events: DashboardData['activity'] }) {
  return (
    <Card title="Work log" actions={<Link to="/settings/log" className="text-xs text-accent hover:underline">View all</Link>}>
      {events.length === 0 ? <Empty>No activity yet.</Empty> : <div className="space-y-2">{events.map((event) => <WorkLogLine key={event.id} event={event} />)}</div>}
    </Card>
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
