import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { POST_STATUS_LABELS, type PostStatus } from '@mh/shared';
import { api, fileUrl } from '../lib/api';
import { formatWhen } from '../lib/format';
import { Badge, Card, Empty, PageHeader, Spinner, STATUS_COLORS } from '../components/ui';

interface Results {
  posts: { id: string; title: string; status: PostStatus; scheduledAt: string | null }[];
  tasks: { id: string; title: string; stage: { name: string } }[];
  products: { id: string; name: string; sku: string }[];
  assets: { id: string; relPath: string; thumbnailKey: string | null }[];
  content: { id: string; title: string; type: string }[];
  sources: { id: string; title: string; url: string | null }[];
  campaigns: { id: string; name: string }[];
}

export function SearchPage() {
  const [params] = useSearchParams();
  const q = params.get('q') ?? '';
  const { data, isLoading } = useQuery({ queryKey: ['search', q], queryFn: () => api.get<Results>(`/search?q=${encodeURIComponent(q)}`), enabled: q.length >= 2 });

  const total = data ? Object.values(data).reduce((n, list) => n + list.length, 0) : 0;
  const section = (title: string, count: number, children: ReactNode) =>
    count > 0 && <Card title={`${title} (${count})`}>{children}</Card>;
  const row = (to: string, label: string, extra?: ReactNode) => (
    <Link key={to} to={to} className="flex items-center gap-3 rounded px-2 py-1.5 text-sm hover:bg-slate-800/60"><span className="flex-1 truncate">{label}</span>{extra}</Link>
  );

  return (
    <div className="max-w-4xl">
      <PageHeader title={`Search: "${q}"`} />
      {isLoading ? <Spinner /> : !data || total === 0 ? <Empty>No results.</Empty> : (
        <div className="space-y-4">
          {section('Posts', data.posts.length, data.posts.map((p) => row(`/posts/${p.id}`, p.title, <>
            <span className="text-xs text-slate-500">{p.scheduledAt ? formatWhen(p.scheduledAt) : ''}</span>
            <Badge color={STATUS_COLORS[p.status]}>{POST_STATUS_LABELS[p.status]}</Badge>
          </>)))}
          {section('Campaigns', data.campaigns.length, data.campaigns.map((c) => row(`/campaigns/${c.id}`, c.name)))}
          {section('Tasks', data.tasks.length, data.tasks.map((t) => row(`/tasks/${t.id}`, t.title, <span className="text-xs text-slate-500">{t.stage.name}</span>)))}
          {section('Products', data.products.length, data.products.map((p) => row(`/products/${p.id}`, p.name, <span className="text-xs text-slate-500">{p.sku}</span>)))}
          {section('Documents', data.content.length, data.content.map((c) => row(`/content/${c.id}`, c.title, <span className="text-xs text-slate-500">{c.type.toLowerCase().replace('_', ' ')}</span>)))}
          {section('Knowledge sources', data.sources.length, data.sources.map((s) => row('/knowledge/sources', s.title || s.url || 'Source', <span className="truncate text-xs text-slate-500">{s.url}</span>)))}
          {section('Library files', data.assets.length, (
            <div className="grid grid-cols-6 gap-2">
              {data.assets.map((a) => (
                <Link key={a.id} to={`/library?asset=${a.id}`} className="overflow-hidden rounded border border-slate-800 hover:border-slate-600" title={a.relPath}>
                  {a.thumbnailKey ? <img src={fileUrl(a.thumbnailKey)} className="aspect-square w-full object-cover" /> : <div className="flex aspect-square items-center justify-center p-1 text-center text-[10px] text-slate-500">{a.relPath.split('/').pop()}</div>}
                </Link>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
