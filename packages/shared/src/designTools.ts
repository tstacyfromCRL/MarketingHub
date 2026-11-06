/**
 * Layout moves for the design editor: align, distribute, stack, duplicate, nudge, and snap.
 * These change positions only. Export still draws the same rectangles, ellipses, images, and text.
 */
import { newLayerId, type DesignDoc, type Guide, type Layer } from './design';

export type AlignEdge = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
export type StackMove = 'front' | 'back' | 'forward' | 'backward';

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const right = (box: Box) => box.x + box.width;
const bottom = (box: Box) => box.y + box.height;
const midX = (box: Box) => box.x + box.width / 2;
const midY = (box: Box) => box.y + box.height / 2;

function movable(doc: DesignDoc, ids: string[]): Layer[] {
  const wanted = new Set(ids);
  return doc.layers.filter((layer) => wanted.has(layer.id) && !layer.locked);
}

function replace(doc: DesignDoc, next: Map<string, Layer>): DesignDoc {
  return { ...doc, layers: doc.layers.map((layer) => next.get(layer.id) ?? layer) };
}

function bounds(layers: Box[]): Box {
  const x = Math.min(...layers.map((layer) => layer.x));
  const y = Math.min(...layers.map((layer) => layer.y));
  return {
    x,
    y,
    width: Math.max(...layers.map(right)) - x,
    height: Math.max(...layers.map(bottom)) - y,
  };
}

/** One object aligns to the page. Several objects align to the selection. Locked objects stay put. */
export function alignLayers(doc: DesignDoc, ids: string[], edge: AlignEdge): DesignDoc {
  const layers = movable(doc, ids);
  if (!layers.length) return doc;
  const target = layers.length === 1 ? { x: 0, y: 0, width: doc.width, height: doc.height } : bounds(layers);
  const next = new Map<string, Layer>();
  for (const layer of layers) {
    const patch: Partial<Layer> = {};
    if (edge === 'left') patch.x = target.x;
    if (edge === 'center') patch.x = midX(target) - layer.width / 2;
    if (edge === 'right') patch.x = right(target) - layer.width;
    if (edge === 'top') patch.y = target.y;
    if (edge === 'middle') patch.y = midY(target) - layer.height / 2;
    if (edge === 'bottom') patch.y = bottom(target) - layer.height;
    next.set(layer.id, { ...layer, ...patch } as Layer);
  }
  return replace(doc, next);
}

/** Equal gaps between objects, left to right or top to bottom. Needs three that can move. */
export function distributeLayers(doc: DesignDoc, ids: string[], axis: 'horizontal' | 'vertical'): DesignDoc {
  const layers = movable(doc, ids);
  if (layers.length < 3) return doc;
  const ordered = [...layers].sort((a, b) => (axis === 'horizontal' ? a.x - b.x || a.y - b.y : a.y - b.y || a.x - b.x));
  const spanStart = axis === 'horizontal' ? ordered[0].x : ordered[0].y;
  const spanEnd = axis === 'horizontal' ? right(ordered[ordered.length - 1]) : bottom(ordered[ordered.length - 1]);
  const occupied = ordered.reduce((sum, layer) => sum + (axis === 'horizontal' ? layer.width : layer.height), 0);
  const gap = (spanEnd - spanStart - occupied) / (ordered.length - 1);
  let cursor = spanStart;
  const next = new Map<string, Layer>();
  for (const layer of ordered) {
    next.set(layer.id, axis === 'horizontal' ? { ...layer, x: cursor } : { ...layer, y: cursor });
    cursor += (axis === 'horizontal' ? layer.width : layer.height) + gap;
  }
  return replace(doc, next);
}

/** Layers are stored back-to-front, so the end of the list is the front. */
export function stackLayer(doc: DesignDoc, id: string, move: StackMove): DesignDoc {
  const index = doc.layers.findIndex((layer) => layer.id === id);
  if (index < 0) return doc;
  const layers = doc.layers.slice();
  const [layer] = layers.splice(index, 1);
  if (move === 'front') layers.push(layer);
  else if (move === 'back') layers.unshift(layer);
  else if (move === 'forward') layers.splice(Math.min(layers.length, index + 1), 0, layer);
  else layers.splice(Math.max(0, index - 1), 0, layer);
  return { ...doc, layers };
}

export function duplicateLayers(doc: DesignDoc, ids: string[], offset = 16): { doc: DesignDoc; ids: string[] } {
  const copies: Layer[] = [];
  const copyIds: string[] = [];
  for (const layer of doc.layers) {
    if (!ids.includes(layer.id) || layer.locked) continue;
    const id = newLayerId();
    copyIds.push(id);
    copies.push({ ...layer, id, name: `${layer.name} copy`, x: layer.x + offset, y: layer.y + offset });
  }
  if (!copies.length) return { doc, ids: [] };
  return { doc: { ...doc, layers: [...doc.layers, ...copies] }, ids: copyIds };
}

/** Pasted layers keep their look and land one step down and to the right, with new ids. */
export function pasteLayers(doc: DesignDoc, layers: Layer[], offset = 16): { doc: DesignDoc; ids: string[] } {
  const ids: string[] = [];
  const copies: Layer[] = [];
  for (const layer of layers) {
    const id = newLayerId();
    ids.push(id);
    copies.push({ ...layer, id, x: layer.x + offset, y: layer.y + offset });
  }
  if (!copies.length) return { doc, ids: [] };
  return { doc: { ...doc, layers: [...doc.layers, ...copies] }, ids };
}

export function nudgeLayers(doc: DesignDoc, ids: string[], dx: number, dy: number): DesignDoc {
  const next = new Map<string, Layer>();
  for (const layer of movable(doc, ids)) next.set(layer.id, { ...layer, x: layer.x + dx, y: layer.y + dy });
  return replace(doc, next);
}

/**
 * Pulls an object's edges or center onto the page, the guides, or a neighbor
 * when it is already within `threshold` pixels. Each axis snaps on its own.
 */
export function snapPosition(moving: Box, page: Box, guides: Guide[], others: Box[], threshold: number): { x: number; y: number } {
  const xTargets = [page.x, midX(page), right(page)];
  const yTargets = [page.y, midY(page), bottom(page)];
  for (const guide of guides) {
    if (guide.axis === 'x') xTargets.push(guide.position);
    else yTargets.push(guide.position);
  }
  for (const other of others) {
    xTargets.push(other.x, midX(other), right(other));
    yTargets.push(other.y, midY(other), bottom(other));
  }
  return {
    x: snapAxis(moving.x, [0, moving.width / 2, moving.width], xTargets, threshold),
    y: snapAxis(moving.y, [0, moving.height / 2, moving.height], yTargets, threshold),
  };
}

function snapAxis(origin: number, anchors: number[], targets: number[], threshold: number): number {
  let best = origin;
  let bestDistance = threshold + 1;
  for (const anchor of anchors) {
    for (const target of targets) {
      const distance = Math.abs(origin + anchor - target);
      if (distance <= threshold && distance < bestDistance) {
        best = target - anchor;
        bestDistance = distance;
      }
    }
  }
  return best;
}
