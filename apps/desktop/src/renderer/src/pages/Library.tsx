import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { Check, ExternalLink, FileText, FolderSearch, Film, ImageIcon, RefreshCw, Upload, X } from 'lucide-react';
import { api, errorMessage, fileUrl, queryClient } from '../lib/api';
import { formatDate } from '../lib/format';
import { useProducts } from '../lib/hooks';
import type { Asset } from '../lib/types';
import { Badge, Button, Card, ChipInput, Empty, ErrorText, Field, PageHeader, Spinner } from '../components/ui';
import { LibraryLocation } from '../components/LibraryLocation';

interface Stats {
  byKind: Record<string, number>;
  untagged: number;
  missing: number;
  lastScanAt: string | null;
  scanning: { machine: string; since: string } | null;
}

const KIND_ICON = { IMAGE: ImageIcon, VIDEO: Film, DOCUMENT: FileText, OTHER: FileText };

export function LibraryPage() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [productId, setProductId] = useState('');
  const [untagged, setUntagged] = useState(false);
  const [page, setPage] = useState(1);
  const [showLocation, setShowLocation] = useState(false);
  const products = useProducts();
  const selected = params.get('asset');

  const qs = new URLSearchParams({ page: String(page) });
  if (q) qs.set('q', q);
  if (kind) qs.set('kind', kind);
  if (productId) qs.set('productId', productId);
  if (untagged) qs.set('untagged', '1');

  const stats = useQuery({ queryKey: ['library-stats'], queryFn: () => api.get<Stats | null>('/library/stats') });
  const assets = useQuery({
    queryKey: ['assets', qs.toString()],
    queryFn: () => api.get<{ items: Asset[]; total: number; pageSize: number }>(`/library/assets?${qs.toString()}`),
    placeholderData: keepPreviousData,
  });
  useEffect(() => setPage(1), [q, kind, productId, untagged]);

  const total = Object.values(stats.data?.byKind ?? {}).reduce((a, b) => a + b, 0);
  const pages = Math.max(1, Math.ceil((assets.data?.total ?? 0) / (assets.data?.pageSize ?? 60)));

  return (
    <div className="flex gap-6">
      <div className="min-w-0 flex-1">
        <PageHeader
          title="Asset library"
          subtitle={
            stats.data
              ? `${total.toLocaleString()} files indexed${stats.data.lastScanAt ? ` · last scan ${formatDate(stats.data.lastScanAt)}` : ''}${stats.data.untagged ? ` · ${stats.data.untagged} waiting for AI tagging` : ''}${stats.data.scanning ? ` · ${stats.data.scanning.machine} is scanning now` : ''}`
              : 'The library has not been set up yet.'
          }
          actions={<Button variant="secondary" onClick={() => setShowLocation((s) => !s)}><FolderSearch className="h-4 w-4" /> Library location</Button>}
        />
        {showLocation && <Card className="mb-4"><LibraryLocation /></Card>}

        <div className="mb-4 flex flex-wrap gap-2">
          <input className="input max-w-xs" placeholder="Search by file name, tag or description..." value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="input w-36" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">All types</option>
            <option value="IMAGE">Images</option>
            <option value="VIDEO">Videos</option>
            <option value="DOCUMENT">Documents</option>
          </select>
          <select className="input w-48" value={productId} onChange={(e) => setProductId(e.target.value)}>
            <option value="">Any product</option>
            {products.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-sm text-slate-300">
            <input type="checkbox" checked={untagged} onChange={(e) => setUntagged(e.target.checked)} /> Not tagged yet
          </label>
        </div>

        {assets.isLoading ? (
          <Spinner />
        ) : !assets.data?.items.length ? (
          <Empty>No files match. If the library is new, select its location and run a scan.</Empty>
        ) : (
          <>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
              {assets.data.items.map((a) => {
                const Icon = KIND_ICON[a.kind];
                return (
                  <button
                    key={a.id}
                    onClick={() => setParams({ asset: a.id })}
                    className={`group overflow-hidden rounded-lg border text-left ${selected === a.id ? 'border-indigo-500' : 'border-slate-800 hover:border-slate-600'}`}
                  >
                    <div className="flex aspect-square items-center justify-center bg-slate-900">
                      {a.thumbnailKey ? <img src={fileUrl(a.thumbnailKey)} className="h-full w-full object-cover" loading="lazy" /> : <Icon className="h-10 w-10 text-slate-600" />}
                    </div>
                    <div className="p-2">
                      <div className="truncate text-xs" title={a.relPath}>{a.relPath.split('/').pop()}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {a.products.filter((p) => p.confirmed !== false).slice(0, 2).map((p) => (
                          <Badge key={p.productId} color={p.confirmed ? '#22c55e' : '#f59e0b'}>{p.product.name}{p.confirmed ? '' : '?'}</Badge>
                        ))}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            {pages > 1 && (
              <div className="mt-4 flex items-center justify-center gap-3 text-sm">
                <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
                <span className="text-slate-400">Page {page} of {pages}</span>
                <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
              </div>
            )}
          </>
        )}
      </div>
      {selected && <AssetDrawer id={selected} onClose={() => setParams({})} />}
    </div>
  );
}

function AssetDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: asset } = useQuery({ queryKey: ['assets', 'one', id], queryFn: () => api.get<Asset>(`/library/assets/${id}`) });
  const products = useProducts();
  const [tags, setTags] = useState<string[]>([]);
  const [description, setDescription] = useState('');
  const [addProduct, setAddProduct] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (asset) {
      setTags(asset.tags);
      setDescription(asset.description);
    }
  }, [asset]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['assets'] });
  const save = useMutation({ mutationFn: () => api.patch(`/library/assets/${id}`, { tags, description }), onSuccess: refresh });
  const confirmProduct = useMutation({
    mutationFn: (v: { productId: string; confirmed: boolean }) => api.put(`/library/assets/${id}/products`, v),
    onSuccess: refresh,
  });
  const retag = useMutation({ mutationFn: () => api.post(`/library/assets/${id}/retag`), onSuccess: refresh });
  const upload = useMutation({
    mutationFn: () => window.api.library.upload(id, asset!.relPath),
    onSuccess: refresh,
    onError: (e) => setError(errorMessage(e)),
  });
  const local = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(`${errorMessage(e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`);
    }
  };

  return (
    <aside className="card sticky top-0 h-[calc(100vh-7rem)] w-96 shrink-0 overflow-y-auto">
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <span className="text-sm font-semibold">File details</span>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-200"><X className="h-4 w-4" /></button>
      </div>
      {!asset ? (
        <Spinner />
      ) : (
        <div className="space-y-4 p-4">
          {asset.thumbnailKey && <img src={fileUrl(asset.storedKey ?? asset.thumbnailKey)} className="w-full rounded-md bg-slate-900 object-contain" />}
          <div>
            <div className="break-all font-mono text-xs text-slate-300">{asset.relPath}</div>
            <div className="mt-1 text-xs text-slate-500">{(asset.size / 1024 / 1024).toFixed(2)} MB · modified {formatDate(asset.mtime)}</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => void local(() => window.api.library.open(asset.relPath))}><ExternalLink className="h-3.5 w-3.5" /> Open</Button>
            <Button size="sm" variant="secondary" onClick={() => void local(() => window.api.library.reveal(asset.relPath))}><FolderSearch className="h-3.5 w-3.5" /> Show in folder</Button>
            {asset.kind === 'IMAGE' && !asset.storedKey && (
              <Button size="sm" variant="secondary" onClick={() => upload.mutate()} loading={upload.isPending} title="Uploads the full-resolution file so it can be used in designs and posts">
                <Upload className="h-3.5 w-3.5" /> Use in content
              </Button>
            )}
            {asset.storedKey && <Badge color="#22c55e">Available for designs</Badge>}
          </div>
          <ErrorText error={error} />

          <div>
            <div className="label">Products in this image</div>
            <div className="space-y-1.5">
              {asset.products.length === 0 && <p className="text-xs text-slate-500">{asset.needsTagging ? 'AI analysis pending.' : 'No products recognized.'}</p>}
              {asset.products.map((p) => (
                <div key={p.productId} className="flex items-center gap-2 text-sm">
                  <span className={`flex-1 ${p.confirmed === false ? 'text-slate-500 line-through' : ''}`}>{p.product.name}</span>
                  <span className="text-xs text-slate-500">{p.confirmed === null ? `${Math.round(p.similarity * 100)}% match` : p.confirmed ? 'confirmed' : 'rejected'}</span>
                  <button title="Confirm" onClick={() => confirmProduct.mutate({ productId: p.productId, confirmed: true })} className={`rounded p-1 ${p.confirmed ? 'bg-emerald-700 text-white' : 'text-slate-400 hover:bg-slate-800'}`}><Check className="h-3.5 w-3.5" /></button>
                  <button title="Not this product" onClick={() => confirmProduct.mutate({ productId: p.productId, confirmed: false })} className={`rounded p-1 ${p.confirmed === false ? 'bg-rose-700 text-white' : 'text-slate-400 hover:bg-slate-800'}`}><X className="h-3.5 w-3.5" /></button>
                </div>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              <select className="input flex-1" value={addProduct} onChange={(e) => setAddProduct(e.target.value)}>
                <option value="">Tag a product...</option>
                {products.data?.filter((p) => !asset.products.some((x) => x.productId === p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <Button size="sm" disabled={!addProduct} onClick={() => { confirmProduct.mutate({ productId: addProduct, confirmed: true }); setAddProduct(''); }}>Add</Button>
            </div>
            <p className="mt-1.5 text-[11px] text-slate-500">Confirming teaches the matcher what each product looks like.</p>
          </div>

          <Field label="Description"><textarea className="input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
          <Field label="Tags"><ChipInput value={tags} onChange={setTags} /></Field>
          <div className="flex justify-between">
            <Button size="sm" variant="ghost" onClick={() => retag.mutate()} loading={retag.isPending}><RefreshCw className="h-3.5 w-3.5" /> Re-run AI tagging</Button>
            <Button size="sm" onClick={() => save.mutate()} loading={save.isPending}>Save</Button>
          </div>
        </div>
      )}
    </aside>
  );
}
