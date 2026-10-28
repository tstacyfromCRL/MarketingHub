import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { api, errorMessage, queryClient } from '../lib/api';
import type { MarketLink, Product } from '../lib/types';
import { Button, ChipInput, ErrorText, Field } from './ui';

interface ProductDoc {
  id: string;
  title: string;
  status: string;
  createdAt: string;
}

function asUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const url = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(url).toString();
  } catch {
    return null;
  }
}

function startingPartNumbers(product: Product | null): string[] {
  if (!product) return [];
  if (product.partNumbers.length) return product.partNumbers;
  return product.sku ? [product.sku] : [];
}

/**
 * The product record the knowledge base and the brand page share.
 * Documentation and outside companies are stored beside the product, not inside the description.
 */
export function ProductKnowledgeEditor({ product, onDone }: { product: Product | null; onDone: () => void }) {
  const [id, setId] = useState(product?.id ?? null);
  const [name, setName] = useState(product?.name ?? '');
  const [partNumbers, setPartNumbers] = useState(startingPartNumbers(product));
  const [description, setDescription] = useState(product?.description ?? '');
  const [usage, setUsage] = useState(product?.usage ?? '');
  const [features, setFeatures] = useState(product?.features ?? []);
  const [pricing, setPricing] = useState(product?.pricing ?? '');
  const [url, setUrl] = useState(product?.url ?? '');
  const [links, setLinks] = useState(product?.links ?? []);
  const [active, setActive] = useState(product?.active ?? true);
  const [newLink, setNewLink] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);

  useEffect(() => {
    if (!product) return;
    setId(product.id);
    setName(product.name);
    setPartNumbers(startingPartNumbers(product));
    setDescription(product.description);
    setUsage(product.usage ?? '');
    setFeatures(product.features);
    setPricing(product.pricing);
    setUrl(product.url);
    setLinks(product.links);
    setActive(product.active);
  }, [product]);

  const save = useMutation({
    mutationFn: () => {
      const parts = partNumbers.map((part) => part.trim()).filter(Boolean);
      const body = {
        name,
        sku: parts[0] ?? '',
        partNumbers: parts,
        description,
        usage,
        features,
        pricing,
        url,
        links,
        active,
      };
      return id ? api.patch<Product>(`/products/${id}`, body) : api.post<Product>('/products', body);
    },
    onSuccess: (saved) => {
      setId(saved.id);
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      void queryClient.invalidateQueries({ queryKey: ['product'] });
      void queryClient.invalidateQueries({ queryKey: ['sources'] });
    },
  });

  const addLink = () => {
    const next = asUrl(newLink);
    if (!next) return setLinkError("That doesn't look like a web address");
    setLinkError(null);
    if (!links.includes(next)) setLinks([...links, next]);
    setNewLink('');
  };

  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <Field label="Name">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
      </Field>
      <Field label="Part numbers" hint="The first part number is also the SKU used when a catalog import matches this product.">
        <ChipInput value={partNumbers} onChange={setPartNumbers} placeholder="Part number, then Enter" />
      </Field>
      <Field label="Price" hint='As you would say it publicly, for example "$49/month" or "From $1,200".'>
        <input className="input" value={pricing} onChange={(e) => setPricing(e.target.value)} />
      </Field>
      <Field label="What the product does">
        <textarea className="input" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Field label="How the product is used">
        <textarea className="input" rows={4} value={usage} onChange={(e) => setUsage(e.target.value)} />
      </Field>
      <Field label="Key features">
        <ChipInput value={features} onChange={setFeatures} />
      </Field>
      <Field label="Product page">
        <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
      </Field>
      <div>
        <span className="label">Documentation links</span>
        <p className="mb-2 text-xs text-slate-500">Each page is read into the knowledge base and refreshed monthly.</p>
        <div className="space-y-1.5">
          {links.map((link) => (
            <div key={link} className="flex items-center gap-2 rounded-md bg-slate-800/60 px-2 py-1 text-sm">
              <span className="flex-1 truncate" title={link}>{link}</span>
              <button type="button" className="text-slate-500 hover:text-rose-400" onClick={() => setLinks(links.filter((item) => item !== link))}>
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <div className="flex gap-2">
            <input
              className="input flex-1"
              placeholder="Spec sheet, manual, product page..."
              value={newLink}
              onChange={(e) => setNewLink(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addLink(); } }}
            />
            <Button type="button" variant="secondary" onClick={addLink}>Add</Button>
          </div>
          {linkError && <p className="text-xs text-rose-400">{linkError}</p>}
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        Active (include in content and matching)
      </label>
      <ErrorText error={save.error ? errorMessage(save.error) : null} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>Done</Button>
        <Button type="submit" loading={save.isPending}>{id ? 'Save' : 'Save product'}</Button>
      </div>
      {id ? (
        <>
          <ProductDocuments productId={id} />
          <MarketLinksPanel productId={id} />
        </>
      ) : (
        <p className="text-xs text-slate-500">Save the product first, then upload documentation and add competitor or partner links.</p>
      )}
    </form>
  );
}

export function ProductDocuments({ productId }: { productId: string }) {
  const { data } = useQuery({
    queryKey: ['product-documents', productId],
    queryFn: () => api.get<ProductDoc[]>(`/products/${productId}/documents`),
  });
  const upload = useMutation({
    mutationFn: (file: File) => {
      const body = new FormData();
      body.append('file', file);
      return api.post(`/products/${productId}/documents`, body);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['product-documents', productId] });
      void queryClient.invalidateQueries({ queryKey: ['documents'] });
    },
  });
  const remove = useMutation({
    mutationFn: (sourceId: string) => api.del(`/products/${productId}/documents/${sourceId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['product-documents', productId] });
      void queryClient.invalidateQueries({ queryKey: ['documents'] });
    },
  });
  return (
    <div>
      <span className="label">Documentation files</span>
      <p className="mb-2 text-xs text-slate-500">Markdown, text, PDF, or Word. The text is read into the knowledge base.</p>
      <label className="inline-flex cursor-pointer items-center rounded-md bg-sage px-3.5 py-2 text-sm text-mist">
        Upload
        <input
          type="file"
          accept=".md,.txt,.pdf,.docx"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) upload.mutate(file);
          }}
        />
      </label>
      <ErrorText error={upload.error ? errorMessage(upload.error) : remove.error ? errorMessage(remove.error) : null} />
      <div className="mt-2 space-y-1.5">
        {(data ?? []).map((doc) => (
          <div key={doc.id} className="flex items-center gap-2 rounded-md bg-slate-800/60 px-2 py-1 text-sm">
            <span className="flex-1 truncate">{doc.title}</span>
            <button type="button" className="text-slate-500 hover:text-rose-400" onClick={() => remove.mutate(doc.id)}>
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Competitor and partner websites and social pages. Company-wide when productId is null. */
export function MarketLinksPanel({ productId }: { productId: string | null }) {
  const scope = productId ?? 'company';
  const { data } = useQuery({
    queryKey: ['market-links', scope],
    queryFn: () => api.get<MarketLink[]>(`/market-links?productId=${scope}`),
  });
  const [name, setName] = useState('');
  const [role, setRole] = useState<'COMPETITOR' | 'PARTNER'>('COMPETITOR');
  const [url, setUrl] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const add = useMutation({
    mutationFn: () => api.post('/market-links', { name: name.trim(), role, url: asUrl(url), productId }),
    onSuccess: () => {
      setName('');
      setUrl('');
      setFormError(null);
      void queryClient.invalidateQueries({ queryKey: ['market-links', scope] });
      if (productId) void queryClient.invalidateQueries({ queryKey: ['product', productId] });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/market-links/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['market-links', scope] }),
  });
  return (
    <div>
      <span className="label">{productId ? 'Competitors and partners for this product' : 'Competitors and partners'}</span>
      <p className="mb-2 text-xs text-slate-500">
        Websites are read for market context. Social pages are saved as links. The writer is told these are not our company.
      </p>
      <div className="space-y-1.5">
        {(data ?? []).map((link) => (
          <div key={link.id} className="flex items-center gap-2 rounded-md bg-slate-800/60 px-2 py-1 text-sm">
            <span className="w-24 shrink-0 text-xs text-slate-400">{link.role === 'COMPETITOR' ? 'Competitor' : 'Partner'}</span>
            <span className="w-36 shrink-0 truncate">{link.name}</span>
            <span className="flex-1 truncate text-slate-400" title={link.url}>{link.channel} · {link.url}</span>
            <button type="button" className="text-slate-500 hover:text-rose-400" onClick={() => remove.mutate(link.id)}>
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <select className="input w-36" value={role} onChange={(e) => setRole(e.target.value as 'COMPETITOR' | 'PARTNER')}>
          <option value="COMPETITOR">Competitor</option>
          <option value="PARTNER">Partner</option>
        </select>
        <input className="input w-44" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="input min-w-[14rem] flex-1" placeholder="Website or social URL" value={url} onChange={(e) => setUrl(e.target.value)} />
        <Button
          type="button"
          variant="secondary"
          loading={add.isPending}
          onClick={() => {
            if (!name.trim()) return setFormError('Add a name');
            if (!asUrl(url)) return setFormError("That doesn't look like a web address");
            setFormError(null);
            add.mutate();
          }}
        >
          Add
        </Button>
      </div>
      <ErrorText error={formError ?? (add.error ? errorMessage(add.error) : remove.error ? errorMessage(remove.error) : null)} />
    </div>
  );
}
