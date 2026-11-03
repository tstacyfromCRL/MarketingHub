import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Folder, ImageIcon, RefreshCw, X } from 'lucide-react';
import { api, errorMessage, queryClient } from '../lib/api';
import { Button, Empty, ErrorText, Spinner } from './ui';

type CanvaStatus = { configured: boolean; connected: boolean; account: { id: string; displayName: string; connectedBy: string } | null };

type CanvaLibraryItem =
  | { type: 'folder'; id: string; name: string; thumbnailUrl: string | null; updatedAt: number | null }
  | { type: 'image'; id: string; name: string; tags: string[]; thumbnailUrl: string | null; updatedAt: number | null };

type CanvaAssetDetail = {
  id: string;
  name: string;
  type: 'image' | 'video';
  tags: string[];
  thumbnailUrl: string | null;
  width: number | null;
  height: number | null;
  updatedAt: number | null;
};

type Crumb = { id: string; name: string };

function formatUpdated(seconds: number | null): string | null {
  if (!seconds) return null;
  try {
    return new Date(seconds * 1000).toLocaleString();
  } catch {
    return null;
  }
}

/** Browses folders and uploaded images from the team's connected Canva account. */
export function CanvaLibraryBrowser() {
  const status = useQuery({ queryKey: ['canva'], queryFn: () => api.get<CanvaStatus>('/canva/status') });
  const [path, setPath] = useState<Crumb[]>([{ id: 'root', name: 'Projects' }]);
  const [items, setItems] = useState<CanvaLibraryItem[]>([]);
  const [nextContinuation, setNextContinuation] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const folderId = path[path.length - 1]?.id ?? 'root';

  const listing = useQuery({
    queryKey: ['canva-folder', folderId],
    queryFn: () => api.get<{ items: CanvaLibraryItem[]; continuation: string | null }>(
      `/canva/folders/${encodeURIComponent(folderId)}/items`,
    ),
    enabled: Boolean(status.data?.connected),
  });

  // Replace the grid whenever the current folder's first page arrives.
  useEffect(() => {
    if (!listing.data) return;
    setItems(listing.data.items);
    setNextContinuation(listing.data.continuation);
  }, [listing.data]);

  const detail = useQuery({
    queryKey: ['canva-asset', selectedId],
    queryFn: () => api.get<CanvaAssetDetail>(`/canva/assets/${encodeURIComponent(selectedId!)}`),
    enabled: Boolean(selectedId),
  });

  const openFolder = (folder: Extract<CanvaLibraryItem, { type: 'folder' }>) => {
    setPath((cur) => [...cur, { id: folder.id, name: folder.name }]);
    setSelectedId(null);
  };

  const jumpTo = (index: number) => {
    setPath((cur) => cur.slice(0, index + 1));
    setSelectedId(null);
  };

  const loadMore = async () => {
    if (!nextContinuation) return;
    setLoadingMore(true);
    try {
      const page = await api.get<{ items: CanvaLibraryItem[]; continuation: string | null }>(
        `/canva/folders/${encodeURIComponent(folderId)}/items?continuation=${encodeURIComponent(nextContinuation)}`,
      );
      setItems((cur) => [...cur, ...page.items]);
      setNextContinuation(page.continuation);
    } finally {
      setLoadingMore(false);
    }
  };

  if (status.isLoading) return <Spinner />;
  if (!status.data?.configured) {
    return <Empty>Canva is not configured on the server yet. Add the Canva app id and secret, then connect an account in Settings.</Empty>;
  }
  if (!status.data.connected) {
    return <Empty>A manager connects Canva under Settings → Social accounts before this library can open.</Empty>;
  }

  const listError = listing.error ? errorMessage(listing.error) : null;
  const needsReconnect = Boolean(listError && /permission|scope|forbidden|folder/i.test(listError));

  return (
    <div className="flex gap-6">
      <div className="min-w-0 flex-1">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-slate-400">
          {path.map((crumb, index) => (
            <span key={`${crumb.id}-${index}`} className="flex items-center gap-1">
              {index > 0 && <ChevronRight className="h-3.5 w-3.5" />}
              <button
                type="button"
                className={index === path.length - 1 ? 'text-slate-200' : 'hover:text-slate-200'}
                onClick={() => jumpTo(index)}
              >
                {crumb.name}
              </button>
            </span>
          ))}
          <div className="flex-1" />
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void queryClient.invalidateQueries({ queryKey: ['canva-folder', folderId] })}
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </div>
        <p className="mb-3 text-xs text-slate-500">
          Uploaded images from the connected Canva account ({status.data.account?.displayName}). Canva does not list videos through this API yet. Thumbnails expire after about 15 minutes — refresh if one goes blank.
        </p>
        <ErrorText error={listError} />
        {needsReconnect && (
          <p className="mb-3 text-sm text-amber-200">
            If this account was connected before folder browsing was added, a manager should reconnect Canva in Settings and enable the folder read permission on the Canva app.
          </p>
        )}
        {listing.isLoading ? (
          <Spinner />
        ) : !items.length ? (
          <Empty>This Canva folder is empty.</Empty>
        ) : (
          <>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
              {items.map((item) => {
                const selected = item.type === 'image' && selectedId === item.id;
                return (
                  <button
                    key={`${item.type}-${item.id}`}
                    type="button"
                    onClick={() => (item.type === 'folder' ? openFolder(item) : setSelectedId(item.id))}
                    className={`overflow-hidden rounded-lg border text-left ${selected ? 'border-indigo-500' : 'border-slate-800 hover:border-slate-600'}`}
                    title={item.name}
                  >
                    <div className="relative flex aspect-square items-center justify-center bg-slate-900">
                      {item.thumbnailUrl ? (
                        <img src={item.thumbnailUrl} alt="" className="h-full w-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
                      ) : item.type === 'folder' ? (
                        <Folder className="h-10 w-10 text-slate-600" />
                      ) : (
                        <ImageIcon className="h-10 w-10 text-slate-600" />
                      )}
                    </div>
                    <div className="p-2">
                      <div className="truncate text-xs">{item.name}</div>
                      <div className="mt-1 text-[10px] uppercase tracking-wide text-slate-500">
                        {item.type === 'folder' ? 'Folder' : 'Image'}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            {nextContinuation && (
              <div className="mt-4 flex justify-center">
                <Button variant="secondary" size="sm" loading={loadingMore} onClick={() => void loadMore().catch(() => undefined)}>
                  Load more
                </Button>
              </div>
            )}
          </>
        )}
      </div>
      {selectedId && (
        <aside className="w-80 shrink-0 rounded-lg border border-slate-800 bg-slate-950/40 p-4">
          <div className="mb-3 flex items-start justify-between gap-2">
            <h2 className="text-sm font-medium text-slate-200">Canva upload</h2>
            <button type="button" className="text-slate-500 hover:text-slate-200" onClick={() => setSelectedId(null)} aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
          {detail.isLoading ? <Spinner /> : detail.error ? (
            <ErrorText error={errorMessage(detail.error)} />
          ) : detail.data ? (
            <div className="space-y-3 text-sm">
              <div className="overflow-hidden rounded border border-slate-800 bg-slate-900">
                {detail.data.thumbnailUrl ? (
                  <img src={detail.data.thumbnailUrl} alt="" className="w-full object-contain" referrerPolicy="no-referrer" />
                ) : (
                  <div className="flex aspect-square items-center justify-center"><ImageIcon className="h-10 w-10 text-slate-600" /></div>
                )}
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-500">Name</div>
                <div className="break-words text-slate-200">{detail.data.name}</div>
              </div>
              {(detail.data.width || detail.data.height) && (
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500">Size</div>
                  <div className="text-slate-300">{detail.data.width ?? '?'} × {detail.data.height ?? '?'}</div>
                </div>
              )}
              {formatUpdated(detail.data.updatedAt) && (
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500">Updated</div>
                  <div className="text-slate-300">{formatUpdated(detail.data.updatedAt)}</div>
                </div>
              )}
              {detail.data.tags.length > 0 && (
                <div>
                  <div className="mb-1 text-xs uppercase tracking-wide text-slate-500">Tags</div>
                  <div className="flex flex-wrap gap-1">
                    {detail.data.tags.map((tag) => (
                      <span key={tag} className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300">{tag}</span>
                    ))}
                  </div>
                </div>
              )}
              <p className="text-xs text-slate-500">
                Full-resolution downloads are not available through Canva Connect. Use these previews here, or open the file in Canva when you need the original.
              </p>
            </div>
          ) : null}
        </aside>
      )}
    </div>
  );
}
