/* @vitest-environment jsdom */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ElectronicsWorkbenchController } from '../../electronics/use-electronics-workbench';
import { RoboticsElectronicsToolbar } from '../RoboticsElectronicsToolbar';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const handlers = {
  setLibraryOpen: vi.fn(), fitScene: vi.fn(), fitSceneScaled: vi.fn(), copySelected: vi.fn(),
  duplicateSelected: vi.fn(), pasteCopied: vi.fn(), rotateSelected: vi.fn(),
  mirrorSelected: vi.fn(), removeSelection: vi.fn(), undo: vi.fn(),
  redo: vi.fn(), toggleWireRoute: vi.fn(), setWireColor: vi.fn(), addCanvasText: vi.fn(),
};
let root: Root;
let container: HTMLDivElement;
function makeController() {
  return {
    ...handlers, busy: false, libraryOpen: false, document: { components: [] },
    selection: { kind: 'component', ids: ['uno'] }, canUndo: true, canRedo: true,
    hasClipboard: true, orthogonalWireMode: false, activeWireColor: '#e3212b',
  } as unknown as ElectronicsWorkbenchController;
}
function mount(running = false, onToggleCode = vi.fn()) {
  act(() => root.render(createElement(RoboticsElectronicsToolbar, {
    controller: makeController(), running, codeOpen: false, onToggleCode,
  })));
  return onToggleCode;
}
function press(name: string) {
  const button = container.querySelector<HTMLButtonElement>('button[aria-label="' + name + '"]');
  if (!button) throw new Error('Missing action ' + name);
  expect(button.disabled).toBe(false);
  act(() => button.click());
}
beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
describe('native Electronics toolbar in Robotics', () => {
  it('shares the actual native icon tool definitions, tooltips and controller callbacks', () => {
    const toggleCode = mount();
    expect(container.querySelector('.workbench-breadboard-tools')).not.toBeNull();
    for (const name of [
      'Копировать (Ctrl+C)', 'Дублировать', 'Вставить (Ctrl+V)',
      'Удалить (Delete)', 'Отменить (Ctrl+Z)', 'Повторить (Ctrl+Shift+Z)',
      'Добавить текст на схему', 'Повернуть на 45° (R)', 'Отразить',
    ]) {
      const button = container.querySelector<HTMLButtonElement>('button[aria-label="' + name + '"]');
      expect(button).not.toBeNull();
      expect(button?.dataset['workbenchTooltip']).toBeTruthy();
      expect(button?.textContent).not.toContain(name);
    }
    for (const name of [
      'Вписать','Открыть код','Копировать (Ctrl+C)','Дублировать',
      'Вставить (Ctrl+V)','Повернуть на 45° (R)','Отразить','Удалить (Delete)',
      'Отменить (Ctrl+Z)','Повторить (Ctrl+Shift+Z)','Добавить текст на схему',
      'Автоматическая прокладка провода под 90 градусов',
    ]) press(name);
    expect(container.querySelector('[aria-label="Компоненты"]')).toBeNull();
    expect(handlers.fitSceneScaled).toHaveBeenCalledExactlyOnceWith(0.5);
    expect(handlers.copySelected).toHaveBeenCalledOnce();
    expect(handlers.duplicateSelected).toHaveBeenCalledOnce();
    expect(handlers.pasteCopied).toHaveBeenCalledOnce();
    expect(handlers.mirrorSelected).toHaveBeenCalledExactlyOnceWith('horizontal');
    expect(handlers.toggleWireRoute).toHaveBeenCalledOnce();
    expect(toggleCode).toHaveBeenCalledOnce();
  });
  it('locks native editing while simulation runs, leaving the code drawer available', () => {
    mount(true);
    expect(container.querySelector<HTMLElement>('.robotics-electronics-native-tools')?.inert).toBe(true);
    expect(container.querySelector('button[aria-label="Компоненты"]')).toBeNull();
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="Открыть код"]')?.disabled).toBe(false);
  });
});
