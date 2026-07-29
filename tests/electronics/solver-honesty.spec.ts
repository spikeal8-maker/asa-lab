import { describe, expect, it } from 'vitest';
import { parseElectronicsDocument } from '../../contexts/electronics/domain/document';
import { solveCircuit } from '../../contexts/electronics/domain/solver';

function parse(components: unknown[], connections: unknown[], physical = true) {
  const parsed = parseElectronicsDocument({
    schemaVersion: 1,
    ...(physical ? { geometryProfile: 'breadboard-2.54mm-v1' } : {}),
    components,
    connections,
  });
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.document;
}

function component(id: string, kind: string, value: number) {
  return { id, kind, position: { x: 0, y: 0 }, value };
}

function connection(id: string, from: string, fromTerminal: string, to: string, toTerminal: string) {
  return {
    id,
    from: { componentId: from, terminal: fromTerminal },
    to: { componentId: to, terminal: toTerminal },
  };
}

function series(sourceVoltage: number, resistance: number, ledDrop = 2, physical = true) {
  return parse(
    [
      component('src', 'source', sourceVoltage),
      component('r1', 'resistor', resistance),
      component('led1', 'led', ledDrop),
    ],
    [
      connection('w1', 'src', 'a', 'r1', 'a'),
      connection('w2', 'r1', 'b', 'led1', 'a'),
      connection('w3', 'led1', 'b', 'src', 'b'),
    ],
    physical,
  );
}

describe('honest Electronics foundation solver', () => {
  it('never fabricates a finite short-circuit current', () => {
    const document = parse(
      [component('src', 'source', 3), component('wire1', 'wire', 0)],
      [
        connection('w1', 'src', 'a', 'wire1', 'a'),
        connection('w2', 'wire1', 'b', 'src', 'b'),
      ],
    );
    const result = solveCircuit(document);
    expect(result.solved).toBe(false);
    expect(result.current).toBe(0);
    expect(result.components).toEqual([]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'short_circuit', severity: 'error' }),
    );
    expect(result.diagnostics[0]?.message).toContain('Ток не рассчитан');
  });

  it('separates recommended LED current from damage risk', () => {
    const recommendedWarning = solveCircuit(series(3, 40)); // 25 mA
    expect(recommendedWarning.solved).toBe(true);
    expect(recommendedWarning.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'overcurrent', severity: 'warning' }),
    );
    expect(recommendedWarning.diagnostics.map((item) => item.code)).not.toContain('led_damage_risk');

    const damageRisk = solveCircuit(series(3, 20)); // 50 mA
    expect(damageRisk.solved).toBe(true);
    expect(damageRisk.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'led_damage_risk', severity: 'error' }),
    );
  });

  it('warns about legacy custom values only after the document enters the physical profile', () => {
    const physical = solveCircuit(series(5, 300, 2, true));
    const legacy = solveCircuit(series(5, 300, 2, false));
    expect(physical.diagnostics.map((item) => item.code)).toContain('non_nominal_component');
    expect(legacy.diagnostics.map((item) => item.code)).not.toContain('non_nominal_component');
  });

  it('does not invent a result for branching topology', () => {
    const document = parse(
      [
        component('src', 'source', 3),
        component('r1', 'resistor', 300),
        component('r2', 'resistor', 300),
        component('r3', 'resistor', 300),
      ],
      [
        connection('c1', 'src', 'a', 'r1', 'a'),
        connection('c2', 'src', 'a', 'r2', 'a'),
        connection('c3', 'r1', 'b', 'r3', 'a'),
        connection('c4', 'r2', 'b', 'r3', 'a'),
        connection('c5', 'r3', 'b', 'src', 'b'),
      ],
    );
    const result = solveCircuit(document);
    expect(result.solved).toBe(false);
    expect(result.current).toBe(0);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'not_series', severity: 'error' }),
    );
  });
});
