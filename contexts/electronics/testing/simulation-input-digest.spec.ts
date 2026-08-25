import { describe, expect, it } from 'vitest';
import type { ElectronicsDocument } from '../domain/document.js';
import {
  canonicalSimulationInput,
  sha256Hex,
  simulationInputDigest,
} from '../domain/simulation-input-digest.js';
import { analyseCircuit } from '../domain/simulation.js';

const document: ElectronicsDocument = {
  schemaVersion: 4,
  components: [
    {
      id: 'r1',
      kind: 'resistor',
      componentTypeId: 'resistor-axial',
      variantId: 'resistor-axial',
      position: { x: 20, y: 10 },
      rotation: 90,
      name: 'R1',
      value: 1000,
      pinIds: ['lead-2', 'lead-1'],
      stateProperties: { powerRatingWatt: 0.25, tolerancePercent: 5 },
    },
    {
      id: 'battery',
      kind: 'source',
      componentTypeId: 'battery-holder-aa-2',
      position: { x: 0, y: 0 },
      value: 3,
      pinIds: ['BAT+', 'BAT-'],
    },
  ],
  connections: [
    {
      id: 'wire-b',
      from: { componentId: 'r1', terminal: 'lead-2' },
      to: { componentId: 'battery', terminal: 'BAT-' },
      color: '#ff0000',
      vertices: [{ x: 12, y: 14 }],
    },
    {
      id: 'wire-a',
      from: { componentId: 'battery', terminal: 'BAT+' },
      to: { componentId: 'r1', terminal: 'lead-1' },
    },
  ],
  viewport: { x: 10, y: 20, zoom: 1.5 },
  simulation: { running: false, maxIterations: 24 },
};

describe('simulation input digest', () => {
  it('implements the SHA-256 reference vector', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('is unaffected by viewport, geometry, display names and wire presentation', () => {
    const presentationOnly: ElectronicsDocument = {
      ...document,
      viewport: { x: -500, y: 300, zoom: 0.6 },
      components: document.components.map((component) => ({
        ...component,
        position: { x: component.position.x + 100, y: component.position.y - 50 },
        rotation: 225,
        name: `renamed-${component.id}`,
      })),
      connections: document.connections.map((connection) => ({
        ...connection,
        color: '#00ff00',
        vertices: [{ x: 999, y: 999 }],
      })),
    };
    expect(simulationInputDigest(presentationOnly)).toBe(simulationInputDigest(document));
  });

  it('changes for model values, connectivity and controller time', () => {
    const changedValue: ElectronicsDocument = {
      ...document,
      components: document.components.map((component) =>
        component.id === 'r1' ? { ...component, value: 2200 } : component,
      ),
    };
    const changedConnection: ElectronicsDocument = {
      ...document,
      connections: document.connections.map((connection) =>
        connection.id === 'wire-a'
          ? { ...connection, to: { componentId: 'r1', terminal: 'lead-2' } }
          : connection,
      ),
    };
    expect(simulationInputDigest(changedValue)).not.toBe(simulationInputDigest(document));
    expect(simulationInputDigest(changedConnection)).not.toBe(simulationInputDigest(document));
    expect(simulationInputDigest(document, 100)).not.toBe(simulationInputDigest(document, 200));
  });

  it('binds the digest to the resolved electrical model and profile versions', () => {
    const changedProfile: ElectronicsDocument = {
      ...document,
      components: document.components.map((component) =>
        component.id === 'r1'
          ? {
              ...component,
              electricalModelId: 'resistor',
              electricalModelVersion: 1,
              modelProfileId: 'axial-resistor',
              modelProfileVersion: 2,
            }
          : component,
      ),
    };
    expect(simulationInputDigest(changedProfile)).not.toBe(simulationInputDigest(document));
  });

  it('serializes independently from component and connection array order', () => {
    const reordered: ElectronicsDocument = {
      ...document,
      components: [...document.components].reverse(),
      connections: [...document.connections].reverse(),
    };
    expect(canonicalSimulationInput(reordered)).toBe(canonicalSimulationInput(document));
    expect(JSON.stringify(analyseCircuit(reordered))).toBe(
      JSON.stringify(analyseCircuit(document)),
    );
  });

  it('rejects non-finite electrical values', () => {
    const invalid: ElectronicsDocument = {
      ...document,
      components: [
        {
          ...(document.components[0] as ElectronicsDocument['components'][number]),
          value: Number.NaN,
        },
      ],
    };
    expect(() => simulationInputDigest(invalid)).toThrow(/must be finite/);
  });
});
