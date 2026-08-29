import { describe, expect, it } from 'vitest';
import type { SchematicDocument, SolveResult } from '../../api';
import { simulationInputDigest } from '@asa-lab/electronics/simulation';
import {
  advanceLiveSimulation,
  calculateLiveSimulation,
  calculateSimulationPreflight,
  prepareLiveSimulationStart,
} from '../live-simulation';

const circuit: SchematicDocument = {
  schemaVersion: 4,
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
      simulationInputDigest: simulationInputDigest(circuit),
    };
    expect(calculateLiveSimulation(circuit, persisted, false)).toBe(persisted);
  });

  it('hides a persisted result when an electrical input changed', () => {
    const persisted = calculateSimulationPreflight(circuit);
    const changed: SchematicDocument = {
      ...circuit,
      components: circuit.components.map((component) =>
        component.id === 'resistor' ? { ...component, value: 2200 } : component,
      ),
    };
    expect(calculateLiveSimulation(changed, persisted, false)).toBeNull();
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

  it('keeps capacitor charge when a runtime topology changes between clock ticks', () => {
    const capacitor = {
      id: 'capacitor',
      kind: 'visual' as const,
      componentTypeId: 'electrolytic-capacitor',
      pinIds: ['negative', 'positive'],
      position: { x: 40, y: 0 },
      value: 100,
      stateProperties: { initialVoltageVolt: 0, voltageRatingVolt: 25 },
    };
    const resistor = {
      id: 'resistor',
      kind: 'resistor' as const,
      position: { x: 20, y: 0 },
      value: 1_000,
    };
    const charging: SchematicDocument = {
      ...circuit,
      components: [circuit.components[0]!, resistor, capacitor],
      connections: [
        {
          id: 'charge-positive',
          from: { componentId: 'source', terminal: 'a' },
          to: { componentId: 'resistor', terminal: 'a' },
        },
        {
          id: 'charge-capacitor',
          from: { componentId: 'resistor', terminal: 'b' },
          to: { componentId: 'capacitor', terminal: 'positive' },
        },
        {
          id: 'charge-negative',
          from: { componentId: 'capacitor', terminal: 'negative' },
          to: { componentId: 'source', terminal: 'b' },
        },
      ],
    };
    const discharging: SchematicDocument = {
      ...charging,
      components: [resistor, capacitor],
      connections: [
        {
          id: 'discharge-positive',
          from: { componentId: 'capacitor', terminal: 'positive' },
          to: { componentId: 'resistor', terminal: 'a' },
        },
        {
          id: 'discharge-negative',
          from: { componentId: 'resistor', terminal: 'b' },
          to: { componentId: 'capacitor', terminal: 'negative' },
        },
      ],
    };
    const charged = advanceLiveSimulation(charging, null, 100);
    const heldAtSwitch = advanceLiveSimulation(discharging, charged, 100);
    const discharged = advanceLiveSimulation(discharging, heldAtSwitch, 200);
    const voltage = (result: SolveResult) =>
      result.components.find((entry) => entry.componentId === 'capacitor')?.voltageDrop ?? 0;

    expect(heldAtSwitch).not.toBe(charged);
    expect(heldAtSwitch.transientState?.simulationTimeMs).toBe(101);
    expect(voltage(charged)).toBeGreaterThan(0);
    expect(voltage(heldAtSwitch)).toBeGreaterThan(0);
    expect(voltage(heldAtSwitch)).toBeLessThan(voltage(charged));
    expect(voltage(discharged)).toBeGreaterThan(0);
    expect(voltage(discharged)).toBeLessThan(voltage(charged));
    expect(discharged.transientState?.simulationTimeMs).toBe(200);
  });

  it('keeps a 10000 uF / 1 kOhm capacitor on a real ten-second RC time scale', () => {
    const charging: SchematicDocument = {
      ...circuit,
      components: [
        circuit.components[0]!,
        { id: 'resistor', kind: 'resistor', position: { x: 20, y: 0 }, value: 1_000 },
        {
          id: 'capacitor',
          kind: 'visual',
          componentTypeId: 'electrolytic-capacitor',
          pinIds: ['negative', 'positive'],
          position: { x: 40, y: 0 },
          value: 10_000,
          stateProperties: { initialVoltageVolt: 0, voltageRatingVolt: 25 },
        },
      ],
      connections: [
        {
          id: 'positive',
          from: { componentId: 'source', terminal: 'a' },
          to: { componentId: 'resistor', terminal: 'a' },
        },
        {
          id: 'limited',
          from: { componentId: 'resistor', terminal: 'b' },
          to: { componentId: 'capacitor', terminal: 'positive' },
        },
        {
          id: 'negative',
          from: { componentId: 'capacitor', terminal: 'negative' },
          to: { componentId: 'source', terminal: 'b' },
        },
      ],
    };
    const atOneSecond = advanceLiveSimulation(charging, null, 1_000);
    const atTenSeconds = advanceLiveSimulation(charging, atOneSecond, 10_000);
    const voltage = (result: SolveResult) =>
      result.components.find((entry) => entry.componentId === 'capacitor')?.voltageDrop ?? 0;

    expect(voltage(atOneSecond)).toBeGreaterThan(0.4);
    expect(voltage(atOneSecond)).toBeLessThan(0.6);
    expect(voltage(atTenSeconds)).toBeGreaterThan(3.0);
    expect(voltage(atTenSeconds)).toBeLessThan(3.3);
    expect(voltage(atTenSeconds)).toBeLessThan(5);
  });

  it('fades a directly parallel red LED through the low-current tail of a 10000 uF capacitor', () => {
    const circuitWithButton = (pressed: boolean): SchematicDocument => ({
      schemaVersion: 4,
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
          value: 1_000,
        },
        {
          id: 'button',
          kind: 'button',
          componentTypeId: 'button-tactile-6mm',
          pinIds: ['SW-A1', 'SW-A2', 'SW-B1', 'SW-B2'],
          internalConnections: [
            ['SW-A1', 'SW-A2'],
            ['SW-B1', 'SW-B2'],
          ],
          position: { x: 40, y: 0 },
          value: 0,
          state: pressed,
        },
        {
          id: 'led',
          kind: 'led',
          componentTypeId: 'led-5mm',
          pinIds: ['cathode', 'anode'],
          position: { x: 60, y: 0 },
          value: 2,
          stateProperties: { ledColour: 'red' },
        },
        {
          id: 'capacitor',
          kind: 'visual',
          componentTypeId: 'electrolytic-capacitor',
          pinIds: ['negative', 'positive'],
          position: { x: 80, y: 0 },
          value: 10_000,
          stateProperties: { initialVoltageVolt: 0, voltageRatingVolt: 25 },
        },
      ],
      connections: [
        {
          id: 'source-resistor',
          from: { componentId: 'battery', terminal: 'BAT+' },
          to: { componentId: 'resistor', terminal: 'lead-1' },
        },
        {
          id: 'resistor-button',
          from: { componentId: 'resistor', terminal: 'lead-2' },
          to: { componentId: 'button', terminal: 'SW-A1' },
        },
        {
          id: 'button-high',
          from: { componentId: 'button', terminal: 'SW-B1' },
          to: { componentId: 'led', terminal: 'anode' },
        },
        {
          id: 'high-capacitor',
          from: { componentId: 'led', terminal: 'anode' },
          to: { componentId: 'capacitor', terminal: 'positive' },
        },
        {
          id: 'led-return',
          from: { componentId: 'led', terminal: 'cathode' },
          to: { componentId: 'battery', terminal: 'BAT-' },
        },
        {
          id: 'capacitor-return',
          from: { componentId: 'capacitor', terminal: 'negative' },
          to: { componentId: 'battery', terminal: 'BAT-' },
        },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
      simulation: { running: true, maxIterations: 24 },
    });
    const led = (result: SolveResult) =>
      result.components.find((component) => component.componentId === 'led');

    const chargingAtOneSecond = advanceLiveSimulation(circuitWithButton(true), null, 1_000);
    const charged = advanceLiveSimulation(circuitWithButton(true), chargingAtOneSecond, 30_000);
    const released = advanceLiveSimulation(circuitWithButton(false), charged, 30_000);
    const fadingAtTwoSeconds = advanceLiveSimulation(circuitWithButton(false), released, 32_000);
    const fadingAtTenSeconds = advanceLiveSimulation(
      circuitWithButton(false),
      fadingAtTwoSeconds,
      40_000,
    );

    expect(led(chargingAtOneSecond)).toMatchObject({ lit: false, brightness: 0 });
    expect(led(charged)?.brightness ?? 0).toBeGreaterThan(20);
    expect(led(fadingAtTwoSeconds)?.brightness ?? 0).toBeGreaterThan(8);
    expect(led(fadingAtTwoSeconds)?.brightness ?? 0).toBeLessThan(led(charged)?.brightness ?? 0);
    expect(led(fadingAtTenSeconds)?.brightness ?? 0).toBeGreaterThan(5);
    expect(led(fadingAtTenSeconds)?.brightness ?? 0).toBeLessThan(
      led(fadingAtTwoSeconds)?.brightness ?? 0,
    );
  });

  it('recalculates LED colour and resistor effects in a complete owner-pin circuit', () => {
    const seriesLed = (colour: string, resistance: number): SchematicDocument => ({
      schemaVersion: 4,
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

    // The owner-captured Tinkercad sweep is recalculated with the AA holder's
    // finite 0.45-ohm source resistance. The zero-ohm point remains
    // destructive while every reported current stays finite.
    expect(resultForLed(red100)).toMatchObject({ lit: true, stressState: 'normal' });
    expect(resultForLed(red50)).toMatchObject({ lit: true, stressState: 'normal' });
    expect(resultForLed(red25)).toMatchObject({ lit: true, stressState: 'overcurrent' });
    expect(resultForLed(red10)).toMatchObject({ lit: true, stressState: 'overcurrent' });
    expect(resultForLed(red1)).toMatchObject({ lit: true, stressState: 'overcurrent' });
    expect(resultForLed(red0)).toMatchObject({ lit: true, stressState: 'burned' });
    expect(resultForLed(red25)?.current).toBeCloseTo(0.03147, 4);
    expect(resultForLed(red10)?.current).toBeCloseTo(0.05698, 4);
    expect(resultForLed(red1)?.current).toBeCloseTo(0.11399, 4);
    expect(resultForLed(red0)?.current).toBeCloseTo(0.1283, 4);
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
      'Сила тока в светодиоде равна 114 mA (максимальное рекомендуемое значение — 20.0 mA). Это может привести к сокращению срока службы светодиода.',
    );
    expect(red0?.diagnostics.find((diagnostic) => diagnostic.code === 'led_burnout')?.message).toBe(
      'Сила тока в светодиоде равна 128.3 mA (разрушительный предел — 120 mA).',
    );
  });

  it('keeps a 3 V / 166 ohm LED branch working beside unrelated editor components', () => {
    const document: SchematicDocument = {
      schemaVersion: 4,
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
