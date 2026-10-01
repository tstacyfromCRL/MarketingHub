import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react';
import type { PostStatus } from '@mh/shared';
import { POST_STATUS_LABELS } from '@mh/shared';
import { api, errorMessage, queryClient } from '../lib/api';
import { isManager, useSession } from '../lib/session';
import { formatTime, fromLocalInput, isoDay, toLocalInput } from '../lib/format';
import { useUsers } from '../lib/hooks';
import { Button, ErrorText, Field, Modal, PageHeader, STATUS_COLORS } from '../components/ui';

interface CalendarData {
  posts: { id: string; title: string; status: PostStatus; scheduledAt: string | null; postedAt: string | null }[];
  tasks: { id: string; title: string; dueDate: string; stage: { name: string; color: string } }[];
  schedule: { id: string; title: string; startsAt: string; endsAt: string; allDay: boolean; notes: string; user: { id: string; name: string } }[];
}
type ScheduleEntry = CalendarData['schedule'][number];

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function CalendarPage() {
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [show, setShow] = useState({ posts: true, tasks: true, schedule: true });
  const [editing, setEditing] = useState<{ entry?: ScheduleEntry; day?: Date } | null>(null);

  const gridStart = new Date(month);
  gridStart.setDate(1 - month.getDay());
  const days = Array.from({ length: 42 }, (_, i) => new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i));
  const gridEnd = new Date(days[41].getFullYear(), days[41].getMonth(), days[41].getDate(), 23, 59, 59);

  const { data } = useQuery({
    queryKey: ['calendar', gridStart.toISOString()],
    queryFn: () => api.get<CalendarData>(`/calendar?from=${gridStart.toISOString()}&to=${gridEnd.toISOString()}`),
  });

  const byDay = useMemo(() => {
    const map = new Map<string, { key: string; node: JSX.Element; sort: number }[]>();
    const add = (d: Date, key: string, node: JSX.Element) => {
      const k = isoDay(d);
      map.set(k, [...(map.get(k) ?? []), { key, node, sort: d.getTime() }]);
    };
    if (show.posts) {
      for (const p of data?.posts ?? []) {
        const when = new Date(p.postedAt ?? p.scheduledAt!);
        add(when, `p${p.id}`, (
          <Link to={`/posts/${p.id}`} className="block truncate rounded px-1.5 py-0.5 text-[11px] hover:brightness-125" style={{ backgroundColor: `${STATUS_COLORS[p.status]}26`, color: STATUS_COLORS[p.status] }} title={`${p.title} (${POST_STATUS_LABELS[p.status]})`}>
            {formatTime(when)} {p.title}
          </Link>
        ));
      }
    }
    if (show.tasks) {
      for (const t of data?.tasks ?? []) {
        add(new Date(t.dueDate), `t${t.id}`, (
          <Link to={`/tasks/${t.id}`} className="block truncate rounded border border-slate-700 px-1.5 py-0.5 text-[11px] text-slate-300 hover:bg-slate-800" title={`Task due: ${t.title}`}>
            ☐ {t.title}
          </Link>
        ));
      }
    }
    if (show.schedule) {
      for (const s of data?.schedule ?? []) {
        const start = new Date(s.startsAt);
        const end = new Date(s.endsAt);
        for (let d = new Date(start.getFullYear(), start.getMonth(), start.getDate()); d <= end; d.setDate(d.getDate() + 1)) {
          add(new Date(d), `s${s.id}${isoDay(d)}`, (
            <button onClick={() => setEditing({ entry: s })} className="block w-full truncate rounded bg-teal-900/40 px-1.5 py-0.5 text-left text-[11px] text-teal-300 hover:bg-teal-900/70" title={`${s.user.name}: ${s.title}`}>
              {s.user.name.split(' ')[0]}: {s.title}
            </button>
          ));
        }
      }
    }
    for (const list of map.values()) list.sort((a, b) => a.sort - b.sort);
    return map;
  }, [data, show]);

  const today = isoDay(new Date());

  return (
    <div>
      <PageHeader
        title="Team calendar"
        subtitle="Social posts, task due dates and everyone's schedule."
        actions={<Button onClick={() => setEditing({ day: new Date() })}><Plus className="h-4 w-4" /> Add schedule entry</Button>}
      />
      <div className="mb-4 flex items-center gap-3">
        <Button variant="secondary" size="sm" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft className="h-4 w-4" /></Button>
        <h2 className="w-44 text-center text-lg font-semibold">{month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</h2>
        <Button variant="secondary" size="sm" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight className="h-4 w-4" /></Button>
        <Button variant="ghost" size="sm" onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); }}>Today</Button>
        <div className="flex-1" />
        {(['posts', 'tasks', 'schedule'] as const).map((k) => (
          <label key={k} className="flex items-center gap-1.5 text-sm capitalize text-slate-300">
            <input type="checkbox" checked={show[k]} onChange={(e) => setShow({ ...show, [k]: e.target.checked })} /> {k}
          </label>
        ))}
      </div>
      <div className="grid grid-cols-7 overflow-hidden rounded-lg border border-slate-800">
        {WEEKDAYS.map((d) => (
          <div key={d} className="border-b border-slate-800 bg-slate-900 px-2 py-1.5 text-xs font-semibold text-slate-400">{d}</div>
        ))}
        {days.map((d) => {
          const key = isoDay(d);
          const items = byDay.get(key) ?? [];
          const inMonth = d.getMonth() === month.getMonth();
          return (
            <div
              key={key}
              onDoubleClick={() => setEditing({ day: d })}
              className={`min-h-[110px] border-b border-r border-slate-800/70 p-1.5 ${inMonth ? 'bg-slate-950' : 'bg-slate-900/40 text-slate-600'}`}
            >
              <div className={`mb-1 text-xs ${key === today ? 'inline-flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 font-bold text-white' : ''}`}>{d.getDate()}</div>
              <div className="space-y-0.5">
                {items.slice(0, 5).map((i) => <div key={i.key}>{i.node}</div>)}
                {items.length > 5 && <div className="px-1 text-[11px] text-slate-500">+{items.length - 5} more</div>}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-slate-500">Double-click a day to add a schedule entry (time off, shoots, events).</p>
      {editing && <ScheduleModal entry={editing.entry} day={editing.day} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ScheduleModal({ entry, day, onClose }: { entry?: ScheduleEntry; day?: Date; onClose: () => void }) {
  const { user } = useSession();
  const users = useUsers();
  const base = day ?? new Date();
  const defStart = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 9);
  const defEnd = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 17);
  const [title, setTitle] = useState(entry?.title ?? '');
  const [userId, setUserId] = useState(entry?.user.id ?? user!.id);
  const [startsAt, setStartsAt] = useState(toLocalInput(entry?.startsAt ?? defStart));
  const [endsAt, setEndsAt] = useState(toLocalInput(entry?.endsAt ?? defEnd));
  const [allDay, setAllDay] = useState(entry?.allDay ?? false);
  const [notes, setNotes] = useState(entry?.notes ?? '');
  const canEdit = !entry || entry.user.id === user!.id || isManager(user);

  const done = () => {
    void queryClient.invalidateQueries({ queryKey: ['calendar'] });
    onClose();
  };
  const save = useMutation({
    mutationFn: () => {
      const body = { title, startsAt: fromLocalInput(startsAt), endsAt: fromLocalInput(endsAt), allDay, notes, userId };
      return entry ? api.patch(`/schedule/${entry.id}`, body) : api.post('/schedule', body);
    },
    onSuccess: done,
  });
  const del = useMutation({ mutationFn: () => api.del(`/schedule/${entry!.id}`), onSuccess: done });

  return (
    <Modal open onClose={onClose} title={entry ? 'Schedule entry' : 'Add schedule entry'}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <Field label="What"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} required disabled={!canEdit} placeholder="Product photo shoot, PTO, trade show..." /></Field>
        <Field label="Who">
          <select className="input" value={userId} onChange={(e) => setUserId(e.target.value)} disabled={!!entry || !isManager(user)}>
            {users.data?.filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Starts"><input type="datetime-local" className="input" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required disabled={!canEdit} /></Field>
          <Field label="Ends"><input type="datetime-local" className="input" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} required disabled={!canEdit} /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} disabled={!canEdit} /> All day</label>
        <Field label="Notes"><textarea className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!canEdit} /></Field>
        <ErrorText error={save.error ? errorMessage(save.error) : del.error ? errorMessage(del.error) : null} />
        {canEdit && (
          <div className="flex justify-between">
            {entry ? <Button type="button" variant="danger" onClick={() => del.mutate()} loading={del.isPending}><Trash2 className="h-4 w-4" /> Delete</Button> : <span />}
            <Button type="submit" loading={save.isPending}>Save</Button>
          </div>
        )}
      </form>
    </Modal>
  );
}
