// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InfoHint } from '../../apps/web/src/components/InfoHint';

let root: Root;
let container: HTMLElement;
beforeEach(async () => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      createElement(InfoHint, {
        label: 'Информация об аватаре',
        children: 'Выбор сохраняется после «Использовать».',
      }),
    ),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});
const trigger = () => container.querySelector('button')!;
const popup = () => document.querySelector('[role="tooltip"]');
async function pointer(element: Element, type: string, pointerType = 'mouse') {
  await act(async () => {
    const event = new MouseEvent(type, { bubbles: true });
    Object.defineProperty(event, 'pointerType', { value: pointerType });
    element.dispatchEvent(event);
  });
}
describe('information affordance', () => {
  it('switches from a pinned explanation to an adjacent hover without overlapping popups', async () => {
    await act(async () =>
      root.render(
        createElement(
          'div',
          {},
          createElement(InfoHint, { label: 'Первое пояснение', children: 'Первый параметр' }),
          createElement(InfoHint, { label: 'Второе пояснение', children: 'Второй параметр' }),
        ),
      ),
    );
    const [first, second] = [...container.querySelectorAll('button')];
    await act(async () => first!.focus());
    await act(async () => first!.click());
    await pointer(second!, 'pointerover');
    await pointer(second!, 'pointermove');
    expect(document.querySelectorAll('[role="tooltip"]')).toHaveLength(1);
    expect(popup()?.textContent).toBe('Второй параметр');
    expect(first!.getAttribute('aria-expanded')).toBe('false');
    await act(async () => second!.focus());
    expect(document.querySelectorAll('[role="tooltip"]')).toHaveLength(1);
    await act(async () => second!.click());
    await pointer(first!, 'pointerdown', 'touch');
    await act(async () => first!.click());
    expect(document.querySelectorAll('[role="tooltip"]')).toHaveLength(1);
    expect(popup()?.textContent).toBe('Первый параметр');
  });
  it('has a concrete accessible name and no permanent explanatory copy', () => {
    expect(trigger().getAttribute('aria-label')).toBe('Информация об аватаре');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(popup()).toBeNull();
  });
  it('opens on keyboard focus and Escape dismisses it without moving focus', async () => {
    await act(async () => trigger().focus());
    expect(popup()?.textContent).toContain('после «Использовать»');
    expect(trigger().getAttribute('aria-describedby')).toBe(popup()?.id);
    await act(async () =>
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
    );
    expect(popup()).toBeNull();
    expect(document.activeElement).toBe(trigger());
    await act(async () => trigger().blur());
    await act(async () => trigger().focus());
    expect(popup()).not.toBeNull();
  });
  it('allows a pointer to move from the icon into the explanation', async () => {
    vi.useFakeTimers();
    await pointer(trigger(), 'pointerover');
    await pointer(trigger(), 'pointermove');
    expect(popup()).not.toBeNull();
    await pointer(trigger(), 'pointerout');
    await pointer(popup()!, 'pointerover');
    await act(async () => vi.advanceTimersByTime(200));
    expect(popup()).not.toBeNull();
    await pointer(popup()!, 'pointerout');
    await act(async () => vi.advanceTimersByTime(200));
    expect(popup()).toBeNull();
  });
  it('requires pointer movement after an icon is uncovered beneath a stationary pointer', async () => {
    await pointer(trigger(), 'pointerover');
    expect(popup()).toBeNull();
    await pointer(trigger(), 'pointermove');
    expect(popup()).not.toBeNull();
    await pointer(document.body, 'pointerdown');
    expect(popup()).toBeNull();
    await act(async () => trigger().focus());
    expect(popup()).not.toBeNull();
    await act(async () => trigger().blur());
    await act(async () => trigger().click());
    expect(popup()).not.toBeNull();
    await pointer(document.body, 'pointerdown');
    expect(popup()).toBeNull();
  });
  it('keyboard focus leaving the trigger dismisses the explanation', async () => {
    await act(async () => trigger().focus());
    expect(popup()).not.toBeNull();
    await act(async () => trigger().blur());
    expect(popup()).toBeNull();
  });
  it('keyboard activation does not keep a popup open after focus moves to another control', async () => {
    const next = document.createElement('button');
    container.append(next);
    await act(async () => trigger().focus());
    await act(async () => trigger().click());
    expect(popup()).not.toBeNull();
    await act(async () => next.focus());
    expect(popup()).toBeNull();
  });
  it('touch hover does not open; tapping toggles and an outside press dismisses', async () => {
    await pointer(trigger(), 'pointerover', 'touch');
    await pointer(trigger(), 'pointermove', 'touch');
    expect(popup()).toBeNull();
    await act(async () => trigger().click());
    expect(popup()).not.toBeNull();
    await act(async () => trigger().click());
    expect(popup()).toBeNull();
    await act(async () => trigger().click());
    await pointer(document.body, 'pointerdown', 'touch');
    expect(popup()).toBeNull();
  });
  it('unmount removes the open popup and its dismiss listeners', async () => {
    await act(async () => trigger().click());
    expect(popup()).not.toBeNull();
    await act(async () => root.render(null));
    expect(popup()).toBeNull();
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
  for (const visibilityLoss of ['hidden panel', 'display none', 'hidden trigger', 'hidden class'])
    it(`dismisses a pinned body popup when its owner has ${visibilityLoss}`, async () => {
      const style = document.createElement('style');
      style.textContent = '.test-hidden-hint-owner { display: none; }';
      document.head.append(style);
      try {
        await act(async () => trigger().focus());
        await act(async () => trigger().click());
        await act(async () => trigger().blur());
        expect(popup()).not.toBeNull();
        await act(async () => {
          if (visibilityLoss === 'hidden panel') container.hidden = true;
          else if (visibilityLoss === 'display none') container.style.display = 'none';
          else if (visibilityLoss === 'hidden trigger') trigger().style.visibility = 'hidden';
          else container.classList.add('test-hidden-hint-owner');
        });
        expect(popup()).toBeNull();
        expect(trigger().getAttribute('aria-expanded')).toBe('false');
        expect(trigger().hasAttribute('aria-describedby')).toBe(false);
        await act(async () => {
          container.hidden = false;
          container.style.display = '';
          container.className = '';
          trigger().style.visibility = '';
        });
        expect(popup()).toBeNull();
        await act(async () => trigger().click());
        expect(popup()).not.toBeNull();
      } finally {
        style.remove();
      }
    });
  it('dismisses a pinned popup when a still-mounted owning subtree is detached', async () => {
    await act(async () => trigger().click());
    expect(popup()).not.toBeNull();
    await act(async () => container.remove());
    expect(popup()).toBeNull();
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    await act(async () => document.body.append(container));
    expect(popup()).toBeNull();
    await act(async () => trigger().click());
    expect(popup()).not.toBeNull();
  });
  it('dismisses the dialog-hosted popup when its owning dialog closes without unmounting', async () => {
    await act(async () =>
      root.render(
        createElement(
          'dialog',
          { open: true },
          createElement(InfoHint, { label: 'Информация об аватаре', children: 'Внутри окна' }),
        ),
      ),
    );
    const dialog = container.querySelector('dialog')!;
    await act(async () => trigger().click());
    expect(popup()?.parentElement).toBe(dialog);
    await act(async () => {
      dialog.open = false;
    });
    expect(popup()).toBeNull();
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
  });
  it('keeps a pinned popup through unrelated visible owner updates and visible reparenting', async () => {
    const newParent = document.createElement('div');
    document.body.append(newParent);
    try {
      await act(async () => trigger().click());
      await act(async () => {
        container.classList.add('visible-owner');
        container.style.color = 'blue';
        container.append(document.createElement('span'));
        newParent.append(container);
      });
      expect(popup()).not.toBeNull();
      expect(trigger().getAttribute('aria-expanded')).toBe('true');
      await act(async () => {
        newParent.hidden = true;
      });
      expect(popup()).toBeNull();
      expect(trigger().getAttribute('aria-expanded')).toBe('false');
    } finally {
      document.body.append(container);
      newParent.remove();
    }
  });
  it('observes visibility only while open and releases its owner observation on close', async () => {
    const observe = vi.spyOn(MutationObserver.prototype, 'observe');
    const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
    try {
      expect(observe).not.toHaveBeenCalled();
      await act(async () => trigger().click());
      expect(observe).toHaveBeenCalledWith(container, {
        attributes: true,
        attributeFilter: ['hidden', 'style', 'class', 'open'],
        childList: true,
      });
      const observedWhileOpen = observe.mock.calls.length;
      const disconnectedWhileOpen = disconnect.mock.calls.length;
      await act(async () => trigger().click());
      expect(popup()).toBeNull();
      expect(disconnect.mock.calls.length).toBeGreaterThan(disconnectedWhileOpen);
      await act(async () => {
        container.hidden = true;
      });
      expect(observe).toHaveBeenCalledTimes(observedWhileOpen);
    } finally {
      observe.mockRestore();
      disconnect.mockRestore();
    }
  });
});
