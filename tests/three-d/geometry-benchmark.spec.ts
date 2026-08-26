import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { arch, cpus, platform, release, totalmem } from 'node:os';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { THREE_D_GEOMETRY_CORPUS } from '../../contexts/three-d/testing/corpus/cases';
import { THREE_D_CORPUS_VERSION } from '../../contexts/three-d/testing/corpus/expectations';
import {
  LEGACY_CSG_ENGINE_VERSION,
  evaluateGeometryCase,
} from '../../apps/web/src/three-d/testing/geometry-corpus';

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
  const variance =
    values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / values.length;
  return Math.sqrt(variance) / mean;
}

function git(...args: readonly string[]): string {
  return execFileSync('git', args, { encoding: 'utf8', windowsHide: true }).trim();
}

const output = process.env['ASA_3D_BENCHMARK_REPORT'];
const benchmark = output ? describe : describe.skip;

benchmark('ASA 3D OPT-0 benchmark receipt', () => {
  it(
    'measures every corpus tier without changing runtime behaviour',
    () => {
      expect(output).toBeTruthy();
      const warmups = positiveInteger('ASA_3D_BENCHMARK_WARMUPS', 5);
      const iterations = positiveInteger('ASA_3D_BENCHMARK_ITERATIONS', 30);
      const seriesCount = positiveInteger('ASA_3D_BENCHMARK_SERIES', 3);
      const revision = git('rev-parse', 'HEAD');
      const dirtyTree = git('status', '--porcelain').length > 0;
      const startedAt = new Date().toISOString();
      const cases = THREE_D_GEOMETRY_CORPUS.map((testCase) => {
        for (let index = 0; index < warmups; index += 1) evaluateGeometryCase(testCase);
        const beforeHeap = process.memoryUsage().heapUsed;
        const series = Array.from({ length: seriesCount }, () => {
          const results = Array.from({ length: iterations }, () => evaluateGeometryCase(testCase));
          const durations = results.map((result) => result.durationMs);
          const fingerprints = new Set(
            results.map((result) =>
              JSON.stringify([
                result.resultKind,
                result.diagnosticCodes,
                result.triangleCount,
                result.bounds,
                result.checksum,
              ]),
            ),
          );
          return {
            medianMs: percentile(durations, 0.5),
            p95Ms: percentile(durations, 0.95),
            maxMs: Math.max(...durations),
            coefficientOfVariation: coefficientOfVariation(durations),
            deterministic: fingerprints.size === 1,
          };
        });
        const result = evaluateGeometryCase(testCase);
        const afterHeap = process.memoryUsage().heapUsed;
        const allP95 = series.map((entry) => entry.p95Ms);
        console.log(
          `${testCase.id}: ${result.resultKind}, triangles=${result.triangleCount}, p95=${Math.max(...allP95).toFixed(3)}ms`,
        );
        return {
          caseId: testCase.id,
          problemIds: testCase.problemIds,
          tags: testCase.tags,
          tier: testCase.tier,
          expectation: testCase.expectation,
          resultKind: result.resultKind,
          diagnosticCodes: result.diagnosticCodes,
          message: result.message ?? null,
          triangleCount: result.triangleCount,
          boundaryEdgeCount: result.boundaryEdgeCount,
          nonManifoldEdgeCount: result.nonManifoldEdgeCount,
          nonManifoldVertexCount: result.nonManifoldVertexCount,
          degenerateTriangleCount: result.degenerateTriangleCount,
          bounds: result.bounds,
          areaMm2: result.areaMm2,
          volumeMm3: result.volumeMm3,
          checksum: result.checksum,
          medianMs: percentile(
            series.map((entry) => entry.medianMs),
            0.5,
          ),
          p95Ms: Math.max(...allP95),
          maxMs: Math.max(...series.map((entry) => entry.maxMs)),
          heapDeltaBytes: afterHeap - beforeHeap,
          longTaskCount: null,
          deterministic: series.every((entry) => entry.deterministic),
          series,
        };
      });
      const report = {
        receiptVersion: 1,
        corpusVersion: THREE_D_CORPUS_VERSION,
        revision,
        dirtyTree,
        engineVersion: LEGACY_CSG_ENGINE_VERSION,
        schemaVersion: THREE_D_GEOMETRY_CORPUS[0]?.document.schemaVersion ?? null,
        startedAt,
        completedAt: new Date().toISOString(),
        runtime: process.version,
        browser: 'vitest-node',
        os: `${platform()} ${release()} ${arch()}`,
        cpu: cpus()[0]?.model ?? 'unknown',
        totalMemoryBytes: totalmem(),
        memoryMethod: 'process.memoryUsage.heapUsed delta; GC not forced',
        longTaskMethod: 'unsupported in Node benchmark; browser receipt required separately',
        warmups,
        iterations,
        seriesCount,
        cases,
      };
      const absolute = resolve(output!);
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
      expect(cases.some((entry) => entry.tier === 'stress')).toBe(true);
      expect(cases.every((entry) => entry.deterministic)).toBe(true);
    },
    15 * 60 * 1000,
  );
});
