import type { SchematicComponent } from '../api';
import { catalogEntry, renderedSize } from './component-catalog';
import type { ComponentVisibleBounds } from './component-hit-testing';

type Point = { readonly x: number; readonly y: number };
type Size = { readonly width: number; readonly height: number };

interface SupplySwitchClipInputs {
  readonly bodyPaintOrder: readonly SchematicComponent[];
  readonly liveSupplySwitches: ReadonlySet<string>;
  readonly pendingTerminal: unknown;
  readonly hitDomainPoints: readonly Point[];
  readonly viewBox: Point & Size;
  readonly stageBounds: Size | undefined;
  readonly projectPoint: (
    component: SchematicComponent,
    base: Size,
    bounds: Size,
    point: Point,
  ) => Point;
  readonly projectBounds: (
    component: SchematicComponent,
    base: Size,
    bounds: Size,
    visibleBounds: null,
  ) => ComponentVisibleBounds;
}

/** Hit-only PSU geometry; Stage supplies its canonical painted projection. */
export function computeSupplySwitchClipGeometry({
  bodyPaintOrder,
  liveSupplySwitches,
  pendingTerminal,
  hitDomainPoints,
  viewBox,
  stageBounds,
  projectPoint,
  projectBounds,
}: SupplySwitchClipInputs) {
  // Bounds overlap conservatively disables the entire exclusion. A partially
  // occluded switch keeps historical wire priority rather than leaving a gap.
  const supplySwitchHoles = pendingTerminal
    ? []
    : bodyPaintOrder.flatMap((part, index) => {
        if (part.componentTypeId !== 'regulated-power-supply' || !liveSupplySwitches.has(part.id))
          return [];
        const entry = catalogEntry(part);
        if (!entry) return [];
        const base = renderedSize(entry, 0);
        const bounds = renderedSize(entry, part.rotation ?? 0);
        const project = (x: number, y: number) =>
          projectPoint(part, base, bounds, {
            x: (x * base.width) / 294,
            y: (y * base.height) / 237,
          });
        const corners = [
          [14, 202],
          [81, 202],
          [81, 228],
          [14, 228],
        ].map(([x, y]) => project(x!, y!));
        const box = {
          minX: Math.min(...corners.map((p) => p.x)),
          maxX: Math.max(...corners.map((p) => p.x)),
          minY: Math.min(...corners.map((p) => p.y)),
          maxY: Math.max(...corners.map((p) => p.y)),
        };
        if (
          bodyPaintOrder.slice(index + 1).some((other) => {
            const otherEntry = catalogEntry(other);
            if (!otherEntry?.asset) return false;
            const otherBase = renderedSize(otherEntry, 0);
            const otherBounds = projectBounds(
              other,
              otherBase,
              renderedSize(otherEntry, other.rotation ?? 0),
              null,
            );
            return (
              box.minX <= otherBounds.maxX &&
              box.maxX >= otherBounds.minX &&
              box.minY <= otherBounds.maxY &&
              box.maxY >= otherBounds.minY
            );
          })
        )
          return [];
        const point = (x: number, y: number) => {
          const p = project(x, y);
          return `${p.x} ${p.y}`;
        };
        const sweep =
          (part.stateProperties?.['mirrorX'] === true) !==
          (part.stateProperties?.['mirrorY'] === true)
            ? 0
            : 1;
        const rx = (13 * base.width) / 294;
        const ry = (13 * base.height) / 237;
        const rotation = part.rotation ?? 0;
        const arc = (x: number, y: number) => `A ${rx} ${ry} ${rotation} 0 ${sweep} ${point(x, y)}`;
        return [
          {
            box,
            path: `M ${point(27, 202)} L ${point(68, 202)} ${arc(81, 215)} ${arc(68, 228)} L ${point(27, 228)} ${arc(14, 215)} ${arc(27, 202)} Z`,
          },
        ];
      });
  // Include the complete viewBox as well as routes: a CSS resize can change
  // the slice scale without a React render, but its visible region stays within
  // this box. The mounted slice scale covers the current 30px maximum stroke.
  const hitScale = stageBounds
    ? Math.max(stageBounds.width / viewBox.width, stageBounds.height / viewBox.height)
    : 0;
  const hitMargin = 15 / hitScale;
  const hitDomain =
    hitDomainPoints.length && Number.isFinite(hitMargin) && hitMargin > 0
      ? {
          minX:
            Math.min(
              ...hitDomainPoints.map((p) => p.x),
              viewBox.x,
              ...supplySwitchHoles.map((h) => h.box.minX),
            ) - hitMargin,
          maxX:
            Math.max(
              ...hitDomainPoints.map((p) => p.x),
              viewBox.x + viewBox.width,
              ...supplySwitchHoles.map((h) => h.box.maxX),
            ) + hitMargin,
          minY:
            Math.min(
              ...hitDomainPoints.map((p) => p.y),
              viewBox.y,
              ...supplySwitchHoles.map((h) => h.box.minY),
            ) - hitMargin,
          maxY:
            Math.max(
              ...hitDomainPoints.map((p) => p.y),
              viewBox.y + viewBox.height,
              ...supplySwitchHoles.map((h) => h.box.maxY),
            ) + hitMargin,
        }
      : null;
  const switchClips =
    hitDomain && Object.values(hitDomain).every(Number.isFinite) ? supplySwitchHoles : [];
  return { switchClips, hitDomain };
}
