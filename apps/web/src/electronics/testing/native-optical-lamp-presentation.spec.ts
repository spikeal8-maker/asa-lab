/* @vitest-environment jsdom */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { catalogEntry } from '../component-catalog';
import { configureProductionLibrary } from '../production-manifest-adapter';
import { NativeOpticalProvider, ProductionComponentVisual } from '../NativeOpticalComponentVisual';
import {
  NativeOpticalPresentation,
  type NativeOpticalObservation,
} from '../native-optical-presentation';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

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

const mounted: Array<{ root: Root; host: HTMLElement }> = [];

afterEach(() => {
  for (const { root, host } of mounted.splice(0)) {
    act(() => root.unmount());
    host.remove();
  }
});

let sequence = 0;
function completeOpticalFrame(values: Record<string, number>): NativeOpticalObservation {
  const token = `lamp-committed-${++sequence}`;
  return {
    result: {
      solved: true,
      quality: { passed: true },
      components: Object.entries(values).map(([componentId, brightness]) => ({
        componentId,
        brightness,
        lit: brightness > 0,
      })),
    } as unknown as NativeOpticalObservation['result'],
    frame: {
      token,
      atMicroseconds: sequence * 1000,
      brightness: new Map(Object.entries(values)),
      arduinoLStates: new Map(),
    },
    ledAssets: new Map(),
  };
}

function mountRealLamp(ids: readonly string[] = ['lamp-a']) {
  const port = new NativeOpticalPresentation();
  const selectedEntry = catalogEntry('incandescent-lamp');
  expect(selectedEntry).toBeDefined();
  if (!selectedEntry) throw new Error('The production incandescent-lamp catalog entry is missing.');
  const entry: NonNullable<typeof selectedEntry> = selectedEntry;

  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  mounted.push({ root, host });
  let stageRenders = 0;

  function StaticStage({ running }: { running: boolean }) {
    stageRenders += 1;
    return createElement(
      'svg',
      {},
      ...ids.map((id) =>
        createElement(
          'g',
          { key: id, 'data-lamp-id': id },
          createElement(ProductionComponentVisual, {
            entry,
            component: {
              id,
              kind: entry.kind,
              componentTypeId: entry.key,
              variantId: entry.key,
              position: { x: 0, y: 0 },
              value: entry.defaultValue,
              rotation: 0,
              stateProperties: {},
            },
            width: 100,
            height: 100,
            visualState: 'default',
            simulationRunning: running,
          }),
        ),
      ),
    );
  }

  const render = async (running = true) => {
    await act(async () => {
      root.render(
        createElement(NativeOpticalProvider, { port }, createElement(StaticStage, { running })),
      );
    });
  };
  const lampHref = (id: string) => {
    const images = [...host.querySelectorAll<SVGImageElement>(`[data-lamp-id="${id}"] image`)];
    const href = images
      .map(
        (image) =>
          image.getAttribute('href') ??
          image.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ??
          '',
      )
      .find((source) => source.includes('/lamp/'));
    if (!href)
      throw new Error(
        `No actual production lamp asset: ${id}; images=${JSON.stringify(images.map((image) => image.getAttribute('href')))}`,
      );
    return href;
  };
  const expectLevel = (id: string, level: 'off' | 'dim' | 'on' | 'max') =>
    expect(lampHref(id)).toMatch(new RegExp(`/lamp/${level}\\.svg(?:$|\\?)`));

  return {
    port,
    render,
    lampHref,
    expectLevel,
    stageRenders: () => stageRenders,
  };
}

describe('native production lamp SVG obeys committed optical frames', () => {
  it('does not reveal speculative frames, then displays real off/dim/on/max SVGs only on ACK', async () => {
    const view = mountRealLamp();
    await view.render();
    view.expectLevel('lamp-a', 'off');

    const max = completeOpticalFrame({ 'lamp-a': 99.56 });
    await act(async () => view.port.setObservation(max, true));
    view.expectLevel('lamp-a', 'off');
    await act(async () => view.port.commit(max));
    view.expectLevel('lamp-a', 'max');

    for (const [brightness, level] of [
      [55, 'on'],
      [12, 'dim'],
      [0, 'off'],
    ] as const) {
      const proposed = completeOpticalFrame({ 'lamp-a': brightness });
      await act(async () => view.port.setObservation(proposed, true));
      view.expectLevel('lamp-a', brightness === 55 ? 'max' : brightness === 12 ? 'on' : 'dim');
      await act(async () => view.port.commit(proposed));
      view.expectLevel('lamp-a', level);
    }
  });

  it('keeps the previous committed SVG on rollback and rejects a late ACK from another generation', async () => {
    const view = mountRealLamp();
    await view.render();
    const old = completeOpticalFrame({ 'lamp-a': 50 });
    await act(async () => view.port.setObservation(old));
    view.expectLevel('lamp-a', 'on');

    const rejected = completeOpticalFrame({ 'lamp-a': 100 });
    await act(async () => view.port.setObservation(rejected, true));
    view.expectLevel('lamp-a', 'on');
    await act(async () => {
      view.port.setRollback(old.ledAssets);
      view.port.setObservation(old);
      view.port.setRollback(null);
    });
    view.expectLevel('lamp-a', 'on');

    await act(async () => view.port.setObservation(null));
    view.expectLevel('lamp-a', 'off');
    await act(async () => view.port.commit(rejected));
    view.expectLevel('lamp-a', 'off');
  });

  it('clears the stale presentation on Stop/Reset and a new run without resurrecting the old frame', async () => {
    const view = mountRealLamp();
    await view.render();
    await act(async () => view.port.setObservation(completeOpticalFrame({ 'lamp-a': 98 })));
    view.expectLevel('lamp-a', 'max');

    await view.render(false);
    view.expectLevel('lamp-a', 'off');
    await act(async () => view.port.setObservation(null));
    await view.render(true);
    view.expectLevel('lamp-a', 'off');
    const next = completeOpticalFrame({ 'lamp-a': 8 });
    await act(async () => view.port.setObservation(next, true));
    view.expectLevel('lamp-a', 'off');
    await act(async () => view.port.commit(next));
    view.expectLevel('lamp-a', 'dim');
  });

  it('isolates the two lamp bodies and does not rerender the whole static Stage per optical frame', async () => {
    const view = mountRealLamp(['lamp-a', 'lamp-b']);
    await view.render();
    const initialStageRenders = view.stageRenders();
    const first = completeOpticalFrame({ 'lamp-a': 80, 'lamp-b': 0 });
    await act(async () => view.port.setObservation(first));
    view.expectLevel('lamp-a', 'on');
    view.expectLevel('lamp-b', 'off');
    const second = completeOpticalFrame({ 'lamp-a': 0, 'lamp-b': 100 });
    await act(async () => view.port.setObservation(second));
    view.expectLevel('lamp-a', 'off');
    view.expectLevel('lamp-b', 'max');
    expect(view.stageRenders()).toBe(initialStageRenders);
  });
});
