import { describe, expect, it } from 'vitest';
import {
  planCapacitorConstraints,
  recoverCapacitorCurrents,
  type CapacitorVoltageConstraint,
} from '../domain/capacitor-constraints.js';

const edge = (
  componentId: string,
  positiveNode: number,
  negativeNode: number,
  capacitanceFarad = 1e-6,
  voltageVolt = 0,
): CapacitorVoltageConstraint => ({
  componentId,
  positiveNode,
  negativeNode,
  capacitanceFarad,
  voltageVolt,
});

describe('dependent capacitor voltage constraints', () => {
  it('keeps one parallel voltage constraint and divides current by capacitance', () => {
    const plan = planCapacitorConstraints([edge('b', 0, 1, 3e-6, 2), edge('a', 0, 1, 1e-6, 2)])!;
    expect([...plan.independentIds]).toEqual(['a']);
    const currents = recoverCapacitorCurrents(plan, new Map([['a', 0.004]]))!;
    expect(currents.get('a')).toBeCloseTo(0.001, 12);
    expect(currents.get('b')).toBeCloseTo(0.003, 12);
  });
  it('respects reversed branch orientation without changing physical current division', () => {
    const plan = planCapacitorConstraints([edge('a', 0, 1, 1e-6, 2), edge('b', 1, 0, 3e-6, -2)])!;
    const currents = recoverCapacitorCurrents(plan, new Map([['a', 0.004]]))!;
    expect(currents.get('a')).toBeCloseTo(0.001, 12);
    expect(currents.get('b')).toBeCloseTo(-0.003, 12);
  });
  it('recovers triangle currents: a series pair of equal capacitors in parallel with one', () => {
    const plan = planCapacitorConstraints([
      edge('a', 0, 1, 1e-6, 1),
      edge('b', 1, 2, 1e-6, 1),
      edge('c', 0, 2, 1e-6, 2),
    ])!;
    expect([...plan.independentIds]).toEqual(['a', 'b']);
    const currents = recoverCapacitorCurrents(
      plan,
      new Map([
        ['a', 0.003],
        ['b', 0.003],
      ]),
    )!;
    expect(currents.get('a')).toBeCloseTo(0.001, 12);
    expect(currents.get('b')).toBeCloseTo(0.001, 12);
    expect(currents.get('c')).toBeCloseTo(0.002, 12);
  });
  it('rejects conflicting parallel, reversed, loop and shorted charged constraints', () => {
    for (const edges of [
      [edge('a', 0, 1, 1e-6, 1), edge('b', 0, 1, 1e-6, 2)],
      [edge('a', 0, 1, 1e-6, 1), edge('b', 1, 0, 1e-6, 1)],
      [edge('a', 0, 1, 1e-6, 1), edge('b', 1, 2, 1e-6, 1), edge('c', 0, 2, 1e-6, 3)],
      [edge('a', 0, 0, 1e-6, 1)],
    ])
      expect(planCapacitorConstraints(edges)).toBeNull();
  });
  it('allows an uncharged wire-shorted capacitor without inventing a branch current', () => {
    const plan = planCapacitorConstraints([edge('a', 1, 1)])!;
    expect([...plan.independentIds]).toEqual([]);
    expect([...recoverCapacitorCurrents(plan, new Map())!]).toEqual([['a', 0]]);
  });
  it('separates disconnected groups and is invariant to input array order', () => {
    const edges = [edge('a', 0, 1), edge('b', 0, 1), edge('c', 3, 4), edge('d', 4, 4)];
    const plan = planCapacitorConstraints(edges)!;
    expect(planCapacitorConstraints([...edges].reverse())).toEqual(plan);
    const currents = recoverCapacitorCurrents(
      plan,
      new Map([
        ['a', 0.004],
        ['c', -0.002],
      ]),
    )!;
    expect([...currents]).toEqual([
      ['a', 0.002],
      ['b', 0.002],
      ['c', -0.002],
      ['d', 0],
    ]);
  });
  it('retains tiny capacitances across the supported nine-decade range', () => {
    const plan = planCapacitorConstraints([edge('a', 0, 1, 1e-9), edge('b', 0, 1, 1)])!;
    const currents = recoverCapacitorCurrents(plan, new Map([['a', 1]]))!;
    expect(currents.get('a')).toBeCloseTo(1e-9 / (1 + 1e-9), 16);
    expect(currents.get('b')).toBeCloseTo(1 / (1 + 1e-9), 12);
  });
  it('rejects malformed constraints and missing/nonfinite MNA currents', () => {
    for (const change of [
      { capacitanceFarad: 0 },
      { voltageVolt: NaN },
      { positiveNode: -1 },
      { negativeNode: Infinity },
    ])
      expect(planCapacitorConstraints([{ ...edge('a', 0, 1), ...change }])).toBeNull();
    expect(planCapacitorConstraints([edge('a', 0, 1), edge('a', 0, 1)])).toBeNull();
    const plan = planCapacitorConstraints([edge('a', 0, 1)])!;
    expect(recoverCapacitorCurrents(plan, new Map())).toBeNull();
    expect(recoverCapacitorCurrents(plan, new Map([['a', NaN]]))).toBeNull();
  });
});
