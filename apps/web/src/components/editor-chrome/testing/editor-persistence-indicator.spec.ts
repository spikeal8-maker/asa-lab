// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  EDITOR_PERSISTENCE_TIMING,
  EditorPersistenceIndicator,
  editorPersistencePresentation,
} from '../EditorPersistenceIndicator';

const reactTestGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };

beforeAll(() => {
  reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = false;
});
afterEach(() => vi.useRealTimers());

describe('shared editor persistence presentation', () => {
  it('uses compact labels and explains data safety without protocol language', () => {
    expect(editorPersistencePresentation('saved', null)).toEqual({
      label: 'Сохранено',
      detail: 'Изменения проекта сохранены.',
    });
    expect(editorPersistencePresentation('error', 'conflict')).toEqual({
      label: 'Только на устройстве',
      detail: 'Работа не потеряна, но пока не синхронизирована с общей версией.',
    });
    expect(editorPersistencePresentation('error', 'offline').label).toBe('Нет связи');
    expect(editorPersistencePresentation('error', 'auth').label).toBe('Нужно войти');
  });

  it('suppresses fast save churn and keeps success feedback brief', () => {
    expect(EDITOR_PERSISTENCE_TIMING.pendingDelayMs).toBeGreaterThanOrEqual(800);
    expect(EDITOR_PERSISTENCE_TIMING.savedVisibilityMs).toBeLessThanOrEqual(1_500);
  });

  it('stays quiet at rest and only confirms a save that took long enough to show', () => {
    vi.useFakeTimers();
    const container = document.createElement('div');
    const root = createRoot(container);
    const render = (status: 'saved' | 'dirty' | 'saving' | 'error') =>
      act(() =>
        root.render(
          createElement(EditorPersistenceIndicator, {
            status,
            issue: null,
            className: 'test-status',
          }),
        ),
      );

    render('saved');
    expect(container.textContent).toBe('');
    render('dirty');
    act(() => vi.advanceTimersByTime(EDITOR_PERSISTENCE_TIMING.pendingDelayMs - 1));
    expect(container.textContent).toBe('');
    act(() => vi.advanceTimersByTime(1));
    expect(container.textContent).toBe('Сохраняем…');
    render('saving');
    render('saved');
    expect(container.textContent).toBe('✓Сохранено');
    act(() => vi.advanceTimersByTime(EDITOR_PERSISTENCE_TIMING.savedVisibilityMs));
    expect(container.textContent).toBe('');
    act(() => root.unmount());
  });
});
