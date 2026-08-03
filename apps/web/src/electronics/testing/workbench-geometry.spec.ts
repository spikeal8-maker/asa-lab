import { describe, expect, it } from 'vitest';
import { clientToWorld, viewportViewBox, type Point, type Viewport } from '../workbench-geometry';

function worldToClient(
  point: Point,
  rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  viewport: Viewport,
  canvasWidth: number,
  canvasHeight: number,
): Point {
  const box = viewportViewBox(viewport, canvasWidth, canvasHeight);
  const scale = Math.max(rect.width / box.width, rect.height / box.height);
  const offsetX = (rect.width - box.width * scale) / 2;
  const offsetY = (rect.height - box.height * scale) / 2;
  return {
    x: rect.left + offsetX + (point.x - box.x) * scale,
    y: rect.top + offsetY + (point.y - box.y) * scale,
  };
}

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
