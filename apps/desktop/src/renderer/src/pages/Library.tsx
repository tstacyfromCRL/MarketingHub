import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { Check, CheckSquare, ExternalLink, FilePlus, FileText, FolderPlus, FolderSearch, Film, ImageIcon, RefreshCw, Tag, Trash2, Upload, X } from 'lucide-react';
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
  const [picked, setPicked] = useState<string[]>([]);
  const [importBusy, setImportBusy] = useState<'FOLDER' | 'FILE' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
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
  useEffect(() => setPicked([]), [page, q, kind, productId, untagged]);
  useEffect(() => {
    void window.api.library.scanProgress().then((p) => setScanning(p.state === 'scanning'));
    return window.api.library.onProgress((p) => {
      setScanning(p.state === 'scanning');
      if (p.state === 'done') {
        void queryClient.invalidateQueries({ queryKey: ['assets'] });
        void queryClient.invalidateQueries({ queryKey: ['library-stats'] });
      }
    });
  }, []);

  const importFromDrive = async (kind: 'FOLDER' | 'FILE') => {
    setImportBusy(kind);
    setNotice(null);
    setImportError(null);
    try {
      const result = await window.api.library.importPaths(kind);
      if (result.cancelled) return;
      setNotice(result.warning ?? (result.imported === 0 && !result.error ? 'Those are already in the library.' : null));
      setImportError(result.error ?? null);
      if (result.imported > 0) void window.api.library.scan();
    } catch (err) {
      setImportError(errorMessage(err));
    } finally {
      setImportBusy(null);
    }
  };

  const togglePicked = (id: string) => setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const pageItems = assets.data?.items ?? [];

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

        <div className="mb-4 flex flex-wrap items-center gap-2">
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
          <div className="flex-1" />
          <Button size="sm" variant="secondary" onClick={() => void importFromDrive('FOLDER')} loading={importBusy === 'FOLDER'}>
            <FolderPlus className="h-3.5 w-3.5" /> Import folders
          </Button>
          <Button size="sm" onClick={() => void importFromDrive('FILE')} loading={importBusy === 'FILE'}>
            <FilePlus className="h-3.5 w-3.5" /> Import files
          </Button>
        </div>
        {scanning && <p className="mb-3 text-xs text-slate-400">Indexing imported files...</p>}
        {notice && <p className="mb-3 text-sm text-amber-200">{notice}</p>}
        <ErrorText error={importError} />
        {picked.length > 0 && <BatchBar ids={picked} items={pageItems} products={products.data ?? []} onDone={() => setPicked([])} />}

        {assets.isLoading ? (
          <Spinner />
        ) : !assets.data?.items.length ? (
          <Empty>
            {q || kind || productId || untagged
              ? 'No files match.'
              : 'Nothing is in the library yet. Import the folders or files you want. Files stay on the shared drive.'}
          </Empty>
        ) : (
          <>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
              {assets.data.items.map((a) => {
                const Icon = KIND_ICON[a.kind];
                const isPicked = picked.includes(a.id);
                return (
                  <div key={a.id} className={`group relative overflow-hidden rounded-lg border text-left ${selected === a.id || isPicked ? 'border-indigo-500' : 'border-slate-800 hover:border-slate-600'}`}>
                    <button
                      type="button"
                      title={isPicked ? 'Deselect' : 'Select'}
                      onClick={() => togglePicked(a.id)}
                      className={`absolute left-2 top-2 z-10 rounded bg-slate-950/80 p-1 ${isPicked ? 'text-indigo-300' : 'text-slate-400 opacity-0 group-hover:opacity-100'}`}
                    >
                      <CheckSquare className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" onClick={() => setParams({ asset: a.id })} className="block w-full text-left">
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
                  </div>
                );
              })}
            </div>
            {pageItems.length > 0 && (
              <div className="mt-3">
                <button className="text-xs text-slate-400 hover:text-slate-200" onClick={() => setPicked(picked.length === pageItems.length ? [] : pageItems.map((a) => a.id))}>
                  {picked.length === pageItems.length ? 'Clear selection' : 'Select all on this page'}
                </button>
              </div>
            )}
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

function refreshLibrary() {
  void queryClient.invalidateQueries({ queryKey: ['assets'] });
  void queryClient.invalidateQueries({ queryKey: ['library-stats'] });
}

/** Actions for the files checked in the thumbnail grid. */
function BatchBar({ ids, items, products, onDone }: { ids: string[]; items: Asset[]; products: { id: string; name: string }[]; onDone: () => void }) {
  const selected = items.filter((item) => ids.includes(item.id));
  const [mode, setMode] = useState<'tags' | 'product' | 'folder' | null>(null);
  const [tags, setTags] = useState('');
  const [productId, setProductId] = useState('');
  const [folder, setFolder] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      refreshLibrary();
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-4 rounded-lg border border-indigo-800/60 bg-indigo-950/30 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm">{selected.length} selected</span>
        <Button size="sm" variant="secondary" onClick={() => setMode(mode === 'tags' ? null : 'tags')}><Tag className="h-3.5 w-3.5" /> Add tags</Button>
        <Button size="sm" variant="secondary" onClick={() => setMode(mode === 'product' ? null : 'product')}>Tag product</Button>
        <Button size="sm" variant="secondary" onClick={() => setMode(mode === 'folder' ? null : 'folder')}><FolderPlus className="h-3.5 w-3.5" /> Move to folder</Button>
        <Button
          size="sm"
          variant="danger"
          loading={busy && mode === null}
          onClick={() => {
            if (!window.confirm(`Remove ${selected.length} file${selected.length === 1 ? '' : 's'} from the library? They stay on the shared drive.`)) return;
            void run(() => api.post('/library/assets/batch-edit', { ids: selected.map((item) => item.id), remove: true }));
          }}
        >
          <Trash2 className="h-3.5 w-3.5" /> Remove
        </Button>
        <button className="ml-auto text-xs text-slate-400 hover:text-slate-200" onClick={onDone}>Clear</button>
      </div>
      {mode === 'tags' && (
        <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); const addTags = tags.split(',').map((tag) => tag.trim()).filter(Boolean); if (addTags.length) void run(() => api.post('/library/assets/batch-edit', { ids: selected.map((item) => item.id), addTags })); }}>
          <input className="input flex-1" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Tags, separated by commas" autoFocus />
          <Button type="submit" size="sm" loading={busy} disabled={!tags.trim()}>Add to all</Button>
        </form>
      )}
      {mode === 'product' && (
        <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (productId) void run(() => api.post('/library/assets/batch-edit', { ids: selected.map((item) => item.id), productId })); }}>
          <select className="input flex-1" value={productId} onChange={(e) => setProductId(e.target.value)}>
            <option value="">Choose a product...</option>
            {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
          </select>
          <Button type="submit" size="sm" loading={busy} disabled={!productId}>Tag all</Button>
        </form>
      )}
      {mode === 'folder' && (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const dest = folder.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
            if (!dest) return;
            void run(async () => {
              const moves = selected.map((item) => ({ id: item.id, from: item.relPath, to: `${dest}/${item.relPath.split('/').pop()}` }));
              const result = await window.api.library.relocate(dest, moves);
              if (result.error) throw new Error(result.error);
            });
          }}
        >
          <input className="input flex-1" value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="New or existing folder, e.g. Campaigns/Spring" autoFocus />
          <Button type="submit" size="sm" loading={busy} disabled={!folder.trim()}>Create and move</Button>
        </form>
      )}
      <p className="mt-2 text-[11px] text-slate-500">Moving creates the folder on the shared drive and puts the selected files in it. Removing only takes them out of Mantis.</p>
      <ErrorText error={error} />
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

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['assets'] });
    void queryClient.invalidateQueries({ queryKey: ['library-stats'] });
  };
  const save = useMutation({ mutationFn: () => api.patch(`/library/assets/${id}`, { tags, description }), onSuccess: refresh });
  const confirmProduct = useMutation({
    mutationFn: (v: { productId: string; confirmed: boolean }) => api.put(`/library/assets/${id}/products`, v),
    onSuccess: refresh,
  });
  const retag = useMutation({ mutationFn: () => api.post(`/library/assets/${id}/retag`), onSuccess: refresh });
  const remove = useMutation({
    mutationFn: () => api.post('/library/assets/batch-edit', { ids: [id], remove: true }),
    onSuccess: () => {
      refresh();
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });
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
          <Button
            variant="danger"
            className="w-full"
            loading={remove.isPending}
            onClick={() => {
              if (window.confirm('Remove this file from the library? It stays on the shared drive.')) remove.mutate();
            }}
          >
            <Trash2 className="h-3.5 w-3.5" /> Remove from library
          </Button>
        </div>
      )}
    </aside>
  );
}
