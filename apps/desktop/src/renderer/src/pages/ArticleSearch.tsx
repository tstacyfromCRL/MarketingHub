import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Plus, Search, Trash2 } from 'lucide-react';
import { api, errorMessage, queryClient } from '../lib/api';
import { formatDate } from '../lib/format';
import { Badge, Button, Card, Empty, ErrorText, Field } from '../components/ui';

type ProductRow = { id: string; name: string };
type ProjectRow = { id: string; name: string };
type HitSource = { id: string; status: string; error: string | null; productId: string | null; projectId: string | null };
type Hit = { id: string; title: string; url: string; snippet: string; source: HitSource | null };
type SearchRow = {
  id: string;
  keywords: string;
  intervalDays: number | null;
  lastRunAt: string | null;
  lastError: string | null;
  hits: Hit[];
};

const FREQUENCIES: { value: string; label: string }[] = [
  { value: '', label: 'Manual' },
  { value: '1', label: 'Once a day' },
  { value: '7', label: 'Once a week' },
  { value: '30', label: 'Once a month' },
];

function intervalValue(days: number | null): string {
  return days == null ? '' : String(days);
}

export function ArticlesTab() {
  const searches = useQuery({
    queryKey: ['article-searches'],
    queryFn: () => api.get<SearchRow[]>('/article-searches'),
    refetchInterval: (query) => (query.state.data?.some((search) => search.hits.some((hit) => hit.source?.status === 'PENDING')) ? 3000 : false),
  });
  const products = useQuery({ queryKey: ['products'], queryFn: () => api.get<ProductRow[]>('/products') });
  const projects = useQuery({ queryKey: ['projects'], queryFn: () => api.get<ProjectRow[]>('/projects') });
  const [keywords, setKeywords] = useState('');
  const [frequency, setFrequency] = useState('');
  const [projectName, setProjectName] = useState('');
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['article-searches'] });
    void queryClient.invalidateQueries({ queryKey: ['article-links'] });
  };

  const create = useMutation({
    mutationFn: () => api.post('/article-searches', { keywords, intervalDays: frequency ? Number(frequency) : null }),
    onSuccess: () => {
      setKeywords('');
      refresh();
    },
  });
  const addProject = useMutation({
    mutationFn: () => api.post('/projects', { name: projectName }),
    onSuccess: () => {
      setProjectName('');
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });

  return (
    <div className="space-y-6">
      <Card title="Keyword search">
        <form className="grid gap-4 md:grid-cols-[1fr_12rem_auto]" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <Field label="Keywords" hint="The words to look up. Results are not saved as knowledge until you file one.">
            <input className="input" value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="field robotics case study" required />
          </Field>
          <Field label="How often">
            <select className="input" value={frequency} onChange={(e) => setFrequency(e.target.value)}>
              {FREQUENCIES.map((option) => <option key={option.label} value={option.value}>{option.label}</option>)}
            </select>
          </Field>
          <div className="flex items-end">
            <Button type="submit" loading={create.isPending} disabled={!keywords.trim()}><Plus className="h-4 w-4" /> Add search</Button>
          </div>
        </form>
        <ErrorText error={create.error ? errorMessage(create.error) : null} />
      </Card>

      <Card title="Projects">
        <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); addProject.mutate(); }}>
          <Field label="New project" hint="A project is a place to file articles that are not about the whole company or one product.">
            <input className="input w-72" value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="Port automation launch" />
          </Field>
          <Button type="submit" variant="secondary" loading={addProject.isPending} disabled={!projectName.trim()}>Add project</Button>
        </form>
        <ErrorText error={addProject.error ? errorMessage(addProject.error) : null} />
        {!!projects.data?.length && (
          <p className="mt-3 text-sm text-slate-400">{projects.data.map((project) => project.name).join(', ')}</p>
        )}
      </Card>

      {!searches.data?.length ? (
        <Empty>Add a keyword search, then press Search. File an article under the company, a product, or a project when you want the AI to know it.</Empty>
      ) : (
        searches.data.map((search) => (
          <SearchCard key={search.id} search={search} products={products.data ?? []} projects={projects.data ?? []} onChanged={refresh} />
        ))
      )}
    </div>
  );
}

function SearchCard({ search, products, projects, onChanged }: { search: SearchRow; products: ProductRow[]; projects: ProjectRow[]; onChanged: () => void }) {
  const run = useMutation({
    mutationFn: () => api.post<{ count: number }>(`/article-searches/${search.id}/run`),
    onSuccess: onChanged,
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/article-searches/${search.id}`),
    onSuccess: onChanged,
  });
  const schedule = useMutation({
    mutationFn: (intervalDays: number | null) => api.patch(`/article-searches/${search.id}`, { intervalDays }),
    onSuccess: onChanged,
  });
  return (
    <Card
      title={search.keywords}
      actions={
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => run.mutate()} loading={run.isPending}><Search className="h-3.5 w-3.5" /> Search</Button>
          <Button size="sm" variant="ghost" onClick={() => remove.mutate()} loading={remove.isPending}><Trash2 className="h-3.5 w-3.5 text-rose-400" /></Button>
        </div>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-slate-400">
        <label className="flex items-center gap-2">
          How often
          <select
            className="input w-40 py-1"
            value={intervalValue(search.intervalDays)}
            onChange={(e) => schedule.mutate(e.target.value ? Number(e.target.value) : null)}
          >
            {FREQUENCIES.map((option) => <option key={option.label} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <span>{search.lastRunAt ? `Last search ${formatDate(search.lastRunAt)}` : 'Not run yet'}</span>
      </div>
      <ErrorText error={run.error ? errorMessage(run.error) : search.lastError} />
      {!search.hits.length ? (
        <p className="text-sm text-slate-500">No articles yet. Manual searches run when you press Search. The others also run on their schedule.</p>
      ) : (
        <div className="divide-y divide-slate-800">
          {search.hits.map((hit) => (
            <HitRow key={hit.id} hit={hit} products={products} projects={projects} onChanged={onChanged} />
          ))}
        </div>
      )}
    </Card>
  );
}

function filedLabel(source: HitSource, products: ProductRow[], projects: ProjectRow[]): string {
  if (source.productId) return products.find((product) => product.id === source.productId)?.name ?? 'a product';
  if (source.projectId) return projects.find((project) => project.id === source.projectId)?.name ?? 'a project';
  return 'the company';
}

function targetFor(source: HitSource | null): string {
  if (source?.productId) return `product:${source.productId}`;
  if (source?.projectId) return `project:${source.projectId}`;
  return 'company';
}

function HitRow({ hit, products, projects, onChanged }: { hit: Hit; products: ProductRow[]; projects: ProjectRow[]; onChanged: () => void }) {
  const [target, setTarget] = useState(() => targetFor(hit.source));
  useEffect(() => { setTarget(targetFor(hit.source)); }, [hit.source?.productId, hit.source?.projectId, hit.source?.status]);
  const assign = useMutation({
    mutationFn: () => {
      const [scope, id] = target.split(':');
      return api.post(`/article-hits/${hit.id}/assign`, {
        scope: scope === 'product' || scope === 'project' ? scope : 'company',
        productId: scope === 'product' ? id : undefined,
        projectId: scope === 'project' ? id : undefined,
      });
    },
    onSuccess: onChanged,
  });
  const status = hit.source?.status;
  return (
    <div className="py-3">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <button type="button" onClick={() => void window.api.app.openExternal(hit.url)} className="text-left text-sm text-indigo-300 hover:underline">{hit.title}</button>
          <div className="truncate text-xs text-slate-500">{hit.url}</div>
          {hit.snippet && <p className="mt-1 text-sm text-slate-300">{hit.snippet}</p>}
        </div>
        {status === 'OK' && hit.source && <Badge color="#22c55e">Filed under {filedLabel(hit.source, products, projects)}</Badge>}
        {status === 'PENDING' && <Badge color="#f59e0b">Reading</Badge>}
        {status === 'ERROR' && <Badge color="#f43f5e">Could not read</Badge>}
      </div>
      {hit.source?.error && <p className="mt-1 text-xs text-rose-400">{hit.source.error}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select className="input w-64 py-1" value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="company">Company</option>
          {products.map((product) => <option key={product.id} value={`product:${product.id}`}>{product.name}</option>)}
          {projects.map((project) => <option key={project.id} value={`project:${project.id}`}>{project.name}</option>)}
        </select>
        <Button size="sm" variant="secondary" onClick={() => assign.mutate()} loading={assign.isPending}>
          {hit.source ? 'Move' : 'Save as knowledge'}
        </Button>
      </div>
      <ErrorText error={assign.error ? errorMessage(assign.error) : null} />
    </div>
  );
}
