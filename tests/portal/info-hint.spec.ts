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
    expect(popup()).not.toBeNull();
    await pointer(trigger(), 'pointerout');
    await pointer(popup()!, 'pointerover');
    await act(async () => vi.advanceTimersByTime(200));
    expect(popup()).not.toBeNull();
    await pointer(popup()!, 'pointerout');
    await act(async () => vi.advanceTimersByTime(200));
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
});
