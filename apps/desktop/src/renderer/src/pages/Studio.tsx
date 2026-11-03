import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { FileText, FolderPlus, Image as ImageIcon, Plus, Sparkles, Trash2, Wand2 } from 'lucide-react';
import { PLATFORMS, PLATFORM_PRESETS, type ContentType, type Platform } from '@mh/shared';
import { api, errorMessage, fileUrl, queryClient } from '../lib/api';
import { formatDate, fromLocalInput } from '../lib/format';
import { useProducts } from '../lib/hooks';
import type { Asset, Post } from '../lib/types';
import { Button, Card, Empty, ErrorText, Field, PageHeader, Spinner, Tabs } from '../components/ui';
import { CanvaGraphicModal } from '../components/Canva';

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

type SocialDraft = { title: string; tagline: string; subTagline: string; body: string; warnings: { code: string; message: string }[] };

function NewPost() {
  const navigate = useNavigate();
  const products = useProducts();
  const canva = useQuery({ queryKey: ['canva'], queryFn: () => api.get<{ configured: boolean; connected: boolean }>('/canva/status') });
  const templates = useQuery({
    queryKey: ['canva-templates'],
    queryFn: () => api.get<{ id: string; title: string; thumbnailUrl: string | null }[]>('/canva/templates'),
    enabled: Boolean(canva.data?.connected),
  });
  const [brief, setBrief] = useState('');
  const [title, setTitle] = useState('');
  const [tagline, setTagline] = useState('');
  const [subTagline, setSubTagline] = useState('');
  const [body, setBody] = useState('');
  const [warnings, setWarnings] = useState<{ code: string; message: string }[]>([]);
  const [draftReady, setDraftReady] = useState(false);
  const [productIds, setProductIds] = useState<string[]>([]);
  const [platforms, setPlatforms] = useState<Platform[]>(['facebook', 'instagram', 'linkedin']);
  const [adaptCopy, setAdaptCopy] = useState(true);
  const [templateId, setTemplateId] = useState('');
  const [assetId, setAssetId] = useState('');
  const [imageQuery, setImageQuery] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const libraryImages = useQuery({
    queryKey: ['assets', 'studio-canva', imageQuery, productIds[0] ?? ''],
    queryFn: () => {
      const qs = new URLSearchParams({ kind: 'IMAGE', forAi: '1', q: imageQuery });
      if (productIds[0]) qs.set('productId', productIds[0]);
      return api.get<{ items: Asset[] }>(`/library/assets?${qs}`);
    },
    enabled: draftReady,
  });

  const write = useMutation({
    mutationFn: () => api.post<SocialDraft>('/generate/social-draft', { brief, productIds, platform: platforms[0] }),
    onSuccess: (r) => {
      setTitle(r.title);
      setTagline(r.tagline);
      setSubTagline(r.subTagline);
      setBody(r.body);
      setWarnings(r.warnings ?? []);
      setDraftReady(true);
      setError(null);
    },
  });

  const createAndOpenCanva = async () => {
    setBusy(true);
    setError(null);
    try {
      if (!canva.data?.connected) throw new Error('A manager connects Canva under Settings → Social accounts first.');
      if (!templateId) throw new Error('Choose a Canva brand template.');
      if (!assetId) throw new Error('Choose a library photo for the template.');
      // Build the Canva graphic first so a template/photo failure does not leave an empty draft post.
      let libraryAssetId = assetId;
      const picked = libraryImages.data?.items.find((item) => item.id === assetId);
      if (picked && !picked.storedKey) {
        const uploaded = await window.api.library.upload(picked.id, picked.relPath) as Asset;
        libraryAssetId = uploaded.id;
      }
      const draftTitle = title.trim() || tagline.trim() || 'Social post';
      const graphic = await api.post<{ id: string; editUrl: string; filled: boolean }>('/canva/graphics', {
        title: draftTitle,
        templateId,
        headline: tagline.trim() || undefined,
        subline: subTagline.trim() || undefined,
        libraryAssetId,
        width: 1080,
        height: 1350,
      });
      const post = await api.post<Post>('/posts', {
        title: draftTitle,
        body,
        aiWarnings: warnings,
        platforms,
        perPlatformFiles: false,
        adaptCopy,
        scheduledAt: fromLocalInput(scheduledAt),
        designId: graphic.id,
      });
      await window.api.app.openExternal(graphic.editUrl);
      void queryClient.invalidateQueries({ queryKey: ['posts'] });
      navigate(`/posts/${post.id}`, {
        state: {
          notice: graphic.filled
            ? 'Canva is open with your photo, tagline, and sub-tagline filled in. When you finish, click Return in Canva. This post updates to the finished graphic, then you can approve and schedule it.'
            : 'That template had no fill-in fields, so Canva opened without changing it. Finish the design, return to Mantis, then approve and schedule this post.',
        },
      });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
      <div className="space-y-6 xl:col-span-3">
        <Card title="1. What is this post about?">
          <div className="space-y-4">
            <Field label="Brief">
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
          </div>
        </Card>

        <Card title="2. Tagline, sub-tagline & copy">
          {!draftReady ? (
            <p className="text-sm text-slate-500">Write with AI first. You can edit every field before the graphic is built.</p>
          ) : (
            <div className="space-y-4">
              <Field label="Title (internal)"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
              <Field label="Tagline" hint="Goes into the first text field on the Canva template.">
                <input className="input" value={tagline} onChange={(e) => setTagline(e.target.value)} />
              </Field>
              <Field label="Sub-tagline" hint="Goes into the second text field on the Canva template.">
                <input className="input" value={subTagline} onChange={(e) => setSubTagline(e.target.value)} />
              </Field>
              <Field label="Post copy" hint={`${body.length} characters`}>
                <textarea className="input" rows={7} value={body} onChange={(e) => setBody(e.target.value)} />
              </Field>
              {warnings.length > 0 && (
                <ul className="space-y-1 rounded border border-amber-900/60 bg-amber-950/30 px-3 py-2">
                  {warnings.map((warning, index) => <li key={index} className="text-xs text-amber-100">{warning.message}</li>)}
                </ul>
              )}
            </div>
          )}
        </Card>

        <Card title="3. Photo & Canva template">
          {!draftReady ? (
            <p className="text-sm text-slate-500">After the copy is ready, pick a library photo and a brand template.</p>
          ) : !canva.data?.configured ? (
            <p className="text-sm text-slate-500">Canva is not configured on the server yet.</p>
          ) : !canva.data.connected ? (
            <p className="text-sm text-slate-500">A manager connects Canva under Settings → Social accounts.</p>
          ) : (
            <div className="space-y-4">
              <Field label="Brand template" hint="The photo fills the image data field. Tagline and sub-tagline fill the first and second text data fields.">
                <select className="input" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                  <option value="">Choose a template</option>
                  {templates.data?.map((template) => <option key={template.id} value={template.id}>{template.title}</option>)}
                </select>
              </Field>
              {templates.error && <ErrorText error={errorMessage(templates.error)} />}
              <Field label="Library photo">
                <input className="input mb-2" placeholder="Search the library" value={imageQuery} onChange={(e) => setImageQuery(e.target.value)} />
                {productIds[0] && (
                  <div className="mb-2">
                    <ProductImagePicker productId={productIds[0]} value={assetId} onChange={setAssetId} />
                  </div>
                )}
                <div className="grid max-h-56 grid-cols-5 gap-2 overflow-y-auto">
                  {(libraryImages.data?.items ?? []).map((item) => (
                    <button key={item.id} type="button" onClick={() => setAssetId(item.id)} className={`overflow-hidden rounded border ${assetId === item.id ? 'border-sage' : 'border-slate-800'}`} title={item.relPath}>
                      {item.thumbnailKey ? <img src={fileUrl(item.thumbnailKey)} className="aspect-square w-full object-cover" /> : <ImageIcon className="m-auto h-8 w-8 text-slate-600" />}
                    </button>
                  ))}
                </div>
                {!libraryImages.data?.items.length && !libraryImages.isLoading && <p className="mt-2 text-xs text-slate-500">No library images match. Import photos under Library first.</p>}
              </Field>
            </div>
          )}
        </Card>
      </div>

      <div className="space-y-6 xl:col-span-2">
        <Card title="4. Where & when">
          <div className="space-y-4">
            <Field label="Platforms"><PlatformPicker value={platforms} onChange={setPlatforms} /></Field>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={adaptCopy} onChange={(e) => setAdaptCopy(e.target.checked)} />
              <span>Tailor copy to each platform<span className="block text-xs text-slate-500">Length limits, hashtags and tone per network.</span></span>
            </label>
            <Field label="Target publish time (optional)" hint="Final time is set when a manager approves.">
              <input type="datetime-local" className="input" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
            </Field>
          </div>
        </Card>
        <ErrorText error={error} />
        <Button
          className="w-full"
          onClick={() => void createAndOpenCanva()}
          loading={busy}
          disabled={!draftReady || !title.trim() || !body.trim() || !tagline.trim() || !templateId || !assetId || platforms.length === 0}
        >
          <Wand2 className="h-4 w-4" /> Create draft & edit in Canva
        </Button>
        <p className="text-xs text-slate-500">
          Mantis fills the template, opens Canva for you to refine it, then saves the finished graphic when you return. Approve the draft and a manager schedules it.
        </p>
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

type Graphic = {
  id: string;
  name: string;
  previewKey: string | null;
  folderId: string | null;
  canvaDesignId: string | null;
  updatedAt: string;
  createdBy: { name: string };
  products: { product: { id: string; name: string } }[];
};

function Designs() {
  const navigate = useNavigate();
  const graphics = useQuery({ queryKey: ['designs'], queryFn: () => api.get<Graphic[]>('/designs') });
  const folders = useQuery({ queryKey: ['design-folders'], queryFn: () => api.get<{ id: string; name: string }[]>('/design-folders') });
  const products = useProducts();
  const [size, setSize] = useState<Platform | 'custom'>('instagram');
  const [w, setW] = useState(1080);
  const [h, setH] = useState(1080);
  const [folder, setFolder] = useState('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [folderName, setFolderName] = useState('');
  const [productId, setProductId] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [canvaOpen, setCanvaOpen] = useState(false);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['designs'] });
    void queryClient.invalidateQueries({ queryKey: ['design-folders'] });
  };
  const visible = (graphics.data ?? []).filter((graphic) => folder === 'all' || (folder === 'unfiled' ? !graphic.folderId : graphic.folderId === folder));
  const allVisible = visible.length > 0 && visible.every((graphic) => selected.has(graphic.id));
  const start = () => {
    const d = size === 'custom' ? { width: w, height: h, label: 'Custom' } : PLATFORM_PRESETS[size];
    navigate(`/designs/new?w=${d.width}&h=${d.height}&name=${encodeURIComponent(`${d.label} graphic`)}`);
  };
  const toggle = (id: string) => setSelected((cur) => {
    const next = new Set(cur);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const showFolder = (id: string) => {
    setFolder(id);
    setSelected(new Set());
    setNotice(null);
  };
  const createFolder = useMutation({
    mutationFn: () => api.post('/design-folders', { name: folderName.trim() }),
    onSuccess: () => { setFolderName(''); refresh(); },
  });
  const deleteFolder = useMutation({
    mutationFn: (id: string) => api.del(`/design-folders/${id}`),
    onSuccess: () => { showFolder('all'); refresh(); },
  });
  const organize = useMutation({
    mutationFn: (body: { ids: string[]; folderId?: string | null; addProductIds?: string[]; removeProductIds?: string[] }) => api.patch('/designs/organize', body),
    onSuccess: () => { setNotice(null); refresh(); },
  });
  const remove = useMutation({
    mutationFn: (ids: string[]) => api.post<{ deleted: string[]; kept: string[] }>('/designs/bulk-delete', { ids }),
    onSuccess: (result) => {
      setSelected(new Set());
      setNotice(result.kept.length ? `Left in place because they are on a scheduled or posted post: ${result.kept.join(', ')}` : null);
      refresh();
    },
  });
  const ids = [...selected];
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
          <Button variant="secondary" onClick={() => setCanvaOpen(true)}>New from Canva</Button>
        </div>
      </Card>
      <div className="flex flex-wrap items-center gap-2">
        {[['all', 'All graphics'], ['unfiled', 'Unfiled']].map(([id, label]) => (
          <button key={id} type="button" onClick={() => showFolder(id)} className={`rounded-md border px-3 py-1.5 text-sm ${folder === id ? 'border-sage text-sage' : 'border-slate-700 text-slate-300'}`}>{label}</button>
        ))}
        {folders.data?.map((item) => (
          <span key={item.id} className={`inline-flex items-center rounded-md border ${folder === item.id ? 'border-sage text-sage' : 'border-slate-700 text-slate-300'}`}>
            <button type="button" onClick={() => showFolder(item.id)} className="px-3 py-1.5 text-sm">{item.name}</button>
            {folder === item.id && (
              <button type="button" title="Delete folder" className="pr-2 text-slate-400 hover:text-mist" onClick={() => {
                if (window.confirm(`Delete folder "${item.name}"? The graphics stay, under Unfiled.`)) deleteFolder.mutate(item.id);
              }}><Trash2 className="h-3.5 w-3.5" /></button>
            )}
          </span>
        ))}
        <input className="input w-40" placeholder="New folder" value={folderName} onChange={(e) => setFolderName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && folderName.trim()) createFolder.mutate(); }} />
        <Button variant="secondary" size="sm" disabled={!folderName.trim()} loading={createFolder.isPending} onClick={() => createFolder.mutate()}><FolderPlus className="h-3.5 w-3.5" /> Create folder</Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" checked={allVisible} onChange={() => setSelected(allVisible ? new Set() : new Set(visible.map((graphic) => graphic.id)))} />
          {selected.size ? `${selected.size} selected` : 'Select'}
        </label>
        <select className="input w-44 py-1 text-sm" value="" disabled={!selected.size || organize.isPending} onChange={(e) => { if (e.target.value) organize.mutate({ ids, folderId: e.target.value === 'unfiled' ? null : e.target.value }); }}>
          <option value="">Move to folder</option>
          <option value="unfiled">Unfiled</option>
          {folders.data?.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <select className="input w-44 py-1 text-sm" value={productId} onChange={(e) => setProductId(e.target.value)}>
          <option value="">Product tag</option>
          {products.data?.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
        </select>
        <Button variant="secondary" size="sm" disabled={!selected.size || !productId} loading={organize.isPending} onClick={() => organize.mutate({ ids, addProductIds: [productId] })}>Add tag</Button>
        <Button variant="danger" size="sm" disabled={!selected.size} loading={remove.isPending} onClick={() => {
          if (window.confirm(`Delete ${selected.size} graphic${selected.size === 1 ? '' : 's'}?`)) remove.mutate(ids);
        }}><Trash2 className="h-3.5 w-3.5" /> Delete</Button>
      </div>
      <ErrorText error={notice ?? (createFolder.error ? errorMessage(createFolder.error) : null) ?? (organize.error ? errorMessage(organize.error) : null) ?? (remove.error ? errorMessage(remove.error) : null) ?? (deleteFolder.error ? errorMessage(deleteFolder.error) : null)} />
      {graphics.isLoading ? <Spinner /> : !visible.length ? <Empty>{graphics.data?.length ? 'This folder is empty.' : 'No graphics yet.'}</Empty> : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
          {visible.map((graphic) => (
            <div key={graphic.id} className={`card overflow-hidden ${selected.has(graphic.id) ? 'border-sage' : ''}`}>
              <div className="relative">
                <label className="absolute left-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded bg-slate-950/80">
                  <input type="checkbox" checked={selected.has(graphic.id)} onChange={() => toggle(graphic.id)} aria-label={`Select ${graphic.name}`} />
                </label>
                <Link to={`/designs/${graphic.id}`} className="flex aspect-square items-center justify-center bg-slate-900 hover:opacity-90">
                  {graphic.previewKey ? <img src={fileUrl(graphic.previewKey)} className="max-h-full max-w-full object-contain" /> : <ImageIcon className="h-10 w-10 text-slate-700" />}
                </Link>
              </div>
              <div className="p-3">
                <Link to={`/designs/${graphic.id}`} className="block truncate text-sm hover:underline">{graphic.name}</Link>
                {graphic.canvaDesignId && (
                  <button type="button" className="mt-1 text-xs text-sage hover:underline" onClick={() => void api.post<{ url: string }>(`/canva/graphics/${graphic.id}/edit`).then((result) => window.api.app.openExternal(result.url)).catch((err) => setNotice(errorMessage(err)))}>Edit in Canva</button>
                )}
                <div className="text-xs text-slate-500">{graphic.createdBy.name} · {formatDate(graphic.updatedAt)}</div>
                {graphic.products.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {graphic.products.map(({ product }) => (
                      <button key={product.id} type="button" title={`Remove ${product.name}`} className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300 hover:bg-slate-700" onClick={() => organize.mutate({ ids: [graphic.id], removeProductIds: [product.id] })}>
                        {product.name} ×
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {canvaOpen && <CanvaGraphicModal folderId={folder === 'all' || folder === 'unfiled' ? null : folder} onClose={(message) => { setCanvaOpen(false); if (message) setNotice(message); }} />}
    </div>
  );
}
