// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { ElectronicsDisplayArtifact } from '@asa-lab/contracts';
import { ElectronicsPublicationScene } from './ElectronicsPublicationScene';
import { readFileSync } from 'node:fs';
import { configureProductionLibrary } from '../electronics/production-manifest-adapter';

vi.mock('../electronics/NativeOpticalComponentVisual', () => ({
  ProductionComponentVisual: (props: { simulationRunning: boolean; component: object }) => {
    expect(props.simulationRunning).toBe(false);
    expect(Object.isFrozen(props.component)).toBe(true);
    expect(Object.keys(props).some((key) => key.startsWith('on'))).toBe(false);
    return createElement('rect', { width: 20, height: 20 });
  },
}));

it('renders immutable real component and wire geometry while only changing its local viewport', async () => {
  configureProductionLibrary(
    JSON.parse(
      readFileSync('apps/web/public/assets/electronics/component-database/catalog.json', 'utf8'),
    ),
  );
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  const artifact: ElectronicsDisplayArtifact = {
    schemaVersion: 2,
    status: 'display',
    viewerFamily: 'electronics',
    provenance: { publicationId: 'publication', revisionNumber: 1 },
    capabilities: { readOnly: true, interactive: true, download: false },
    components: [
      { id: 'r1', kind: 'resistor', position: { x: 20, y: 20 }, value: 1000 },
      { id: 'r2', kind: 'resistor', position: { x: 200, y: 100 }, value: 1000, rotation: 90 },
    ],
    connections: [
      {
        id: 'w1',
        from: { componentId: 'r1', terminal: 'b' },
        to: { componentId: 'r2', terminal: 'a' },
      },
    ],
  };
  const before = JSON.stringify(artifact);
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(ElectronicsPublicationScene, { artifact })));
    expect(host.querySelectorAll('[data-testid="public-electronics-component"]')).toHaveLength(2);
    expect(
      host.querySelector('[data-testid="public-electronics-wire"]')?.getAttribute('d'),
    ).toMatch(/^M/);
    const svg = host.querySelector('svg')!;
    const fit = svg.getAttribute('viewBox');
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[data-testid="public-electronics-zoom-in"]')!.click(),
    );
    expect(svg.getAttribute('viewBox')).not.toBe(fit);
    await act(async () =>
      svg.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })),
    );
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[data-testid="public-electronics-fit"]')!.click(),
    );
    expect(svg.getAttribute('viewBox')).toBe(fit);
    expect(JSON.stringify(artifact)).toBe(before);
    expect(host.querySelector('input')).toBeNull();
  } finally {
    await act(async () => root.unmount());
  }
});
