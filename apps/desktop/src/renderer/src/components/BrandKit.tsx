import { useState, type DragEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2, Upload } from 'lucide-react';
import {
  COLOR_FORMATS, COLOR_TIERS, COLOR_TIER_LABELS, MAX_COLORS_PER_TIER, toHex, type BrandColor, type ColorFormat, type ColorTier,
} from '@mh/shared';
import { api, errorMessage, fileUrl, queryClient } from '../lib/api';
import { Button, ErrorText } from './ui';

export interface BrandFile {
  id: string;
  kind: 'LOGO' | 'GRAPHIC' | 'FONT';
  name: string;
  storageKey: string;
  mime: string;
}

const PLACEHOLDERS: Record<ColorFormat, string> = { HEX: '#1A2B3C', RGB: '26, 43, 60', CMYK: '100, 50, 0, 10', PANTONE: '186 C' };

function ColorRow({ color, onChange, onRemove }: { color: BrandColor; onChange: (c: BrandColor) => void; onRemove: () => void }) {
  const pantone = color.format === 'PANTONE';
  const value = color.value || (color.format === 'HEX' ? color.hex : '');
  const invalid = !pantone && value.trim() !== '' && !toHex(color.format, value);

  const applyValue = (format: ColorFormat, v: string) => {
    const hex = format === 'PANTONE' ? null : toHex(format, v);
    onChange({ ...color, format, value: v, ...(hex ? { hex } : {}) });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="color"
        value={color.hex}
        title={pantone ? 'Pick the on-screen color for this Pantone' : 'Pick a color'}
        onChange={(e) => onChange({ ...color, hex: e.target.value, ...(pantone ? {} : { format: 'HEX', value: e.target.value }) })}
        className="h-9 w-9 shrink-0 cursor-pointer rounded bg-transparent"
      />
      <select className="input w-28" value={color.format} onChange={(e) => applyValue(e.target.value as ColorFormat, '')}>
        {COLOR_FORMATS.map((f) => <option key={f} value={f}>{f === 'HEX' ? 'Hex' : f === 'PANTONE' ? 'Pantone' : f}</option>)}
      </select>
      <input
        className={`input w-40 font-mono ${invalid ? 'border-rose-500' : ''}`}
        placeholder={PLACEHOLDERS[color.format]}
        value={value}
        onChange={(e) => applyValue(color.format, e.target.value)}
        title={invalid ? "Couldn't read that value" : undefined}
      />
      {pantone && <span className="font-mono text-xs text-slate-400" title="Screen color used in designs">{color.hex}</span>}
      <input className="input min-w-[8rem] flex-1" placeholder="Name (optional)" value={color.name} onChange={(e) => onChange({ ...color, name: e.target.value })} />
      <Button size="sm" variant="ghost" onClick={onRemove} title="Remove color"><Trash2 className="h-3.5 w-3.5" /></Button>
      {pantone && <p className="w-full pl-11 text-xs text-slate-500">Pantone codes are kept for print. Use the swatch to pick how this color looks on screen.</p>}
    </div>
  );
}

/** Primary / Secondary / Tertiary color rows, up to 20 colors each, entered as Hex, RGB, CMYK or Pantone. */
export function ColorTiersEditor({ colors, onChange }: { colors: BrandColor[]; onChange: (colors: BrandColor[]) => void }) {
  const byTier = (t: ColorTier) => colors.map((c, i) => ({ c, i })).filter(({ c }) => c.tier === t);
  return (
    <div className="space-y-5">
      {COLOR_TIERS.map((tier) => {
        const rows = byTier(tier);
        return (
          <div key={tier}>
            <div className="mb-2 flex items-center gap-2">
              <span className="text-sm font-medium">{COLOR_TIER_LABELS[tier]} colors</span>
              <div className="flex gap-1">{rows.map(({ c, i }) => <span key={i} className="h-4 w-4 rounded-sm border border-slate-700" style={{ backgroundColor: c.hex }} />)}</div>
              <span className="text-xs text-slate-500">{rows.length}/{MAX_COLORS_PER_TIER}</span>
            </div>
            <div className="space-y-2">
              {rows.map(({ c, i }) => (
                <ColorRow
                  key={i}
                  color={c}
                  onChange={(next) => onChange(colors.map((x, j) => (j === i ? next : x)))}
                  onRemove={() => onChange(colors.filter((_, j) => j !== i))}
                />
              ))}
              <Button
                size="sm"
                variant="secondary"
                disabled={rows.length >= MAX_COLORS_PER_TIER}
                onClick={() => onChange([...colors, { name: '', hex: '#6366f1', tier, format: 'HEX', value: '#6366f1' }])}
              >
                <Plus className="h-3.5 w-3.5" /> Add {COLOR_TIER_LABELS[tier].toLowerCase()} color
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function useBrandFiles() {
  return useQuery({ queryKey: ['brand-files'], queryFn: () => api.get<BrandFile[]>('/brand/files') });
}

/** Drag-and-drop uploader with thumbnails for one kind of brand file. */
export function BrandFileUploader({ kind, accept, hint }: { kind: BrandFile['kind']; accept: string; hint?: string }) {
  const { data } = useBrandFiles();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const files = (data ?? []).filter((f) => f.kind === kind);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['brand-files'] });

  const upload = async (list: FileList | null) => {
    setError(null);
    setBusy(true);
    try {
      for (const f of Array.from(list ?? [])) {
        const form = new FormData();
        form.set('file', f, f.name);
        await api.post(`/brand/files?kind=${kind}`, form).catch((e) => setError(`${f.name}: ${errorMessage(e)}`));
      }
    } finally {
      setBusy(false);
      void refresh();
    }
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    void upload(e.dataTransfer.files);
  };

  return (
    <div className="space-y-3">
      <label
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed p-6 text-center text-sm transition ${over ? 'border-indigo-500 bg-indigo-950/40' : 'border-slate-700 hover:border-slate-500'}`}
      >
        <Upload className="h-5 w-5 text-slate-400" />
        <span>{busy ? 'Uploading...' : 'Drop files here or click to choose'}</span>
        {hint && <span className="text-xs text-slate-500">{hint}</span>}
        <input type="file" multiple accept={accept} className="hidden" onChange={(e) => void upload(e.target.files)} />
      </label>
      {files.length > 0 && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {files.map((f) => (
            <div key={f.id} className="group relative rounded-md border border-slate-800 bg-slate-900 p-2">
              {kind === 'FONT' ? (
                <div className="truncate py-3 text-center text-xs">{f.name}</div>
              ) : (
                <img src={fileUrl(f.storageKey)} className="h-16 w-full object-contain" title={f.name} />
              )}
              <button
                onClick={() => void api.del(`/brand/files/${f.id}`).then(refresh)}
                title="Remove"
                className="absolute right-1 top-1 hidden rounded bg-slate-950/80 p-1 text-rose-400 group-hover:block"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      <ErrorText error={error} />
    </div>
  );
}
