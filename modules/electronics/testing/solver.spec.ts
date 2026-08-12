import { describe, expect, it } from 'vitest';
import {
  parseElectronicsDocument,
  type ComponentKind,
  type ElectronicsDocument,
  type SchematicComponent,
  type Terminal,
} from '../domain/document';
import { buildNetlist, terminalKey } from '../domain/netlist';
import { electricalModelFor } from '../domain/model-registry';
import {
  ledBrightnessPercent,
  ordinaryLedProfile,
  ORDINARY_LED_PROFILES,
  rgbLedProfile,
  type OrdinaryLedColour,
  type RgbLedChannel,
} from '../domain/led-model';
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

function deterministicResistanceSamples(count: number): readonly number[] {
  let state = 0x6d2b79f5;
  const samples = Array.from({ length: count }, () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    const unit = state / 0x1_0000_0000;
    // Exercise decimal values across seven orders of magnitude without relying
    // on a test runner's random seed.
    return Number((10 ** (-2 + unit * 7)).toPrecision(10));
  });
  return [0, ...samples].sort((left, right) => left - right);
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

  it('assigns the same canonical node ids regardless of component and wire order', () => {
    const components = [component('source', 'source', 5), component('r1', 'resistor', 100)];
    const connections = [
      connect('positive', 'source', 'a', 'r1', 'a'),
      connect('negative', 'r1', 'b', 'source', 'b'),
    ];
    const forward = buildNetlist(doc(components, connections));
    const reordered = buildNetlist(doc([...components].reverse(), [...connections].reverse()));

    expect([...forward.nodeOf.entries()]).toEqual([...reordered.nodeOf.entries()]);
    expect([...forward.terminalsByNode.entries()]).toEqual([
      ...reordered.terminalsByNode.entries(),
    ]);
  });
});

describe('electrical model registry', () => {
  it('marks owner-visible components without an electrical model as unsupported', () => {
    expect(electricalModelFor(component('sensor', 'visual', 0))).toMatchObject({
      support: 'unsupported',
      topology: 'unsupported',
    });
    expect(electricalModelFor(component('board', 'breadboard', 0))).toMatchObject({
      support: 'infrastructure',
      topology: 'connectivity-only',
    });
    expect(
      electricalModelFor(
        component('q1', 'transistor', 100, {
          componentTypeId: 'transistor-npn',
          pinIds: ['collector', 'base', 'emitter'],
        }),
      ),
    ).toMatchObject({
      id: 'npn-transistor',
      support: 'supported',
      topology: 'three-terminal',
      requiredTerminals: ['base', 'collector', 'emitter'],
    });
  });
});

describe('deterministic DC solver', () => {
  it('fails closed when the document contains an unsupported electrical component', () => {
    const result = solveCircuit(
      doc(
        [
          component('source', 'source', 5),
          component('r1', 'resistor', 1000),
          component('sensor', 'visual', 0, { componentTypeId: 'temperature-sensor' }),
        ],
        [connect('w1', 'source', 'a', 'r1', 'a'), connect('w2', 'r1', 'b', 'source', 'b')],
      ),
    );

    expect(result.solved).toBe(false);
    expect(result.status).toBe('unsupported');
    expect(result.current).toBe(0);
    expect(result.components).toEqual([]);
    expect(result.nodes).toEqual([]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'unsupported_component',
        severity: 'error',
        componentIds: ['sensor'],
        anchors: [{ kind: 'component', id: 'sensor' }],
      }),
    );
  });

  it('fails before matrix assembly when a production component has an incomplete pin map', () => {
    const result = solveCircuit(
      doc(
        [
          component('source', 'source', 3, {
            componentTypeId: 'battery-holder-aa-2',
            pinIds: ['BAT+'],
          }),
        ],
        [],
      ),
    );

    expect(result.status).toBe('invalid');
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'invalid_terminal_contract',
        componentIds: ['source'],
      }),
    );
  });

  it('rejects conflicting ideal voltage sources on the same two nets', () => {
    const result = solveCircuit(
      doc(
        [
          component('source-5v', 'source', 5),
          component('source-9v', 'source', 9),
          component('load', 'resistor', 1000),
        ],
        [
          connect('p1', 'source-5v', 'a', 'load', 'a'),
          connect('n1', 'source-5v', 'b', 'load', 'b'),
          connect('p2', 'source-9v', 'a', 'load', 'a'),
          connect('n2', 'source-9v', 'b', 'load', 'b'),
        ],
      ),
    );

    expect(result.solved).toBe(false);
    expect(result.status).toBe('invalid');
    expect(result.diagnostics.map((item) => item.code)).toContain('conflicting_sources');
  });

  it('reports a bounded numerical residual for a solved circuit', () => {
    const result = solveCircuit(
      series([component('r1', 'resistor', 220), component('led1', 'led', 2)], 5),
    );
    expect(result.status).toBe('solved');
    expect(result.numericalResidual).toBeLessThanOrEqual(result.numericalTolerance);
  });
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
    const sourcePower = result.components.find((item) => item.componentId === 'source')?.power ?? 0;
    const loadPower = result.components
      .filter((item) => item.componentId !== 'source')
      .reduce((sum, item) => sum + (item.power ?? 0), 0);
    expect(loadPower).toBeCloseTo(sourcePower, 9);
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

  it('models a Tinkercad-compatible zero-ohm resistor as a closed finite branch', () => {
    const result = solveCircuit(series([component('r1', 'resistor', 0)], 5));
    const resistor = result.components.find((item) => item.componentId === 'r1');

    expect(result).toMatchObject({ solved: true, status: 'solved' });
    expect(result.diagnostics.map((item) => item.code)).not.toContain('invalid_property');
    expect(resistor?.current).toBeGreaterThan(1_000);
    expect(Number.isFinite(resistor?.current)).toBe(true);
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

  it('models all four physical button pins as two permanent sides and one momentary bridge', () => {
    const button = component('button', 'button', 0, {
      componentTypeId: 'button-tactile-6mm',
      pinIds: ['SW-A1', 'SW-A2', 'SW-B1', 'SW-B2'],
      internalConnections: [
        ['SW-A1', 'SW-A2'],
        ['SW-B1', 'SW-B2'],
      ],
    });
    const circuit = (pressed: boolean) =>
      doc(
        [
          component('source', 'source', 5),
          { ...button, state: pressed },
          component('r1', 'resistor', 200),
        ],
        [
          connect('w1', 'source', 'a', 'button', 'SW-A2'),
          connect('w2', 'button', 'SW-B2', 'r1', 'a'),
          connect('w3', 'r1', 'b', 'source', 'b'),
        ],
      );

    expect(solveCircuit(circuit(false)).current).toBe(0);
    expect(solveCircuit(circuit(true)).current).toBeCloseTo(0.025, 5);
  });

  it('lights an LED only while the physical four-pin button is pressed', () => {
    const circuit = (pressed: boolean) =>
      doc(
        [
          component('source', 'source', 3),
          component('button', 'button', 0, {
            componentTypeId: 'button-tactile-6mm',
            pinIds: ['SW-A1', 'SW-A2', 'SW-B1', 'SW-B2'],
            internalConnections: [
              ['SW-A1', 'SW-A2'],
              ['SW-B1', 'SW-B2'],
            ],
            state: pressed,
          }),
          component('resistor', 'resistor', 220, {
            componentTypeId: 'resistor-axial',
            pinIds: ['lead-1', 'lead-2'],
          }),
          component('led', 'led', 2, {
            componentTypeId: 'led-5mm',
            pinIds: ['anode', 'cathode'],
            stateProperties: { ledColour: 'red' },
          }),
        ],
        [
          connect('source-button', 'source', 'a', 'button', 'SW-A2'),
          connect('button-resistor', 'button', 'SW-B2', 'resistor', 'lead-1'),
          connect('resistor-led', 'resistor', 'lead-2', 'led', 'anode'),
          connect('led-return', 'led', 'cathode', 'source', 'b'),
        ],
      );

    expect(resultFor(circuit(false), 'led')).toMatchObject({ lit: false, current: 0 });
    expect(resultFor(circuit(true), 'led')).toMatchObject({ lit: true });
  });

  it.each([47.3, 137.42, 681.9, 2_200.5])(
    'keeps a physical button momentary for an arbitrary %s ohm LED branch',
    (resistance) => {
      const circuit = (pressed: boolean) =>
        doc(
          [
            component('source', 'source', 5),
            component('button', 'button', 0, {
              componentTypeId: 'button-tactile-6mm',
              pinIds: ['SW-A1', 'SW-A2', 'SW-B1', 'SW-B2'],
              internalConnections: [
                ['SW-A1', 'SW-A2'],
                ['SW-B1', 'SW-B2'],
              ],
              state: pressed,
            }),
            component('resistor', 'resistor', resistance, {
              componentTypeId: 'resistor-axial',
              pinIds: ['lead-1', 'lead-2'],
            }),
            component('led', 'led', 2, {
              componentTypeId: 'led-5mm',
              pinIds: ['anode', 'cathode'],
              stateProperties: { ledColour: 'green' },
            }),
          ],
          [
            connect('source-button', 'source', 'a', 'button', 'SW-A2'),
            connect('button-resistor', 'button', 'SW-B2', 'resistor', 'lead-1'),
            connect('resistor-led', 'resistor', 'lead-2', 'led', 'anode'),
            connect('led-return', 'led', 'cathode', 'source', 'b'),
          ],
        );

      const released = resultFor(circuit(false), 'led');
      const pressed = resultFor(circuit(true), 'led');
      expect(released).toMatchObject({ current: 0, brightness: 0, lit: false });
      expect(pressed?.current).toBeGreaterThan(0);
      expect(pressed?.brightness).toBeGreaterThan(0);
      expect(pressed?.lit).toBe(true);
    },
  );

  it('connects an SPDT common terminal to exactly one selected throw', () => {
    const circuit = (right: boolean) =>
      doc(
        [
          component('source', 'source', 5),
          component('switch', 'switch', 0, {
            componentTypeId: 'switch-spdt',
            pinIds: ['throw-left', 'common', 'throw-right'],
            state: right,
          }),
          component('left-load', 'resistor', 500),
          component('right-load', 'resistor', 1000),
        ],
        [
          connect('source-common', 'source', 'a', 'switch', 'common'),
          connect('left', 'switch', 'throw-left', 'left-load', 'a'),
          connect('left-return', 'left-load', 'b', 'source', 'b'),
          connect('right', 'switch', 'throw-right', 'right-load', 'a'),
          connect('right-return', 'right-load', 'b', 'source', 'b'),
        ],
      );

    expect(solveCircuit(circuit(false)).current).toBeCloseTo(0.01, 5);
    expect(solveCircuit(circuit(true)).current).toBeCloseTo(0.005, 5);
  });

  it('routes an SPDT common pin to exactly one LED branch', () => {
    const circuit = (right: boolean) =>
      doc(
        [
          component('source', 'source', 5),
          component('switch', 'switch', 0, {
            componentTypeId: 'switch-spdt',
            pinIds: ['throw-left', 'common', 'throw-right'],
            state: right,
          }),
          component('left-resistor', 'resistor', 330),
          component('left-led', 'led', 2, { stateProperties: { ledColour: 'red' } }),
          component('right-resistor', 'resistor', 330),
          component('right-led', 'led', 2, { stateProperties: { ledColour: 'green' } }),
        ],
        [
          connect('source-common', 'source', 'a', 'switch', 'common'),
          connect('left-r', 'switch', 'throw-left', 'left-resistor', 'a'),
          connect('left-led', 'left-resistor', 'b', 'left-led', 'a'),
          connect('left-return', 'left-led', 'b', 'source', 'b'),
          connect('right-r', 'switch', 'throw-right', 'right-resistor', 'a'),
          connect('right-led', 'right-resistor', 'b', 'right-led', 'a'),
          connect('right-return', 'right-led', 'b', 'source', 'b'),
        ],
      );

    expect(resultFor(circuit(false), 'left-led')?.lit).toBe(true);
    expect(resultFor(circuit(false), 'right-led')?.lit).toBe(false);
    expect(resultFor(circuit(true), 'left-led')?.lit).toBe(false);
    expect(resultFor(circuit(true), 'right-led')?.lit).toBe(true);
  });

  it.each([73.25, 317.6, 999.9, 4_321.125])(
    'routes exactly one SPDT LED branch with arbitrary %s ohm loads',
    (resistance) => {
      const circuit = (right: boolean) =>
        doc(
          [
            component('source', 'source', 5),
            component('switch', 'switch', 0, {
              componentTypeId: 'switch-spdt',
              pinIds: ['throw-left', 'common', 'throw-right'],
              state: right,
            }),
            component('left-resistor', 'resistor', resistance),
            component('left-led', 'led', 2, { stateProperties: { ledColour: 'red' } }),
            component('right-resistor', 'resistor', resistance),
            component('right-led', 'led', 2, { stateProperties: { ledColour: 'blue' } }),
          ],
          [
            connect('source-common', 'source', 'a', 'switch', 'common'),
            connect('left-r', 'switch', 'throw-left', 'left-resistor', 'a'),
            connect('left-led', 'left-resistor', 'b', 'left-led', 'a'),
            connect('left-return', 'left-led', 'b', 'source', 'b'),
            connect('right-r', 'switch', 'throw-right', 'right-resistor', 'a'),
            connect('right-led', 'right-resistor', 'b', 'right-led', 'a'),
            connect('right-return', 'right-led', 'b', 'source', 'b'),
          ],
        );

      const leftSelected = {
        left: resultFor(circuit(false), 'left-led'),
        right: resultFor(circuit(false), 'right-led'),
      };
      const rightSelected = {
        left: resultFor(circuit(true), 'left-led'),
        right: resultFor(circuit(true), 'right-led'),
      };
      expect(leftSelected.left?.current).toBeGreaterThan(0);
      expect(leftSelected.left?.brightness).toBeGreaterThan(0);
      expect(leftSelected.right).toMatchObject({ current: 0, brightness: 0, lit: false });
      expect(rightSelected.right?.current).toBeGreaterThan(0);
      expect(rightSelected.right?.brightness).toBeGreaterThan(0);
      expect(rightSelected.left).toMatchObject({ current: 0, brightness: 0, lit: false });
    },
  );

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
    expect(reverse.diagnostics.find((item) => item.code === 'reverse_polarity')).toMatchObject({
      suggestedAction: 'Подключите BAT+ к аноду, BAT− к катоду.',
    });
  });

  it('solves NPN cutoff, active and saturation regions with real B/C/E currents', () => {
    const transistor = component('q1', 'transistor', 100, {
      componentTypeId: 'transistor-npn',
      pinIds: ['collector', 'base', 'emitter'],
      stateProperties: {
        currentGain: 100,
        baseEmitterVoltage: 0.7,
        saturationVoltage: 0.2,
        maxCollectorCurrent: 0.2,
      },
    });
    const circuit = (baseResistance: number, collectorResistance = 470) =>
      doc(
        [
          component('source', 'source', 5),
          component('rb', 'resistor', baseResistance),
          component('rc', 'resistor', collectorResistance),
          transistor,
        ],
        [
          connect('s-rc', 'source', 'a', 'rc', 'a'),
          connect('rc-c', 'rc', 'b', 'q1', 'collector'),
          connect('s-rb', 'source', 'a', 'rb', 'a'),
          connect('rb-b', 'rb', 'b', 'q1', 'base'),
          connect('e-s', 'q1', 'emitter', 'source', 'b'),
        ],
      );
    const cutoffDocument = doc(
      [
        component('source', 'source', 5),
        component('rb', 'resistor', 10_000),
        component('rc', 'resistor', 470),
        transistor,
      ],
      [
        connect('s-rc', 'source', 'a', 'rc', 'a'),
        connect('rc-c', 'rc', 'b', 'q1', 'collector'),
        connect('b-rb', 'q1', 'base', 'rb', 'a'),
        connect('rb-gnd', 'rb', 'b', 'source', 'b'),
        connect('e-s', 'q1', 'emitter', 'source', 'b'),
      ],
    );

    const cutoff = resultFor(cutoffDocument, 'q1');
    const active = resultFor(circuit(100_000), 'q1');
    const saturation = resultFor(circuit(1_000, 220), 'q1');

    expect(cutoff).toMatchObject({
      operatingRegion: 'cutoff',
      baseCurrent: 0,
      collectorCurrent: 0,
      emitterCurrent: 0,
    });
    expect(active?.operatingRegion).toBe('active');
    expect(active?.baseCurrent ?? 0).toBeGreaterThan(0.00004);
    expect(active?.collectorCurrent).toBeCloseTo((active?.baseCurrent ?? 0) * 100, 5);
    expect(active?.emitterCurrent).toBeCloseTo(
      (active?.baseCurrent ?? 0) + (active?.collectorCurrent ?? 0),
      6,
    );
    expect(active?.terminalVoltages).toMatchObject({ emitter: 0 });
    expect(saturation?.operatingRegion).toBe('saturation');
    expect(saturation?.voltageDrop ?? 1).toBeGreaterThanOrEqual(0.2);
    expect(saturation?.voltageDrop ?? 1).toBeLessThan(0.25);
    expect(saturation?.collectorCurrent ?? 0).toBeGreaterThan(0.02);
  });

  it('diagnoses unsafe reverse base bias and collector overcurrent', () => {
    const transistor = component('q1', 'transistor', 100, {
      componentTypeId: 'transistor-npn',
      pinIds: ['collector', 'base', 'emitter'],
      stateProperties: { currentGain: 100, maxCollectorCurrent: 0.2 },
    });
    const reverse = solveCircuit(
      doc(
        [component('source', 'source', 9), component('r', 'resistor', 1_000), transistor],
        [
          connect('e-plus', 'source', 'a', 'q1', 'emitter'),
          connect('b-minus', 'q1', 'base', 'source', 'b'),
          connect('c-r', 'q1', 'collector', 'r', 'a'),
          connect('r-minus', 'r', 'b', 'source', 'b'),
        ],
      ),
    );
    const overloaded = solveCircuit(
      doc(
        [
          component('source', 'source', 5),
          component('rb', 'resistor', 100),
          component('rc', 'resistor', 10),
          transistor,
        ],
        [
          connect('s-rc', 'source', 'a', 'rc', 'a'),
          connect('rc-c', 'rc', 'b', 'q1', 'collector'),
          connect('s-rb', 'source', 'a', 'rb', 'a'),
          connect('rb-b', 'rb', 'b', 'q1', 'base'),
          connect('e-s', 'q1', 'emitter', 'source', 'b'),
        ],
      ),
    );
    expect(reverse.diagnostics.map((item) => item.code)).toContain('transistor_reverse_bias');
    expect(overloaded.diagnostics.map((item) => item.code)).toContain('transistor_overcurrent');
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

  it('distinguishes safe, near-limit, overcurrent and destructive LED operating points', () => {
    const operatingPoint = (resistance: number) =>
      solveCircuit(
        series([component('r1', 'resistor', resistance), component('led', 'led', 2)], 5),
      );
    const safe = operatingPoint(220);
    const nearLimit = operatingPoint(150);
    const overcurrent = operatingPoint(100);
    const burned = operatingPoint(50);
    const ledResult = (result: ReturnType<typeof solveCircuit>) =>
      result.components.find((item) => item.componentId === 'led');

    expect(ledResult(safe)).toMatchObject({ stressState: 'normal' });
    expect(safe.diagnostics.map((item) => item.code)).not.toContain('led_near_limit');
    expect(ledResult(nearLimit)).toMatchObject({ stressState: 'warning' });
    expect(nearLimit.diagnostics.map((item) => item.code)).toContain('led_near_limit');
    expect(ledResult(overcurrent)).toMatchObject({ stressState: 'overcurrent' });
    expect(overcurrent.diagnostics.map((item) => item.code)).toContain('led_overcurrent');
    expect(overcurrent.diagnostics.map((item) => item.code)).not.toContain('led_burnout');
    expect(ledResult(burned)).toMatchObject({ stressState: 'burned' });
    expect(burned.diagnostics.map((item) => item.code)).toEqual(
      expect.arrayContaining(['led_overcurrent', 'led_burnout']),
    );
    expect(
      burned.diagnostics.find((item) => item.code === 'led_burnout')?.suggestedAction,
    ).toContain('уменьшите напряжение');
  });

  it('solves LEDs in series and independent parallel resistor branches', () => {
    const seriesResult = solveCircuit(
      series(
        [
          component('r-series', 'resistor', 220),
          component('led-series-1', 'led', 2),
          component('led-series-2', 'led', 2),
        ],
        5,
      ),
    );
    const parallelDocument = doc(
      [
        component('source', 'source', 5),
        component('r-left', 'resistor', 220),
        component('led-left', 'led', 2),
        component('r-right', 'resistor', 470),
        component('led-right', 'led', 2),
      ],
      [
        connect('left-positive', 'source', 'a', 'r-left', 'a'),
        connect('left-led', 'r-left', 'b', 'led-left', 'a'),
        connect('left-negative', 'led-left', 'b', 'source', 'b'),
        connect('right-positive', 'source', 'a', 'r-right', 'a'),
        connect('right-led', 'r-right', 'b', 'led-right', 'a'),
        connect('right-negative', 'led-right', 'b', 'source', 'b'),
      ],
    );
    const parallelResult = solveCircuit(parallelDocument);
    const seriesLed1 = seriesResult.components.find((item) => item.componentId === 'led-series-1');
    const seriesLed2 = seriesResult.components.find((item) => item.componentId === 'led-series-2');
    const left = parallelResult.components.find((item) => item.componentId === 'led-left');
    const right = parallelResult.components.find((item) => item.componentId === 'led-right');

    expect(seriesLed1?.current).toBeCloseTo(seriesLed2?.current ?? 0, 8);
    expect(seriesLed1?.lit).toBe(true);
    expect(seriesLed2?.lit).toBe(true);
    expect(left?.current ?? 0).toBeGreaterThan(right?.current ?? 0);
    expect(parallelResult.current).toBeCloseTo((left?.current ?? 0) + (right?.current ?? 0), 5);
  });

  it('derives ordinary LED brightness from current and colour-specific forward voltage', () => {
    const red = solveCircuit(
      series(
        [
          component('r1', 'resistor', 220),
          component('led1', 'led', 2, {
            stateProperties: { ledColour: 'red' },
          }),
        ],
        5,
      ),
    );
    const led = red.components.find((item) => item.componentId === 'led1');
    expect(led?.current).toBeGreaterThan(0.012);
    expect(led?.brightness).toBeGreaterThan(70);
    expect(led?.branchBrightness?.led).toBe(led?.brightness);
  });

  it('keeps every ordinary LED colour electrically distinct and brightness continuous', () => {
    expect(ORDINARY_LED_PROFILES.red.kneeVoltage).toBeLessThan(
      ORDINARY_LED_PROFILES.green.kneeVoltage,
    );
    expect(ORDINARY_LED_PROFILES.green.kneeVoltage).toBeLessThan(
      ORDINARY_LED_PROFILES.blue.kneeVoltage,
    );
    const profile = ordinaryLedProfile('red');
    const currents = [0, 1e-9, 1e-7, 1e-5, 1e-4, 1e-3, 5e-3, 1e-2, 2e-2];
    const brightness = currents.map((current) => ledBrightnessPercent(current, profile));

    expect(brightness[0]).toBe(0);
    expect(brightness[1]).toBeGreaterThan(0);
    for (let index = 1; index < brightness.length; index += 1) {
      expect(brightness[index]).toBeGreaterThan(brightness[index - 1] ?? -1);
    }
    expect(brightness.at(-1)).toBe(100);
  });

  it.each(Object.keys(ORDINARY_LED_PROFILES) as OrdinaryLedColour[])(
    'solves arbitrary decimal resistance values continuously for a %s LED',
    (colour) => {
      const profile = ordinaryLedProfile(colour);
      const resistances = deterministicResistanceSamples(64);
      const samples = resistances.map((resistance) => {
        const document = series(
          [
            component('resistor', 'resistor', resistance),
            component('led', 'led', 2, { stateProperties: { ledColour: colour } }),
          ],
          5,
        );
        const result = solveCircuit(document);
        const resistor = result.components.find((item) => item.componentId === 'resistor');
        const led = result.components.find((item) => item.componentId === 'led');
        const expectedCurrent =
          (5 - profile.kneeVoltage) / (Math.max(0.0001, resistance) + profile.dynamicResistanceOhm);
        const expectedBrightness = ledBrightnessPercent(expectedCurrent, profile);

        expect(result).toMatchObject({ solved: true, status: 'solved' });
        expect(Number.isFinite(resistor?.current)).toBe(true);
        expect(Number.isFinite(led?.current)).toBe(true);
        expect(Number.isFinite(led?.brightness)).toBe(true);
        expect(Math.abs((led?.current ?? 0) - expectedCurrent)).toBeLessThanOrEqual(5.1e-7);
        expect(Math.abs((resistor?.current ?? 0) - (led?.current ?? 0))).toBeLessThanOrEqual(1e-6);
        expect(led?.brightness).toBeCloseTo(expectedBrightness, 1);
        expect((resistor?.voltageDrop ?? 0) + (led?.voltageDrop ?? 0)).toBeCloseTo(5, 5);
        return { current: led?.current ?? 0, brightness: led?.brightness ?? 0 };
      });

      for (let index = 1; index < samples.length; index += 1) {
        expect(samples[index]?.current).toBeLessThanOrEqual(samples[index - 1]?.current ?? 0);
        expect(samples[index]?.brightness).toBeLessThanOrEqual(samples[index - 1]?.brightness ?? 0);
      }
    },
  );

  it('keeps a 3 V blue LED visibly dim through a 1 kOhm resistor', () => {
    const result = solveCircuit(
      series(
        [
          component('r1', 'resistor', 1000),
          component('led1', 'led', 2, {
            stateProperties: { ledColour: 'blue' },
          }),
        ],
        3,
      ),
    );
    const led = result.components.find((item) => item.componentId === 'led1');

    expect(led?.current).toBeGreaterThan(0.0001);
    expect(led?.current).toBeLessThan(0.001);
    expect(led?.lit).toBe(true);
    expect(led?.brightness).toBeGreaterThan(0);
    expect(led?.brightness).toBeLessThan(20);
  });

  it('drives the owner AA holder and LED pins with real polarity', () => {
    const source = component('battery', 'source', 3, {
      componentTypeId: 'battery-holder-aa-2',
      pinIds: ['BAT-', 'BAT+'],
    });
    const led = component('led', 'led', 2, {
      componentTypeId: 'led-5mm',
      pinIds: ['anode', 'cathode'],
      stateProperties: { ledColour: 'red' },
    });
    const forward = solveCircuit(
      doc(
        [source, led],
        [
          connect('positive', 'battery', 'BAT+', 'led', 'anode'),
          connect('negative', 'led', 'cathode', 'battery', 'BAT-'),
        ],
      ),
    );
    const reverse = solveCircuit(
      doc(
        [source, led],
        [
          connect('negative', 'battery', 'BAT-', 'led', 'anode'),
          connect('positive', 'led', 'cathode', 'battery', 'BAT+'),
        ],
      ),
    );

    expect(forward.components.find((item) => item.componentId === 'led')).toMatchObject({
      lit: true,
      brightness: 100,
    });
    expect(forward.diagnostics.map((item) => item.code)).toContain('led_overcurrent');
    expect(reverse.components.find((item) => item.componentId === 'led')).toMatchObject({
      lit: false,
      brightness: 0,
    });
    expect(reverse.diagnostics.map((item) => item.code)).toContain('reverse_polarity');
  });

  it('solves a complete LED circuit through breadboard contact groups', () => {
    const board = component('board', 'breadboard', 0, {
      componentTypeId: 'breadboard-small',
      pinIds: ['P1', 'P2', 'N1', 'N2', 'J1', 'I1', 'J2', 'I2'],
      internalConnections: [
        ['P1', 'P2'],
        ['N1', 'N2'],
        ['J1', 'I1'],
        ['J2', 'I2'],
      ],
    });
    const source = component('battery', 'source', 5, {
      componentTypeId: 'battery-holder-aa-3',
      pinIds: ['BAT-', 'BAT+'],
      holeBindings: {
        'BAT+': { breadboardComponentId: 'board', holeId: 'P1' },
        'BAT-': { breadboardComponentId: 'board', holeId: 'N1' },
      },
    });
    const resistor = component('resistor', 'resistor', 220, {
      componentTypeId: 'resistor-axial',
      pinIds: ['lead-1', 'lead-2'],
      holeBindings: {
        'lead-1': { breadboardComponentId: 'board', holeId: 'J1' },
        'lead-2': { breadboardComponentId: 'board', holeId: 'J2' },
      },
    });
    const led = component('led', 'led', 2, {
      componentTypeId: 'led-5mm',
      pinIds: ['anode', 'cathode'],
      stateProperties: { ledColour: 'red' },
      holeBindings: {
        anode: { breadboardComponentId: 'board', holeId: 'I2' },
        cathode: { breadboardComponentId: 'board', holeId: 'N2' },
      },
    });
    const result = solveCircuit(
      doc([board, source, resistor, led], [connect('rail-to-row', 'board', 'P2', 'board', 'I1')]),
    );

    expect(result.status).toBe('solved');
    expect(result.current).toBeGreaterThan(0.012);
    expect(
      resultFor(
        doc([board, source, resistor, led], [connect('rail-to-row', 'board', 'P2', 'board', 'I1')]),
        'led',
      )?.lit,
    ).toBe(true);
  });

  it('keeps an isolated LED dark without inventing terminal voltage', () => {
    const isolated = solveCircuit(
      doc(
        [
          component('source', 'source', 5),
          component('led', 'led', 2, {
            componentTypeId: 'led-5mm',
            pinIds: ['anode', 'cathode'],
            stateProperties: { ledColour: 'red' },
          }),
        ],
        [],
      ),
    );
    const led = isolated.components.find((item) => item.componentId === 'led');
    expect(led?.terminalVoltages['anode']).toBe(0);
    expect(led?.terminalVoltages['cathode']).toBe(0);
    expect(led?.voltageDrop).toBe(0);
    expect(led?.current).toBe(0);
    expect(led?.brightness).toBe(0);
    expect(led?.lit).toBe(false);
  });

  it('solves RGB channels electrically and leaves unpowered channels dark', () => {
    const document = doc(
      [
        component('source', 'source', 5),
        component('r-red', 'resistor', 220),
        component('rgb', 'rgb-led', 0, {
          componentTypeId: 'rgb-led',
          pinIds: ['red', 'common', 'green', 'blue'],
          stateProperties: { commonMode: 'common-cathode' },
        }),
      ],
      [
        connect('w1', 'source', 'a', 'r-red', 'a'),
        connect('w2', 'r-red', 'b', 'rgb', 'red'),
        connect('w3', 'rgb', 'common', 'source', 'b'),
      ],
    );
    const rgb = resultFor(document, 'rgb');
    expect(rgb?.branchCurrents?.red).toBeGreaterThan(0.013);
    expect(rgb?.branchBrightness?.red).toBeGreaterThan(70);
    expect(rgb?.branchBrightness?.green).toBe(0);
    expect(rgb?.branchBrightness?.blue).toBe(0);
  });

  it('matches the Tinkercad 3 V direct-red RGB burnout current', () => {
    const circuit = doc(
      [
        component('source', 'source', 3),
        component('rgb', 'rgb-led', 0, {
          componentTypeId: 'rgb-led',
          pinIds: ['red', 'common', 'green', 'blue'],
          stateProperties: { commonMode: 'common-cathode' },
        }),
      ],
      [
        connect('positive', 'source', 'a', 'rgb', 'red'),
        connect('common', 'rgb', 'common', 'source', 'b'),
      ],
    );
    const result = solveCircuit(circuit);
    const rgb = resultFor(circuit, 'rgb');

    expect(result).toMatchObject({ solved: true, status: 'solved' });
    expect(rgb?.branchCurrents?.red).toBeCloseTo(1.07, 2);
    expect(rgb?.branchBrightness?.red).toBe(100);
    expect(rgb?.branchBrightness?.green).toBe(0);
    expect(rgb?.branchBrightness?.blue).toBe(0);
    expect(rgb?.stressState).toBe('burned');
    expect(result.diagnostics.map((item) => item.code)).toContain('led_burnout');
  });

  it('mixes red and blue in the 3 V RCBG owner wiring', () => {
    const circuit = doc(
      [
        component('source', 'source', 3),
        component('r-red', 'resistor', 220),
        component('rgb', 'rgb-led', 0, {
          componentTypeId: 'rgb-led',
          pinIds: ['red', 'common', 'green', 'blue'],
          stateProperties: { commonMode: 'common-cathode', pinLayout: 'RCBG' },
        }),
      ],
      [
        connect('positive-red', 'source', 'a', 'r-red', 'a'),
        connect('red-channel', 'r-red', 'b', 'rgb', 'red'),
        connect('positive-blue', 'source', 'a', 'rgb', 'blue'),
        connect('common-return', 'rgb', 'common', 'source', 'b'),
      ],
    );
    const result = solveCircuit(circuit);
    const rgb = resultFor(circuit, 'rgb');

    expect(result).toMatchObject({ solved: true, status: 'solved' });
    expect(rgb?.branchCurrents?.red).toBeGreaterThan(0);
    expect(rgb?.branchCurrents?.blue).toBeGreaterThan(0);
    expect(rgb?.branchCurrents?.green).toBe(0);
    expect(rgb?.branchBrightness?.red).toBeGreaterThan(0);
    expect(rgb?.branchBrightness?.blue).toBeGreaterThan(rgb?.branchBrightness?.red ?? 100);
    expect(rgb?.stressState).toBe('warning');
    expect(result.diagnostics.map((item) => item.code)).toContain('led_near_limit');
    expect(result.diagnostics.map((item) => item.code)).not.toContain('led_burnout');
  });

  it.each(['red', 'green', 'blue'] as const)(
    'changes only the %s RGB channel monotonically across the resistor sweep',
    (channel) => {
      const sample = (resistance: number) =>
        solveCircuit(
          doc(
            [
              component('source', 'source', 5),
              component('resistor', 'resistor', resistance),
              component('rgb', 'rgb-led', 0, {
                componentTypeId: 'rgb-led',
                pinIds: ['red', 'common', 'green', 'blue'],
                stateProperties: { commonMode: 'common-cathode' },
              }),
            ],
            [
              connect('positive', 'source', 'a', 'resistor', 'a'),
              connect('channel', 'resistor', 'b', 'rgb', channel),
              connect('common', 'rgb', 'common', 'source', 'b'),
            ],
          ),
        );
      const results = [10_000, 1_000, 330, 220, 100, 0].map(sample);
      const brightness = results.map(
        (result) =>
          result.components.find((item) => item.componentId === 'rgb')?.branchBrightness?.[
            channel
          ] ?? 0,
      );

      for (const result of results) {
        const rgb = result.components.find((item) => item.componentId === 'rgb');
        expect(result).toMatchObject({ solved: true, status: 'solved' });
        expect(result.diagnostics.map((item) => item.code)).not.toContain('invalid_property');
        expect(Number.isFinite(rgb?.branchCurrents?.[channel])).toBe(true);
        for (const other of ['red', 'green', 'blue'] as const) {
          if (other !== channel) expect(rgb?.branchBrightness?.[other]).toBe(0);
        }
      }
      for (let index = 1; index < brightness.length; index += 1) {
        expect(brightness[index]).toBeGreaterThanOrEqual(brightness[index - 1] ?? 0);
      }
      expect(brightness[0]).toBeGreaterThan(0);
      expect(brightness.at(-1)).toBe(100);
    },
  );

  it.each(['red', 'green', 'blue'] as RgbLedChannel[])(
    'calculates the %s RGB channel for arbitrary decimal resistance values',
    (channel) => {
      const profile = rgbLedProfile(channel);
      const samples = deterministicResistanceSamples(48).map((resistance) => {
        const document = doc(
          [
            component('source', 'source', 5),
            component('resistor', 'resistor', resistance),
            component('rgb', 'rgb-led', 0, {
              componentTypeId: 'rgb-led',
              pinIds: ['red', 'common', 'green', 'blue'],
              stateProperties: { commonMode: 'common-cathode' },
            }),
          ],
          [
            connect('positive', 'source', 'a', 'resistor', 'a'),
            connect('channel', 'resistor', 'b', 'rgb', channel),
            connect('common', 'rgb', 'common', 'source', 'b'),
          ],
        );
        const result = solveCircuit(document);
        const rgb = result.components.find((item) => item.componentId === 'rgb');
        const current = rgb?.branchCurrents?.[channel] ?? 0;
        const brightness = rgb?.branchBrightness?.[channel] ?? 0;
        const expectedCurrent =
          (5 - profile.kneeVoltage) / (Math.max(0.0001, resistance) + profile.dynamicResistanceOhm);

        expect(result).toMatchObject({ solved: true, status: 'solved' });
        expect(Math.abs(current - expectedCurrent)).toBeLessThanOrEqual(5.1e-7);
        expect(brightness).toBeCloseTo(ledBrightnessPercent(expectedCurrent, profile), 1);
        for (const other of ['red', 'green', 'blue'] as const) {
          if (other !== channel) {
            expect(rgb?.branchCurrents?.[other]).toBe(0);
            expect(rgb?.branchBrightness?.[other]).toBe(0);
          }
        }
        return { current, brightness };
      });

      for (let index = 1; index < samples.length; index += 1) {
        expect(samples[index]?.current).toBeLessThanOrEqual(samples[index - 1]?.current ?? 0);
        expect(samples[index]?.brightness).toBeLessThanOrEqual(samples[index - 1]?.brightness ?? 0);
      }
    },
  );

  it('keeps equal 220 ohm green and blue branches visibly mixed from a 3 V AA holder', () => {
    const document = doc(
      [
        component('source', 'source', 3),
        component('r-green', 'resistor', 220),
        component('r-blue', 'resistor', 220),
        component('rgb', 'rgb-led', 0, {
          componentTypeId: 'rgb-led',
          pinIds: ['red', 'common', 'green', 'blue'],
          stateProperties: { commonMode: 'common-cathode', pinLayout: 'RCBG' },
        }),
      ],
      [
        connect('positive-green', 'source', 'a', 'r-green', 'a'),
        connect('green-channel', 'r-green', 'b', 'rgb', 'green'),
        connect('positive-blue', 'source', 'a', 'r-blue', 'a'),
        connect('blue-channel', 'r-blue', 'b', 'rgb', 'blue'),
        connect('common-return', 'rgb', 'common', 'source', 'b'),
      ],
    );

    const result = solveCircuit(document);
    const rgb = result.components.find((item) => item.componentId === 'rgb');
    const greenBrightness = rgb?.branchBrightness?.green ?? 0;
    const blueBrightness = rgb?.branchBrightness?.blue ?? 0;

    expect(result).toMatchObject({ solved: true, status: 'solved' });
    expect(rgb?.branchBrightness?.red).toBe(0);
    expect(greenBrightness).toBeGreaterThan(0);
    expect(blueBrightness).toBeGreaterThanOrEqual(greenBrightness * 0.45);
    expect(blueBrightness).toBeLessThan(greenBrightness);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['circuit_ok']);
  });

  it('mixes all RGB channels for common-cathode and common-anode wiring', () => {
    for (const commonMode of ['common-cathode', 'common-anode'] as const) {
      const components = [
        component('source', 'source', 5),
        component('r-red', 'resistor', 220),
        component('r-green', 'resistor', 220),
        component('r-blue', 'resistor', 220),
        component('rgb', 'rgb-led', 0, {
          componentTypeId: 'rgb-led',
          pinIds: ['red', 'common', 'green', 'blue'],
          stateProperties: { commonMode },
        }),
      ];
      const connections =
        commonMode === 'common-cathode'
          ? [
              connect('positive-red', 'source', 'a', 'r-red', 'a'),
              connect('red-channel', 'r-red', 'b', 'rgb', 'red'),
              connect('positive-green', 'source', 'a', 'r-green', 'a'),
              connect('green-channel', 'r-green', 'b', 'rgb', 'green'),
              connect('positive-blue', 'source', 'a', 'r-blue', 'a'),
              connect('blue-channel', 'r-blue', 'b', 'rgb', 'blue'),
              connect('common-return', 'rgb', 'common', 'source', 'b'),
            ]
          : [
              connect('common-positive', 'source', 'a', 'rgb', 'common'),
              connect('red-channel', 'rgb', 'red', 'r-red', 'a'),
              connect('red-return', 'r-red', 'b', 'source', 'b'),
              connect('green-channel', 'rgb', 'green', 'r-green', 'a'),
              connect('green-return', 'r-green', 'b', 'source', 'b'),
              connect('blue-channel', 'rgb', 'blue', 'r-blue', 'a'),
              connect('blue-return', 'r-blue', 'b', 'source', 'b'),
            ];

      const rgb = resultFor(doc(components, connections), 'rgb');
      expect(rgb?.lit, commonMode).toBe(true);
      expect(rgb?.branchCurrents?.red, commonMode).toBeGreaterThan(0);
      expect(rgb?.branchCurrents?.green, commonMode).toBeGreaterThan(0);
      expect(rgb?.branchCurrents?.blue, commonMode).toBeGreaterThan(0);
      expect(rgb?.branchCurrents?.red, commonMode).toBeGreaterThan(
        rgb?.branchCurrents?.green ?? Number.POSITIVE_INFINITY,
      );
      expect(rgb?.branchCurrents?.green, commonMode).toBeGreaterThan(
        rgb?.branchCurrents?.blue ?? Number.POSITIVE_INFINITY,
      );
      expect(rgb?.branchBrightness?.red, commonMode).toBeGreaterThan(0);
      expect(rgb?.branchBrightness?.green, commonMode).toBeGreaterThan(0);
      expect(rgb?.branchBrightness?.blue, commonMode).toBeGreaterThan(0);
    }
  });

  it('drives each seven-segment cell from its real pin and never invents a glyph', () => {
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
    const powered = doc(
      [component('source', 'source', 5), component('r-a', 'resistor', 330), display],
      [
        connect('w1', 'source', 'a', 'r-a', 'a'),
        connect('w2', 'r-a', 'b', 'display', 'top-4'),
        connect('w3', 'display', 'top-3', 'source', 'b'),
      ],
    );
    const unpowered = doc([component('source', 'source', 5), display], []);
    const poweredResult = resultFor(powered, 'display');
    const unpoweredResult = resultFor(unpowered, 'display');
    expect(poweredResult?.branchBrightness?.a).toBeGreaterThan(0);
    expect(poweredResult?.branchBrightness?.b).toBe(0);
    expect(Object.values(unpoweredResult?.branchBrightness ?? {})).toEqual(
      expect.arrayContaining([0, 0, 0, 0, 0, 0, 0, 0]),
    );
    expect(unpoweredResult?.lit).toBe(false);
  });

  it('energizes a resistive lamp', () => {
    const result = solveCircuit(series([component('lamp1', 'lamp', 20)], 5));
    const limited = solveCircuit(
      series([component('r1', 'resistor', 300), component('lamp1', 'lamp', 24)], 5),
    );
    expect(result.current).toBeCloseTo(0.25, 6);
    expect(result.components.find((item) => item.componentId === 'lamp1')?.lit).toBe(true);
    expect(limited.components.find((item) => item.componentId === 'lamp1')?.lit).toBe(true);
    expect(
      result.components.find((item) => item.componentId === 'lamp1')?.brightness,
    ).toBeGreaterThan(
      limited.components.find((item) => item.componentId === 'lamp1')?.brightness ?? 0,
    );
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
    const invalid = solveCircuit(series([component('lamp1', 'lamp', 0)], 5));
    expect(short.diagnostics.map((item) => item.code)).toContain('short_circuit');
    expect(open.diagnostics.map((item) => item.code)).toContain('open_circuit');
    expect(noSource.diagnostics.map((item) => item.code)).toContain('no_source');
    expect(invalid.diagnostics.map((item) => item.code)).toContain('invalid_property');
  });

  it('returns byte-for-byte deterministic results', () => {
    const document = series([component('r1', 'resistor', 470), component('led1', 'led', 2)], 9);
    expect(JSON.stringify(solveCircuit(document))).toBe(JSON.stringify(solveCircuit(document)));
  });

  it('solves the maximum supported 300-component document without losing numerical validity', () => {
    const resistors = Array.from({ length: 299 }, (_, index) =>
      component(`r-${String(index).padStart(3, '0')}`, 'resistor', 1000),
    );
    const result = solveCircuit(series(resistors, 5));
    expect(result.status).toBe('solved');
    expect(result.current).toBeCloseTo(5 / 299_000, 6);
    expect(result.numericalResidual).toBeLessThanOrEqual(result.numericalTolerance);
  });
});
