import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { FileText, Image as ImageIcon, Plus, Sparkles, Wand2 } from 'lucide-react';
import { PLATFORMS, PLATFORM_PRESETS, type ContentType, type Platform } from '@mh/shared';
import { api, errorMessage, fileUrl } from '../lib/api';
import { formatDate, fromLocalInput } from '../lib/format';
import { useProducts } from '../lib/hooks';
import type { Asset, Post } from '../lib/types';
import { Button, Card, Empty, ErrorText, Field, PageHeader, Spinner, Tabs } from '../components/ui';

type Tab = 'post' | 'write' | 'designs';

export function StudioPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) ?? 'post';
  return (
    <div>
      <PageHeader title="Content studio" subtitle="Create ad hoc posts, long-form content and graphics, grounded in the knowledge base." />
      <Tabs<Tab>
        value={tab}
        onChange={(t) => setParams({ tab: t })}
        tabs={[{ id: 'post', label: 'Social post' }, { id: 'write', label: 'Emails, blogs & docs' }, { id: 'designs', label: 'Graphics' }]}
      />
      {tab === 'post' && <NewPost />}
      {tab === 'write' && <Writer />}
      {tab === 'designs' && <Designs />}
    </div>
  );
}

export function PlatformPicker({ value, onChange }: { value: Platform[]; onChange: (v: Platform[]) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {PLATFORMS.map((p) => {
        const on = value.includes(p);
        const preset = PLATFORM_PRESETS[p];
        return (
          <button
            type="button"
            key={p}
            onClick={() => onChange(on ? value.filter((x) => x !== p) : [...value, p])}
            className={`rounded-md border px-3 py-1.5 text-left text-sm ${on ? 'border-indigo-500 bg-indigo-600/20' : 'border-slate-700 text-slate-400 hover:border-slate-500'}`}
          >
            <div>{preset.label}</div>
            <div className="text-[10px] text-slate-500">{preset.width}×{preset.height} · {preset.maxChars.toLocaleString()} chars</div>
          </button>
        );
      })}
    </div>
  );
}

/** Choose a library photo of a product to feature in generated graphics. */
export function ProductImagePicker({ productId, value, onChange }: { productId: string; value: string; onChange: (id: string) => void }) {
  const { data } = useQuery({
    queryKey: ['assets', 'product-pick', productId],
    queryFn: () => api.get<{ items: Asset[] }>(`/library/assets?kind=IMAGE&forAi=1&productId=${productId}`),
    enabled: !!productId,
  });
  if (!productId) return null;
  if (!data?.items.length) return <p className="text-xs text-slate-500">No library photos of this product yet.</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {data.items.slice(0, 12).map((a) => (
        <button type="button" key={a.id} onClick={() => onChange(value === a.id ? '' : a.id)} className={`h-16 w-16 overflow-hidden rounded border-2 ${value === a.id ? 'border-indigo-500' : 'border-transparent'}`}>
          {a.thumbnailKey && <img src={fileUrl(a.thumbnailKey)} className="h-full w-full object-cover" />}
        </button>
      ))}
    </div>
  );
}

function NewPost() {
  const navigate = useNavigate();
  const products = useProducts();
  const [title, setTitle] = useState('');
  const [brief, setBrief] = useState('');
  const [body, setBody] = useState('');
  const [warnings, setWarnings] = useState<{ code: string; message: string }[]>([]);
  const [productIds, setProductIds] = useState<string[]>([]);
  const [platforms, setPlatforms] = useState<Platform[]>(['facebook', 'instagram', 'linkedin']);
  const [perPlatformFiles, setPerPlatformFiles] = useState(true);
  const [adaptCopy, setAdaptCopy] = useState(true);
  const [withGraphic, setWithGraphic] = useState(true);
  const [headline, setHeadline] = useState('');
  const [subline, setSubline] = useState('');
  const [imagePrompt, setImagePrompt] = useState('');
  const [assetId, setAssetId] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');

  const write = useMutation({
    mutationFn: () => api.post<{ text: string; warnings: { code: string; message: string }[] }>('/generate/text', { type: 'SOCIAL_POST', brief, productIds, platform: platforms[0] }),
    onSuccess: (r) => {
      setBody(r.text);
      setWarnings(r.warnings ?? []);
      if (!title) setTitle(brief.slice(0, 60));
      if (!headline) setHeadline(brief.split(/[.!?\n]/)[0].slice(0, 60));
    },
  });
  const create = useMutation({
    mutationFn: () =>
      api.post<Post>('/posts', {
        title, body, aiWarnings: warnings, platforms, perPlatformFiles, adaptCopy,
        scheduledAt: fromLocalInput(scheduledAt),
        graphic: withGraphic && headline ? { headline, subline, imagePrompt: imagePrompt || undefined, productAssetId: assetId || undefined } : undefined,
      }),
    onSuccess: (p) => navigate(`/posts/${p.id}`),
  });

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
      <div className="space-y-6 xl:col-span-3">
        <Card title="1. Copy">
          <div className="space-y-4">
            <Field label="What's the post about?">
              <textarea className="input" rows={3} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="Announce our booth at the Spring Expo, highlight the new X200 and invite people to stop by." />
            </Field>
            <Field label="Products to feature">
              <div className="flex flex-wrap gap-1.5">
                {products.data?.filter((p) => p.active).map((p) => {
                  const on = productIds.includes(p.id);
                  return (
                    <button type="button" key={p.id} onClick={() => setProductIds(on ? productIds.filter((x) => x !== p.id) : [...productIds, p.id])} className={`rounded-full border px-2.5 py-0.5 text-xs ${on ? 'border-indigo-500 bg-indigo-600/20' : 'border-slate-700 text-slate-400'}`}>
                      {p.name}
                    </button>
                  );
                })}
                {!products.data?.length && <span className="text-xs text-slate-500">No products in the knowledge base yet.</span>}
              </div>
            </Field>
            <Button variant="secondary" onClick={() => write.mutate()} loading={write.isPending} disabled={!brief.trim()}><Sparkles className="h-4 w-4" /> Write with AI</Button>
            <ErrorText error={write.error ? errorMessage(write.error) : null} />
            <Field label="Title (internal)"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
            <Field label="Post copy" hint={`${body.length} characters`}><textarea className="input" rows={7} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
            {warnings.length > 0 && (
              <ul className="space-y-1 rounded border border-amber-900/60 bg-amber-950/30 px-3 py-2">
                {warnings.map((warning, index) => <li key={index} className="text-xs text-amber-100">{warning.message}</li>)}
              </ul>
            )}
          </div>
        </Card>
        <Card title="2. Graphic">
          <label className="mb-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={withGraphic} onChange={(e) => setWithGraphic(e.target.checked)} /> Generate an editable, on-brand graphic</label>
          {withGraphic && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Headline"><input className="input" value={headline} onChange={(e) => setHeadline(e.target.value)} /></Field>
                <Field label="Subline"><input className="input" value={subline} onChange={(e) => setSubline(e.target.value)} /></Field>
              </div>
              <Field label="Background image prompt (optional)" hint="Leave empty to use brand colors only."><input className="input" value={imagePrompt} onChange={(e) => setImagePrompt(e.target.value)} placeholder="Bright modern trade show floor, soft bokeh" /></Field>
              {productIds[0] && (
                <Field label="Product photo from the library">
                  <ProductImagePicker productId={productIds[0]} value={assetId} onChange={setAssetId} />
                </Field>
              )}
            </div>
          )}
        </Card>
      </div>
      <div className="space-y-6 xl:col-span-2">
        <Card title="3. Where & when">
          <div className="space-y-4">
            <Field label="Platforms"><PlatformPicker value={platforms} onChange={setPlatforms} /></Field>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={perPlatformFiles} onChange={(e) => setPerPlatformFiles(e.target.checked)} />
              <span>Separate graphic for each platform size<span className="block text-xs text-slate-500">Otherwise one graphic is shared across platforms.</span></span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={adaptCopy} onChange={(e) => setAdaptCopy(e.target.checked)} />
              <span>Tailor copy to each platform<span className="block text-xs text-slate-500">Length limits, hashtags and tone per network.</span></span>
            </label>
            <Field label="Target publish time (optional)" hint="Final time is set when a manager approves."><input type="datetime-local" className="input" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} /></Field>
          </div>
        </Card>
        <ErrorText error={create.error ? errorMessage(create.error) : null} />
        <Button className="w-full" onClick={() => create.mutate()} loading={create.isPending} disabled={!title || !body || platforms.length === 0}>
          <Wand2 className="h-4 w-4" /> Create draft post
        </Button>
        <p className="text-xs text-slate-500">The draft goes through the approval workflow: you approve it, a manager reviews it, then it's scheduled and posted automatically.</p>
      </div>
    </div>
  );
}

const DOC_TYPES: { id: ContentType; label: string }[] = [
  { id: 'EMAIL', label: 'Email' },
  { id: 'BLOG', label: 'Blog post' },
  { id: 'DOCUMENTATION', label: 'Documentation' },
  { id: 'SOCIAL_POST', label: 'Social copy' },
];

function Writer() {
  const navigate = useNavigate();
  const products = useProducts();
  const [type, setType] = useState<ContentType>('EMAIL');
  const [brief, setBrief] = useState('');
  const [tone, setTone] = useState('');
  const [productIds, setProductIds] = useState<string[]>([]);
  const docs = useQuery({ queryKey: ['content'], queryFn: () => api.get<{ id: string; type: ContentType; title: string; updatedAt: string; createdBy: { name: string } }[]>('/content') });

  const generate = useMutation({
    mutationFn: async () => {
      const { text } = await api.post<{ text: string }>('/generate/text', { type, brief, tone: tone || undefined, productIds });
      const title = /^#\s*(.+)$/m.exec(text)?.[1] ?? /^Subject:\s*(.+)$/im.exec(text)?.[1] ?? brief.slice(0, 80);
      return api.post<{ id: string }>('/content', { type, title, body: text });
    },
    onSuccess: (d) => navigate(`/content/${d.id}`),
  });

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
      <Card title="Write something new" className="xl:col-span-2">
        <div className="space-y-4">
          <Field label="Type">
            <div className="flex flex-wrap gap-2">
              {DOC_TYPES.map((t) => (
                <button key={t.id} onClick={() => setType(t.id)} className={`rounded-md border px-3 py-1.5 text-sm ${type === t.id ? 'border-indigo-500 bg-indigo-600/20' : 'border-slate-700 text-slate-400'}`}>{t.label}</button>
              ))}
            </div>
          </Field>
          <Field label="Brief"><textarea className="input" rows={5} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="Newsletter to dealers about the Q3 price update and the new warranty terms." /></Field>
          <Field label="Tone (optional)"><input className="input" value={tone} onChange={(e) => setTone(e.target.value)} placeholder="Defaults to the brand voice" /></Field>
          <Field label="Products">
            <select multiple className="input h-24" value={productIds} onChange={(e) => setProductIds(Array.from(e.target.selectedOptions).map((o) => o.value))}>
              {products.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <ErrorText error={generate.error ? errorMessage(generate.error) : null} />
          <Button onClick={() => generate.mutate()} loading={generate.isPending} disabled={!brief.trim()}><Sparkles className="h-4 w-4" /> Generate draft</Button>
        </div>
      </Card>
      <Card title="Saved documents" className="xl:col-span-3">
        {docs.isLoading ? <Spinner /> : !docs.data?.length ? <Empty>Nothing saved yet.</Empty> : (
          <div className="divide-y divide-slate-800">
            {docs.data.map((d) => (
              <Link key={d.id} to={`/content/${d.id}`} className="flex items-center gap-3 px-2 py-2.5 hover:bg-slate-800/40">
                <FileText className="h-4 w-4 text-slate-500" />
                <span className="flex-1 truncate text-sm">{d.title}</span>
                <span className="text-xs text-slate-500">{DOC_TYPES.find((t) => t.id === d.type)?.label}</span>
                <span className="w-28 text-right text-xs text-slate-500">{formatDate(d.updatedAt)}</span>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function Designs() {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ['designs'], queryFn: () => api.get<{ id: string; name: string; previewKey: string | null; updatedAt: string; createdBy: { name: string } }[]>('/designs') });
  const [size, setSize] = useState<Platform | 'custom'>('instagram');
  const [w, setW] = useState(1080);
  const [h, setH] = useState(1080);
  const start = () => {
    const d = size === 'custom' ? { width: w, height: h, label: 'Custom' } : PLATFORM_PRESETS[size];
    navigate(`/designs/new?w=${d.width}&h=${d.height}&name=${encodeURIComponent(`${d.label} graphic`)}`);
  };
  return (
    <div className="space-y-6">
      <Card title="New graphic">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Size">
            <select className="input w-64" value={size} onChange={(e) => setSize(e.target.value as Platform | 'custom')}>
              {PLATFORMS.map((p) => <option key={p} value={p}>{PLATFORM_PRESETS[p].label} ({PLATFORM_PRESETS[p].width}×{PLATFORM_PRESETS[p].height})</option>)}
              <option value="custom">Custom size</option>
            </select>
          </Field>
          {size === 'custom' && (
            <>
              <Field label="Width"><input type="number" className="input w-28" value={w} onChange={(e) => setW(Number(e.target.value))} /></Field>
              <Field label="Height"><input type="number" className="input w-28" value={h} onChange={(e) => setH(Number(e.target.value))} /></Field>
            </>
          )}
          <Button onClick={start}><Plus className="h-4 w-4" /> Open editor</Button>
        </div>
      </Card>
      {isLoading ? <Spinner /> : !data?.length ? <Empty>No graphics yet.</Empty> : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
          {data.map((d) => (
            <Link key={d.id} to={`/designs/${d.id}`} className="card overflow-hidden hover:border-slate-600">
              <div className="flex aspect-square items-center justify-center bg-slate-900">
                {d.previewKey ? <img src={fileUrl(d.previewKey)} className="max-h-full max-w-full object-contain" /> : <ImageIcon className="h-10 w-10 text-slate-700" />}
              </div>
              <div className="p-3">
                <div className="truncate text-sm">{d.name}</div>
                <div className="text-xs text-slate-500">{d.createdBy.name} · {formatDate(d.updatedAt)}</div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
