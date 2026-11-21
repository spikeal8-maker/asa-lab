/* @vitest-environment jsdom */
import { act, createElement, type ComponentProps } from 'react';
import type { SolveResult } from '../../api';
import type { SchematicComponent } from '../../api';
import type { CatalogEntry } from '../component-catalog';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { NativeOpticalProvider, ProductionComponentVisual } from '../NativeOpticalComponentVisual';
import {
  NativeOpticalPresentation,
  type NativeOpticalObservation,
} from '../native-optical-presentation';
vi.mock('../ProductionComponentVisual', () => ({
  ProductionComponentVisual: (props: ComponentProps<typeof ProductionComponentVisual>) =>
    createElement('output', { 'data-id': props.component.id }, JSON.stringify(props.result)),
}));
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const kinds = ['multimeter', 'regulated-power-supply', 'signal-generator', 'oscilloscope'];
function observation(value: number): NativeOpticalObservation {
  return {
    result: {
      components: kinds.map((componentId) => ({ componentId, voltageDrop: value })),
    } as unknown as SolveResult,
    frame: {
      token: String(value),
      atMicroseconds: value,
      brightness: new Map(),
      arduinoLStates: new Map(),
    },
    ledAssets: new Map(),
  };
}
describe('instrument committed projection subscriber contract (synthetic)', () => {
  it('isolates proposals, stale parents, selection and reset without adding barrier members', async () => {
    const port = new NativeOpticalPresentation(),
      initial = observation(1);
    port.setObservation(initial);
    const host = document.body.appendChild(document.createElement('div')),
      root = createRoot(host);
    let parentRenders = 0,
      barriers = 0;
    port.setBarrier(() => barriers++);
    function Parent({ running = true, selected = '' }: { running?: boolean; selected?: string }) {
      parentRenders++;
      return createElement(
        NativeOpticalProvider,
        { port },
        kinds.map((kind) =>
          createElement(ProductionComponentVisual, {
            key: kind,
            entry: { key: kind } as CatalogEntry,
            component: { id: kind, kind: 'visual' } as SchematicComponent,
            width: 10,
            height: 10,
            visualState: 'default',
            simulationRunning: running,
            simulationTimeMs: 0,
            selected: kind === selected,
            result: { componentId: kind, voltageDrop: -999 } as SolveResult['components'][number],
          }),
        ),
      );
    }
    const values = () => [...host.querySelectorAll('output')].map((n) => n.textContent);
    try {
      await act(async () => root.render(createElement(Parent, {})));
      const mounted = parentRenders,
        committed = values();
      const proposal = {
        ...observation(2),
        frame: { ...observation(2).frame, arduinoLStates: new Map([['required-uno', true]]) },
      };
      const beforeProposal = barriers;
      await act(async () => port.setObservation(proposal, true));
      expect(values()).toEqual(committed);
      expect(barriers).toBe(beforeProposal); // A missing actual Arduino participant still holds the barrier.
      await act(async () => port.commit(proposal));
      expect(values().every((v) => v?.includes('"voltageDrop":2'))).toBe(true);
      expect(parentRenders).toBe(mounted);
      await act(async () => root.render(createElement(Parent, { selected: 'multimeter' })));
      expect(values().every((v) => v?.includes('"voltageDrop":2'))).toBe(true);
      await act(async () => port.setObservation(null));
      expect(values()).toEqual(['', '', '', '']);
      await act(async () => port.commit(proposal)); // A retired proposal cannot resurrect a reset snapshot.
      expect(values()).toEqual(['', '', '', '']);
      await act(async () => root.render(createElement(Parent, { running: false })));
      await act(async () => port.setObservation(observation(3)));
      expect(values().every((v) => v?.includes('"voltageDrop":-999'))).toBe(true);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
    const before = barriers;
    port.setObservation(observation(4), true);
    port.afterLayout(port.getSnapshot());
    expect(barriers).toBe(before + 1); // Unmounted instruments are not barrier members either.
  });
});
