/* @vitest-environment jsdom */
import { act, createElement, useEffect, useImperativeHandle, type Ref } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, type Project, type SchematicDocument, type SolveResult } from '../../api';
import type {
  ElectronicsWorkbenchController,
  ElectronicsWorkbenchProjectHost,
} from '../../electronics/use-electronics-workbench';
import type { ArduinoCodePanelHandle } from '../../electronics/ArduinoCodePanel';
import type { LiveSimulationInputBudget } from '../../electronics/live-simulation-worker-controller';
import type { SimulationStatusMessage } from '../../electronics/simulation-failure';
import {
  NativeOpticalPresentation,
  type NativeOpticalObservation,
} from '../../electronics/native-optical-presentation';
import { SimulationPacing } from '../../electronics/simulation-pacing';
import { configureProductionLibrary } from '../../electronics/production-manifest-adapter';
import { isProjectSnapshotConfirmed } from '../../modules/project-snapshot';
import { publicProjectsApi } from '../../projects-public/api';
import { createDefaultRoboticsProject, withRoboticsWorld } from '../robotics-project';
import { RoboticsEditor } from '../RoboticsEditor';
import { RoboticsLab, RoboticsWorkspace } from '../RoboticsLab';
import { useRoboticsProject } from '../use-robotics-project';

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
    keyboardShortcutsEnabled?: boolean;
  } | null,
  toggle: vi.fn<() => Promise<void>>(),
  reset: vi.fn<() => void>(),
  setRate: vi.fn<(rate: number) => void>(),
  serial: vi.fn<(boardId: string, text: string) => void>(),
  sensor: vi.fn<(componentId: string, distanceMeters: number) => boolean>(),
  environment: vi.fn<ElectronicsWorkbenchController['setRuntimeHcSr04EnvironmentSample']>(),
  fit: vi.fn<() => void>(),
  remove: vi.fn<() => void>(),
  stageMounts: 0,
  stageUnmounts: 0,
  programMounts: 0,
  programUnmounts: 0,
  programFlush: vi.fn<() => void>(),
  programPublish: null as ElectronicsWorkbenchController['updateArduinoProgram'] | null,
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
      setRuntimeHcSr04EnvironmentSample: port.environment,
      fitScene: port.fit,
      selection: null,
      removeSelection: port.remove,
      cancelFamilyPlacement: vi.fn(),
      setLibraryOpen: vi.fn(),
      libraryOpen: true,
      updateArduinoProgram: (
        ...[id, properties]: Parameters<ElectronicsWorkbenchController['updateArduinoProgram']>
      ) => {
        const current = host.getCurrentDocument()!;
        host.commitDocument({
          ...current,
          components: current.components.map((component) =>
            component.id === id
              ? { ...component, stateProperties: { ...component.stateProperties, ...properties } }
              : component,
          ),
        });
      },
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

vi.mock('../../electronics/WorkbenchSidebars', () => ({
  WorkbenchSidebars: () =>
    createElement('aside', { 'data-testid': 'canonical-library' }, 'Общий каталог'),
}));

vi.mock('../../electronics/ArduinoCodePanel', () => ({
  ArduinoCodePanel: ({
    open,
    onClose,
    controller,
    programHandleRef,
  }: {
    open: boolean;
    onClose: () => void;
    controller: ElectronicsWorkbenchController;
    programHandleRef?: Ref<ArduinoCodePanelHandle>;
  }) => {
    port.programPublish = controller.updateArduinoProgram;
    useEffect(() => {
      port.programMounts += 1;
      return () => {
        port.programUnmounts += 1;
      };
    }, []);
    useImperativeHandle(programHandleRef, () => ({
      flushPendingPublication: () => port.programFlush(),
      revealProgramStart: () => {},
    }));
    return createElement(
      'section',
      { 'data-testid': 'canonical-program', hidden: !open },
      createElement('button', { type: 'button', onClick: onClose }, 'Закрыть общий редактор'),
    );
  },
}));

// JSDOM has no SVG rasterizer. Keep the real source-preview registration,
// capture, timers, acknowledgement and publication flow around this boundary.
vi.mock('../../modules/svg-snapshot', () => ({
  rasteriseSvgStage: async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 120;
    canvas.height = 360;
    return canvas;
  },
}));

let root: Root;
let container: HTMLDivElement;
let accountEditorCount = 0;
const originalScrollIntoView = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'scrollIntoView',
);

function control(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(
    (button) =>
      button.getAttribute('aria-label') === label ||
      (!button.hasAttribute('aria-label') && button.textContent?.includes(label)),
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

async function mountAccountEditor() {
  act(() => root.unmount());
  root = createRoot(container);
  const project: Project = {
    id: `64d1b8a0-4500-4000-8000-${String(++accountEditorCount).padStart(12, '0')}`,
    scope: 'personal',
    classroomId: null,
    moduleKey: 'robotics',
    title: 'Публикуемый робот',
    status: 'active',
    createdAt: '2026-11-05T12:00:00Z',
    updatedAt: '2026-11-05T12:00:00Z',
    preview: null,
    snapshotRevision: null,
    copiedFrom: null,
  };
  vi.spyOn(api, 'openProject').mockResolvedValue({
    ok: true,
    status: 200,
    data: {
      project,
      draft: {
        projectId: project.id,
        document: createDefaultRoboticsProject(),
        revision: 1,
        updatedAt: project.updatedAt,
      },
      versions: [],
      result: null,
    },
  });
  vi.spyOn(api, 'accountAvatar').mockResolvedValue({
    ok: true,
    status: 200,
    data: { avatarDataUrl: null },
  });
  const snapshot = vi
    .spyOn(api, 'saveProjectSnapshot')
    .mockImplementation(async (projectId, _image, sourceRevision) => ({
      ok: true,
      status: 200,
      data: {
        snapshot: {
          projectId,
          sourceRevision,
          contentType: 'image/webp',
          width: 480,
          height: 360,
          capturedAt: project.updatedAt,
        },
      },
    }));
  const publication = vi.spyOn(publicProjectsApi, 'status').mockResolvedValue({
    ok: true,
    status: 200,
    data: { publication: null, canPublish: true, reasonCode: null },
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    fillStyle: '',
    fillRect: vi.fn(),
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
    'data:image/webp;base64,c25hcHNob3Q=',
  );
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
  await act(async () => {
    root.render(
      createElement(RoboticsEditor, {
        projectId: project.id,
        user: {
          id: '64d1b8a0-4500-4000-8000-000000000099',
          identityKind: 'account',
          displayName: 'Автор',
          email: 'author@isolated.test',
        },
        onBack: vi.fn(),
      }),
    );
  });
  const svg = metric('robotics-source-preview').querySelector('svg')!;
  const [x, y, width, height] = svg.getAttribute('viewBox')!.split(/\s+/).map(Number);
  Object.defineProperty(svg, 'viewBox', { value: { baseVal: { x, y, width, height } } });
  return { project, snapshot, publication };
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
  port.programMounts = 0;
  port.programUnmounts = 0;
  port.programPublish = null;
  port.programFlush.mockReset();
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
  port.environment.mockReturnValue(true);
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
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (originalScrollIntoView)
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScrollIntoView);
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
});

describe('robotics UI integration with the common workbench port', () => {
  it('keeps one workbench header, equal-section tab semantics, Save near title and avatar at the right', async () => {
    await mountAccountEditor();
    const header = container.querySelector<HTMLElement>('.robotics-lab > .robotics-unified-header');
    expect(header).not.toBeNull();
    expect(header?.classList.contains('workbench-header')).toBe(true);
    expect(container.querySelectorAll('.robotics-lab > header')).toHaveLength(1);
    expect(container.querySelector('.robotics-lab > .robotics-tabs')).toBeNull();
    expect(header?.querySelector('.workbench-brand-mark')).not.toBeNull();
    expect(header?.querySelector('.robotics-header-module-icon svg')).not.toBeNull();
    expect(
      header?.querySelector<HTMLInputElement>('input[aria-label="Название проекта"]')?.value,
    ).toBe('Публикуемый робот');
    const tabs = [...header!.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(tabs.map((tab) => tab.getAttribute('aria-label'))).toEqual([
      'Поле',
      'Робот',
      'Электроника',
      'Код',
    ]);
    expect(tabs.every((tab) => tab.querySelector('svg') !== null)).toBe(true);
    const save = header!.querySelector<HTMLButtonElement>('.robotics-header-save');
    expect(save?.getAttribute('aria-label')).toBe('Сохранить');
    expect(save?.getAttribute('role')).not.toBe('tab');
    expect(save?.parentElement).toBe(header);
    expect(save?.nextElementSibling).toBe(header!.querySelector('.robotics-header-notice'));
    expect(header!.querySelector('.robotics-header-notice')?.nextElementSibling).toBe(
      header!.querySelector('.robotics-header-controls'),
    );
    expect(header!.querySelector('.robotics-header-controls')?.lastElementChild).toBe(
      header!.querySelector('.robotics-header-profile'),
    );
    expect(header!.querySelector('.robotics-header-avatar img')).not.toBeNull();
    expect(header!.querySelector('[data-testid="robotics-notice"]')).not.toBeNull();
    expect(container.querySelector('.robotics-lab > .robotics-notice')).toBeNull();
    expect(header!.querySelector('.robotics-header-menu-panel')?.textContent).toContain(
      'Публикация',
    );
    expect(header!.querySelector('.robotics-header-menu-panel')?.textContent).toContain(
      'Мои проекты',
    );
    for (const [index, section] of ['field', 'robot', 'electronics', 'program'].entries()) {
      await act(async () => tabs[index]!.click());
      expect(tabs[index]!.getAttribute('aria-selected')).toBe('true');
      expect(container.querySelectorAll('[role="tabpanel"]:not([hidden])')).toHaveLength(1);
      expect(container.querySelector('#robotics-panel-' + section)?.hasAttribute('hidden')).toBe(
        false,
      );
    }
    await click('Сохранить');
    expect(header!.querySelector('.robotics-header-save')).toBe(save);
  });

  it('does not upload thumbnails on idle/manual Save; publishes one confirmed thumbnail on demand', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    const { project, snapshot, publication } = await mountAccountEditor();
    await click('Сохранить');
    await act(async () => vi.advanceTimersByTimeAsync(125_000));
    expect(snapshot).not.toHaveBeenCalled();
    expect(isProjectSnapshotConfirmed(project.id, 1)).toBe(false);

    await click('Публикация');
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(snapshot.mock.calls[0]?.[2]).toBe(1);
    expect(isProjectSnapshotConfirmed(project.id, 1)).toBe(true);
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain('Публикация проекта');
    expect(container.querySelector('[data-testid="publication-publish"]')).not.toBeNull();
    expect(publication).toHaveBeenCalledWith(project.id);
    expect(container.textContent).not.toContain('Не удалось подготовить изображение');
  });

  it('keeps publication closed when the current snapshot was not acknowledged', async () => {
    const { project, snapshot, publication } = await mountAccountEditor();
    snapshot.mockResolvedValue({
      ok: false,
      status: 500,
      error: { code: 'request_failed', message: 'Failed' },
    });
    await click('Публикация');
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(isProjectSnapshotConfirmed(project.id, 1)).toBe(false);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(publication).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Не удалось подготовить изображение');
  });

  it('retains a newer program and refuses publication when an old snapshot acknowledgement arrives', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    const { project, snapshot, publication } = await mountAccountEditor();
    let acknowledge!: () => void;
    const waiting = new Promise<void>((resolve) => {
      acknowledge = resolve;
    });
    const success = snapshot.getMockImplementation()!;
    snapshot.mockImplementationOnce(async (...args) => {
      await waiting;
      return success(...args);
    });
    await click('Публикация');
    expect(snapshot).toHaveBeenCalledTimes(1);
    const source = 'void setup(){} void loop(){delay(91);}';
    const circuit = port.host!.getCurrentDocument()!;
    act(() =>
      port.host!.commitDocument({
        ...circuit,
        components: circuit.components.map((part) =>
          part.id === 'uno'
            ? { ...part, stateProperties: { ...part.stateProperties, arduinoSource: source } }
            : part,
        ),
      }),
    );
    await act(async () => acknowledge());
    expect(isProjectSnapshotConfirmed(project.id, 1)).toBe(false);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(publication).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Не удалось подготовить изображение');
    expect(
      port.host!.getCurrentDocument()!.components.find((part) => part.id === 'uno')!.stateProperties
        ?.arduinoSource,
    ).toBe(source);
  });

  it('hosts the same program editor in an account project and flushes it to Project Core without opening standalone storage', async () => {
    act(() => root.unmount());
    root = createRoot(container);
    const read = vi.spyOn(Storage.prototype, 'getItem');
    const project: Project = {
      id: '64d1b8a0-4500-4000-8000-000000000001',
      scope: 'personal',
      classroomId: null,
      moduleKey: 'robotics',
      title: 'Проект аккаунта',
      status: 'active',
      createdAt: '2026-11-05T12:00:00Z',
      updatedAt: '2026-11-05T12:00:00Z',
      preview: null,
      snapshotRevision: null,
      copiedFrom: null,
    };
    const opened = {
      project,
      draft: {
        projectId: project.id,
        document: createDefaultRoboticsProject(),
        revision: 1,
        updatedAt: project.updatedAt,
      },
      versions: [],
    };
    const save = vi
      .spyOn(api, 'saveDraft')
      .mockImplementation(async (projectId, document, revision) => ({
        ok: true,
        status: 200,
        data: {
          draft: { projectId, document, revision: revision + 1, updatedAt: project.updatedAt },
          result: null,
        },
      }));
    let account!: ReturnType<typeof useRoboticsProject>;
    function AccountHarness() {
      account = useRoboticsProject(opened, '64d1b8a0-4500-4000-8000-000000000002');
      return createElement(RoboticsWorkspace, {
        project: account,
        projectId: project.id,
        header: (tabs) => createElement('header', null, project.title, tabs),
      });
    }
    act(() => root.render(createElement(AccountHarness)));
    await click('Код');
    const source = 'void setup(){} void loop(){delay(43);}';
    port.programFlush.mockImplementation(() =>
      port.programPublish!('uno', { arduinoSource: source }),
    );
    await act(async () => {
      expect(await account.saveAll()).toBe(true);
    });
    expect(port.host?.project?.id).toBe(project.id);
    expect(port.host?.saveStatus).toBe('saved');
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]![0]).toBe(project.id);
    expect(
      account.getCurrentProject().circuit.components.find((part) => part.id === 'uno')!
        .stateProperties?.arduinoSource,
    ).toBe(source);
    expect(read.mock.calls.some(([key]) => key === 'asa-lab:robotics:local-project:v1')).toBe(
      false,
    );
    expect(container.textContent).toContain('Проект аккаунта');
    expect(container.textContent).not.toContain('Сохранено на устройстве');
  });
  it('keeps the same mounted canonical stage when opening and closing the canonical programmer', async () => {
    const stage = metric('canonical-stage');
    expect(stage.textContent).toContain('9 canonical components');
    expect(port.fit).toHaveBeenCalledOnce();
    await click('Код');
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
      // Closing fullscreen Code returns to Electronics.
      keyboardShortcutsEnabled: true,
    });
  });

  it('changes the active page, gates scheme keyboard commands and keeps the same observation stage', async () => {
    const stage = metric('canonical-stage');
    for (const [name, id] of [
      ['Электроника', 'electronics'],
      ['Код', 'program'],
      ['Робот', 'robot'],
      ['Поле', 'field'],
    ]) {
      const tab = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
        (item) => item.textContent === name,
      )!;
      await act(async () => tab.click());
      expect(container.querySelector(`#robotics-panel-${id}`)?.hasAttribute('hidden')).toBe(false);
      expect(container.querySelectorAll('[role="tabpanel"]:not([hidden])')).toHaveLength(1);
      expect(document.activeElement).toBe(tab);
      expect(port.options?.keyboardShortcutsEnabled).toBe(id === 'electronics');
      expect(metric('canonical-stage')).toBe(stage);
      expect(stage.closest('[hidden]')).toBeNull();
    }
    expect(port.stageMounts).toBe(1);
    expect(port.stageUnmounts).toBe(0);
  });

  it('resynchronizes direct host history and rejects stale editor flush/publication in the same event', async () => {
    await click('Код');
    const original = port.host!.getCurrentDocument()!;
    const publishFromOldEditor = port.programPublish!;
    const changedSource = 'void setup(){} void loop(){delay(37);}';
    act(() => publishFromOldEditor('uno', { arduinoSource: changedSource }));
    expect(port.programMounts).toBe(1);
    port.programFlush.mockImplementation(() =>
      publishFromOldEditor('uno', { arduinoSource: changedSource }),
    );
    await act(async () => {
      expect(port.host!.undo()).toBe(true);
      // A retained debounce and Save may run before React disposes the old panel.
      publishFromOldEditor('uno', { arduinoSource: changedSource });
      control('Сохранить').click();
      expect(port.host!.getCurrentDocument()).toEqual(original);
    });
    expect(port.programMounts).toBe(2);
    expect(port.programUnmounts).toBe(1);
    expect(port.host!.canRedo).toBe(true);
    expect(JSON.parse(localStorage.getItem('asa-lab:robotics:local-project:v1')!).circuit).toEqual(
      original,
    );
    await act(async () => {
      expect(port.host!.redo()).toBe(true);
      control('Сохранить').click();
    });
    expect(port.programMounts).toBe(3);
    expect(
      JSON.parse(
        localStorage.getItem('asa-lab:robotics:local-project:v1')!,
      ).circuit.components.find((component: { id: string }) => component.id === 'uno')
        .stateProperties.arduinoSource,
    ).toBe(changedSource);
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

  it('applies the new-run pace after the host starts and preserves pause across navigation', async () => {
    const commands: { rate: number; running: boolean }[] = [];
    port.setRate.mockImplementation((rate) => {
      commands.push({ rate, running: port.host?.simulationRunning ?? false });
      port.pacing!.request(rate);
      if (rate === 0) port.pacing!.settlePause();
    });
    await click('Запустить');
    expect(commands.at(-1)).toEqual({ rate: 1, running: true });
    act(() => port.presentation!.setObservation(electricalObservation(100_000)));
    expect(Number(metric('robotics-robot').getAttribute('data-x-meters'))).toBeGreaterThan(0.25);
    await click('Пауза');
    const pausedCommandCount = commands.length;
    act(() => container.querySelector<HTMLButtonElement>('#robotics-tab-robot')!.click());
    act(() => container.querySelector<HTMLButtonElement>('#robotics-tab-field')!.click());
    expect(commands).toHaveLength(pausedCommandCount);
    expect(port.pacing!.read().phase).toBe('paused');
    await click('Остановить');
    expect(metric('robotics-robot').getAttribute('data-x-meters')).toBe('0.25');
    expect(metric('robotics-time').dataset.microseconds).toBe('0');
    await click('Запустить');
    expect(commands.at(-1)).toEqual({ rate: 1, running: true });
    await click('Пауза');
    await click('Сбросить');
    await click('Запустить');
    expect(commands.at(-1)).toEqual({ rate: 1, running: true });
  });

  it('moves only on a committed observation and sends distance without changing the saved source', async () => {
    await click('Сохранить');
    const source = port.host!.getCurrentDocument();
    await click('Запустить');
    const next = electricalObservation(100_000);
    act(() => port.presentation!.setObservation(next, true));
    expect(metric('robotics-time').dataset.microseconds).toBe('0');
    expect(port.environment).not.toHaveBeenCalled();
    act(() => port.presentation!.commit(next));
    expect(metric('robotics-time').dataset.microseconds).toBe('100000');
    expect(Number(metric('robotics-robot').getAttribute('data-x-meters'))).toBeGreaterThan(0.25);
    expect(port.environment).toHaveBeenCalledOnce();
    expect(port.environment.mock.calls[0]?.[0]).toBe('sonar');
    expect(port.environment.mock.calls[0]?.[1]).toMatchObject({
      kind: 'echo',
      distanceMeters: expect.any(Number),
    });
    const sample = port.environment.mock.calls[0]![1];
    expect(sample.kind === 'echo' && sample.distanceMeters > 0.02).toBe(true);
    expect(port.host!.getCurrentDocument()).toBe(source);
    expect(port.host!.saveStatus).toBe('saved');
    await click('Пауза');
    act(() => port.presentation!.setObservation(electricalObservation(150_000)));
    // The last committed presentation may settle during pause; no input follows it.
    expect(metric('robotics-time').dataset.microseconds).toBe('150000');
    expect(port.environment).toHaveBeenCalledOnce();
  });

  it('resets the world when the shared Arduino reset commits a new time-zero generation', async () => {
    await click('Запустить');
    act(() => port.presentation!.setObservation(electricalObservation(100_000)));
    expect(Number(metric('robotics-robot').getAttribute('data-x-meters'))).toBeGreaterThan(0.25);
    act(() => port.presentation!.setObservation(electricalObservation(0, 0, 0)));
    expect(metric('robotics-time').dataset.microseconds).toBe('0');
    expect(metric('robotics-robot').getAttribute('data-x-meters')).toBe('0.25');
  });
  it('reports a six-metre field as typed no-echo without halting or changing saved source', async () => {
    act(() => root.unmount());
    root = createRoot(container);
    const initial = createDefaultRoboticsProject();
    const source = withRoboticsWorld(initial, {
      ...initial.world,
      field: { ...initial.world.field, widthMeters: 6, obstacles: [] },
    });
    act(() => root.render(createElement(RoboticsLab, { initialProject: source })));
    const circuit = port.host!.getCurrentDocument();
    await click('Запустить');
    act(() => port.presentation!.setObservation(electricalObservation(100_000)));
    expect(port.environment).toHaveBeenCalledExactlyOnceWith('sonar', { kind: 'no-echo' });
    expect(port.sensor).not.toHaveBeenCalled();
    expect(port.pacing!.read().phase).toBe('running');
    expect(port.host!.getCurrentDocument()).toBe(circuit);
    expect(metric('robotics-time').dataset.microseconds).toBe('100000');
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
    expect(metric('robotics-notice').closest('.robotics-unified-header')).not.toBeNull();
    expect(metric('robotics-notice').hasAttribute('hidden')).toBe(false);
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
