/* @vitest-environment jsdom */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { api, type Project, type SchematicDocument } from '../../api';
import { WorkbenchInspector } from '../WorkbenchSidebars';
import { configureProductionLibrary } from '../production-manifest-adapter';
import { addComponentToDocument } from '../workbench-document';
import { useElectronicsWorkbench } from '../use-electronics-workbench';

vi.mock('../../../../../contexts/electronics/module.js', () => ({ ELECTRONICS_MODULE: {} }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
let controller: ReturnType<typeof useElectronicsWorkbench>;
let root: Root;
let host: HTMLDivElement;
function Probe() {
  controller = useElectronicsWorkbench('mobile-properties', 'owner');
  return createElement(WorkbenchInspector, { controller });
}
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
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  window.localStorage.clear();
});
async function mount() {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  let initial: SchematicDocument = {
    schemaVersion: 4,
    components: [],
    connections: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    simulation: { running: false, maxIterations: 24 },
  };
  initial = addComponentToDocument(initial, 'resistor-axial', { x: 100, y: 100 }, 'r1').document;
  initial = addComponentToDocument(initial, 'resistor-axial', { x: 200, y: 100 }, 'r2').document;
  vi.spyOn(api, 'me').mockResolvedValue({
    ok: true,
    status: 200,
    data: { authenticated: true, user: { id: 'owner' } },
  } as Awaited<ReturnType<typeof api.me>>);
  vi.spyOn(api, 'openProject').mockResolvedValue({
    ok: true,
    status: 200,
    data: {
      project: {
        id: 'mobile-properties',
        moduleKey: 'electronics',
        title: 'Properties',
      } as Project,
      draft: { projectId: 'mobile-properties', document: initial, revision: 1, updatedAt: '' },
      versions: [],
      result: null,
    },
  } as Awaited<ReturnType<typeof api.openProject>>);
  vi.spyOn(api, 'saveDraft').mockImplementation(async (_id, document) => ({
    ok: true,
    status: 200,
    data: {
      draft: { projectId: 'mobile-properties', document, revision: 2, updatedAt: '' },
      result: null,
    },
  }));
  host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  await act(async () => root.render(createElement(Probe)));
  expect(controller.status).toBe('ready');
  await act(async () => controller.selectComponent('r1'));
}
function disclosure() {
  return host.querySelector<HTMLButtonElement>('.workbench-properties-disclosure')!;
}
function resistance() {
  return host.querySelector<HTMLInputElement>('.workbench-value-field input')!;
}
async function input(value: string) {
  // Real React input event path, real production controller; API is a unit stub.
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      resistance(),
      value,
    );
    resistance().dispatchEvent(new Event('input', { bubbles: true }));
  });
}
describe('mobile component properties disclosure with the production controller', () => {
  it('starts folded and retains the same editor, selection and resistance across fold, Save and Undo/Redo', async () => {
    await mount();
    const editor = resistance();
    const before = controller.selectedComponent!.value;
    expect(disclosure().getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById(disclosure().getAttribute('aria-controls')!)).not.toBeNull();
    await act(async () => disclosure().click());
    expect(disclosure().getAttribute('aria-expanded')).toBe('true');
    await input('680');
    expect(controller.selectedComponent!.value).toBe(680);
    await act(async () => disclosure().click());
    expect(disclosure().getAttribute('aria-expanded')).toBe('false');
    expect(resistance()).toBe(editor);
    expect(controller.selectedComponent!.id).toBe('r1');
    await act(async () => controller.saveNow());
    expect(vi.mocked(api.saveDraft).mock.calls.at(-1)?.[1]).toEqual(controller.document);
    await act(async () => controller.undo());
    expect(controller.selectedComponent!.value).toBe(before);
    await act(async () => controller.redo());
    expect(controller.selectedComponent!.value).toBe(680);
    await act(async () => disclosure().click());
    expect(resistance()).toBe(editor);
    expect(editor.value).toBe('680');
    await act(async () => {
      editor.focus();
      editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(disclosure().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(disclosure());
    expect(controller.selectedComponent!.id).toBe('r1');
  });
  it('does not commit an empty invalid value and folds on a different selection', async () => {
    await mount();
    await act(async () => disclosure().click());
    const before = controller.selectedComponent!.value;
    await input('');
    expect(controller.selectedComponent!.value).toBe(before);
    await act(async () => disclosure().click());
    await act(async () => disclosure().click());
    expect(controller.selectedComponent!.value).toBe(before);
    await act(async () => controller.selectComponent('r2'));
    expect(disclosure().getAttribute('aria-expanded')).toBe('false');
    await act(async () => controller.selectComponent('r1'));
    expect(disclosure().getAttribute('aria-expanded')).toBe('false');
    expect(controller.selectedComponent!.value).toBe(before);
  });
});
