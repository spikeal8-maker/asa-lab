import { describe, expect, it } from 'vitest';
import type { SchematicDocument, SolveResult } from '../../api';
import { calculateLiveSimulation, canStartSimulation } from '../live-simulation';

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
    expect(canStartSimulation(persisted)).toBe(false);
  });

  it('refuses to start when any placed component has no electrical model', () => {
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
    const result = calculateLiveSimulation(unsupported, null, true);
    expect(result?.status).toBe('unsupported');
    expect(result && canStartSimulation(result)).toBe(false);
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
    const blue220 = calculateLiveSimulation(seriesLed('blue', 220), null, true);
    const resultForLed = (result: SolveResult | null) =>
      result?.components.find((component) => component.componentId === 'led');

    expect(resultForLed(red220)?.lit).toBe(true);
    expect(resultForLed(red220)?.brightness).toBeGreaterThan(
      resultForLed(red1000)?.brightness ?? 100,
    );
    expect(resultForLed(blue220)).toMatchObject({ lit: false, brightness: 0 });
  });
});
