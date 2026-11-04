/* @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProductionComponentVisual } from '../../apps/web/src/electronics/ProductionComponentVisual';
import { catalogEntry, renderedSize } from '../../apps/web/src/electronics/component-catalog';
import { configureProductionLibrary } from '../../apps/web/src/electronics/production-manifest-adapter';
import { WORLD_UNITS_PER_MM } from '../../apps/web/src/electronics/production-asset-contracts';
import {
  installNativeSaveInputObserver,
  selectionStrokeDimensions,
} from './native-oracle-contracts';

configureProductionLibrary(
  JSON.parse(
    readFileSync(
      resolve('apps/web/public/assets/electronics/component-database/catalog.json'),
      'utf8',
    ),
  ),
);

function actualVisual(type: string, selected = true) {
  const component = { id: type, type, x: 0, y: 0, rotation: 0, value: 220 };
  const entry = catalogEntry(type);
  return renderToStaticMarkup(
    createElement(ProductionComponentVisual, {
      entry,
      component,
      ...renderedSize(entry),
      visualState: 'off',
      selected,
    }),
  );
}

describe('native qualification observes existing DOM contracts without waiving geometry', () => {
  const rootFor = (markup: string) => {
    const root = document.createElement('div');
    root.innerHTML = markup;
    return root;
  };
  for (const type of ['resistor-axial', 'button-tactile-6mm', 'switch-spdt'] as const)
    it(`measures the actual ${type} selection at the canonical default world radius`, () => {
      const unselected = rootFor(actualVisual(type, false));
      const ordinary = Number(
        unselected
          .querySelector(
            '.workbench-owner-resistor > line, .workbench-tinkercad-button > line, .workbench-tinkercad-switch > line',
          )!
          .getAttribute('stroke-width'),
      );
      const dimensions = selectionStrokeDimensions(rootFor(actualVisual(type)), ordinary);
      const modelScale = 0.254 * WORLD_UNITS_PER_MM;
      const body = (2 * 2) / modelScale;
      expect(dimensions).toEqual({ body, pin: 2 + body, ordinary: 2 });
      expect((dimensions.body / 2) * modelScale).toBeCloseTo(2, 10);
      expect(((dimensions.pin - dimensions.ordinary) / 2) * modelScale).toBeCloseTo(2, 10);
    });

  it('rejects missing, ambiguous and unrelated selection shapes instead of finding arbitrary SVG', () => {
    for (const markup of [
      '<svg><rect stroke-width="3"/></svg>',
      '<svg><g><rect class="workbench-tinkercad-selection" stroke-width="3"/></g></svg>',
      '<svg><g class="workbench-tinkercad-switch"><rect class="workbench-tinkercad-selection"/><line stroke-width="2"/></g></svg>',
      '<svg><g class="workbench-owner-resistor"><rect class="workbench-tinkercad-selection" stroke-width="3"/><line stroke-width="2"/></g></svg>',
      actualVisual('switch-spdt') + actualVisual('switch-spdt'),
    ])
      expect(() => selectionStrokeDimensions(rootFor(markup), 2)).toThrow();
    expect(() => selectionStrokeDimensions(rootFor(actualVisual('switch-spdt')), NaN)).toThrow(
      'Missing finite unselected lead width',
    );
  });

  it('uses the existing Save aria identity and keeps all geometry assertions in native journeys', () => {
    const header = readFileSync(resolve('apps/web/src/electronics/WorkbenchHeader.tsx'), 'utf8');
    expect(header).toContain('data-workbench-tooltip={title}');
    expect(header).toContain('className="workbench-pill save"');
    expect(header).toContain('aria-label="Сохранить проект"');
    const selection = readFileSync(resolve('e2e/electronics-selection-outline.spec.ts'), 'utf8');
    expect(selection).toContain('selectionStrokeDimensions,');
    expect(selection).toContain('.toBeLessThanOrEqual(1.25)');
    expect(selection.match(/\.toBeCloseTo\(afterGeometry.expectedPx, 5\)/g)).toHaveLength(2);
    const interactions = readFileSync(resolve('e2e/electronics-interactions.spec.ts'), 'utf8');
    expect(interactions).toContain('await page.evaluate(installNativeSaveInputObserver)');
    expect(interactions).toContain('expect(rows[index].revision).toBe(before.revision + 1)');
    expect(interactions).toContain('expect(saved.document).toEqual(expected)');
  });

  it('keeps once-only Save identity evidence and rejects wrong, duplicate and untrusted targets', () => {
    document.body.innerHTML =
      '<button class="workbench-pill save" aria-label="Сохранить проект"><span>Save</span></button><button id="other">Other</button>';
    const read = () =>
      (
        window as unknown as {
          f2SaveInput: {
            trusted: boolean;
            pointerType: string;
            ariaLabel: string | null;
            saveButton: boolean;
          };
        }
      ).f2SaveInput;
    const down = (target: Element) => {
      const event = new Event('pointerdown', { bubbles: true });
      Object.defineProperty(event, 'pointerType', { value: 'mouse' });
      target.dispatchEvent(event);
    };
    installNativeSaveInputObserver();
    down(document.querySelector('button span')!);
    expect(read()).toEqual({
      trusted: false,
      pointerType: 'mouse',
      ariaLabel: 'Сохранить проект',
      saveButton: true,
    });
    down(document.querySelector('#other')!);
    expect(read().saveButton).toBe(true);
    installNativeSaveInputObserver();
    down(document.querySelector('#other')!);
    expect(read().saveButton).toBe(false);
    document.body.append(document.querySelector('button.save')!.cloneNode(true));
    installNativeSaveInputObserver();
    down(document.querySelector('button.save')!);
    expect(read().saveButton).toBe(false);
    document.body.innerHTML = '';
  });
});
