// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import {
  regulatedPowerSupplyRuntimeMarkup,
  signalGeneratorRuntimeMarkup,
} from '../production-asset-contracts';

const source = readFileSync(
  resolve(process.cwd(), 'apps/web/src/electronics/ProductionComponentVisual.tsx'),
  'utf8',
);
const region = source.slice(
  source.indexOf('function knobPointerRatio('),
  source.indexOf('function OwnerOscilloscopeVisual('),
);
// Execute the actual private source without widening its production exports.
const code = ts.transpileModule(region, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
}).outputText;
class Point {
  constructor(
    readonly x: number,
    readonly y: number,
  ) {}
  matrixTransform(matrix: { x: number; y: number }) {
    return matrix;
  }
}
function load(extra: Record<string, unknown> = {}) {
  return runInNewContext(
    `${code}; ({regulatedSupplyValueFromPointer, signalGeneratorValueFromPointer, knobDragHandlers, OwnerRegulatedPowerSupplyVisual, OwnerSignalGeneratorVisual})`,
    {
      React,
      Element,
      DOMPoint: Point,
      useState: React.useState,
      useMemo: React.useMemo,
      regulatedPowerSupplyRuntimeMarkup,
      signalGeneratorRuntimeMarkup,
      ...extra,
    },
  );
}
function pointer(x: number, y: number) {
  return {
    clientX: x,
    clientY: y,
    currentTarget: {
      getScreenCTM: () => ({
        inverse: () => ({ x, y }),
      }),
    },
  };
}

// Independent pre-change angle/clamp contract. Keep multiplication within the
// PSU clamp: clamping the ratio first changes floating-point/nonfinite results.
function reference(x: number, y: number, cx: number, cy: number) {
  let degrees = (Math.atan2(y - cy, x - cx) * 180) / Math.PI;
  if (degrees < 0) degrees += 360;
  if (degrees <= 45) degrees += 360;
  else if (degrees < 135) degrees = degrees < 90 ? 405 : 135;
  return (degrees - 135) / 270;
}

describe('actual instrument pointer conversions', () => {
  it('preserves exact PSU and generator results at arc seams and nonfinite inputs', () => {
    const api = load();
    const points: number[][] = [
      [0, 0],
      [NaN, 0],
      [0, NaN],
      [Infinity, 0],
      [-Infinity, Infinity],
      [-0, -0],
    ];
    for (const degrees of [
      -180, -135, -90, -45, -0, 0, 45, 45.000000001, 89.999999999, 90, 90.000000001, 134.999999999,
      135, 180, 270, 315, 360,
    ]) {
      for (const radius of [0, 0.001, 1, 170, 1e100]) {
        points.push([
          Math.cos((degrees * Math.PI) / 180) * radius,
          Math.sin((degrees * Math.PI) / 180) * radius,
        ]);
      }
    }
    for (const [dx, dy] of points) {
      for (const cy of [53, 145])
        for (const maximum of [0, -0, 5, 30, NaN, Infinity]) {
          const x = 234 + dx!,
            y = cy + dy!;
          expect(
            Object.is(
              api.regulatedSupplyValueFromPointer(pointer(x, y), cy, maximum),
              Math.min(maximum, Math.max(0, reference(x, y, 234, cy) * maximum)),
            ),
          ).toBe(true);
        }
      for (const [kind, cy] of [
        ['frequency', 82],
        ['amplitude', 174],
        ['offset', 265],
      ] as const) {
        const x = 267 + dx!,
          y = cy + dy!;
        const ratio = Math.min(1, Math.max(0, reference(x, y, 267, cy)));
        const expected =
          kind === 'frequency'
            ? Number((10 ** (ratio * 6)).toPrecision(3))
            : kind === 'amplitude'
              ? Math.round(ratio * 200) / 20
              : Math.round((ratio * 10 - 5) * 20) / 20;
        expect(
          Object.is(api.signalGeneratorValueFromPointer(pointer(x, y), cy, kind), expected),
        ).toBe(true);
      }
    }
  });

  it('keeps null CTM and inverse/transform errors observable without callbacks', () => {
    const api = load();
    const missing = { currentTarget: { getScreenCTM: () => null } };
    expect(api.regulatedSupplyValueFromPointer(missing, 53, 30)).toBeNull();
    expect(api.signalGeneratorValueFromPointer(missing, 82, 'frequency')).toBeNull();
    for (const location of ['getScreenCTM', 'inverse', 'transform']) {
      const error = new Error(location);
      const event = {
        currentTarget: {
          getScreenCTM: () => {
            if (location === 'getScreenCTM') throw error;
            return {
              inverse: () => {
                if (location === 'inverse') throw error;
                return {};
              },
            };
          },
        },
      };
      const tested = load({
        DOMPoint: class {
          matrixTransform() {
            throw error;
          }
        },
      });
      expect(() => tested.regulatedSupplyValueFromPointer(event, 53, 30)).toThrow(error);
      expect(() => tested.signalGeneratorValueFromPointer(event, 82, 'frequency')).toThrow(error);
    }
  });
});

describe('actual shared drag handler lifetime', () => {
  it.each([true, false])('retains event/state/capture order for supply=%s', (supply) => {
    const { knobDragHandlers } = load();
    for (const active of [false, true])
      for (const captured of [false, true]) {
        const trace: string[] = [];
        const handlers = knobDragHandlers(
          active ? 'voltage' : null,
          () => trace.push('clear'),
          () => trace.push('update'),
          supply,
        );
        const event = {
          pointerId: 17,
          preventDefault: () => trace.push('prevent'),
          stopPropagation: () => trace.push('stop'),
          currentTarget: {
            hasPointerCapture: (id: number) => {
              expect(id).toBe(17);
              trace.push('has');
              return captured;
            },
            releasePointerCapture: (id: number) => {
              expect(id).toBe(17);
              trace.push('release');
            },
          },
        };
        handlers.onPointerMove(event);
        expect(trace).toEqual(!active ? [] : supply ? ['update', 'prevent', 'stop'] : ['update']);
        trace.length = 0;
        handlers.onPointerUp(event);
        expect(trace).toEqual(
          !active
            ? []
            : [
                ...(!supply ? ['clear'] : []),
                'has',
                ...(captured ? ['release'] : []),
                ...(supply ? ['clear', 'prevent', 'stop'] : []),
              ],
        );
        trace.length = 0;
        handlers.onPointerCancel();
        expect(trace).toEqual(['clear']);
      }
  });

  it.each([true, false])('preserves exception side effects for supply=%s', (supply) => {
    const { knobDragHandlers } = load();
    for (const failure of ['update', 'has', 'release', 'clear']) {
      const trace: string[] = [],
        error = new Error(failure);
      const call = (name: string) => {
        trace.push(name);
        if (name === failure) throw error;
      };
      const handlers = knobDragHandlers(
        'frequency',
        () => call('clear'),
        () => call('update'),
        supply,
      );
      const event = {
        pointerId: 5,
        preventDefault: () => call('prevent'),
        stopPropagation: () => call('stop'),
        currentTarget: {
          hasPointerCapture: () => {
            call('has');
            return true;
          },
          releasePointerCapture: () => call('release'),
        },
      };
      if (failure === 'update') {
        expect(() => handlers.onPointerMove(event)).toThrow(error);
        expect(trace).toEqual(['update']);
      } else {
        expect(() => handlers.onPointerUp(event)).toThrow(error);
        const order = supply ? ['has', 'release', 'clear'] : ['clear', 'has', 'release'];
        expect(trace).toEqual(order.slice(0, order.indexOf(failure) + 1));
      }
    }
  });
});

describe('mounted actual instrument controls', () => {
  it.each([true, false])(
    'keeps root viewport and control/capture actions for supply=%s',
    (supply) => {
      const ownerPath = supply ? 'power/regulated-power-supply' : 'instruments/signal-generator';
      const ownerSvg = readFileSync(
        resolve(
          process.cwd(),
          `apps/web/public/assets/electronics/component-database/components/${ownerPath}/component.svg`,
        ),
        'utf8',
      );
      const api = load({ useOwnerSvgSource: () => ({ source: ownerSvg, failed: false }) });
      const Component = supply
        ? api.OwnerRegulatedPowerSupplyVisual
        : api.OwnerSignalGeneratorVisual;
      const host = document.createElement('div');
      document.body.append(host);
      const mounted = createRoot(host),
        onChange = vi.fn();
      const props = {
        asset: 'owner.svg',
        width: 294,
        height: 237,
        component: { value: 5, state: true, stateProperties: {} },
        simulationRunning: false,
        onChange,
      };
      const render = (width: number) =>
        flushSync(() => mounted.render(React.createElement(Component, { ...props, width })));
      try {
        render(294);
        const svg = host.querySelector('svg')!;
        expect(svg.getAttribute('viewBox')).toBe(supply ? '0 0 294 237' : '0 0 579 405');
        expect(svg.getAttribute('preserveAspectRatio')).toBe(supply ? null : 'xMidYMid meet');
        expect([svg.getAttribute('x'), svg.getAttribute('y')]).toEqual(['0', '0']);
        const control = svg.querySelector(
          supply ? '.workbench-regulated-supply-power-switch' : '.workbench-signal-generator-power',
        )!;
        for (const width of [390, 1024, 1440]) {
          render(width);
          expect(host.querySelector('svg')).toBe(svg);
          expect(svg.contains(control)).toBe(true);
          expect(svg.getAttribute('width')).toBe(String(width));
          expect(svg.getAttribute('height')).toBe('237');
        }
        const dispatch = (element: Element, type: string) => {
          const event = new Event(type, { bubbles: true, cancelable: true });
          Object.defineProperties(event, {
            pointerId: { value: 29 },
            clientX: { value: 400 },
            clientY: { value: 53 },
          });
          flushSync(() => element.dispatchEvent(event));
          return event;
        };
        expect(dispatch(control, 'pointerdown').defaultPrevented).toBe(true);
        expect(onChange).toHaveBeenCalledExactlyOnceWith({ outputEnabled: false });
        onChange.mockClear();
        const captures: number[] = [],
          releases: number[] = [];
        Object.assign(svg, {
          setPointerCapture: (id: number) => captures.push(id),
          hasPointerCapture: () => true,
          releasePointerCapture: (id: number) => releases.push(id),
          getScreenCTM: () => ({ inverse: () => ({ x: 400, y: 53 }) }),
        });
        const selectors = supply
          ? ['.workbench-regulated-supply-voltage-knob', '.workbench-regulated-supply-current-knob']
          : [
              '.workbench-signal-generator-frequency',
              '.workbench-signal-generator-amplitude',
              '.workbench-signal-generator-offset',
            ];
        for (const selector of selectors) {
          const knob = svg.querySelector(selector)!;
          expect(knob).not.toBeNull();
          expect(dispatch(knob, 'pointerdown').defaultPrevented).toBe(true);
          expect(dispatch(svg, 'pointermove').defaultPrevented).toBe(supply);
          expect(dispatch(svg, 'pointerup').defaultPrevented).toBe(supply);
          const count = onChange.mock.calls.length;
          dispatch(svg, 'pointermove');
          expect(onChange.mock.calls).toHaveLength(count);
        }
        expect(captures).toEqual(selectors.map(() => 29));
        expect(releases).toEqual(captures);
        expect(onChange).toHaveBeenCalledTimes(selectors.length * 2);
        // jsdom uses an explicit CTM stub here. Native CTM/visual acceptance is
        // deliberately left to the existing real-pointer F2 browser cases.
      } finally {
        flushSync(() => mounted.unmount());
        host.remove();
      }
    },
  );
});
