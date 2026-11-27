/* @vitest-environment jsdom */
import { act, createElement, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { SimulationSpeedControl } from '../SimulationSpeedControl';
import { SimulationPacing } from '../simulation-pacing';
import { NativeOpticalPresentation } from '../native-optical-presentation';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

it('opens an accessible slider, pauses/resumes at the last rate and closes with Escape/outside', async () => {
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
    const button = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Изменить скорость моделирования"][aria-haspopup="dialog"]',
    )!;
    await act(async () => button.click());
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const slider = host.querySelector<HTMLInputElement>(
      '[role="dialog"][aria-label="Скорость моделирования"] input[type="range"]',
    )!;
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

it('measures committed progress, reports a stall and discards samples across lifecycle changes', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] });
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  const pacing = new SimulationPacing();
  const port = new NativeOpticalPresentation();
  const onChange = (rate: number) => {
    pacing.request(rate);
    if (rate === 0) pacing.settlePause();
  };
  const displayedOnCommit: (string | null)[] = [];
  function ObservedSpeedControl({
    committedClock,
  }: {
    committedClock: NativeOpticalPresentation | null;
  }) {
    useLayoutEffect(() => {
      displayedOnCommit.push(host.querySelector('.workbench-simulation-rate')?.textContent ?? null);
    }, [committedClock]);
    return createElement(SimulationSpeedControl, {
      pacing,
      committedClock,
      onChange,
      children: null,
    });
  }
  const render = (committedClock: NativeOpticalPresentation | null) =>
    act(async () => root.render(createElement(ObservedSpeedControl, { committedClock })));
  const advance = (elapsed: number, committed?: number) =>
    act(async () => {
      if (committed !== undefined) port.setClock(committed);
      vi.advanceTimersByTime(elapsed);
    });
  const badge = () => host.querySelector('.workbench-simulation-rate');
  const panel = () => host.querySelector('[role="dialog"]')?.textContent;
  try {
    await render(null);
    await advance(1000);
    expect(badge()?.textContent).toBe('—');
    expect(vi.getTimerCount()).toBe(0);
    await render(port);

    await act(async () => onChange(2));
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-haspopup]')!.click());
    await advance(999, 250_000);
    expect(badge()?.textContent).toBe('—');
    await advance(1);
    expect(badge()?.textContent).toBe('×0,25');
    expect(panel()).toContain('Медленнее выбранной');
    expect(panel()).toContain('Скорость моделирования: ×2');

    await advance(1000);
    expect(badge()?.textContent).toBe('×0');

    await act(async () => onChange(0.1));
    expect(badge()?.textContent).toBe('—');
    await advance(1000, 350_000);
    expect(badge()?.textContent).toBe('×0,1');
    expect(panel()).not.toContain('Медленнее выбранной');
    await advance(1000, 351_000);
    expect(badge()?.textContent).toBe('<×0,01');
    expect(panel()).toContain('Медленнее выбранной');

    await act(async () => onChange(0));
    await advance(1000, 400_000);
    expect(badge()?.textContent).toBe('Пауза');
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => onChange(0.1));
    await advance(1000, 500_000);

    await act(async () => {
      hidden.mockReturnValue(true);
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await advance(2000, 750_000);
    expect(badge()?.textContent).toBe('—');
    expect(vi.getTimerCount()).toBe(0);

    await act(async () => {
      hidden.mockReturnValue(false);
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await advance(1000, 850_000);
    expect(badge()?.textContent).toBe('×0,1');
    await advance(0, 0);
    expect(badge()?.textContent).toBe('—');
    await advance(1000, 100_000);
    expect(badge()?.textContent).toBe('×0,1');

    const replacement = new NativeOpticalPresentation();
    replacement.setClock(9_000_000);
    await render(replacement);
    expect(displayedOnCommit.at(-1)).toBe('—');
    await advance(1000, 200_000);
    expect(badge()?.textContent).toBe('×0');
    await act(async () => replacement.setClock(9_100_000));
    await advance(1000);
    expect(badge()?.textContent).toBe('×0,1');
  } finally {
    await act(async () => root.unmount());
    host.remove();
    const remainingTimers = vi.getTimerCount();
    hidden.mockRestore();
    vi.useRealTimers();
    expect(remainingTimers).toBe(0);
  }
});
