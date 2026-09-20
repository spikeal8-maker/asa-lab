/* @vitest-environment jsdom */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  UltrasonicDistanceControls,
  type UltrasonicDistanceComponentTypeId,
} from '../UltrasonicDistanceControls';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let root: Root | null = null;

function render(
  type: UltrasonicDistanceComponentTypeId,
  distanceMeters: number,
  onChange = vi.fn(),
) {
  host ??= document.body.appendChild(document.createElement('div'));
  root ??= createRoot(host);
  act(() =>
    root!.render(
      createElement(UltrasonicDistanceControls, {
        componentTypeId: type,
        distanceMeters,
        onChange,
      }),
    ),
  );
  return onChange;
}

function distanceInput(): HTMLInputElement {
  return host!.querySelector(
    'input[aria-label="Расстояние ультразвукового датчика, м"]',
  ) as HTMLInputElement;
}

function changeDistance(value: string): void {
  const input = distanceInput();
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!setValue) throw new Error('Missing native HTMLInputElement value setter.');
  act(() => {
    setValue.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host?.remove();
  host = null;
});

describe('shared ultrasonic distance controls', () => {
  it('uses the PING 0.02..3.0 m range and emits a valid distance', () => {
    const onChange = render('ultrasonic-sensor', 0.5);
    expect(host!.textContent).toContain('Расстояние, м');
    expect(distanceInput().min).toBe('0.02');
    expect(distanceInput().max).toBe('3');
    changeDistance('1');
    expect(onChange).toHaveBeenCalledWith(1);
  });

  it('uses the HC-SR04 0.02..4.0 m range and emits a valid distance', () => {
    const onChange = render('ultrasonic-hc-sr04', 0.5);
    expect(distanceInput().min).toBe('0.02');
    expect(distanceInput().max).toBe('4');
    changeDistance('1');
    expect(onChange).toHaveBeenCalledWith(1);
  });
});
