import { describe, expect, it } from 'vitest';
import type { DesignDoc, RectLayer } from './design';
import { alignLayers, distributeLayers, duplicateLayers, nudgeLayers, pasteLayers, snapPosition, stackLayer } from './designTools';

function rect(id: string, x: number, y: number, width = 10, height = 10, locked = false): RectLayer {
  return {
    id, name: id, type: 'rect', x, y, width, height, rotation: 0, opacity: 1, visible: true, locked,
    fill: '#000', cornerRadius: 0, strokeWidth: 0,
  };
}

function page(layers: RectLayer[]): DesignDoc {
  return { version: 1, width: 100, height: 80, background: '#fff', layers };
}

describe('design tools', () => {
  it('aligns one object to the page and several objects to the selection', () => {
    const one = alignLayers(page([rect('a', 5, 6, 20, 10)]), ['a'], 'center');
    expect(one.layers[0].x).toBe(40);
    const many = alignLayers(page([rect('a', 0, 0, 10, 10), rect('b', 30, 4, 10, 10)]), ['a', 'b'], 'top');
    expect(many.layers.map((layer) => layer.y)).toEqual([0, 0]);
    const locked = alignLayers(page([rect('a', 5, 6, 20, 10, true)]), ['a'], 'left');
    expect(locked.layers[0].x).toBe(5);
  });

  it('puts equal gaps between three objects and leaves two alone', () => {
    const doc = page([rect('a', 0, 0), rect('b', 40, 5), rect('c', 70, 2)]);
    const spread = distributeLayers(doc, ['a', 'b', 'c'], 'horizontal');
    const xs = spread.layers.map((layer) => layer.x);
    expect(xs[0]).toBe(0);
    expect(xs[2]).toBe(70);
    expect(xs[1] - 10).toBeCloseTo(xs[2] - (xs[1] + 10));
    expect(distributeLayers(doc, ['a', 'b'], 'horizontal')).toEqual(doc);
  });

  it('moves a layer to the front or back without dropping the others', () => {
    const doc = page([rect('a', 0, 0), rect('b', 1, 1), rect('c', 2, 2)]);
    expect(stackLayer(doc, 'a', 'front').layers.map((layer) => layer.id)).toEqual(['b', 'c', 'a']);
    expect(stackLayer(doc, 'c', 'back').layers.map((layer) => layer.id)).toEqual(['c', 'a', 'b']);
    expect(stackLayer(doc, 'b', 'forward').layers.map((layer) => layer.id)).toEqual(['a', 'c', 'b']);
    expect(stackLayer(doc, 'b', 'backward').layers.map((layer) => layer.id)).toEqual(['b', 'a', 'c']);
  });

  it('duplicates with a new id and nudges only the objects that can move', () => {
    const doc = page([rect('a', 4, 6), rect('b', 8, 9, 10, 10, true)]);
    const copied = duplicateLayers(doc, ['a', 'b'], 16);
    expect(copied.ids).toHaveLength(1);
    expect(copied.doc.layers).toHaveLength(3);
    expect(copied.doc.layers[2].x).toBe(20);
    expect(copied.doc.layers[2].id).not.toBe('a');
    const nudged = nudgeLayers(doc, ['a', 'b'], 3, -2);
    expect(nudged.layers[0]).toMatchObject({ x: 7, y: 4 });
    expect(nudged.layers[1]).toMatchObject({ x: 8, y: 9 });
    const pasted = pasteLayers(page([rect('a', 0, 0)]), [rect('clip', 4, 6)], 16);
    expect(pasted.doc.layers[1]).toMatchObject({ x: 20, y: 22, name: 'clip' });
    expect(pasted.ids[0]).not.toBe('clip');
  });

  it('snaps an edge to a guide or the page center when it is close', () => {
    const pageBox = { x: 0, y: 0, width: 100, height: 80 };
    const snapped = snapPosition({ x: 48, y: 10, width: 10, height: 10 }, pageBox, [{ id: 'g', axis: 'y', position: 12 }], [], 4);
    expect(snapped).toEqual({ x: 50, y: 12 });
    const far = snapPosition({ x: 10, y: 10, width: 10, height: 10 }, pageBox, [], [], 4);
    expect(far).toEqual({ x: 10, y: 10 });
  });
});
