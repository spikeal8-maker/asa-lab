import { describe, expect, it } from 'vitest';
import {
  clientToWorld,
  completeOrthogonalRoute,
  gestureViewport,
  fitViewportToScreen,
  diagnosticBadgeGeometry,
  freeWirePoint,
  lockOrthogonalPoint,
  moveWireSegmentVertices,
  potentiometerWiperPosition,
  resolveWireAssist,
  resolveWireVertexAssist,
  stageReadoutGeometry,
  TERMINAL_HIT_RADIUS,
  TERMINAL_MARKER_SIZE,
  TERMINAL_TOUCH_HIT_RADIUS,
  WIRE_ENDPOINT_HIT_RADIUS,
  WIRE_ENDPOINT_TOUCH_HIT_RADIUS,
  WIRE_ENDPOINT_VISIBLE_RADIUS,
  wireSegmentParallelDelta,
  worldToClient,
  type Point,
} from '../workbench-geometry';

describe('shared screen gesture transform', () => {
  it.each([
    { width: 390, height: 600 },
    { width: 844, height: 240 },
    { width: 768, height: 920 },
    { width: 1920, height: 980 },
    { width: 2560, height: 1200 },
    { width: 3840, height: 2000 },
  ])('keeps pan and pinch under the fingers at $width × $height', (size) => {
    const rect = { ...size, left: 12, top: 106 };
    const start = { x: -180, y: 230, zoom: 1.7 };
    const anchor = { x: 190, y: 230 };
    const pointer = { x: 290, y: 260 };
    const held = clientToWorld(anchor.x, anchor.y, rect, start, 1600, 980);
    for (const zoom of [start.zoom, 0.2, 0.8, 3.4, 8]) {
      const next = gestureViewport(start, anchor, pointer, zoom, rect, 1600, 980);
      const after = worldToClient(held, rect, next, 1600, 980);
      expect(after.x).toBeCloseTo(pointer.x, 8);
      expect(after.y).toBeCloseTo(pointer.y, 8);
    }
  });
  it.each([
    { width: 390, height: 600 },
    { width: 844, height: 250 },
    { width: 3840, height: 2000 },
  ])('fits a large board into the actual visible screen $width × $height', (size) => {
    const rect = { ...size, left: 0, top: 0 };
    const bounds = { minX: -300, minY: 100, maxX: 1700, maxY: 950 };
    const viewport = fitViewportToScreen(bounds, rect, 1600, 980, 0.2, 8);
    const a = worldToClient({ x: bounds.minX, y: bounds.minY }, rect, viewport, 1600, 980);
    const b = worldToClient({ x: bounds.maxX, y: bounds.maxY }, rect, viewport, 1600, 980);
    expect(a.x).toBeGreaterThanOrEqual(27.99);
    expect(a.y).toBeGreaterThanOrEqual(27.99);
    expect(b.x).toBeLessThanOrEqual(size.width - 27.99);
    expect(b.y).toBeLessThanOrEqual(size.height - 27.99);
  });

  it('fits compact content outside the left stage controls with asymmetric screen insets', () => {
    const rect = { width: 320, height: 472, left: 0, top: 0 };
    const bounds = { minX: 0, minY: 0, maxX: 500, maxY: 300 };
    const viewport = fitViewportToScreen(bounds, rect, 1600, 980, 0.2, 8, {
      left: 64,
      right: 28,
      top: 28,
      bottom: 28,
    });
    const a = worldToClient({ x: bounds.minX, y: bounds.minY }, rect, viewport, 1600, 980);
    const b = worldToClient({ x: bounds.maxX, y: bounds.maxY }, rect, viewport, 1600, 980);
    expect(a.x).toBeGreaterThanOrEqual(63.99);
    expect(b.x).toBeLessThanOrEqual(rect.width - 27.99);
    expect(a.y).toBeGreaterThanOrEqual(27.99);
    expect(b.y).toBeLessThanOrEqual(rect.height - 27.99);
  });
});

describe('workbench pointer coordinates', () => {
  it.each([
    {
      name: 'wide editor with horizontal cropping',
      rect: { left: 0, top: 84, width: 1077, height: 950 },
      viewport: { x: -98.5, y: -180.1, zoom: 1.65 },
    },
    {
      name: 'short editor with vertical cropping',
      rect: { left: 36, top: 112, width: 1200, height: 500 },
      viewport: { x: 120, y: 80, zoom: 1.4 },
    },
  ])('inverts xMidYMid slice for $name', ({ rect, viewport }) => {
    const canvasWidth = 1600;
    const canvasHeight = 980;
    const points: Point[] = [
      { x: viewport.x + 120, y: viewport.y + 90 },
      { x: viewport.x + 480, y: viewport.y + 330 },
      { x: viewport.x + 760, y: viewport.y + 510 },
    ];

    for (const point of points) {
      const client = worldToClient(point, rect, viewport, canvasWidth, canvasHeight);
      const roundTrip = clientToWorld(
        client.x,
        client.y,
        rect as DOMRect,
        viewport,
        canvasWidth,
        canvasHeight,
      );
      expect(roundTrip.x).toBeCloseTo(point.x, 8);
      expect(roundTrip.y).toBeCloseTo(point.y, 8);
    }
  });
});

describe('potentiometer pointer coordinates', () => {
  it.each([0, 45, 90, 180, 270])(
    'keeps the same local wiper position at %s degrees',
    (rotation) => {
      const center = { x: 300, y: 200 };
      const localAngle = 54;
      const radians = ((localAngle - 90 + rotation) * Math.PI) / 180;
      const point = {
        x: center.x + Math.cos(radians) * 80,
        y: center.y + Math.sin(radians) * 80,
      };
      expect(potentiometerWiperPosition(center, point, rotation)).toBeCloseTo(0.7, 8);
    },
  );
});

describe('diagnostic badge zoom geometry', () => {
  it.each([
    [0.15, 7],
    [0.5, 9],
    [1, 18],
    [2, 18],
  ])('keeps a readable but non-covering diameter at zoom %s', (zoom, expectedDiameter) => {
    expect(diagnosticBadgeGeometry(zoom).screenDiameter).toBeCloseTo(expectedDiameter, 8);
  });
});

describe('calculated Stage readout zoom geometry', () => {
  it.each([
    [0.15, 7],
    [0.5, 7],
    [1, 12],
    [2, 12],
  ])('keeps a minimal readable font at zoom %s', (zoom, expectedFontSize) => {
    expect(stageReadoutGeometry(zoom).screenFontSize).toBeCloseTo(expectedFontSize, 8);
  });
});

describe('what the canvas is allowed to move', () => {
  // A ten-unit grid used to capture every hand-placed point, so a part let go at
  // 143 landed at 140 and the canvas felt as though it were pulling away from
  // the cursor. Nothing captures a free point now; alignment happens only where
  // it was asked for.
  it.each([
    { at: { x: 143, y: 207 } },
    { at: { x: 6, y: 4 } },
    { at: { x: -21, y: 99 } },
    { at: { x: 1004.4, y: 55.6 } },
  ])('leaves a free wire point at $at', ({ at }) => {
    expect(freeWirePoint(at)).toEqual(at);
  });

  it('still aligns when the 90° mode asks for it', () => {
    const anchor: Point = { x: 100, y: 100 };
    const locked = lockOrthogonalPoint(anchor, { x: 187, y: 104 });
    expect(locked.y).toBe(anchor.y);
    expect(locked.x % 10).toBe(0);
  });

  it('enters soft alignment only after the minimum distance and exits through hysteresis', () => {
    const anchor = { x: 100, y: 100 };
    expect(resolveWireAssist(anchor, { x: 123, y: 101 }, null).axis).toBeNull();

    const entered = resolveWireAssist(anchor, { x: 220, y: 105 }, null);
    expect(entered).toEqual({ axis: 'horizontal', point: { x: 220, y: 100 } });

    const held = resolveWireAssist(anchor, { x: 220, y: 109 }, entered.axis);
    expect(held).toEqual({ axis: 'horizontal', point: { x: 220, y: 100 } });

    const exited = resolveWireAssist(anchor, { x: 220, y: 111 }, held.axis);
    expect(exited).toEqual({ axis: null, point: { x: 220, y: 111 } });

    expect(resolveWireAssist(anchor, { x: 220, y: 111 }, exited.axis).axis).toBeNull();
  });

  it('keeps visible terminal and endpoint markers smaller than their collision targets', () => {
    expect(TERMINAL_MARKER_SIZE).toBe(8);
    expect(TERMINAL_HIT_RADIUS).toBe(9);
    expect(TERMINAL_TOUCH_HIT_RADIUS).toBe(14);
    expect(WIRE_ENDPOINT_VISIBLE_RADIUS).toBe(4);
    expect(WIRE_ENDPOINT_HIT_RADIUS).toBeGreaterThan(WIRE_ENDPOINT_VISIBLE_RADIUS);
    expect(WIRE_ENDPOINT_TOUCH_HIT_RADIUS).toBeGreaterThan(WIRE_ENDPOINT_HIT_RADIUS);
  });

  it('soft-locks a dragged bend to one canonical elbow with hysteresis and Alt disable', () => {
    const previous = { x: 100, y: 100 };
    const next = { x: 220, y: 220 };

    const entered = resolveWireVertexAssist(previous, next, { x: 106, y: 216 }, null);
    expect(entered).toEqual({
      target: 'previous-x-next-y',
      point: { x: 100, y: 220 },
    });

    const held = resolveWireVertexAssist(previous, next, { x: 108, y: 228 }, entered.target);
    expect(held).toEqual({
      target: 'previous-x-next-y',
      point: { x: 100, y: 220 },
    });

    const exited = resolveWireVertexAssist(previous, next, { x: 113, y: 220 }, held.target);
    expect(exited).toEqual({ target: null, point: { x: 113, y: 220 } });

    const other = resolveWireVertexAssist(previous, next, { x: 216, y: 104 }, exited.target);
    expect(other).toEqual({
      target: 'next-x-previous-y',
      point: { x: 220, y: 100 },
    });

    expect(resolveWireVertexAssist(previous, next, { x: 102, y: 218 }, null, true)).toEqual({
      target: null,
      point: { x: 102, y: 218 },
    });
  });

  it('keeps a free diagonal exact, supports vertical assist, and Alt-style disable wins', () => {
    expect(resolveWireAssist({ x: 100, y: 100 }, { x: 220, y: 140 }, null)).toEqual({
      axis: null,
      point: { x: 220, y: 140 },
    });
    expect(resolveWireAssist({ x: 100, y: 100 }, { x: 104, y: 220 }, null)).toEqual({
      axis: 'vertical',
      point: { x: 100, y: 220 },
    });
    expect(resolveWireAssist({ x: 100, y: 100 }, { x: 220, y: 104 }, null, true)).toEqual({
      axis: null,
      point: { x: 220, y: 104 },
    });
  });

  it('finishes every forced-orthogonal segment on the exact off-grid terminal', () => {
    const start = { x: 0, y: 0 };
    const target = { x: 103, y: 57 };
    const vertices = completeOrthogonalRoute(start, target, []);
    expect(vertices).toEqual([{ x: 103, y: 0 }]);

    const route = [start, ...vertices, target];
    for (let index = 1; index < route.length; index += 1) {
      const previous = route[index - 1] as Point;
      const current = route[index] as Point;
      expect(current.x === previous.x || current.y === previous.y).toBe(true);
    }
    expect(route.at(-1)).toEqual(target);
  });

  it('orthogonalizes multi-bend fractional and negative routes without moving the terminal', () => {
    const start = { x: -12.5, y: 7.25 };
    const target = { x: 103.75, y: -57.5 };
    const vertices = completeOrthogonalRoute(start, target, [
      { x: 23.2, y: 19.9 },
      { x: 23.2, y: -10.4 },
    ]);
    const route = [start, ...vertices, target];
    for (let index = 1; index < route.length; index += 1) {
      const previous = route[index - 1] as Point;
      const current = route[index] as Point;
      expect(current.x === previous.x || current.y === previous.y).toBe(true);
    }
    expect(route.at(-1)).toEqual(target);
  });

  it('moves a whole wire segment parallel and creates bends beside fixed terminals', () => {
    expect(wireSegmentParallelDelta({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 20, y: 30 })).toEqual({
      x: 0,
      y: 30,
    });
    expect(wireSegmentParallelDelta({ x: 20, y: 0 }, { x: 20, y: 100 }, { x: 30, y: 20 })).toEqual({
      x: 30,
      y: 0,
    });
    expect(
      moveWireSegmentVertices({ x: 0, y: 0 }, { x: 100, y: 0 }, [], 0, { x: 20, y: 30 }),
    ).toEqual([
      { x: 0, y: 30 },
      { x: 100, y: 30 },
    ]);
    expect(
      moveWireSegmentVertices(
        { x: 0, y: 0 },
        { x: 100, y: 100 },
        [
          { x: 50, y: 0 },
          { x: 50, y: 100 },
        ],
        1,
        { x: 30, y: 20 },
      ),
    ).toEqual([
      { x: 80, y: 0 },
      { x: 80, y: 100 },
    ]);
  });
});
