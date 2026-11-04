/* @vitest-environment jsdom */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SchematicDocument } from '../../api';
import { configureProductionLibrary } from '../../electronics/production-manifest-adapter';
import { createDefaultRoboticsProject } from '../robotics-project';
import { createRoboticsWorldDocument } from '../world';
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

function mount() {
  const initial = createDefaultRoboticsProject();
  function Harness() {
    local = useLocalRoboticsProject(initial);
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
      local.setWorld(createRoboticsWorldDocument('wide'));
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
    act(() => local.setWorld(createRoboticsWorldDocument('compact')));
    const changed = local.getCurrentProject();
    await act(async () => local.host.toggleSimulation());
    act(() => {
      expect(local.setWorld(createRoboticsWorldDocument('wide'))).toBe(false);
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
