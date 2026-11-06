/* @vitest-environment jsdom */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SchematicDocument } from '../../api';
import { configureProductionLibrary } from '../../electronics/production-manifest-adapter';
import { createDefaultRoboticsProject } from '../robotics-project';
import { createRoboticsWorldV3Document, createRoboticsWorldDocument } from '../world';
import { ROBOTICS_LOCAL_PROJECT_KEY, useLocalRoboticsProject } from '../use-local-robotics-project';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
let local: ReturnType<typeof useLocalRoboticsProject>;
let fetchSpy: ReturnType<typeof vi.spyOn>;

function currentDocument(): SchematicDocument {
  const document = local.host.getCurrentDocument();
  if (!document) throw new Error('The local robotics source must be available.');
  return document;
}

function mount(beforeHistoryChange?: () => void) {
  const initial = createDefaultRoboticsProject();
  function Harness() {
    local = useLocalRoboticsProject(initial, beforeHistoryChange);
    return createElement('output', null, local.host.saveStatus);
  }
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(createElement(Harness)));
}

function editProgram(
  document: SchematicDocument,
  source: string,
  workspace?: string,
): SchematicDocument {
  return {
    ...document,
    components: document.components.map((component) =>
      component.id === 'uno'
        ? {
            ...component,
            stateProperties: {
              ...component.stateProperties,
              arduinoSource: source,
              ...(workspace ? { arduinoWorkspace: workspace } : {}),
            },
          }
        : component,
    ),
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
  fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(new Error('No backend belongs to this local host.'));
});

afterEach(() => {
  if (root) act(() => root.unmount());
  container?.remove();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('robotics local project host', () => {
  it('opens historical v2 unchanged and upgrades only explicitly without Undo restoring v2', async () => {
    const legacy = {
      ...createDefaultRoboticsProject(),
      schemaVersion: 2 as const,
      world: createRoboticsWorldDocument(),
    };
    localStorage.setItem(ROBOTICS_LOCAL_PROJECT_KEY, JSON.stringify(legacy));
    mount();
    expect(local.getCurrentProject()).toEqual(legacy);
    act(() => local.publish({ ...local.getCurrentProject(), title: 'Изменённое имя' }));
    act(() => expect(local.enableExtendedField()).toBe(true));
    expect(local.getCurrentProject()).toMatchObject({
      schemaVersion: 3,
      world: { physicsProfile: 'kinematic-rover-bodies-v2' },
    });
    act(() => expect(local.host.undo()).toBe(true));
    expect(local.getCurrentProject()).toMatchObject({
      schemaVersion: 3,
      title: legacy.title,
      world: { physicsProfile: 'kinematic-rover-bodies-v2' },
    });
    expect(local.getCurrentProject().circuit).toEqual(legacy.circuit);
    await act(async () => local.host.saveNow());
    expect(JSON.parse(localStorage.getItem(ROBOTICS_LOCAL_PROJECT_KEY)!).schemaVersion).toBe(3);
    act(() => expect(local.host.redo()).toBe(true));
    expect(local.getCurrentProject()).toMatchObject({ schemaVersion: 3, title: 'Изменённое имя' });
  });
  it('opens a local source without an account, server project or automatic write', () => {
    mount();
    expect(local.host.project).toBeNull();
    expect(local.host.serverRevision).toBeNull();
    expect(local.host.status).toBe('ready');
    expect(local.host.saveStatus).toBe('dirty');
    expect(local.host.document?.components).toHaveLength(9);
    expect(localStorage.getItem(ROBOTICS_LOCAL_PROJECT_KEY)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reports pending edits and saves the latest source in the same event before React rerenders', async () => {
    mount();
    await act(async () => local.host.saveNow());
    expect(local.hasUnsavedChanges()).toBe(false);
    const fromPreviousRender = local;
    await act(async () => {
      fromPreviousRender.host.commitDocument(
        editProgram(currentDocument(), 'void setup(){} void loop(){delay(37);}'),
      );
      // The render snapshot is still saved; the synchronous source is already dirty.
      expect(fromPreviousRender.host.saveStatus).toBe('saved');
      expect(fromPreviousRender.hasUnsavedChanges()).toBe(true);
      expect(
        fromPreviousRender.getCurrentProject().circuit.components[0]!.stateProperties!
          .arduinoSource,
      ).toContain('delay(37)');
      await fromPreviousRender.host.saveNow();
      expect(fromPreviousRender.hasUnsavedChanges()).toBe(false);
    });
    expect(
      JSON.parse(localStorage.getItem(ROBOTICS_LOCAL_PROJECT_KEY)!).circuit.components[0]
        .stateProperties.arduinoSource,
    ).toContain('delay(37)');
  });

  it('retains rapid successive program edits before React commits a render', () => {
    mount();
    const getCurrentDocument = local.host.getCurrentDocument;
    const confirmStarted = local.host.confirmSimulationStarted;
    const setNotice = local.host.setNotice;
    act(() => {
      local.host.commitDocument(
        editProgram(currentDocument(), 'void setup(){} void loop(){delay(75);}'),
      );
      const latest = currentDocument();
      local.host.commitDocument({
        ...latest,
        components: latest.components.map((component) =>
          component.id === 'uno'
            ? {
                ...component,
                stateProperties: { ...component.stateProperties, arduinoSerialBaud: 115200 },
              }
            : component,
        ),
      });
    });
    const uno = local.host.document?.components.find((component) => component.id === 'uno');
    expect(uno?.stateProperties?.arduinoSource).toContain('delay(75)');
    expect(uno?.stateProperties?.arduinoSerialBaud).toBe(115200);
    expect(local.host.getCurrentDocument).toBe(getCurrentDocument);
    expect(local.host.confirmSimulationStarted).toBe(confirmStarted);
    expect(local.host.setNotice).toBe(setNotice);
  });

  it('saves the latest circuit, program workspace and field then opens them after a remount', async () => {
    mount();
    const workspace = JSON.stringify({ blocks: { languageVersion: 0, blocks: [] } });
    await act(async () => {
      local.host.commitDocument(
        editProgram(currentDocument(), 'void setup(){broken syntax} void loop(){}', workspace),
      );
      local.setWorld(createRoboticsWorldV3Document('wide'));
      local.host.setProjectTitle('Мой робот на большом поле');
      await local.host.saveNow();
    });
    expect(local.host.saveStatus).toBe('saved');
    const saved = local.getCurrentProject();
    expect(JSON.parse(localStorage.getItem(ROBOTICS_LOCAL_PROJECT_KEY) ?? 'null')).toEqual(saved);
    act(() => root.unmount());
    container.remove();
    mount();
    expect(local.getCurrentProject()).toEqual(saved);
    expect(local.robotProject.world.field.widthMeters).toBe(2.4);
    const uno = local.robotProject.circuit.components.find((component) => component.id === 'uno');
    expect(uno?.stateProperties?.arduinoWorkspace).toBe(workspace);
    expect(uno?.stateProperties?.arduinoSource).toContain('broken syntax');
    expect(local.host.saveStatus).toBe('saved');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('keeps the existing saved record and reports a storage failure without a saved claim', async () => {
    mount();
    await act(async () => local.host.saveNow());
    const savedBytes = localStorage.getItem(ROBOTICS_LOCAL_PROJECT_KEY);
    act(() =>
      local.host.commitDocument(
        editProgram(currentDocument(), 'void setup(){} void loop(){delay(91);}'),
      ),
    );
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Quota exceeded');
    });
    await act(async () => local.host.saveNow());
    expect(local.host.saveStatus).toBe('error');
    expect(local.host.localCopySaved).toBe(false);
    expect(local.host.saveError).toContain('Quota exceeded');
    expect(localStorage.getItem(ROBOTICS_LOCAL_PROJECT_KEY)).toBe(savedBytes);
    expect(
      local.host.document?.components.find((component) => component.id === 'uno')?.stateProperties
        ?.arduinoSource,
    ).toContain('delay(91)');
  });

  it('leaves malformed stored bytes untouched and displays the opening problem', () => {
    localStorage.setItem(ROBOTICS_LOCAL_PROJECT_KEY, '{malformed');
    mount();
    expect(local.host.status).toBe('ready');
    expect(local.host.notice).toContain('Не удалось прочитать');
    expect(local.host.saveStatus).toBe('dirty');
    expect(localStorage.getItem(ROBOTICS_LOCAL_PROJECT_KEY)).toBe('{malformed');
  });

  it('runs and resets without turning runtime activity into a source edit or local save', async () => {
    mount();
    const source = local.getCurrentProject();
    const write = vi.spyOn(Storage.prototype, 'setItem');
    await act(async () => local.host.toggleSimulation());
    expect(local.host.simulationRunning).toBe(true);
    expect(local.host.simulationStatus).toBe('starting');
    act(() => local.host.confirmSimulationStarted());
    expect(local.host.simulationStatus).toBe('running');
    act(() => local.host.resetSimulation());
    expect(local.host.simulationRunning).toBe(false);
    expect(local.host.simulationStatus).toBe('stopped');
    expect(local.getCurrentProject()).toBe(source);
    expect(local.host.canUndo).toBe(false);
    expect(write).not.toHaveBeenCalled();
  });

  it('restores source edits with Undo/Redo while preventing world replacement during a run', async () => {
    mount();
    const original = local.getCurrentProject();
    act(() => local.setWorld(createRoboticsWorldV3Document('compact')));
    const changed = local.getCurrentProject();
    await act(async () => local.host.toggleSimulation());
    act(() => {
      expect(local.setWorld(createRoboticsWorldV3Document('wide'))).toBe(false);
      expect(local.host.undo(() => true)).toBe(false);
    });
    expect(local.getCurrentProject()).toEqual(changed);
    act(() => {
      local.host.resetSimulation();
      expect(local.host.undo()).toBe(true);
    });
    expect(local.getCurrentProject()).toEqual(original);
    act(() => {
      expect(local.host.redo()).toBe(true);
    });
    expect(local.getCurrentProject()).toEqual(changed);
  });

  it('invalidates restored programs synchronously for every host Undo/Redo while Save preserves Redo', async () => {
    mount();
    const original = local.getCurrentProject();
    const source = 'void setup(){} void loop(){delay(37);}';
    act(() => local.host.commitDocument(editProgram(currentDocument(), source)));
    expect(local.programRevision).toBe(0);
    const changed = local.getCurrentProject();
    const beforeUndoRender = local;
    await act(async () => {
      expect(beforeUndoRender.host.undo()).toBe(true);
      expect(beforeUndoRender.getProgramRevision()).toBe(1);
      expect(beforeUndoRender.programRevision).toBe(0);
      expect(beforeUndoRender.getCurrentProject()).toEqual(original);
      await beforeUndoRender.host.saveNow();
    });
    expect(local.programRevision).toBe(1);
    expect(local.host.canRedo).toBe(true);
    expect(JSON.parse(localStorage.getItem(ROBOTICS_LOCAL_PROJECT_KEY)!)).toEqual(original);
    const beforeRedoRender = local;
    await act(async () => {
      expect(beforeRedoRender.host.redo()).toBe(true);
      expect(beforeRedoRender.getProgramRevision()).toBe(2);
      expect(beforeRedoRender.getCurrentProject()).toEqual(changed);
      await beforeRedoRender.host.saveNow();
    });
    expect(local.programRevision).toBe(2);
    expect(JSON.parse(localStorage.getItem(ROBOTICS_LOCAL_PROJECT_KEY)!)).toEqual(changed);
    act(() => expect(local.host.redo()).toBe(false));
    expect(local.programRevision).toBe(2);
  });

  it('flushes a pending program before choosing the history target without discarding its Redo', () => {
    let pending = true;
    const flush = vi.fn(() => {
      if (!pending) return;
      pending = false;
      local.host.commitDocument(
        editProgram(currentDocument(), 'void setup(){} void loop(){delay(38);}'),
      );
    });
    mount(flush);
    const original = local.getCurrentProject();
    act(() => expect(local.host.undo()).toBe(true));
    expect(flush).toHaveBeenCalledOnce();
    expect(local.getCurrentProject()).toEqual(original);
    expect(local.programRevision).toBe(1);
    expect(local.host.canRedo).toBe(true);
    act(() => expect(local.host.redo()).toBe(true));
    expect(flush).toHaveBeenCalledTimes(2);
    expect(local.programRevision).toBe(2);
    expect(currentDocument().components[0]!.stateProperties!.arduinoSource).toContain('delay(38)');
  });

  it('shares the replacement boundary with examples and Open but keeps it unchanged for field history', async () => {
    mount();
    await act(async () => local.host.saveNow());
    act(() =>
      local.replaceProgram(() =>
        local.host.commitDocument(
          editProgram(currentDocument(), 'void setup(){} void loop(){delay(39);}'),
        ),
      ),
    );
    expect(local.programRevision).toBe(1);
    act(() => local.setWorld(createRoboticsWorldV3Document('compact')));
    act(() => expect(local.host.undo()).toBe(true));
    act(() => expect(local.host.redo()).toBe(true));
    expect(local.programRevision).toBe(1);
    act(() => expect(local.openSavedProject()).toBe(true));
    expect(local.programRevision).toBe(2);
    act(() => expect(local.openSavedProject()).toBe(true));
    expect(local.programRevision).toBe(2);
  });

  it('allows an erroneous editable project to be saved but fails closed on missing motor bindings', async () => {
    mount();
    act(() => {
      const circuit = currentDocument();
      local.host.commitDocument({
        ...circuit,
        components: circuit.components.filter((component) => component.id !== 'left-motor'),
      });
    });
    await act(async () => local.host.saveNow());
    expect(local.host.saveStatus).toBe('saved');
    await act(async () => local.host.toggleSimulation());
    expect(local.host.simulationRunning).toBe(false);
    expect(local.host.notice).toBeTruthy();
    expect(local.host.notice).not.toContain('сохранён');
  });

  it('uses the existing Arduino diagnostics to reject an unsupported sketch before starting', async () => {
    mount();
    act(() =>
      local.host.commitDocument(
        editProgram(currentDocument(), 'void setup(){}\nvoid loop(){unknownRoboticsCommand();}'),
      ),
    );
    const source = local.getCurrentProject();
    await act(async () => local.host.toggleSimulation());
    expect(local.host.simulationRunning).toBe(false);
    expect(local.host.simulationStatus).toBe('stopped');
    expect(local.host.notice).toContain('Arduino: строка 2.');
    expect(local.host.notice).toContain('unknownRoboticsCommand');
    expect(local.getCurrentProject()).toBe(source);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reopens the saved source without leaking a project or Blockly download path', async () => {
    mount();
    await act(async () => local.host.saveNow());
    const saved = local.getCurrentProject();
    act(() => local.host.setProjectTitle('Несохранённое название'));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click');
    act(() => local.host.exportEmergencyCopy());
    expect(click).not.toHaveBeenCalled();
    expect(local.host.notice).toContain('Скачивание проекта недоступно');
    act(() => {
      expect(local.openSavedProject()).toBe(true);
    });
    expect(local.getCurrentProject()).toEqual(saved);
    expect(local.host.saveStatus).toBe('saved');
    expect(local.host.canUndo).toBe(false);
  });
});
