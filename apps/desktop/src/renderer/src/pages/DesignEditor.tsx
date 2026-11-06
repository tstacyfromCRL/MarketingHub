import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Circle as KCircle, Ellipse, Image as KImage, Layer as KLayer, Line, Path as KPath, Rect, Stage, Text, Transformer } from 'react-konva';
import type Konva from 'konva';
import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalDistributeCenter, AlignStartHorizontal, AlignStartVertical, AlignVerticalDistributeCenter,
  ArrowDown, ArrowLeft, ArrowUp, ChevronsDown, ChevronsUp, Circle, Copy, Download, Eye, EyeOff, ImagePlus, Library, Lock, MousePointer2, PenTool, Redo2, Save, Sparkles, Spline, Square, Trash2, Type, Undo2, Unlock, Wand2, ZoomIn, ZoomOut,
} from 'lucide-react';
import {
  EXPORT_FORMATS, PLATFORMS, PLATFORM_PRESETS, alignLayers, bakeRotation, cornerAnchor, deleteAnchor, distributeLayers, duplicateLayers, framePath, insertAnchor, moveAnchor, nearestAnchor, nearestSegment, newLayerId, nudgeLayers, pagePoints, pasteLayers, pathSvgData, placeBrandPiece, scalePathBox, setHandle, smoothAnchor, snapPosition, stackLayer, tangentStub,
  type AlignEdge, type BrandProfileInput, type DesignDoc, type ExportFormat, type ImageLayer, type Layer, type PathLayer, type PathPoint, type Platform,
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
  const [selected, setSelected] = useState<string[]>([]);
  const [zoom, setZoom] = useState(1);
  const [tool, setTool] = useState<'select' | 'pen' | 'nodes'>('select');
  const [draft, setDraft] = useState<PathPoint[]>([]);
  const [nodeIndex, setNodeIndex] = useState<number | null>(null);
  const clipboard = useRef<Layer[]>([]);
  const penDrag = useRef<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [modal, setModal] = useState<'ai-image' | 'library' | 'logo' | 'background' | 'overlay' | 'compose' | null>(null);
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
        setSelected([layer.id]);
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
    setSelected([layer.id]);
  };
  const removeLayer = (lid: string) => {
    if (!doc) return;
    setDoc({ ...doc, layers: doc.layers.filter((l) => l.id !== lid) });
    setSelected((cur) => cur.filter((id) => id !== lid));
  };
  const selectLayer = (id: string | null, additive = false) => {
    if (!id) {
      setSelected([]);
      return;
    }
    setSelected((cur) => (additive ? (cur.includes(id) ? cur.filter((item) => item !== id) : [...cur, id]) : [id]));
  };
  const duplicateSelected = () => {
    if (!doc) return;
    const result = duplicateLayers(doc, selected);
    if (!result.ids.length) return;
    setDoc(result.doc);
    setSelected(result.ids);
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

  // Pen points stay in page coordinates until the stroke is finished. Nodes then edits that one curve.
  const editingPath = doc?.layers.find((layer) => layer.type === 'path' && selected.length === 1 && layer.id === selected[0]);

  const writePath = (layer: PathLayer, points: PathPoint[], patch: Partial<PathLayer> = {}) => {
    if (!doc) return;
    const framed = framePath(points);
    setDoc({ ...doc, layers: doc.layers.map((item) => (item.id === layer.id ? { ...layer, ...patch, ...framed } : item)) });
  };

  const finishDraft = (closed: boolean) => {
    if (!doc || draft.length < 2) {
      setDraft([]);
      penDrag.current = null;
      return;
    }
    const framed = framePath(draft);
    const layer: PathLayer = {
      id: newLayerId(), name: 'Path', type: 'path', ...framed, closed,
      fill: 'none', stroke: brand.data?.colors?.[0]?.hex ?? '#111827', strokeWidth: 4,
      rotation: 0, opacity: 1, visible: true, locked: false,
    };
    setDoc({ ...doc, layers: [...doc.layers, layer] });
    setSelected([layer.id]);
    setDraft([]);
    setNodeIndex(null);
    setTool('nodes');
    penDrag.current = null;
  };

  const penDown = (pos: { x: number; y: number }, closeRadius = 12) => {
    if (draft.length >= 3 && Math.hypot(pos.x - draft[0].x, pos.y - draft[0].y) < closeRadius) {
      finishDraft(true);
      return;
    }
    penDrag.current = draft.length;
    setDraft((points) => [...points, { x: pos.x, y: pos.y }]);
  };

  const penMove = (pos: { x: number; y: number }) => {
    const index = penDrag.current;
    if (index == null) return;
    setDraft((points) => {
      const anchor = points[index];
      if (!anchor) return points;
      const dx = pos.x - anchor.x;
      const dy = pos.y - anchor.y;
      if (Math.hypot(dx, dy) < 4) return points;
      return points.map((point, i) => (i === index ? { ...point, outX: dx, outY: dy, inX: -dx, inY: -dy } : point));
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName);
      if (typing) return;
      if (e.key === 'Escape') {
        setDraft([]);
        penDrag.current = null;
        setNodeIndex(null);
        setTool('select');
        return;
      }
      if (e.key === 'Enter' && tool === 'pen') { e.preventDefault(); finishDraft(false); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && tool === 'pen' && draft.length) {
        e.preventDefault();
        setDraft((points) => points.slice(0, -1));
        penDrag.current = null;
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && tool === 'nodes' && nodeIndex != null && editingPath && editingPath.type === 'path') {
        const next = deleteAnchor(pagePoints(editingPath), nodeIndex);
        if (next) {
          writePath(editingPath, next);
          setNodeIndex(null);
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelected(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); if (doc) setSelected(doc.layers.map((layer) => layer.id)); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && doc) clipboard.current = doc.layers.filter((layer) => selected.includes(layer.id)).map((layer) => ({ ...layer }));
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v' && doc && clipboard.current.length) {
        e.preventDefault();
        const result = pasteLayers(doc, clipboard.current);
        setDoc(result.doc);
        setSelected(result.ids);
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected.length && doc) {
        const drop = new Set(selected);
        setDoc({ ...doc, layers: doc.layers.filter((layer) => !drop.has(layer.id) || layer.locked) });
        setSelected([]);
      }
      if (doc && selected.length && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        setDoc(nudgeLayers(doc, selected, dx, dy));
      }
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
  const selectedLayers = doc.layers.filter((layer) => selected.includes(layer.id) && !layer.locked);
  const sel = selectedLayers.length === 1 ? selectedLayers[0] : null;
  const alignSelection = (edge: AlignEdge) => setDoc(alignLayers(doc, selected, edge));
  const editNodes = () => {
    if (sel?.type !== 'path') return;
    if (sel.rotation) writePath(sel, bakeRotation(sel), { rotation: 0 });
    setNodeIndex(null);
    setTool('nodes');
  };
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
        <Button variant="ghost" size="sm" title="Ellipse" onClick={() => { setTool('select'); addLayer({ id: newLayerId(), name: 'Ellipse', type: 'ellipse', fill: colors[2]?.hex ?? '#f59e0b', strokeWidth: 0, x: doc.width * 0.35, y: doc.height * 0.35, width: doc.width * 0.3, height: doc.width * 0.3, rotation: 0, opacity: 1, visible: true, locked: false }); }}><Circle className="h-4 w-4" /></Button>
        <div className="mx-1 h-5 w-px bg-slate-800" />
        <Button variant={tool === 'select' ? 'secondary' : 'ghost'} size="sm" title="Select and move" onClick={() => { setTool('select'); setDraft([]); }}><MousePointer2 className="h-4 w-4" /></Button>
        <Button variant={tool === 'pen' ? 'secondary' : 'ghost'} size="sm" title="Pen: click for corners, drag for curves" onClick={() => { setTool('pen'); setDraft([]); setNodeIndex(null); }}><PenTool className="h-4 w-4" /> Pen</Button>
        <Button variant={tool === 'nodes' ? 'secondary' : 'ghost'} size="sm" title="Edit the anchors and handles of the selected path" disabled={sel?.type !== 'path'} onClick={editNodes}><Spline className="h-4 w-4" /> Nodes</Button>
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800" title="Upload image">
          <ImagePlus className="h-4 w-4" /> Upload
          <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadImage(f).catch((err) => setError(errorMessage(err))); e.target.value = ''; }} />
        </label>
        <Button variant="ghost" size="sm" onClick={() => setModal('background')}>Background</Button>
        <Button variant="ghost" size="sm" onClick={() => setModal('overlay')}>Overlay</Button>
        <Button variant="ghost" size="sm" onClick={() => setModal('logo')}>Logo</Button>
        <Button variant="ghost" size="sm" onClick={() => setModal('library')}><Library className="h-4 w-4" /> Image</Button>
        <Button variant="ghost" size="sm" onClick={() => setModal('ai-image')}><Sparkles className="h-4 w-4" /> AI image</Button>
        <Button variant="ghost" size="sm" onClick={() => setModal('compose')}><Wand2 className="h-4 w-4" /> AI layout</Button>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" onClick={undo} disabled={!past.length} title="Undo (Ctrl+Z)"><Undo2 className="h-4 w-4" /></Button>
        <Button variant="ghost" size="sm" onClick={redo} disabled={!future.length} title="Redo (Ctrl+Y)"><Redo2 className="h-4 w-4" /></Button>
        <ExportMenu onExport={(f) => void exportAs(f)} />
        <Button size="sm" onClick={() => save.mutate()} loading={save.isPending}><Save className="h-4 w-4" /> Save</Button>
      </div>
      <div className="flex flex-wrap items-center gap-1 border-b border-slate-800 px-4 py-1">
        <span className="mr-1 text-[11px] uppercase tracking-wide text-slate-500">Align</span>
        {([
          ['left', 'Align left', AlignStartHorizontal],
          ['center', 'Align center', AlignCenterHorizontal],
          ['right', 'Align right', AlignEndHorizontal],
          ['top', 'Align top', AlignStartVertical],
          ['middle', 'Align middle', AlignCenterVertical],
          ['bottom', 'Align bottom', AlignEndVertical],
        ] as const).map(([edge, title, Icon]) => (
          <Button key={edge} variant="ghost" size="sm" title={selectedLayers.length > 1 ? `${title} to the selection` : `${title} to the page`} disabled={!selectedLayers.length} onClick={() => alignSelection(edge)}><Icon className="h-4 w-4" /></Button>
        ))}
        <Button variant="ghost" size="sm" title="Equal gaps across" disabled={selectedLayers.length < 3} onClick={() => setDoc(distributeLayers(doc, selected, 'horizontal'))}><AlignHorizontalDistributeCenter className="h-4 w-4" /></Button>
        <Button variant="ghost" size="sm" title="Equal gaps down" disabled={selectedLayers.length < 3} onClick={() => setDoc(distributeLayers(doc, selected, 'vertical'))}><AlignVerticalDistributeCenter className="h-4 w-4" /></Button>
        <div className="mx-1 h-5 w-px bg-slate-800" />
        <Button variant="ghost" size="sm" title="Duplicate (Ctrl+D)" disabled={!selectedLayers.length} onClick={duplicateSelected}><Copy className="h-4 w-4" /></Button>
        <Button variant="ghost" size="sm" title="Bring to front" disabled={selected.length !== 1} onClick={() => setDoc(stackLayer(doc, selected[0], 'front'))}><ChevronsUp className="h-4 w-4" /></Button>
        <Button variant="ghost" size="sm" title="Send to back" disabled={selected.length !== 1} onClick={() => setDoc(stackLayer(doc, selected[0], 'back'))}><ChevronsDown className="h-4 w-4" /></Button>
        <div className="mx-1 h-5 w-px bg-slate-800" />
        <Button variant="ghost" size="sm" title="Zoom out" onClick={() => setZoom((value) => Math.max(0.25, value / 1.25))}><ZoomOut className="h-4 w-4" /></Button>
        <button type="button" className="px-1 text-xs text-slate-400" title="Fit the page" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
        <Button variant="ghost" size="sm" title="Zoom in" onClick={() => setZoom((value) => Math.min(8, value * 1.25))}><ZoomIn className="h-4 w-4" /></Button>
        <span className="ml-2 text-[11px] text-slate-500">
          {tool === 'pen' ? 'Click to place points. Drag to curve. Click the first point to close. Enter finishes. Escape cancels.' : tool === 'nodes' ? 'Drag a tangent handle to bend one side. The other stays in line and keeps its length. Alt breaks the tangent. A dashed handle is still straight. Click a segment to add a point. Double-click a point for a corner. Delete removes it.' : 'Shift-click selects more. Arrows nudge. Ctrl+C and Ctrl+V copy.'}
        </span>
      </div>
      {error && <div className="border-b border-rose-900 bg-rose-950/50 px-4 py-1.5 text-sm text-rose-300">{error} <button className="ml-2 underline" onClick={() => setError(null)}>dismiss</button></div>}

      <div className="flex min-h-0 flex-1">
        <LayersPanel doc={doc} selected={selected} onSelect={selectLayer} onUpdate={updateLayer} onMove={moveLayer} onRemove={removeLayer} />
        <Canvas
          doc={doc}
          selected={selected}
          zoom={zoom}
          tool={tool}
          draft={draft}
          nodeIndex={nodeIndex}
          onZoom={setZoom}
          onSelect={selectLayer}
          onUpdate={updateLayer}
          onCommit={setDoc}
          onPenDown={penDown}
          onPenMove={penMove}
          onPenUp={() => { penDrag.current = null; }}
          onNodeIndex={setNodeIndex}
          onPathPoints={(layer, points) => writePath(layer, points)}
        />
        <PropertiesPanel doc={doc} layer={sel} selectedCount={selected.length} colors={colors} fonts={fonts} onUpdate={updateLayer} onDoc={setDoc} onEditNodes={editNodes} />
      </div>

      {modal === 'ai-image' && <AiImageModal doc={doc} onClose={() => setModal(null)} onPlace={(key, bg) => {
        setModal(null);
        if (bg) addLayer({ id: newLayerId(), name: 'AI background', type: 'image', src: key, fit: 'cover', role: 'generated', x: 0, y: 0, width: doc.width, height: doc.height, rotation: 0, opacity: 1, visible: true, locked: false });
        else placeImage(key, doc.width, doc.height, 'generated', 'AI image');
      }} />}
      {modal === 'library' && <LibraryPickModal onClose={() => setModal(null)} onPick={(key, w, h, label) => { setModal(null); placeImage(key, w, h, 'product', label); }} />}
      {modal === 'background' && <BrandFileModal kind="BACKGROUND" title="Choose a background" empty="Upload backgrounds on Brand kit." onClose={() => setModal(null)} onPick={(key, name) => { setModal(null); const placed = placeBrandPiece(doc, { src: key, name, slot: 'background' }); setDoc(placed.doc); setSelected([placed.layerId]); }} />}
      {modal === 'overlay' && <BrandFileModal kind="GRAPHIC" title="Choose an overlay" empty="Upload patterns and overlays on Brand kit." onClose={() => setModal(null)} onPick={(key, name) => { setModal(null); const placed = placeBrandPiece(doc, { src: key, name, slot: 'overlay' }); setDoc(placed.doc); setSelected([placed.layerId]); }} />}
      {modal === 'logo' && <BrandFileModal kind="LOGO" title="Choose a logo" empty="Upload logos on Brand kit." onClose={() => setModal(null)} onPick={(key, _name, w, h) => { setModal(null); placeImage(key, w, h, 'logo', 'Logo'); }} />}
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

function Canvas({ doc, selected, zoom, tool, draft, nodeIndex, onZoom, onSelect, onUpdate, onCommit, onPenDown, onPenMove, onPenUp, onNodeIndex, onPathPoints }: {
  doc: DesignDoc;
  selected: string[];
  zoom: number;
  tool: 'select' | 'pen' | 'nodes';
  draft: PathPoint[];
  nodeIndex: number | null;
  onZoom: (zoom: number | ((current: number) => number)) => void;
  onSelect: (id: string | null, additive?: boolean) => void;
  onUpdate: (id: string, patch: Partial<Layer>) => void;
  onCommit: (doc: DesignDoc) => void;
  onPenDown: (pos: { x: number; y: number }, closeRadius?: number) => void;
  onPenMove: (pos: { x: number; y: number }) => void;
  onPenUp: () => void;
  onNodeIndex: (index: number | null) => void;
  onPathPoints: (layer: PathLayer, points: PathPoint[]) => void;
}) {
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

  const fit = Math.min((box.w - 48) / doc.width, (box.h - 48) / doc.height, 1);
  const scale = fit * zoom;

  useEffect(() => {
    const t = tr.current;
    if (!t) return;
    if (tool !== 'select') {
      t.nodes([]);
      t.getLayer()?.batchDraw();
      return;
    }
    const nodes = selected
      .map((id) => doc.layers.find((layer) => layer.id === id))
      .filter((layer): layer is Layer => Boolean(layer && !layer.locked))
      .map((layer) => stage.current?.findOne(`#${layer.id}`))
      .filter((node): node is Konva.Node => Boolean(node));
    t.nodes(nodes);
    t.getLayer()?.batchDraw();
  }, [selected, doc, tool]);

  const finishTransform = () => {
    const patches = new Map<string, Partial<Layer>>();
    for (const id of selected) {
      const layer = doc.layers.find((item) => item.id === id);
      const node = stage.current?.findOne(`#${id}`);
      if (!layer || !node || layer.locked) continue;
      const sx = node.scaleX();
      const sy = node.scaleY();
      node.scaleX(1);
      node.scaleY(1);
      if (layer.type === 'path') {
        const page = layer.points.map((point) => ({
          ...point,
          x: node.x() + point.x * sx,
          y: node.y() + point.y * sy,
          inX: point.inX === undefined ? undefined : point.inX * sx,
          inY: point.inY === undefined ? undefined : point.inY * sy,
          outX: point.outX === undefined ? undefined : point.outX * sx,
          outY: point.outY === undefined ? undefined : point.outY * sy,
        }));
        patches.set(layer.id, { ...framePath(page), rotation: node.rotation() });
        continue;
      }
      const width = Math.max(4, layer.width * sx);
      const height = Math.max(4, layer.height * sy);
      patches.set(id, {
        x: layer.type === 'ellipse' ? node.x() - width / 2 : node.x(),
        y: layer.type === 'ellipse' ? node.y() - height / 2 : node.y(),
        width,
        height,
        rotation: node.rotation(),
        ...(layer.type === 'text' ? { fontSize: Math.round(layer.fontSize * sy) } : {}),
      });
    }
    if (!patches.size) return;
    onCommit({ ...doc, layers: doc.layers.map((layer) => (patches.has(layer.id) ? ({ ...layer, ...patches.get(layer.id) } as Layer) : layer)) });
  };

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      onZoom((current) => Math.min(8, Math.max(0.25, current * (event.deltaY > 0 ? 0.9 : 1.1))));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [onZoom]);

  return (
    <div ref={wrap} className="min-w-0 flex-1 overflow-auto bg-[repeating-conic-gradient(#1e293b_0%_25%,#0f172a_0%_50%)] bg-[length:24px_24px]">
      <div className="flex min-h-full min-w-full items-center justify-center p-6">
      <Stage
        ref={stage}
        width={doc.width * scale}
        height={doc.height * scale}
        scaleX={scale}
        scaleY={scale}
        className="shadow-2xl"
        onMouseDown={(e) => {
          const pos = e.target.getStage()?.getRelativePointerPosition();
          if (tool === 'pen' && pos) { onPenDown(pos, 16 / scale); return; }
          if (tool === 'nodes' && pos && e.target.name() !== 'path-node' && e.target.name() !== 'path-handle') {
            const path = doc.layers.find((layer) => layer.type === 'path' && selected.includes(layer.id));
            if (path && path.type === 'path') {
              const page = pagePoints(path);
              if (nearestAnchor(page, pos.x, pos.y, 14 / scale) == null) {
                const segment = nearestSegment(page, path.closed, pos.x, pos.y, 12 / scale);
                if (segment != null) onPathPoints(path, insertAnchor(page, segment, path.closed));
              }
            }
            return;
          }
          if (e.target === e.target.getStage() || e.target.id() === '__bg') onSelect(null);
        }}
        onMouseMove={(e) => {
          if (tool !== 'pen') return;
          const pos = e.target.getStage()?.getRelativePointerPosition();
          if (pos) onPenMove(pos);
        }}
        onMouseUp={() => { if (tool === 'pen') onPenUp(); }}
      >
        <KLayer>
          <Rect id="__bg" x={0} y={0} width={doc.width} height={doc.height} fill={doc.background} />
          {(doc.guides ?? []).map((guide) => (
            <Line
              key={guide.id}
              listening={false}
              stroke="#38bdf8"
              strokeWidth={1}
              dash={[4, 4]}
              points={guide.axis === 'x' ? [guide.position, 0, guide.position, doc.height] : [0, guide.position, doc.width, guide.position]}
            />
          ))}
          {doc.layers.filter((l) => l.visible).map((l) => {
            const common = {
              id: l.id,
              opacity: l.opacity,
              rotation: l.rotation,
              draggable: tool === 'select' && !l.locked,
              onMouseDown: (e: Konva.KonvaEventObject<MouseEvent>) => { if (tool === 'select') onSelect(l.id, e.evt.shiftKey); },
              onTap: () => { if (tool === 'select') onSelect(l.id); },
              onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => {
                const n = e.target;
                const rawX = l.type === 'ellipse' ? n.x() - l.width / 2 : n.x();
                const rawY = l.type === 'ellipse' ? n.y() - l.height / 2 : n.y();
                const snapped = snapPosition(
                  { x: rawX, y: rawY, width: l.width, height: l.height },
                  { x: 0, y: 0, width: doc.width, height: doc.height },
                  doc.guides ?? [],
                  doc.layers.filter((other) => other.id !== l.id && other.visible),
                  6,
                );
                const dx = snapped.x - l.x;
                const dy = snapped.y - l.y;
                const moving = new Set(selected.includes(l.id) ? selected : [l.id]);
                onCommit({
                  ...doc,
                  layers: doc.layers.map((layer) => (moving.has(layer.id) && !layer.locked ? { ...layer, x: layer.x + dx, y: layer.y + dy } : layer)),
                });
              },
            };
            switch (l.type) {
              case 'rect':
                return <Rect key={l.id} {...common} x={l.x} y={l.y} width={l.width} height={l.height} fill={l.fill} cornerRadius={l.cornerRadius} stroke={l.stroke} strokeWidth={l.strokeWidth} />;
              case 'ellipse':
                return <Ellipse key={l.id} {...common} x={l.x + l.width / 2} y={l.y + l.height / 2} radiusX={l.width / 2} radiusY={l.height / 2} fill={l.fill} stroke={l.stroke} strokeWidth={l.strokeWidth} />;
              case 'text':
                return (
                  <Text key={l.id} {...common} x={l.x} y={l.y} width={l.width} height={l.height} text={l.text} fontSize={l.fontSize} fontFamily={l.fontFamily}
                    fontStyle={`${l.italic ? 'italic ' : ''}${l.fontWeight === 'bold' ? 'bold' : 'normal'}`} fill={l.color} align={l.align} lineHeight={l.lineHeight} letterSpacing={l.letterSpacing ?? 0} textDecoration={l.underline ? 'underline' : ''} verticalAlign="top" wrap="word" />
                );
              case 'image':
                return <ImageNode key={l.id} layer={l} common={{ ...common, x: l.x, y: l.y }} />;
              case 'path':
                return (
                  <KPath
                    key={l.id}
                    {...common}
                    x={l.x}
                    y={l.y}
                    data={pathSvgData(l.points, l.closed)}
                    stroke={l.strokeWidth > 0 ? l.stroke : undefined}
                    strokeWidth={l.strokeWidth}
                    fill={l.fill === 'none' ? undefined : l.fill}
                    lineCap="round"
                    lineJoin="round"
                    hitStrokeWidth={Math.max(l.strokeWidth, 14)}
                  />
                );
            }
          })}
          {draft.length > 0 && (
            <>
              <KPath listening={false} data={pathSvgData(draft, false)} stroke="#38bdf8" strokeWidth={2 / scale} dash={[6 / scale, 4 / scale]} />
              {draft.map((point, index) => <KCircle key={`draft-${index}`} listening={false} x={point.x} y={point.y} radius={4 / scale} fill="#38bdf8" />)}
            </>
          )}
          {tool === 'nodes' && doc.layers.filter((layer): layer is PathLayer => layer.type === 'path' && selected.includes(layer.id)).map((layer) => {
            const page = pagePoints(layer);
            const radius = 5 / scale;
            return (
              <Fragment key={`nodes-${layer.id}`}>
                {page.map((point, index) => (
                  <Fragment key={`${layer.id}-${index}`}>
                    {(['in', 'out'] as const).map((side) => {
                      // A dashed stub is only a suggestion. Pulling it stores a real tangent handle.
                      const realX = side === 'in' ? point.inX : point.outX;
                      const realY = side === 'in' ? point.inY : point.outY;
                      const has = realX != null || realY != null;
                      const stub = has ? null : tangentStub(page, index, side, layer.closed, 28 / scale);
                      if (!has && !stub) return null;
                      const hx = has ? (realX ?? 0) : stub!.x;
                      const hy = has ? (realY ?? 0) : stub!.y;
                      return (
                        <Fragment key={`${side}-${index}`}>
                          <Line
                            listening={false}
                            points={[point.x, point.y, point.x + hx, point.y + hy]}
                            stroke="#94a3b8"
                            strokeWidth={1 / scale}
                            dash={has ? undefined : [4 / scale, 3 / scale]}
                          />
                          <KCircle
                            name="path-handle"
                            x={point.x + hx}
                            y={point.y + hy}
                            radius={radius * 0.7}
                            fill={has ? '#f8fafc' : '#38bdf8'}
                            stroke="#0284c7"
                            strokeWidth={1 / scale}
                            draggable
                            onMouseDown={(event) => event.cancelBubble = true}
                            onDragEnd={(event) => {
                              const moved = Math.hypot(event.target.x() - (point.x + hx), event.target.y() - (point.y + hy));
                              if (!has && moved < 4 / scale) return;
                              onPathPoints(layer, setHandle(page, index, side, event.target.x(), event.target.y(), event.evt.altKey ? false : 'tangent'));
                            }}
                          />
                        </Fragment>
                      );
                    })}
                    <KCircle
                      name="path-node"
                      x={point.x}
                      y={point.y}
                      radius={radius}
                      fill={nodeIndex === index ? '#ffffff' : '#0284c7'}
                      stroke="#0f172a"
                      strokeWidth={1 / scale}
                      draggable
                      onMouseDown={(event) => { event.cancelBubble = true; onNodeIndex(index); }}
                      onDblClick={() => {
                        const bare = point.inX == null && point.outX == null && point.inY == null && point.outY == null;
                        onPathPoints(layer, bare ? smoothAnchor(page, index, layer.closed) : cornerAnchor(page, index));
                      }}
                      onDragEnd={(event) => onPathPoints(layer, moveAnchor(page, index, event.target.x(), event.target.y()))}
                    />
                  </Fragment>
                ))}
              </Fragment>
            );
          })}
          <Transformer ref={tr} rotateEnabled keepRatio={false} onTransformEnd={finishTransform} boundBoxFunc={(o, n) => (n.width < 4 || n.height < 4 ? o : n)} />
        </KLayer>
      </Stage>
      </div>
    </div>
  );
}

function LayersPanel({ doc, selected, onSelect, onUpdate, onMove, onRemove }: {
  doc: DesignDoc; selected: string[]; onSelect: (id: string, additive?: boolean) => void; onUpdate: (id: string, p: Partial<Layer>) => void; onMove: (id: string, d: 1 | -1) => void; onRemove: (id: string) => void;
}) {
  const top = [...doc.layers].reverse();
  return (
    <aside className="w-60 shrink-0 overflow-y-auto border-r border-slate-800 bg-slate-950">
      <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Layers</div>
      {top.length === 0 && <p className="px-3 text-xs text-slate-500">Add text, shapes or images from the toolbar.</p>}
      {top.map((l) => (
        <div key={l.id} onClick={(e) => onSelect(l.id, e.shiftKey)} className={`group flex items-center gap-1 px-2 py-1.5 text-sm ${selected.includes(l.id) ? 'bg-indigo-600/20' : 'hover:bg-slate-900'}`}>
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

function PropertiesPanel({ doc, layer, selectedCount, colors, fonts, onUpdate, onDoc, onEditNodes }: {
  doc: DesignDoc; layer: Layer | null; selectedCount: number; colors: { name: string; hex: string }[]; fonts: { role: string; family: string }[]; onUpdate: (id: string, p: Partial<Layer>) => void; onDoc: (d: DesignDoc) => void; onEditNodes: () => void;
}) {
  const up = (p: Partial<Layer>) => layer && onUpdate(layer.id, p);
  return (
    <aside className="w-72 shrink-0 space-y-4 overflow-y-auto border-l border-slate-800 bg-slate-950 p-4">
      {!layer ? (
        <>
          {selectedCount > 1 && <p className="text-xs text-slate-400">{selectedCount} layers selected. Align and distribute use that group. One object aligns to the page.</p>}
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
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Guides</div>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => onDoc({ ...doc, guides: [...(doc.guides ?? []), { id: newLayerId(), axis: 'x', position: Math.round(doc.width / 2) }] })}>Vertical</Button>
            <Button size="sm" variant="secondary" onClick={() => onDoc({ ...doc, guides: [...(doc.guides ?? []), { id: newLayerId(), axis: 'y', position: Math.round(doc.height / 2) }] })}>Horizontal</Button>
          </div>
          {(doc.guides ?? []).map((guide) => (
            <div key={guide.id} className="flex items-center gap-2">
              <span className="w-8 text-[11px] text-slate-500">{guide.axis === 'x' ? 'X' : 'Y'}</span>
              <input type="number" className="input py-1 text-xs" value={Math.round(guide.position)} onChange={(e) => onDoc({ ...doc, guides: (doc.guides ?? []).map((item) => item.id === guide.id ? { ...item, position: Number(e.target.value) } : item) })} />
              <button type="button" className="text-slate-500 hover:text-rose-400" title="Remove guide" onClick={() => onDoc({ ...doc, guides: (doc.guides ?? []).filter((item) => item.id !== guide.id) })}><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          ))}
          <p className="text-xs text-slate-500">Objects snap to guides, the page, and each other. Guides are not exported. Shift-click adds to the selection. Ctrl+scroll zooms, and scrolling moves around the page.</p>
        </>
      ) : (
        <>
          <Field label="Layer name"><input className="input py-1 text-xs" value={layer.name} onChange={(e) => up({ name: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Num label="X" value={layer.x} onChange={(v) => up({ x: v })} />
            <Num label="Y" value={layer.y} onChange={(v) => up({ y: v })} />
            <Num label="Width" value={layer.width} onChange={(v) => v > 0 && (layer.type === 'path' ? up(scalePathBox(layer, v, layer.height)) : up({ width: v }))} />
            <Num label="Height" value={layer.height} onChange={(v) => v > 0 && (layer.type === 'path' ? up(scalePathBox(layer, layer.width, v)) : up({ height: v }))} />
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
              <Num label="Tracking" value={layer.letterSpacing ?? 0} onChange={(v) => up({ letterSpacing: v })} />
              <div className="flex gap-1">
                <Button size="sm" variant={layer.fontWeight === 'bold' ? 'primary' : 'secondary'} onClick={() => up({ fontWeight: layer.fontWeight === 'bold' ? 'normal' : 'bold' })}><b>B</b></Button>
                <Button size="sm" variant={layer.italic ? 'primary' : 'secondary'} onClick={() => up({ italic: !layer.italic })}><i>I</i></Button>
                <Button size="sm" variant={layer.underline ? 'primary' : 'secondary'} onClick={() => up({ underline: !layer.underline })}><span className="underline">U</span></Button>
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
          {layer.type === 'path' && (
            <>
              <Field label="Stroke"><ColorInput value={layer.stroke} onChange={(v) => up({ stroke: v })} swatches={colors} /></Field>
              <Num label="Stroke width" value={layer.strokeWidth} onChange={(v) => up({ strokeWidth: Math.max(0, v) })} />
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={layer.fill !== 'none'} onChange={(e) => up({ fill: e.target.checked ? (colors[0]?.hex ?? '#111827') : 'none' })} /> Fill</label>
              {layer.fill !== 'none' && <Field label="Fill"><ColorInput value={layer.fill} onChange={(v) => up({ fill: v })} swatches={colors} /></Field>}
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={layer.closed} onChange={(e) => up({ closed: e.target.checked })} /> Closed path</label>
              <Button size="sm" variant="secondary" onClick={onEditNodes}><Spline className="h-4 w-4" /> Edit nodes</Button>
              <p className="text-xs text-slate-500">{layer.points.length} points. Drag a tangent handle to bend that side. The other handle stays on the same line and keeps its length. Alt breaks the tangent. A dashed handle is still a straight corner.</p>
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
    <Modal open onClose={onClose} title="Choose an image" width="max-w-3xl">
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

function BrandFileModal({ kind, title, empty, onClose, onPick }: { kind: 'BACKGROUND' | 'GRAPHIC' | 'LOGO'; title: string; empty: string; onClose: () => void; onPick: (key: string, name: string, w: number, h: number) => void }) {
  const { data } = useQuery({ queryKey: ['brand-files', kind], queryFn: () => api.get<{ id: string; name: string; storageKey: string }[]>(`/brand/files?kind=${kind}`) });
  const pick = async (file: { storageKey: string; name: string }) => {
    const img = new window.Image();
    img.src = fileUrl(file.storageKey)!;
    await img.decode().catch(() => undefined);
    onPick(file.storageKey, file.name, img.naturalWidth || 400, img.naturalHeight || 200);
  };
  return (
    <Modal open onClose={onClose} title={title}>
      {!data?.length ? <p className="text-sm text-slate-500">{empty}</p> : (
        <div className="grid max-h-[60vh] grid-cols-3 gap-3 overflow-y-auto">
          {data.map((file) => (
            <button key={file.id} onClick={() => void pick(file)} className="rounded border border-slate-800 bg-slate-900 p-2 hover:border-indigo-500" title={file.name}>
              <img src={fileUrl(file.storageKey)} className="h-20 w-full object-contain" />
              <span className="mt-1 block truncate text-xs text-slate-400">{file.name}</span>
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
