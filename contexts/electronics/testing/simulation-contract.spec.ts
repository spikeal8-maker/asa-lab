import { describe, expect, it } from 'vitest';
import type {
  ComponentKind,
  ElectronicsDocument,
  SchematicComponent,
  Terminal,
} from '../domain/document';
import { analyseCircuit, compileCircuit } from '../domain/simulation';

function component(
  id: string,
  kind: ComponentKind,
  value: number,
  options: Partial<SchematicComponent> = {},
): SchematicComponent {
  return { id, kind, position: { x: 0, y: 0 }, value, ...options };
}

function connect(
  id: string,
  from: string,
  fromTerminal: Terminal,
  to: string,
  toTerminal: Terminal,
  vertices: readonly { x: number; y: number }[] = [],
) {
  return {
    id,
    from: { componentId: from, terminal: fromTerminal },
    to: { componentId: to, terminal: toTerminal },
    color: '#149447',
    vertices,
  };
}

function document(
  components: readonly SchematicComponent[],
  connections: ElectronicsDocument['connections'],
): ElectronicsDocument {
  return {
    schemaVersion: 3,
    components,
    connections,
    viewport: { x: 0, y: 0, zoom: 1 },
    simulation: { running: true, maxIterations: 24 },
  };
}

function simpleOhmLaw(vertices: readonly { x: number; y: number }[] = []): ElectronicsDocument {
  return document(
    [component('source', 'source', 5), component('resistor', 'resistor', 1000)],
    [
      connect('positive', 'source', 'a', 'resistor', 'a', vertices),
      connect('negative', 'resistor', 'b', 'source', 'b', vertices),
    ],
  );
}

describe('R4-M1 simulation implementation contract', () => {
  it('compiles a deterministic electrical topology independent of wire geometry', () => {
    const straight = compileCircuit(simpleOhmLaw());
    const bent = compileCircuit(simpleOhmLaw([{ x: 120, y: 240 }, { x: 420, y: 240 }]));
    expect(bent.topologySignature).toBe(straight.topologySignature);
    expect(straight.nets).toHaveLength(2);
    expect(straight.componentIds).toEqual(['resistor', 'source']);
  });

  it('solves Ohm law and proves finite Kirchhoff residuals', () => {
    const result = analyseCircuit(simpleOhmLaw());
    expect(result.status).toBe('solved');
    expect(result.solved).toBe(true);
    expect(result.current).toBeCloseTo(0.005, 6);
    expect(result.quality).toMatchObject({ finite: true, passed: true });
    expect(result.quality.maxKclResidualAmp).toBeLessThanOrEqual(
      result.quality.kclToleranceAmp,
    );
    expect(result.quality.maxSourceVoltageResidualVolt).toBeLessThanOrEqual(
      result.quality.sourceVoltageToleranceVolt,
    );
  });

  it('checks Kirchhoff residuals across parallel branches', () => {
    const circuit = document(
      [
        component('source', 'source', 6),
        component('r300', 'resistor', 300),
        component('r600', 'resistor', 600),
      ],
      [
        connect('p1', 'source', 'a', 'r300', 'a'),
        connect('p2', 'source', 'a', 'r600', 'a'),
        connect('n1', 'r300', 'b', 'source', 'b'),
        connect('n2', 'r600', 'b', 'source', 'b'),
      ],
    );
    const result = analyseCircuit(circuit);
    expect(result.status).toBe('solved');
    expect(result.current).toBeCloseTo(0.03, 6);
    expect(result.quality.passed).toBe(true);
  });

  it('fails closed when any component has no electrical model', () => {
    const circuit = document(
      [component('source', 'source', 5), component('unsupported', 'visual', 0)],
      [connect('wire', 'source', 'a', 'unsupported', 'a')],
    );
    const result = analyseCircuit(circuit);
    expect(result).toMatchObject({
      solved: false,
      status: 'unsupported',
      current: 0,
      components: [],
      nodes: [],
      iterations: 0,
    });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'unsupported_component',
        severity: 'error',
        componentIds: ['unsupported'],
      }),
    );
  });

  it('rejects conflicting ideal sources without NaN or invented values', () => {
    const circuit = document(
      [component('source-5v', 'source', 5), component('source-9v', 'source', 9)],
      [
        connect('positive', 'source-5v', 'a', 'source-9v', 'a'),
        connect('negative', 'source-5v', 'b', 'source-9v', 'b'),
      ],
    );
    const result = analyseCircuit(circuit);
    expect(result.solved).toBe(false);
    expect(result.status).toBe('nonconvergent');
    expect(JSON.stringify(result)).not.toMatch(/NaN|Infinity/);
  });

  it('returns byte-for-byte deterministic simulation evidence', () => {
    const circuit = simpleOhmLaw([{ x: 10, y: 20 }]);
    expect(JSON.stringify(analyseCircuit(circuit))).toBe(JSON.stringify(analyseCircuit(circuit)));
  });
});
