/* @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { api, type Project, type SchematicDocument } from '../../api';
import { readLocalProjectDraft } from '../../modules/project-local-draft';
import { ArduinoCodePanel, type ArduinoCodePanelHandle } from '../ArduinoCodePanel';
import {
  configureProductionLibrary,
  type OwnerCatalogManifest,
} from '../production-manifest-adapter';
import { normalizeLoadedDocument } from '../use-workbench-project-state';
import { useElectronicsWorkbench } from '../use-electronics-workbench';
import * as S from 'scratch-blocks';
import { registerArduinoBlocks, generateArduinoCode } from '../arduino-blocks';

const injected = vi.hoisted(() => ({
  workspace: null as unknown,
  mounts: 0,
  savedGeometry: false,
}));
// Production emits these pinned media as files; Vitest otherwise inlines SVG.
vi.mock('../../../node_modules/scratch-blocks/media/zoom-in.svg?url', () => ({
  default: 'http://localhost/assets/arduino-blockly/zoom-in.svg',
}));
// Only the SVG renderer/geometry is substituted. Blocks, generation, settings,
// controller, document/local persistence, save queue and scheduler are production.
vi.mock('scratch-blocks', async (original) => {
  const actual = await original<typeof import('scratch-blocks')>();
  return {
    ...actual,
    svgResize: () => undefined,
    inject: () => {
      const workspace = new actual.Workspace();
      const create = workspace.newBlock.bind(workspace);
      workspace.newBlock = (...args) =>
        Object.assign(create(...args), {
          getSvgRoot: () => null,
          initSvg: () => undefined,
          render: () => undefined,
          ...(injected.savedGeometry ? {} : { getRelativeToSurfaceXY: () => ({ x: 1000, y: 0 }) }),
        });
      Object.assign(workspace, {
        scale: injected.savedGeometry ? 0.72 : 1,
        getFlyout: () => null,
        updateToolbox: () => undefined,
        registerButtonCallback: () => undefined,
      });
      injected.workspace = workspace;
      injected.mounts += 1;
      return workspace;
    },
  };
});

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
    ) as OwnerCatalogManifest,
  );
  initialDocument = normalizeLoadedDocument(fixtureDocument);
});

const source = (name: string) => `// ${name}\nvoid setup(){}\nvoid loop(){delay(10);}\n`;
const board = (id: string): SchematicDocument['components'][number] => ({
  id,
  kind: 'visual',
  componentTypeId: 'arduino-uno',
  variantId: 'arduino-uno',
  name: id,
  position: { x: 100, y: 100 },
  value: 5,
  stateProperties: {
    arduinoCodeMode: 'text',
    arduinoSource: source(id),
    arduinoWorkspace: '{"blocks":{"blocks":[]}}',
    arduinoSerialOpen: true,
    arduinoBaudRate: 115200,
    ownerField: 'preserved',
  },
});
const fixtureDocument: SchematicDocument = {
  schemaVersion: 4,
  components: [
    board('uno-a'),
    board('uno-b'),
    {
      id: 'resistor',
      kind: 'resistor',
      componentTypeId: 'resistor-axial',
      variantId: 'resistor-axial',
      name: 'R1',
      value: 220,
      position: { x: 300, y: 100 },
    },
  ],
  connections: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  simulation: { running: false, maxIterations: 24 },
};
let initialDocument: SchematicDocument;
const userId = 'sketch-durability-user';

let host: HTMLDivElement | null = null;
let root: Root | null = null;
let current: ReturnType<typeof useElectronicsWorkbench> | null = null;
let stored: Map<string, SchematicDocument>;
let exposeProgramHandle = false;
const programHandle: { current: ArduinoCodePanelHandle | null } = { current: null };

function controller() {
  if (!current) throw new Error('Controller has not rendered');
  return current;
}

function Probe({ projectId }: { projectId: string }) {
  current = useElectronicsWorkbench(projectId, userId);
  return current.status === 'ready'
    ? createElement(ArduinoCodePanel, {
        controller: current,
        open: true,
        drawerWidth: 700,
        onDrawerWidthChange: () => undefined,
        mobileHeightPercent: 60,
        onMobileHeightChange: () => undefined,
        onClose: () => undefined,
        ...(exposeProgramHandle ? { programHandleRef: programHandle } : {}),
      })
    : null;
}

async function mount(projectId: string) {
  host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  await act(async () => root!.render(createElement(Probe, { projectId })));
  expect(controller().status).toBe('ready');
}

async function prepare(document?: SchematicDocument) {
  initialDocument = document ?? normalizeLoadedDocument(fixtureDocument);
  vi.useFakeTimers({
    toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
  });
  vi.setSystemTime(0);
  localStorage.clear();
  stored = new Map();
  vi.spyOn(api, 'me').mockResolvedValue({
    ok: true,
    status: 200,
    data: { authenticated: true, user: { id: userId } },
  } as Awaited<ReturnType<typeof api.me>>);
  let revision = 1;
  vi.spyOn(api, 'openProject').mockImplementation(
    async (projectId) =>
      ({
        ok: true,
        status: 200,
        data: {
          project: {
            id: projectId,
            moduleKey: 'electronics',
            title: projectId,
            scope: 'personal',
            classroomId: null,
            status: 'active',
          } as Project,
          draft: {
            projectId,
            document: stored.get(projectId) ?? structuredClone(initialDocument),
            revision,
            updatedAt: '',
          },
          versions: [],
          result: null,
        },
      }) as Awaited<ReturnType<typeof api.openProject>>,
  );
  const save = vi.spyOn(api, 'saveDraft').mockImplementation(async (projectId, next) => {
    stored.set(projectId, structuredClone(next as SchematicDocument));
    return {
      ok: true,
      status: 200,
      data: {
        draft: { projectId, document: next, revision: ++revision, updatedAt: '' },
        result: null,
      },
    } as Awaited<ReturnType<typeof api.saveDraft>>;
  });
  await mount('first');
  return save;
}

function input(text: string) {
  const textarea = host!.querySelector<HTMLTextAreaElement>('[aria-label="Код Arduino C++"]')!;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
    textarea,
    text,
  );
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function switchBoard(id: string) {
  const select = host!.querySelector<HTMLSelectElement>('[aria-label="Программируемая плата"]')!;
  select.value = id;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

function localDocument(projectId = 'first') {
  return readLocalProjectDraft<SchematicDocument>(localStorage, projectId, 'electronics', userId)
    ?.document;
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  host?.remove();
  host = null;
  current = null;
  localStorage.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  injected.workspace = null;
  injected.mounts = 0;
  injected.savedGeometry = false;
  exposeProgramHandle = false;
  programHandle.current = null;
});

describe('latest visible Arduino text is canonical before save or departure', () => {
  it('writes the complete latest document locally and saves immediately with no input HTTP', async () => {
    const save = await prepare();
    act(() => controller().selectComponent('resistor', false));
    // Use the same render for the resistor and input; the source merge must
    // read the latest document ref instead of overwriting the resistor change.
    act(() => {
      controller().updateSelectedValue(333.3);
      input(source('latest'));
    });
    const expected = {
      ...initialDocument,
      components: initialDocument.components.map((component) =>
        component.id === 'uno-a'
          ? {
              ...component,
              stateProperties: { ...component.stateProperties, arduinoSource: source('latest') },
            }
          : component.id === 'resistor'
            ? { ...component, value: 333.3 }
            : component,
      ),
    };
    expect(Date.now()).toBe(0);
    expect(localDocument()).toEqual(expected);
    expect(save).not.toHaveBeenCalled();
    await act(async () => controller().saveNow());
    expect(save).toHaveBeenCalledTimes(1);
    expect(stored.get('first')).toEqual(expected);
  });

  it('retains both boards through rapid edits and selection changes without delayed writes', async () => {
    const save = await prepare();
    act(() => input(source('A latest')));
    act(() => switchBoard('uno-b'));
    act(() => input(source('B latest')));
    act(() => switchBoard('uno-a'));
    expect(host!.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe(source('A latest'));
    expect(
      localDocument()
        ?.components.filter((entry) => entry.id.startsWith('uno'))
        .map((entry) => entry.stateProperties?.['arduinoSource']),
    ).toEqual([source('A latest'), source('B latest')]);
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(controller().document).toEqual(localDocument());
    expect(save).not.toHaveBeenCalled();
  });

  it('does not resurrect a deleted board or overwrite the remaining board after input', async () => {
    const save = await prepare();
    act(() => controller().selectComponent('uno-a', false));
    act(() => {
      input(source('deleted A'));
      controller().removeSelection();
    });
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(controller().document?.components.some((entry) => entry.id === 'uno-a')).toBe(false);
    expect(
      controller().document?.components.find((entry) => entry.id === 'uno-b')?.stateProperties,
    ).toEqual(initialDocument.components[1]!.stateProperties);
    expect(save).not.toHaveBeenCalled();
  });

  it('flushes the last source on immediate unmount and never mutates the next project', async () => {
    const save = await prepare();
    act(() => input(source('first last input')));
    await act(async () => root!.unmount());
    root = null;
    host!.remove();
    expect(Date.now()).toBe(0);
    expect(save).toHaveBeenCalledTimes(1);
    expect(stored.get('first')?.components[0]?.stateProperties?.['arduinoSource']).toBe(
      source('first last input'),
    );
    await mount('second');
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(controller().document).toEqual(initialDocument);
    expect(localDocument('second')).toBeUndefined();
    expect(save.mock.calls.map(([id]) => id)).toEqual(['first']);
    await act(async () => root!.unmount());
    root = null;
    host!.remove();
    await mount('first');
    expect(host!.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe(
      source('first last input'),
    );
  });

  it('keeps the one-minute autosave cadence with no per-keystroke request', async () => {
    const save = await prepare();
    act(() => input(source('minute first')));
    act(() => input(source('minute latest')));
    await act(async () => vi.advanceTimersByTimeAsync(59_999));
    expect(save).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(save).toHaveBeenCalledTimes(1);
    expect(stored.get('first')?.components[0]?.stateProperties?.['arduinoSource']).toBe(
      source('minute latest'),
    );
  });
});

function clickButton(label: string) {
  const button = [...host!.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
  if (!button) throw new Error(`Missing button ${label}`);
  button.click();
}
function openInputSettings() {
  host!.querySelector<HTMLElement>('.arduino-mode-menu > summary')!.click();
  clickButton('Настройки Arduino');
}
function inputPort(pin: string) {
  return host!.querySelector<HTMLInputElement>(`[aria-label="Входной порт ${pin}"]`)!;
}
function blockSettingsDocument() {
  registerArduinoBlocks();
  S.Events.disable();
  const workspace = new S.Workspace();
  try {
    const setup = workspace.newBlock('asa_setup');
    const assign = workspace.newBlock('asa_var_set');
    assign.setFieldValue(workspace.getVariableMap().createVariable('button').getId(), 'NAME');
    setup.getInput('DO')!.connection!.connect(assign.previousConnection!);
    const reading = workspace.newBlock('asa_digital_read');
    assign.getInput('VALUE')!.connection!.connect(reading.outputConnection!);
    const pin = workspace.newBlock('asa_number');
    pin.setFieldValue('2', 'VALUE');
    reading.getInput('PIN')!.connection!.connect(pin.outputConnection!);
    const write = workspace.newBlock('asa_digital_write');
    assign.nextConnection!.connect(write.previousConnection!);
    const outputPin = workspace.newBlock('asa_number');
    outputPin.setFieldValue('13', 'VALUE');
    write.getInput('PIN')!.connection!.connect(outputPin.outputConnection!);
    return normalizeLoadedDocument({
      ...fixtureDocument,
      components: fixtureDocument.components.map((component) =>
        component.id === 'uno-a'
          ? {
              ...component,
              stateProperties: {
                ...component.stateProperties,
                arduinoCodeMode: 'blocks',
                arduinoWorkspace: JSON.stringify(S.serialization.workspaces.save(workspace)),
                arduinoSource: generateArduinoCode(workspace),
              },
            }
          : component,
      ),
    });
  } finally {
    workspace.dispose();
    S.Events.enable();
  }
}
function stubSvgSurface() {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
}

describe('per-board Arduino input settings', () => {
  it('preserves saved block coordinates inside the desktop flyout boundary through Apply and Save', async () => {
    stubSvgSurface();
    injected.savedGeometry = true;
    const document = blockSettingsDocument();
    const properties = document.components[0]!.stateProperties!;
    const saved = {
      blocks: {
        languageVersion: 0,
        blocks: [
          { type: 'asa_setup', id: 'saved-setup', x: 365, y: 84 },
          { type: 'asa_loop', id: 'saved-loop', x: 494, y: 120 },
        ],
      },
    };
    properties['arduinoWorkspace'] = JSON.stringify(saved);
    await prepare(document);
    const live = injected.workspace as S.Workspace;
    expect(live.getTopBlocks(false)[0]!.getRelativeToSurfaceXY()).toMatchObject({ x: 365, y: 84 });
    expect(S.serialization.workspaces.save(live)).toEqual(saved);
    act(() => openInputSettings());
    act(() => inputPort('A5').click());
    act(() => clickButton('Применить'));
    expect(
      JSON.parse(
        String(controller().document!.components[0]!.stateProperties!['arduinoWorkspace']),
      ),
    ).toEqual(saved);
    await act(async () => controller().saveNow());
    expect(
      JSON.parse(String(stored.get('first')!.components[0]!.stateProperties!['arduinoWorkspace'])),
    ).toEqual(saved);
  });

  it('cancels drafts, restores focus, keeps text verbatim and saves independent board lists', async () => {
    await prepare();
    const before = controller().document;
    act(() => openInputSettings());
    expect(host!.querySelector('[role="dialog"][aria-label="Настройки Arduino"]')).not.toBeNull();
    act(() => inputPort('2').click());
    act(() => clickButton('Отмена'));
    expect(controller().document).toBe(before);
    expect(document.activeElement?.textContent).toBe('Настройки Arduino');
    act(() => openInputSettings());
    expect(inputPort('2').checked).toBe(false);
    act(() => inputPort('A0').click());
    act(() => clickButton('Применить'));
    expect(controller().document?.components[0]!.stateProperties?.['arduinoInputPins']).toEqual([
      'A0',
    ]);
    expect(controller().document?.components[0]!.stateProperties?.['arduinoSource']).toBe(
      source('uno-a'),
    );
    act(() => controller().undo());
    act(() => openInputSettings());
    expect(inputPort('A0').checked).toBe(false);
    act(() =>
      host!
        .querySelector('[role="dialog"]')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
    );
    act(() => controller().redo());
    act(() => switchBoard('uno-b'));
    act(() => openInputSettings());
    expect(inputPort('A0').checked).toBe(false);
    act(() => inputPort('3').click());
    act(() => clickButton('Применить'));
    await act(async () => controller().saveNow());
    expect(
      stored
        .get('first')!
        .components.slice(0, 2)
        .map((b) => b.stateProperties?.['arduinoInputPins']),
    ).toEqual([['A0'], ['3']]);
    act(() => switchBoard('uno-a'));
    act(() => openInputSettings());
    expect(inputPort('A0').checked).toBe(true);
    act(() => clickButton('Отмена'));
    expect(host!.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe(source('uno-a'));
  });

  it('atomically changes generated modes and settings through Undo/Redo without remounting blocks', async () => {
    stubSvgSurface();
    await prepare(blockSettingsDocument());
    const live = injected.workspace;
    const mounts = injected.mounts;
    const before = controller().document!.components[0]!.stateProperties!;
    act(() => openInputSettings());
    expect(inputPort('2').checked).toBe(true);
    expect(inputPort('2').disabled).toBe(true);
    act(() => inputPort('A5').click());
    expect(controller().document?.components[0]!.stateProperties).toBe(before);
    act(() => clickButton('Применить'));
    const after = controller().document!.components[0]!.stateProperties!;
    expect(after['arduinoInputPins']).toEqual(['A5']);
    expect(after['arduinoSource']).toContain('pinMode(A5, INPUT);');
    expect(after['arduinoWorkspace']).toBe(before['arduinoWorkspace']);
    expect(injected.workspace).toBe(live);
    expect(injected.mounts).toBe(mounts);
    act(() => controller().undo());
    expect(controller().document?.components[0]!.stateProperties).toEqual(before);
    act(() => controller().redo());
    expect(controller().document?.components[0]!.stateProperties).toEqual(after);
    expect(injected.workspace).toBe(live);
    await act(async () => controller().saveNow());
    expect(stored.get('first')!.components[0]!.stateProperties).toEqual(after);
  });

  it('flushes the latest live blocks before Apply and cannot republish a stale config after Undo', async () => {
    stubSvgSurface();
    await prepare(blockSettingsDocument());
    const live = injected.workspace as S.Workspace;
    const write = live.getBlocksByType('asa_digital_write', false)[0]!;
    act(() => write.getInputTargetBlock('PIN')!.setFieldValue('12', 'VALUE'));
    await act(async () => vi.advanceTimersByTimeAsync(0));
    // Still inside the production 180-ms block publication debounce.
    expect(controller().document?.components[0]!.stateProperties?.['arduinoSource']).toContain(
      'digitalWrite(13, HIGH);',
    );
    act(() => openInputSettings());
    act(() => inputPort('A5').click());
    act(() => clickButton('Применить'));
    const configured = controller().document!.components[0]!.stateProperties!;
    expect(configured['arduinoSource']).toContain('digitalWrite(12, HIGH);');
    expect(configured['arduinoSource']).toContain('pinMode(A5, INPUT);');
    expect(configured['arduinoWorkspace']).toBe(
      JSON.stringify(S.serialization.workspaces.save(live)),
    );
    act(() => controller().undo());
    const undone = controller().document!.components[0]!.stateProperties!;
    expect(undone['arduinoSource']).toContain('digitalWrite(12, HIGH);');
    expect(undone['arduinoSource']).toContain('pinMode(A5, OUTPUT);');
    await act(async () => vi.advanceTimersByTimeAsync(180));
    expect(controller().document?.components[0]!.stateProperties).toEqual(undone);
    expect(injected.workspace).toBe(live);
  });
});

describe('unchanged Arduino publication preserves canonical persistence state', () => {
  it('keeps a saved document clean through repeated publication and departure', async () => {
    const save = await prepare();
    const saved = controller().document;
    const epoch = controller().documentMutationEpoch();
    expect(saved).toEqual(initialDocument);
    expect(controller().saveStatus).toBe('saved');
    expect(controller().canUndo).toBe(false);
    expect(controller().canRedo).toBe(false);
    expect(localDocument()).toBeUndefined();
    expect(localStorage.getItem('asa-project-local-draft:first')).toBeNull();
    act(() => {
      controller().updateArduinoProgram('uno-a', {
        ...initialDocument.components[0]!.stateProperties,
      });
      controller().updateArduinoProgram('uno-a', {
        ...initialDocument.components[0]!.stateProperties,
      });
      controller().updateArduinoProgram('uno-b', {});
      controller().updateArduinoProgram('missing', { arduinoSource: source('ignored') });
      controller().updateArduinoProgram('resistor', { arduinoSource: source('ignored') });
    });
    expect(controller().document).toBe(saved);
    expect(controller().document).toEqual(initialDocument);
    expect(controller().documentMutationEpoch()).toBe(epoch);
    expect(controller().saveStatus).toBe('saved');
    expect(controller().canUndo).toBe(false);
    expect(controller().canRedo).toBe(false);
    expect(localDocument()).toBeUndefined();
    await act(async () => window.dispatchEvent(new Event('pagehide')));
    await act(async () => root!.unmount());
    root = null;
    expect(Date.now()).toBe(0);
    expect(save).not.toHaveBeenCalled();
    expect(localDocument()).toBeUndefined();
    expect(localStorage.getItem('asa-project-local-draft:first')).toBeNull();
  });

  it('commits a genuine same-render program edit with the entire latest document', async () => {
    const save = await prepare();
    const changedWorkspace = '{"blocks":{"blocks":[]},"variables":[{"name":"latest","id":"v"}]}';
    const changedSource = source('genuine latest');
    act(() => controller().selectComponent('resistor', false));
    // All three publications use one render: the comparison must read the
    // latest board/document, just like the real edit merge does.
    act(() => {
      controller().updateSelectedValue(444.4);
      controller().updateArduinoProgram('uno-a', initialDocument.components[0]!.stateProperties!);
      controller().updateArduinoProgram('uno-a', {
        arduinoSource: changedSource,
        arduinoWorkspace: changedWorkspace,
      });
      controller().updateArduinoProgram('uno-a', {
        arduinoSource: changedSource,
        arduinoWorkspace: changedWorkspace,
      });
    });
    const expected = {
      ...initialDocument,
      components: initialDocument.components.map((component) =>
        component.id === 'uno-a'
          ? {
              ...component,
              stateProperties: {
                ...component.stateProperties,
                arduinoSource: changedSource,
                arduinoWorkspace: changedWorkspace,
              },
            }
          : component.id === 'resistor'
            ? { ...component, value: 444.4 }
            : component,
      ),
    };
    expect(Date.now()).toBe(0);
    expect(controller().document).toEqual(expected);
    expect(localDocument()).toEqual(expected);
    expect(controller().documentMutationEpoch()).toBe(2);
    expect(controller().canUndo).toBe(true);
    expect(save).not.toHaveBeenCalled();
    await act(async () => window.dispatchEvent(new Event('pagehide')));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]?.[1]).toEqual(expected);
    expect(stored.get('first')).toEqual(expected);
    expect(controller().saveStatus).toBe('saved');
    expect(localDocument()).toBeUndefined();
  });

  it('retains an unrelated dirty edit and its history when the Arduino publication is equal', async () => {
    const save = await prepare();
    act(() => controller().selectComponent('resistor', false));
    act(() => controller().updateSelectedValue(555.5));
    const dirty = controller().document;
    const epoch = controller().documentMutationEpoch();
    const saveStatus = controller().saveStatus;
    expect(saveStatus).not.toBe('saved');
    expect(localDocument()).toEqual(dirty);
    act(() =>
      controller().updateArduinoProgram('uno-a', {
        ...initialDocument.components[0]!.stateProperties,
      }),
    );
    expect(controller().document).toBe(dirty);
    expect(controller().documentMutationEpoch()).toBe(epoch);
    expect(controller().saveStatus).toBe(saveStatus);
    expect(localDocument()).toEqual(dirty);
    expect(controller().canUndo).toBe(true);
    expect(controller().canRedo).toBe(false);
    act(() => controller().undo());
    expect(controller().document).toEqual(initialDocument);
    expect(controller().canUndo).toBe(false);
    expect(controller().canRedo).toBe(true);
    act(() => controller().redo());
    expect(controller().document).toEqual(dirty);
    await act(async () => controller().saveNow());
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]?.[1]).toEqual(dirty);
    expect(stored.get('first')).toEqual(dirty);
  });

  it('preserves string-array state semantics without swallowing changed entries, order or length', async () => {
    const save = await prepare();
    act(() => controller().updateArduinoProgram('uno-a', { ownerArray: ['a', 'b'] }));
    const withArray = controller().document;
    const epoch = controller().documentMutationEpoch();
    act(() => controller().updateArduinoProgram('uno-a', { ownerArray: ['a', 'b'] }));
    expect(controller().document).toBe(withArray);
    expect(controller().documentMutationEpoch()).toBe(epoch);
    act(() => controller().updateArduinoProgram('uno-a', { ownerArray: ['a', 'c'] }));
    expect(controller().document?.components[0]?.stateProperties?.['ownerArray']).toEqual([
      'a',
      'c',
    ]);
    act(() => controller().updateArduinoProgram('uno-a', { ownerArray: ['c', 'a'] }));
    expect(controller().document?.components[0]?.stateProperties?.['ownerArray']).toEqual([
      'c',
      'a',
    ]);
    act(() => controller().updateArduinoProgram('uno-a', { ownerArray: ['c'] }));
    expect(controller().document?.components[0]?.stateProperties?.['ownerArray']).toEqual(['c']);
    expect(controller().documentMutationEpoch()).toBe(epoch + 3);
    const expected = {
      ...initialDocument,
      components: initialDocument.components.map((component) =>
        component.id === 'uno-a'
          ? { ...component, stateProperties: { ...component.stateProperties, ownerArray: ['c'] } }
          : component,
      ),
    };
    expect(controller().document).toEqual(expected);
    expect(localDocument()).toEqual(expected);
    expect(save).not.toHaveBeenCalled();
    await act(async () => controller().saveNow());
    expect(save).toHaveBeenCalledTimes(1);
    expect(stored.get('first')).toEqual(expected);
  });
});

describe('optional enclosing-host flush and explicit legacy mode replacement', () => {
  it('publishes a live block edit and saves in the same event at t=0 without waiting for 180ms', async () => {
    stubSvgSurface();
    exposeProgramHandle = true;
    const save = await prepare(blockSettingsDocument());
    const live = injected.workspace as S.Workspace;
    const pin = live.getBlocksByType('asa_digital_write', false)[0]!.getInputTargetBlock('PIN');
    expect(pin).toBeTruthy();
    const before = controller().document!.components[0]!.stateProperties!.arduinoSource;
    await act(async () => {
      pin!.setFieldValue('9', 'VALUE');
      expect(controller().document!.components[0]!.stateProperties!.arduinoSource).toBe(before);
      programHandle.current!.flushPendingPublication();
      expect(localDocument()!.components[0]!.stateProperties!.arduinoSource).toContain(
        'digitalWrite(9,',
      );
      await controller().saveNow();
    });
    expect(Date.now()).toBe(0);
    expect(save).toHaveBeenCalledOnce();
    expect(stored.get('first')!.components[0]!.stateProperties!.arduinoSource).toContain(
      'digitalWrite(9,',
    );
    await act(async () => vi.advanceTimersByTimeAsync(250));
    expect(controller().document!.components[0]!.stateProperties!.arduinoSource).toContain(
      'digitalWrite(9,',
    );
  });

  it('keeps a text-only sketch through opening and cancellation, then replaces only after confirmation', async () => {
    stubSvgSurface();
    const legacy = normalizeLoadedDocument(fixtureDocument);
    const properties = legacy.components[0]!.stateProperties!;
    delete properties['arduinoWorkspace'];
    const original = properties['arduinoSource'];
    await prepare(legacy);
    expect(injected.mounts).toBe(0);
    act(() => clickButton('Блоки'));
    expect(host!.textContent).toContain('Текущий текстовый код будет заменён стартовым примером');
    expect(controller().document!.components[0]!.stateProperties!.arduinoSource).toBe(original);
    act(() => clickButton('Отмена'));
    expect(injected.mounts).toBe(0);
    expect(controller().document!.components[0]!.stateProperties!.arduinoSource).toBe(original);
    act(() => clickButton('Блоки'));
    act(() => clickButton('Продолжить'));
    expect(injected.mounts).toBe(1);
    expect(controller().document!.components[0]!.stateProperties!.arduinoCodeMode).toBe('blocks');
    expect(controller().document!.components[0]!.stateProperties!.arduinoSource).not.toBe(original);
  });
});
