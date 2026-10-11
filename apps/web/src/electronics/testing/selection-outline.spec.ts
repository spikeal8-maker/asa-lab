/* @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ProductionComponentVisual } from '../ProductionComponentVisual';
import { catalogEntry, renderedSize } from '../component-catalog';
import { configureProductionLibrary } from '../production-manifest-adapter';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLDivElement | undefined;
beforeAll(() => {
  configureProductionLibrary(
    JSON.parse(
      readFileSync(
        resolve(
          process.cwd(),
          'apps/web/public/assets/electronics/component-database/catalog.json',
        ),
        'utf8',
      ),
    ),
  );
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  host = undefined;
  root = undefined;
});

function mount(key: string, selected: boolean, screenZoom: number) {
  const entry = catalogEntry(key)!;
  const size = renderedSize(entry, 0);
  host ??= document.body.appendChild(document.createElement('div'));
  root ??= createRoot(host);
  act(() =>
    root!.render(
      createElement(ProductionComponentVisual, {
        entry,
        component: {
          id: 'selected',
          kind: entry.kind,
          componentTypeId: key,
          position: { x: 0, y: 0 },
          rotation: 0,
          value: entry.defaultValue,
          stateProperties: { ...entry.defaultStateProperties },
        },
        width: size.width,
        height: size.height,
        visualState: 'default',
        selected,
        selectionOffset: 1.6 / screenZoom,
      }),
    ),
  );
  return host.querySelector('svg')!;
}

function ordinaryMarkup(svg: SVGSVGElement) {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  copy.querySelector('.workbench-tinkercad-selection')?.remove();
  return copy.outerHTML;
}

describe('mounted production selection silhouette', () => {
  for (const key of ['resistor-axial', 'button-tactile-6mm', 'switch-spdt']) {
    it(`${key}: surrounds the same body and gray pins at both screen scales`, () => {
      const unselected = ordinaryMarkup(mount(key, false, 1));
      for (const screenZoom of [1, 4]) {
        const svg = mount(key, true, screenZoom);
        expect(ordinaryMarkup(svg)).toBe(unselected);
        const outline = svg.querySelector('.workbench-tinkercad-selection')!;
        expect(outline.getAttribute('pointer-events')).toBe('none');
        const model = outline.parentElement!;
        const scale = Number(model.getAttribute('transform')!.match(/scale\(([^)]+)\)/)![1]);
        const pins = Array.from(model.children).filter((node) => node.tagName === 'line');
        const outlines = Array.from(outline.querySelectorAll('line'));
        expect(outlines).toHaveLength(pins.length);
        expect(outline.compareDocumentPosition(pins[0]!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
        for (const [index, pin] of pins.entries()) {
          const selectedPin = outlines[index]!;
          for (const coordinate of ['x1', 'x2', 'y1', 'y2', 'stroke-linecap'])
            expect(selectedPin.getAttribute(coordinate)).toBe(pin.getAttribute(coordinate));
          expect(pin.getAttribute('stroke')).toBe('#8c8c8c');
          expect(selectedPin.getAttribute('stroke')).toBe('#3b8ed7');
          const ordinaryWidth = Number(pin.getAttribute('stroke-width'));
          const selectedWidth = Number(selectedPin.getAttribute('stroke-width'));
          // The original lead remains on top; only its exterior grows blue.
          expect(((selectedWidth - ordinaryWidth) / 2) * scale * screenZoom).toBeCloseTo(1.6, 12);
        }
        const selectedBody = outline.querySelector('path, rect')!;
        const ordinaryBody = Array.from(model.children).find((node) =>
          node === outline
            ? false
            : key === 'resistor-axial'
              ? node.tagName === 'path'
              : node.tagName === (key === 'switch-spdt' ? 'g' : 'rect'),
        )!;
        const body = key === 'switch-spdt' ? ordinaryBody.querySelector('rect')! : ordinaryBody;
        if (key === 'resistor-axial')
          expect(selectedBody.getAttribute('d')).toBe(body.getAttribute('d'));
        else {
          for (const dimension of ['width', 'height', 'rx'])
            expect(selectedBody.getAttribute(dimension)).toBe(body.getAttribute(dimension));
        }
        expect(
          (Number(selectedBody.getAttribute('stroke-width')) / 2) * scale * screenZoom,
        ).toBeCloseTo(1.6, 12);
        expect(selectedBody.getAttribute('stroke')).toBe('#3b8ed7');
      }
    });
  }

  it('retains the owner alpha silhouette pipeline and its common outward screen radius', () => {
    for (const zoom of [1, 4]) {
      const svg = mount('led-5mm', true, zoom);
      const outline = svg.querySelector('.workbench-selection-silhouette')!;
      expect(outline.getAttribute('pointer-events')).toBe('none');
      expect(Number(outline.querySelector('feMorphology')!.getAttribute('radius')) * zoom).toBe(
        1.6,
      );
      expect(outline.querySelector('feMorphology')!.getAttribute('in')).toBe('SourceAlpha');
      expect(outline.querySelector('feComposite')!.getAttribute('operator')).toBe('out');
      expect(outline.querySelector('feFlood')!.getAttribute('flood-color')).toBe('#3b8ed7');
      const silhouetteImage = outline.querySelector('image')!;
      const ordinaryImage = Array.from(svg.children).find((node) => node.tagName === 'image')!;
      expect(silhouetteImage.getAttribute('href')).toBe(ordinaryImage.getAttribute('href'));
      for (const dimension of ['width', 'height', 'preserveAspectRatio'])
        expect(silhouetteImage.getAttribute(dimension)).toBe(ordinaryImage.getAttribute(dimension));
    }
  });
});
