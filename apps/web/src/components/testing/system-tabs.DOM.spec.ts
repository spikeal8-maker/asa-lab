// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SystemTabs } from '../SystemTabs';

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function buttons(): HTMLButtonElement[] {
  return [...host.querySelectorAll<HTMLButtonElement>('nav > button')];
}
async function press(button: HTMLButtonElement, key: string) {
  await act(async () => {
    button.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

describe('SystemTabs live section navigation', () => {
  it('supports Arrow, Home and End, skips disabled controls, and never changes section on focus', async () => {
    const onChange = vi.fn();
    await act(async () => {
      root.render(
        createElement(SystemTabs, {
          items: [
            { id: 'classes', label: 'Классы' },
            { id: 'archives', label: 'Архив', disabled: true },
            { id: 'settings', label: 'Настройки' },
          ],
          active: 'classes',
          onChange,
          label: 'Разделы класса',
        }),
      );
    });
    const [first, disabled, last] = buttons();
    expect(disabled.disabled).toBe(true);
    first.focus();
    await press(first, 'ArrowRight');
    expect(document.activeElement).toBe(last);
    expect(onChange).not.toHaveBeenCalled();
    expect(first.getAttribute('aria-current')).toBe('page');
    await press(last, 'Home');
    expect(document.activeElement).toBe(first);
    await press(first, 'End');
    expect(document.activeElement).toBe(last);
    await press(last, 'ArrowRight');
    expect(document.activeElement).toBe(first);
    await act(async () => last.click());
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith('settings');
  });

  it('keeps the student profile aria-pressed contract and short-label accessibility', async () => {
    const onChange = vi.fn();
    await act(async () => {
      root.render(
        createElement(SystemTabs, {
          items: [
            { id: 'works', label: 'Все работы', compactLabel: 'Работы' },
            { id: 'awards', label: 'Заслуги' },
          ],
          active: 'awards',
          onChange,
          label: 'Разделы профиля',
          className: 'participant-tabs',
          selectedState: 'pressed',
        }),
      );
    });
    const [works, awards] = buttons();
    expect(host.querySelector('nav')?.getAttribute('aria-label')).toBe('Разделы профиля');
    expect(works.getAttribute('aria-label')).toBe('Все работы');
    expect(works.getAttribute('aria-pressed')).toBe('false');
    expect(awards.getAttribute('aria-pressed')).toBe('true');
    expect(awards.hasAttribute('aria-current')).toBe(false);
    await act(async () => works.click());
    expect(onChange).toHaveBeenCalledWith('works');
  });
});
