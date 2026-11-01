// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { instrumentReadoutStyle, multimeterRuntimeMarkup } from '../production-asset-contracts';

const root = resolve(process.cwd(), 'apps/web/src/electronics');
const stage = readFileSync(resolve(root, 'WorkbenchStage.tsx'), 'utf8');
const visual = readFileSync(resolve(root, 'ProductionComponentVisual.tsx'), 'utf8');
const js = (source: string) =>
  ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
const wireHandler = js(
  stage.slice(
    stage.indexOf('  function handleWirePointerDown('),
    stage.indexOf('  const orderedComponents ='),
  ),
);
const meterFunction = js(
  visual.slice(
    visual.indexOf('function OwnerMultimeterVisual('),
    visual.indexOf('function OwnerPiezoVisual('),
  ),
);

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function routing({
  output = 'false',
  pending = false,
  ordinary = false,
  owner = 'psu',
  runtime = true,
  duplicate = false,
  switchRect = true,
} = {}) {
  document.body.innerHTML = `<svg><path id="wire"/><g data-component-id="${owner}">${runtime ? `<svg class="workbench-regulated-supply-runtime" data-output-enabled="${output}">` : ''}<${switchRect ? 'rect' : 'path'} id="switch" class="workbench-regulated-supply-power-switch"/>${runtime ? '</svg>' : ''}${duplicate ? '<svg class="workbench-regulated-supply-runtime"/>' : ''}</g></svg>`;
  Object.defineProperty(document, 'elementsFromPoint', {
    configurable: true,
    value: () => [document.getElementById('wire'), document.getElementById('switch')],
  });
  const c = {
    pendingTerminal: pending,
    setRegulatedPowerSupplyControls: vi.fn(),
    selectComponent: vi.fn(),
    startComponentDrag: vi.fn(),
    documentMutationEpoch: () => 7,
    setSelection: vi.fn(),
    startSegmentDrag: vi.fn(),
    addWireVertexAt: vi.fn(),
  };
  const event = {
    clientX: 325.1362,
    clientY: 326.2483,
    shiftKey: false,
    stopPropagation: vi.fn(),
    preventDefault: vi.fn(),
  };
  const lastWireClick = { current: null };
  const handler = runInNewContext(`${wireHandler}; handleWirePointerDown`, {
    window: { document },
    c,
    componentAtClientPoint: () => ({
      id: 'psu',
      componentTypeId: ordinary ? 'resistor' : 'regulated-power-supply',
    }),
    wiresAboveComponentBody: (part: { componentTypeId: string }) =>
      part.componentTypeId === 'regulated-power-supply',
    lastWireClick,
    pointerSequenceRef: { current: 3 },
    isRepeatedClick: () => false,
  });
  handler(event, 'psu-cross');
  return { c, event, lastWireClick };
}

describe('native PSU switch beneath the wire hit target', () => {
  it.each(['true', 'false'])('routes one native command from explicit %s state', (output) => {
    const { c, event, lastWireClick } = routing({ output });
    expect(c.setRegulatedPowerSupplyControls).toHaveBeenCalledExactlyOnceWith('psu', {
      outputEnabled: output === 'false',
    });
    expect(c.setSelection).not.toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
    expect(lastWireClick.current).toBeNull();
  });
  it.each([
    { output: '' },
    { output: 'unknown' },
    { output: 'TRUE' },
    { runtime: false },
    { owner: 'other' },
    { duplicate: true },
    { switchRect: false },
  ])('falls through without actuation for %j', (options) => {
    const { c } = routing(options);
    expect(c.setRegulatedPowerSupplyControls).not.toHaveBeenCalled();
    expect(c.setSelection).toHaveBeenCalledExactlyOnceWith({ kind: 'wire', id: 'psu-cross' });
  });
  it('preserves pending wire and ordinary foreground precedence', () => {
    const pending = routing({ pending: true });
    expect(pending.c.setRegulatedPowerSupplyControls).not.toHaveBeenCalled();
    expect(pending.event.stopPropagation).not.toHaveBeenCalled();
    const ordinary = routing({ ordinary: true });
    expect(ordinary.c.setRegulatedPowerSupplyControls).not.toHaveBeenCalled();
    expect(ordinary.c.startComponentDrag).toHaveBeenCalledTimes(1);
  });
});

const ownerSvg = `<svg viewBox="0 0 474 247"><path d="M415 72 A13 13 0 1 0 389 72 A13 13 0 1 0 415 72 Z"/><path d="M397 78 L402 66 L407 78 M399.3 73 H404.7"/><path d="M415 107 A13 13 0 1 0 389 107 A13 13 0 1 0 415 107 Z"/><path d="M397 101 L402 113 L407 101"/><path d="M415 139 A13 13 0 1 0 389 139 A13 13 0 1 0 415 139 Z"/><path d="M398.5 145.5 V132.5 H402.8 C405.5 132.5 406.8 134.2 406.8 136.2 C406.8 138.8 404.9 140 402.6 140 H398.5 M402 140 L407 145.5"/></svg>`;

describe('multimeter readout continuity', () => {
  it.each(['voltage', 'current', 'resistance'] as const)(
    'retains mounted owner controls and focus across %s readout updates',
    (measurementMode) => {
      const Component = runInNewContext(`${meterFunction}; OwnerMultimeterVisual`, {
        React,
        Element,
        useOwnerSvgSource: () => ({ source: ownerSvg, failed: false }),
        useMemo: React.useMemo,
        instrumentReadoutStyle,
        multimeterRuntimeMarkup,
      });
      const host = document.createElement('div');
      document.body.append(host);
      const mounted = createRoot(host);
      const onModeChange = vi.fn();
      const render = (displayValue: string) =>
        flushSync(() =>
          mounted.render(
            React.createElement(Component, {
              asset: 'owner.svg',
              width: 160,
              height: 83,
              measurementMode,
              displayValue,
              measuredValue: -12.345,
              onModeChange,
            }),
          ),
        );
      try {
        render('1.000 V');
        const svg = host.querySelector('svg')!;
        const owner = svg.querySelector('g')!;
        const button = owner.querySelector<SVGElement>('.workbench-multimeter-mode-current')!;
        // Add only focusability to the real owner path: a detached replacement
        // cannot retain either this node identity or its active focus.
        button.setAttribute('tabindex', '0');
        button.focus();
        expect(document.activeElement).toBe(button);
        for (const value of [
          '2.000 V',
          '',
          '0.000 V',
          '-12.345 A',
          'ОШИБКА',
          'ОБРЫВ',
          '123456789012345 kΩ',
          '<img>&"',
          '+0.000 Ω',
        ]) {
          render(value);
          expect(host.querySelector('svg')).toBe(svg);
          expect(svg.querySelector('g')).toBe(owner);
          expect(owner.querySelector('.workbench-multimeter-mode-current')).toBe(button);
          expect(button.isConnected).toBe(true);
          expect(document.activeElement).toBe(button);
          expect(svg.querySelectorAll('.workbench-multimeter-mode-button')).toHaveLength(3);
          const reading = svg.querySelector('.workbench-multimeter-reading');
          expect(reading?.textContent ?? '').toBe(value);
          if (reading) {
            expect(reading.parentElement).toBe(svg);
            expect(reading.children).toHaveLength(0);
            expect(reading.getAttribute('x')).toBe('218.5');
            expect(reading.getAttribute('y')).toBe('108');
          }
        }
        expect(svg.getAttribute('viewBox')).toBe('0 0 474 247');
        expect(svg.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet');
        flushSync(() => button.dispatchEvent(new Event('pointerdown', { bubbles: true })));
        expect(onModeChange).toHaveBeenCalledExactlyOnceWith('dc-current');
      } finally {
        flushSync(() => mounted.unmount());
      }
    },
  );
});
