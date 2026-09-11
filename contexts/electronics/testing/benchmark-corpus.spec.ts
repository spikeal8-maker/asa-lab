import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../domain/simulation-input-digest.js';
import { ELECTRONICS_BENCHMARK_CORPUS } from './benchmark-corpus.js';

function statusOf(value: unknown, operation: string): string {
  if (operation === 'digest') return 'digest';
  if (!value || typeof value !== 'object') return 'invalid-result';
  const record = value as Record<string, unknown>;
  return operation === 'arduino-clock'
    ? String(record.executionStatus ?? 'missing')
    : String(record.status ?? 'missing');
}

function fingerprint(value: unknown): string {
  return sha256Hex(typeof value === 'string' ? value : JSON.stringify(value));
}

describe('E-OPT-0 benchmark corpus', () => {
  it('has unique ids and includes micro, medium and stress tiers', () => {
    const ids = ELECTRONICS_BENCHMARK_CORPUS.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(ELECTRONICS_BENCHMARK_CORPUS.map((entry) => entry.tier))).toEqual(
      new Set(['micro', 'medium', 'stress']),
    );
    expect(ids.length).toBeGreaterThanOrEqual(30);
  });

  it('keeps every benchmark case deterministic and on its declared status', () => {
    for (const testCase of ELECTRONICS_BENCHMARK_CORPUS) {
      const first = testCase.run();
      const second = testCase.run();
      expect(statusOf(first, testCase.operation), testCase.id).toBe(testCase.expectedStatus);
      expect(fingerprint(second), testCase.id).toBe(fingerprint(first));
    }
  });
});
