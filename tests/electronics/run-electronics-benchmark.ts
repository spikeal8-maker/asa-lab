import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { arch, cpus, platform, release, totalmem } from 'node:os';
import { dirname, resolve } from 'node:path';
import {
  ELECTRONICS_BENCHMARK_CORPUS,
  ELECTRONICS_BENCHMARK_CORPUS_VERSION,
} from '../../contexts/electronics/testing/benchmark-corpus';
import { sha256Hex } from '../../contexts/electronics/domain/simulation-input-digest';

function positiveInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be positive`);
  return value;
}

function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

function coefficientOfVariation(values: readonly number[]): number {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (mean === 0) return 0;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}
function git(...args: readonly string[]): string {
  return execFileSync('git', args, { encoding: 'utf8', windowsHide: true }).trim();
}

function resultStatus(value: unknown, operation: string): string {
  if (operation === 'digest') return 'digest';
  if (!value || typeof value !== 'object') return 'invalid-result';
  const record = value as Record<string, unknown>;
  if (operation === 'arduino-clock') return String(record.executionStatus ?? 'missing');
  return String(record.status ?? 'missing');
}

function resultDiagnostics(value: unknown): readonly string[] {
  if (!value || typeof value !== 'object') return [];
  const diagnostics = (value as { diagnostics?: unknown }).diagnostics;
  if (!Array.isArray(diagnostics)) return [];
  return diagnostics
    .map((entry) =>
      entry && typeof entry === 'object' && 'code' in entry
        ? String((entry as { code: unknown }).code)
        : '',
    )
    .filter(Boolean);
}

function resultFingerprint(value: unknown): string {
  return sha256Hex(typeof value === 'string' ? value : JSON.stringify(value));
}

const output = process.env['ASA_ELECTRONICS_BENCHMARK_REPORT'];
if (!output) throw new Error('ASA_ELECTRONICS_BENCHMARK_REPORT must name the generated receipt');
const warmups = positiveInteger('ASA_ELECTRONICS_BENCHMARK_WARMUPS', 5);
const iterations = positiveInteger('ASA_ELECTRONICS_BENCHMARK_ITERATIONS', 30);
const seriesCount = positiveInteger('ASA_ELECTRONICS_BENCHMARK_SERIES', 3);
const revision = git('rev-parse', 'HEAD');
const dirtyTree = git('status', '--porcelain').length > 0;
const startedAt = new Date().toISOString();

const cases = ELECTRONICS_BENCHMARK_CORPUS.map((testCase) => {
  for (let index = 0; index < warmups; index += 1) testCase.run();
  globalThis.gc?.();
  const beforeMemory = process.memoryUsage();
  const series = Array.from({ length: seriesCount }, (_, seriesIndex) => {
    const durations: number[] = [];
    const fingerprints = new Set<string>();
    const statuses = new Set<string>();
    for (let index = 0; index < iterations; index += 1) {
      const started = performance.now();
      const result = testCase.run();
      durations.push(performance.now() - started);
      fingerprints.add(resultFingerprint(result));
      statuses.add(resultStatus(result, testCase.operation));
    }
    const measured = {
      p50Ms: percentile(durations, 0.5),
      p95Ms: percentile(durations, 0.95),
      p99Ms: percentile(durations, 0.99),
      maxMs: Math.max(...durations),
      coefficientOfVariation: coefficientOfVariation(durations),
      deterministic: fingerprints.size === 1,
      statuses: [...statuses],
    };
    console.log(
      `${testCase.id} series ${seriesIndex + 1}/${seriesCount}: p95=${measured.p95Ms.toFixed(3)}ms`,
    );
    return measured;
  });
  const sample = testCase.run();
  const status = resultStatus(sample, testCase.operation);
  const diagnostics = resultDiagnostics(sample);
  if (status !== testCase.expectedStatus) {
    throw new Error(`${testCase.id}: expected ${testCase.expectedStatus}, received ${status}`);
  }
  globalThis.gc?.();
  const afterMemory = process.memoryUsage();
  const deterministic = series.every((entry) => entry.deterministic);
  if (!deterministic) throw new Error(`${testCase.id}: non-deterministic benchmark result`);
  return {
    caseId: testCase.id,
    tier: testCase.tier,
    category: testCase.category,
    operation: testCase.operation,
    expectedStatus: testCase.expectedStatus,
    status,
    diagnosticCodes: diagnostics,
    fingerprint: resultFingerprint(sample),
    p50Ms: percentile(
      series.map((entry) => entry.p50Ms),
      0.5,
    ),
    p95Ms: Math.max(...series.map((entry) => entry.p95Ms)),
    p99Ms: Math.max(...series.map((entry) => entry.p99Ms)),
    maxMs: Math.max(...series.map((entry) => entry.maxMs)),
    heapDeltaBytes: afterMemory.heapUsed - beforeMemory.heapUsed,
    rssDeltaBytes: afterMemory.rss - beforeMemory.rss,
    deterministic,
    series,
  };
});

if (!cases.some((entry) => entry.tier === 'stress'))
  throw new Error('benchmark requires stress cases');
if (!cases.every((entry) => entry.deterministic))
  throw new Error('benchmark corpus is not deterministic');
const report = {
  receiptVersion: 1,
  corpusVersion: ELECTRONICS_BENCHMARK_CORPUS_VERSION,
  revision,
  dirtyTree,
  startedAt,
  completedAt: new Date().toISOString(),
  runtime: process.version,
  os: `${platform()} ${release()} ${arch()}`,
  cpu: cpus()[0]?.model ?? 'unknown',
  logicalCpuCount: cpus().length,
  totalMemoryBytes: totalmem(),
  memoryMethod: globalThis.gc
    ? 'process.memoryUsage before/after each case with explicit GC'
    : 'process.memoryUsage before/after each case; GC unavailable',
  longTaskMethod: 'not measured in Node receipt; browser/main-thread receipt is separate',
  warmups,
  iterations,
  seriesCount,
  cases,
};

const absolute = resolve(output);
mkdirSync(dirname(absolute), { recursive: true });
writeFileSync(absolute, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(`Wrote ${absolute}`);
