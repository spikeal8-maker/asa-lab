import { describe, expect, it } from 'vitest';
import type { SchematicDocument, SolveResult } from '../../index.js';
import {
  calculateLiveSimulation,
  prepareLiveSimulationStart,
  simulationRunNotice,
} from '../live-simulation';

const circuit: SchematicDocument = {
  schemaVersion: 3,
  components: [
    { id: 'source', kind: 'source', position: { x: 0, y: 0 }, value: 5 },
    { id: 'resistor', kind: 'resistor', position: { x: 20, y: 0 }, value: 1000 },
  ],
  connections: [
    {
      id: 'positive',
      from: { componentId: 'source', terminal: 'a' },
      to: { componentId: 'resistor', terminal: 'a' },
    },
    {
      id: 'negative',
      from: { componentId: 'resistor', terminal: 'b' },
      to: { componentId: 'source', terminal: 'b' },
    },
  ],
  viewport: { x: 0, y: 0, zoom: 1 },
  simulation: { running: true, maxIterations: 24 },
};

describe('live Electronics simulation', () => {
  it('calculates immediately from the in-memory document without waiting for persistence', () => {
    const result = calculateLiveSimulation(circuit, null, true);
    expect(result).toMatchObject({ solved: true, status: 'solved', current: 0.005 });
  });

  it('keeps the persisted result while simulation is stopped', () => {
    const persisted: SolveResult = {
      solved: false,
      status: 'invalid',
      current: 0,
      components: [],
      nodes: [],
      diagnostics: [],
      iterations: 0,
      numericalResidual: 0,
      numericalTolerance: 0,
    };
    expect(calculateLiveSimulation(circuit, persisted, false)).toBe(persisted);
  });

  it('starts the visible simulation mode while an unsupported circuit stays fail-closed', () => {
    const unsupported: SchematicDocument = {
      ...circuit,
      components: [
        ...circuit.components,
        {
          id: 'sensor',
          kind: 'visual',
          componentTypeId: 'temperature-sensor',
          position: { x: 50, y: 0 },
          value: 0,
        },
      ],
    };
    const start = prepareLiveSimulationStart(unsupported);

    expect(start.document.simulation.running).toBe(true);
    expect(start.result).toMatchObject({ solved: false, status: 'unsupported' });
    expect(start.notice).toContain('Моделирование запущено');
    expect(start.notice).not.toContain('не запущено');
  });

  it('presents numerical instability as an in-simulation diagnostic instead of a start blocker', () => {
    const unstable: SolveResult = {
      solved: false,
      status: 'nonconvergent',
      current: 0,
      components: [],
      nodes: [],
      diagnostics: [
        {
          code: 'numerical_instability',
          severity: 'error',
          message: 'Численная невязка DC-расчёта превышает допустимый предел.',
        },
      ],
      iterations: 24,
      numericalResidual: 0.001,
      numericalTolerance: 0.000001,
    };

    expect(simulationRunNotice(unstable)).toBe(
      'Моделирование запущено. Схема требует внимания — подробности отмечены в диагностике.',
    );
  });

  it('recalculates LED colour and resistor effects in a complete owner-pin circuit', () => {
    const seriesLed = (colour: string, resistance: number): SchematicDocument => ({
      schemaVersion: 3,
      components: [
        {
          id: 'battery',
          kind: 'source',
          componentTypeId: 'battery-holder-aa-2',
          pinIds: ['BAT-', 'BAT+'],
          position: { x: 0, y: 0 },
          value: 3,
        },
        {
          id: 'resistor',
          kind: 'resistor',
          componentTypeId: 'resistor-axial',
          pinIds: ['lead-1', 'lead-2'],
          position: { x: 20, y: 0 },
          value: resistance,
        },
        {
          id: 'led',
          kind: 'led',
          componentTypeId: 'led-5mm',
          pinIds: ['cathode', 'anode'],
          position: { x: 40, y: 0 },
          value: 2,
          stateProperties: { ledColour: colour },
        },
      ],
      connections: [
        {
          id: 'positive',
          from: { componentId: 'battery', terminal: 'BAT+' },
          to: { componentId: 'resistor', terminal: 'lead-1' },
        },
        {
          id: 'limited',
          from: { componentId: 'resistor', terminal: 'lead-2' },
          to: { componentId: 'led', terminal: 'anode' },
        },
        {
          id: 'negative',
          from: { componentId: 'led', terminal: 'cathode' },
          to: { componentId: 'battery', terminal: 'BAT-' },
        },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
      simulation: { running: true, maxIterations: 24 },
    });

    const red220 = calculateLiveSimulation(seriesLed('red', 220), null, true);
    const red1000 = calculateLiveSimulation(seriesLed('red', 1000), null, true);
    const red100 = calculateLiveSimulation(seriesLed('red', 100), null, true);
    const red50 = calculateLiveSimulation(seriesLed('red', 50), null, true);
    const red30 = calculateLiveSimulation(seriesLed('red', 30), null, true);
    const red1 = calculateLiveSimulation(seriesLed('red', 1), null, true);
    const blue220 = calculateLiveSimulation(seriesLed('blue', 220), null, true);
    const blue1000 = calculateLiveSimulation(seriesLed('blue', 1000), null, true);
    const resultForLed = (result: SolveResult | null) =>
      result?.components.find((component) => component.componentId === 'led');

    expect(resultForLed(red220)?.lit).toBe(true);
    expect(resultForLed(red220)?.brightness).toBeGreaterThan(
      resultForLed(red1000)?.brightness ?? 100,
    );
    expect(resultForLed(blue220)?.lit).toBe(true);
    expect(resultForLed(blue1000)?.lit).toBe(true);
    expect(resultForLed(blue1000)?.brightness).toBeGreaterThan(0);
    expect(resultForLed(blue1000)?.brightness).toBeLessThan(
      resultForLed(blue220)?.brightness ?? 100,
    );

    // Editing resistance while modelling must immediately move through the
    // physical operating regions. At 3 V, 1 Ω is not a valid "bright LED"
    // circuit: it exceeds the 30 mA destructive limit and must be reported as
    // burned rather than intermittently appearing dark.
    expect(resultForLed(red100)).toMatchObject({ lit: true, stressState: 'normal' });
    expect(resultForLed(red50)).toMatchObject({ lit: true, stressState: 'warning' });
    expect(resultForLed(red30)).toMatchObject({ lit: true, stressState: 'overcurrent' });
    expect(resultForLed(red1)).toMatchObject({ lit: true, stressState: 'burned' });
    expect(resultForLed(red100)?.current ?? 0).toBeLessThan(resultForLed(red50)?.current ?? 0);
    expect(resultForLed(red50)?.current ?? 0).toBeLessThan(resultForLed(red30)?.current ?? 0);
    expect(resultForLed(red30)?.current ?? 0).toBeLessThan(resultForLed(red1)?.current ?? 0);
    expect(red50?.diagnostics.map((diagnostic) => diagnostic.code)).toContain('led_near_limit');
    expect(red30?.diagnostics.map((diagnostic) => diagnostic.code)).toContain('led_overcurrent');
    expect(red30?.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain('led_burnout');
    expect(red1?.diagnostics.map((diagnostic) => diagnostic.code)).toContain('led_burnout');
  });
});
