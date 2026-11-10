import { describe, expect, it, vi } from 'vitest';
import type { ElectronicsDocument, SchematicComponent, Terminal } from '../domain/document';
import {
  analyseCircuit,
  compileCircuit,
  createArduinoQualityTraversal,
  verifyCircuitQuality,
} from '../domain/simulation';
import { terminalKey } from '../domain/netlist';
import * as solver from '../domain/solver';

const part = (id: string, kind: SchematicComponent['kind'], value: number): SchematicComponent => ({
  id,
  kind,
  value,
  position: { x: 0, y: 0 },
});
const wire = (id: string, from: string, a: Terminal, to: string, b: Terminal) => ({
  id,
  from: { componentId: from, terminal: a },
  to: { componentId: to, terminal: b },
  color: '#149447',
  vertices: [],
});
function divider(
  voltage = 23.5,
  upper = 31622.776601683792,
  lower = 1_000_000,
  prefix = '',
  reverse = false,
): ElectronicsDocument {
  const s = `${prefix}s`,
    a = `${prefix}r1`,
    b = `${prefix}r2`;
  return {
    schemaVersion: 4,
    components: [
      part(s, 'source', voltage),
      part(a, 'resistor', upper),
      part(b, 'resistor', lower),
    ],
    connections: [
      wire(`${prefix}w1`, s, reverse ? 'b' : 'a', a, 'a'),
      wire(`${prefix}w2`, a, 'b', b, 'a'),
      wire(`${prefix}w3`, b, 'b', s, reverse ? 'a' : 'b'),
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
    simulation: { running: false, maxIterations: 24 },
  };
}
function groupedTerminalPower(frame: solver.SolveResult): number {
  return frame.components.reduce(
    (total, component) =>
      total +
      Object.entries(component.terminalCurrents ?? {}).reduce(
        (power, [terminal, current]) =>
          power + (component.terminalVoltages[terminal] ?? 0) * (current ?? 0),
        0,
      ),
    0,
  );
}
const roundPower = (power: number) => Math.round(power * 1e12) / 1e12;
function expectedPowerResidual(frame: solver.SolveResult): number {
  const numericalPower = frame.nodes.reduce(
    (sum, node) => sum + 1e-12 * node.voltage * node.voltage,
    0,
  );
  return roundPower(Math.abs(groupedTerminalPower(frame) + numericalPower));
}

describe('numerical node-shunt power balance', () => {
  it.each([undefined, 1, 25])(
    'accepts the high-resistance divider at %s ms without increasing tolerances',
    (simulationTimeMs) => {
      const document = divider();
      const options = simulationTimeMs === undefined ? {} : { simulationTimeMs };
      const raw = solver.solveCircuit(document, options);
      expect(Math.abs(groupedTerminalPower(raw))).toBeGreaterThan(1e-9);
      const result = analyseCircuit(document, options);
      expect(result).toMatchObject({
        solved: true,
        status: 'solved',
        quality: {
          passed: true,
          finite: true,
          powerBalanceToleranceWatt: 1e-9,
          kclToleranceAmp: 1e-6,
          sourceVoltageToleranceVolt: 1e-9,
        },
      });
      expect(result.quality.powerBalanceResidualWatt).toBe(expectedPowerResidual(raw));
      expect(result.quality.powerBalanceResidualWatt).toBeLessThan(1e-11);
      expect(result.components.find((c) => c.componentId === 'r2')?.voltageDrop).toBeCloseTo(
        23.5e6 / (1e6 + 31622.776601683792),
        5,
      );
    },
  );

  it('retains analytic voltages and finite quality over a voltage/resistance sweep', () => {
    for (const voltage of [3, 12, 23.5, 30])
      for (const upper of [330, 31622.776601683792, 1e6])
        for (const lower of [1000, 100000, 1e6]) {
          const document = divider(voltage, upper, lower);
          const result = analyseCircuit(document);
          expect(
            result.quality.passed,
            JSON.stringify({ voltage, upper, lower, quality: result.quality }),
          ).toBe(true);
          expect(result.components.find((c) => c.componentId === 'r2')?.voltageDrop).toBeCloseTo(
            (voltage * lower) / (upper + lower),
            4,
          );
          expect(result.components.find((c) => c.componentId === 'r1')?.current).toBeCloseTo(
            voltage / (upper + lower),
            8,
          );
          expect(JSON.stringify(analyseCircuit(document))).toBe(JSON.stringify(result));
        }
  });

  it('counts each node once across independent references, source polarity and reordered geometry', () => {
    const first = divider();
    const second = divider(30, 47000, 1e6, 'other-', true);
    const document = {
      ...first,
      components: [...first.components, ...second.components, part('loose-source', 'source', 24)],
      connections: [...first.connections, ...second.connections],
    };
    const raw = solver.solveCircuit(document);
    const result = analyseCircuit(document);
    expect(result.quality.passed).toBe(true);
    expect(raw.nodes.filter((node) => node.voltage === 0)).toHaveLength(3);
    expect(result.quality.powerBalanceResidualWatt).toBe(expectedPowerResidual(raw));
    expect(
      verifyCircuitQuality(
        document,
        compileCircuit(document),
        { ...raw, nodes: [...raw.nodes].reverse() },
        {},
      ),
    ).toEqual(result.quality);
    const reordered = {
      ...document,
      components: [...document.components]
        .reverse()
        .map((c) => ({ ...c, position: { x: 400, y: -200 } })),
      connections: [...document.connections]
        .reverse()
        .map((c) => ({ ...c, vertices: [{ x: 300, y: 150 }] })),
    };
    expect(analyseCircuit(reordered).quality).toEqual(result.quality);
  });

  it.each([-1, 1])(
    'still rejects a physical power imbalance below the KCL limit, sign %s',
    (direction) => {
      const document = divider();
      const frame = solver.solveCircuit(document);
      const source = frame.components.find((c) => c.componentId === 's')!;
      Reflect.set(source.terminalCurrents!, 'a', source.terminalCurrents!['a']! + direction * 1e-9);
      const quality = verifyCircuitQuality(document, compileCircuit(document), frame, {});
      expect(quality.finite).toBe(true);
      expect(quality.maxKclResidualAmp).toBeLessThan(quality.kclToleranceAmp);
      expect(quality.powerBalanceResidualWatt).toBeGreaterThan(quality.powerBalanceToleranceWatt);
      expect(quality.passed).toBe(false);
    },
  );

  it.each(['forged-node', 'coherent-shift', 'contradictory-terminal', 'missing-coverage'] as const)(
    'rejects %s in both the full and owned power check',
    (tamper) => {
      // Delimiters in IDs must be resolved through terminalKey, never split.
      const document = divider(23.5, 31622.776601683792, 1e6, 'board:1:');
      const compiled = compileCircuit(document);
      const reuse = solver.createArduinoOperatingPointReuse();
      const layouts = solver.createArduinoQualityLayoutOwner(reuse);
      const traversal = createArduinoQualityTraversal(document, compiled, layouts.owner);
      const readKeys = vi.spyOn(solver, 'arduinoQualityDictionaryKeys');
      try {
        const frame = solver.solveCircuitWithHeldArduino(
          document,
          1,
          new Map(),
          undefined,
          undefined,
          undefined,
          undefined,
          reuse,
        );
        expect(verifyCircuitQuality(document, compiled, frame, {}).passed).toBe(true);
        const source = frame.components.find((c) => c.componentId === 'board:1:s')!;
        Reflect.set(source.terminalCurrents!, 'a', source.terminalCurrents!['a']! - 1e-9);
        const target = frame.nodes.find((node) => node.voltage === 23.5)!;
        if (tamper === 'forged-node') {
          const otherShunts = frame.nodes.reduce(
            (sum, node) => sum + (node === target ? 0 : 1e-12 * node.voltage * node.voltage),
            0,
          );
          Reflect.set(
            target,
            'voltage',
            Math.sqrt((-groupedTerminalPower(frame) - otherShunts) / 1e-12),
          );
          // This forged observation used to cancel the physical current error exactly.
          expect(expectedPowerResidual(frame)).toBe(0);
        } else if (tamper === 'coherent-shift') {
          Reflect.set(source.terminalCurrents!, 'b', source.terminalCurrents!['b']! + 1e-9);
          const totalCurrent = frame.components.reduce(
            (sum, c) =>
              sum + Object.values(c.terminalCurrents!).reduce<number>((a, i) => a + (i ?? 0), 0),
            0,
          );
          const a = 1e-12 * frame.nodes.length;
          const b = totalCurrent + 2e-12 * frame.nodes.reduce((sum, node) => sum + node.voltage, 0);
          const c =
            groupedTerminalPower(frame) +
            frame.nodes.reduce((sum, node) => sum + 1e-12 * node.voltage ** 2, 0);
          const offset = (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
          expect(offset).toBeGreaterThan(70);
          for (const node of frame.nodes) Reflect.set(node, 'voltage', node.voltage + offset);
          for (const component of frame.components)
            for (const terminal of Object.keys(component.terminalVoltages))
              Reflect.set(
                component.terminalVoltages,
                terminal,
                component.terminalVoltages[terminal]! + offset,
              );
          // A coherent gauge shift used to fabricate dissipation at the un-stamped reference.
          expect(expectedPowerResidual(frame)).toBe(0);
        } else if (tamper === 'contradictory-terminal') {
          Reflect.set(source.terminalVoltages, 'a', 23.500001);
        } else {
          const targetIndex = compiled.nets.findIndex((net) => net.id === target.id);
          for (const component of frame.components)
            for (const terminal of Object.keys(component.terminalVoltages))
              if (
                compiled.netlist.nodeOf.get(terminalKey(component.componentId, terminal)) ===
                targetIndex
              )
                Reflect.deleteProperty(component.terminalVoltages, terminal);
        }
        const quality = verifyCircuitQuality(document, compiled, frame, {});
        expect(quality.finite).toBe(true);
        expect(quality.passed).toBe(false);
        expect(quality.maxKclResidualAmp).toBeLessThan(quality.kclToleranceAmp);
        expect(Number.isFinite(quality.powerBalanceResidualWatt)).toBe(true);
        readKeys.mockClear();
        expect(traversal.verify(frame, {})).toStrictEqual(quality);
        expect(readKeys).toHaveBeenCalled();
      } finally {
        readKeys.mockRestore();
        traversal.dispose();
        layouts.dispose();
      }
    },
  );

  it('does not let malformed node identities or voltages compensate power imbalance', () => {
    const document = divider();
    const compiled = compileCircuit(document);
    const original = solver.solveCircuit(document);
    const invalidNodes = [
      original.nodes.slice(1),
      [...original.nodes, { ...original.nodes[0]!, id: 'not-a-compiled-node', voltage: 1e6 }],
      original.nodes.map((node, i) => (i === 0 ? { ...node, id: original.nodes[1]!.id } : node)),
      original.nodes.map((node, i) => (i === 0 ? { ...node, id: 'not-a-compiled-node' } : node)),
      ...[NaN, Infinity, -Infinity, 1e300].map((voltage) =>
        original.nodes.map((node, i) => (i === 0 ? { ...node, voltage } : node)),
      ),
    ];
    for (const nodes of invalidNodes) {
      const quality = verifyCircuitQuality(document, compiled, { ...original, nodes }, {});
      expect(quality.passed).toBe(false);
      expect(Number.isFinite(quality.powerBalanceResidualWatt)).toBe(true);
      expect(Number.isFinite(quality.powerBalanceToleranceWatt)).toBe(true);
    }
  });

  it('rejects fabricated node observations and mixed solver frames without private provenance', () => {
    const document = divider();
    const compiled = compileCircuit(document);
    const original = solver.solveCircuit(document);
    const other = solver.solveCircuit(document);
    for (const nodes of [
      structuredClone(original.nodes),
      original.nodes.map((node, index) => (index === 0 ? other.nodes[index]! : node)),
    ]) {
      expect(nodes).toEqual(original.nodes);
      const quality = verifyCircuitQuality(document, compiled, { ...original, nodes }, {});
      expect(quality.finite).toBe(true);
      expect(quality.passed).toBe(false);
    }
    // Public serialization contains no witness. A reopened document is re-solved.
    const restored = solver.solveCircuit(
      JSON.parse(JSON.stringify(document)) as ElectronicsDocument,
    );
    expect(JSON.stringify(restored)).toBe(JSON.stringify(original));
    expect(verifyCircuitQuality(document, compiled, restored, {}).passed).toBe(true);
  });

  it('keeps the full and actual owned quality paths equal without changing physical frames', () => {
    const document = divider();
    const compiled = compileCircuit(document);
    const reuse = solver.createArduinoOperatingPointReuse();
    const layouts = solver.createArduinoQualityLayoutOwner(reuse);
    const traversal = createArduinoQualityTraversal(document, compiled, layouts.owner);
    const readKeys = vi.spyOn(solver, 'arduinoQualityDictionaryKeys');
    try {
      for (const time of [0, 1, 25]) {
        const frame = solver.solveCircuitWithHeldArduino(
          document,
          time,
          new Map(),
          undefined,
          undefined,
          undefined,
          undefined,
          reuse,
        );
        const before = JSON.stringify(frame);
        const reference = verifyCircuitQuality(document, compiled, frame, {
          simulationTimeMs: time,
        });
        expect(reference.passed).toBe(true);
        readKeys.mockClear();
        expect(traversal.verify(frame, { simulationTimeMs: time })).toStrictEqual(reference);
        expect(readKeys).toHaveBeenCalled();
        expect(JSON.stringify(frame)).toBe(before);
        expect(JSON.stringify(solver.solveCircuitWithHeldArduino(document, time, new Map()))).toBe(
          before,
        );
      }
    } finally {
      readKeys.mockRestore();
      traversal.dispose();
      layouts.dispose();
    }
  });

  it('does not invent a partial power balance for an off-diode frame without terminal currents', () => {
    const document: ElectronicsDocument = {
      ...divider(),
      components: [part('s', 'source', 100), part('d', 'diode', 0.7)],
      connections: [wire('a', 's', 'a', 'd', 'b'), wire('b', 'd', 'a', 's', 'b')],
    };
    const frame = solver.solveCircuit(document);
    const quality = verifyCircuitQuality(document, compileCircuit(document), frame, {});
    expect(frame.solved).toBe(true);
    expect(frame.components.find((c) => c.componentId === 'd')?.terminalCurrents).toBeUndefined();
    expect(quality.powerBalanceResidualWatt).toBe(0);
    expect(quality.passed).toBe(true);
  });
});
