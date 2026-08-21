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
    const bent = compileCircuit(
      simpleOhmLaw([
        { x: 120, y: 240 },
        { x: 420, y: 240 },
      ]),
    );
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
    expect(result.quality.maxKclResidualAmp).toBeLessThanOrEqual(result.quality.kclToleranceAmp);
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

  it('accepts Arduino as a finite source and verifies KCL for a D13 LED overload', () => {
    const circuit = document(
      [
        component('uno', 'visual', 5, {
          componentTypeId: 'arduino-uno',
          pinIds: ['d13', 'power-5v', 'power-3v3', 'power-gnd-1', 'gnd-top'],
        }),
        component('led', 'led', 2, {
          componentTypeId: 'led-5mm',
          pinIds: ['anode', 'cathode'],
        }),
      ],
      [
        connect('d13-anode', 'uno', 'd13', 'led', 'anode'),
        connect('cathode-ground', 'led', 'cathode', 'uno', 'gnd-top'),
      ],
    );
    const result = analyseCircuit(circuit);

    expect(result.status).toBe('solved');
    expect(result.solved).toBe(true);
    expect(result.quality).toMatchObject({ finite: true, passed: true });
    expect(result.components.find((item) => item.componentId === 'led')).toMatchObject({
      lit: true,
      stressState: 'burned',
    });
    expect(result.diagnostics.map((item) => item.code)).toContain('led_burnout');
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
    expect(result.status).toBe('invalid');
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'conflicting_sources',
    );
    expect(JSON.stringify(result)).not.toMatch(/NaN|Infinity/);
  });

  it('accepts single-cell batteries and the bench supply on positive/negative pins', () => {
    // Holders carry BAT+/BAT-, but catalog batteries carry positive/negative.
    // A contract that only knew the holder pair rejected every battery before
    // the simulation ever looked at the circuit.
    const circuit = document(
      [
        component('battery', 'source', 9, {
          componentTypeId: 'battery-9v',
          pinIds: ['positive', 'negative'],
        }),
        component('load', 'resistor', 1000),
      ],
      [
        connect('positive', 'battery', 'positive', 'load', 'a'),
        connect('negative', 'load', 'b', 'battery', 'negative'),
      ],
    );
    const result = analyseCircuit(circuit);
    expect(result.status).toBe('solved');
    expect(result.quality.passed).toBe(true);
  });

  it('returns byte-for-byte deterministic simulation evidence', () => {
    const circuit = simpleOhmLaw([{ x: 10, y: 20 }]);
    expect(JSON.stringify(analyseCircuit(circuit))).toBe(JSON.stringify(analyseCircuit(circuit)));
  });

  it('passes quality verification with all eight seven-segment branches lit', () => {
    // Regression: every branch current rounds with a sub-microamp error, so the
    // KCL check used to accumulate ~0.5 µA per lit segment and reject a fully
    // wired display as nonconvergent even though the solve itself was exact.
    const display = component('display', 'seven-segment', 0, {
      componentTypeId: 'seven-segment-display',
      pinIds: [
        'top-1',
        'top-2',
        'top-3',
        'top-4',
        'top-5',
        'bottom-1',
        'bottom-2',
        'bottom-3',
        'bottom-4',
        'bottom-5',
      ],
      internalConnections: [['top-3', 'bottom-3']],
      stateProperties: { commonMode: 'common-cathode' },
    });
    const segmentPins: Readonly<Record<string, Terminal>> = {
      a: 'top-4',
      b: 'top-5',
      c: 'bottom-4',
      d: 'bottom-2',
      e: 'bottom-1',
      f: 'top-2',
      g: 'top-1',
      dp: 'bottom-5',
    };
    const components: SchematicComponent[] = [component('source', 'source', 3), display];
    const connections: ElectronicsDocument['connections'] = [];
    for (const [segment, pin] of Object.entries(segmentPins)) {
      components.push(component(`r-${segment}`, 'resistor', 220));
      connections.push(
        connect(`p-${segment}`, 'source', 'a', `r-${segment}`, 'a'),
        connect(`s-${segment}`, `r-${segment}`, 'b', 'display', pin),
      );
    }
    connections.push(connect('common', 'display', 'bottom-3', 'source', 'b'));

    const result = analyseCircuit(document(components, connections));
    expect(result.status).toBe('solved');
    expect(result.quality.passed).toBe(true);
    const solved = result.components.find((entry) => entry.componentId === 'display');
    for (const segment of Object.keys(segmentPins)) {
      expect(solved?.branchCurrents?.[segment], segment).toBeGreaterThan(0);
      expect(solved?.branchBrightness?.[segment], segment).toBeGreaterThan(0);
    }
    expect(solved?.lit).toBe(true);
  });
});
