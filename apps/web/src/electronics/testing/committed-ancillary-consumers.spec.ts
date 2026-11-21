/* @vitest-environment jsdom */
import { act, createElement, Profiler } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SchematicDocument, SolveResult } from '../../api';
import { NativeOpticalProvider, ProductionComponentVisual } from '../NativeOpticalComponentVisual';
import {
  NativeOpticalPresentation,
  type NativeOpticalObservation,
} from '../native-optical-presentation';
import {
  committedResultProjection,
  useCommittedWorkbenchPresentation,
} from '../committed-result-presentation';
import { configureProductionLibrary } from '../production-manifest-adapter';
import { catalogEntry, familyForVariant } from '../component-catalog';
import * as hitTesting from '../component-hit-testing';
import { WorkbenchComponentBody, WorkbenchDiagnosticIndicators } from '../WorkbenchStage';
import { WorkbenchInspector } from '../WorkbenchSidebars';
import type {
  CommittedPresentationController,
  WorkbenchComponentBodyController,
  WorkbenchDiagnosticIndicatorsController,
  WorkbenchInspectorController,
} from '../committed-result-presentation';
type FixtureController = WorkbenchComponentBodyController &
  WorkbenchDiagnosticIndicatorsController &
  WorkbenchInspectorController;

// Module registration is unrelated to presentation; retain all real electrical
// domain exports without requiring a generated module-SDK build locally.
vi.mock('../../../../../contexts/electronics/module.js', () => ({ ELECTRONICS_MODULE: {} }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
const schematic: SchematicDocument = {
  schemaVersion: 4,
  components: [
    {
      id: 'led',
      kind: 'led',
      componentTypeId: 'led-5mm',
      value: 2,
      position: { x: 0, y: 0 },
      stateProperties: { ledColour: 'red' },
    },
    { id: 'rgb', kind: 'rgb-led', componentTypeId: 'rgb-led', value: 2, position: { x: 80, y: 0 } },
  ],
  connections: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  simulation: { running: true, maxIterations: 24 },
};
function observation(failed = true): NativeOpticalObservation {
  return {
    result: {
      solved: true,
      status: 'solved',
      current: 0,
      nodes: [],
      iterations: 1,
      numericalResidual: 0,
      numericalTolerance: 1e-9,
      components: schematic.components.map((component) => ({
        componentId: component.id,
        current: 0.2,
        voltageDrop: 2,
        power: 0.4,
        terminalVoltages: {},
        presentationState: failed ? 'failed' : 'normal',
        lit: !failed,
        brightness: failed ? 0 : 100,
        temperatureCelsius: failed ? 175 : 25,
        branchBrightness: { red: failed ? 0 : 100 },
        branchCurrents: { red: failed ? 0 : 0.01 },
      })),
      diagnostics: failed
        ? [
            {
              code: 'led_burnout',
              severity: 'error',
              message: 'LED thermal failure',
              componentIds: ['led'],
            },
          ]
        : [],
    } satisfies SolveResult,
    frame: {
      token: String(failed),
      atMicroseconds: 10_396_700,
      brightness: new Map(),
      arduinoLStates: new Map(),
    },
    ledAssets: new Map(),
  };
}
let port: NativeOpticalPresentation;
let root: Root;
let host: HTMLDivElement;
let controller: FixtureController;
let parentRenders: number;
let projectionRenders: number;
const seenProjections: CommittedPresentationController[] = [];
function ProjectionProbe() {
  const projection = useCommittedWorkbenchPresentation(controller);
  projectionRenders++;
  seenProjections.push(projection);
  return null;
}
function Probe({ running = true }: { running?: boolean }) {
  parentRenders++;
  controller = { ...controller, simulationRunning: running };
  const rgb = schematic.components[1]!;
  const entry = catalogEntry(rgb);
  if (!entry) throw new Error('Missing RGB fixture catalog entry');
  return createElement(
    NativeOpticalProvider,
    { port },
    createElement(
      'svg',
      null,
      createElement(WorkbenchComponentBody, { controller, component: schematic.components[0]! }),
      createElement(WorkbenchDiagnosticIndicators, {
        controller,
        components: schematic.components,
      }),
      // This ordinary visual deliberately receives stale parent props.
      createElement(ProductionComponentVisual, {
        entry,
        component: rgb,
        width: 80,
        height: 80,
        visualState: 'default',
        simulationRunning: running,
      }),
      createElement(ProjectionProbe),
      createElement(ProjectionProbe),
    ),
    createElement(WorkbenchInspector, { controller }),
  );
}
beforeEach(() => {
  configureProductionLibrary(
    JSON.parse(
      readFileSync(
        resolve(
          process.cwd(),
          'apps/web/public/assets/electronics/component-database/catalog.json',
        ),
        'utf8',
      ),
    ),
  );
  port = new NativeOpticalPresentation();
  parentRenders = 0;
  projectionRenders = 0;
  seenProjections.length = 0;
  // No controller map is updated during commits: every visible assertion must
  // be supplied by the real subscribed consumer, not by a fixture rerender.
  controller = {
    nativeOpticalPresentation: port,
    document: schematic,
    simulationRunning: true,
    simulationTimeMs: 0,
    selectedComponent: schematic.components[0]!,
    selectedEntry: catalogEntry(schematic.components[0]!),
    selectedFamily: familyForVariant('led-5mm'),
    selection: { kind: 'component', id: 'led', ids: ['led'] },
    viewport: schematic.viewport,
    resultByComponent: new Map(),
    runtimePresentationResultByComponent: new Map(),
    diagnosticsByComponent: new Map(),
    errorDiagnosticComponentIds: new Set(),
    componentVisualState: () => 'default',
    componentLedBrightness: () => 0,
    componentArduinoLActive: () => undefined,
    preparedComponentLedAsset: () => undefined,
    committedComponentLedAsset: () => undefined,
    rollbackComponentLedAsset: () => undefined,
    terminalConnectionCount: () => 0,
    terminalConnectionLabel: () => 'Свободен',
    selectedWire: null,
    libraryOpen: true,
    onLedAssetReadiness: vi.fn(),
    selectComponent: vi.fn(),
    startComponentDrag: vi.fn(),
    startPotentiometerControl: vi.fn(),
    resetArduinoRuntime: vi.fn(),
    toggleComponentState: vi.fn(),
    setMultimeterMeasurementMode: vi.fn(),
    setRegulatedPowerSupplyControls: vi.fn(),
    setSelectedProperties: vi.fn(),
    setSignalGeneratorControls: vi.fn(),
    beginReconnect: vi.fn(),
    removeSelection: vi.fn(),
    removeWireBends: vi.fn(),
    setSelectedMotorShaftLocked: vi.fn(),
    setSelectedState: vi.fn(),
    setSelectedVariant: vi.fn(),
    setSelectedWiper: vi.fn(),
    setWireColor: vi.fn(),
    updateSelectedName: vi.fn(),
    updateSelectedResistanceValue: vi.fn(),
    updateSelectedValue: vi.fn(),
  };
  host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
describe('committed ancillary result consumers', () => {
  it('retains the native LED owner and resident image through Run, preparation, generation clear and Stop', async () => {
    const component = schematic.components[0]!;
    const entry = catalogEntry(component);
    if (!entry) throw new Error('Missing LED fixture catalog entry');
    const renderNative = (running: boolean) =>
      createElement(
        NativeOpticalProvider,
        { port },
        createElement(
          'svg',
          null,
          createElement(ProductionComponentVisual, {
            entry,
            component,
            width: 40,
            height: 60,
            visualState: 'off',
            simulationRunning: running,
          }),
        ),
      );
    await act(async () => root.render(renderNative(false)));
    const resident = host.querySelector<SVGImageElement>(
      'image.workbench-led-asset[href$="_i000.svg"]',
    );
    expect(resident).not.toBeNull();
    const asset = resident!.getAttribute('href')!.replace('_i000.svg', '_i080.svg');
    await act(async () =>
      port.setPreparation({ token: 'native-continuity', assets: new Map([['led', asset]]) }),
    );
    await act(async () => root.render(renderNative(true)));
    expect(resident!.isConnected).toBe(true);
    expect(host.querySelector('image.workbench-led-asset[href$="_i000.svg"]')).toBe(resident);
    // JSDOM cannot supply a trusted native load. This regression checks owner
    // continuity; canonical clock/browser suites retain responsibility for
    // readiness, resource leases and the DOM-ACK protocol.
    expect(port.getCommittedSnapshot()).toBeNull();
    await act(async () => port.setObservation(null));
    await act(async () => port.setPreparation(null));
    expect(resident!.isConnected).toBe(true);
    await act(async () => root.render(renderNative(false)));
    expect(resident!.isConnected).toBe(true);
    expect(host.querySelector('image.workbench-led-asset[href$="_i000.svg"]')).toBe(resident);
  });

  it('routes real body pointer-down and click through the owner alpha hit check', async () => {
    await act(async () => root.render(createElement(Probe)));
    const body = host.querySelector<SVGGElement>('.workbench-part');
    const canvas = body?.ownerSVGElement;
    expect(body).not.toBeNull();
    expect(canvas).not.toBeNull();
    Object.defineProperty(body, 'getScreenCTM', { value: () => ({ inverse: () => ({}) }) });
    Object.defineProperty(canvas, 'createSVGPoint', {
      value: () => ({ x: 0, y: 0, matrixTransform: () => ({ x: 12, y: 14 }) }),
    });
    const hit = vi.spyOn(hitTesting, 'componentAssetContainsPoint').mockReturnValue(false);
    const pointerDown = () =>
      body!.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, clientX: 30, clientY: 40 }),
      );
    const click = () =>
      body!.dispatchEvent(
        new MouseEvent('click', { bubbles: true, clientX: 30, clientY: 40, shiftKey: true }),
      );
    await act(async () => {
      pointerDown();
      click();
    });
    expect(controller.startComponentDrag).not.toHaveBeenCalled();
    expect(controller.selectComponent).not.toHaveBeenCalled();
    hit.mockReturnValue(true);
    await act(async () => {
      pointerDown();
      click();
    });
    expect(hit).toHaveBeenCalledTimes(4);
    expect(hit.mock.calls[0]?.[3]).toEqual({ x: 12, y: 14 });
    expect(controller.startComponentDrag).toHaveBeenCalledWith(
      expect.anything(),
      schematic.components[0],
    );
    expect(controller.selectComponent).toHaveBeenCalledWith('led', true);
  });

  it('does not reconcile a passive resistor visual for committed electrical-only frames', async () => {
    const passive = {
      id: 'passive',
      kind: 'resistor' as const,
      componentTypeId: 'resistor-axial',
      value: 220,
      position: { x: 0, y: 0 },
    };
    const entry = catalogEntry(passive)!;
    const renders = vi.fn();
    await act(async () =>
      root.render(
        createElement(
          NativeOpticalProvider,
          { port },
          createElement(
            'svg',
            null,
            createElement(
              Profiler,
              { id: 'passive', onRender: renders },
              createElement(ProductionComponentVisual, {
                entry,
                component: passive,
                width: 80,
                height: 40,
                visualState: 'default',
                simulationRunning: true,
              }),
            ),
          ),
        ),
      ),
    );
    const initial = renders.mock.calls.length;
    for (let i = 0; i < 20; i++) await act(async () => port.setObservation(observation(false)));
    expect(renders).toHaveBeenCalledTimes(initial);
  });

  it('does not rebuild component body JSX for unchanged body metadata across numeric commits', async () => {
    const reads = vi.fn(() => 0);
    controller = { ...controller, componentLedBrightness: reads };
    await act(async () => root.render(createElement(Probe)));
    await act(async () => port.setObservation(observation(false)));
    const initialReads = reads.mock.calls.length;
    for (let i = 0; i < 20; i++) {
      const next = observation(false);
      await act(async () =>
        port.setObservation({
          ...next,
          result: {
            ...next.result,
            components: next.result.components.map((item) => ({ ...item, current: i / 100 })),
          },
          frame: { ...next.frame, token: String(i), atMicroseconds: i * 25_000 },
        }),
      );
    }
    expect(reads).toHaveBeenCalledTimes(initialReads);
    await act(async () => port.setObservation(observation(true)));
    expect(
      host
        .querySelector('[data-testid="schematic-component"]')
        ?.getAttribute('data-presentation-state'),
    ).toBe('failed');
    expect(host.querySelector('[data-testid="led-burnout-explosion"]')).not.toBeNull();
    expect(
      host.querySelector('[data-testid="schematic-component"]')?.getAttribute('data-diagnostics'),
    ).toBe('led_burnout');
  });

  it('updates real ancestor diagnostics, visible explosion, inspector measurements and ordinary visuals without a parent render', async () => {
    await act(async () => root.render(createElement(Probe)));
    const button = host.querySelector<HTMLButtonElement>(
      '.workbench-inspector-information-actions button',
    );
    expect(button).not.toBeNull();
    await act(async () => button!.click());
    const renders = parentRenders;
    const initialProjectionRenders = projectionRenders;
    const next = observation();
    await act(async () => port.setObservation(next, true));
    await act(async () => port.setPreparation({ token: 'warm', assets: new Map() }));
    expect(projectionRenders).toBe(initialProjectionRenders);
    // Preserve the newer immediate ordinary-LED damage marker: it follows the
    // native optical observation, while the inspector waits for committed physics.
    expect(
      host.querySelector('[data-testid="led-burnout-explosion"]')?.getAttribute('aria-label'),
    ).toContain('LED thermal failure');
    expect(host.querySelector('[data-testid="component-diagnostics"]')).toBeNull();
    expect(host.querySelector('.workbench-inspector')?.textContent).not.toContain('175.0 °C');
    await act(async () => port.commit(next));
    expect(parentRenders).toBe(renders);
    expect(
      host.querySelector('[data-testid="schematic-component"]')?.getAttribute('data-diagnostics'),
    ).toBe('led_burnout');
    expect(
      host
        .querySelector('[data-testid="schematic-component"]')
        ?.getAttribute('data-presentation-state'),
    ).toBe('failed');
    expect(
      host.querySelector('[data-testid="led-burnout-explosion"]')?.getAttribute('aria-label'),
    ).toContain('LED thermal failure');
    expect(host.querySelector('[data-testid="component-diagnostics"]')?.textContent).toContain(
      'LED thermal failure',
    );
    expect(host.querySelector('.workbench-inspector')?.textContent).toContain('175.0 °C');
    expect(
      host.querySelector('[data-rgb-runtime-state]')?.getAttribute('data-rgb-runtime-state'),
    ).toBe('burned');
    expect(seenProjections.at(-1)!.resultByComponent).toBe(
      seenProjections.at(-2)!.resultByComponent,
    );
    expect(seenProjections.at(-1)!.resultByComponent).toBe(
      committedResultProjection(next.result).resultByComponent,
    );
    for (let index = 0; index < 10; index++) {
      await act(async () =>
        port.setObservation({ ...next, frame: { ...next.frame, token: String(index) } }),
      );
      expect(seenProjections.at(-1)!.resultByComponent).toBe(
        committedResultProjection(next.result).resultByComponent,
      );
    }
    expect(parentRenders).toBe(renders);
    await act(async () => port.setObservation(observation(false)));
    expect(host.querySelector('[data-testid="led-burnout-explosion"]')).toBeNull();
    expect(host.querySelector('[data-testid="component-diagnostics"]')).toBeNull();
    expect(host.querySelector('[data-rgb-red]')?.getAttribute('data-rgb-red')).toBe('100');
    expect(host.querySelector('.workbench-inspector')?.textContent).toContain('25.0 °C');
  });

  it('clears on generation invalidation, rejects obsolete commits, preserves stopped preflight and releases subscriptions', async () => {
    const disposals: Array<ReturnType<typeof vi.fn>> = [];
    const originalSubscribe = port.subscribe;
    vi.spyOn(port, 'subscribe').mockImplementation((listener) => {
      const unsubscribe = vi.fn(originalSubscribe(listener));
      disposals.push(unsubscribe);
      return unsubscribe;
    });
    await act(async () => root.render(createElement(Probe)));
    const old = observation();
    await act(async () => port.setObservation(old));
    // Deliberately retain the obsolete parent maps across invalidation.
    const stale = committedResultProjection(old.result);
    controller = { ...controller, ...stale };
    await act(async () => root.render(createElement(Probe)));
    await act(async () => port.setObservation(null));
    await act(async () => port.commit(old));
    expect(
      host.querySelector('[data-testid="schematic-component"]')?.getAttribute('data-diagnostics'),
    ).toBe('');
    expect(host.querySelector('[data-testid="led-burnout-explosion"]')).toBeNull();
    const stoppedDiagnostic = {
      code: 'disconnected',
      severity: 'warning' as const,
      message: 'Static preflight',
      componentIds: ['led'],
    };
    controller = { ...controller, diagnosticsByComponent: new Map([['led', [stoppedDiagnostic]]]) };
    await act(async () => root.render(createElement(Probe, { running: false })));
    const renders = projectionRenders;
    expect(
      host.querySelector('[data-testid="schematic-component"]')?.getAttribute('data-diagnostics'),
    ).toBe('disconnected');
    await act(async () => port.setObservation(observation()));
    expect(projectionRenders).toBe(renders);
    expect(
      host.querySelector('[data-testid="schematic-component"]')?.getAttribute('data-diagnostics'),
    ).toBe('disconnected');
    await act(async () => root.unmount());
    expect(disposals.length).toBeGreaterThan(0);
    for (const dispose of disposals) expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('does not resurrect old inspector values after a document/port or selection replacement', async () => {
    await act(async () => root.render(createElement(Probe)));
    const oldPort = port;
    const old = observation();
    await act(async () => oldPort.setObservation(old));
    controller = { ...controller, ...committedResultProjection(old.result) };
    port = new NativeOpticalPresentation();
    controller = {
      ...controller,
      nativeOpticalPresentation: port,
      document: { ...schematic, components: [schematic.components[1]!] },
      selectedComponent: schematic.components[1]!,
      selectedEntry: catalogEntry(schematic.components[1]!),
      selectedFamily: familyForVariant('rgb-led'),
      selection: { kind: 'component', id: 'rgb', ids: ['rgb'] },
    };
    await act(async () => root.render(createElement(Probe)));
    const button = host.querySelector<HTMLButtonElement>(
      '.workbench-inspector-information-actions button',
    );
    expect(button).not.toBeNull();
    await act(async () => button!.click());
    expect(host.querySelector('.workbench-inspector')?.textContent).not.toContain(
      'LED thermal failure',
    );
    expect(host.querySelector('[data-testid="led-burnout-explosion"]')).toBeNull();
    const projectionCount = projectionRenders;
    await act(async () => oldPort.setObservation(observation(false)));
    expect(projectionRenders).toBe(projectionCount);
    await act(async () => port.commit(old));
    expect(port.getCommittedSnapshot()).toBeNull();
    expect(host.querySelector('[data-rgb-red]')?.getAttribute('data-rgb-red')).toBe('0');
    await act(async () => port.setObservation(observation(false)));
    expect(host.querySelector('[data-rgb-red]')?.getAttribute('data-rgb-red')).toBe('100');
    expect(host.querySelector('.workbench-inspector')?.textContent).toContain('10.00 мА');
  });
});
