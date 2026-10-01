import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Plus, Trash2, X } from 'lucide-react';
import { CAMPAIGN_DURATIONS, endDateForDuration, POST_STATUS_LABELS, type CampaignDuration, type Platform, type PostStatus } from '@mh/shared';
import { api, errorMessage, queryClient } from '../lib/api';
import { formatDate, formatWhen, isoDay } from '../lib/format';
import { useProducts } from '../lib/hooks';
import { isManager, useSession } from '../lib/session';
import type { Campaign, Post } from '../lib/types';
import { Badge, Button, Card, Empty, ErrorText, Field, PageHeader, Spinner, STATUS_COLORS } from '../components/ui';
import { PostTable } from '../components/PostTable';
import { PlatformPicker } from './Studio';

export function CampaignsPage() {
  const { data, isLoading } = useQuery({ queryKey: ['campaigns'], queryFn: () => api.get<Campaign[]>('/campaigns') });
  return (
    <div>
      <PageHeader title="Campaigns" subtitle="Plan a week, month or quarter of posts in one go." actions={<Link to="/campaigns/new"><Button><Plus className="h-4 w-4" /> New campaign</Button></Link>} />
      {isLoading ? <Spinner /> : !data?.length ? <Empty>No campaigns yet.</Empty> : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {data.map((c) => (
            <Link key={c.id} to={`/campaigns/${c.id}`} className="card block p-4 hover:border-slate-600">
              <div className="flex items-center gap-2">
                <span className="flex-1 font-medium">{c.name}</span>
                {c.status === 'GENERATING' && <Badge color="#38bdf8">Generating...</Badge>}
                {c.status === 'FAILED' && <Badge color="#f43f5e">Generation failed</Badge>}
              </div>
              <div className="mt-1 text-xs text-slate-500">{formatDate(c.startDate)} – {formatDate(c.endDate)} · {c._count?.posts ?? 0} posts · by {c.createdBy.name}</div>
              <p className="mt-2 line-clamp-2 text-sm text-slate-400">{c.brief}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {Object.entries(c.statusCounts ?? {}).map(([s, n]) => <Badge key={s} color={STATUS_COLORS[s]}>{n} {POST_STATUS_LABELS[s as PostStatus]}</Badge>)}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function NewCampaignPage() {
  const navigate = useNavigate();
  const products = useProducts();
  const today = isoDay(new Date(Date.now() + 86_400_000));
  const [name, setName] = useState('');
  const [brief, setBrief] = useState('');
  const [startDate, setStartDate] = useState(today);
  const [duration, setDuration] = useState<CampaignDuration | 'custom'>('month');
  const [endDate, setEndDate] = useState(endDateForDuration(today, 'month'));
  const [postDays, setPostDays] = useState<number[]>([1, 3, 5]);
  const [postTimes, setPostTimes] = useState<string[]>(['10:00']);
  const [newTime, setNewTime] = useState('14:00');
  const [platforms, setPlatforms] = useState<Platform[]>(['facebook', 'instagram', 'linkedin']);
  const [perPlatformFiles, setPerPlatformFiles] = useState(true);
  const [generateGraphics, setGenerateGraphics] = useState(true);
  const [productIds, setProductIds] = useState<string[]>([]);

  useEffect(() => {
    if (duration !== 'custom' && startDate) setEndDate(endDateForDuration(startDate, duration));
  }, [startDate, duration]);

  const body = {
    name: name || 'Untitled campaign', brief: brief || '-', startDate, endDate, postDays, postTimes,
    utcOffsetMinutes: -new Date().getTimezoneOffset(), platforms, perPlatformFiles, productIds, generateGraphics,
  };
  const valid = postDays.length > 0 && postTimes.length > 0 && platforms.length > 0 && startDate && endDate >= startDate;
  const preview = useQuery({
    queryKey: ['campaign-preview', JSON.stringify({ startDate, endDate, postDays, postTimes })],
    queryFn: () => api.post<{ count: number; capped: boolean; max: number; slots: string[] }>('/campaigns/preview', body),
    enabled: !!valid,
  });
  const create = useMutation({
    mutationFn: () => api.post<Campaign>('/campaigns', body),
    onSuccess: (c) => { void queryClient.invalidateQueries({ queryKey: ['campaigns'] }); navigate(`/campaigns/${c.id}`); },
  });

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="New campaign" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <Card title="What">
            <div className="space-y-4">
              <Field label="Campaign name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Spring launch" /></Field>
              <Field label="Brief" hint="Goals, key messages, offers, events and anything the posts should mention. The knowledge base fills in the rest.">
                <textarea className="input" rows={6} value={brief} onChange={(e) => setBrief(e.target.value)} />
              </Field>
              <Field label="Products">
                <div className="flex flex-wrap gap-1.5">
                  {products.data?.filter((p) => p.active).map((p) => {
                    const on = productIds.includes(p.id);
                    return <button type="button" key={p.id} onClick={() => setProductIds(on ? productIds.filter((x) => x !== p.id) : [...productIds, p.id])} className={`rounded-full border px-2.5 py-0.5 text-xs ${on ? 'border-indigo-500 bg-indigo-600/20' : 'border-slate-700 text-slate-400'}`}>{p.name}</button>;
                  })}
                </div>
              </Field>
            </div>
          </Card>
          <Card title="Where">
            <div className="space-y-4">
              <PlatformPicker value={platforms} onChange={setPlatforms} />
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={generateGraphics} onChange={(e) => setGenerateGraphics(e.target.checked)} /> Generate a graphic for every post</label>
              {generateGraphics && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={perPlatformFiles} onChange={(e) => setPerPlatformFiles(e.target.checked)} /> Separate file per platform size</label>}
            </div>
          </Card>
        </div>
        <div className="space-y-6 lg:col-span-2">
          <Card title="When">
            <div className="space-y-4">
              <Field label="Start date"><input type="date" className="input" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></Field>
              <Field label="Length">
                <div className="flex gap-1">
                  {(Object.keys(CAMPAIGN_DURATIONS) as CampaignDuration[]).map((d) => (
                    <Button key={d} size="sm" variant={duration === d ? 'primary' : 'secondary'} onClick={() => setDuration(d)} className="capitalize">{d}</Button>
                  ))}
                  <Button size="sm" variant={duration === 'custom' ? 'primary' : 'secondary'} onClick={() => setDuration('custom')}>Custom</Button>
                </div>
              </Field>
              <Field label="End date"><input type="date" className="input" value={endDate} onChange={(e) => { setDuration('custom'); setEndDate(e.target.value); }} /></Field>
              <Field label="Posting days">
                <div className="flex gap-1">
                  {DAYS.map((d, i) => (
                    <button key={d} type="button" onClick={() => setPostDays(postDays.includes(i) ? postDays.filter((x) => x !== i) : [...postDays, i].sort())} className={`w-10 rounded-md border py-1 text-xs ${postDays.includes(i) ? 'border-indigo-500 bg-indigo-600/20' : 'border-slate-700 text-slate-400'}`}>{d}</button>
                  ))}
                </div>
              </Field>
              <Field label="Times each posting day" hint="One post per time.">
                <div className="flex flex-wrap items-center gap-1.5">
                  {postTimes.map((t) => (
                    <span key={t} className="inline-flex items-center gap-1 rounded bg-slate-800 px-2 py-1 text-xs">
                      {t}<button onClick={() => setPostTimes(postTimes.filter((x) => x !== t))} className="text-slate-500 hover:text-slate-200"><X className="h-3 w-3" /></button>
                    </span>
                  ))}
                  <input type="time" className="input w-28 py-1 text-xs" value={newTime} onChange={(e) => setNewTime(e.target.value)} />
                  <Button size="sm" variant="secondary" onClick={() => newTime && !postTimes.includes(newTime) && setPostTimes([...postTimes, newTime].sort())}>Add</Button>
                </div>
              </Field>
            </div>
          </Card>
          <Card title="Preview">
            {!valid ? <p className="text-sm text-slate-500">Pick days, times and platforms.</p> : preview.isLoading ? <Spinner /> : preview.data && (
              <div>
                <div className="text-2xl font-semibold">{Math.min(preview.data.count, preview.data.max)} posts</div>
                <div className="text-xs text-slate-500">× {platforms.length} platform{platforms.length === 1 ? '' : 's'}{generateGraphics ? `, ${perPlatformFiles ? Math.min(preview.data.count, preview.data.max) * platforms.length : Math.min(preview.data.count, preview.data.max)} graphics` : ''}</div>
                {preview.data.capped && <p className="mt-2 text-xs text-amber-400">Capped at {preview.data.max} posts. Shorten the campaign or post less often.</p>}
                <div className="mt-3 max-h-40 space-y-0.5 overflow-y-auto text-xs text-slate-400">
                  {preview.data.slots.slice(0, 30).map((s) => <div key={s}>{formatWhen(s)}</div>)}
                  {preview.data.slots.length > 30 && <div>…and {preview.data.slots.length - 30} more</div>}
                </div>
              </div>
            )}
          </Card>
          <ErrorText error={create.error ? errorMessage(create.error) : null} />
          <Button className="w-full" onClick={() => create.mutate()} loading={create.isPending} disabled={!valid || !name || !brief || !preview.data?.count}>Generate campaign</Button>
          <p className="text-xs text-slate-500">Posts are created as drafts. Review them, approve in bulk, and a manager takes it from there.</p>
        </div>
      </div>
    </div>
  );
}

export function CampaignDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useSession();
  const { data: c, isLoading } = useQuery({
    queryKey: ['campaign', id],
    queryFn: () => api.get<Campaign & { posts: Post[] }>(`/campaigns/${id}`),
    refetchInterval: (q) => (q.state.data?.status === 'GENERATING' ? 3000 : false),
  });
  const del = useMutation({
    mutationFn: (withPosts: boolean) => api.del(`/campaigns/${id}${withPosts ? '?withPosts=1' : ''}`),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['campaigns'] }); navigate('/campaigns'); },
  });
  if (isLoading || !c) return <Spinner />;
  const manager = isManager(user);
  return (
    <div>
      <Button variant="ghost" size="sm" onClick={() => navigate('/campaigns')} className="mb-3"><ArrowLeft className="h-4 w-4" /> Campaigns</Button>
      <PageHeader
        title={c.name}
        subtitle={`${formatDate(c.startDate)} – ${formatDate(c.endDate)} · by ${c.createdBy.name}`}
        actions={
          <>
            <Button variant="ghost" onClick={() => { const withPosts = confirm('Also delete all of its draft posts? (Cancel keeps the posts.)'); del.mutate(withPosts); }}><Trash2 className="h-4 w-4 text-rose-400" /> Delete</Button>
          </>
        }
      />
      <ErrorText error={del.error ? errorMessage(del.error) : null} />
      <Card className="mb-6"><p className="whitespace-pre-wrap text-sm text-slate-300">{c.brief}</p></Card>
      {c.status === 'GENERATING' && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-sky-800 bg-sky-950/40 px-4 py-3 text-sm text-sky-200">
          <Loader2 className="h-4 w-4 animate-spin" /> Writing posts and building graphics... {c.posts.length} ready so far.
        </div>
      )}
      {c.status === 'FAILED' && <div className="mb-4"><ErrorText error={`Generation stopped: ${c.error ?? 'unknown error'}`} /></div>}
      <PostTable
        posts={c.posts}
        bulkActions={manager ? ['creatorApprove', 'startReview', 'approve'] : ['creatorApprove']}
        empty={c.status === 'GENERATING' ? 'Posts will appear here as they are generated.' : 'This campaign has no posts.'}
      />
    </div>
  );
}
