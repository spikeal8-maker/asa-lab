import { describe, expect, it } from 'vitest';
import { solveLinear } from '../domain/linear-system';

describe('deterministic linear-system elimination', () => {
  it('solves the empty system', () => {
    expect(solveLinear([], [])).toEqual([]);
  });

  it.each([
    { name: 'one variable', matrix: [[2]], rhs: [6], solution: [3] },
    {
      name: 'first pivot swap',
      matrix: [
        [0, 2],
        [3, 4],
      ],
      rhs: [4, 11],
      solution: [1, 2],
    },
    {
      name: 'later pivot swap',
      matrix: [
        [2, 1, 0],
        [0, 0, 3],
        [0, 4, 5],
      ],
      rhs: [4, 9, 23],
      solution: [1, 2, 3],
    },
    {
      name: 'equal absolute pivots',
      matrix: [
        [1, 1],
        [-1, 2],
      ],
      rhs: [3, 3],
      solution: [1, 2],
    },
    {
      name: 'MNA ideal source with resistor branches',
      matrix: [
        [0.01, -0.01, 1],
        [-0.01, 0.02, 0],
        [1, 0, 0],
      ],
      rhs: [0, 0, 5],
      solution: [5, 2.5, -0.025],
    },
  ])('solves $name without modifying caller inputs', ({ matrix, rhs, solution }) => {
    const originalMatrix = structuredClone(matrix);
    const originalRhs = [...rhs];
    matrix.forEach(Object.freeze);
    Object.freeze(matrix);
    Object.freeze(rhs);
    expect(solveLinear(matrix, rhs)).toEqual(solution);
    expect(matrix).toEqual(originalMatrix);
    expect(rhs).toEqual(originalRhs);
  });

  it('returns null for a singular system', () => {
    expect(
      solveLinear(
        [
          [1, 2],
          [2, 4],
        ],
        [3, 6],
      ),
    ).toBeNull();
  });

  it.each([0, -0, Number.MIN_VALUE, 1e-14 * (1 - Number.EPSILON)])(
    'rejects a pivot below the existing threshold: %s',
    (pivot) => {
      expect(solveLinear([[pivot]], [pivot])).toBeNull();
    },
  );

  it.each([1e-14, -1e-14, 1e-14 * (1 + Number.EPSILON)])(
    'accepts a pivot at or above the existing threshold: %s',
    (pivot) => {
      expect(solveLinear([[pivot]], [pivot])).toEqual([1]);
    },
  );

  it('keeps the strict factor threshold and the original subtraction', () => {
    const below = 1e-18 * (1 - Number.EPSILON);
    expect(
      solveLinear(
        [
          [1, 0],
          [below, 1],
        ],
        [1e18, 2],
      ),
    ).toEqual([1e18, 2]);
    expect(
      solveLinear(
        [
          [1, 0],
          [1e-18, 1],
        ],
        [1e18, 2],
      ),
    ).toEqual([1e18, 1]);
  });

  it('keeps signed zero from division', () => {
    expect(Object.is(solveLinear([[-2]], [0])?.[0], -0)).toBe(true);
  });

  it('retains the operation order for an ill-conditioned system', () => {
    expect(
      solveLinear(
        [
          [1e-13, 1],
          [1, 1e13 + 1],
        ],
        [1, 1e13],
      ),
    ).toEqual([1e13, -0]);
  });

  it('keeps the first row when absolute pivot values tie', () => {
    expect(
      solveLinear(
        [
          [0.1, 0.13],
          [-0.1, 0.17],
        ],
        [0.223, 0.931],
      ),
    ).toEqual([-2.7706666666666666, 3.8466666666666667]);
  });

  it('keeps literal division rather than multiplication by a reciprocal', () => {
    expect(
      solveLinear(
        [
          [0.10060000000000001, 0.7],
          [0.2, 0.3014],
        ],
        [0.346, 1.662],
      ),
    ).toEqual([9.656488981133698, -0.8934897021457858]);
  });

  it('retains null for an absent matrix pivot', () => {
    expect(solveLinear([], [1])).toBeNull();
    expect(solveLinear(new Array<number[]>(2), [1, 2])).toBeNull();
  });

  it('preserves the existing short matrix exception', () => {
    expect(() => solveLinear([[1]], [1, 2])).toThrow(TypeError);
  });

  it('preserves the existing invalid row exception', () => {
    expect(() => solveLinear([null] as unknown as number[][], [1])).toThrow(TypeError);
  });

  it('keeps non-finite results for holey numeric rows at this internal boundary', () => {
    const result = solveLinear([new Array<number>(2), [1, 2]], [3, 4]);
    expect(result).toHaveLength(2);
    expect(result?.every(Number.isNaN)).toBe(true);
  });
});
