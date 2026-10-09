/* @vitest-environment jsdom */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkbenchHeader } from '../WorkbenchHeader';
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
    // Values are the real adapter unit (milliseconds), including microsecond
    // precision. The frozen controller is an input boundary, not a clock mock.
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
      const controller = Object.freeze({
        projectTitle: 'Ученическая схема',
        saveStatus: 'saved',
        simulationRunning: true,
        simulationStatus: 'running',
        committedSimulationTimeMs: milliseconds,
        // The requested horizon is deliberately ahead; it must not be shown.
        simulationTimeMs: milliseconds + 60_000,
        activeWireColor: '#e3212b',
      }) as unknown as ElectronicsWorkbenchController;
      await act(async () => {
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
      expect(controller.committedSimulationTimeMs).toBe(milliseconds);
      expect(controller.simulationTimeMs).toBe(milliseconds + 60_000);
      expect(host.querySelector('[aria-label="Остановить моделирование"]')).not.toBeNull();
    }
  });
});
