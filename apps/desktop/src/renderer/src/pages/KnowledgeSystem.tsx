import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, download, errorMessage, queryClient } from '../lib/api';
import { formatDate } from '../lib/format';
import { isManager, useSession } from '../lib/session';
import { Badge, Button, Card, Empty, ErrorText, Field } from '../components/ui';
import { MarketLinksPanel, ProductKnowledgeEditor } from '../components/ProductKnowledgeEditor';
import type { Product } from '../lib/types';

interface Playbook {
  id: string;
  name: string;
  platform: string | null;
  contentType: string | null;
  pillar: string | null;
  body: string;
  hashtagMin: number | null;
  hashtagMax: number | null;
  maxChars: number | null;
  active: boolean;
  origin: string;
}

interface Claim {
  id: string;
  text: string;
  sourceUrl: string;
  asOf: string | null;
  expiresAt: string | null;
  status: string;
}

interface Term {
  id: string;
  term: string;
  aliases: string[];
  note: string;
}

interface Doc {
  id: string;
  title: string;
  sensitivity: string;
  origin: string;
  createdAt: string;
}

interface ProductRow {
  id: string;
  name: string;
  sku: string;
  partNumbers: string[];
  pricing: string;
  origin: string;
  connectorKey: string | null;
  lastSyncedAt: string | null;
  active: boolean;
}

interface Integration {
  id: string;
  displayName: string;
  enabled: boolean;
  secretFields: string[];
  config: Record<string, string>;
  envFallback: boolean;
}

interface PackCounts {
  created: number;
  updated: number;
  unchanged: number;
  removed: number;
  details: { key: string; action: string }[];
}

type PackReport = Record<string, PackCounts>;

const refresh = (key: string[]) => void queryClient.invalidateQueries({ queryKey: key });

export function PlaybooksTab() {
  const { user } = useSession();
  const { data } = useQuery({ queryKey: ['playbooks'], queryFn: () => api.get<Playbook[]>('/knowledge/playbooks') });
  const [draft, setDraft] = useState<Playbook | null>(null);
  const [probe, setProbe] = useState({ platform: 'linkedin', contentType: 'SOCIAL_POST', pillar: '' });
  const match = useQuery({
    queryKey: ['playbook-match', probe],
    queryFn: () => api.get<{ playbook: Playbook | null }>(`/knowledge/playbooks/match?platform=${encodeURIComponent(probe.platform)}&contentType=${encodeURIComponent(probe.contentType)}&pillar=${encodeURIComponent(probe.pillar)}`),
  });
  const save = useMutation({
    mutationFn: (row: Playbook) => api.put(`/knowledge/playbooks/${row.id}`, row),
    onSuccess: () => { setDraft(null); refresh(['playbooks']); refresh(['playbook-match']); },
  });
  if (!data) return null;
  const groups = new Map<string, Playbook[]>();
  for (const row of data) {
    const key = row.platform || 'Any platform';
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return (
    <div className="space-y-6">
      <Card title="Which playbook would be used?">
        <div className="grid grid-cols-3 gap-3">
          <Field label="Platform"><input className="input" value={probe.platform} onChange={(e) => setProbe({ ...probe, platform: e.target.value })} /></Field>
          <Field label="Content type"><input className="input" value={probe.contentType} onChange={(e) => setProbe({ ...probe, contentType: e.target.value })} /></Field>
          <Field label="Pillar"><input className="input" value={probe.pillar} onChange={(e) => setProbe({ ...probe, pillar: e.target.value })} /></Field>
        </div>
        <p className="mt-3 text-sm text-slate-300">{match.data?.playbook ? `Uses “${match.data.playbook.name}”.` : 'No playbook yet.'}</p>
      </Card>
      {[...groups.entries()].map(([platform, rows]) => (
        <Card key={platform} title={platform}>
          <div className="divide-y divide-slate-800">
            {rows.map((row) => (
              <button key={row.id} className="flex w-full items-center gap-3 py-2 text-left" onClick={() => isManager(user) && setDraft(row)}>
                <span className="flex-1 text-sm">{row.name}</span>
                <span className="text-xs text-slate-500">{[row.contentType, row.pillar].filter(Boolean).join(' · ') || 'Fallback'}</span>
                <Badge color={row.active ? '#6A8B5E' : '#64748b'}>{row.active ? row.origin : 'off'}</Badge>
              </button>
            ))}
          </div>
        </Card>
      ))}
      {draft && (
        <Card title={draft.name}>
          <div className="space-y-3">
            <Field label="Instructions"><textarea className="input" rows={6} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} /> Active</label>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDraft(null)}>Close</Button>
              <Button onClick={() => save.mutate(draft)} loading={save.isPending}>Save</Button>
            </div>
            <ErrorText error={save.error ? errorMessage(save.error) : null} />
          </div>
        </Card>
      )}
    </div>
  );
}

export function ClaimsTab() {
  const { user } = useSession();
  const { data } = useQuery({ queryKey: ['claims'], queryFn: () => api.get<Claim[]>('/knowledge/claims') });
  const [text, setText] = useState('');
  const save = useMutation({
    mutationFn: () => api.post('/knowledge/claims', { text }),
    onSuccess: () => { setText(''); refresh(['claims']); },
  });
  const setStatus = useMutation({
    mutationFn: (row: { id: string; status: string }) => api.patch(`/knowledge/claims/${row.id}`, { status: row.status }),
    onSuccess: () => refresh(['claims']),
  });
  if (!data) return null;
  const soon = (row: Claim) => {
    if (!row.expiresAt || row.status !== 'APPROVED') return false;
    const left = new Date(row.expiresAt).getTime() - Date.now();
    return left > 0 && left < 30 * 24 * 60 * 60 * 1000;
  };
  return (
    <div className="space-y-4">
      {isManager(user) && (
        <Card title="Add a claim">
          <Field label="Approved statement"><textarea className="input" rows={2} value={text} onChange={(e) => setText(e.target.value)} /></Field>
          <div className="mt-3 flex justify-end"><Button onClick={() => save.mutate()} loading={save.isPending} disabled={!text.trim()}>Add</Button></div>
        </Card>
      )}
      <div className="card divide-y divide-slate-800">
        {data.length === 0 && <Empty>No approved claims yet.</Empty>}
        {data.map((row) => (
          <div key={row.id} className={`px-4 py-3 ${soon(row) ? 'bg-amber-950/40' : ''}`}>
            <div className="flex items-start gap-3">
              <p className="flex-1 text-sm">{row.text}</p>
              <Badge color={row.status === 'APPROVED' ? '#6A8B5E' : '#64748b'}>{row.status}</Badge>
            </div>
            <div className="mt-1 flex items-center gap-3 text-xs text-slate-500">
              {row.sourceUrl && <a className="text-sage hover:underline" href={row.sourceUrl} target="_blank" rel="noreferrer">{row.sourceUrl}</a>}
              {row.asOf && <span>As of {formatDate(row.asOf)}</span>}
              {row.expiresAt && <span>Expires {formatDate(row.expiresAt)}{soon(row) ? ' · soon' : ''}</span>}
              {isManager(user) && row.status === 'APPROVED' && <button className="text-slate-300" onClick={() => setStatus.mutate({ id: row.id, status: 'RETIRED' })}>Retire</button>}
              {isManager(user) && row.status === 'RETIRED' && <button className="text-slate-300" onClick={() => setStatus.mutate({ id: row.id, status: 'APPROVED' })}>Approve</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ConfidentialTab() {
  const { user } = useSession();
  const { data } = useQuery({ queryKey: ['confidential'], queryFn: () => api.get<Term[]>('/knowledge/confidential') });
  const [term, setTerm] = useState('');
  const [aliases, setAliases] = useState('');
  const add = useMutation({
    mutationFn: () => api.post('/knowledge/confidential', { term, aliases: aliases.split(',').map((s) => s.trim()).filter(Boolean) }),
    onSuccess: () => { setTerm(''); setAliases(''); refresh(['confidential']); },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/knowledge/confidential/${id}`),
    onSuccess: () => refresh(['confidential']),
  });
  if (!data) return null;
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-400">Names the writer must never put in a draft. Customers and programs under NDA belong here.</p>
      {isManager(user) && (
        <Card title="Add a name">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Term"><input className="input" value={term} onChange={(e) => setTerm(e.target.value)} /></Field>
            <Field label="Aliases" hint="Comma-separated"><input className="input" value={aliases} onChange={(e) => setAliases(e.target.value)} /></Field>
          </div>
          <div className="mt-3 flex justify-end"><Button onClick={() => add.mutate()} loading={add.isPending} disabled={!term.trim()}>Add</Button></div>
        </Card>
      )}
      <div className="card divide-y divide-slate-800">
        {data.length === 0 && <Empty>No confidential terms.</Empty>}
        {data.map((row) => (
          <div key={row.id} className="flex items-center gap-3 px-4 py-2">
            <div className="flex-1">
              <div className="text-sm">{row.term}</div>
              {row.aliases.length > 0 && <div className="text-xs text-slate-500">{row.aliases.join(', ')}</div>}
            </div>
            {isManager(user) && <Button size="sm" variant="danger" onClick={() => remove.mutate(row.id)}>Remove</Button>}
          </div>
        ))}
      </div>
    </div>
  );
}

export function KnowledgeProductsTab() {
  const { user } = useSession();
  const { data } = useQuery({ queryKey: ['products'], queryFn: () => api.get<ProductRow[]>('/products') });
  const [editId, setEditId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const full = useQuery({
    queryKey: ['product', editId],
    queryFn: () => api.get<Product>(`/products/${editId}`),
    enabled: Boolean(editId),
  });
  const sync = useMutation({ mutationFn: () => api.post('/knowledge/products/sync', {}), onSuccess: () => refresh(['products']) });
  const upload = useMutation({
    mutationFn: (file: File) => {
      const body = new FormData();
      body.append('file', file);
      return api.post(`/knowledge/products/import?format=${file.name.endsWith('.json') ? 'json' : 'csv'}`, body);
    },
    onSuccess: () => refresh(['products']),
  });
  if (!data) return null;
  if (creating || editId) {
    if (editId && !full.data) return null;
    return (
      <ProductKnowledgeEditor
        key={editId ?? 'new'}
        product={creating ? null : full.data ?? null}
        onDone={() => { setCreating(false); setEditId(null); }}
      />
    );
  }
  return (
    <div className="space-y-4">
      <MarketLinksPanel productId={null} />
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setCreating(true)}>Add product</Button>
        {isManager(user) && <Button variant="secondary" onClick={() => sync.mutate()} loading={sync.isPending}>Sync now</Button>}
        {isManager(user) && <label className="inline-flex cursor-pointer items-center rounded-md border border-sage/40 px-3.5 py-2 text-sm text-sage">Import CSV or JSON<input type="file" accept=".csv,.json,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])} /></label>}
        <ErrorText error={sync.error ? errorMessage(sync.error) : upload.error ? errorMessage(upload.error) : null} />
      </div>
      <div className="card divide-y divide-slate-800">
        {data.length === 0 && <Empty>No products yet. Add one to record part numbers, price, what it does, and how it is used.</Empty>}
        {data.map((row) => (
          <div key={row.id} className="flex items-center gap-3 px-4 py-2">
            <div className="flex-1">
              <div className="text-sm">{row.name}{row.active ? '' : ' (archived)'}</div>
              <div className="text-xs text-slate-500">{[row.partNumbers?.length ? row.partNumbers.join(', ') : row.sku, row.pricing, row.lastSyncedAt ? `synced ${formatDate(row.lastSyncedAt)}` : ''].filter(Boolean).join(' · ')}</div>
            </div>
            <Badge color="#6A8B5E">{originLabel(row)}</Badge>
            <Button size="sm" variant="secondary" onClick={() => setEditId(row.id)}>Edit</Button>
          </div>
        ))}
      </div>
    </div>
  );
}

function originLabel(row: ProductRow): string {
  if (row.connectorKey?.startsWith('shopify:')) return 'Shopify';
  if (row.connectorKey?.startsWith('csv:')) return 'CSV';
  if (row.origin === 'pack') return 'Pack';
  if (row.origin === 'connector') return 'Connector';
  return 'Manual';
}

export function IntegrationsTab() {
  const { user } = useSession();
  const { data } = useQuery({ queryKey: ['integrations'], queryFn: () => api.get<Integration[]>('/knowledge/integrations') });
  if (!data) return null;
  return (
    <div className="space-y-4">
      {data.filter((row) => row.id !== 'csv').map((row) => <IntegrationCard key={row.id} row={row} canEdit={isManager(user)} />)}
      <Card title="CSV or JSON">
        <p className="text-sm text-slate-400">Upload a file from the Products tab. Columns: name, sku, description, price, url, features (semicolon-separated).</p>
      </Card>
    </div>
  );
}

function IntegrationCard({ row, canEdit }: { row: Integration; canEdit: boolean }) {
  const [enabled, setEnabled] = useState(row.enabled);
  const [domain, setDomain] = useState(row.config.storeDomain ?? '');
  const [version, setVersion] = useState(row.config.apiVersion ?? '2024-10');
  const [token, setToken] = useState('');
  const save = useMutation({
    mutationFn: () => api.put(`/knowledge/integrations/${row.id}`, { enabled, config: { storeDomain: domain, apiVersion: version, adminToken: token } }),
    onSuccess: () => { setToken(''); refresh(['integrations']); },
  });
  return (
    <Card title={row.displayName}>
      {row.envFallback && <p className="mb-3 text-sm text-slate-400">No saved settings. The server environment is used for this company until you save a configuration.</p>}
      <label className="mb-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} disabled={!canEdit} onChange={(e) => setEnabled(e.target.checked)} /> Enabled</label>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Store domain"><input className="input" value={domain} disabled={!canEdit} onChange={(e) => setDomain(e.target.value)} /></Field>
        <Field label="API version"><input className="input" value={version} disabled={!canEdit} onChange={(e) => setVersion(e.target.value)} /></Field>
        <Field label="Admin token" hint={row.config.adminToken === 'set' ? 'Set. Leave blank to keep it.' : 'Not set.'}>
          <input className="input" type="password" value={token} placeholder={row.config.adminToken === 'set' ? '••••' : ''} disabled={!canEdit} onChange={(e) => setToken(e.target.value)} />
        </Field>
      </div>
      {canEdit && <div className="mt-3 flex justify-end"><Button onClick={() => save.mutate()} loading={save.isPending}>Save</Button></div>}
      <ErrorText error={save.error ? errorMessage(save.error) : null} />
    </Card>
  );
}

export function DocumentsTab() {
  const { user } = useSession();
  const { data } = useQuery({ queryKey: ['documents'], queryFn: () => api.get<Doc[]>('/knowledge/documents') });
  const [level, setLevel] = useState('PUBLIC');
  const upload = useMutation({
    mutationFn: (file: File) => {
      const body = new FormData();
      body.append('file', file);
      return api.post(`/knowledge/documents?sensitivity=${level}`, body);
    },
    onSuccess: () => refresh(['documents']),
  });
  const update = useMutation({
    mutationFn: (row: { id: string; sensitivity: string }) => api.patch(`/knowledge/documents/${row.id}`, { sensitivity: row.sensitivity }),
    onSuccess: () => refresh(['documents']),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/knowledge/documents/${id}`),
    onSuccess: () => refresh(['documents']),
  });
  if (!data) return null;
  return (
    <div className="space-y-4">
      {isManager(user) && (
        <div className="flex items-end gap-3">
          <Field label="Sensitivity">
            <select className="input" value={level} onChange={(e) => setLevel(e.target.value)}>
              <option value="PUBLIC">Public</option>
              <option value="INTERNAL">Internal</option>
              <option value="RESTRICTED">Restricted</option>
            </select>
          </Field>
          <label className="inline-flex cursor-pointer items-center rounded-md bg-sage px-3.5 py-2 text-sm text-mist">Upload<input type="file" accept=".md,.txt,.pdf,.docx" className="hidden" onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])} /></label>
        </div>
      )}
      <ErrorText error={upload.error ? errorMessage(upload.error) : null} />
      <div className="card divide-y divide-slate-800">
        {data.length === 0 && <Empty>No documents.</Empty>}
        {data.map((row) => (
          <div key={row.id} className="flex items-center gap-3 px-4 py-2">
            <div className="flex-1 text-sm">{row.title}<div className="text-xs text-slate-500">{row.origin} · {formatDate(row.createdAt)}</div></div>
            {isManager(user) ? (
              <select className="input w-36" value={row.sensitivity} onChange={(e) => update.mutate({ id: row.id, sensitivity: e.target.value })}>
                <option value="PUBLIC">Public</option>
                <option value="INTERNAL">Internal</option>
                <option value="RESTRICTED">Restricted</option>
              </select>
            ) : <Badge color="#6A8B5E">{row.sensitivity}</Badge>}
            {isManager(user) && <Button size="sm" variant="danger" onClick={() => remove.mutate(row.id)}>Delete</Button>}
          </div>
        ))}
      </div>
    </div>
  );
}

export function PackTab() {
  const { user } = useSession();
  const [report, setReport] = useState<PackReport | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: (dryRun: boolean) => {
      const body = new FormData();
      body.append('file', file!);
      return api.post<PackReport>(`/knowledge/pack/import?dryRun=${dryRun ? '1' : '0'}`, body);
    },
    onSuccess: (result, dryRun) => {
      setReport(result);
      setError(null);
      if (!dryRun) { setFile(null); refresh(['playbooks']); refresh(['claims']); refresh(['products']); refresh(['documents']); refresh(['confidential']); refresh(['brand']); }
    },
    onError: (err) => setError(errorMessage(err)),
  });
  if (!isManager(user)) return <p className="text-sm text-slate-400">A manager can import or export a knowledge pack.</p>;
  return (
    <div className="space-y-4">
      <Card title="Import a pack" actions={<Button variant="secondary" onClick={() => void download('/knowledge/pack/export', 'knowledge-pack.zip')}>Export</Button>}>
        <p className="mb-3 text-sm text-slate-400">Upload a zip. Mantis shows what would change before anything is written.</p>
        <input type="file" accept=".zip" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setReport(null); }} />
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="secondary" disabled={!file} loading={run.isPending && run.variables === true} onClick={() => run.mutate(true)}>Preview</Button>
          <Button disabled={!file || !report} loading={run.isPending && run.variables === false} onClick={() => run.mutate(false)}>Confirm import</Button>
        </div>
        <ErrorText error={error} />
      </Card>
      {report && (
        <Card title="Changes">
          <div className="space-y-3">
            {Object.entries(report).map(([name, counts]) => (
              <div key={name}>
                <div className="text-sm">{name}: {counts.created} created, {counts.updated} updated, {counts.unchanged} unchanged, {counts.removed} removed</div>
                {counts.details?.filter((d) => d.action !== 'unchanged').slice(0, 8).map((d) => (
                  <div key={`${name}-${d.key}-${d.action}`} className="text-xs text-slate-500">{d.action} {d.key}</div>
                ))}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
