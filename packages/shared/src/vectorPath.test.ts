import { describe, expect, it } from 'vitest';
import {
  bakeRotation,
  cornerAnchor,
  deleteAnchor,
  framePath,
  insertAnchor,
  moveAnchor,
  nearestAnchor,
  nearestSegment,
  pathPdfData,
  pathSvgData,
  scalePathBox,
  setHandle,
  smoothAnchor,
  tangentStub,
} from './vectorPath';
import type { PathPoint } from './design';

const line: PathPoint[] = [{ x: 10, y: 20 }, { x: 40, y: 20 }];

describe('vector paths', () => {
  it('frames a curve into a local box and writes a straight or curved command', () => {
    const framed = framePath([{ x: 10, y: 5, outX: 10, outY: -5 }, { x: 30, y: 25, inX: -4, inY: 0 }]);
    expect(framed.x).toBe(10);
    expect(framed.y).toBe(0);
    expect(framed.points[0]).toMatchObject({ x: 0, y: 5, outX: 10, outY: -5 });
    expect(pathSvgData(framed.points, false)).toBe('M 0 5 C 10 0 16 25 20 25');
    expect(pathSvgData(framePath(line).points, false)).toBe('M 0 0 L 30 0');
    expect(pathSvgData([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], true)).toMatch(/ Z$/);
  });

  it('flips the curve for a PDF page', () => {
    const data = pathPdfData({ x: 0, y: 0, closed: false, points: [{ x: 0, y: 10 }, { x: 4, y: 10 }] }, 100);
    expect(data).toBe('M 0 90 L 4 90');
  });

  it('moves an anchor without dropping its handles, and mirrors a dragged handle', () => {
    const moved = moveAnchor([{ x: 0, y: 0, outX: 5, outY: 0 }, { x: 10, y: 0 }], 0, 2, 3);
    expect(moved[0]).toMatchObject({ x: 2, y: 3, outX: 5 });
    const curved = setHandle(line, 0, 'out', 18, 20, true);
    expect(curved[0]).toMatchObject({ outX: 8, outY: 0, inX: -8, inY: 0 });
    const independent = setHandle(curved, 0, 'in', 4, 20, false);
    expect(independent[0].outX).toBe(8);
    expect(independent[0].inX).toBe(-6);
  });

  it('keeps tangent handles on one line while each side keeps its own length', () => {
    const uneven = [{ x: 10, y: 20, inX: -4, inY: 0, outX: 12, outY: 0 }, { x: 40, y: 20 }];
    const turned = setHandle(uneven, 0, 'out', 10, 32, 'tangent');
    expect(turned[0]).toMatchObject({ outX: 0, outY: 12, inX: 0, inY: -4 });
    const pulled = setHandle(line, 0, 'out', 18, 20, 'tangent');
    expect(pulled[0]).toMatchObject({ outX: 8, outY: 0, inX: -8, inY: 0 });
    expect(tangentStub(line, 0, 'out', false, 6)).toEqual({ x: 6, y: 0 });
    expect(tangentStub(line, 0, 'in', false, 6)).toBeNull();
    expect(tangentStub(pulled, 0, 'out', false, 6)).toBeNull();
  });

  it('makes a corner, a smooth node, and refuses to delete the last segment', () => {
    const smooth = smoothAnchor([{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 60, y: 0 }], 1, false);
    expect(smooth[1].inX).toBeLessThan(0);
    expect(smooth[1].outX).toBeGreaterThan(0);
    expect(cornerAnchor(smooth, 1)[1].outX).toBeUndefined();
    expect(deleteAnchor(line, 0)).toBeNull();
    expect(deleteAnchor([...line, { x: 50, y: 20 }], 1)).toHaveLength(2);
  });

  it('inserts a midpoint on a line and finds the anchor or segment under the pointer', () => {
    const inserted = insertAnchor(line, 0, false);
    expect(inserted.map((point) => point.x)).toEqual([10, 25, 40]);
    const curve = setHandle(line, 0, 'out', 20, 0, false);
    expect(insertAnchor(curve, 0, false)).toHaveLength(3);
    expect(nearestAnchor(line, 11, 21, 8)).toBe(0);
    expect(nearestAnchor(line, 80, 80, 8)).toBeNull();
    expect(nearestSegment(line, false, 25, 22, 8)).toBe(0);
  });

  it('scales the curve when the box width or height changes', () => {
    const framed = framePath(line);
    const scaled = scalePathBox(framed, framed.width * 2, framed.height);
    expect(scaled.width).toBe(framed.width * 2);
    expect(scaled.points[1].x).toBeCloseTo(framed.points[1].x * 2);
  });

  it('bakes a clockwise rotation into the anchors so the node editor matches the curve', () => {
    const baked = bakeRotation({ x: 0, y: 0, rotation: 90, points: [{ x: 10, y: 0 }] });
    expect(baked[0].x).toBeCloseTo(0);
    expect(baked[0].y).toBeCloseTo(10);
  });
});
