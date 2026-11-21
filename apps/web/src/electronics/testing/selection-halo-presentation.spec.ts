import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { ProductionComponentVisual } from '../ProductionComponentVisual';
import { catalogEntry, renderedSize } from '../component-catalog';
import { WORLD_UNITS_PER_MM } from '../production-asset-contracts';
import { configureProductionLibrary } from '../production-manifest-adapter';

const types = ['resistor-axial', 'button-tactile-6mm', 'switch-spdt'] as const;
const baseline = JSON.parse(
  readFileSync('tests/electronics/evidence/selection-halo-902/normal-baseline.json', 'utf8'),
) as { normals: Record<string, string> };

beforeAll(() => {
  configureProductionLibrary(
    JSON.parse(
      readFileSync('apps/web/public/assets/electronics/component-database/catalog.json', 'utf8'),
    ),
  );
});

function render(
  type: string,
  selected: boolean,
  mirrorX = false,
  mirrorY = false,
  selectionOffset?: number,
) {
  const entry = catalogEntry(type)!;
  return renderToStaticMarkup(
    createElement(ProductionComponentVisual, {
      entry,
      component: {
        id: type,
        componentTypeId: type,
        kind: entry.kind,
        position: { x: 0, y: 0 },
        rotation: 0,
        value: 220,
        stateProperties: { mirrorX, mirrorY },
      },
      ...renderedSize(entry),
      visualState: 'off',
      selected,
      ...(selectionOffset === undefined ? {} : { selectionOffset }),
    }),
  );
}

describe('native component selection halo presentation', () => {
  it.each(types)('%s retains byte-identical normal SVG through both mirror axes', (type) => {
    for (const x of [false, true])
      for (const y of [false, true]) {
        const svg = render(type, false, x, y);
        expect(createHash('sha256').update(svg).digest('hex')).toBe(
          baseline.normals[`${type}:${[x, y]}`],
        );
        const selected = render(type, true, x, y);
        expect(selected.replace(/<g class="workbench-tinkercad-selection"[\s\S]*?<\/g>/, '')).toBe(
          svg,
        );
      }
  });

  it.each(types)(
    '%s consumes world-space offset and keeps ordinary pins above blue underlays',
    (type) => {
      for (const offset of [0.4, 1.6, 2, undefined]) {
        const svg = render(type, true, false, false, offset);
        const outline = svg.match(/<g class="workbench-tinkercad-selection"[\s\S]*?<\/g>/)?.[0];
        expect(outline).toBeTruthy();
        expect(outline).toContain('pointer-events="none"');
        const pins = [...outline!.matchAll(/<line\b[^>]*>/g)].map((match) => match[0]);
        expect(pins).toHaveLength(type === 'resistor-axial' ? 1 : type === 'switch-spdt' ? 3 : 2);
        const body = outline!.match(/<(?:path|rect)\b[^>]*>/)![0];
        const width = (markup: string) => Number(markup.match(/stroke-width="([^"]+)"/)![1]);
        const scale = 0.254 * WORLD_UNITS_PER_MM;
        expect((width(body) / 2) * scale).toBeCloseTo(offset ?? 2, 10);
        for (const pin of pins) expect(((width(pin) - 2) / 2) * scale).toBeCloseTo(offset ?? 2, 10);
        expect(svg.indexOf(outline!)).toBeLessThan(svg.indexOf('stroke="#8c8c8c"'));
        const ordinary = [
          ...svg.replace(outline!, '').matchAll(/<line\b[^>]*stroke="#8c8c8c"[^>]*>/g),
        ];
        expect(ordinary).toHaveLength(pins.length);
        for (const [pin] of ordinary) expect(width(pin)).toBe(2);
      }
    },
  );

  it('applies the same switch-family underlay to the existing two-pin variant', () => {
    const svg = render('switch-spst', true);
    const outline = svg.match(/<g class="workbench-tinkercad-selection"[\s\S]*?<\/g>/)?.[0];
    expect(outline).toBeTruthy();
    expect([...outline!.matchAll(/<line\b/g)]).toHaveLength(2);
    expect(svg.replace(outline!, '')).toBe(render('switch-spst', false));
  });
});
