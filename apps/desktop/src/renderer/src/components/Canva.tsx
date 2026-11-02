import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link2, Trash2 } from 'lucide-react';
import { api, errorMessage, fileUrl, queryClient } from '../lib/api';
import type { Asset } from '../lib/types';
import { Button, Card, ErrorText, Field, Modal, Spinner } from './ui';

type CanvaStatus = { configured: boolean; connected: boolean; account: { id: string; displayName: string; connectedBy: string } | null };

export function CanvaAccountCard() {
  const status = useQuery({ queryKey: ['canva'], queryFn: () => api.get<CanvaStatus>('/canva/status') });
  const [error, setError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['canva'] });
  const connect = async () => {
    setError(null);
    try {
      const { url } = await api.post<{ url: string }>('/canva/connect');
      await window.api.app.openExternal(url);
      setWaiting(true);
      const timer = setInterval(() => void refresh(), 3000);
      setTimeout(() => { clearInterval(timer); setWaiting(false); }, 180_000);
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  if (!status.data) return <Spinner />;
  const account = status.data.account;
  return (
    <Card title="Canva" actions={
      status.data.configured
        ? <Button size="sm" variant="secondary" onClick={() => void connect()}><Link2 className="h-3.5 w-3.5" /> {account ? 'Reconnect' : 'Connect'}</Button>
        : null
    }>
      {waiting && <p className="mb-2 text-sm text-slate-400">Finish signing in in your browser.</p>}
      <ErrorText error={error} />
      {!status.data.configured && <p className="text-sm text-slate-500">Add the Canva app id and secret to the server configuration. The redirect URL is the server address followed by /canva/callback, and the return URL is /canva/return.</p>}
      {status.data.configured && !account && <p className="text-sm text-slate-500">No Canva account connected.</p>}
      {account && (
        <div className="flex items-center gap-3 text-sm">
          <span className="flex-1">{account.displayName}</span>
          <span className="text-xs text-slate-500">by {account.connectedBy}</span>
          <Button size="sm" variant="ghost" onClick={() => window.confirm(`Disconnect ${account.displayName}?`) && void api.del(`/canva/accounts/${account.id}`).then(refresh)}><Trash2 className="h-3.5 w-3.5" /></Button>
        </div>
      )}
    </Card>
  );
}

/** Starts a Canva design from a brand template, or a blank canvas, and opens it in Canva. */
export function CanvaGraphicModal({ folderId, onClose }: { folderId: string | null; onClose: (message?: string) => void }) {
  const status = useQuery({ queryKey: ['canva'], queryFn: () => api.get<CanvaStatus>('/canva/status') });
  const templates = useQuery({
    queryKey: ['canva-templates'],
    queryFn: () => api.get<{ id: string; title: string; thumbnailUrl: string | null }[]>('/canva/templates'),
    enabled: Boolean(status.data?.connected),
  });
  const [title, setTitle] = useState('Canva graphic');
  const [templateId, setTemplateId] = useState('');
  const [headline, setHeadline] = useState('');
  const [query, setQuery] = useState('');
  const [asset, setAsset] = useState<Asset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const images = useQuery({
    queryKey: ['assets', 'canva', query],
    queryFn: () => api.get<{ items: Asset[] }>(`/library/assets?kind=IMAGE&forAi=1&q=${encodeURIComponent(query)}`),
    enabled: Boolean(status.data?.connected),
  });
  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      let libraryAssetId = asset?.id;
      if (asset && !asset.storedKey) {
        const uploaded = await window.api.library.upload(asset.id, asset.relPath) as Asset;
        libraryAssetId = uploaded.id;
      }
      const created = await api.post<{ id: string; editUrl: string; filled: boolean }>('/canva/graphics', {
        title: title.trim(),
        templateId: templateId || undefined,
        headline: headline.trim() || undefined,
        libraryAssetId,
        folderId,
        width: 1080,
        height: 1350,
      });
      await window.api.app.openExternal(created.editUrl);
      void queryClient.invalidateQueries({ queryKey: ['designs'] });
      const unused = !created.filled && (headline.trim() || asset);
      onClose(unused ? 'That template has no fill-in fields, so it opened in Canva unchanged.' : undefined);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title="New Canva graphic" width="max-w-3xl">
      {status.isLoading ? <Spinner /> : !status.data?.configured ? (
        <p className="text-sm text-slate-400">Canva is not configured on the server yet.</p>
      ) : !status.data.connected ? (
        <p className="text-sm text-slate-400">A manager connects Canva in Settings, under Social accounts.</p>
      ) : (
        <div className="space-y-4">
          <Field label="Name"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <Field label="Brand template" hint="Leave this empty for a blank 1080×1350 design. The photo is placed in the image frame that was marked as a data field. A template without that frame cannot take the photo.">
            <select className="input" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              <option value="">Blank design</option>
              {templates.data?.map((template) => <option key={template.id} value={template.id}>{template.title}</option>)}
            </select>
          </Field>
          {templates.error && <ErrorText error={errorMessage(templates.error)} />}
          {templateId && (
            <>
              <Field label="Headline"><input className="input" value={headline} onChange={(e) => setHeadline(e.target.value)} /></Field>
              <Field label="Image">
                <input className="input mb-2" placeholder="Search the library" value={query} onChange={(e) => setQuery(e.target.value)} />
                <div className="grid max-h-48 grid-cols-5 gap-2 overflow-y-auto">
                  {images.data?.items.map((item) => (
                    <button key={item.id} type="button" onClick={() => setAsset(item)} className={`overflow-hidden rounded border ${asset?.id === item.id ? 'border-sage' : 'border-slate-800'}`} title={item.relPath}>
                      {item.thumbnailKey && <img src={fileUrl(item.thumbnailKey)} className="aspect-square w-full object-cover" />}
                    </button>
                  ))}
                </div>
              </Field>
            </>
          )}
          <ErrorText error={error} />
          <div className="flex justify-end"><Button onClick={() => void create()} loading={busy} disabled={!title.trim()}>Create and edit in Canva</Button></div>
        </div>
      )}
    </Modal>
  );
}
