/* @vitest-environment jsdom */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkbenchHeader } from '../WorkbenchHeader';
import { NativeOpticalPresentation } from '../native-optical-presentation';
import type { ElectronicsWorkbenchController } from '../use-electronics-workbench';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
const noop = () => undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('mounted production WorkbenchHeader committed time', () => {
  it('floors only the displayed seconds across rollovers and long durations', async () => {
    host = document.body.appendChild(document.createElement('div'));
    root = createRoot(host);
    const port = new NativeOpticalPresentation();
    const controller = Object.freeze({
      projectTitle: 'Ученическая схема',
      saveStatus: 'saved',
      simulationRunning: true,
      simulationStatus: 'running',
      get committedSimulationTimeMs() {
        return port.readClock() / 1000;
      },
      nativeOpticalPresentation: port,
      // The requested horizon is deliberately ahead; it must not be shown.
      get simulationTimeMs() {
        return port.readClock() / 1000 + 60_000;
      },
      activeWireColor: '#e3212b',
    }) as unknown as ElectronicsWorkbenchController;
    // Milliseconds retain microsecond precision; only the genuine port changes.
    // A frozen controller and mounted Header are reused across every clock tick.
    for (const [milliseconds, display] of [
      [0, '00:00:00'],
      [999.999, '00:00:00'],
      [1_000.001, '00:00:01'],
      [59_999.999, '00:00:59'],
      [60_000, '00:01:00'],
      [3_599_999.999, '00:59:59'],
      [3_600_000, '01:00:00'],
      [360_061_999.999, '100:01:01'],
    ] as const) {
      await act(async () => {
        port.setClock(Math.round(milliseconds * 1000));
        if (milliseconds === 0)
          root!.render(
            createElement(WorkbenchHeader, {
              controller,
              user: { id: 'pupil-time', displayName: 'Ученик', email: '' },
              view: 'breadboard',
              notesOpen: false,
              codeOpen: false,
              onBack: noop,
              onViewChange: noop,
              onToggleNotes: noop,
              onToggleCode: noop,
              onToggleLibrary: noop,
              onOpenShare: noop,
              onExportView: noop,
            }),
          );
      });
      expect(host.querySelector('[aria-label="Время моделирования"]')?.textContent).toBe(
        `Время моделирования: ${display}`,
      );
      expect(
        host.querySelector('[aria-label="Время моделирования"]')?.getAttribute('data-time-ms'),
      ).toBe(String(port.readClock() / 1000));
      expect(controller.committedSimulationTimeMs).toBe(milliseconds);
      expect(controller.simulationTimeMs).toBe(milliseconds + 60_000);
      expect(host.querySelector('[aria-label="Остановить моделирование"]')).not.toBeNull();
    }
  });
});
