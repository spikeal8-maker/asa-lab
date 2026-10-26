/* @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { resetElectronicsTimedState } from '@asa-lab/electronics/engine';
import { SEVEN_SEGMENT_TERMINALS } from '@asa-lab/electronics';
import type { SchematicDocument } from '../../api';
import { catalogEntry } from '../component-catalog';
import { NativeOpticalProvider, ProductionComponentVisual } from '../NativeOpticalComponentVisual';
import {
  NativeOpticalPresentation,
  type NativeOpticalObservation,
} from '../native-optical-presentation';
import { configureProductionLibrary } from '../production-manifest-adapter';
import { evaluateSimulationWorkerRequest } from '../simulation-worker-evaluator';
import {
  ELECTRONICS_SIMULATION_ENGINE_REVISION,
  ELECTRONICS_SIMULATION_WORKER_PROTOCOL,
} from '../simulation-worker-protocol';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function physicalObservation(angle: number): NativeOpticalObservation {
  const document: SchematicDocument = {
    schemaVersion: 4,
    components: [
      {
        id: 'uno',
        kind: 'visual',
        componentTypeId: 'arduino-uno',
        value: 5,
        position: { x: 0, y: 0 },
        pinIds: ['d9', 'd13', 'power-5v', 'power-3v3', 'power-gnd-1'],
        stateProperties: {
          arduinoSource: `#include <Servo.h>\nServo motor;void setup(){motor.attach(9);motor.write(${angle});}void loop(){delay(100);}`,
        },
      },
      {
        id: 'servo',
        kind: 'visual',
        componentTypeId: 'servo-motor',
        variantId: 'servo-motor',
        value: 0,
        position: { x: 0, y: 0 },
        pinIds: ['gnd', 'vcc', 'signal'],
      },
    ],
    connections: [
      ['power-5v', 'vcc'],
      ['power-gnd-1', 'gnd'],
      ['d9', 'signal'],
    ].map(([from, to], index) => ({
      id: `wire-${index}`,
      from: { componentId: 'uno', terminal: from! },
      to: { componentId: 'servo', terminal: to! },
    })),
    viewport: { x: 0, y: 0, zoom: 1 },
    simulation: { running: true, maxIterations: 24 },
  };
  const observation = evaluateObservation(document, `servo-${angle}`);
  expect(
    observation.result.components.find((c) => c.componentId === 'servo')?.servoAngleDegrees,
  ).toBe(angle);
  return observation;
}

function evaluateObservation(
  document: SchematicDocument,
  token: string,
  horizon = 5_000,
): NativeOpticalObservation {
  const request = {
    kind: 'advance',
    protocolVersion: ELECTRONICS_SIMULATION_WORKER_PROTOCOL,
    engineRevision: ELECTRONICS_SIMULATION_ENGINE_REVISION,
    requestId: token,
    generationId: 1,
    projectSessionId: 'servo-projection',
    document,
    requestedHorizonMicroseconds: horizon,
    state: resetElectronicsTimedState(),
  } as const;
  let response = evaluateSimulationWorkerRequest(request);
  for (
    let iteration = 0;
    iteration < 10_000 &&
    response.ok &&
    response.kind === 'advance' &&
    response.advance.executionStatus === 'yielded';
    iteration++
  ) {
    response = evaluateSimulationWorkerRequest({ ...request, state: response.advance.state });
  }
  if (!response.ok || response.kind !== 'advance' || !response.advance.result)
    throw new Error(
      `Powered Servo fixture did not produce a canonical result: ${JSON.stringify(response)}`,
    );
  return {
    result: response.advance.result,
    frame: { token, atMicroseconds: horizon, brightness: new Map(), arduinoLStates: new Map() },
    ledAssets: new Map(),
  };
}

function rawDisplayCircuit(active: string): SchematicDocument {
  const segments = Object.entries(SEVEN_SEGMENT_TERMINALS);
  return {
    schemaVersion: 4,
    components: [
      { id: 'source', kind: 'source', value: 5, position: { x: 0, y: 0 } },
      {
        id: 'display',
        kind: 'seven-segment',
        componentTypeId: 'seven-segment-display',
        variantId: 'seven-segment-display',
        value: 0,
        position: { x: 0, y: 0 },
        pinIds: ['top-3', 'bottom-3', ...Object.values(SEVEN_SEGMENT_TERMINALS)],
        internalConnections: [['top-3', 'bottom-3']],
        stateProperties: { commonMode: 'common-cathode' },
      },
      ...segments.map(([segment]) => ({
        id: `r-${segment}`,
        kind: 'resistor' as const,
        value: 330,
        position: { x: 0, y: 0 },
      })),
    ],
    connections: [
      {
        id: 'common',
        from: { componentId: 'display', terminal: 'top-3' },
        to: { componentId: 'source', terminal: 'b' },
      },
      ...segments
        .filter(([s]) =>
          s === 'dp' ? active.includes('dp') : active.replace('dp', '').includes(s),
        )
        .flatMap(([segment, terminal]) => [
          {
            id: `s-${segment}`,
            from: { componentId: 'source', terminal: 'a' },
            to: { componentId: `r-${segment}`, terminal: 'a' },
          },
          {
            id: `d-${segment}`,
            from: { componentId: `r-${segment}`, terminal: 'b' },
            to: { componentId: 'display', terminal },
          },
        ]),
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
    simulation: { running: true, maxIterations: 24 },
  };
}

describe('Servo native committed projection', () => {
  it('updates the actual owner horn from physical committed results without an editor rerender', async () => {
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
    const component = {
      id: 'servo',
      kind: 'visual' as const,
      componentTypeId: 'servo-motor',
      variantId: 'servo-motor',
      value: 0,
      position: { x: 0, y: 0 },
      pinIds: ['gnd', 'vcc', 'signal'],
    };
    const entry = catalogEntry(component)!;
    const port = new NativeOpticalPresentation();
    const initial = physicalObservation(90);
    port.setObservation(initial);
    let parentRenders = 0;
    function Parent({ running = true }: { running?: boolean }) {
      parentRenders++;
      return createElement(
        NativeOpticalProvider,
        { port },
        createElement(
          'svg',
          null,
          createElement(ProductionComponentVisual, {
            entry,
            component,
            width: 180,
            height: 460,
            visualState: 'default',
            simulationRunning: running,
            simulationTimeMs: 0,
            result: initial.result.components.find((c) => c.componentId === 'servo'),
          }),
        ),
      );
    }
    const host = document.body.appendChild(document.createElement('div'));
    const root = createRoot(host);
    const rotation = () =>
      host.querySelector('[data-testid="servo-motor-horn"]')?.getAttribute('transform');
    try {
      await act(async () => root.render(createElement(Parent)));
      const mountedRenders = parentRenders;
      for (const angle of [0, 45, 90, 135, 180]) {
        const next = physicalObservation(angle);
        const previous = rotation();
        await act(async () => port.setObservation(next, true));
        expect(rotation()).toBe(previous); // Uncommitted proposed frames cannot move Servo.
        await act(async () => port.commit(next));
        expect(rotation()).toBe(`rotate(${angle - 90} 114.5 314)`);
      }
      expect(parentRenders).toBe(mountedRenders);
      await act(async () => port.setObservation(null));
      expect(rotation()).toBe('rotate(0 114.5 314)');
      await act(async () => root.render(createElement(Parent, { running: false })));
      await act(async () => port.setObservation(physicalObservation(180)));
      expect(rotation()).toBe('rotate(0 114.5 314)');
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('updates raw seven-segment b/c and all eight branches only after the physical result commits', async () => {
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
    const fixture = rawDisplayCircuit('');
    const component = fixture.components.find((c) => c.id === 'display')!;
    const port = new NativeOpticalPresentation();
    const initial = evaluateObservation(fixture, 'off', 100);
    port.setObservation(initial);
    const host = document.body.appendChild(document.createElement('div'));
    const root = createRoot(host);
    const visible = () =>
      Object.fromEntries(
        [...host.querySelectorAll('[data-segment]')].map((node) => [
          node.getAttribute('data-segment'),
          Number(node.getAttribute('opacity')),
        ]),
      );
    try {
      await act(async () =>
        root.render(
          createElement(
            NativeOpticalProvider,
            { port },
            createElement(
              'svg',
              null,
              createElement(ProductionComponentVisual, {
                entry: catalogEntry(component)!,
                component,
                width: 100,
                height: 150,
                visualState: 'default',
                simulationRunning: true,
                simulationTimeMs: 0,
                result: initial.result.components.find((c) => c.componentId === 'display'),
              }),
            ),
          ),
        ),
      );
      for (const active of ['bc', 'abcdefgdp']) {
        const next = evaluateObservation(rawDisplayCircuit(active), active, 100);
        const previous = visible();
        await act(async () => port.setObservation(next, true));
        expect(visible()).toEqual(previous);
        await act(async () => port.commit(next));
        const physical = next.result.components.find(
          (c) => c.componentId === 'display',
        )!.branchBrightness!;
        expect(visible()).toEqual(
          Object.fromEntries(Object.entries(physical).map(([key, value]) => [key, value / 100])),
        );
      }
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
