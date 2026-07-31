import { describe, it, expect } from 'vitest';
import { parseElectronicsDocument, type ElectronicsDocument } from '../domain/document';
import { buildNetlist, terminalKey } from '../domain/netlist';
import { solveCircuit } from '../domain/solver';

/** Golden cases for the teaching scenario: a source, a resistor and an LED
 * wired into one series loop. */

function component(id: string, kind: string, value: number) {
  return { id, kind, position: { x: 0, y: 0 }, value };
}

function connect(id: string, from: string, fromT: string, to: string, toT: string) {
  return {
    id,
    from: { componentId: from, terminal: fromT },
    to: { componentId: to, terminal: toT },
  };
}

function doc(components: unknown[], connections: unknown[]): ElectronicsDocument {
  const parsed = parseElectronicsDocument({ schemaVersion: 1, components, connections });
  if (!parsed.ok) {
    throw new Error(`fixture is invalid: ${parsed.message}`);
  }
  return parsed.document;
}

/** source(+) -> resistor -> led -> back to source(-) */
function seriesCircuit(volts: number, ohms: number, ledDrop = 2): ElectronicsDocument {
  return doc(
    [
      component('src', 'source', volts),
      component('r1', 'resistor', ohms),
      component('led1', 'led', ledDrop),
    ],
    [
      connect('c1', 'src', 'a', 'r1', 'a'),
      connect('c2', 'r1', 'b', 'led1', 'a'),
      connect('c3', 'led1', 'b', 'src', 'b'),
    ],
  );
}

describe('document parsing', () => {
  it('accepts a well-formed document', () => {
    const parsed = parseElectronicsDocument({
      schemaVersion: 1,
      components: [component('src', 'source', 5)],
      connections: [],
    });
    expect(parsed.ok).toBe(true);
  });

  it('rejects unknown kinds, bad values, duplicates and dangling endpoints', () => {
    const cases: unknown[] = [
      { schemaVersion: 1, components: [component('x', 'capacitor', 1)], connections: [] },
      { schemaVersion: 1, components: [component('x', 'resistor', -5)], connections: [] },
      {
        schemaVersion: 1,
        components: [component('x', 'resistor', 1), component('x', 'led', 2)],
        connections: [],
      },
      {
        schemaVersion: 1,
        components: [component('x', 'resistor', 1)],
        connections: [connect('c', 'x', 'a', 'ghost', 'b')],
      },
      { schemaVersion: 2, components: [], connections: [] },
      { schemaVersion: 1, components: 'nope', connections: [] },
      null,
    ];
    for (const value of cases) {
      expect(parseElectronicsDocument(value).ok, JSON.stringify(value)).toBe(false);
    }
  });
});

describe('netlist', () => {
  it('merges terminals joined by a wire into one node', () => {
    const document = doc(
      [
        component('r1', 'resistor', 100),
        component('w1', 'wire', 0),
        component('r2', 'resistor', 100),
      ],
      [connect('c1', 'r1', 'b', 'w1', 'a'), connect('c2', 'w1', 'b', 'r2', 'a')],
    );
    const netlist = buildNetlist(document);
    expect(netlist.nodeOf.get(terminalKey('r1', 'b'))).toBe(
      netlist.nodeOf.get(terminalKey('r2', 'a')),
    );
  });
});

describe('DC solver golden cases', () => {
  it('solves a series source + resistor + LED circuit', () => {
    const result = solveCircuit(seriesCircuit(5, 300, 2));
    // (5V - 2V) / 300 ohm = 10 mA
    expect(result.solved).toBe(true);
    expect(result.current).toBeCloseTo(0.01, 6);
    const led = result.components.find((entry) => entry.componentId === 'led1');
    const resistor = result.components.find((entry) => entry.componentId === 'r1');
    expect(led?.lit).toBe(true);
    expect(resistor?.voltageDrop).toBeCloseTo(3, 6);
    expect(led?.voltageDrop).toBeCloseTo(2, 6);
    expect(result.diagnostics.map((d) => d.code)).toEqual(['circuit_ok']);
    expect(result.diagnostics.every((d) => d.severity === 'info')).toBe(true);
  });

  it('reports an open circuit when the loop is not closed', () => {
    const document = doc(
      [component('src', 'source', 5), component('r1', 'resistor', 300)],
      [connect('c1', 'src', 'a', 'r1', 'a')],
    );
    const result = solveCircuit(document);
    expect(result.solved).toBe(false);
    expect(result.diagnostics.map((d) => d.code)).toContain('open_circuit');
  });

  it('reports a short circuit when the source is wired to itself', () => {
    const document = doc(
      [component('src', 'source', 5), component('w1', 'wire', 0)],
      [connect('c1', 'src', 'a', 'w1', 'a'), connect('c2', 'w1', 'b', 'src', 'b')],
    );
    const result = solveCircuit(document);
    expect(result.solved).toBe(false);
    expect(result.diagnostics.map((d) => d.code)).toContain('short_circuit');
  });

  it('reports a reverse-connected LED and keeps it dark', () => {
    const document = doc(
      [
        component('src', 'source', 5),
        component('r1', 'resistor', 300),
        component('led1', 'led', 2),
      ],
      [
        connect('c1', 'src', 'a', 'r1', 'a'),
        connect('c2', 'r1', 'b', 'led1', 'b'),
        connect('c3', 'led1', 'a', 'src', 'b'),
      ],
    );
    const result = solveCircuit(document);
    expect(result.solved).toBe(false);
    expect(result.diagnostics.map((d) => d.code)).toContain('led_reverse');
    expect(result.components.find((entry) => entry.componentId === 'led1')?.lit).toBe(false);
  });

  it('warns about an LED without a current-limiting resistor', () => {
    const document = doc(
      [component('src', 'source', 5), component('led1', 'led', 2)],
      [connect('c1', 'src', 'a', 'led1', 'a'), connect('c2', 'led1', 'b', 'src', 'b')],
    );
    const result = solveCircuit(document);
    expect(result.diagnostics.map((d) => d.code)).toContain('led_no_resistor');
  });

  it('warns about overcurrent through the LED', () => {
    const result = solveCircuit(seriesCircuit(5, 20, 2));
    // (5 - 2) / 20 = 150 mA
    expect(result.solved).toBe(true);
    expect(result.diagnostics.map((d) => d.code)).toContain('overcurrent');
  });

  it('keeps the LED dark when the source cannot reach its forward voltage', () => {
    const result = solveCircuit(seriesCircuit(1.5, 300, 2));
    expect(result.current).toBe(0);
    expect(result.components.find((entry) => entry.componentId === 'led1')?.lit).toBe(false);
  });

  it('requires exactly one source', () => {
    const none = solveCircuit(doc([component('r1', 'resistor', 100)], []));
    expect(none.diagnostics.map((d) => d.code)).toContain('no_source');
    const many = solveCircuit(
      doc([component('s1', 'source', 5), component('s2', 'source', 5)], []),
    );
    expect(many.diagnostics.map((d) => d.code)).toContain('multiple_sources');
  });

  it('rejects a branching circuit with an explicit message', () => {
    const document = doc(
      [
        component('src', 'source', 5),
        component('r1', 'resistor', 300),
        component('r2', 'resistor', 300),
        component('r3', 'resistor', 300),
      ],
      [
        connect('c1', 'src', 'a', 'r1', 'a'),
        connect('c2', 'src', 'a', 'r2', 'a'),
        connect('c3', 'r1', 'b', 'r3', 'a'),
        connect('c4', 'r2', 'b', 'r3', 'a'),
        connect('c5', 'r3', 'b', 'src', 'b'),
      ],
    );
    const result = solveCircuit(document);
    expect(result.solved).toBe(false);
    expect(result.diagnostics.map((d) => d.code)).toContain('not_series');
  });

  it('is deterministic for the same document', () => {
    const document = seriesCircuit(9, 470, 2);
    expect(JSON.stringify(solveCircuit(document))).toBe(JSON.stringify(solveCircuit(document)));
  });
});
