/* @vitest-environment jsdom */
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { SimulationSpeedControl } from '../SimulationSpeedControl';
import { SimulationPacing } from '../simulation-pacing';

it('opens an accessible slider, pauses/resumes at the last rate and closes with Escape/outside', async () => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  const pacing = new SimulationPacing();
  const onChange = (rate: number) => {
    pacing.request(rate);
    if (!rate) pacing.settlePause();
  };
  try {
    await act(async () =>
      root.render(
        createElement(SimulationSpeedControl, { pacing, onChange, children: '00:00:00' }),
      ),
    );
    const button = host.querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]')!;
    await act(async () => button.click());
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const slider = host.querySelector<HTMLInputElement>('input[type=range]')!;
    const change = async (value: string) =>
      act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
          slider,
          value,
        );
        slider.dispatchEvent(new Event('input', { bubbles: true }));
      });
    await change('19');
    expect(pacing.read().rate).toBe(10);
    expect(slider.getAttribute('aria-valuetext')).toBe('×10');
    await change('0');
    expect(pacing.read().phase).toBe('paused');
    const resume = [...host.querySelectorAll('button')].find(
      (b) => b.textContent === 'Продолжить ×10',
    )!;
    await act(async () => resume.click());
    expect(pacing.read().rate).toBe(10);
    await act(async () =>
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
    );
    expect(host.querySelector('[role=dialog]')).toBeNull();
    expect(document.activeElement).toBe(button);
    await act(async () => button.click());
    await act(async () => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })));
    expect(host.querySelector('[role=dialog]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
