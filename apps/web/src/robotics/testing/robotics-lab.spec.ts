/* @vitest-environment jsdom */
import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SchematicDocument, SolveResult } from '../../api';
import type { ElectronicsWorkbenchProjectHost } from '../../electronics/use-electronics-workbench';
import type { LiveSimulationInputBudget } from '../../electronics/live-simulation-worker-controller';
import type { SimulationStatusMessage } from '../../electronics/simulation-failure';
import {
  NativeOpticalPresentation,
  type NativeOpticalObservation,
} from '../../electronics/native-optical-presentation';
import { SimulationPacing } from '../../electronics/simulation-pacing';
import { configureProductionLibrary } from '../../electronics/production-manifest-adapter';
import { createDefaultRoboticsProject } from '../robotics-project';
import { RoboticsLab } from '../RoboticsLab';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// UI routing evidence only. Canonical physics/Worker parity is covered by the
// domain and shared-adapter suites, then by the real-browser robotics journey.
const port = vi.hoisted(() => ({
  host: null as ElectronicsWorkbenchProjectHost | null,
  presentation: null as NativeOpticalPresentation | null,
  pacing: null as SimulationPacing | null,
  budget: null as LiveSimulationInputBudget | null,
  message: null as SimulationStatusMessage | null,
  options: null as {
    runtimeInputEventLimit?: number;
    reportSimulationDiagnostics?: boolean;
  } | null,
  toggle: vi.fn<() => Promise<void>>(),
  reset: vi.fn<() => void>(),
  setRate: vi.fn<(rate: number) => void>(),
  serial: vi.fn<(boardId: string, text: string) => void>(),
  sensor: vi.fn<(componentId: string, distanceMeters: number) => boolean>(),
  fit: vi.fn<() => void>(),
  remove: vi.fn<() => void>(),
  stageMounts: 0,
  stageUnmounts: 0,
}));

vi.mock('../../electronics/use-electronics-workbench', () => ({
  useElectronicsWorkbenchHost: (
    _id: string,
    host: ElectronicsWorkbenchProjectHost,
    options: typeof port.options,
  ) => {
    port.host = host;
    port.options = options;
    return {
      ...host,
      simulationStatus: host.simulationRunning ? 'running' : host.simulationStatus,
      nativeOpticalPresentation: port.presentation,
      simulationPacing: port.pacing,
      runtimeInputBudget: port.budget,
      simulationMessage: port.message,
      toggleSimulation: port.toggle,
      resetSimulation: port.reset,
      setSimulationRate: port.setRate,
      sendArduinoSerialRx: port.serial,
      setRuntimeSensorDistance: port.sensor,
      fitScene: port.fit,
      selection: null,
      removeSelection: port.remove,
    };
  },
}));

vi.mock('../../electronics/WorkbenchStage', () => ({
  WorkbenchStage: ({ controller }: { controller: { document: SchematicDocument } }) => {
    useEffect(() => {
      port.stageMounts += 1;
      return () => {
        port.stageUnmounts += 1;
      };
    }, []);
    return createElement(
      'section',
      { 'data-testid': 'canonical-stage' },
      `${controller.document.components.length} canonical components`,
    );
  },
}));

vi.mock('../../electronics/ArduinoCodePanel', () => ({
  ArduinoCodePanel: ({ open, onClose }: { open: boolean; onClose: () => void }) =>
    createElement(
      'section',
      { 'data-testid': 'canonical-program', hidden: !open },
      createElement('button', { type: 'button', onClick: onClose }, 'Закрыть общий редактор'),
    ),
}));

let root: Root;
let container: HTMLDivElement;

function control(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find((button) =>
    button.textContent?.includes(label),
  );
  if (!found) throw new Error(`Missing control: ${label}`);
  return found;
}

async function click(label: string) {
  await act(async () => {
    control(label).click();
  });
}

function metric(id: string): HTMLElement {
  const node = container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  if (!node) throw new Error(`Missing metric: ${id}`);
  return node;
}

function electricalObservation(
  atMicroseconds: number,
  leftRpm = 120,
  rightRpm = 120,
): NativeOpticalObservation {
  const result: SolveResult = {
    solved: true,
    status: 'solved',
    current: 0.1,
    components: [
      {
        componentId: 'left-motor',
        voltageDrop: 5,
        current: 0.05,
        terminalVoltages: {},
        outputRpm: leftRpm,
      },
      {
        componentId: 'right-motor',
        voltageDrop: 5,
        current: 0.05,
        terminalVoltages: {},
        outputRpm: rightRpm,
      },
    ],
    nodes: [],
    diagnostics: [],
    iterations: 1,
    numericalResidual: 0,
    numericalTolerance: 1e-9,
    quality: {
      passed: true,
      finite: true,
      maxKclResidualAmp: 0,
      maxSourceVoltageResidualVolt: 0,
      powerBalanceResidualWatt: 0,
      powerBalanceToleranceWatt: 1e-9,
      kclToleranceAmp: 1e-9,
      sourceVoltageToleranceVolt: 1e-9,
    },
  };
  return {
    result,
    frame: {
      token: `frame:${atMicroseconds}`,
      atMicroseconds,
      brightness: new Map(),
      arduinoLStates: new Map(),
    },
    ledAssets: new Map(),
  };
}

beforeEach(() => {
  configureProductionLibrary(
    JSON.parse(
      readFileSync(
        resolve('apps/web/public/assets/electronics/component-database/catalog.json'),
        'utf8',
      ),
    ),
  );
  localStorage.clear();
  vi.clearAllMocks();
  port.host = null;
  port.presentation = new NativeOpticalPresentation();
  port.pacing = new SimulationPacing();
  port.budget = null;
  port.message = null;
  port.options = null;
  port.stageMounts = 0;
  port.stageUnmounts = 0;
  port.toggle.mockImplementation(async () => {
    port.presentation!.setObservation(null);
    await port.host!.toggleSimulation();
  });
  port.reset.mockImplementation(() => {
    port.presentation!.setObservation(null);
    port.host!.resetSimulation();
  });
  port.setRate.mockImplementation((rate) => {
    port.pacing!.request(rate);
    if (rate === 0) port.pacing!.settlePause();
  });
  port.sensor.mockReturnValue(true);
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    callback(0);
    return 1;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root.render(createElement(RoboticsLab, { initialProject: createDefaultRoboticsProject() })),
  );
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('robotics UI integration with the common workbench port', () => {
  it('keeps the same mounted canonical stage when opening and closing the canonical programmer', async () => {
    const stage = metric('canonical-stage');
    expect(stage.textContent).toContain('9 canonical components');
    expect(port.fit).toHaveBeenCalledOnce();
    await click('Программа');
    expect(metric('canonical-program')).toBeTruthy();
    expect(metric('canonical-stage')).toBe(stage);
    expect(stage.closest('[hidden]')).toBeNull();
    await click('Закрыть общий редактор');
    expect(metric('canonical-stage')).toBe(stage);
    expect(port.stageMounts).toBe(1);
    expect(port.stageUnmounts).toBe(0);
    expect(port.options).toEqual({
      runtimeInputEventLimit: 1000,
      reportSimulationDiagnostics: false,
    });
  });

  it('pauses and resumes the existing run, while serial buttons never move the robot directly', async () => {
    await click('Запустить');
    expect(port.toggle).toHaveBeenCalledTimes(1);
    expect(port.host?.simulationRunning).toBe(true);
    await click('Вперёд');
    await click('Влево');
    expect(port.serial).toHaveBeenNthCalledWith(1, 'uno', 'F');
    expect(port.serial).toHaveBeenNthCalledWith(2, 'uno', 'L');
    expect(metric('robotics-robot').getAttribute('data-x-meters')).toBe('0.25');
    expect(metric('robotics-time').dataset.microseconds).toBe('0');
    await click('Пауза');
    expect(port.host?.simulationRunning).toBe(true);
    expect(port.setRate).toHaveBeenLastCalledWith(0);
    expect(control('Вперёд').disabled).toBe(true);
    expect(container.textContent).toContain('Продолжите программу, чтобы отправить команду.');
    expect(port.reset).not.toHaveBeenCalled();
    await click('Продолжить');
    expect(port.setRate).toHaveBeenLastCalledWith(1);
    expect(port.toggle).toHaveBeenCalledTimes(1);
    await click('Сбросить');
    expect(port.reset).toHaveBeenCalledOnce();
    expect(port.host?.simulationRunning).toBe(false);
    expect(metric('robotics-time').dataset.microseconds).toBe('0');
  });

  it('moves only on a committed observation and sends distance without changing the saved source', async () => {
    await click('Сохранить');
    const source = port.host!.getCurrentDocument();
    await click('Запустить');
    const next = electricalObservation(100_000);
    act(() => port.presentation!.setObservation(next, true));
    expect(metric('robotics-time').dataset.microseconds).toBe('0');
    expect(port.sensor).not.toHaveBeenCalled();
    act(() => port.presentation!.commit(next));
    expect(metric('robotics-time').dataset.microseconds).toBe('100000');
    expect(Number(metric('robotics-robot').getAttribute('data-x-meters'))).toBeGreaterThan(0.25);
    expect(port.sensor).toHaveBeenCalledOnce();
    expect(port.sensor.mock.calls[0]?.[0]).toBe('sonar');
    expect(port.sensor.mock.calls[0]?.[1]).toBeGreaterThan(0.02);
    expect(port.host!.getCurrentDocument()).toBe(source);
    expect(port.host!.saveStatus).toBe('saved');
    await click('Пауза');
    act(() => port.presentation!.setObservation(electricalObservation(150_000)));
    // The last committed presentation may settle during pause; no input follows it.
    expect(metric('robotics-time').dataset.microseconds).toBe('150000');
    expect(port.sensor).toHaveBeenCalledOnce();
  });

  it('resets the world when the shared Arduino reset commits a new time-zero generation', async () => {
    await click('Запустить');
    act(() => port.presentation!.setObservation(electricalObservation(100_000)));
    expect(Number(metric('robotics-robot').getAttribute('data-x-meters'))).toBeGreaterThan(0.25);
    act(() => port.presentation!.setObservation(electricalObservation(0, 0, 0)));
    expect(metric('robotics-time').dataset.microseconds).toBe('0');
    expect(metric('robotics-robot').getAttribute('data-x-meters')).toBe('0.25');
  });

  it('halts on an exhausted input budget and requires reset rather than silent continuation', async () => {
    await click('Запустить');
    act(() => {
      port.budget = {
        limit: 1000,
        admitted: 1000,
        accepted: 999,
        pending: 0,
        inFlight: 1,
        exhausted: true,
      };
      port.host!.setNotice('Budget observation');
    });
    expect(port.setRate).toHaveBeenLastCalledWith(0);
    expect(metric('robotics-notice').textContent).toContain('Достигнут лимит');
    expect(control('Продолжить').disabled).toBe(true);
    expect(port.reset).not.toHaveBeenCalled();
    expect(metric('robotics-lab').dataset.inputAdmitted).toBe('1000');
  });

  it('shows a failed electrical observation and leaves the last trustworthy pose unchanged', async () => {
    await click('Запустить');
    act(() => port.presentation!.setObservation(electricalObservation(100_000)));
    const position = metric('robotics-robot').getAttribute('data-x-meters');
    const failed = electricalObservation(200_000);
    act(() =>
      port.presentation!.setObservation({
        ...failed,
        result: { ...failed.result, solved: false, status: 'unsupported' },
      }),
    );
    expect(metric('robotics-robot').getAttribute('data-x-meters')).toBe(position);
    expect(metric('robotics-notice').textContent).toContain(
      'Расчёт схемы не дал достоверного результата',
    );
    expect(port.setRate).toHaveBeenLastCalledWith(0);
  });
});
