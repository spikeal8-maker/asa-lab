import { describe, expect, it } from 'vitest';
import type { SchematicDocument, SolveResult } from '../../api';
import { calculateLiveSimulation, prepareLiveSimulationStart } from '../live-simulation';

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
    expect(result).toMatchObject({ solved: true, status: 'solved' });
    // Solved currents keep sub-microamp precision for the KCL quality check,
    // so the exact 0.005 A carries a negligible GMIN-scale tail.
    expect(result?.current).toBeCloseTo(0.005, 9);
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
    expect(start).not.toHaveProperty('notice');
  });

  it('does not manufacture a global simulation-start notice', () => {
    expect(prepareLiveSimulationStart(circuit)).not.toHaveProperty('notice');
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
    const red25 = calculateLiveSimulation(seriesLed('red', 25), null, true);
    const red10 = calculateLiveSimulation(seriesLed('red', 10), null, true);
    const red1 = calculateLiveSimulation(seriesLed('red', 1), null, true);
    const red0 = calculateLiveSimulation(seriesLed('red', 0), null, true);
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

    // Exact owner-captured Tinkercad 2xAA reference points. The component has
    // no pre-limit badge: the marker appears only above the recommended 20 mA
    // maximum, and the zero-ohm point uses the destructive starburst.
    expect(resultForLed(red100)).toMatchObject({ lit: true, stressState: 'normal' });
    expect(resultForLed(red50)).toMatchObject({ lit: true, stressState: 'normal' });
    expect(resultForLed(red25)).toMatchObject({ lit: true, stressState: 'overcurrent' });
    expect(resultForLed(red10)).toMatchObject({ lit: true, stressState: 'overcurrent' });
    expect(resultForLed(red1)).toMatchObject({ lit: true, stressState: 'overcurrent' });
    expect(resultForLed(red0)).toMatchObject({ lit: true, stressState: 'burned' });
    expect(resultForLed(red25)?.current).toBeCloseTo(0.0319, 4);
    expect(resultForLed(red10)?.current).toBeCloseTo(0.0584, 4);
    expect(resultForLed(red1)?.current).toBeCloseTo(0.12, 4);
    expect(resultForLed(red0)?.current).toBeCloseTo(0.136, 4);
    expect(resultForLed(red100)?.current ?? 0).toBeLessThan(resultForLed(red50)?.current ?? 0);
    expect(resultForLed(red50)?.current ?? 0).toBeLessThan(resultForLed(red25)?.current ?? 0);
    expect(resultForLed(red25)?.current ?? 0).toBeLessThan(resultForLed(red10)?.current ?? 0);
    expect(resultForLed(red10)?.current ?? 0).toBeLessThan(resultForLed(red1)?.current ?? 0);
    expect(resultForLed(red1)?.current ?? 0).toBeLessThan(resultForLed(red0)?.current ?? 0);
    expect(red50?.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain('led_near_limit');
    expect(red50?.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
      'led_overcurrent',
    );
    expect(red25?.diagnostics.map((diagnostic) => diagnostic.code)).toContain('led_overcurrent');
    expect(red1?.diagnostics.map((diagnostic) => diagnostic.code)).toContain('led_overcurrent');
    expect(red1?.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain('led_burnout');
    expect(red0?.diagnostics.map((diagnostic) => diagnostic.code)).toContain('led_burnout');
    expect(
      red1?.diagnostics.find((diagnostic) => diagnostic.code === 'led_overcurrent')?.message,
    ).toBe(
      'Сила тока в светодиоде равна 120 mA (максимальное рекомендуемое значение — 20.0 mA). Это может привести к сокращению срока службы светодиода.',
    );
    expect(red0?.diagnostics.find((diagnostic) => diagnostic.code === 'led_burnout')?.message).toBe(
      'Сила тока в светодиоде равна 136 mA (абсолютное максимальное значение — 20.0 mA).',
    );
  });

  it('keeps a 3 V / 166 ohm LED branch working beside unrelated editor components', () => {
    const document: SchematicDocument = {
      schemaVersion: 3,
      components: [
        {
          id: 'board',
          kind: 'breadboard',
          componentTypeId: 'breadboard-medium',
          pinIds: ['J1'],
          position: { x: 0, y: 0 },
          value: 0,
        },
        {
          id: 'open-battery',
          kind: 'source',
          componentTypeId: 'battery-holder-aa-2',
          pinIds: ['BAT-', 'BAT+'],
          position: { x: 0, y: 0 },
          value: 3,
        },
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
          value: 166,
        },
        {
          id: 'led',
          kind: 'led',
          componentTypeId: 'led-5mm',
          pinIds: ['cathode', 'anode'],
          position: { x: 40, y: 0 },
          value: 2,
          stateProperties: { ledColour: 'red' },
        },
        {
          id: 'unused-led',
          kind: 'led',
          componentTypeId: 'led-5mm',
          pinIds: ['cathode', 'anode'],
          position: { x: 60, y: 0 },
          value: 2,
          stateProperties: { ledColour: 'red' },
        },
        {
          id: 'unused-potentiometer',
          kind: 'potentiometer',
          componentTypeId: 'potentiometer',
          pinIds: ['terminal-1', 'terminal-2', 'wiper'],
          position: { x: 80, y: 0 },
          value: 1_000,
        },
        {
          id: 'unused-transistor',
          kind: 'transistor',
          componentTypeId: 'transistor-npn',
          pinIds: ['base', 'collector', 'emitter'],
          position: { x: 100, y: 0 },
          value: 100,
        },
        {
          id: 'unused-rgb-led',
          kind: 'rgb-led',
          componentTypeId: 'rgb-led',
          pinIds: ['red', 'common', 'green', 'blue'],
          position: { x: 120, y: 0 },
          value: 0,
          stateProperties: { commonMode: 'common-cathode' },
        },
      ],
      connections: [
        {
          id: 'unused-positive',
          from: { componentId: 'board', terminal: 'J1' },
          to: { componentId: 'open-battery', terminal: 'BAT+' },
        },
        {
          id: 'negative',
          from: { componentId: 'led', terminal: 'cathode' },
          to: { componentId: 'battery', terminal: 'BAT-' },
        },
        {
          id: 'limited',
          from: { componentId: 'led', terminal: 'anode' },
          to: { componentId: 'resistor', terminal: 'lead-1' },
        },
        {
          id: 'positive',
          from: { componentId: 'resistor', terminal: 'lead-2' },
          to: { componentId: 'battery', terminal: 'BAT+' },
        },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
      simulation: { running: true, maxIterations: 24 },
    };

    const solveAt = (resistance: number) =>
      calculateLiveSimulation(
        {
          ...document,
          components: document.components.map((component) =>
            component.id === 'resistor' ? { ...component, value: resistance } : component,
          ),
        },
        null,
        true,
      );
    const resistanceSweep = [1, 10, 30, 50, 100, 166, 220, 330, 1_000, 10_000, 100_000];
    const sweepResults = resistanceSweep.map((resistance) => ({
      resistance,
      result: solveAt(resistance),
    }));
    const result = solveAt(166);
    const led = result?.components.find((component) => component.componentId === 'led');

    for (const sample of sweepResults) {
      expect(sample.result, `${sample.resistance} Ω`).toMatchObject({
        solved: true,
        status: 'solved',
      });
    }
    const sweepCurrents = sweepResults.map(
      (sample) =>
        sample.result?.components.find((component) => component.componentId === 'led')?.current ??
        0,
    );
    for (let index = 1; index < sweepCurrents.length; index += 1) {
      expect(sweepCurrents[index - 1]).toBeGreaterThanOrEqual(sweepCurrents[index] ?? 0);
    }
    expect(result?.numericalResidual).toBeLessThanOrEqual(result?.numericalTolerance ?? 0);
    expect(result?.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
    expect(result).toMatchObject({ solved: true, status: 'solved' });
    expect(led?.current).toBeGreaterThan(0.006);
    expect(led?.lit).toBe(true);
    expect(led?.brightness).toBeGreaterThan(40);
  });
});
