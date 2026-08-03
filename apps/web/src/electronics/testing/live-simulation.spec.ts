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
});
