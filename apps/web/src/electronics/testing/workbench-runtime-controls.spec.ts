import { describe, expect, it } from 'vitest';
import type { SchematicDocument } from '../../api';
import { applyRuntimeComponentOverrides } from '../workbench-runtime-controls';

const document: SchematicDocument = {
  schemaVersion: 4,
  components: [
    {
      id: 'pot',
      kind: 'potentiometer',
      position: { x: 0, y: 0 },
      value: 1_000,
      wiperPosition: 0.5,
    },
    { id: 'switch', kind: 'switch', position: { x: 20, y: 0 }, value: 0, state: false },
    {
      id: 'ldr',
      kind: 'photoresistor',
      position: { x: 40, y: 0 },
      value: 10_000,
      stateProperties: { illumination: 0.5 },
    },
    {
      id: 'motor',
      kind: 'visual',
      componentTypeId: 'dc-motor',
      position: { x: 60, y: 0 },
      value: 6,
      stateProperties: {},
    },
  ],
  connections: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  simulation: { running: false, maxIterations: 24 },
};

describe('Electronics runtime controls', () => {
  it('feeds controls to the running solver without mutating the project document', () => {
    const runtime = applyRuntimeComponentOverrides(document, true, {
      pot: { wiperPosition: 0.8 },
      switch: { state: true },
      ldr: { stateProperties: { illumination: 0.9 } },
      motor: { stateProperties: { shaftLocked: true } },
    });

    expect(runtime).not.toBe(document);
    expect(runtime?.simulation.running).toBe(true);
    expect(runtime?.components.find((item) => item.id === 'pot')?.wiperPosition).toBe(0.8);
    expect(runtime?.components.find((item) => item.id === 'switch')?.state).toBe(true);
    expect(
      runtime?.components.find((item) => item.id === 'ldr')?.stateProperties?.['illumination'],
    ).toBe(0.9);
    expect(
      runtime?.components.find((item) => item.id === 'motor')?.stateProperties?.['shaftLocked'],
    ).toBe(true);

    expect(document.simulation.running).toBe(false);
    expect(document.components.find((item) => item.id === 'pot')?.wiperPosition).toBe(0.5);
    expect(document.components.find((item) => item.id === 'switch')?.state).toBe(false);
    expect(
      document.components.find((item) => item.id === 'ldr')?.stateProperties?.['illumination'],
    ).toBe(0.5);
    expect(
      document.components.find((item) => item.id === 'motor')?.stateProperties?.['shaftLocked'],
    ).toBeUndefined();
  });

  it('returns the persistent document unchanged while simulation is stopped', () => {
    expect(applyRuntimeComponentOverrides(document, false, { pot: { wiperPosition: 0.1 } })).toBe(
      document,
    );
  });
});
