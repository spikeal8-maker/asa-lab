import { beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  analyticalAt,
  assessPhy01,
  executePhy01,
  readFixture,
  validateFixture,
  verifyEngineArtifacts,
} from '../../../tools/robotics-field-core/phy01.mjs';

const { fixture } = readFixture();
let result: Awaited<ReturnType<typeof executePhy01>>;
beforeAll(async () => {
  result = await executePhy01(fixture);
});

describe('PHY-01 real Rapier free fall', () => {
  it('runs all three masses, four times, three repetitions and both fixed steps', () => {
    expect(result.assessment.verdict, JSON.stringify(result.assessment.failures)).toBe('PASS');
    expect(result.rawRuns).toHaveLength(18);
    expect(result.assessment.summary.comparedSamples).toBe(72);
    expect(result.assessment.convergence).toHaveLength(9);
    expect(result.assessment.massIndependence).toHaveLength(24);
    expect(result.assessment.repeatability).toHaveLength(6);
    expect(result.provenance.version).toBe('0.19.3');
    expect(result.provenance.embeddedWasmMatches).toBe(true);
    expect(result.provenance.networkRequiredForRun).toBe(false);
  });

  it('uses displacement, not the two-metre absolute height, as the error scale', () => {
    const oracle = analyticalAt(fixture, 100000);
    expect(oracle.displacement.z).toBeCloseTo(-0.04905, 12);
    expect(oracle.positionToleranceM).toBeCloseTo(0.0004905, 12);
    expect(oracle.velocity.z).toBeCloseTo(-0.981, 12);
    const bad = structuredClone(result.rawRuns);
    bad[0].samples[0].position.z += 0.003;
    bad[0].samples[0].clearanceM += 0.003;
    expect(assessPhy01(fixture, bad).verdict).toBe('FAIL');
  });

  it('rejects empty and missing run sets', () => {
    expect(assessPhy01(fixture, []).verdict).toBe('FAIL');
    expect(assessPhy01(fixture, result.rawRuns.slice(1)).verdict).toBe('FAIL');
    expect(assessPhy01(fixture, null).verdict).toBe('FAIL');
  });

  it('rejects a duplicate case replacing another required case', () => {
    const bad = structuredClone(result.rawRuns);
    bad[1] = structuredClone(bad[0]);
    expect(assessPhy01(fixture, bad).verdict).toBe('FAIL');
  });

  it('rejects a missing, shuffled or wrong-time sample', () => {
    for (const mutation of ['missing', 'shuffled', 'time']) {
      const bad = structuredClone(result.rawRuns);
      if (mutation === 'missing') bad[0].samples.pop();
      if (mutation === 'shuffled') bad[0].samples.reverse();
      if (mutation === 'time') bad[0].samples[0].timeUs += 1;
      expect(assessPhy01(fixture, bad).verdict).toBe('FAIL');
    }
  });

  it.each(['position', 'velocity', 'angularVelocity'] as const)(
    'rejects non-finite %s vectors',
    (field) => {
      for (const value of [NaN, Infinity, -Infinity, null]) {
        const bad = structuredClone(result.rawRuns);
        bad[0].samples[0][field].x = value;
        expect(assessPhy01(fixture, bad).verdict).toBe('FAIL');
      }
    },
  );

  it('rejects non-finite clearance or contact in the analytical window', () => {
    const bad = structuredClone(result.rawRuns);
    bad[0].samples[0].clearanceM = NaN;
    expect(assessPhy01(fixture, bad).verdict).toBe('FAIL');
    bad[0] = structuredClone(result.rawRuns[0]);
    bad[0].samples[0].contactCount = 1;
    expect(assessPhy01(fixture, bad).verdict).toBe('FAIL');
  });

  it('rejects excessive velocity error and double-counted body mass', () => {
    const bad = structuredClone(result.rawRuns);
    bad[0].samples[0].velocity.z += 0.02;
    expect(assessPhy01(fixture, bad).verdict).toBe('FAIL');
    bad[0] = structuredClone(result.rawRuns[0]);
    bad[0].initial.bodyMassKg *= 2;
    expect(assessPhy01(fixture, bad).verdict).toBe('FAIL');
  });

  it('rejects a false solver/time readback', () => {
    const bad = structuredClone(result.rawRuns);
    bad[0].solverReadback.numSolverIterations = 99;
    expect(assessPhy01(fixture, bad).verdict).toBe('FAIL');
    bad[0] = structuredClone(result.rawRuns[0]);
    bad[0].engineDtSeconds *= 2;
    expect(assessPhy01(fixture, bad).verdict).toBe('FAIL');
  });

  it('rejects refinement that increases error even while individual samples are within tolerance', () => {
    const bad = structuredClone(result.rawRuns);
    for (const run of bad.filter((value) => value.substeps === 8)) {
      for (const sample of run.samples) {
        sample.position.z -= 0.0003;
        sample.clearanceM -= 0.0003;
      }
    }
    const assessed = assessPhy01(fixture, bad);
    expect(assessed.cases.every((entry) => entry.verdict === 'PASS')).toBe(true);
    expect(assessed.failures).toContain('refinement did not reduce displacement error');
  });

  it('does not call analytically plausible but different repeated samples deterministic', () => {
    const bad = structuredClone(result.rawRuns);
    bad[1].samples[0].position.x += 1e-7;
    expect(assessPhy01(fixture, bad).failures).toContain('repeatability mismatch');
  });
});

describe('PHY-01 fixture and artifact admission', () => {
  it('rejects changed tolerance, geometry and unbounded workload before dynamics', () => {
    const badTolerance = structuredClone(fixture);
    badTolerance.tolerance.relative = 0.1;
    expect(() => validateFixture(badTolerance)).toThrow('tolerances');
    const badGeometry = structuredClone(fixture);
    badGeometry.sphereRadiusM = -1;
    expect(() => validateFixture(badGeometry)).toThrow('geometry');
    const badBudget = structuredClone(fixture);
    badBudget.maxStepsPerWorld = Infinity;
    expect(() => validateFixture(badBudget)).toThrow('work budget');
  });

  it('rejects non-finite or missing fixture values', () => {
    const bad = structuredClone(fixture);
    bad.gravity.z = NaN;
    expect(() => validateFixture(bad)).toThrow('gravity');
    bad.gravity = fixture.gravity;
    bad.massesKg.pop();
    expect(() => validateFixture(bad)).toThrow('masses');
  });

  it('rejects a different WASM hash before initialization', () => {
    const bad = structuredClone(fixture);
    bad.engine.wasmSha256 = '0'.repeat(64);
    expect(() => verifyEngineArtifacts(bad)).toThrow('hash mismatch WASM');
  });

  it('rejects an unavailable WASM file instead of reporting a successful import', () => {
    const directory = mkdtempSync(join(tmpdir(), 'asa-phy01-missing-wasm-'));
    try {
      const require = createRequire(import.meta.url);
      const packageRoot = dirname(require.resolve('@dimforge/rapier3d-compat'));
      writeFileSync(
        join(directory, 'package.json'),
        readFileSync(join(packageRoot, 'package.json')),
      );
      expect(() => verifyEngineArtifacts(fixture, directory)).toThrow('ENOENT');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
