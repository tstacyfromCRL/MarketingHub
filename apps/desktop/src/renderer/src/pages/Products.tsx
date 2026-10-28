import { useState } from 'react';
import { Link, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink, Plus, Trash2 } from 'lucide-react';
import { api, fileUrl, queryClient } from '../lib/api';
import { formatDate } from '../lib/format';
import { useProducts } from '../lib/hooks';
import type { Asset, KnowledgeSource, Product } from '../lib/types';
import { Badge, Button, Card, Empty, Modal, PageHeader, Spinner } from '../components/ui';
import { ProductDocuments, ProductKnowledgeEditor, MarketLinksPanel } from '../components/ProductKnowledgeEditor';

export function ProductsPage() {
  return (
    <Routes>
      <Route index element={<ProductList />} />
      <Route path=":id" element={<ProductDetail />} />
    </Routes>
  );
}

function ProductList() {
  const { data, isLoading } = useProducts();
  const [editing, setEditing] = useState(false);
  return (
    <div>
      <PageHeader
        title="Products"
        subtitle="What you sell. Part numbers, price, what it does, how it is used, and documentation are the same record as Knowledge → Products."
        actions={<Button onClick={() => setEditing(true)}><Plus className="h-4 w-4" /> Add product</Button>}
      />
      {isLoading ? <Spinner /> : !data?.length ? <Empty>Add your products so the AI can write about them and recognize them in photos.</Empty> : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {data.map((p) => (
            <Link key={p.id} to={`/products/${p.id}`} className="card block p-4 hover:border-slate-600">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{p.name}</span>
                {!p.active && <Badge>inactive</Badge>}
              </div>
              <div className="text-xs text-slate-500">{[(p.partNumbers?.length ? p.partNumbers.join(', ') : p.sku), p.pricing].filter(Boolean).join(' · ')}</div>
              <p className="mt-2 line-clamp-2 text-sm text-slate-400">{p.description}</p>
              <div className="mt-2 text-xs text-slate-500">
                {p._count?.assets ?? 0} confirmed photos{p.links.length ? ` · ${p.links.length} linked page${p.links.length === 1 ? '' : 's'}` : ''}
              </div>
            </Link>
          ))}
        </div>
      )}
      {editing && <ProductModal onClose={() => setEditing(false)} />}
    </div>
  );
}

function ProductModal({ product, onClose }: { product?: Product; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title={product ? 'Edit product' : 'Add product'} width="max-w-2xl">
      <ProductKnowledgeEditor product={product ?? null} onDone={onClose} />
    </Modal>
  );
}

const STATUS_COLOR = { PENDING: '#f59e0b', OK: '#22c55e', ERROR: '#f43f5e' };

function ProductDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const { data } = useQuery({
    queryKey: ['product', id],
    queryFn: () => api.get<Product & { assets: { similarity: number; confirmed: boolean | null; asset: Asset }[] }>(`/products/${id}`),
  });
  const sources = useQuery({
    queryKey: ['sources'],
    queryFn: () => api.get<KnowledgeSource[]>('/sources'),
    refetchInterval: (q) => (q.state.data?.some((s) => s.productId === id && s.status === 'PENDING') ? 3000 : false),
  });
  const pages = (sources.data ?? []).filter((s) => s.productId === id);
  const del = useMutation({
    mutationFn: () => api.del(`/products/${id}`),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['products'] }); navigate('/products'); },
  });
  const confirm = useMutation({
    mutationFn: (v: { assetId: string; confirmed: boolean }) => api.put(`/library/assets/${v.assetId}/products`, { productId: id, confirmed: v.confirmed }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['product', id] }),
  });
  if (!data) return <Spinner />;
  return (
    <div className="space-y-6">
      <Link to="/products" className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200"><ArrowLeft className="h-4 w-4" /> All products</Link>
      <Card title={data.name} actions={<>
        <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>Edit</Button>
        <Button size="sm" variant="danger" onClick={() => window.confirm(`Delete ${data.name}?`) && del.mutate()}><Trash2 className="h-3.5 w-3.5" /></Button>
      </>}>
        {data.pricing && <div className="mb-2 text-sm font-medium text-emerald-300">{data.pricing}</div>}
        {(data.partNumbers?.length || data.sku) && (
          <div className="mb-2 text-xs text-slate-400">Part numbers: {(data.partNumbers?.length ? data.partNumbers : [data.sku]).join(', ')}</div>
        )}
        <p className="text-xs text-slate-500">What it does</p>
        <p className="whitespace-pre-wrap text-sm text-slate-300">{data.description || 'No description yet.'}</p>
        {data.usage && (
          <>
            <p className="mt-3 text-xs text-slate-500">How it is used</p>
            <p className="whitespace-pre-wrap text-sm text-slate-300">{data.usage}</p>
          </>
        )}
        {data.features.length > 0 && <ul className="mt-3 list-disc pl-5 text-sm text-slate-400">{data.features.map((f) => <li key={f}>{f}</li>)}</ul>}
        {data.url && <button onClick={() => void window.api.app.openExternal(data.url)} className="mt-3 inline-flex items-center gap-1 text-sm text-indigo-300 hover:underline"><ExternalLink className="h-3.5 w-3.5" />{data.url}</button>}
      </Card>
      <Card title="Documentation and outside companies">
        <div className="space-y-4">
          <ProductDocuments productId={data.id} />
          <MarketLinksPanel productId={data.id} />
        </div>
      </Card>
      {pages.length > 0 && (
        <Card title="Pages the AI learned from">
          <div className="divide-y divide-slate-800">
            {pages.map((s) => (
              <div key={s.id} className="flex items-center gap-3 py-2 text-sm">
                <Badge color={STATUS_COLOR[s.status]}>{s.status === 'OK' ? 'read' : s.status.toLowerCase()}</Badge>
                <div className="min-w-0 flex-1">
                  <button className="block truncate text-left hover:underline" onClick={() => s.url && void window.api.app.openExternal(s.url)}>{s.url}</button>
                  {s.error && <div className="text-xs text-rose-400">{s.error}</div>}
                </div>
                {s.lastCrawledAt && <span className="text-xs text-slate-500">{formatDate(s.lastCrawledAt)}</span>}
              </div>
            ))}
          </div>
        </Card>
      )}
      <Card title="Photos of this product">
        {data.assets.length === 0 ? <Empty>No matches yet. Confirm this product on a few library photos and similar ones will be suggested automatically.</Empty> : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
            {data.assets.map(({ asset, similarity, confirmed }) => (
              <div key={asset.id} className={`overflow-hidden rounded-md border border-slate-800 ${asset.notForPublicUse ? 'opacity-50 grayscale' : ''}`} title={asset.notForPublicUse ? 'Not for public use' : undefined}>
                <Link to={`/library?asset=${asset.id}`}>
                  {asset.thumbnailKey ? <img src={fileUrl(asset.thumbnailKey)} className="aspect-square w-full object-cover" /> : <div className="aspect-square bg-slate-900" />}
                </Link>
                <div className="flex items-center gap-1 p-1.5 text-[11px]">
                  <span className="flex-1 text-slate-400">{confirmed ? 'Confirmed' : `${Math.round(similarity * 100)}%`}</span>
                  {!confirmed && <Button size="sm" variant="ghost" onClick={() => confirm.mutate({ assetId: asset.id, confirmed: true })}>Yes</Button>}
                  <Button size="sm" variant="ghost" onClick={() => confirm.mutate({ assetId: asset.id, confirmed: false })}>No</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
      {editing && <ProductModal product={data} onClose={() => setEditing(false)} />}
    </div>
  );
}
