import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { assetHiddenFromAi, libraryCardProductTags, libraryScanBar, type LibraryScanProgress } from '@mh/shared';
import { Check, CheckSquare, ExternalLink, EyeOff, FilePlus, FileText, FolderPlus, FolderSearch, Film, ImageIcon, ImagePlus, RefreshCw, Tag, Trash2, Upload, X } from 'lucide-react';
import { api, errorMessage, fileUrl, queryClient } from '../lib/api';
import { formatDate } from '../lib/format';
import { useProducts } from '../lib/hooks';
import type { Asset } from '../lib/types';
import { CanvaLibraryBrowser } from '../components/CanvaLibrary';
import { Badge, Button, Card, ChipInput, Empty, ErrorText, Field, PageHeader, Spinner, Tabs } from '../components/ui';
import { LibraryLocation } from '../components/LibraryLocation';

interface Stats {
  byKind: Record<string, number>;
  untagged: number;
  missing: number;
  lastScanAt: string | null;
  scanning: { machine: string; since: string } | null;
}

const KIND_ICON = { IMAGE: ImageIcon, VIDEO: Film, DOCUMENT: FileText, OTHER: FileText };

interface LibraryPath {
  id: string;
  relPath: string;
  kind: 'FOLDER' | 'FILE';
}

export function LibraryPage() {
  const [params, setParams] = useSearchParams();
  const source = params.get('source') === 'canva' ? 'canva' : 'drive';
  const stats = useQuery({ queryKey: ['library-stats'], queryFn: () => api.get<Stats | null>('/library/stats') });
  const [showLocation, setShowLocation] = useState(false);
  const total = Object.values(stats.data?.byKind ?? {}).reduce((a, b) => a + b, 0);

  const intro = (
    <>
      <PageHeader
        title="Asset library"
        subtitle={
          source === 'canva'
            ? 'Folders and uploaded images from the connected Canva account.'
            : stats.data
              ? `${total.toLocaleString()} files indexed${stats.data.lastScanAt ? ` · last scan ${formatDate(stats.data.lastScanAt)}` : ''}${stats.data.untagged ? ` · ${stats.data.untagged} waiting for AI tagging` : ''}${stats.data.scanning ? ` · ${stats.data.scanning.machine} is scanning now` : ''}`
              : 'The library has not been set up yet.'
        }
        actions={source === 'drive' ? <Button variant="secondary" onClick={() => setShowLocation((s) => !s)}><FolderSearch className="h-4 w-4" /> Library location</Button> : undefined}
      />
      <Tabs
        tabs={[{ id: 'drive', label: 'Shared drive' }, { id: 'canva', label: 'Canva' }]}
        value={source}
        onChange={(next) => setParams(next === 'canva' ? { source: 'canva' } : {})}
      />
      {source === 'drive' && showLocation && <Card className="mb-4"><LibraryLocation /></Card>}
    </>
  );
  if (source === 'canva') {
    return (
      <div className="pt-6">
        {intro}
        <CanvaLibraryBrowser />
      </div>
    );
  }
  return <DriveLibrary intro={intro} />;
}

function DriveLibrary({ intro }: { intro: ReactNode }) {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [toolbarHeight, setToolbarHeight] = useState(0);
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [productId, setProductId] = useState('');
  const [untagged, setUntagged] = useState(false);
  const [page, setPage] = useState(1);
  const [picked, setPicked] = useState<string[]>([]);
  const [importBusy, setImportBusy] = useState<'FOLDER' | 'FILE' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [progress, setProgress] = useState<LibraryScanProgress | null>(null);
  const products = useProducts();
  const imports = useQuery({ queryKey: ['library-imports'], queryFn: () => api.get<LibraryPath[]>('/library/imports') });
  const holds = useQuery({ queryKey: ['library-holds'], queryFn: () => api.get<LibraryPath[]>('/library/holds') });
  const selected = params.get('asset');

  const qs = new URLSearchParams({ page: String(page) });
  if (q) qs.set('q', q);
  if (kind) qs.set('kind', kind);
  if (productId) qs.set('productId', productId);
  if (untagged) qs.set('untagged', '1');

  const assets = useQuery({
    queryKey: ['assets', qs.toString()],
    queryFn: () => api.get<{ items: Asset[]; total: number; pageSize: number }>(`/library/assets?${qs.toString()}`),
    placeholderData: keepPreviousData,
  });
  useEffect(() => setPage(1), [q, kind, productId, untagged]);
  useEffect(() => setPicked([]), [page, q, kind, productId, untagged]);
  useEffect(() => {
    void window.api.library.scanProgress().then(setProgress);
    let lastUploaded = 0;
    return window.api.library.onProgress((p) => {
      setProgress(p);
      // Files land in the DB per batch; refresh the grid while thumbnails are still running.
      const batchLanded = (p.state === 'scanning' || p.state === 'paused') && p.uploaded > lastUploaded;
      if (batchLanded) lastUploaded = p.uploaded;
      if (batchLanded || p.state === 'done' || p.state === 'cancelled' || p.state === 'error') {
        void queryClient.invalidateQueries({ queryKey: ['assets'] });
        void queryClient.invalidateQueries({ queryKey: ['library-stats'] });
        void queryClient.invalidateQueries({ queryKey: ['library-imports'] });
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
      void queryClient.invalidateQueries({ queryKey: ['library-imports'] });
      if (result.imported > 0) void window.api.library.scan();
    } catch (err) {
      setImportError(errorMessage(err));
    } finally {
      setImportBusy(null);
    }
  };

  const togglePicked = (id: string) => setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const pageItems = assets.data?.items ?? [];
  const pages = Math.max(1, Math.ceil((assets.data?.total ?? 0) / (assets.data?.pageSize ?? 60)));

  // The file panel sticks under this bar, so it needs the bar's live height.
  useEffect(() => {
    const bar = toolbarRef.current;
    if (!bar) return;
    const measure = () => setToolbarHeight(bar.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);

  return (
    <div>
      {/* First row under the Studio menu. The page title scrolls away beneath it. */}
      <div ref={toolbarRef} className="sticky top-0 z-20 -mx-8 mb-0 border-b border-white/10 bg-ink px-8 py-3">
          <div className="flex flex-wrap items-center gap-2">
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
          {picked.length > 0 && <div className="mt-3"><BatchBar ids={picked} items={pageItems} products={products.data ?? []} onDone={() => setPicked([])} /></div>}
          {(progress?.state === 'scanning' || progress?.state === 'paused' || progress?.state === 'cancelled' || progress?.state === 'error') && (
            <ImportProgress progress={progress} />
          )}
        </div>
        <div className="flex gap-6 pt-6">
      <div className="min-w-0 flex-1">
        {intro}
        <FolderFlags imports={imports.data ?? []} holds={holds.data ?? []} />
        {notice && <p className="mb-3 text-sm text-amber-200">{notice}</p>}
        <ErrorText error={importError} />

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
                const cardTags = libraryCardProductTags(a.products);
                return (
                  <div key={a.id} className={`group relative overflow-hidden rounded-lg border text-left ${a.notForPublicUse ? 'opacity-60' : ''} ${selected === a.id || isPicked ? 'border-indigo-500' : 'border-slate-800 hover:border-slate-600'}`}>
                    <button
                      type="button"
                      title={isPicked ? 'Deselect' : 'Select'}
                      onClick={() => togglePicked(a.id)}
                      className={`absolute left-2 top-2 z-10 rounded bg-slate-950/80 p-1 ${isPicked ? 'text-indigo-300' : 'text-slate-400 opacity-0 group-hover:opacity-100'}`}
                    >
                      <CheckSquare className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" onClick={() => setParams({ asset: a.id })} className="block w-full text-left">
                    <div className={`relative flex aspect-square items-center justify-center bg-slate-900 ${a.notForPublicUse ? 'grayscale' : ''}`}>
                      {a.thumbnailKey ? <img src={fileUrl(a.thumbnailKey)} className="h-full w-full object-cover" loading="lazy" /> : <Icon className="h-10 w-10 text-slate-600" />}
                      {a.notForPublicUse && <span className="absolute bottom-1.5 left-1.5 right-1.5 truncate rounded bg-slate-950/85 px-1 py-0.5 text-center text-[10px] text-slate-300">Not for public use</span>}
                    </div>
                    <div className={`px-2 pt-2 ${cardTags.length ? '' : 'pb-2'}`}>
                      <div className="truncate text-xs" title={a.relPath}>{a.relPath.split('/').pop()}</div>
                    </div>
                    </button>
                    {/* Confirm and reject sit on the orange suggestion so a decision does not require opening the file. */}
                    <CardProductTags asset={a} />
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
      {selected && <AssetDrawer id={selected} holds={holds.data ?? []} offset={toolbarHeight} onClose={() => setParams({})} />}
        </div>
    </div>
  );
}

/** Found vs indexed for the import that is running. Pause and cancel stay beside the bar. */
function ImportProgress({ progress }: { progress: LibraryScanProgress }) {
  const percent = libraryScanBar(progress.phase, progress.found, progress.indexed);
  const working = progress.state === 'scanning' || progress.state === 'paused';
  return (
    <div className="mt-3 flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <div className="mb-1 text-xs text-slate-300">
          {progress.state === 'cancelled' || progress.state === 'error'
            ? progress.message
            : `${progress.found.toLocaleString()} found · ${progress.indexed.toLocaleString()} indexed${progress.state === 'paused' ? ' · Paused' : ''}`}
        </div>
        {working && (
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
            {percent == null ? (
              <div className="h-full w-1/3 animate-pulse rounded-full bg-indigo-500" />
            ) : (
              <div className="h-full rounded-full bg-indigo-500 transition-[width]" style={{ width: `${percent}%` }} />
            )}
          </div>
        )}
      </div>
      {working && (
        <>
          {progress.state === 'paused' ? (
            <Button size="sm" variant="secondary" onClick={() => void window.api.library.resumeScan()}>Resume</Button>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => void window.api.library.pauseScan()}>Pause</Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => void window.api.library.cancelScan()}>Cancel import</Button>
        </>
      )}
    </div>
  );
}

function refreshLibrary() {
  void queryClient.invalidateQueries({ queryKey: ['assets'] });
  void queryClient.invalidateQueries({ queryKey: ['library-stats'] });
  void queryClient.invalidateQueries({ queryKey: ['library-holds'] });
}

/** Orange tags are unconfirmed product matches. The check and X only stay while that decision is open. */
function CardProductTags({ asset }: { asset: Asset }) {
  const [error, setError] = useState<string | null>(null);
  const shown = libraryCardProductTags(asset.products);
  const confirm = useMutation({
    mutationFn: (v: { productId: string; confirmed: boolean }) => api.put(`/library/assets/${asset.id}/products`, v),
    onMutate: async (v) => {
      setError(null);
      await queryClient.cancelQueries({ queryKey: ['assets'] });
      const snapshots = queryClient.getQueriesData({ queryKey: ['assets'] });
      queryClient.setQueriesData<{ items: Asset[] }>({ queryKey: ['assets'] }, (old) => {
        if (!old?.items) return old;
        return {
          ...old,
          items: old.items.map((item) => item.id === asset.id
            ? { ...item, products: item.products.map((product) => product.productId === v.productId ? { ...product, confirmed: v.confirmed } : product) }
            : item),
        };
      });
      return { snapshots };
    },
    onError: (err, _v, ctx) => {
      ctx?.snapshots.forEach(([key, data]) => queryClient.setQueryData(key, data));
      setError(errorMessage(err));
    },
    onSettled: refreshLibrary,
  });
  if (!shown.length && !error) return null;
  return (
    <div className="px-2 pb-2">
      <div className="mt-1 flex flex-wrap items-center gap-1">
        {shown.map((product) => {
          const pending = product.confirmed === null;
          return (
            <span key={product.productId} className="inline-flex max-w-full items-center gap-0.5">
              <Badge color={pending ? '#f59e0b' : '#22c55e'}>{product.product.name}{pending ? '?' : ''}</Badge>
              {pending && (
                <>
                  <button
                    type="button"
                    title={`Confirm ${product.product.name}`}
                    disabled={confirm.isPending}
                    onClick={() => confirm.mutate({ productId: product.productId, confirmed: true })}
                    className="rounded p-0.5 text-emerald-400 hover:bg-emerald-950 disabled:opacity-50"
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    title={`Not ${product.product.name}`}
                    disabled={confirm.isPending}
                    onClick={() => confirm.mutate({ productId: product.productId, confirmed: false })}
                    className="rounded p-0.5 text-rose-400 hover:bg-rose-950 disabled:opacity-50"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
            </span>
          );
        })}
      </div>
      {error && <p className="mt-1 text-[10px] text-rose-400">{error}</p>}
    </div>
  );
}

/** Imported folders, so a whole folder can be kept out of AI without flagging each file. */
function FolderFlags({ imports, holds }: { imports: LibraryPath[]; holds: LibraryPath[] }) {
  const folders = [
    ...imports.filter((row) => row.kind === 'FOLDER'),
    ...holds.filter((row) => row.kind === 'FOLDER' && !imports.some((item) => item.kind === 'FOLDER' && item.relPath.toLowerCase() === row.relPath.toLowerCase())),
  ];
  const [busy, setBusy] = useState<string | null>(null);
  if (!folders.length) return null;
  const toggle = async (relPath: string, hidden: boolean) => {
    setBusy(relPath);
    try {
      await api.post('/library/holds', { relPath, kind: 'FOLDER', hidden });
      refreshLibrary();
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <span className="text-xs text-slate-500">Folders</span>
      {folders.map((folder) => {
        const covered = holds.some((hold) => hold.kind === 'FOLDER' && hold.relPath.toLowerCase() === folder.relPath.toLowerCase());
        const hidden = covered || holds.some((hold) => hold.kind === 'FOLDER' && assetHiddenFromAi(`${folder.relPath}/file`, [hold]));
        return (
          <button
            key={folder.id}
            type="button"
            disabled={busy === folder.relPath}
            title={covered ? 'Allow AI to use files in this folder' : 'Keep this folder out of AI'}
            onClick={() => void toggle(folder.relPath, !covered)}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${covered || hidden ? 'border-slate-600 bg-slate-800/80 text-slate-400' : 'border-slate-700 text-slate-300 hover:border-slate-500'}`}
          >
            {(covered || hidden) && <EyeOff className="h-3 w-3" />}
            {folder.relPath || 'Whole drive'}
          </button>
        );
      })}
    </div>
  );
}

/** Actions for the files checked in the thumbnail grid. */
function BatchBar({ ids, items, products, onDone }: { ids: string[]; items: Asset[]; products: { id: string; name: string }[]; onDone: () => void }) {
  const navigate = useNavigate();
  const selected = items.filter((item) => ids.includes(item.id));
  const allHidden = selected.length > 0 && selected.every((item) => item.notForPublicUse);
  const oneImage = selected.length === 1 && selected[0].kind === 'IMAGE' ? selected[0] : null;
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
    <div className="rounded-lg border border-indigo-800/60 bg-indigo-950/30 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm">{selected.length} selected</span>
        <Button size="sm" variant="secondary" onClick={() => setMode(mode === 'tags' ? null : 'tags')}><Tag className="h-3.5 w-3.5" /> Add tags</Button>
        <Button size="sm" variant="secondary" onClick={() => setMode(mode === 'product' ? null : 'product')}>Tag product</Button>
        <Button size="sm" variant="secondary" onClick={() => setMode(mode === 'folder' ? null : 'folder')}><FolderPlus className="h-3.5 w-3.5" /> Move to folder</Button>
        <Button size="sm" variant="secondary" loading={busy && mode === null} onClick={() => void run(() => api.post('/library/assets/batch-edit', { ids: selected.map((item) => item.id), notForPublicUse: !allHidden }))}>
          <EyeOff className="h-3.5 w-3.5" /> {allHidden ? 'Allow AI' : 'Not for public use'}
        </Button>
        {oneImage && (
          <Button
            size="sm"
            onClick={() => navigate(`/designs/new?w=1080&h=1080&name=${encodeURIComponent(oneImage.relPath.split('/').pop() ?? 'Graphic')}&asset=${oneImage.id}`)}
          >
            <ImagePlus className="h-3.5 w-3.5" /> Use in New Design
          </Button>
        )}
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

/** The file's own flag, plus the folder flag when a parent folder is what keeps AI away. */
function PublicUseFlag({ asset, holds, busy, onFlag, onRefresh }: {
  asset: Asset;
  holds: LibraryPath[];
  busy: boolean;
  onFlag: (hidden: boolean) => void;
  onRefresh: () => void;
}) {
  const folder = asset.relPath.includes('/') ? asset.relPath.slice(0, asset.relPath.lastIndexOf('/')) : null;
  const folderHold = holds.find((hold) => hold.kind === 'FOLDER' && assetHiddenFromAi(asset.relPath, [hold]));
  const own = holds.some((hold) => hold.kind === 'FILE' && hold.relPath.toLowerCase() === asset.relPath.toLowerCase());
  const [folderBusy, setFolderBusy] = useState(false);
  const toggleFolder = async (hidden: boolean) => {
    if (!folder) return;
    setFolderBusy(true);
    try {
      await api.post('/library/holds', { relPath: folderHold?.relPath ?? folder, kind: 'FOLDER', hidden });
      onRefresh();
    } finally {
      setFolderBusy(false);
    }
  };
  return (
    <div className="space-y-2 rounded-md border border-slate-800 px-3 py-2">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={own || Boolean(folderHold)} disabled={busy || Boolean(folderHold)} onChange={(e) => onFlag(e.target.checked)} />
        Not for public use
      </label>
      <p className="text-[11px] text-slate-500">The file stays in the library. AI will not tag it, match it to a product, or place it in a generated graphic.</p>
      {folder && (
        <Button size="sm" variant="secondary" loading={folderBusy} onClick={() => void toggleFolder(!folderHold)}>
          <EyeOff className="h-3.5 w-3.5" /> {folderHold ? `Allow AI in ${folderHold.relPath}` : `Flag folder ${folder}`}
        </Button>
      )}
    </div>
  );
}

function AssetDrawer({ id, holds, offset, onClose }: { id: string; holds: LibraryPath[]; offset: number; onClose: () => void }) {
  const navigate = useNavigate();
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

  const refresh = () => refreshLibrary();
  const save = useMutation({ mutationFn: () => api.patch(`/library/assets/${id}`, { tags, description }), onSuccess: refresh });
  const confirmProduct = useMutation({
    mutationFn: (v: { productId: string; confirmed: boolean }) => api.put(`/library/assets/${id}/products`, v),
    onSuccess: refresh,
  });
  const retag = useMutation({ mutationFn: () => api.post(`/library/assets/${id}/retag`), onSuccess: refresh, onError: (e) => setError(errorMessage(e)) });
  const flag = useMutation({
    mutationFn: (hidden: boolean) => api.post('/library/assets/batch-edit', { ids: [id], notForPublicUse: hidden }),
    onSuccess: refresh,
    onError: (e) => setError(errorMessage(e)),
  });
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
    <aside className="card sticky w-96 shrink-0 overflow-y-auto" style={{ top: offset, height: `calc(100vh - 7rem - ${offset}px)` }}>
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <span className="text-sm font-semibold">File details</span>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-200"><X className="h-4 w-4" /></button>
      </div>
      {!asset ? (
        <Spinner />
      ) : (
        <div className="space-y-4 p-4">
          {asset.thumbnailKey && <img src={fileUrl(asset.storedKey ?? asset.thumbnailKey)} className={`w-full rounded-md bg-slate-900 object-contain ${asset.notForPublicUse ? 'opacity-60 grayscale' : ''}`} />}
          <div>
            <div className="break-all font-mono text-xs text-slate-300">{asset.relPath}</div>
            <div className="mt-1 text-xs text-slate-500">{(asset.size / 1024 / 1024).toFixed(2)} MB · modified {formatDate(asset.mtime)}</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => void local(() => window.api.library.open(asset.relPath))}><ExternalLink className="h-3.5 w-3.5" /> Open</Button>
            <Button size="sm" variant="secondary" onClick={() => void local(() => window.api.library.reveal(asset.relPath))}><FolderSearch className="h-3.5 w-3.5" /> Show in folder</Button>
            {asset.kind === 'IMAGE' && (
              <Button
                size="sm"
                onClick={() => navigate(`/designs/new?w=1080&h=1080&name=${encodeURIComponent(asset.relPath.split('/').pop() ?? 'Graphic')}&asset=${asset.id}`)}
              >
                <ImagePlus className="h-3.5 w-3.5" /> Use in New Design
              </Button>
            )}
            {asset.kind === 'IMAGE' && !asset.storedKey && (
              <Button size="sm" variant="secondary" onClick={() => upload.mutate()} loading={upload.isPending} title="Uploads the full-resolution file so it can be used in designs and posts">
                <Upload className="h-3.5 w-3.5" /> Use in content
              </Button>
            )}
            {asset.storedKey && <Badge color="#22c55e">Available for designs</Badge>}
          </div>
          <ErrorText error={error} />
          <PublicUseFlag asset={asset} holds={holds} busy={flag.isPending} onFlag={(hidden) => flag.mutate(hidden)} onRefresh={refresh} />

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
            <Button size="sm" variant="ghost" onClick={() => retag.mutate()} loading={retag.isPending} disabled={asset.notForPublicUse} title={asset.notForPublicUse ? 'AI does not read files that are not for public use' : undefined}><RefreshCw className="h-3.5 w-3.5" /> Re-run AI tagging</Button>
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
