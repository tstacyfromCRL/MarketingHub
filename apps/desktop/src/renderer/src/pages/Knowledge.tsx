import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Plus, RefreshCw, Search, Sparkles, Trash2 } from 'lucide-react';
import { PLATFORMS, PLATFORM_PRESETS, type BrandProfileInput, type CompanySummary, type SourceKind } from '@mh/shared';
import { api, errorMessage, queryClient } from '../lib/api';
import { formatDate } from '../lib/format';
import { isManager, useSession } from '../lib/session';
import type { KnowledgeSource } from '../lib/types';
import { Badge, Button, Card, ChipInput, Empty, ErrorText, Field, Modal, PageHeader, Spinner } from '../components/ui';
import { BrandFileUploader } from '../components/BrandKit';
import { ClaimsTab, ConfidentialTab, DocumentsTab, IntegrationsTab, KnowledgeProductsTab, PackTab, PlaybooksTab } from './KnowledgeSystem';

const TABS = [
  { to: 'profile', label: 'Brand' },
  { to: 'playbooks', label: 'Playbooks' },
  { to: 'claims', label: 'Claims' },
  { to: 'confidential', label: 'Confidential' },
  { to: 'catalog', label: 'Products' },
  { to: 'integrations', label: 'Integrations' },
  { to: 'documents', label: 'Documents' },
  { to: 'sources', label: 'Links & examples' },
  { to: 'accomplishments', label: 'Accomplishments' },
  { to: 'pack', label: 'Import / Export' },
  { to: 'search', label: 'What the AI knows' },
];

export function KnowledgePage() {
  return (
    <div>
      <PageHeader title="Knowledge base" subtitle="Everything the AI knows about the company. Edits are used in all new content." />
      <div className="mb-6 flex flex-wrap gap-1 border-b border-slate-800">
        {TABS.map((t) => (
          <NavLink key={t.to} to={`/knowledge/${t.to}`} className={({ isActive }) => `-mb-px border-b-2 px-3 py-2 text-sm ${isActive ? 'border-indigo-500 text-white' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>
            {t.label}
          </NavLink>
        ))}
      </div>
      <Routes>
        <Route index element={<Navigate to="profile" replace />} />
        <Route path="profile" element={<ProfileTab />} />
        <Route path="brand" element={<Navigate to="/knowledge/profile" replace />} />
        <Route path="products" element={<Navigate to="/products" replace />} />
        <Route path="products/:id" element={<ProductRedirect />} />
        <Route path="accomplishments" element={<AccomplishmentsTab />} />
        <Route path="sources" element={<SourcesTab />} />
        <Route path="playbooks" element={<PlaybooksTab />} />
        <Route path="claims" element={<ClaimsTab />} />
        <Route path="confidential" element={<ConfidentialTab />} />
        <Route path="catalog" element={<KnowledgeProductsTab />} />
        <Route path="integrations" element={<IntegrationsTab />} />
        <Route path="documents" element={<DocumentsTab />} />
        <Route path="pack" element={<PackTab />} />
        <Route path="search" element={<RetrievalTab />} />
      </Routes>
    </div>
  );
}

function ProductRedirect() {
  const { id } = useParams();
  return <Navigate to={`/products/${id}`} replace />;
}

// ---------------------------------------------------------------------------
// Company profile
// ---------------------------------------------------------------------------

type Profile = Pick<BrandProfileInput, 'companyName' | 'website' | 'summary' | 'tagline' | 'mission' | 'audience' | 'voice' | 'visualIdentity' | 'dos' | 'donts'>;

function ProfileTab() {
  const { user } = useSession();
  const { data } = useQuery({ queryKey: ['brand'], queryFn: () => api.get<BrandProfileInput>('/brand') });
  const [b, setB] = useState<Profile | null>(null);
  const [proposal, setProposal] = useState<CompanySummary | null>(null);
  useEffect(() => {
    if (data) setB({ companyName: data.companyName, website: data.website, summary: data.summary, tagline: data.tagline, mission: data.mission, audience: data.audience, voice: data.voice, visualIdentity: data.visualIdentity, dos: data.dos, donts: data.donts });
  }, [data]);
  const save = useMutation({
    mutationFn: () => api.patch<BrandProfileInput>('/brand', b),
    onSuccess: (r) => queryClient.setQueryData(['brand'], r),
  });
  const refresh = useMutation({ mutationFn: () => api.post<CompanySummary>('/brand/summary/refresh'), onSuccess: setProposal });
  if (!b) return <Spinner />;
  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => setB({ ...b, [k]: v });

  return (
    <div className="max-w-4xl space-y-6">
      <Card
        title="About the company"
        actions={isManager(user) && (
          <Button size="sm" variant="secondary" onClick={() => refresh.mutate()} loading={refresh.isPending} title="Suggest an updated summary from everything in the Knowledge Base">
            {!refresh.isPending && <Sparkles className="h-3.5 w-3.5" />} Refresh summary from knowledge
          </Button>
        )}
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="Company name"><input className="input" value={b.companyName} onChange={(e) => set('companyName', e.target.value)} /></Field>
          <Field label="Website"><input className="input" value={b.website} onChange={(e) => set('website', e.target.value)} /></Field>
          <Field label="What the company does" className="col-span-2" hint="The AI reads this before writing anything.">
            <textarea className="input" rows={6} value={b.summary} onChange={(e) => set('summary', e.target.value)} />
          </Field>
          <Field label="Tagline"><input className="input" value={b.tagline} onChange={(e) => set('tagline', e.target.value)} /></Field>
          <Field label="Mission"><input className="input" value={b.mission} onChange={(e) => set('mission', e.target.value)} /></Field>
          <Field label="Target audience" className="col-span-2"><textarea className="input" rows={2} value={b.audience} onChange={(e) => set('audience', e.target.value)} /></Field>
        </div>
        <ErrorText error={refresh.error ? errorMessage(refresh.error) : null} />
      </Card>
      <Card title="Brand voice">
        <div className="grid grid-cols-2 gap-4">
          <Field label="How we sound" className="col-span-2" hint="Tone, personality, sentence style, emoji and hashtag habits. Sample posts (under Links, text & sample posts) teach the style too.">
            <textarea className="input" rows={5} value={b.voice} onChange={(e) => set('voice', e.target.value)} />
          </Field>
          <Field label="Always do"><ChipInput value={b.dos} onChange={(v) => set('dos', v)} /></Field>
          <Field label="Never do"><ChipInput value={b.donts} onChange={(v) => set('donts', v)} /></Field>
        </div>
      </Card>
      <Card title="How posts should look">
        <Field label="Appearance" hint="Layout, photography, color, and what to leave out. This is the same visual identity as Brand kit, and it is added to every generated image. Save profile to keep this text.">
          <textarea className="input" rows={4} value={b.visualIdentity} onChange={(e) => set('visualIdentity', e.target.value)} />
        </Field>
        <div className="mt-4">
          <BrandFileUploader kind="STYLE" accept="image/png,image/jpeg,image/webp" hint="Drop past post graphics. The four newest are sent with each new image as style examples. Pictures save when you drop them." />
        </div>
      </Card>
      <div className="flex items-center justify-end gap-3">
        {save.isSuccess && <span className="text-sm text-emerald-400">Saved</span>}
        <ErrorText error={save.error ? errorMessage(save.error) : null} />
        <Button onClick={() => save.mutate()} loading={save.isPending}>Save profile</Button>
      </div>
      {proposal && (
        <SummaryProposal
          current={b}
          proposal={proposal}
          onClose={() => setProposal(null)}
          onAccept={(p) => {
            setB({ ...b, ...p });
            setProposal(null);
          }}
        />
      )}
    </div>
  );
}

function SummaryProposal({ current, proposal, onClose, onAccept }: { current: Profile; proposal: CompanySummary; onClose: () => void; onAccept: (p: CompanySummary) => void }) {
  const [p, setP] = useState(proposal);
  return (
    <Modal open onClose={onClose} title="Suggested summary update" width="max-w-3xl">
      <div className="space-y-4">
        <p className="text-sm text-slate-400">Based on everything in the Knowledge Base. Edit it if needed, then use it and click Save profile.</p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <span className="label">Current</span>
            <p className="whitespace-pre-line rounded-md bg-slate-900 p-3 text-sm text-slate-400">{current.summary || 'Empty'}</p>
          </div>
          <Field label="Suggested"><textarea className="input" rows={10} value={p.summary} onChange={(e) => setP({ ...p, summary: e.target.value })} /></Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Tagline"><input className="input" value={p.tagline} onChange={(e) => setP({ ...p, tagline: e.target.value })} /></Field>
          <Field label="Mission"><input className="input" value={p.mission} onChange={(e) => setP({ ...p, mission: e.target.value })} /></Field>
          <Field label="Audience"><input className="input" value={p.audience} onChange={(e) => setP({ ...p, audience: e.target.value })} /></Field>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Keep current</Button>
          <Button onClick={() => onAccept(p)}>Use suggestion</Button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Accomplishments
// ---------------------------------------------------------------------------

interface Accomplishment { id: string; title: string; date: string | null; description: string }

function AccomplishmentsTab() {
  const { data } = useQuery({ queryKey: ['accomplishments'], queryFn: () => api.get<Accomplishment[]>('/accomplishments') });
  const [editing, setEditing] = useState<Accomplishment | 'new' | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['accomplishments'] });
  return (
    <div>
      <div className="mb-4 flex justify-end"><Button onClick={() => setEditing('new')}><Plus className="h-4 w-4" /> Add accomplishment</Button></div>
      {!data?.length ? <Empty>Awards, milestones, customer wins, press. The AI uses these as proof points.</Empty> : (
        <div className="space-y-2">
          {data.map((a) => (
            <div key={a.id} className="card flex items-start gap-4 p-4">
              <div className="w-24 shrink-0 text-xs text-slate-500">{a.date ? formatDate(a.date) : 'No date'}</div>
              <div className="flex-1">
                <div className="font-medium">{a.title}</div>
                <p className="mt-1 text-sm text-slate-400">{a.description}</p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setEditing(a)}>Edit</Button>
              <Button size="sm" variant="ghost" onClick={() => void api.del(`/accomplishments/${a.id}`).then(refresh)}><Trash2 className="h-3.5 w-3.5 text-rose-400" /></Button>
            </div>
          ))}
        </div>
      )}
      {editing && <AccomplishmentModal item={editing === 'new' ? undefined : editing} onClose={() => { setEditing(null); void refresh(); }} />}
    </div>
  );
}

function AccomplishmentModal({ item, onClose }: { item?: Accomplishment; onClose: () => void }) {
  const [title, setTitle] = useState(item?.title ?? '');
  const [date, setDate] = useState(item?.date?.slice(0, 10) ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const save = useMutation({
    mutationFn: () => {
      const body = { title, date: date || null, description };
      return item ? api.patch(`/accomplishments/${item.id}`, body) : api.post('/accomplishments', body);
    },
    onSuccess: onClose,
  });
  return (
    <Modal open onClose={onClose} title={item ? 'Edit accomplishment' : 'Add accomplishment'}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <Field label="Title"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} required /></Field>
        <Field label="Date"><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Details"><textarea className="input" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <ErrorText error={save.error ? errorMessage(save.error) : null} />
        <div className="flex justify-end"><Button type="submit" loading={save.isPending}>Save</Button></div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

const KIND_LABELS: Record<SourceKind, string> = { WEBSITE: 'Website', ARTICLE: 'Article', LINKEDIN: 'LinkedIn', MANUAL: 'Text', SAMPLE_POST: 'Sample post', DOCUMENT: 'Document' };
const KIND_FILTERS: { id: 'ALL' | 'WEB' | 'MANUAL' | 'SAMPLE_POST'; label: string; kinds: SourceKind[] }[] = [
  { id: 'ALL', label: 'All', kinds: ['WEBSITE', 'ARTICLE', 'LINKEDIN', 'MANUAL', 'SAMPLE_POST'] },
  { id: 'WEB', label: 'Websites & articles', kinds: ['WEBSITE', 'ARTICLE', 'LINKEDIN'] },
  { id: 'MANUAL', label: 'Text & descriptions', kinds: ['MANUAL'] },
  { id: 'SAMPLE_POST', label: 'Sample posts', kinds: ['SAMPLE_POST'] },
];

function SourcesTab() {
  const { data } = useQuery({
    queryKey: ['sources'],
    queryFn: () => api.get<KnowledgeSource[]>('/sources'),
    refetchInterval: (q) => (q.state.data?.some((s) => s.status === 'PENDING') ? 3000 : false),
  });
  const [filter, setFilter] = useState<(typeof KIND_FILTERS)[number]['id']>('ALL');
  const [adding, setAdding] = useState<'source' | 'sample' | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['sources'] });
  const statusColor = { PENDING: '#f59e0b', OK: '#22c55e', ERROR: '#f43f5e' };
  const kinds = KIND_FILTERS.find((f) => f.id === filter)!.kinds;
  const shown = (data ?? []).filter((s) => kinds.includes(s.kind));
  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <div className="flex flex-1 gap-1">
          {KIND_FILTERS.map((f) => (
            <button key={f.id} onClick={() => setFilter(f.id)} className={`rounded-full px-3 py-1 text-xs ${filter === f.id ? 'bg-indigo-600/30 text-indigo-200' : 'bg-slate-800 text-slate-400 hover:text-slate-200'}`}>
              {f.label}
            </button>
          ))}
        </div>
        <Button variant="secondary" onClick={() => setAdding('sample')}><Plus className="h-4 w-4" /> Sample post</Button>
        <Button onClick={() => setAdding('source')}><Plus className="h-4 w-4" /> Link or text</Button>
      </div>
      {!shown.length ? (
        <Empty>
          {filter === 'SAMPLE_POST'
            ? 'Paste past social posts you like. The AI copies their style (not their content).'
            : 'Add your website, blog posts, press articles and case studies. The text is pulled in and kept up to date.'}
        </Empty>
      ) : (
        <div className="card divide-y divide-slate-800">
          {shown.map((s) => (
            <div key={s.id} className="flex items-center gap-3 px-4 py-3">
              <Badge color={statusColor[s.status]}>{s.status === 'OK' ? 'indexed' : s.status.toLowerCase()}</Badge>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">{s.title || s.url || 'Pasted text'}</div>
                <div className="truncate text-xs text-slate-500">
                  {KIND_LABELS[s.kind]}
                  {s.platform ? ` · ${PLATFORM_PRESETS[s.platform as keyof typeof PLATFORM_PRESETS]?.label ?? s.platform}` : ''}
                  {s.productId ? ' · product page' : ''}
                  {s.url ? ` · ${s.url}` : ''}
                  {s.lastCrawledAt ? ` · updated ${formatDate(s.lastCrawledAt)}` : ''}
                  {s.recrawlDays ? ` · refreshes every ${s.recrawlDays}d` : ''}
                </div>
                {s.error && <div className="text-xs text-rose-400">{s.error}</div>}
              </div>
              {s.url && s.kind !== 'LINKEDIN' && s.kind !== 'SAMPLE_POST' && (
                <Button size="sm" variant="ghost" title="Re-fetch now" onClick={() => void api.post(`/sources/${s.id}/refresh`).then(refresh)}><RefreshCw className="h-3.5 w-3.5" /></Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => void api.del(`/sources/${s.id}`).then(refresh)}><Trash2 className="h-3.5 w-3.5 text-rose-400" /></Button>
            </div>
          ))}
        </div>
      )}
      {adding === 'source' && <SourceModal onClose={() => { setAdding(null); void refresh(); }} />}
      {adding === 'sample' && <SamplePostModal onClose={() => { setAdding(null); void refresh(); }} />}
    </div>
  );
}

function SourceModal({ onClose }: { onClose: () => void }) {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [recrawl, setRecrawl] = useState('');
  const isLinkedIn = /linkedin\.com/i.test(url);
  const kind = !url ? 'MANUAL' : isLinkedIn ? 'LINKEDIN' : 'WEBSITE';
  const save = useMutation({
    mutationFn: () => api.post('/sources', { url: url || undefined, kind, title, content, recrawlDays: recrawl ? Number(recrawl) : null }),
    onSuccess: onClose,
  });
  return (
    <Modal open onClose={onClose} title="Add knowledge source" width="max-w-xl">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <Field label="URL" hint="Leave empty to paste text instead."><input className="input" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.example.com/about" /></Field>
        {isLinkedIn && <p className="rounded-md bg-amber-950/50 px-3 py-2 text-sm text-amber-200">LinkedIn doesn't allow automatic scraping. Paste the post or page text below and it will be saved with this link.</p>}
        <Field label="Title (optional)"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        {(kind !== 'WEBSITE') && <Field label="Text"><textarea className="input" rows={8} value={content} onChange={(e) => setContent(e.target.value)} required /></Field>}
        {kind === 'WEBSITE' && (
          <Field label="Keep up to date">
            <select className="input" value={recrawl} onChange={(e) => setRecrawl(e.target.value)}>
              <option value="">Fetch once</option>
              <option value="1">Daily</option>
              <option value="7">Weekly</option>
              <option value="30">Monthly</option>
            </select>
          </Field>
        )}
        <ErrorText error={save.error ? errorMessage(save.error) : null} />
        <div className="flex justify-end"><Button type="submit" loading={save.isPending}>Add</Button></div>
      </form>
    </Modal>
  );
}

function SamplePostModal({ onClose }: { onClose: () => void }) {
  const [content, setContent] = useState('');
  const [platform, setPlatform] = useState('');
  const [url, setUrl] = useState('');
  const save = useMutation({
    mutationFn: () => api.post('/sources', { kind: 'SAMPLE_POST', content, platform: platform || null, url: url.trim() || undefined }),
    onSuccess: onClose,
  });
  return (
    <Modal open onClose={onClose} title="Add sample post" width="max-w-xl">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <Field label="Post text"><textarea className="input" rows={8} value={content} onChange={(e) => setContent(e.target.value)} required autoFocus /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Platform (optional)">
            <select className="input" value={platform} onChange={(e) => setPlatform(e.target.value)}>
              <option value="">Any</option>
              {PLATFORMS.map((p) => <option key={p} value={p}>{PLATFORM_PRESETS[p].label}</option>)}
            </select>
          </Field>
          <Field label="Link (optional)"><input className="input" type="url" value={url} onChange={(e) => setUrl(e.target.value)} /></Field>
        </div>
        <ErrorText error={save.error ? errorMessage(save.error) : null} />
        <div className="flex justify-end"><Button type="submit" loading={save.isPending}>Add</Button></div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Retrieval test
// ---------------------------------------------------------------------------

function RetrievalTab() {
  const [q, setQ] = useState('');
  const [submitted, setSubmitted] = useState('');
  const { data, isFetching } = useQuery({
    queryKey: ['knowledge-search', submitted],
    queryFn: () => api.get<{ id: string; sourceType: string; text: string; score: number }[]>(`/knowledge/search?q=${encodeURIComponent(submitted)}`),
    enabled: !!submitted,
  });
  return (
    <div className="max-w-3xl">
      <form className="mb-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); setSubmitted(q); }}>
        <input className="input flex-1" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask what the AI knows, e.g. 'warranty on the X200'" />
        <Button type="submit" loading={isFetching}><Search className="h-4 w-4" /> Search</Button>
      </form>
      <p className="mb-4 text-xs text-slate-500">These are the passages content generation would draw on for this topic.</p>
      <div className="space-y-3">
        {data?.length === 0 && <Empty>Nothing relevant found. Add it to the knowledge base.</Empty>}
        {data?.map((c) => (
          <div key={c.id} className="card p-4">
            <div className="mb-1 flex justify-between text-xs text-slate-500"><span>{c.sourceType.toLowerCase()}</span><span>{Math.round(Number(c.score) * 100)}% relevant</span></div>
            <p className="whitespace-pre-wrap text-sm">{c.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
