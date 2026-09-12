import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../domain/simulation-input-digest.js';
import {
  ELECTRONICS_BENCHMARK_CORPUS,
  ELECTRONICS_BENCHMARK_CORPUS_VERSION,
} from './benchmark-corpus.js';

interface GoldenEntry {
  readonly status: string;
  readonly fingerprint: string;
}
interface GoldenReceipt {
  readonly schema: string;
  readonly corpusVersion: string;
  readonly entries: Readonly<Record<string, GoldenEntry>>;
}

const golden = JSON.parse(
  readFileSync(new URL('./fixtures/benchmark-golden.v2.json', import.meta.url), 'utf8'),
) as GoldenReceipt;

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
    expect(ids.length).toBeGreaterThanOrEqual(45);
  });

  it('keeps every benchmark case deterministic and on its declared status', () => {
    for (const testCase of ELECTRONICS_BENCHMARK_CORPUS) {
      const first = testCase.run();
      const second = testCase.run();
      expect(statusOf(first, testCase.operation), testCase.id).toBe(testCase.expectedStatus);
      expect(fingerprint(second), testCase.id).toBe(fingerprint(first));
    }
  });

  it('matches the committed cross-version golden receipt', () => {
    expect(golden.schema).toBe('asa-lab.electronics-benchmark-golden.v1');
    expect(golden.corpusVersion).toBe(ELECTRONICS_BENCHMARK_CORPUS_VERSION);
    expect(Object.keys(golden.entries).sort()).toEqual(
      ELECTRONICS_BENCHMARK_CORPUS.map((entry) => entry.id).sort(),
    );
    for (const testCase of ELECTRONICS_BENCHMARK_CORPUS) {
      const result = testCase.run();
      const expected = golden.entries[testCase.id];
      expect(expected, `${testCase.id}: missing golden entry`).toBeDefined();
      expect(statusOf(result, testCase.operation), testCase.id).toBe(expected?.status);
      expect(fingerprint(result), testCase.id).toBe(expected?.fingerprint);
    }
  });
});
