import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink, ImageIcon, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import { POST_STATUS_LABELS, PLATFORM_PRESETS, type Platform, type PostAction } from '@mh/shared';
import { api, errorMessage, fileUrl, queryClient } from '../lib/api';
import { formatWhen, fromLocalInput, toLocalInput } from '../lib/format';
import type { PostDetail, Variant } from '../lib/types';
import { Badge, Button, Card, ErrorText, Field, Modal, Spinner, STATUS_COLORS } from '../components/ui';
import { PlatformPicker } from './Studio';
import { WorkLogLine } from './WorkLog';

const ACTION_LABELS: Partial<Record<PostAction, string>> = {
  creatorApprove: 'Approve & send to manager',
  startReview: 'Start review',
  returnToCreator: 'Return to creator',
  approve: 'Approve & schedule',
  unschedule: 'Unschedule',
  retry: 'Retry publishing',
};
const ACTION_VARIANT: Partial<Record<PostAction, 'primary' | 'secondary' | 'danger'>> = {
  returnToCreator: 'secondary',
  unschedule: 'secondary',
};

const STEPS = ['DRAFT', 'CREATOR_APPROVED', 'IN_REVIEW', 'SCHEDULED', 'POSTED'] as const;

export function PostDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: post, isLoading } = useQuery({ queryKey: ['post', id], queryFn: () => api.get<PostDetail>(`/posts/${id}`) });
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [scheduledAt, setScheduledAt] = useState('');
  const [variants, setVariants] = useState<Record<string, string>>({});
  const [dialog, setDialog] = useState<PostAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!post) return;
    setTitle(post.title);
    setBody(post.body);
    setPlatforms(post.platforms);
    setScheduledAt(toLocalInput(post.scheduledAt));
    setVariants(Object.fromEntries(post.variants.map((v) => [v.platform, v.body])));
  }, [post]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['post', id] });
    void queryClient.invalidateQueries({ queryKey: ['posts'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };
  const onError = (e: unknown) => setError(errorMessage(e));

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/posts/${id}`, {
        title, body, platforms, scheduledAt: fromLocalInput(scheduledAt),
        variants: post!.variants.filter((v) => platforms.includes(v.platform)).map((v) => ({ platform: v.platform, body: variants[v.platform] ?? v.body })),
      }),
    onSuccess: refresh,
    onError,
  });
  const adapt = useMutation({ mutationFn: () => api.post(`/posts/${id}/adapt`), onSuccess: refresh, onError });
  const transition = useMutation({
    mutationFn: (v: { action: PostAction; note?: string; scheduledAt?: string }) => api.post(`/posts/${id}/transition`, v),
    onSuccess: () => { setDialog(null); refresh(); },
    onError,
  });
  const del = useMutation({ mutationFn: () => api.del(`/posts/${id}`), onSuccess: () => { refresh(); navigate(-1); }, onError });

  if (isLoading || !post) return <Spinner />;
  const editable = post.editable;
  const dirty =
    title !== post.title || body !== post.body || platforms.join() !== post.platforms.join() || scheduledAt !== toLocalInput(post.scheduledAt) ||
    post.variants.some((v) => (variants[v.platform] ?? v.body) !== v.body);

  const runAction = (a: PostAction) => {
    setError(null);
    if (a === 'returnToCreator' || a === 'approve') setDialog(a);
    else if (dirty && editable) setError('Save your changes first.');
    else transition.mutate({ action: a });
  };
  const stepIndex = post.status === 'FAILED' ? 3 : STEPS.indexOf(post.status as (typeof STEPS)[number]);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4 flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}><ArrowLeft className="h-4 w-4" /> Back</Button>
        {post.campaign && <Link to={`/campaigns/${post.campaign.id}`} className="text-sm text-indigo-300 hover:underline">Campaign: {post.campaign.name}</Link>}
      </div>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold">{post.title}</h1>
            <Badge color={STATUS_COLORS[post.status]}>{POST_STATUS_LABELS[post.status]}</Badge>
          </div>
          <p className="mt-1 text-sm text-slate-400">
            Created by {post.creator.name}{post.reviewer ? ` · reviewed by ${post.reviewer.name}` : ''}
            {post.scheduledAt && ` · ${post.status === 'POSTED' ? 'posted' : 'goes out'} ${formatWhen(post.postedAt ?? post.scheduledAt)}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {post.actions.filter((a) => ACTION_LABELS[a]).map((a) => (
            <Button key={a} variant={ACTION_VARIANT[a] ?? 'primary'} onClick={() => runAction(a)} loading={transition.isPending && transition.variables?.action === a}>{ACTION_LABELS[a]}</Button>
          ))}
          {!['SCHEDULED', 'POSTED'].includes(post.status) && <Button variant="ghost" onClick={() => confirm('Delete this post?') && del.mutate()}><Trash2 className="h-4 w-4 text-rose-400" /></Button>}
        </div>
      </div>

      <div className="mb-6 flex items-center gap-1">
        {STEPS.map((s, i) => (
          <div key={s} className="flex flex-1 items-center gap-1">
            <div className={`h-1.5 flex-1 rounded-full ${i <= stepIndex ? (post.status === 'FAILED' && i === 3 ? 'bg-rose-500' : 'bg-indigo-500') : 'bg-slate-800'}`} />
            <span className={`text-[11px] ${i <= stepIndex ? 'text-slate-300' : 'text-slate-600'}`}>{post.status === 'FAILED' && i === 3 ? 'Failed' : POST_STATUS_LABELS[s]}</span>
          </div>
        ))}
      </div>

      {post.reviewNote && post.status === 'DRAFT' && (
        <div className="mb-6 rounded-lg border border-amber-800/60 bg-amber-950/40 px-4 py-3 text-sm">
          <div className="font-medium text-amber-200">Manager feedback</div>
          <p className="mt-1 whitespace-pre-wrap text-amber-100/80">{post.reviewNote}</p>
        </div>
      )}
      <ErrorText error={error} />

      <div className="mt-4 grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card title="Post" actions={editable && <Button size="sm" onClick={() => save.mutate()} loading={save.isPending} disabled={!dirty}>{post.status === 'IN_REVIEW' ? 'Save manager edits' : 'Save'}</Button>}>
            {!editable && <p className="mb-3 text-xs text-slate-500">{post.status === 'IN_REVIEW' ? 'A manager is reviewing this post.' : post.status === 'CREATOR_APPROVED' ? 'Waiting for a manager to start the review.' : 'Unschedule the post to make changes.'}</p>}
            <div className="space-y-4">
              <Field label="Title"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} disabled={!editable} /></Field>
              <Field label="Base copy"><textarea className="input" rows={4} value={body} onChange={(e) => setBody(e.target.value)} disabled={!editable} /></Field>
              <WarningLines warnings={post.aiWarnings} />
              {editable && <Field label="Platforms"><PlatformPicker value={platforms} onChange={setPlatforms} /></Field>}
              <Field label="Publish time"><input type="datetime-local" className="input w-64" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} disabled={!editable} /></Field>
            </div>
          </Card>

          <Card title="Per-platform versions" actions={editable && (
            <Button size="sm" variant="secondary" onClick={() => adapt.mutate()} loading={adapt.isPending} title="Rewrite each platform version from the base copy"><Sparkles className="h-3.5 w-3.5" /> Re-tailor copy</Button>
          )}>
            <div className="space-y-5">
              {post.variants.map((v) => (
                <VariantEditor key={v.id} variant={v} value={variants[v.platform] ?? v.body} onChange={(t) => setVariants({ ...variants, [v.platform]: t })} editable={editable} />
              ))}
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <GraphicsCard post={post} onDone={refresh} onError={onError} />
          <Card title="History">
            <div className="space-y-2">{post.history.map((e) => <WorkLogLine key={e.id} event={e} />)}</div>
          </Card>
        </div>
      </div>

      {dialog === 'returnToCreator' && (
        <NoteDialog title="Return to creator" label="What should be changed?" required onClose={() => setDialog(null)} loading={transition.isPending}
          onSubmit={(note) => transition.mutate({ action: 'returnToCreator', note })} />
      )}
      {dialog === 'approve' && (
        <ApproveDialog initial={post.scheduledAt} onClose={() => setDialog(null)} loading={transition.isPending}
          onSubmit={(when, note) => transition.mutate({ action: 'approve', scheduledAt: when, note })} />
      )}
    </div>
  );
}

function WarningLines({ warnings }: { warnings?: { message: string }[] }) {
  if (!warnings?.length) return null;
  return (
    <ul className="space-y-1 rounded border border-amber-900/60 bg-amber-950/30 px-3 py-2">
      {warnings.map((warning, index) => <li key={index} className="text-xs text-amber-100">{warning.message}</li>)}
    </ul>
  );
}

function VariantEditor({ variant, value, onChange, editable }: { variant: Variant; value: string; onChange: (v: string) => void; editable: boolean }) {
  const preset = PLATFORM_PRESETS[variant.platform];
  const over = value.length > preset.maxChars;
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-sm font-medium">{preset.label}</span>
        {variant.status === 'POSTED' && <Badge color="#22c55e">Posted</Badge>}
        {variant.status === 'FAILED' && <Badge color="#f43f5e">Failed after {variant.attempts} attempt{variant.attempts === 1 ? '' : 's'}</Badge>}
        {variant.status === 'PENDING' && variant.attempts > 0 && <Badge color="#f59e0b">Retrying ({variant.attempts})</Badge>}
        <span className="flex-1" />
        <span className={`text-xs ${over ? 'text-rose-400' : 'text-slate-500'}`}>{value.length.toLocaleString()} / {preset.maxChars.toLocaleString()}</span>
      </div>
      <textarea className={`input text-sm ${over ? 'border-rose-700' : ''}`} rows={Math.min(8, Math.max(3, Math.ceil(value.length / 90)))} value={value} onChange={(e) => onChange(e.target.value)} disabled={!editable} />
      <WarningLines warnings={variant.aiWarnings} />
      {variant.error && <p className="mt-1 text-xs text-rose-400">{variant.error}</p>}
      {variant.externalUrl && (
        <button onClick={() => void window.api.app.openExternal(variant.externalUrl!)} className="mt-1 inline-flex items-center gap-1 text-xs text-indigo-300 hover:underline"><ExternalLink className="h-3 w-3" /> View on {preset.label}</button>
      )}
    </div>
  );
}

function GraphicsCard({ post, onDone, onError }: { post: PostDetail; onDone: () => void; onError: (e: unknown) => void }) {
  const [regen, setRegen] = useState(false);
  const [headline, setHeadline] = useState(post.title);
  const [subline, setSubline] = useState('');
  const [imagePrompt, setImagePrompt] = useState('');
  const graphics = useMutation({
    mutationFn: () => api.post(`/posts/${post.id}/graphics`, { headline, subline, imagePrompt: imagePrompt || undefined }),
    onSuccess: () => { setRegen(false); onDone(); },
    onError,
  });
  const designs = new Map<string, { id: string; previewKey: string | null; platforms: Platform[] }>();
  for (const v of post.variants) {
    const d = v.design ?? post.design;
    if (!d) continue;
    const entry = designs.get(d.id) ?? { id: d.id, previewKey: d.previewKey, platforms: [] };
    entry.platforms.push(v.platform);
    designs.set(d.id, entry);
  }
  return (
    <Card title="Graphics" actions={post.editable && <Button size="sm" variant="ghost" onClick={() => setRegen(true)}><RefreshCw className="h-3.5 w-3.5" /> Regenerate</Button>}>
      {designs.size === 0 ? (
        <p className="text-sm text-slate-500">No graphics attached.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {[...designs.values()].map((d) => (
            <Link key={d.id} to={`/designs/${d.id}`} className="overflow-hidden rounded-md border border-slate-800 hover:border-slate-600" title="Open in the design editor">
              <div className="flex aspect-square items-center justify-center bg-slate-900">
                {d.previewKey ? <img src={fileUrl(d.previewKey)} className="max-h-full max-w-full object-contain" /> : <ImageIcon className="h-8 w-8 text-slate-700" />}
              </div>
              <div className="truncate px-2 py-1 text-[11px] text-slate-400">{d.platforms.map((p) => PLATFORM_PRESETS[p].label).join(', ')}</div>
            </Link>
          ))}
        </div>
      )}
      <p className="mt-3 text-xs text-slate-500">{post.perPlatformFiles ? 'One graphic per platform size.' : 'One graphic shared by all platforms.'} Click a graphic to edit its layers or export PSD, SVG, PDF or IDML.</p>
      {regen && (
        <Modal open onClose={() => setRegen(false)} title="Regenerate graphics">
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); graphics.mutate(); }}>
            <Field label="Headline"><input className="input" value={headline} onChange={(e) => setHeadline(e.target.value)} required /></Field>
            <Field label="Subline"><input className="input" value={subline} onChange={(e) => setSubline(e.target.value)} /></Field>
            <Field label="Background image prompt (optional)"><input className="input" value={imagePrompt} onChange={(e) => setImagePrompt(e.target.value)} /></Field>
            <p className="text-xs text-slate-500">This replaces the post's current graphics with new ones.</p>
            <div className="flex justify-end"><Button type="submit" loading={graphics.isPending}>Generate</Button></div>
          </form>
        </Modal>
      )}
    </Card>
  );
}

export function NoteDialog({ title, label, required, onClose, onSubmit, loading }: { title: string; label: string; required?: boolean; onClose: () => void; onSubmit: (note: string) => void; loading?: boolean }) {
  const [note, setNote] = useState('');
  return (
    <Modal open onClose={onClose} title={title}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); onSubmit(note); }}>
        <Field label={label}><textarea className="input" rows={4} value={note} onChange={(e) => setNote(e.target.value)} required={required} autoFocus /></Field>
        <div className="flex justify-end"><Button type="submit" loading={loading}>{title}</Button></div>
      </form>
    </Modal>
  );
}

function ApproveDialog({ initial, onClose, onSubmit, loading }: { initial: string | null; onClose: () => void; onSubmit: (when: string, note?: string) => void; loading?: boolean }) {
  const fallback = new Date(Date.now() + 3_600_000);
  const [when, setWhen] = useState(toLocalInput(initial && new Date(initial) > new Date() ? initial : fallback));
  const [note, setNote] = useState('');
  const past = new Date(when) < new Date();
  return (
    <Modal open onClose={onClose} title="Approve & schedule">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); onSubmit(fromLocalInput(when)!, note || undefined); }}>
        <Field label="Publish at"><input type="datetime-local" className="input" value={when} onChange={(e) => setWhen(e.target.value)} required /></Field>
        {past && <p className="text-xs text-amber-400">This time has passed. Choose a time in the future.</p>}
        <Field label="Note to creator (optional)"><textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <p className="text-xs text-slate-500">The post will be published automatically to each platform's default account. Failures retry up to 3 times.</p>
        <div className="flex justify-end"><Button type="submit" loading={loading} disabled={past}>Approve & schedule</Button></div>
      </form>
    </Modal>
  );
}
