import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import type { BrandProfileInput } from '@mh/shared';
import { api, download, errorMessage, queryClient } from '../lib/api';
import { BrandFileUploader, ColorTiersEditor } from '../components/BrandKit';
import { Button, Card, ErrorText, Field, PageHeader, Spinner } from '../components/ui';

type Kit = Pick<BrandProfileInput, 'colors' | 'fonts' | 'visualIdentity'>;

/** Logos, tiered colors, fonts and visual style used for every design and generated image. */
export function BrandKitPage() {
  const { data } = useQuery({ queryKey: ['brand'], queryFn: () => api.get<BrandProfileInput>('/brand') });
  const [kit, setKit] = useState<Kit | null>(null);
  useEffect(() => {
    if (data) setKit({ colors: data.colors, fonts: data.fonts, visualIdentity: data.visualIdentity });
  }, [data]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [transferring, setTransferring] = useState(false);
  const save = useMutation({
    mutationFn: () => api.patch<BrandProfileInput>('/brand', kit),
    onSuccess: (b) => queryClient.setQueryData(['brand'], b),
  });
  if (!kit || !data) return <Spinner />;
  const set = <K extends keyof Kit>(k: K, v: Kit[K]) => setKit({ ...kit, [k]: v });
  const unsaved = JSON.stringify(kit) !== JSON.stringify({ colors: data.colors, fonts: data.fonts, visualIdentity: data.visualIdentity });

  const exportKit = async () => {
    if (unsaved && !window.confirm('Export the last saved brand kit? Changes on this page that are not saved will not be in the file.')) return;
    setTransferError(null);
    setTransferring(true);
    try {
      await download('/brand/kit/export', 'brand-kit.zip');
    } catch (err) {
      setTransferError(errorMessage(err));
    } finally {
      setTransferring(false);
    }
  };

  const importKit = async (file: File | undefined) => {
    if (!file) return;
    if (!window.confirm('Replace the brand kit on this computer with this file? The company profile, colors, fonts, logos, backgrounds, and overlays in the file overwrite what is here. Example post pictures stay.')) return;
    setTransferError(null);
    setTransferring(true);
    try {
      const body = new FormData();
      body.append('file', file);
      await api.post('/brand/kit/import', body);
      await queryClient.invalidateQueries({ queryKey: ['brand'] });
      await queryClient.invalidateQueries({ queryKey: ['brand-files'] });
    } catch (err) {
      setTransferError(errorMessage(err));
    } finally {
      setTransferring(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div>
      <PageHeader
        title="Brand kit"
        subtitle="Logos, colors and fonts used in every design. Primary colors are used first. Export a zip to take this kit to another computer."
        actions={<>
          {save.isSuccess && <span className="text-sm text-emerald-400">Saved</span>}
          <Button variant="secondary" onClick={() => void exportKit()} loading={transferring}>Export</Button>
          <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={transferring}>Import</Button>
          <input ref={fileRef} type="file" accept=".zip,application/zip" className="hidden" onChange={(e) => void importKit(e.target.files?.[0])} />
          <Button onClick={() => save.mutate()} loading={save.isPending}>Save brand kit</Button>
        </>}
      />
      <ErrorText error={save.error ? errorMessage(save.error) : transferError} />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card title="Colors"><ColorTiersEditor colors={kit.colors} onChange={(c) => set('colors', c)} /></Card>
          <Card title="Fonts">
            <div className="space-y-2">
              {kit.fonts.map((f, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input className="input w-40" placeholder="Role (Headline)" value={f.role} onChange={(e) => set('fonts', kit.fonts.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)))} />
                  <input className="input flex-1" placeholder="Font family" value={f.family} onChange={(e) => set('fonts', kit.fonts.map((x, j) => (j === i ? { ...x, family: e.target.value } : x)))} style={{ fontFamily: f.family }} />
                  <Button size="sm" variant="ghost" onClick={() => set('fonts', kit.fonts.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              ))}
              <Button size="sm" variant="secondary" onClick={() => set('fonts', [...kit.fonts, { role: '', family: '' }])}><Plus className="h-3.5 w-3.5" /> Font</Button>
            </div>
          </Card>
          <Card title="Visual style">
            <Field label="Visual identity" hint="Photography style, layout rules, logo usage. Used for generated images and graphics.">
              <textarea className="input" rows={4} value={kit.visualIdentity} onChange={(e) => set('visualIdentity', e.target.value)} />
            </Field>
          </Card>
        </div>
        <div className="space-y-6">
          <Card title="Logos"><BrandFileUploader kind="LOGO" accept="image/*,.svg" hint="In the graphics editor, Logo places the one you pick." /></Card>
          <Card title="Backgrounds"><BrandFileUploader kind="BACKGROUND" accept="image/png,image/jpeg,image/webp" hint="Full-frame plates. In the graphics editor, Background places the one you pick behind the other layers." /></Card>
          <Card title="Patterns and overlays"><BrandFileUploader kind="GRAPHIC" accept="image/*,.svg" hint="Transparent patterns and frames. In the graphics editor, Overlay places the one you pick on top. Move it in the layer list if it should sit under the logo." /></Card>
          <Card title="Font files"><BrandFileUploader kind="FONT" accept=".ttf,.otf,.woff,.woff2" /></Card>
        </div>
      </div>
    </div>
  );
}
