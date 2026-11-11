// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SystemToastViewport } from '../SystemToastViewport';
import {
  activateSystemFeedbackScope,
  clearSystemFeedback,
  getSystemFeedbackSnapshot,
} from '../system-feedback';

let root: Root | undefined;
let host: HTMLDivElement;
let header: HTMLElement;
let scope: ReturnType<typeof activateSystemFeedbackScope>;
const resizeCallbacks = new Map<Element, Set<() => void>>();
let errors: ReturnType<typeof vi.spyOn>;
const rect = () => new DOMRect(0, 0, 1024, 64);
const ribbon = () => document.querySelector<HTMLElement>('.system-feedback-ribbon');
const close = () => {
  const button = ribbon()?.querySelector<HTMLButtonElement>(
    'button[aria-label="Закрыть уведомление"]',
  );
  expect(button).toBeTruthy();
  return button!;
};
async function tick(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}
async function notify(message: string, tone: 'success' | 'error' | 'warning' | 'info' = 'success') {
  await act(async () => {
    scope.notify(message, tone);
  });
  await tick(0);
}
async function render(scopeKey = 'class:a') {
  await act(async () => {
    root!.render(createElement(SystemToastViewport, { scopeKey }));
  });
}
async function mouse(type: 'mouseover' | 'mouseout') {
  await act(async () => {
    ribbon()!.dispatchEvent(
      new MouseEvent(type === 'mouseover' ? 'pointerover' : 'pointerout', {
        bubbles: true,
        relatedTarget: document.body,
      }),
    );
  });
}

beforeEach(async () => {
  vi.useFakeTimers({
    toFake: [
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'Date',
      'performance',
      'requestAnimationFrame',
      'cancelAnimationFrame',
    ],
  });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  resizeCallbacks.clear();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      private readonly targets = new Set<Element>();
      private readonly notify: () => void;
      constructor(callback: ResizeObserverCallback) {
        this.notify = () => callback([], this as unknown as ResizeObserver);
      }
      observe(target: Element) {
        this.targets.add(target);
        const callbacks = resizeCallbacks.get(target) ?? new Set<() => void>();
        callbacks.add(this.notify);
        resizeCallbacks.set(target, callbacks);
      }
      unobserve(target: Element) {
        resizeCallbacks.get(target)?.delete(this.notify);
        this.targets.delete(target);
      }
      disconnect() {
        for (const target of this.targets) this.unobserve(target);
      }
    },
  );
  const viewport = new EventTarget();
  Object.assign(viewport, { width: 1024, height: 768, offsetTop: 0, offsetLeft: 0, scale: 1 });
  vi.stubGlobal('visualViewport', viewport);
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  clearSystemFeedback();
  header = document.createElement('header');
  header.className = 'portal-header';
  header.style.cssText = 'display:block;visibility:visible;opacity:1;width:1024px;height:64px';
  vi.spyOn(header, 'getBoundingClientRect').mockImplementation(rect);
  vi.spyOn(header, 'getClientRects').mockImplementation(() => {
    const list = [rect()];
    return Object.assign(list, {
      item: (index: number) => list[index] ?? null,
    }) as unknown as DOMRectList;
  });
  document.body.append(header);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  scope = activateSystemFeedbackScope('class:a');
  await render();
  await tick(32);
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  scope.dispose();
  clearSystemFeedback();
  host.remove();
  header.remove();
  const warnings = errors.mock.calls.map((args: unknown[]) => args.map(String).join(' '));
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  expect(warnings.filter((line: string) => /useInsertionEffect/i.test(line))).toEqual([]);
});

describe('system feedback viewport', () => {
  it.each([
    ['success', 4500],
    ['info', 5000],
    ['warning', 7000],
  ] as const)('%s expires at its exact visible budget', async (tone, budget) => {
    await notify('Готово', tone);
    expect(ribbon()?.textContent).toContain('Готово');
    await tick(budget - 1);
    expect(ribbon()).not.toBeNull();
    await tick(1);
    expect(ribbon()).toBeNull();
  });

  it('keeps errors until explicitly dismissed', async () => {
    await notify('Не удалось сохранить', 'error');
    await tick(120_000);
    expect(ribbon()?.textContent).toContain('Не удалось сохранить');
    await act(async () => close().click());
    expect(ribbon()).toBeNull();
  });

  it('counts neither hover nor focus time and resumes only when both end', async () => {
    await notify('Готово');
    await tick(1000);
    await mouse('mouseover');
    await act(async () => close().focus());
    await tick(20_000);
    await mouse('mouseout');
    await tick(20_000);
    expect(ribbon()).not.toBeNull();
    await act(async () => close().blur());
    await tick(3499);
    expect(ribbon()).not.toBeNull();
    await tick(1);
    expect(ribbon()).toBeNull();
  });

  it('resets duplicate budgets without replacing the focused close button', async () => {
    await notify('Готово');
    await tick(4000);
    const button = close();
    await act(async () => button.focus());
    await notify('Готово');
    expect(close()).toBe(button);
    expect(document.activeElement).toBe(button);
    await act(async () => button.blur());
    await tick(4499);
    expect(ribbon()).not.toBeNull();
    await tick(1);
    expect(ribbon()).toBeNull();
  });

  it('cancels the previous message deadline when a new message replaces it', async () => {
    await notify('Первое');
    await tick(4000);
    await notify('Второе', 'info');
    await tick(500);
    expect(ribbon()?.textContent).toContain('Второе');
    await tick(4499);
    expect(ribbon()).not.toBeNull();
    await tick(1);
    expect(ribbon()).toBeNull();
  });

  it('portals one ribbon and retains both announcement nodes without duplicating live text', async () => {
    const status = document.querySelector('[role="status"]');
    const alert = document.querySelector('[role="alert"]');
    expect(status).not.toBeNull();
    expect(alert).not.toBeNull();
    await notify('<img src=x onerror=alert(1)>');
    expect(host.querySelector('.system-feedback-viewport')).toBeNull();
    expect(document.body.querySelectorAll('.system-feedback-ribbon')).toHaveLength(1);
    expect(ribbon()!.closest('.system-feedback-viewport')).not.toBeNull();
    expect(ribbon()!.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(ribbon()!.querySelector('img')).toBeNull();
    expect(ribbon()!.closest('[aria-live], [role="status"], [role="alert"]')).toBeNull();
    expect(ribbon()!.querySelector('[aria-live], [role="status"], [role="alert"]')).toBeNull();
    expect(status!.textContent).toContain('<img src=x onerror=alert(1)>');
    await notify('Ошибка', 'error');
    expect(document.querySelector('[role="status"]')).toBe(status);
    expect(document.querySelector('[role="alert"]')).toBe(alert);
    expect(alert!.textContent).toContain('Ошибка');
    await act(async () => close().click());
    expect(document.querySelector('[role="status"]')).toBe(status);
    expect(document.querySelector('[role="alert"]')).toBe(alert);
  });

  it('renders no ribbon when no visible portal header exists', async () => {
    await act(async () => root!.unmount());
    header.remove();
    root = createRoot(host);
    await render();
    await notify('Нельзя показывать без шапки');
    await tick(32);
    expect(ribbon()).toBeNull();
  });

  it('rejects stale handles even when the scope string is reused', async () => {
    const old = scope;
    scope = activateSystemFeedbackScope('class:a');
    await act(async () => {
      old.notify('Устарело', 'error');
    });
    expect(ribbon()).toBeNull();
    await notify('Актуально');
    const current = getSystemFeedbackSnapshot();
    await act(async () => {
      old.clear();
      old.dispose();
    });
    expect(getSystemFeedbackSnapshot()).toBe(current);
    expect(ribbon()?.textContent).toContain('Актуально');
    await act(async () => {
      scope.dispose();
      scope.notify('После dispose', 'error');
    });
    expect(ribbon()).toBeNull();
  });

  it('releases timers and subscriptions on unmount', async () => {
    await notify('Готово');
    await act(async () => root!.unmount());
    root = undefined;
    expect(document.querySelector('.system-feedback-viewport')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => {
      scope.notify('После unmount', 'error');
    });
    expect(document.querySelector('.system-feedback-viewport')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('resumes expiry after hidden placement removes hovered and focused controls', async () => {
    await notify('Готово');
    await tick(1000);
    await mouse('mouseover');
    await act(async () => close().focus());
    await act(async () => {
      header.style.display = 'none';
    });
    await tick(32);
    expect(ribbon()).toBeNull();
    await tick(20_000);
    await act(async () => {
      header.style.display = 'block';
    });
    await tick(32);
    expect(ribbon()).not.toBeNull();
    expect(document.activeElement).not.toBe(close());
    await tick(4500);
    expect(ribbon()).toBeNull();
  });

  it('tracks a preceding sibling resizing without header or window resize', async () => {
    const sibling = document.createElement('div');
    header.before(sibling);
    try {
      await notify('Готово');
      expect(resizeCallbacks.has(sibling)).toBe(true);
      vi.mocked(header.getBoundingClientRect).mockReturnValue(new DOMRect(0, 32, 1024, 64));
      await act(async () => {
        for (const callback of resizeCallbacks.get(sibling) ?? []) callback();
      });
      await tick(32);
      expect(document.querySelector<HTMLElement>('.system-feedback-viewport')?.style.top).toBe(
        '96px',
      );
    } finally {
      sibling.remove();
    }
  });
});
