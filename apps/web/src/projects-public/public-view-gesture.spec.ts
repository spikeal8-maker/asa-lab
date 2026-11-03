import { expect, it } from 'vitest';
import { panZoomPublicView } from './public-view-gesture';
const view = { x: 20, y: 30, width: 400, height: 200 };
const rect = { left: 10, top: 50, width: 400, height: 400 };
it('anchors pinch at the fingers including letterboxed content', () => {
  const center = { x: 210, y: 250 };
  const zoom = panZoomPublicView(view, rect, center, center, 0.5, 400);
  expect(zoom).toEqual({ x: 120, y: 80, width: 200, height: 100 });
  expect(panZoomPublicView(zoom, rect, center, center, 2, 400)).toEqual(view);
});
it('pans horizontally and vertically without changing the scale', () => {
  expect(panZoomPublicView(view, rect, { x: 110, y: 150 }, { x: 140, y: 190 }, 1, 400)).toEqual({
    x: -10,
    y: -10,
    width: 400,
    height: 200,
  });
});
it('bounds zoom and ignores a zero-sized viewport', () => {
  expect(
    panZoomPublicView(view, rect, { x: 100, y: 100 }, { x: 100, y: 100 }, 0.0001, 400).width,
  ).toBe(50);
  expect(
    panZoomPublicView(view, rect, { x: 100, y: 100 }, { x: 100, y: 100 }, 1000, 400).width,
  ).toBe(1600);
  expect(
    panZoomPublicView(view, { ...rect, width: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, 1, 400),
  ).toBe(view);
});
