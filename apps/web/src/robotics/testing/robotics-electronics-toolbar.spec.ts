/* @vitest-environment jsdom */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ElectronicsWorkbenchController } from '../../electronics/use-electronics-workbench';
import { WIRE_COLORS } from '../../electronics/workbench-model';
import { RoboticsElectronicsToolbar } from '../RoboticsElectronicsToolbar';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const handlers = {
  setLibraryOpen: vi.fn(),
  fitScene: vi.fn(),
  copySelected: vi.fn(),
  pasteCopied: vi.fn(),
  duplicateSelected: vi.fn(),
  rotateSelected: vi.fn(),
  mirrorSelected: vi.fn(),
  removeSelection: vi.fn(),
  undo: vi.fn(),
  redo: vi.fn(),
  toggleWireRoute: vi.fn(),
  setWireColor: vi.fn(),
  addCanvasText: vi.fn(),
};

let root: Root;
let container: HTMLDivElement;

function controller(selection: 'component' | 'annotation' | null = 'component') {
  return {
    ...handlers,
    busy: false,
    libraryOpen: false,
    selection: selection ? { kind: selection, id: 'part-1' } : null,
    canUndo: true,
    canRedo: true,
    hasClipboard: true,
    orthogonalWireMode: false,
    activeWireColor: WIRE_COLORS[0],
  } as unknown as ElectronicsWorkbenchController;
}

function mount(source = controller(), running = false): void {
  act(() =>
    root.render(
      createElement(RoboticsElectronicsToolbar, {
        controller: source,
        running,
      }),
    ),
  );
}

function button(label: string): HTMLButtonElement {
  const target = container.querySelector<HTMLButtonElement>('button[aria-label="' + label + '"]');
  if (!target) throw new Error('Missing electronics action ' + label);
  return target;
}

function click(label: string): void {
  const target = button(label);
  expect(target.disabled).toBe(false);
  act(() => target.click());
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  vi.clearAllMocks();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('Robotics electronics toolbar uses the real Electronics controller', () => {
  it('exposes and delegates every principal editing action without creating an alternative editor', () => {
    mount();
    expect(container.querySelectorAll('[role="toolbar"]')).toHaveLength(1);
    click('Компоненты');
    click('Вписать');
    click('Копировать');
    click('Вставить');
    click('Дублировать');
    click('Повернуть');
    click('Отразить');
    click('Удалить');
    click('Отменить');
    click('Повторить');
    click('Провод 90°');
    click('Добавить текст');

    expect(handlers.setLibraryOpen).toHaveBeenCalledOnce();
    expect(handlers.fitScene).toHaveBeenCalledOnce();
    expect(handlers.copySelected).toHaveBeenCalledOnce();
    expect(handlers.pasteCopied).toHaveBeenCalledOnce();
    expect(handlers.duplicateSelected).toHaveBeenCalledOnce();
    expect(handlers.rotateSelected).toHaveBeenCalledOnce();
    expect(handlers.mirrorSelected).toHaveBeenCalledExactlyOnceWith('horizontal');
    expect(handlers.removeSelection).toHaveBeenCalledOnce();
    expect(handlers.undo).toHaveBeenCalledOnce();
    expect(handlers.redo).toHaveBeenCalledOnce();
    expect(handlers.toggleWireRoute).toHaveBeenCalledOnce();
    expect(handlers.addCanvasText).toHaveBeenCalledOnce();

    const swatches = container.querySelectorAll<HTMLButtonElement>(
      '.robotics-electronics-wire-swatch',
    );
    expect(swatches).toHaveLength(WIRE_COLORS.length);
    click('Цвет провода: ' + WIRE_COLORS[2]);
    expect(handlers.setWireColor).toHaveBeenCalledExactlyOnceWith(WIRE_COLORS[2]);
  });

  it('disables structural actions while simulation is running and respects selection', () => {
    mount(controller('component'), true);
    for (const label of [
      'Компоненты',
      'Копировать',
      'Вставить',
      'Дублировать',
      'Повернуть',
      'Отразить',
      'Удалить',
      'Отменить',
      'Повторить',
      'Провод 90°',
      'Добавить текст',
    ])
      expect(button(label).disabled).toBe(true);
    expect(button('Вписать').disabled).toBe(false);

    mount(controller(null));
    for (const label of ['Копировать', 'Дублировать', 'Повернуть', 'Отразить', 'Удалить'])
      expect(button(label).disabled).toBe(true);
    expect(button('Вставить').disabled).toBe(false);
  });
});
