import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { POST_STATUS_LABELS, PLATFORM_PRESETS, type Platform, type PostStatus } from '@mh/shared';
import { api } from '../lib/api';
import { formatDate } from '../lib/format';
import { Card, PageHeader, Spinner, STATUS_COLORS } from '../components/ui';

interface Analytics {
  days: number;
  totals: { posts: number; posted: number; failed: number; tasksCompleted: number };
  byStatus: Partial<Record<PostStatus, number>>;
  byPlatform: Record<string, { posted: number; failed: number; pending: number }>;
  weekly: { week: string; created: number; posted: number; tasksDone: number }[];
  reviewTurnaround: { count: number; medianHours: number | null; averageHours: number | null };
  topCreators: { id: string; name: string; count: number }[];
}

function hours(h: number | null) {
  if (h === null) return '—';
  return h < 24 ? `${h.toFixed(1)} h` : `${(h / 24).toFixed(1)} days`;
}

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

export function AnalyticsPage() {
  const [days, setDays] = useState(90);
  const { data } = useQuery({ queryKey: ['analytics', days], queryFn: () => api.get<Analytics>(`/analytics?days=${days}`) });

  return (
    <div>
      <PageHeader
        title="Analytics"
        subtitle="Team output and publishing health."
        actions={
          <select className="input w-40" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
            <option value={180}>Last 6 months</option>
            <option value={365}>Last year</option>
          </select>
        }
      />
      {!data ? <Spinner /> : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <Stat label="Posts created" value={data.totals.posts} />
            <Stat label="Published" value={data.totals.posted} />
            <Stat label="Failed" value={data.totals.failed} />
            <Stat label="Tasks completed" value={data.totals.tasksCompleted} />
            <Stat label="Review turnaround" value={hours(data.reviewTurnaround.medianHours)} sub={`median of ${data.reviewTurnaround.count} · avg ${hours(data.reviewTurnaround.averageHours)}`} />
          </div>

          <Card title="Weekly activity">
            <WeeklyChart weeks={data.weekly} />
          </Card>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Card title="Pipeline">
              <div className="space-y-2">
                {(Object.keys(POST_STATUS_LABELS) as PostStatus[]).map((s) => {
                  const n = data.byStatus[s] ?? 0;
                  const pct = data.totals.posts ? (n / data.totals.posts) * 100 : 0;
                  return (
                    <div key={s}>
                      <div className="flex justify-between text-xs"><span>{POST_STATUS_LABELS[s]}</span><span className="text-slate-400">{n}</span></div>
                      <div className="mt-1 h-2 rounded bg-slate-800"><div className="h-2 rounded" style={{ width: `${pct}%`, backgroundColor: STATUS_COLORS[s] }} /></div>
                    </div>
                  );
                })}
              </div>
            </Card>
            <Card title="By platform">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-slate-500"><th className="pb-2">Platform</th><th className="pb-2 text-right">Posted</th><th className="pb-2 text-right">Failed</th><th className="pb-2 text-right">Pending</th></tr></thead>
                <tbody>
                  {Object.entries(data.byPlatform).map(([p, v]) => (
                    <tr key={p} className="border-t border-slate-800/60">
                      <td className="py-1.5">{PLATFORM_PRESETS[p as Platform]?.label ?? p}</td>
                      <td className="text-right text-emerald-400">{v.posted}</td>
                      <td className="text-right text-rose-400">{v.failed}</td>
                      <td className="text-right text-slate-400">{v.pending}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {Object.keys(data.byPlatform).length === 0 && <p className="text-sm text-slate-500">No posts yet.</p>}
            </Card>
            <Card title="Top creators">
              <div className="space-y-1.5">
                {data.topCreators.map((c) => (
                  <div key={c.id} className="flex justify-between text-sm"><span>{c.name}</span><span className="text-slate-400">{c.count} posts</span></div>
                ))}
                {data.topCreators.length === 0 && <p className="text-sm text-slate-500">No posts yet.</p>}
              </div>
            </Card>
          </div>
          <p className="text-xs text-slate-500">Engagement metrics (reach, likes, clicks) come from each platform's own analytics and aren't pulled in yet.</p>
        </div>
      )}
    </div>
  );
}

function WeeklyChart({ weeks }: { weeks: Analytics['weekly'] }) {
  if (!weeks.length) return <p className="text-sm text-slate-500">No activity in this period.</p>;
  const max = Math.max(1, ...weeks.flatMap((w) => [w.created, w.posted, w.tasksDone]));
  const series = [
    { key: 'created' as const, label: 'Posts created', color: '#818cf8' },
    { key: 'posted' as const, label: 'Posts published', color: '#22c55e' },
    { key: 'tasksDone' as const, label: 'Tasks completed', color: '#f59e0b' },
  ];
  return (
    <div>
      <div className="flex h-48 items-end gap-2">
        {weeks.map((w) => (
          <div key={w.week} className="flex h-full flex-1 flex-col justify-end" title={`Week of ${formatDate(w.week)}`}>
            <div className="flex h-full items-end justify-center gap-0.5">
              {series.map((s) => (
                <div key={s.key} className="w-full max-w-[14px] rounded-t" style={{ height: `${(w[s.key] / max) * 100}%`, backgroundColor: s.color, minHeight: w[s.key] ? 2 : 0 }} title={`${s.label}: ${w[s.key]}`} />
              ))}
            </div>
            <div className="mt-1 truncate text-center text-[10px] text-slate-500">{new Date(`${w.week}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-4 text-xs text-slate-400">
        {series.map((s) => <span key={s.key} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: s.color }} />{s.label}</span>)}
      </div>
    </div>
  );
}
