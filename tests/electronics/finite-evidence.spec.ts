import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanFiniteNumbers } from './finite-evidence';

const source = readFileSync(resolve('e2e/electronics-selection-outline.spec.ts'), 'utf8');
const assertionBody = source.match(
  /function assertFinite\(value: unknown\) \{([\s\S]*?)\r?\n\}/,
)![1];

// Execute the actual native-journey assertion body without bootstrapping its
// browser/database fixtures. The injected adapter records hard result assertions.
function actualAssertion(onScan: (value: unknown) => void = () => {}) {
  let calls = 0;
  const check = new Function('value', 'scanFiniteNumbers', 'expect', assertionBody);
  return {
    check(value: unknown) {
      return check(
        value,
        (original: unknown) => {
          onScan(original);
          return scanFiniteNumbers(original);
        },
        (leaves: unknown, message: string) => {
          calls++;
          return { toEqual: (expected: unknown) => expect(leaves, message).toEqual(expected) };
        },
      );
    },
    count: () => calls,
  };
}

describe('complete finite-number evidence', () => {
  it('counts nested objects/arrays and ignores mixed nonnumeric fields', () => {
    expect(
      scanFiniteNumbers({ a: [1, { b: -2, text: 'NaN' }], nil: null, yes: true, no: undefined }),
    ).toEqual({
      numericLeafCount: 2,
      nonFiniteLeaves: [],
    });
    for (const value of [null, undefined, false, '', [], {}])
      expect(scanFiniteNumbers(value)).toEqual({ numericLeafCount: 0, nonFiniteLeaves: [] });
  });

  it('accepts finite edge values without losing zero, subnormal or maximal values', () => {
    const values = [
      0,
      -0,
      Number.MIN_VALUE,
      -Number.MIN_VALUE,
      Number.MAX_VALUE,
      -Number.MAX_VALUE,
      Number.MAX_SAFE_INTEGER,
      Number.MIN_SAFE_INTEGER,
      Number.EPSILON,
    ];
    expect(scanFiniteNumbers(values)).toEqual({
      numericLeafCount: values.length,
      nonFiniteLeaves: [],
    });
  });

  it('collects all nonfinite leaves with unambiguous paths and continues after failures', () => {
    expect(
      scanFiniteNumbers({ 'a.b': [NaN, { 'quoted"key': Infinity }, -Infinity, 5], tail: 6 }),
    ).toEqual({
      numericLeafCount: 5,
      nonFiniteLeaves: [
        { path: '$["a.b"][0]', value: NaN },
        { path: '$["a.b"][1]["quoted\\"key"]', value: Infinity },
        { path: '$["a.b"][2]', value: -Infinity },
      ],
    });
    expect(scanFiniteNumbers(NaN).nonFiniteLeaves).toEqual([{ path: '$', value: NaN }]);
  });

  it('visits every repeated subtree occurrence rather than deduplicating by identity', () => {
    const repeated = { values: [1, Infinity, 3] };
    expect(scanFiniteNumbers([repeated, repeated])).toEqual({
      numericLeafCount: 6,
      nonFiniteLeaves: [
        { path: '$[0]["values"][1]', value: Infinity },
        { path: '$[1]["values"][1]', value: Infinity },
      ],
    });
  });

  it('matches the original finite rejection semantics on complete mixed trees', () => {
    function legacy(value: unknown): void {
      if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new Error('nonfinite');
      } else if (Array.isArray(value)) for (const item of value) legacy(item);
      else if (value && typeof value === 'object')
        for (const item of Object.values(value)) legacy(item);
    }
    for (const leaf of [0, -0, Number.MIN_VALUE, Number.MAX_VALUE, NaN, Infinity, -Infinity]) {
      const value = { readings: [1, { nested: leaf }], tail: [2, 3] };
      let rejected = false;
      try {
        legacy(value);
      } catch {
        rejected = true;
      }
      expect(scanFiniteNumbers(value).nonFiniteLeaves.length > 0).toBe(rejected);
    }
  });

  it('executes the actual E11 hard assertion once for each complete result, scanning all 129276 leaves', () => {
    expect(source).toContain(
      "import { scanFiniteNumbers } from '../tests/electronics/finite-evidence'",
    );
    expect(source.match(/assertFinite\(response\.advance\.result\)/g)).toHaveLength(1);
    const originals = Array.from({ length: 342 }, (_, result) => ({
      readings: Array.from({ length: 126 }, (_, sample) => ({
        volts: result,
        amps: sample,
        time: sample * 0.1,
      })),
      status: 'solved',
    }));
    const seen: unknown[] = [];
    const assertion = actualAssertion((value) => seen.push(value));
    for (const result of originals) assertion.check(result);
    expect(seen).toHaveLength(342);
    seen.forEach((value, index) => expect(value).toBe(originals[index]));
    expect(
      seen.reduce<number>((sum, value) => sum + scanFiniteNumbers(value).numericLeafCount, 0),
    ).toBe(129276);
    expect(assertion.count()).toBe(342);
  });

  for (const value of [NaN, Infinity, -Infinity])
    it(`hard-fails the actual E11 assertion for ${String(value)} with the offending path`, () => {
      const assertion = actualAssertion();
      expect(() => assertion.check({ measurements: [{ volts: value }] })).toThrow('measurements');
      expect(assertion.count()).toBe(1);
    });
});
