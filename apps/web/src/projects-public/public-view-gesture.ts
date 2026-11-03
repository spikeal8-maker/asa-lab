export interface ViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface GesturePoint {
  x: number;
  y: number;
}

/** Keep the point between the fingers anchored, including SVG letterboxing. */
export function panZoomPublicView(
  current: ViewBox,
  rect: { left: number; top: number; width: number; height: number },
  before: GesturePoint,
  after: GesturePoint,
  factor: number,
  fitWidth: number,
): ViewBox {
  const width = Math.max(fitWidth / 8, Math.min(fitWidth * 4, current.width * factor));
  const height = (width * current.height) / current.width;
  const scale = Math.min(rect.width / current.width, rect.height / current.height);
  const nextScale = Math.min(rect.width / width, rect.height / height);
  if (!(scale > 0 && nextScale > 0)) return current;
  const x = current.x + (before.x - rect.left - (rect.width - current.width * scale) / 2) / scale;
  const y = current.y + (before.y - rect.top - (rect.height - current.height * scale) / 2) / scale;
  return {
    x: x - (after.x - rect.left - (rect.width - width * nextScale) / 2) / nextScale,
    y: y - (after.y - rect.top - (rect.height - height * nextScale) / 2) / nextScale,
    width,
    height,
  };
}
