/* @vitest-environment jsdom */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PirSensorControls } from '../PirSensorControls';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let root: Root | null = null;

function render(motionDetected: boolean, onChange = vi.fn()) {
  host ??= document.body.appendChild(document.createElement('div'));
  root ??= createRoot(host);
  act(() => root!.render(createElement(PirSensorControls, { motionDetected, onChange })));
  return onChange;
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host?.remove();
  host = null;
});

describe('PIR sensor controls', () => {
  it('shows canonical motion truth and emits boolean changes', () => {
    const onChange = render(false);
    expect(host!.textContent).toContain('Движение');
    expect(host!.textContent).toContain('нет');
    const checkbox = host!.querySelector(
      'input[aria-label="Имитировать движение PIR"]',
    ) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    act(() => checkbox.click());
    expect(onChange).toHaveBeenCalledWith(true);

    render(true, onChange);
    expect(host!.textContent).toContain('обнаружено');
    expect(
      (host!.querySelector('input[aria-label="Имитировать движение PIR"]') as HTMLInputElement)
        .checked,
    ).toBe(true);
  });
});
