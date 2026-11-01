import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { SchematicComponent } from '../../api';
import { configureProductionLibrary } from '../production-manifest-adapter';
import { computeSupplySwitchClipGeometry } from '../supply-switch-hit-geometry';

beforeAll(() =>
  configureProductionLibrary(
    JSON.parse(
      readFileSync(
        resolve('apps/web/public/assets/electronics/component-database/catalog.json'),
        'utf8',
      ),
    ),
  ),
);
const supply: SchematicComponent = {
  id: 'supply',
  kind: 'source',
  componentTypeId: 'regulated-power-supply',
  position: { x: 0, y: 0 },
  value: 5,
};
const foreground: SchematicComponent = { ...supply, id: 'foreground' };
function inputs() {
  return {
    bodyPaintOrder: [supply],
    liveSupplySwitches: new Set(['supply']),
    pendingTerminal: null,
    hitDomainPoints: [
      { x: -5000, y: 0 },
      { x: 5000, y: 1500 },
    ],
    viewBox: { x: 0, y: 0, width: 1440, height: 750 },
    stageBounds: { width: 1440, height: 750 },
    projectPoint: vi.fn<Parameters<typeof computeSupplySwitchClipGeometry>[0]['projectPoint']>(
      (_part, _base, _bounds, point) => point,
    ),
    projectBounds: vi.fn(() => ({ minX: 7, minY: 101, maxX: 40.5, maxY: 114 })),
  };
}
describe('supply switch hit-only geometry boundary', () => {
  it('uses the supplied canonical projector and covers all routes plus viewBox at mounted slice scale', () => {
    const value = inputs();
    const result = computeSupplySwitchClipGeometry(value);
    expect(result.switchClips).toHaveLength(1);
    expect(result.switchClips[0]!.box).toEqual({ minX: 7, minY: 101, maxX: 40.5, maxY: 114 });
    expect(value.projectPoint).toHaveBeenCalledWith(
      supply,
      { width: 147, height: 118.5 },
      { width: 147, height: 118.5 },
      { x: 7, y: 101 },
    );
    expect(result.hitDomain).toEqual({ minX: -5015, maxX: 5015, minY: -15, maxY: 1515 });
    const half = computeSupplySwitchClipGeometry({
      ...value,
      stageBounds: { width: 720, height: 375 },
    });
    expect(half.hitDomain).toEqual({ minX: -5030, maxX: 5030, minY: -30, maxY: 1530 });
  });
  it('emits no exclusion for unavailable controls or pending-terminal wiring', () => {
    expect(
      computeSupplySwitchClipGeometry({ ...inputs(), liveSupplySwitches: new Set() }).switchClips,
    ).toEqual([]);
    expect(
      computeSupplySwitchClipGeometry({ ...inputs(), pendingTerminal: { componentId: 'supply' } })
        .switchClips,
    ).toEqual([]);
  });
  it('suppresses the entire track for later foreground bounds, respecting existing paint order', () => {
    const value = inputs();
    expect(
      computeSupplySwitchClipGeometry({ ...value, bodyPaintOrder: [supply, foreground] })
        .switchClips,
    ).toEqual([]);
    expect(value.projectBounds).toHaveBeenCalledWith(
      foreground,
      { width: 147, height: 118.5 },
      { width: 147, height: 118.5 },
      null,
    );
    expect(
      computeSupplySwitchClipGeometry({ ...value, bodyPaintOrder: [foreground, supply] })
        .switchClips,
    ).toHaveLength(1);
  });
  it('fails closed without mounted bounds, routes or finite extents', () => {
    expect(
      computeSupplySwitchClipGeometry({ ...inputs(), stageBounds: undefined }).switchClips,
    ).toEqual([]);
    expect(
      computeSupplySwitchClipGeometry({ ...inputs(), stageBounds: { width: 0, height: 0 } })
        .hitDomain,
    ).toBeNull();
    expect(
      computeSupplySwitchClipGeometry({ ...inputs(), hitDomainPoints: [] }).hitDomain,
    ).toBeNull();
    expect(
      computeSupplySwitchClipGeometry({ ...inputs(), hitDomainPoints: [{ x: Infinity, y: 0 }] })
        .switchClips,
    ).toEqual([]);
  });
});
