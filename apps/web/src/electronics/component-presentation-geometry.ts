import type { SchematicComponent } from '../api';
import type { ComponentVisibleBounds } from './component-hit-testing';

export function paintedComponentBounds(
  component: SchematicComponent,
  baseSize: { readonly width: number; readonly height: number },
  renderedBounds: { readonly width: number; readonly height: number },
  visibleBounds: ComponentVisibleBounds | null,
): ComponentVisibleBounds {
  const localBounds = visibleBounds ?? {
    minX: 0,
    minY: 0,
    maxX: baseSize.width,
    maxY: baseSize.height,
  };
  const radians = ((((component.rotation ?? 0) % 360) + 360) % 360) * (Math.PI / 180);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const mirrorX = component.stateProperties?.['mirrorX'] === true;
  const mirrorY = component.stateProperties?.['mirrorY'] === true;
  const points = [
    { x: localBounds.minX, y: localBounds.minY },
    { x: localBounds.maxX, y: localBounds.minY },
    { x: localBounds.maxX, y: localBounds.maxY },
    { x: localBounds.minX, y: localBounds.maxY },
  ].map((point) => {
    const localX = (mirrorX ? baseSize.width - point.x : point.x) - baseSize.width / 2;
    const localY = (mirrorY ? baseSize.height - point.y : point.y) - baseSize.height / 2;
    return {
      x: component.position.x + renderedBounds.width / 2 + localX * cos - localY * sin,
      y: component.position.y + renderedBounds.height / 2 + localX * sin + localY * cos,
    };
  });
  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
}

export function paintedComponentPoint(
  component: SchematicComponent,
  baseSize: { readonly width: number; readonly height: number },
  renderedBounds: { readonly width: number; readonly height: number },
  localPoint: { readonly x: number; readonly y: number },
): { readonly x: number; readonly y: number } {
  const radians = ((((component.rotation ?? 0) % 360) + 360) % 360) * (Math.PI / 180);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const mirrorX = component.stateProperties?.['mirrorX'] === true;
  const mirrorY = component.stateProperties?.['mirrorY'] === true;
  const localX = (mirrorX ? baseSize.width - localPoint.x : localPoint.x) - baseSize.width / 2;
  const localY = (mirrorY ? baseSize.height - localPoint.y : localPoint.y) - baseSize.height / 2;
  return {
    x: component.position.x + renderedBounds.width / 2 + localX * cos - localY * sin,
    y: component.position.y + renderedBounds.height / 2 + localX * sin + localY * cos,
  };
}

export function topRightBadgeAnchor(
  bounds: ComponentVisibleBounds,
  radius: number,
): {
  readonly x: number;
  readonly y: number;
} {
  const inset = radius * 0.55;
  return {
    x: Math.max(bounds.minX + inset, bounds.maxX - inset),
    y: Math.min(bounds.maxY - inset, bounds.minY + inset),
  };
}
