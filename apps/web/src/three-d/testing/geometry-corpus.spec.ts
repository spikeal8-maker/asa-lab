import { describe, expect, it } from 'vitest';
// eslint-disable-next-line @nx/enforce-module-boundaries
import { THREE_D_GEOMETRY_CORPUS } from '../../../../../contexts/three-d/testing/corpus/cases';
// eslint-disable-next-line @nx/enforce-module-boundaries
import { THREE_D_CORPUS_VERSION } from '../../../../../contexts/three-d/testing/corpus/expectations';
import { evaluateGeometryCase } from './geometry-corpus';

describe('ASA 3D OPT-0 geometry corpus', () => {
  it('has a versioned, uniquely identified corpus tied to registered problems', () => {
    expect(THREE_D_CORPUS_VERSION).toBe(1);
    expect(THREE_D_GEOMETRY_CORPUS.length).toBeGreaterThanOrEqual(15);
    expect(new Set(THREE_D_GEOMETRY_CORPUS.map((testCase) => testCase.id)).size).toBe(
      THREE_D_GEOMETRY_CORPUS.length,
    );
    expect(new Set(THREE_D_GEOMETRY_CORPUS.map((testCase) => testCase.tier))).toEqual(
      new Set(['correctness', 'interaction', 'stress']),
    );
    for (const testCase of THREE_D_GEOMETRY_CORPUS) {
      expect(testCase.problemIds.length, testCase.id).toBeGreaterThan(0);
      expect(
        testCase.problemIds.every((id) => /^3D-[A-Z]+-\d{3}$/.test(id)),
        testCase.id,
      ).toBe(true);
      expect(testCase.tags.length, testCase.id).toBeGreaterThan(0);
    }
  });

  it.each(THREE_D_GEOMETRY_CORPUS)('$id produces a deterministic measured receipt', (testCase) => {
    const first = evaluateGeometryCase(testCase);
    const second = evaluateGeometryCase(testCase);

    expect(first.caseId).toBe(testCase.id);
    expect(first.durationMs).toBeGreaterThanOrEqual(0);
    expect(second.durationMs).toBeGreaterThanOrEqual(0);
    expect(second.resultKind).toBe(first.resultKind);
    expect(second.diagnosticCodes).toEqual(first.diagnosticCodes);
    expect(second.triangleCount).toBe(first.triangleCount);
    expect(second.bounds).toEqual(first.bounds);
    expect(second.checksum).toBe(first.checksum);

    if (testCase.expectation.kind === 'valid-solid') {
      expect(first.resultKind, testCase.id).toBe('valid-solid');
      expect(first.diagnosticCodes, testCase.id).toEqual([]);
      expect(first.triangleCount, testCase.id).toBeGreaterThan(0);
      expect(first.volumeMm3, testCase.id).toBeGreaterThan(0);
    } else if (testCase.expectation.kind === 'valid-empty') {
      expect(first.resultKind, testCase.id).toBe('valid-empty');
    } else if (testCase.expectation.kind === 'typed-rejection') {
      const expectedCodes = testCase.expectation.codes;
      expect(['validation-rejection', 'engine-exception'], testCase.id).toContain(first.resultKind);
      expect(first.diagnosticCodes.some((code) => expectedCodes.includes(code))).toBe(true);
    } else {
      // A legacy failure remains visible in the baseline instead of being
      // silently reclassified as a successful printable result.
      expect(testCase.expectation.issue.length).toBeGreaterThan(0);
    }
  });
});
