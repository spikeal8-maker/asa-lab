import { beforeAll, describe, expect, it } from 'vitest';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  analyticalAt,
  assessPhy01,
  executePhy01,
  float64Bytes,
  makeModelXml,
  nativeTimeBudget,
  readFixture,
  runPlan,
  sha256,
  validateFixture,
  verifyEngineArtifacts,
} from '../../../tools/robotics-field-core/mujoco-phy01.mjs';

const { fixture } = readFixture();

describe('MuJoCo PHY01 admission without dynamics', () => {
  it('pins all artifacts and the installed exact dependency before initialization', () => {
    const admission = verifyEngineArtifacts(fixture);
    expect(admission.version).toBe('4.0.0');
    expect(admission.networkRequiredForRun).toBe(false);
    expect(admission.wasmSha256).toBe(
      '51ae58ae3c69145f6570aeb1fae27f8f142b2d883c804c4747c1a0c3bc80b0de',
    );
  });
  it('derives the permitted 20 worlds and 24000 actual native steps without creating models', () => {
    const plan = runPlan(fixture);
    expect(plan.filter((e) => e.mode === 'split')).toHaveLength(18);
    expect(plan.filter((e) => e.mode === 'full')).toHaveLength(2);
    expect(plan.reduce((sum, e) => sum + 400000 / e.dtUs, 0)).toBe(24000);
  });
  it('uses analytical displacement rather than initial height as the error scale', () => {
    const oracle = analyticalAt(fixture, 100000);
    expect(oracle.displacement[2]).toBeCloseTo(-0.04905, 12);
    expect(oracle.velocity[2]).toBeCloseTo(-0.981, 12);
    expect(oracle.positionToleranceM).toBeCloseTo(0.0004905, 12);
  });
  it('preserves signed zero in the native parity representation', () => {
    expect(float64Bytes([0]).equals(float64Bytes([-0]))).toBe(false);
    expect(float64Bytes([1, 2, 3]).equals(float64Bytes([1, 2, 3]))).toBe(true);
  });
  it.each([NaN, Infinity, -Infinity])('rejects non-finite state encoding %s', (value) => {
    expect(() => float64Bytes([0, value])).toThrow('non-finite');
  });
  it('fixes a roundoff-only native-time budget before dynamics', () => {
    expect(nativeTimeBudget(1600, 250)).toBeGreaterThan(1.4e-13);
    expect(nativeTimeBudget(1600, 250)).toBeLessThan(1.5e-13);
  });
  it('rejects changed tolerance, geometry, phase, step and budget before model creation', () => {
    const mutations = [
      (f: typeof fixture) => {
        f.tolerance.relative = 0.1;
      },
      (f: typeof fixture) => {
        f.sphereRadiusM = -1;
      },
      (f: typeof fixture) => {
        f.phase.parityFields.pop();
      },
      (f: typeof fixture) => {
        f.nativeStepUs[0] = 1250;
      },
      (f: typeof fixture) => {
        f.budget.totalNativeSteps = Infinity;
      },
      (f: typeof fixture) => {
        f.gravity[2] = NaN;
      },
    ];
    for (const mutate of mutations) {
      const bad = structuredClone(fixture);
      mutate(bad);
      expect(() => validateFixture(bad)).toThrow('registered');
    }
  });
  it('does not construct XML for unregistered mass or time step', () => {
    expect(() => makeModelXml(fixture, 1, 500)).toThrow('unregistered');
    expect(() => makeModelXml(fixture, 0.5, 1250)).toThrow('unregistered');
  });
  it.each(['missing', 'corrupt'])('rejects %s WASM before initialization', (kind) => {
    const temporary = mkdtempSync(join(tmpdir(), 'asa-mujoco-artifact-'));
    try {
      const require = createRequire(import.meta.url);
      cpSync(dirname(require.resolve('@mujoco/mujoco')), temporary, { recursive: true });
      const wasm = join(temporary, 'mujoco.wasm');
      if (kind === 'missing') rmSync(wasm);
      else {
        const bytes = readFileSync(wasm);
        bytes[0] ^= 1;
        writeFileSync(wasm, bytes);
      }
      expect(() => verifyEngineArtifacts(fixture, temporary)).toThrow();
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });
  it('fails closed on an empty or malformed observation set', () => {
    expect(assessPhy01(fixture, [], null).verdict).toBe('FAIL');
    expect(assessPhy01(fixture, null, null).verdict).toBe('FAIL');
  });
});

describe('MuJoCo PHY01 real native dynamics', () => {
  let result: Awaited<ReturnType<typeof executePhy01>>;
  beforeAll(async () => {
    result = await executePhy01(fixture);
  }, 30000);
  it('passes 72 main samples, 9 convergences, 24 mass comparisons and 6 bitwise repetitions', () => {
    expect(result.assessment.verdict, JSON.stringify(result.assessment.failures)).toBe('PASS');
    expect(result.rawRuns).toHaveLength(20);
    expect(result.assessment.summary.comparedMainSamples).toBe(72);
    expect(result.assessment.convergence).toHaveLength(9);
    expect(result.assessment.massIndependence).toHaveLength(24);
    expect(result.assessment.repeatability).toHaveLength(6);
    expect(result.budget.nativeStepsCompleted).toBe(24000);
  });
  it('proves split/full native state parity at every reference step', () => {
    expect(result.assessment.phaseParity).toHaveLength(2);
    expect(
      result.assessment.phaseParity.every(
        (p) => p.verdict === 'PASS' && p.firstMismatchStep === null && p.warningsEqual,
      ),
    ).toBe(true);
    expect(result.assessment.phaseParity.reduce((sum, p) => sum + p.comparedNativeSteps, 0)).toBe(
      2400,
    );
  });
  it('rejects missing or duplicate worlds and missing reference worlds', () => {
    expect(assessPhy01(fixture, result.rawRuns.slice(1), result.budget).verdict).toBe('FAIL');
    const bad = structuredClone(result.rawRuns);
    bad[1] = structuredClone(bad[0]);
    expect(assessPhy01(fixture, bad, result.budget).verdict).toBe('FAIL');
    expect(
      assessPhy01(
        fixture,
        result.rawRuns.filter((r) => r.mode === 'split'),
        result.budget,
      ).verdict,
    ).toBe('FAIL');
  });
  it('rejects missing, shuffled, wrong-time and non-finite samples', () => {
    for (const kind of ['missing', 'shuffled', 'time', 'nan']) {
      const bad = structuredClone(result.rawRuns);
      if (kind === 'missing') bad[0].samples.pop();
      if (kind === 'shuffled') bad[0].samples.reverse();
      if (kind === 'time') bad[0].samples[0].timeUs += 1;
      if (kind === 'nan') bad[0].samples[0].position[2] = NaN;
      expect(assessPhy01(fixture, bad, result.budget).verdict).toBe('FAIL');
    }
  });
  it('rejects doubled realized mass, shifted COM and changed integrator', () => {
    for (const kind of ['mass', 'com', 'integrator']) {
      const bad = structuredClone(result.rawRuns);
      if (kind === 'mass') bad[0].initialReadback.arrays.body_mass[1] *= 2;
      if (kind === 'com') bad[0].initialReadback.arrays.body_ipos[3] = 0.01;
      if (kind === 'integrator') bad[0].initialReadback.options.integrator = 1;
      expect(assessPhy01(fixture, bad, result.budget).verdict).toBe('FAIL');
    }
  });
  it('rejects warnings, missed phase preservation and incomplete native-step accounting', () => {
    const warning = structuredClone(result.rawRuns);
    warning[0].warningTrajectorySha256 = 'f'.repeat(64);
    expect(assessPhy01(fixture, warning, result.budget).verdict).toBe('FAIL');
    const phase = structuredClone(result.rawRuns);
    phase[0].invariantCounts.step1Preserved -= 1;
    expect(assessPhy01(fixture, phase, result.budget).verdict).toBe('FAIL');
    expect(
      assessPhy01(fixture, result.rawRuns, { ...result.budget, nativeStepsCompleted: 23999 })
        .verdict,
    ).toBe('FAIL');
  });
  it('rejects a changed intermediate reference state even when the four samples remain unchanged', () => {
    const bad = structuredClone(result.rawRuns);
    const reference = bad.find((r) => r.mode === 'full');
    expect(reference).toBeDefined();
    reference.stateDigestByStep[0] = 'f'.repeat(64);
    reference.trajectorySha256 = sha256(
      Buffer.concat(reference.stateDigestByStep.map((d: string) => Buffer.from(d, 'hex'))),
    );
    const assessed = assessPhy01(fixture, bad, result.budget);
    expect(assessed.failures).toContain('split/full native phase parity mismatch');
  });
  it('rejects contact or analytic error inside the freefall observation window', () => {
    const contact = structuredClone(result.rawRuns);
    contact[0].samples[0].contactCount = 1;
    expect(assessPhy01(fixture, contact, result.budget).verdict).toBe('FAIL');
    const bad = structuredClone(result.rawRuns);
    bad[0].samples[0].position[2] += 0.003;
    bad[0].samples[0].clearanceM += 0.003;
    expect(assessPhy01(fixture, bad, result.budget).verdict).toBe('FAIL');
  });
});
