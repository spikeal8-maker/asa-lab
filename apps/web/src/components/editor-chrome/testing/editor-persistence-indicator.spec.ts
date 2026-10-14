// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
      label: 'Не удалось сохранить',
      detail:
        'Сервер содержит другую версию. Последние изменения только в открытом редакторе; получите аварийную копию.',
    });
    expect(editorPersistencePresentation('error', 'offline').label).toBe('Нет связи');
    expect(editorPersistencePresentation('error', 'auth').label).toBe('Нужно войти');
  });

  it('claims a local copy only when the current document was actually stored', () => {
    for (const issue of ['offline', 'auth', 'conflict', 'server'] as const) {
      expect(editorPersistencePresentation('error', issue, true).detail).toContain(
        'сохранены в браузере',
      );
      expect(editorPersistencePresentation('error', issue, false).detail).toContain(
        'только в открытом редакторе',
      );
      expect(editorPersistencePresentation('error', issue, false).detail).not.toContain(
        'не потеряны',
      );
    }
    expect(editorPersistencePresentation('error', 'conflict', true).detail).toContain(
      'отправка остановлена',
    );
  });

  it('suppresses fast save churn and keeps success feedback brief', () => {
    expect(EDITOR_PERSISTENCE_TIMING.pendingDelayMs).toBeGreaterThanOrEqual(800);
    expect(EDITOR_PERSISTENCE_TIMING.savedVisibilityMs).toBeLessThanOrEqual(1_500);
  });

  it('distinguishes waiting for upload from a request and makes no unconfirmed local-copy promise', () => {
    expect(editorPersistencePresentation('dirty', null, true)).toEqual({
      label: 'Ждёт отправки',
      detail: 'Последние изменения сохранены в этом браузере. Ожидается отправка на сервер.',
    });
    expect(editorPersistencePresentation('dirty', null, false).detail).toContain(
      'только в открытом редакторе',
    );
    expect(editorPersistencePresentation('dirty', null, false).detail).not.toContain('сохранены');
    expect(editorPersistencePresentation('saving', null).detail).toBe(
      'Изменения проекта отправляются на сервер.',
    );
  });

  it('keeps dirty honest through the minute, storage failure, edits during a request and conflict', () => {
    vi.useFakeTimers();
    const container = document.createElement('div');
    const root = createRoot(container);
    const render = (
      status: 'saved' | 'dirty' | 'saving' | 'error',
      localCopySaved = true,
      issue: 'conflict' | null = null,
    ) =>
      act(() =>
        root.render(
          createElement(EditorPersistenceIndicator, {
            status,
            issue,
            localCopySaved,
            className: 'test-status',
          }),
        ),
      );
    const indicator = () => container.querySelector('[role="status"]')!;

    render('dirty');
    act(() => vi.advanceTimersByTime(59_999));
    expect(indicator().textContent).toBe('Ждёт отправки');
    expect(indicator().getAttribute('data-persistence-status')).toBe('dirty');
    expect(indicator().getAttribute('title')).toContain('сохранены в этом браузере');
    render('dirty', false);
    expect(indicator().getAttribute('title')).toContain('только в открытом редакторе');
    expect(indicator().textContent).not.toContain('Сохраняем');

    render('saving');
    expect(indicator().textContent).toBe('Сохраняем…');
    render('dirty'); // A new edit is not acknowledged by the pending request.
    expect(indicator().textContent).toBe('Ждёт отправки');
    render('error', true, 'conflict');
    expect(indicator().textContent).toBe('Не удалось сохранить');
    expect(indicator().getAttribute('title')).toContain('отправка остановлена');
    render('dirty');
    expect(indicator().textContent).toBe('');
    act(() => vi.advanceTimersByTime(900));
    expect(indicator().textContent).toBe('Ждёт отправки');
    render('saved');
    expect(indicator().textContent).toBe('✓Сохранено');
    render('dirty');
    expect(indicator().textContent).not.toContain('Сохранено');
    act(() => root.unmount());
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
    expect(container.textContent).toBe('Ждёт отправки');
    render('saving');
    expect(container.textContent).toBe('Сохраняем…');
    render('saved');
    expect(container.textContent).toBe('✓Сохранено');
    act(() => vi.advanceTimersByTime(EDITOR_PERSISTENCE_TIMING.savedVisibilityMs));
    expect(container.textContent).toBe('');
    act(() => root.unmount());
  });

  it('actually paints the acknowledged success for the existing visibility interval', () => {
    vi.useFakeTimers();
    const css = readFileSync(
      resolve(process.cwd(), 'apps/web/src/electronics/workbench.css'),
      'utf8',
    );
    const style = document.createElement('style');
    style.textContent = ['saved', 'quiet']
      .map((state) => {
        const rule = css.match(new RegExp(`\\.workbench-save-state\\.${state}\\s*\\{[^}]*\\}`));
        if (!rule) throw new Error(`Missing production ${state} indicator rule`);
        return rule[0];
      })
      .join('\n');
    document.head.appendChild(style);
    const container = document.body.appendChild(document.createElement('div'));
    const root = createRoot(container);
    const render = (status: 'dirty' | 'saved') =>
      act(() =>
        root.render(
          createElement(EditorPersistenceIndicator, {
            status,
            issue: null,
            className: 'workbench-save-state',
            localCopySaved: true,
          }),
        ),
      );
    try {
      render('dirty');
      act(() => vi.advanceTimersByTime(EDITOR_PERSISTENCE_TIMING.pendingDelayMs));
      render('saved');
      const indicator = container.querySelector('[role="status"]')!;
      expect(indicator.textContent).toBe('✓Сохранено');
      expect(getComputedStyle(indicator).opacity).toBe('1');
      act(() => vi.advanceTimersByTime(EDITOR_PERSISTENCE_TIMING.savedVisibilityMs - 1));
      expect(getComputedStyle(indicator).opacity).toBe('1');
      act(() => vi.advanceTimersByTime(1));
      expect(indicator.textContent).toBe('');
      expect(getComputedStyle(indicator).visibility).toBe('hidden');
    } finally {
      act(() => root.unmount());
      container.remove();
      style.remove();
    }
  });
});
