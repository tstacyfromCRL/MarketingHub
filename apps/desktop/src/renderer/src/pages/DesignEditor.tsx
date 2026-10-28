import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Ellipse, Image as KImage, Layer as KLayer, Rect, Stage, Text, Transformer } from 'react-konva';
import type Konva from 'konva';
import {
  ArrowDown, ArrowLeft, ArrowUp, Circle, Download, Eye, EyeOff, ImagePlus, Library, Lock, Redo2, Save, Sparkles, Square, Trash2, Type, Undo2, Unlock, Wand2,
} from 'lucide-react';
import {
  EXPORT_FORMATS, PLATFORMS, PLATFORM_PRESETS, newLayerId, type BrandProfileInput, type DesignDoc, type ExportFormat, type ImageLayer, type Layer, type Platform,
} from '@mh/shared';
import { api, download, errorMessage, fileUrl, queryClient } from '../lib/api';
import type { Asset, Design } from '../lib/types';
import { Button, ErrorText, Field, Modal, Spinner } from '../components/ui';

const EXPORT_LABELS: Record<ExportFormat, string> = {
  png: 'PNG image',
  psd: 'Photoshop (PSD, layered)',
  svg: 'SVG (layers as groups; opens in Illustrator / Affinity)',
  pdf: 'PDF (layered; opens in Illustrator / Affinity)',
  idml: 'InDesign (IDML)',
};

function useHtmlImage(src: string | undefined) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!src) return setImg(null);
    const i = new window.Image();
    i.onload = () => setImg(i);
    i.src = src;
  }, [src]);
  return img;
}

/** Konva image honoring the layer's fit mode (cover crops, contain letterboxes). */
function ImageNode({ layer, common }: { layer: ImageLayer; common: Konva.NodeConfig }) {
  const img = useHtmlImage(fileUrl(layer.src));
  if (!img) return <Rect {...common} width={layer.width} height={layer.height} fill="#1e293b" />;
  const { width: w, height: h } = layer;
  if (layer.fit === 'cover') {
    const scale = Math.max(w / img.width, h / img.height);
    const cw = w / scale;
    const ch = h / scale;
    return <KImage {...common} image={img} width={w} height={h} crop={{ x: (img.width - cw) / 2, y: (img.height - ch) / 2, width: cw, height: ch }} />;
  }
  if (layer.fit === 'contain') {
    const scale = Math.min(w / img.width, h / img.height);
    // Contained images still occupy the full layer box so the transformer handles stay on the layer bounds.
    return <KImage {...common} image={img} width={w} height={h} crop={{ x: -(w / scale - img.width) / 2, y: -(h / scale - img.height) / 2, width: w / scale, height: h / scale }} />;
  }
  return <KImage {...common} image={img} width={w} height={h} />;
}

function blankDoc(width: number, height: number): DesignDoc {
  return { version: 1, width, height, background: '#ffffff', layers: [] };
}

export function DesignEditorPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const existing = useQuery({ queryKey: ['design', id], queryFn: () => api.get<Design>(`/designs/${id}`), enabled: !!id });
  const brand = useQuery({ queryKey: ['brand'], queryFn: () => api.get<BrandProfileInput>('/brand') });

  const [name, setName] = useState(params.get('name') ?? 'Untitled graphic');
  const [doc, setDocState] = useState<DesignDoc | null>(id ? null : blankDoc(Number(params.get('w') ?? 1080), Number(params.get('h') ?? 1080)));
  const [past, setPast] = useState<DesignDoc[]>([]);
  const [future, setFuture] = useState<DesignDoc[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [modal, setModal] = useState<'ai-image' | 'library' | 'logo' | 'compose' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (existing.data) {
      setDocState(existing.data.doc);
      setName(existing.data.name);
    }
  }, [existing.data]);

  // A library "Use in New Design" opens a blank canvas and places that file once.
  const libraryAssetId = params.get('asset');
  const placedLibraryAsset = useRef<string | null>(null);
  const docRef = useRef(doc);
  docRef.current = doc;
  const setDoc = useCallback((next: DesignDoc) => {
    setDocState((cur) => {
      if (cur) setPast((p) => [...p.slice(-49), cur]);
      return next;
    });
    setFuture([]);
    setDirty(true);
  }, []);
  useEffect(() => {
    if (id || !libraryAssetId || placedLibraryAsset.current) return;
    placedLibraryAsset.current = libraryAssetId;
    void (async () => {
      try {
        const asset = await api.get<Asset>(`/library/assets/${libraryAssetId}`);
        const canvas = docRef.current;
        if (asset.kind !== 'IMAGE' || !canvas) return;
        let key = asset.storedKey;
        if (!key) {
          const uploaded = (await window.api.library.upload(asset.id, asset.relPath)) as Asset;
          key = uploaded.storedKey;
        }
        if (!key) throw new Error('Could not read that file from the shared drive.');
        const img = new window.Image();
        img.src = fileUrl(key)!;
        await img.decode();
        const scale = Math.min((canvas.width * 0.8) / img.naturalWidth, (canvas.height * 0.8) / img.naturalHeight, 1);
        const width = Math.max(1, Math.round(img.naturalWidth * scale));
        const height = Math.max(1, Math.round(img.naturalHeight * scale));
        const label = asset.relPath.split('/').pop() ?? 'Image';
        const layer: ImageLayer = {
          id: newLayerId(), name: label, type: 'image', src: key, fit: 'contain', role: 'product',
          x: Math.round((canvas.width - width) / 2), y: Math.round((canvas.height - height) / 2),
          width, height, rotation: 0, opacity: 1, visible: true, locked: false,
        };
        const latest = docRef.current ?? canvas;
        setDoc({ ...latest, layers: [...latest.layers, layer] });
        setSelected(layer.id);
        setName(label);
      } catch (e) {
        placedLibraryAsset.current = null;
        setError(errorMessage(e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
      }
    })();
  }, [id, libraryAssetId, setDoc]);

  const undo = () => {
    if (!past.length || !doc) return;
    setFuture((f) => [doc, ...f]);
    setDocState(past[past.length - 1]);
    setPast((p) => p.slice(0, -1));
  };
  const redo = () => {
    if (!future.length || !doc) return;
    setPast((p) => [...p, doc]);
    setDocState(future[0]);
    setFuture((f) => f.slice(1));
  };

  const updateLayer = (lid: string, patch: Partial<Layer>) => doc && setDoc({ ...doc, layers: doc.layers.map((l) => (l.id === lid ? ({ ...l, ...patch } as Layer) : l)) });
  const addLayer = (layer: Layer) => {
    if (!doc) return;
    setDoc({ ...doc, layers: [...doc.layers, layer] });
    setSelected(layer.id);
  };
  const removeLayer = (lid: string) => {
    if (!doc) return;
    setDoc({ ...doc, layers: doc.layers.filter((l) => l.id !== lid) });
    setSelected(null);
  };
  const moveLayer = (lid: string, dir: 1 | -1) => {
    if (!doc) return;
    const i = doc.layers.findIndex((l) => l.id === lid);
    const j = i + dir;
    if (j < 0 || j >= doc.layers.length) return;
    const layers = [...doc.layers];
    [layers[i], layers[j]] = [layers[j], layers[i]];
    setDoc({ ...doc, layers });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName);
      if (typing) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected) removeLayer(selected);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const save = useMutation({
    mutationFn: () => (id ? api.put<Design>(`/designs/${id}`, { name, doc }) : api.post<Design>('/designs', { name, doc })),
    onSuccess: (d) => {
      setDirty(false);
      void queryClient.invalidateQueries({ queryKey: ['designs'] });
      void queryClient.invalidateQueries({ queryKey: ['design', d.id] });
      void queryClient.invalidateQueries({ queryKey: ['post'] });
      if (!id) navigate(`/designs/${d.id}`, { replace: true });
    },
    onError: (e) => setError(errorMessage(e)),
  });

  const exportAs = async (fmt: ExportFormat) => {
    setError(null);
    try {
      if (!id || dirty) {
        setError('Save the design before exporting.');
        return;
      }
      await download(`/designs/${id}/export/${fmt}`, `${name}.${fmt}`);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const uploadImage = async (file: File) => {
    const form = new FormData();
    form.set('file', file, file.name);
    const r = await api.post<{ key: string; width: number; height: number }>('/designs/images', form);
    placeImage(r.key, r.width, r.height, 'other', file.name);
  };
  const placeImage = (key: string, w: number, h: number, role: ImageLayer['role'], label: string) => {
    if (!doc) return;
    const scale = Math.min((doc.width * 0.6) / w, (doc.height * 0.6) / h, 1);
    const width = Math.round(w * scale);
    const height = Math.round(h * scale);
    addLayer({
      id: newLayerId(), name: label, type: 'image', src: key, fit: 'contain', role,
      x: Math.round((doc.width - width) / 2), y: Math.round((doc.height - height) / 2), width, height, rotation: 0, opacity: 1, visible: true, locked: false,
    });
  };

  if (!doc) return <Spinner label="Loading design..." />;
  const sel = doc.layers.find((l) => l.id === selected) ?? null;
  const colors = brand.data?.colors ?? [];
  const fonts = brand.data?.fonts ?? [];

  return (
    <div className="-mx-8 -my-6 flex h-[calc(100vh-57px)] flex-col">
      <div className="flex items-center gap-2 border-b border-slate-800 px-4 py-2">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}><ArrowLeft className="h-4 w-4" /></Button>
        <input className="w-64 rounded bg-transparent px-2 py-1 text-sm font-medium outline-none hover:bg-slate-900 focus:bg-slate-900" value={name} onChange={(e) => { setName(e.target.value); setDirty(true); }} />
        <span className="text-xs text-slate-500">{doc.width}×{doc.height}{dirty ? ' · unsaved' : ''}</span>
        <div className="mx-2 h-5 w-px bg-slate-800" />
        <Button variant="ghost" size="sm" title="Text" onClick={() => addLayer({ id: newLayerId(), name: 'Text', type: 'text', text: 'Your headline', x: doc.width * 0.1, y: doc.height * 0.4, width: doc.width * 0.8, height: doc.height * 0.15, fontSize: Math.round(doc.width / 14), fontFamily: fonts[0]?.family || 'Arial', fontWeight: 'bold', italic: false, color: colors[0]?.hex ?? '#111827', align: 'center', lineHeight: 1.2, rotation: 0, opacity: 1, visible: true, locked: false })}><Type className="h-4 w-4" /> Text</Button>
        <Button variant="ghost" size="sm" title="Rectangle" onClick={() => addLayer({ id: newLayerId(), name: 'Rectangle', type: 'rect', fill: colors[1]?.hex ?? '#6366f1', cornerRadius: 0, strokeWidth: 0, x: doc.width * 0.25, y: doc.height * 0.25, width: doc.width * 0.5, height: doc.height * 0.2, rotation: 0, opacity: 1, visible: true, locked: false })}><Square className="h-4 w-4" /></Button>
        <Button variant="ghost" size="sm" title="Ellipse" onClick={() => addLayer({ id: newLayerId(), name: 'Ellipse', type: 'ellipse', fill: colors[2]?.hex ?? '#f59e0b', strokeWidth: 0, x: doc.width * 0.35, y: doc.height * 0.35, width: doc.width * 0.3, height: doc.width * 0.3, rotation: 0, opacity: 1, visible: true, locked: false })}><Circle className="h-4 w-4" /></Button>
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800" title="Upload image">
          <ImagePlus className="h-4 w-4" /> Upload
          <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadImage(f).catch((err) => setError(errorMessage(err))); e.target.value = ''; }} />
        </label>
        <Button variant="ghost" size="sm" onClick={() => setModal('library')}><Library className="h-4 w-4" /> Library</Button>
        <Button variant="ghost" size="sm" onClick={() => setModal('logo')}>Logo</Button>
        <Button variant="ghost" size="sm" onClick={() => setModal('ai-image')}><Sparkles className="h-4 w-4" /> AI image</Button>
        <Button variant="ghost" size="sm" onClick={() => setModal('compose')}><Wand2 className="h-4 w-4" /> AI layout</Button>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" onClick={undo} disabled={!past.length} title="Undo (Ctrl+Z)"><Undo2 className="h-4 w-4" /></Button>
        <Button variant="ghost" size="sm" onClick={redo} disabled={!future.length} title="Redo (Ctrl+Y)"><Redo2 className="h-4 w-4" /></Button>
        <ExportMenu onExport={(f) => void exportAs(f)} />
        <Button size="sm" onClick={() => save.mutate()} loading={save.isPending}><Save className="h-4 w-4" /> Save</Button>
      </div>
      {error && <div className="border-b border-rose-900 bg-rose-950/50 px-4 py-1.5 text-sm text-rose-300">{error} <button className="ml-2 underline" onClick={() => setError(null)}>dismiss</button></div>}

      <div className="flex min-h-0 flex-1">
        <LayersPanel doc={doc} selected={selected} onSelect={setSelected} onUpdate={updateLayer} onMove={moveLayer} onRemove={removeLayer} />
        <Canvas doc={doc} selected={selected} onSelect={setSelected} onUpdate={updateLayer} />
        <PropertiesPanel doc={doc} layer={sel} colors={colors} fonts={fonts} onUpdate={updateLayer} onDoc={setDoc} />
      </div>

      {modal === 'ai-image' && <AiImageModal doc={doc} onClose={() => setModal(null)} onPlace={(key, bg) => {
        setModal(null);
        if (bg) addLayer({ id: newLayerId(), name: 'AI background', type: 'image', src: key, fit: 'cover', role: 'generated', x: 0, y: 0, width: doc.width, height: doc.height, rotation: 0, opacity: 1, visible: true, locked: false });
        else placeImage(key, doc.width, doc.height, 'generated', 'AI image');
      }} />}
      {modal === 'library' && <LibraryPickModal onClose={() => setModal(null)} onPick={(key, w, h, label) => { setModal(null); placeImage(key, w, h, 'product', label); }} />}
      {modal === 'logo' && <LogoPickModal onClose={() => setModal(null)} onPick={(key, w, h) => { setModal(null); placeImage(key, w, h, 'logo', 'Logo'); }} />}
      {modal === 'compose' && <ComposeModal doc={doc} onClose={() => setModal(null)} onDoc={(d) => { setModal(null); setDoc(d); }} />}
    </div>
  );
}

function ExportMenu({ onExport }: { onExport: (f: ExportFormat) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button variant="secondary" size="sm" onClick={() => setOpen((o) => !o)}><Download className="h-4 w-4" /> Export</Button>
      {open && (
        <div className="card absolute right-0 z-30 mt-1 w-80 py-1 shadow-2xl" onMouseLeave={() => setOpen(false)}>
          {EXPORT_FORMATS.map((f) => (
            <button key={f} onClick={() => { setOpen(false); onExport(f); }} className="block w-full px-4 py-2 text-left text-sm hover:bg-slate-800">
              <span className="font-mono text-xs uppercase text-indigo-300">{f}</span> <span className="text-slate-300">{EXPORT_LABELS[f]}</span>
            </button>
          ))}
          <p className="border-t border-slate-800 px-4 py-2 text-[11px] text-slate-500">Native .ai and .afdesign files can't be written by third-party apps. The layered PDF and SVG open with layers intact in Illustrator and Affinity.</p>
        </div>
      )}
    </div>
  );
}

function Canvas({ doc, selected, onSelect, onUpdate }: { doc: DesignDoc; selected: string | null; onSelect: (id: string | null) => void; onUpdate: (id: string, patch: Partial<Layer>) => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const tr = useRef<Konva.Transformer>(null);
  const stage = useRef<Konva.Stage>(null);
  const [box, setBox] = useState({ w: 800, h: 600 });

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scale = Math.min((box.w - 48) / doc.width, (box.h - 48) / doc.height, 1);

  useEffect(() => {
    const t = tr.current;
    if (!t) return;
    const layer = doc.layers.find((l) => l.id === selected);
    const node = selected && layer && !layer.locked ? stage.current?.findOne(`#${selected}`) : null;
    t.nodes(node ? [node] : []);
    t.getLayer()?.batchDraw();
  }, [selected, doc]);

  const onTransformEnd = (l: Layer, node: Konva.Node) => {
    const sx = node.scaleX();
    const sy = node.scaleY();
    node.scaleX(1);
    node.scaleY(1);
    const isEllipse = l.type === 'ellipse';
    const width = Math.max(4, l.width * sx);
    const height = Math.max(4, l.height * sy);
    onUpdate(l.id, {
      x: isEllipse ? node.x() - width / 2 : node.x(),
      y: isEllipse ? node.y() - height / 2 : node.y(),
      width, height, rotation: node.rotation(),
      ...(l.type === 'text' ? { fontSize: Math.round(l.fontSize * sy) } : {}),
    });
  };

  return (
    <div ref={wrap} className="flex min-w-0 flex-1 items-center justify-center overflow-hidden bg-[repeating-conic-gradient(#1e293b_0%_25%,#0f172a_0%_50%)] bg-[length:24px_24px]">
      <Stage
        ref={stage}
        width={doc.width * scale}
        height={doc.height * scale}
        scaleX={scale}
        scaleY={scale}
        className="shadow-2xl"
        onMouseDown={(e) => { if (e.target === e.target.getStage() || e.target.id() === '__bg') onSelect(null); }}
      >
        <KLayer>
          <Rect id="__bg" x={0} y={0} width={doc.width} height={doc.height} fill={doc.background} />
          {doc.layers.filter((l) => l.visible).map((l) => {
            const common = {
              id: l.id,
              opacity: l.opacity,
              rotation: l.rotation,
              draggable: !l.locked,
              onMouseDown: () => onSelect(l.id),
              onTap: () => onSelect(l.id),
              onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => {
                const n = e.target;
                onUpdate(l.id, l.type === 'ellipse' ? { x: n.x() - l.width / 2, y: n.y() - l.height / 2 } : { x: n.x(), y: n.y() });
              },
              onTransformEnd: (e: Konva.KonvaEventObject<Event>) => onTransformEnd(l, e.target),
            };
            switch (l.type) {
              case 'rect':
                return <Rect key={l.id} {...common} x={l.x} y={l.y} width={l.width} height={l.height} fill={l.fill} cornerRadius={l.cornerRadius} stroke={l.stroke} strokeWidth={l.strokeWidth} />;
              case 'ellipse':
                return <Ellipse key={l.id} {...common} x={l.x + l.width / 2} y={l.y + l.height / 2} radiusX={l.width / 2} radiusY={l.height / 2} fill={l.fill} stroke={l.stroke} strokeWidth={l.strokeWidth} />;
              case 'text':
                return (
                  <Text key={l.id} {...common} x={l.x} y={l.y} width={l.width} height={l.height} text={l.text} fontSize={l.fontSize} fontFamily={l.fontFamily}
                    fontStyle={`${l.italic ? 'italic ' : ''}${l.fontWeight === 'bold' ? 'bold' : 'normal'}`} fill={l.color} align={l.align} lineHeight={l.lineHeight} verticalAlign="top" wrap="word" />
                );
              case 'image':
                return <ImageNode key={l.id} layer={l} common={{ ...common, x: l.x, y: l.y }} />;
            }
          })}
          <Transformer ref={tr} rotateEnabled keepRatio={false} boundBoxFunc={(o, n) => (n.width < 4 || n.height < 4 ? o : n)} />
        </KLayer>
      </Stage>
    </div>
  );
}

function LayersPanel({ doc, selected, onSelect, onUpdate, onMove, onRemove }: {
  doc: DesignDoc; selected: string | null; onSelect: (id: string) => void; onUpdate: (id: string, p: Partial<Layer>) => void; onMove: (id: string, d: 1 | -1) => void; onRemove: (id: string) => void;
}) {
  const top = [...doc.layers].reverse();
  return (
    <aside className="w-60 shrink-0 overflow-y-auto border-r border-slate-800 bg-slate-950">
      <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Layers</div>
      {top.length === 0 && <p className="px-3 text-xs text-slate-500">Add text, shapes or images from the toolbar.</p>}
      {top.map((l) => (
        <div key={l.id} onClick={() => onSelect(l.id)} className={`group flex items-center gap-1 px-2 py-1.5 text-sm ${selected === l.id ? 'bg-indigo-600/20' : 'hover:bg-slate-900'}`}>
          <button onClick={(e) => { e.stopPropagation(); onUpdate(l.id, { visible: !l.visible }); }} className="text-slate-500 hover:text-slate-200">{l.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}</button>
          <button onClick={(e) => { e.stopPropagation(); onUpdate(l.id, { locked: !l.locked }); }} className="text-slate-500 hover:text-slate-200">{l.locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5 opacity-40" />}</button>
          <span className={`ml-1 flex-1 truncate ${l.visible ? '' : 'text-slate-600'}`}>{l.name}</span>
          <span className="hidden gap-0.5 group-hover:flex">
            <button onClick={(e) => { e.stopPropagation(); onMove(l.id, 1); }} title="Bring forward" className="text-slate-500 hover:text-slate-200"><ArrowUp className="h-3.5 w-3.5" /></button>
            <button onClick={(e) => { e.stopPropagation(); onMove(l.id, -1); }} title="Send backward" className="text-slate-500 hover:text-slate-200"><ArrowDown className="h-3.5 w-3.5" /></button>
            <button onClick={(e) => { e.stopPropagation(); onRemove(l.id); }} title="Delete" className="text-slate-500 hover:text-rose-400"><Trash2 className="h-3.5 w-3.5" /></button>
          </span>
        </div>
      ))}
      <div className="mt-2 border-t border-slate-800 px-3 py-2 text-xs text-slate-500">Background</div>
    </aside>
  );
}

function Num({ label, value, onChange, step = 1 }: { label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <label className="block">
      <span className="text-[11px] text-slate-500">{label}</span>
      <input type="number" step={step} className="input py-1 text-xs" value={Math.round(value * 100) / 100} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function ColorInput({ value, onChange, swatches }: { value: string; onChange: (v: string) => void; swatches: { name: string; hex: string }[] }) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'} onChange={(e) => onChange(e.target.value)} className="h-8 w-8 rounded bg-transparent" />
        <input className="input py-1 font-mono text-xs" value={value} onChange={(e) => onChange(e.target.value)} />
      </div>
      {swatches.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {swatches.map((s) => <button key={s.hex + s.name} title={s.name} onClick={() => onChange(s.hex)} className="h-5 w-5 rounded border border-slate-700" style={{ backgroundColor: s.hex }} />)}
        </div>
      )}
    </div>
  );
}

function PropertiesPanel({ doc, layer, colors, fonts, onUpdate, onDoc }: {
  doc: DesignDoc; layer: Layer | null; colors: { name: string; hex: string }[]; fonts: { role: string; family: string }[]; onUpdate: (id: string, p: Partial<Layer>) => void; onDoc: (d: DesignDoc) => void;
}) {
  const up = (p: Partial<Layer>) => layer && onUpdate(layer.id, p);
  return (
    <aside className="w-72 shrink-0 space-y-4 overflow-y-auto border-l border-slate-800 bg-slate-950 p-4">
      {!layer ? (
        <>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Canvas</div>
          <div className="grid grid-cols-2 gap-2">
            <Num label="Width" value={doc.width} onChange={(v) => v > 0 && onDoc({ ...doc, width: Math.round(v) })} />
            <Num label="Height" value={doc.height} onChange={(v) => v > 0 && onDoc({ ...doc, height: Math.round(v) })} />
          </div>
          <Field label="Resize to platform">
            <select className="input py-1 text-xs" value="" onChange={(e) => { const p = PLATFORM_PRESETS[e.target.value as Platform]; if (p) onDoc({ ...doc, width: p.width, height: p.height }); }}>
              <option value="">Choose...</option>
              {PLATFORMS.map((p) => <option key={p} value={p}>{PLATFORM_PRESETS[p].label} ({PLATFORM_PRESETS[p].width}×{PLATFORM_PRESETS[p].height})</option>)}
            </select>
          </Field>
          <Field label="Background"><ColorInput value={doc.background} onChange={(v) => onDoc({ ...doc, background: v })} swatches={colors} /></Field>
          <p className="text-xs text-slate-500">Select a layer to edit it. Every layer stays separate in PSD, SVG, PDF and IDML exports.</p>
        </>
      ) : (
        <>
          <Field label="Layer name"><input className="input py-1 text-xs" value={layer.name} onChange={(e) => up({ name: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Num label="X" value={layer.x} onChange={(v) => up({ x: v })} />
            <Num label="Y" value={layer.y} onChange={(v) => up({ y: v })} />
            <Num label="Width" value={layer.width} onChange={(v) => v > 0 && up({ width: v })} />
            <Num label="Height" value={layer.height} onChange={(v) => v > 0 && up({ height: v })} />
            <Num label="Rotation" value={layer.rotation} onChange={(v) => up({ rotation: v })} />
            <Num label="Opacity" value={layer.opacity} step={0.05} onChange={(v) => up({ opacity: Math.min(1, Math.max(0, v)) })} />
          </div>
          {layer.type === 'text' && (
            <>
              <Field label="Text"><textarea className="input text-sm" rows={4} value={layer.text} onChange={(e) => up({ text: e.target.value })} /></Field>
              <Field label="Font">
                <input className="input py-1 text-xs" list="brand-fonts" value={layer.fontFamily} onChange={(e) => up({ fontFamily: e.target.value })} />
                <datalist id="brand-fonts">{fonts.map((f) => <option key={f.family + f.role} value={f.family}>{f.role}</option>)}</datalist>
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Num label="Size" value={layer.fontSize} onChange={(v) => v > 0 && up({ fontSize: v })} />
                <Num label="Line height" value={layer.lineHeight} step={0.05} onChange={(v) => up({ lineHeight: v })} />
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant={layer.fontWeight === 'bold' ? 'primary' : 'secondary'} onClick={() => up({ fontWeight: layer.fontWeight === 'bold' ? 'normal' : 'bold' })}><b>B</b></Button>
                <Button size="sm" variant={layer.italic ? 'primary' : 'secondary'} onClick={() => up({ italic: !layer.italic })}><i>I</i></Button>
                {(['left', 'center', 'right'] as const).map((a) => <Button key={a} size="sm" variant={layer.align === a ? 'primary' : 'secondary'} onClick={() => up({ align: a })}>{a}</Button>)}
              </div>
              <Field label="Color"><ColorInput value={layer.color} onChange={(v) => up({ color: v })} swatches={colors} /></Field>
            </>
          )}
          {(layer.type === 'rect' || layer.type === 'ellipse') && (
            <>
              <Field label="Fill"><ColorInput value={layer.fill} onChange={(v) => up({ fill: v })} swatches={colors} /></Field>
              {layer.type === 'rect' && <Num label="Corner radius" value={layer.cornerRadius} onChange={(v) => up({ cornerRadius: Math.max(0, v) })} />}
              <Num label="Border width" value={layer.strokeWidth} onChange={(v) => up({ strokeWidth: Math.max(0, v), stroke: layer.stroke ?? '#000000' })} />
              {layer.strokeWidth > 0 && <Field label="Border color"><ColorInput value={layer.stroke ?? '#000000'} onChange={(v) => up({ stroke: v })} swatches={colors} /></Field>}
            </>
          )}
          {layer.type === 'image' && (
            <Field label="Fit">
              <select className="input py-1 text-xs" value={layer.fit} onChange={(e) => up({ fit: e.target.value as ImageLayer['fit'] })}>
                <option value="cover">Cover (crop to fill)</option>
                <option value="contain">Contain (fit inside)</option>
                <option value="fill">Stretch</option>
              </select>
            </Field>
          )}
          <Button size="sm" variant="secondary" onClick={() => up({ x: (doc.width - layer.width) / 2 })}>Center horizontally</Button>
        </>
      )}
    </aside>
  );
}

function AiImageModal({ doc, onClose, onPlace }: { doc: DesignDoc; onClose: () => void; onPlace: (key: string, asBackground: boolean) => void }) {
  const [prompt, setPrompt] = useState('');
  const [bg, setBg] = useState(true);
  const gen = useMutation({
    mutationFn: () => api.post<{ key: string }>('/generate/image', { prompt, width: doc.width, height: doc.height }),
    onSuccess: (r) => onPlace(r.key, bg),
  });
  return (
    <Modal open onClose={onClose} title="Generate an image">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); gen.mutate(); }}>
        <Field label="Describe the image"><textarea className="input" rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} required placeholder="Sunlit workshop with warm wood tones, shallow depth of field" /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={bg} onChange={(e) => setBg(e.target.checked)} /> Use as full-size background</label>
        <p className="text-xs text-slate-500">Brand colors are added to the prompt automatically.</p>
        <ErrorText error={gen.error ? errorMessage(gen.error) : null} />
        <div className="flex justify-end"><Button type="submit" loading={gen.isPending}><Sparkles className="h-4 w-4" /> Generate</Button></div>
      </form>
    </Modal>
  );
}

function LibraryPickModal({ onClose, onPick }: { onClose: () => void; onPick: (key: string, w: number, h: number, label: string) => void }) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { data } = useQuery({ queryKey: ['assets', 'pick', q], queryFn: () => api.get<{ items: Asset[] }>(`/library/assets?kind=IMAGE&forAi=1&q=${encodeURIComponent(q)}`) });
  const pick = async (a: Asset) => {
    setBusy(a.id);
    setError(null);
    try {
      let key = a.storedKey;
      if (!key) {
        const up = (await window.api.library.upload(a.id, a.relPath)) as Asset;
        key = up.storedKey;
      }
      if (!key) throw new Error('Upload failed');
      const img = new window.Image();
      img.src = fileUrl(key)!;
      await img.decode();
      onPick(key, img.naturalWidth, img.naturalHeight, a.relPath.split('/').pop() ?? 'Image');
    } catch (e) {
      setError(`${errorMessage(e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Modal open onClose={onClose} title="Place from asset library" width="max-w-3xl">
      <input className="input mb-3" placeholder="Search..." value={q} onChange={(e) => setQ(e.target.value)} />
      <ErrorText error={error} />
      <div className="mt-2 grid max-h-[60vh] grid-cols-5 gap-2 overflow-y-auto">
        {data?.items.map((a) => (
          <button key={a.id} onClick={() => void pick(a)} disabled={!!busy} className="relative aspect-square overflow-hidden rounded border border-slate-800 hover:border-indigo-500">
            {a.thumbnailKey && <img src={fileUrl(a.thumbnailKey)} className="h-full w-full object-cover" />}
            {busy === a.id && <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-xs">Uploading...</div>}
          </button>
        ))}
      </div>
      <p className="mt-3 text-xs text-slate-500">The full-resolution file is read from the shared drive on your PC and uploaded once.</p>
    </Modal>
  );
}

function LogoPickModal({ onClose, onPick }: { onClose: () => void; onPick: (key: string, w: number, h: number) => void }) {
  const { data } = useQuery({ queryKey: ['brand-files', 'LOGO'], queryFn: () => api.get<{ id: string; name: string; storageKey: string }[]>('/brand/files?kind=LOGO') });
  const pick = async (key: string) => {
    const img = new window.Image();
    img.src = fileUrl(key)!;
    await img.decode();
    onPick(key, img.naturalWidth || 400, img.naturalHeight || 200);
  };
  return (
    <Modal open onClose={onClose} title="Place a logo">
      {!data?.length ? <p className="text-sm text-slate-500">Upload logos under Knowledge base → Brand.</p> : (
        <div className="grid grid-cols-3 gap-3">
          {data.map((f) => (
            <button key={f.id} onClick={() => void pick(f.storageKey)} className="rounded border border-slate-800 bg-slate-100 p-3 hover:border-indigo-500">
              <img src={fileUrl(f.storageKey)} className="h-16 w-full object-contain" />
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

function ComposeModal({ doc, onClose, onDoc }: { doc: DesignDoc; onClose: () => void; onDoc: (d: DesignDoc) => void }) {
  const [headline, setHeadline] = useState('');
  const [subline, setSubline] = useState('');
  const [imagePrompt, setImagePrompt] = useState('');
  const platform = (PLATFORMS.find((p) => PLATFORM_PRESETS[p].width === doc.width && PLATFORM_PRESETS[p].height === doc.height) ?? 'instagram') as Platform;
  const compose = useMutation({
    mutationFn: () => api.post<{ doc: DesignDoc }>('/designs/compose', { headline, subline, platform, imagePrompt: imagePrompt || undefined }),
    onSuccess: (r) => onDoc(r.doc),
  });
  return (
    <Modal open onClose={onClose} title="AI layout">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); compose.mutate(); }}>
        <p className="text-sm text-slate-400">Builds an on-brand layout (background, brand colors, logo, headline) as editable layers. This replaces the current canvas; you can undo.</p>
        <Field label="Headline"><input className="input" value={headline} onChange={(e) => setHeadline(e.target.value)} required /></Field>
        <Field label="Subline"><input className="input" value={subline} onChange={(e) => setSubline(e.target.value)} /></Field>
        <Field label="Background image prompt (optional)"><input className="input" value={imagePrompt} onChange={(e) => setImagePrompt(e.target.value)} /></Field>
        <p className="text-xs text-slate-500">Layout size: {PLATFORM_PRESETS[platform].label} ({PLATFORM_PRESETS[platform].width}×{PLATFORM_PRESETS[platform].height})</p>
        <ErrorText error={compose.error ? errorMessage(compose.error) : null} />
        <div className="flex justify-end"><Button type="submit" loading={compose.isPending}><Wand2 className="h-4 w-4" /> Compose</Button></div>
      </form>
    </Modal>
  );
}
