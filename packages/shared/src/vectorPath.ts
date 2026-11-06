/**
 * Vector paths for the design editor. Anchors are stored in the layer's own box, with
 * bezier handles relative to each anchor, so moving the layer does not rewrite the curve.
 * Exports draw this same curve; the node editor only changes these points.
 */
import type { PathLayer, PathPoint } from './design';

export interface PathFrame {
  x: number;
  y: number;
  width: number;
  height: number;
  points: PathPoint[];
}

const MIN_SIZE = 1;

function hasHandle(value: number | undefined): value is number {
  return value !== undefined && value !== 0;
}

/** Page position of every anchor and handle, so the box contains the whole curve. */
export function pathBounds(points: PathPoint[]): { x: number; y: number; width: number; height: number } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const point of points) {
    xs.push(point.x, point.x + (point.inX ?? 0), point.x + (point.outX ?? 0));
    ys.push(point.y, point.y + (point.inY ?? 0), point.y + (point.outY ?? 0));
  }
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(MIN_SIZE, Math.max(...xs) - x), height: Math.max(MIN_SIZE, Math.max(...ys) - y) };
}

/** Turns page coordinates into a layer box. Handles stay attached to their anchors. */
export function framePath(points: PathPoint[]): PathFrame {
  const bounds = pathBounds(points);
  return {
    ...bounds,
    points: points.map((point) => ({ ...point, x: point.x - bounds.x, y: point.y - bounds.y })),
  };
}

/**
 * The node editor works on the curve as it looks, so a rotated path is rewritten
 * with rotation removed and the anchors moved to where the rotation had put them.
 */
export function bakeRotation(layer: Pick<PathLayer, 'x' | 'y' | 'rotation' | 'points'>): PathPoint[] {
  const radians = (layer.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const turn = (x: number, y: number) => ({ x: x * cos - y * sin, y: x * sin + y * cos });
  return layer.points.map((point) => {
    const anchor = turn(point.x, point.y);
    const incoming = point.inX === undefined && point.inY === undefined ? null : turn(point.inX ?? 0, point.inY ?? 0);
    const outgoing = point.outX === undefined && point.outY === undefined ? null : turn(point.outX ?? 0, point.outY ?? 0);
    return {
      x: layer.x + anchor.x,
      y: layer.y + anchor.y,
      inX: incoming?.x,
      inY: incoming?.y,
      outX: outgoing?.x,
      outY: outgoing?.y,
    };
  });
}

export function pagePoints(layer: Pick<PathLayer, 'x' | 'y' | 'points'>): PathPoint[] {
  return layer.points.map((point) => ({ ...point, x: point.x + layer.x, y: point.y + layer.y }));
}

function commandFor(from: PathPoint, to: PathPoint): string {
  const curved = hasHandle(from.outX) || hasHandle(from.outY) || hasHandle(to.inX) || hasHandle(to.inY);
  if (!curved) return `L ${to.x} ${to.y}`;
  const c1x = from.x + (from.outX ?? 0);
  const c1y = from.y + (from.outY ?? 0);
  const c2x = to.x + (to.inX ?? 0);
  const c2y = to.y + (to.inY ?? 0);
  return `C ${c1x} ${c1y} ${c2x} ${c2y} ${to.x} ${to.y}`;
}

/** SVG path data in the layer's local box. The caller translates it onto the page. */
export function pathSvgData(points: PathPoint[], closed: boolean): string {
  if (!points.length) return '';
  let data = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) data += ` ${commandFor(points[i - 1], points[i])}`;
  if (closed && points.length > 2) data += ` ${commandFor(points[points.length - 1], points[0])} Z`;
  return data;
}

/** Same curve with Y flipped, for PDF where Y grows upward. */
export function pathPdfData(layer: Pick<PathLayer, 'x' | 'y' | 'points' | 'closed'>, pageHeight: number): string {
  const flipped = pagePoints(layer).map((point) => ({
    ...point,
    y: pageHeight - point.y,
    inY: point.inY === undefined ? undefined : -point.inY,
    outY: point.outY === undefined ? undefined : -point.outY,
  }));
  return pathSvgData(flipped, layer.closed);
}

/**
 * The properties panel's width and height scale the curve. The box is only the
 * curve's bounds, so changing it without the points would leave the shape behind.
 */
export function scalePathBox(layer: Pick<PathLayer, 'points' | 'width' | 'height'>, width: number, height: number): { width: number; height: number; points: PathPoint[] } {
  const sx = layer.width ? width / layer.width : 1;
  const sy = layer.height ? height / layer.height : 1;
  return {
    width,
    height,
    points: layer.points.map((point) => ({
      ...point,
      x: point.x * sx,
      y: point.y * sy,
      inX: point.inX === undefined ? undefined : point.inX * sx,
      inY: point.inY === undefined ? undefined : point.inY * sy,
      outX: point.outX === undefined ? undefined : point.outX * sx,
      outY: point.outY === undefined ? undefined : point.outY * sy,
    })),
  };
}

export function moveAnchor(points: PathPoint[], index: number, x: number, y: number): PathPoint[] {
  return points.map((point, i) => (i === index ? { ...point, x, y } : point));
}

function handleVector(point: PathPoint, side: 'in' | 'out'): { x: number; y: number } | null {
  const x = side === 'in' ? point.inX : point.outX;
  const y = side === 'in' ? point.inY : point.outY;
  if (x === undefined && y === undefined) return null;
  return { x: x ?? 0, y: y ?? 0 };
}

/**
 * The opposite handle stays on the same tangent. Its length is kept, so one side of the
 * curve can be long and the other short. A corner grows a matching handle on the first pull.
 */
function oppositeTangent(dx: number, dy: number, other: { x: number; y: number } | null): { x: number; y: number } {
  const dragged = Math.hypot(dx, dy);
  const kept = other ? Math.hypot(other.x, other.y) : 0;
  const length = kept > 0 ? kept : dragged;
  const span = dragged || 1;
  return { x: (-dx / span) * length || 0, y: (-dy / span) * length || 0 };
}

/**
 * Puts a handle at an absolute page position.
 * `true` mirrors it at the same length (the pen). `'tangent'` keeps the other handle on the
 * opposite ray and leaves its length alone. `false` moves only this side (Alt).
 */
export function setHandle(points: PathPoint[], index: number, side: 'in' | 'out', x: number, y: number, mirror: boolean | 'tangent'): PathPoint[] {
  const anchor = points[index];
  if (!anchor) return points;
  const dx = x - anchor.x || 0;
  const dy = y - anchor.y || 0;
  const other = mirror === 'tangent' ? oppositeTangent(dx, dy, handleVector(anchor, side === 'out' ? 'in' : 'out')) : { x: -dx || 0, y: -dy || 0 };
  return points.map((point, i) => {
    if (i !== index) return point;
    const next: PathPoint = { ...point };
    if (side === 'out') {
      next.outX = dx;
      next.outY = dy;
      if (mirror) {
        next.inX = other.x;
        next.inY = other.y;
      }
    } else {
      next.inX = dx;
      next.inY = dy;
      if (mirror) {
        next.outX = other.x;
        next.outY = other.y;
      }
    }
    return next;
  });
}

/** A dashed handle on a straight corner, aimed at the neighboring anchor, ready to be pulled. */
export function tangentStub(points: PathPoint[], index: number, side: 'in' | 'out', closed: boolean, length: number): { x: number; y: number } | null {
  const point = points[index];
  if (!point || length <= 0 || handleVector(point, side)) return null;
  const neighbor = side === 'out'
    ? points[index + 1] ?? (closed ? points[0] : undefined)
    : points[index - 1] ?? (closed ? points[points.length - 1] : undefined);
  if (!neighbor) return null;
  const dx = neighbor.x - point.x;
  const dy = neighbor.y - point.y;
  const span = Math.hypot(dx, dy);
  if (!span) return null;
  const reach = Math.min(length, span * 0.35) || 0;
  return { x: (dx / span) * reach || 0, y: (dy / span) * reach || 0 };
}

export function cornerAnchor(points: PathPoint[], index: number): PathPoint[] {
  return points.map((point, i) => {
    if (i !== index) return point;
    const corner = { ...point };
    delete corner.inX;
    delete corner.inY;
    delete corner.outX;
    delete corner.outY;
    return corner;
  });
}

/** A smooth node: handles sit on the line through the neighboring anchors. */
export function smoothAnchor(points: PathPoint[], index: number, closed: boolean): PathPoint[] {
  const point = points[index];
  if (!point) return points;
  const prev = points[index - 1] ?? (closed ? points[points.length - 1] : undefined);
  const next = points[index + 1] ?? (closed ? points[0] : undefined);
  if (!prev && !next) return points;
  const towardNext = next ? { x: next.x - point.x, y: next.y - point.y } : { x: point.x - (prev?.x ?? point.x), y: point.y - (prev?.y ?? point.y) };
  const towardPrev = prev ? { x: prev.x - point.x, y: prev.y - point.y } : { x: -towardNext.x, y: -towardNext.y };
  const span = Math.hypot(towardNext.x - towardPrev.x, towardNext.y - towardPrev.y) || 1;
  const ux = (towardNext.x - towardPrev.x) / span;
  const uy = (towardNext.y - towardPrev.y) / span;
  return points.map((item, i) => {
    if (i !== index) return item;
    return {
      ...item,
      outX: ux * (Math.hypot(towardNext.x, towardNext.y) / 3),
      outY: uy * (Math.hypot(towardNext.x, towardNext.y) / 3),
      inX: -ux * (Math.hypot(towardPrev.x, towardPrev.y) / 3),
      inY: -uy * (Math.hypot(towardPrev.x, towardPrev.y) / 3),
    };
  });
}

/** Refuses to leave a path with fewer than two anchors. */
export function deleteAnchor(points: PathPoint[], index: number): PathPoint[] | null {
  if (points.length <= 2) return null;
  return points.filter((_, i) => i !== index);
}

function lerp(a: { x: number; y: number }, b: { x: number; y: number }, t: number) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/**
 * Splits the segment that starts at `index`. A straight segment gains a corner.
 * A curve is split so both halves keep the original shape.
 */
export function insertAnchor(points: PathPoint[], index: number, closed: boolean, t = 0.5): PathPoint[] {
  const from = points[index];
  const to = points[index + 1] ?? (closed ? points[0] : undefined);
  if (!from || !to) return points;
  const curved = hasHandle(from.outX) || hasHandle(from.outY) || hasHandle(to.inX) || hasHandle(to.inY);
  if (!curved) {
    const mid = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
    const next = points.slice();
    next.splice(index + 1, 0, mid);
    return next;
  }
  const p0 = { x: from.x, y: from.y };
  const c1 = { x: from.x + (from.outX ?? 0), y: from.y + (from.outY ?? 0) };
  const c2 = { x: to.x + (to.inX ?? 0), y: to.y + (to.inY ?? 0) };
  const p3 = { x: to.x, y: to.y };
  const p01 = lerp(p0, c1, t);
  const p12 = lerp(c1, c2, t);
  const p23 = lerp(c2, p3, t);
  const p012 = lerp(p01, p12, t);
  const p123 = lerp(p12, p23, t);
  const mid = lerp(p012, p123, t);
  const next = points.slice();
  next[index] = { ...from, outX: p01.x - from.x, outY: p01.y - from.y };
  const at = index + 1 === points.length ? 0 : index + 1;
  next[at] = { ...to, inX: p23.x - to.x, inY: p23.y - to.y };
  next.splice(index + 1, 0, { x: mid.x, y: mid.y, inX: p012.x - mid.x, inY: p012.y - mid.y, outX: p123.x - mid.x, outY: p123.y - mid.y });
  return next;
}

export function nearestAnchor(points: PathPoint[], x: number, y: number, threshold: number): number | null {
  let best = threshold;
  let index: number | null = null;
  points.forEach((point, i) => {
    const distance = Math.hypot(point.x - x, point.y - y);
    if (distance <= best) {
      best = distance;
      index = i;
    }
  });
  return index;
}

function sampleSegment(from: PathPoint, to: PathPoint, steps = 12): { x: number; y: number }[] {
  const curved = hasHandle(from.outX) || hasHandle(from.outY) || hasHandle(to.inX) || hasHandle(to.inY);
  const samples: { x: number; y: number }[] = [];
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (!curved) {
      samples.push({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
      continue;
    }
    const p0 = { x: from.x, y: from.y };
    const c1 = { x: from.x + (from.outX ?? 0), y: from.y + (from.outY ?? 0) };
    const c2 = { x: to.x + (to.inX ?? 0), y: to.y + (to.inY ?? 0) };
    const p3 = { x: to.x, y: to.y };
    const a = lerp(p0, c1, t);
    const b = lerp(c1, c2, t);
    const c = lerp(c2, p3, t);
    const d = lerp(a, b, t);
    const e = lerp(b, c, t);
    samples.push(lerp(d, e, t));
  }
  return samples;
}

/** The segment starts at this anchor. A click on the line inserts a node there. */
export function nearestSegment(points: PathPoint[], closed: boolean, x: number, y: number, threshold: number): number | null {
  let best = threshold;
  let index: number | null = null;
  const count = closed ? points.length : points.length - 1;
  for (let i = 0; i < count; i++) {
    const from = points[i];
    const to = points[(i + 1) % points.length];
    for (const sample of sampleSegment(from, to)) {
      const distance = Math.hypot(sample.x - x, sample.y - y);
      if (distance <= best) {
        best = distance;
        index = i;
      }
    }
  }
  return index;
}
