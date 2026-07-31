import { describe, expect, it } from 'vitest';
import {
  parseElectronicsDocument,
  type ComponentKind,
  type ElectronicsDocument,
  type SchematicComponent,
  type Terminal,
} from '../domain/document';
import { buildNetlist, terminalKey } from '../domain/netlist';
import { solveCircuit } from '../domain/solver';

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
) {
  return {
    id,
    from: { componentId: from, terminal: fromTerminal },
    to: { componentId: to, terminal: toTerminal },
    color: '#e3212b',
    vertices: [],
  };
}

function doc(
  components: SchematicComponent[],
  connections: ReturnType<typeof connect>[],
): ElectronicsDocument {
  const parsed = parseElectronicsDocument({
    schemaVersion: 2,
    components,
    connections,
    viewport: { x: 0, y: 0, zoom: 1 },
    simulation: { running: false, maxIterations: 24 },
  });
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.document;
}

function series(parts: SchematicComponent[], voltage = 5): ElectronicsDocument {
  const source = component('source', 'source', voltage);
  const connections = [connect('wire-0', 'source', 'a', parts[0]!.id, 'a')];
  parts.forEach((part, index) => {
    const next = parts[index + 1];
    connections.push(
      next
        ? connect(`wire-${index + 1}`, part.id, 'b', next.id, 'a')
        : connect(`wire-${index + 1}`, part.id, 'b', 'source', 'b'),
    );
  });
  return doc([source, ...parts], connections);
}

function resultFor(document: ElectronicsDocument, componentId: string) {
  return solveCircuit(document).components.find((result) => result.componentId === componentId);
}

describe('schema-versioned Electronics document', () => {
  it('normalises an existing schema v1 document without data loss', () => {
    const parsed = parseElectronicsDocument({
      schemaVersion: 1,
      components: [component('r1', 'resistor', 100)],
      connections: [],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.migrated).toBe(true);
    expect(parsed.document).toMatchObject({
      schemaVersion: 3,
      components: [{ id: 'r1', kind: 'resistor', value: 100 }],
      viewport: { x: 0, y: 0, zoom: 1 },
      simulation: { running: false, maxIterations: 24 },
    });
  });

  it('preserves stable ids, three-terminal potentiometers, bends, colors and settings', () => {
    const parsed = parseElectronicsDocument({
      schemaVersion: 2,
      components: [
        component('p1', 'potentiometer', 1000, { wiperPosition: 0.25, name: 'Регулятор' }),
        component('r1', 'resistor', 100),
      ],
      connections: [connect('w1', 'p1', 'wiper', 'r1', 'a')],
      viewport: { x: 15, y: -5, zoom: 1.5 },
      simulation: { running: true, maxIterations: 32 },
    });
    expect(parsed.ok && parsed.document.connections[0]).toMatchObject({
      id: 'w1',
      color: '#e3212b',
      vertices: [],
      from: { componentId: 'p1', terminal: 'wiper' },
    });
    expect(parsed.ok && parsed.document.viewport.zoom).toBe(1.5);
  });

  it('rejects malformed documents and dangling endpoint ids', () => {
    expect(parseElectronicsDocument({ schemaVersion: 9, components: [], connections: [] }).ok).toBe(
      false,
    );
    expect(
      parseElectronicsDocument({
        schemaVersion: 1,
        components: [component('r1', 'resistor', 100)],
        connections: [connect('w1', 'r1', 'a', 'missing', 'b')],
      }).ok,
    ).toBe(false);
  });
});

describe('netlist', () => {
  it('merges every ideal wire endpoint into deterministic nodes', () => {
    const document = doc(
      [component('r1', 'resistor', 100), component('r2', 'resistor', 100)],
      [connect('w1', 'r1', 'b', 'r2', 'a')],
    );
    const netlist = buildNetlist(document);
    expect(netlist.nodeOf.get(terminalKey('r1', 'b'))).toBe(
      netlist.nodeOf.get(terminalKey('r2', 'a')),
    );
  });

  it('persists production variants and joins snapped pins through breadboard groups', () => {
    const parsed = parseElectronicsDocument({
      schemaVersion: 3,
      components: [
        {
          id: 'board',
          kind: 'breadboard',
          componentTypeId: 'breadboard-medium',
          variantId: 'breadboard-medium',
          position: { x: 10, y: 20 },
          value: 0,
          pinIds: ['J1', 'I1'],
          internalConnections: [['J1', 'I1']],
          stateProperties: {},
        },
        {
          id: 'rgb',
          kind: 'rgb-led',
          componentTypeId: 'rgb-led',
          variantId: 'rgb-led',
          position: { x: 30, y: 40 },
          value: 0,
          pinIds: ['red', 'common', 'green', 'blue'],
          stateProperties: {
            red: 20,
            green: 80,
            blue: 55,
            commonMode: 'common-anode',
          },
          holeBindings: { red: { breadboardComponentId: 'board', holeId: 'J1' } },
        },
      ],
      connections: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      simulation: { running: false, maxIterations: 24 },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.document.components[1]).toMatchObject({
      componentTypeId: 'rgb-led',
      variantId: 'rgb-led',
      stateProperties: { red: 20, green: 80, blue: 55, commonMode: 'common-anode' },
    });
    const netlist = buildNetlist(parsed.document);
    expect(netlist.nodeOf.get(terminalKey('rgb', 'red'))).toBe(
      netlist.nodeOf.get(terminalKey('board', 'J1')),
    );
    expect(netlist.nodeOf.get(terminalKey('board', 'J1'))).toBe(
      netlist.nodeOf.get(terminalKey('board', 'I1')),
    );
  });
});

describe('deterministic DC solver', () => {
  it('applies Ohm law', () => {
    const result = solveCircuit(series([component('r1', 'resistor', 1000)], 5));
    expect(result.solved).toBe(true);
    expect(result.current).toBeCloseTo(0.005, 6);
    expect(
      resultFor(series([component('r1', 'resistor', 1000)], 5), 'r1')?.voltageDrop,
    ).toBeCloseTo(5, 6);
  });

  it('solves series resistors', () => {
    const result = solveCircuit(
      series([component('r1', 'resistor', 100), component('r2', 'resistor', 200)], 6),
    );
    expect(result.current).toBeCloseTo(0.02, 6);
    expect(result.components.find((item) => item.componentId === 'r2')?.voltageDrop).toBeCloseTo(
      4,
      6,
    );
  });

  it('solves two parallel resistive branches', () => {
    const document = doc(
      [
        component('source', 'source', 6),
        component('r1', 'resistor', 300),
        component('r2', 'resistor', 600),
      ],
      [
        connect('w1', 'source', 'a', 'r1', 'a'),
        connect('w2', 'source', 'a', 'r2', 'a'),
        connect('w3', 'r1', 'b', 'source', 'b'),
        connect('w4', 'r2', 'b', 'source', 'b'),
      ],
    );
    const result = solveCircuit(document);
    expect(result.solved).toBe(true);
    expect(result.current).toBeCloseTo(0.03, 6);
    expect(result.components.find((item) => item.componentId === 'r1')?.current).toBeCloseTo(
      0.02,
      6,
    );
    expect(result.components.find((item) => item.componentId === 'r2')?.current).toBeCloseTo(
      0.01,
      6,
    );
  });

  it('reports the midpoint voltage of a divider', () => {
    const document = series(
      [component('r1', 'resistor', 1000), component('r2', 'resistor', 1000)],
      10,
    );
    const r1 = resultFor(document, 'r1');
    expect(r1?.terminalVoltages.b).toBeCloseTo(5, 5);
  });

  it('opens and closes a switch', () => {
    const open = solveCircuit(
      series([component('s1', 'switch', 0, { state: false }), component('r1', 'resistor', 100)], 5),
    );
    const closed = solveCircuit(
      series([component('s1', 'switch', 0, { state: true }), component('r1', 'resistor', 100)], 5),
    );
    expect(open.current).toBe(0);
    expect(open.diagnostics.map((item) => item.code)).toContain('open_circuit');
    expect(closed.current).toBeCloseTo(0.05, 4);
  });

  it('models a normally-open button', () => {
    const released = solveCircuit(
      series([component('b1', 'button', 0, { state: false }), component('r1', 'resistor', 200)], 5),
    );
    const pressed = solveCircuit(
      series([component('b1', 'button', 0, { state: true }), component('r1', 'resistor', 200)], 5),
    );
    expect(released.current).toBe(0);
    expect(pressed.current).toBeCloseTo(0.025, 5);
  });

  it.each([
    [0, 5],
    [0.5, 2.5],
    [1, 0],
  ])('solves potentiometer wiper position %s', (position, expectedVoltage) => {
    const document = doc(
      [
        component('source', 'source', 5),
        component('pot', 'potentiometer', 1000, { wiperPosition: position }),
      ],
      [connect('w1', 'source', 'a', 'pot', 'a'), connect('w2', 'pot', 'b', 'source', 'b')],
    );
    expect(resultFor(document, 'pot')?.terminalVoltages.wiper).toBeCloseTo(expectedVoltage, 3);
  });

  it('conducts a forward diode and blocks a reverse diode', () => {
    const forward = solveCircuit(
      series([component('r1', 'resistor', 430), component('d1', 'diode', 0.7)], 5),
    );
    const reverseDocument = doc(
      [
        component('source', 'source', 5),
        component('r1', 'resistor', 430),
        component('d1', 'diode', 0.7),
      ],
      [
        connect('w1', 'source', 'a', 'r1', 'a'),
        connect('w2', 'r1', 'b', 'd1', 'b'),
        connect('w3', 'd1', 'a', 'source', 'b'),
      ],
    );
    const reverse = solveCircuit(reverseDocument);
    expect(forward.current).toBeGreaterThan(0.009);
    expect(reverse.current).toBe(0);
    expect(reverse.diagnostics.map((item) => item.code)).toContain('reverse_polarity');
  });

  it('lights an LED at normal current and diagnoses overcurrent', () => {
    const normal = solveCircuit(
      series([component('r1', 'resistor', 300), component('led1', 'led', 2)], 5),
    );
    const unsafe = solveCircuit(
      series([component('r1', 'resistor', 20), component('led1', 'led', 2)], 5),
    );
    expect(normal.components.find((item) => item.componentId === 'led1')?.lit).toBe(true);
    expect(normal.diagnostics.map((item) => item.code)).toContain('circuit_ok');
    expect(unsafe.diagnostics.map((item) => item.code)).toContain('led_overcurrent');
  });

  it('energizes a resistive lamp', () => {
    const result = solveCircuit(series([component('lamp1', 'lamp', 20)], 5));
    const limited = solveCircuit(
      series([component('r1', 'resistor', 300), component('lamp1', 'lamp', 24)], 5),
    );
    expect(result.current).toBeCloseTo(0.25, 6);
    expect(result.components.find((item) => item.componentId === 'lamp1')?.lit).toBe(true);
    expect(limited.components.find((item) => item.componentId === 'lamp1')?.lit).toBe(true);
  });

  it('diagnoses a direct short, open circuit, no source and invalid property', () => {
    const short = solveCircuit(
      doc([component('source', 'source', 5)], [connect('w1', 'source', 'a', 'source', 'b')]),
    );
    const open = solveCircuit(
      doc(
        [component('source', 'source', 5), component('r1', 'resistor', 100)],
        [connect('w1', 'source', 'a', 'r1', 'a')],
      ),
    );
    const noSource = solveCircuit(doc([component('r1', 'resistor', 100)], []));
    const invalid = solveCircuit(series([component('r1', 'resistor', 0)], 5));
    expect(short.diagnostics.map((item) => item.code)).toContain('short_circuit');
    expect(open.diagnostics.map((item) => item.code)).toContain('open_circuit');
    expect(noSource.diagnostics.map((item) => item.code)).toContain('no_source');
    expect(invalid.diagnostics.map((item) => item.code)).toContain('invalid_property');
  });

  it('returns byte-for-byte deterministic results', () => {
    const document = series([component('r1', 'resistor', 470), component('led1', 'led', 2)], 9);
    expect(JSON.stringify(solveCircuit(document))).toBe(JSON.stringify(solveCircuit(document)));
  });
});
