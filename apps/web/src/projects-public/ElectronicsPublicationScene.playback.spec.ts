// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { ElectronicsSimulationArtifact } from '@asa-lab/contracts';
import type { SchematicDocument, SolveResult } from '../api';
import { catalogEntry, renderedSize } from '../electronics/component-catalog';
import { configureProductionLibrary } from '../electronics/production-manifest-adapter';
import { gearmotorVisualPresentation } from '../electronics/production-asset-contracts';
import { evaluateSimulationWorkerRequest } from '../electronics/simulation-worker-evaluator';
import {
  ELECTRONICS_SIMULATION_ENGINE_REVISION,
  ELECTRONICS_SIMULATION_WORKER_PROTOCOL,
} from '../electronics/simulation-worker-protocol';
import { resetElectronicsTimedState } from '@asa-lab/electronics/timed-state';
import { PublicElectronicsRuntime } from './electronics-public-runtime';
import { PublicComponentVisual } from './ElectronicsPublicationScene';
import type { NativeOpticalObservation } from '../electronics/native-optical-presentation';

afterEach(() => {
  vi.unstubAllGlobals();
});

it('renders gearmotor markers at the same committed model time as their real computed RPM', async () => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  configureProductionLibrary(
    JSON.parse(
      readFileSync('apps/web/public/assets/electronics/component-database/catalog.json', 'utf8'),
    ),
  );
  const document: SchematicDocument = {
    schemaVersion: 4,
    components: [
      { id: 'source', kind: 'source', value: 6, position: { x: 0, y: 0 } },
      {
        id: 'motor',
        kind: 'visual',
        componentTypeId: 'gearmotor',
        value: 6,
        position: { x: 100, y: 0 },
        pinIds: ['negative', 'positive'],
        stateProperties: { motorAssemblyProfileId: 'adafruit-3777-tt-48to1' },
      },
    ],
    connections: [
      {
        id: 'p',
        from: { componentId: 'source', terminal: 'a' },
        to: { componentId: 'motor', terminal: 'positive' },
      },
      {
        id: 'n',
        from: { componentId: 'motor', terminal: 'negative' },
        to: { componentId: 'source', terminal: 'b' },
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
    simulation: { running: false, maxIterations: 24 },
  };
  let state = resetElectronicsTimedState();
  const advance = (horizon: number): NativeOpticalObservation => {
    for (let i = 0; i < 64; i++) {
      const response = evaluateSimulationWorkerRequest({
        protocolVersion: ELECTRONICS_SIMULATION_WORKER_PROTOCOL,
        engineRevision: ELECTRONICS_SIMULATION_ENGINE_REVISION,
        projectSessionId: 'gearmotor-public',
        generationId: 1,
        requestId: `${horizon}-${i}`,
        kind: 'advance',
        document,
        state,
        requestedHorizonMicroseconds: horizon,
      });
      if (!response.ok || response.kind !== 'advance') throw Error(JSON.stringify(response));
      state = response.advance.state;
      if (response.advance.executionStatus === 'fault')
        throw Error(JSON.stringify(response.advance.diagnostics));
      if (response.advance.executionStatus !== 'ready') continue;
      const result = response.advance.result!;
      expect(result.solved).toBe(true);
      expect(result.quality?.passed).toBe(true);
      expect(response.advance.committedHorizonMicroseconds).toBe(horizon);
      return {
        result,
        frame: {
          token: `frame-${horizon}`,
          atMicroseconds: response.advance.committedHorizonMicroseconds,
          brightness: new Map(),
          arduinoLStates: new Map(),
        },
        ledAssets: new Map(),
      };
    }
    throw Error('Canonical gearmotor computation exceeded the bounded test loop');
  };
  const first = advance(25000),
    second = advance(50000);
  const motor = document.components[1]!;
  const entry = catalogEntry(motor)!;
  // Serve the actual checked-in owner SVG, not a substitute motion/physics mock.
  const asset = entry.asset;
  const svg = readFileSync(resolve('apps/web/public', `.${asset}`), 'utf8');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      expect(url).toBe(asset);
      return new Response(svg, { status: 200, headers: { 'content-type': 'image/svg+xml' } });
    }),
  );
  const runtime = new PublicElectronicsRuntime(
    {
      schemaVersion: 3,
      status: 'simulation',
      viewerFamily: 'electronics',
      solverIterations: 24,
      provenance: { publicationId: '123e4567-e89b-42d3-a456-426614174001', revisionNumber: 1 },
      capabilities: { readOnly: true, interactive: true, download: false },
      components: [],
      connections: [],
    } satisfies ElectronicsSimulationArtifact,
    () => {},
  );
  const host = window.document.createElement('div');
  const root = createRoot(host);
  const expectedStyle = (result: SolveResult, microseconds: number) => {
    const computed = result.components.find((c) => c.componentId === 'motor')!;
    expect(Number.isFinite(computed.motorRpm)).toBe(true);
    expect(Math.abs(computed.motorRpm!)).toBeGreaterThan(0);
    expect(Number.isFinite(computed.outputRpm)).toBe(true);
    expect(Math.abs(computed.outputRpm!)).toBeGreaterThan(0);
    const presentation = gearmotorVisualPresentation(
      microseconds / 1000,
      computed.motorRpm!,
      computed.outputRpm!,
    );
    return {
      motor: `${presentation.motorHighlightShift.toFixed(3)}px`,
      output: `${presentation.outputHighlightShift.toFixed(3)}px`,
    };
  };
  const read = () => {
    const node = host.querySelector<SVGElement>('[data-testid="gearmotor-phase"]');
    return node
      ? {
          motor: node.style.getPropertyValue('--workbench-gearmotor-motor-highlight-shift'),
          output: node.style.getPropertyValue('--workbench-gearmotor-output-highlight-shift'),
        }
      : null;
  };
  try {
    runtime.port.setObservation(first);
    await act(async () => {
      root.render(
        createElement(
          'svg',
          null,
          createElement(PublicComponentVisual, {
            runtime,
            component: motor,
            entry,
            ...renderedSize(entry),
          }),
        ),
      );
    });
    await vi.waitFor(() => expect(read()).not.toBeNull());
    const firstStyle = expectedStyle(first.result, first.frame.atMicroseconds);
    expect(firstStyle.motor).not.toBe('0.000px');
    expect(read()).toEqual(firstStyle);
    await act(async () => {
      runtime.port.setObservation(second, true);
    });
    expect(read()).toEqual(firstStyle); // proposed clock/result must not leak.
    await act(async () => {
      runtime.port.commit(second);
    });
    const secondStyle = expectedStyle(second.result, second.frame.atMicroseconds);
    expect(secondStyle).not.toEqual(firstStyle);
    expect(read()).toEqual(secondStyle);
  } finally {
    await act(async () => root.unmount());
    runtime.dispose();
  }
});
