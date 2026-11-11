import { Buffer } from 'node:buffer';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  canonicalBytes,
  canonicalEqual,
  digest,
  radians,
  RawJournal,
  TickRetention,
} from '../../../tools/robotics-field-core/mujoco-contact-observer.mjs';
import {
  readMechanismFixture,
  validateMechanismFixture,
  mechanismPlan,
  makeMechanismXml,
  resolveMechanismIds,
  controlAt,
  projectedBoxMaxY,
  assessMechanismEndpoint,
  assessMechanismActuation,
  assessMechanismForces,
  stationaryWindows,
  observeStationaryWindow,
  makeMechanismTickRecord,
  MechanismWorld,
  assessMechanismComparisons,
  verifyMechanismArtifacts,
} from '../../../tools/robotics-field-core/mujoco-mechanism.mjs';
import {
  parseMechanismArgs,
  runMechanismCli,
  sourceMatches,
  assertMechanismRunAllowed,
  evidenceParse,
  evidenceStringify,
} from '../../../tools/robotics-field-core/run-mujoco-mechanism.mjs';

// PURE ONLY: synthetic records/JS stubs and bounded temporary journal bytes.
// No MuJoCo factory, MjModel/MjData, native advance, admission or replay is called.
const { fixture: f } = readMechanismFixture();
const plan = mechanismPlan(f);
type Condition = (typeof plan)[number];
const scenario = (name: string, dtUs = 500, repeat = 1) =>
  plan.find((p) => p.case === name && p.dtUs === dtUs && p.repeat === repeat)!;
const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const quat = [1, 0, 0, 0];
const zeros = (n: number) => new Array<number>(n).fill(0);
function idsFor(condition: Condition) {
  const links = [1, 2, 3].map((index) => ({
    name: 'L' + index,
    index,
    bodyId: index,
    geomId: condition.wall ? index : index - 1,
  }));
  const joints = (condition.articulated ? [1, 2, 3] : [3]).map((index, i) => ({
    name: 'J' + index,
    index,
    jointId: i,
    bodyId: index,
    qposAdr: i,
    dofAdr: i,
    actuatorId: i,
  }));
  return { links, joints, bodyIds: [0, 1, 2, 3], wallGeom: condition.wall ? 0 : null };
}
function nativeState(q: number[], time = 0) {
  return {
    time,
    qpos: q.slice(),
    qvel: zeros(q.length),
    qacc: zeros(q.length),
    qacc_warmstart: zeros(q.length),
  };
}
function bodiesAtZero() {
  return Object.fromEntries(
    [0, 1, 2, 3].map((id) => [
      id,
      {
        com: id ? [(id - 1) * 0.12 + 0.06, 0, 0.25] : [0, 0, 0],
        rotation: identity.slice(),
        quaternion: quat.slice(),
        omega: [0, 0, 0],
        velocity: [0, 0, 0],
      },
    ]),
  );
}
function framesAtZero(condition: Condition) {
  const ids = idsFor(condition);
  return {
    positions: [0, 0, 0, 0, 0, 0.25, 0.12, 0, 0.25, 0.24, 0, 0.25],
    anchors: ids.joints.flatMap((j) => [(j.index - 1) * 0.12, 0, 0.25]),
    axes: ids.joints.flatMap(() => [0, 0, 1]),
    geomPositions: [
      ...(condition.wall ? f.wall.centerM : []),
      0.06,
      0,
      0.25,
      0.18,
      0,
      0.25,
      0.3,
      0,
      0.25,
    ],
    geomRotations: Array.from({ length: condition.wall ? 4 : 3 }, () => identity).flat(),
  };
}
function emptyReaction(n: number) {
  const names = n === 3 ? ['J1', 'J2', 'J3'] : ['J3'];
  return {
    limitRows: [] as {
      row: number;
      joint: string;
      side: string;
      lambda: number;
      generalizedTorqueNm: number;
    }[],
    loaded: Object.fromEntries(names.map((name) => [name, { upper: false, lower: false }])),
    total: zeros(n),
    limitGeneralized: zeros(n),
    contactGeneralized: zeros(n),
    aggregation: [],
    loadedLimitRows: 0,
    wallLoadedContacts: 0,
    wallNormalForceN: 0,
    wallOutwardForceN: 0,
    maxPenetrationM: 0,
    maxContactVelocityErrorMps: 0,
  };
}
function windowRecord(condition: Condition, side: number, tick: number) {
  const ids = idsFor(condition);
  const q =
    condition.case === 'B'
      ? f.wall.reference.firstTouchRad
      : side
        ? side * (Math.PI / 6 + 0.001)
        : 0;
  const pre = nativeState(
    ids.joints.map(() => q),
    ((tick - 1) * condition.dtUs) / 1e6,
  );
  const post = nativeState(pre.qpos, (tick * condition.dtUs) / 1e6);
  const reaction = emptyReaction(ids.joints.length);
  if (side)
    for (const [row, joint] of ids.joints.entries()) {
      reaction.loaded[joint.name][side > 0 ? 'upper' : 'lower'] = true;
      reaction.limitRows.push({
        row,
        joint: joint.name,
        side: side > 0 ? 'upper' : 'lower',
        lambda: 0.08,
        generalizedTorqueNm: -0.08 * side,
      });
      reaction.loadedLimitRows += 1;
    }
  if (condition.case === 'B') {
    reaction.wallLoadedContacts = 1;
    reaction.wallNormalForceN = f.wall.reference.staticForceAtCapN;
    reaction.wallOutwardForceN = reaction.wallNormalForceN;
    reaction.contactGeneralized[0] = -0.08;
  }
  return {
    tick,
    intervalStartUs: (tick - 1) * condition.dtUs,
    intervalEndUs: tick * condition.dtUs,
    pre,
    endpoint: post,
    reaction,
    preGeometry: { l3MaxYM: condition.case === 'B' ? 0.06 : 0.0774 },
    endpointGeometry: { l3MaxYM: condition.case === 'B' ? 0.06 : 0.0774 },
  };
}
function completeWindow(
  name: string,
  mutate?: (record: ReturnType<typeof windowRecord>, i: number, count: number) => void,
) {
  const condition = scenario(name);
  const ids = idsFor(condition);
  const windows = stationaryWindows(f, condition);
  for (const window of windows)
    for (let i = 1; i <= window.expectedIntervals; i += 1) {
      const tick = window.startUs / condition.dtUs + i;
      const record = windowRecord(condition, window.side, tick);
      mutate?.(record, i, window.expectedIntervals);
      observeStationaryWindow(f, window, record, ids);
    }
  return windows;
}
function forceRecord() {
  const condition = scenario('C');
  const ids = idsFor(condition);
  const forward = {
    state: nativeState([Math.PI / 6 + 0.001]),
    bodies: bodiesAtZero(),
    contacts: [],
    ncon: 0,
    nefc: 1,
    efcJ: [-1],
    efcType: [3],
    efcId: [0],
    efcVel: [0],
  };
  const force = { contacts: [], efcForce: [0.08], qfrcConstraint: [-0.08] };
  return { condition, ids, forward, force };
}

// Analytic envelope only: no trajectory integration or MuJoCo initialization.
// M(q) >= Izz L^T L because translational kinetic energy is positive semidefinite.
// Each COM Jacobian-column norm is at most the sum of its link lengths.
function controllerDampingEnvelope(kd = f.motor.kdNmsPerRad) {
  const count = f.bodies.linkNames.length;
  const inertia = f.bodies.inertiaKgM2[2];
  const length = f.bodies.childOffsetM[0];
  const com = f.bodies.comLocalM[0];
  const minimumEigenvalue = 1 / (2 + 2 * Math.cos((2 * Math.PI) / (2 * count + 1)));
  const lowerInertia = inertia * minimumEigenvalue;
  let upperInertia = ((count * (count + 1)) / 2) * inertia;
  for (let i = 0; i < count; i += 1)
    for (let j = 0; j <= i; j += 1) upperInertia += f.bodies.massKg * (length * (i - j) + com) ** 2;
  const kp = f.motor.kpNmPerRad;
  const impedance = f.joint.solimp[0];
  const [timeConstant, dampingRatio] = f.joint.solref;
  const limitDamping = 2 / (impedance * timeConstant);
  const limitStiffness = 1 / (impedance * timeConstant ** 2 * dampingRatio ** 2);
  return {
    lowerInertia,
    upperInertia,
    criticalKd: 2 * Math.sqrt(kp * upperInertia),
    steps: f.nativeStepUs.map((dtUs: number) => {
      const h = dtUs / 1e6;
      return {
        h,
        ceilingKd: (2 * lowerInertia) / h - (h * kp) / 2,
        controlSlack: 4 * lowerInertia - 2 * h * kd - h ** 2 * kp,
        activeLimitCoefficient: 4 - 2 * h * limitDamping - h ** 2 * limitStiffness,
      };
    }),
  };
}

describe('mechanism preregistration inputs without native initialization', () => {
  it('pins14worlds/186000advances with no hidden admission', () => {
    expect(plan).toHaveLength(14);
    expect(plan.reduce((s, p) => s + p.maxSteps, 0)).toBe(186000);
    expect(Math.max(...plan.map((p) => p.maxSteps))).toBe(28000);
    expect(plan.filter((p) => p.articulated)).toHaveLength(6);
    expect(plan.filter((p) => p.wall)).toHaveLength(4);
    expect(f.budget.maxConcurrentWorlds).toBe(1);
  });
  it('rejects changes to gains, gates, steps or the approved topology', () => {
    for (const change of [
      (x: typeof f) => {
        x.motor.kpNmPerRad = 0.31;
      },
      (x: typeof f) => {
        x.motor.kdNmsPerRad = 0.03;
      },
      (x: typeof f) => {
        x.joint.maximumOvershootDeg = 0.3;
      },
      (x: typeof f) => {
        x.nativeStepUs[0] = 1000;
      },
      (x: typeof f) => {
        x.bodies.topology.B = 'three_hinge_three_DOF';
      },
    ]) {
      const copy = structuredClone(f);
      change(copy);
      expect(() => validateMechanismFixture(copy)).toThrow('CONTRACT_MISMATCH');
    }
  });
  it('generates3native hinges in A/D and deliberately1 in B/C', () => {
    for (const name of ['A', 'B', 'C', 'D']) {
      const condition = scenario(name);
      const xml = makeMechanismXml(f, condition);
      expect(xml.match(/<joint name=/g) ?? []).toHaveLength(condition.articulated ? 3 : 1);
      expect(xml.match(/<motor name=/g) ?? []).toHaveLength(condition.articulated ? 3 : 1);
      expect(xml.match(/<body name=/g) ?? []).toHaveLength(3);
      expect(xml).toContain('inertiafromgeom="false"');
      expect(xml).toContain('fusestatic="false"');
      expect(xml).not.toMatch(/<freejoint|<position|<velocity|<weld|<equality|mocap=/);
      if (!condition.articulated) {
        expect(xml).not.toContain('name="J1"');
        expect(xml).not.toContain('name="J2"');
      }
      if (name === 'B')
        expect(xml).toContain('name="wall_L3" geom1="wall" geom2="L3_geom" condim="1"');
      else expect(xml).not.toContain('name="wall"');
    }
  });
  it('rejects an unplanned extra or longer world', () => {
    expect(() => makeMechanismXml(f, { ...scenario('A'), maxSteps: 28001 })).toThrow(
      'UNPLANNED_WORLD',
    );
  });
  it('samples each controller phase at exact left integer time', () => {
    const c = scenario('A');
    const ids = idsFor(c);
    const state = nativeState([0, 0, 0]);
    expect(controlAt(f, c, 5999, state, ids.joints).targetRad).toBe(Math.PI / 4);
    expect(controlAt(f, c, 6000, state, ids.joints).targetRad).toBe(-Math.PI / 4);
    expect(controlAt(f, c, 12000, state, ids.joints).raw).toEqual([0, 0, 0]);
    expect(controlAt(f, c, 0, state, ids.joints).raw[0]).toBeGreaterThan(0.08);
    expect(() => controlAt(f, c, c.maxSteps, state, ids.joints)).toThrow('CONTROL_INTEGER_TICK');
  });
  it('selects derivative gain from the global registered inertia envelope', () => {
    const bounds = controllerDampingEnvelope();
    expect(bounds.lowerInertia).toBeCloseTo(0.00004106380378265389, 16);
    expect(bounds.upperInertia).toBeCloseTo(0.01736, 14);
    expect(bounds.criticalKd).toBeCloseTo(0.14433294842134972, 14);
    expect(f.motor.kdNmsPerRad).toBe(0.15);
    expect(f.motor.kdNmsPerRad).toBeGreaterThanOrEqual(bounds.criticalKd);
    expect(0.03).toBeLessThan(bounds.criticalKd);
    // This is a frozen, unsaturated free-mode design bound, not a 3s settling proof.
    expect(f.motor.ctrlRangeNm).toEqual([-0.08, 0.08]);
    expect(f.motor.forceRangeNm).toEqual([-0.08, 0.08]);
  });
  it('keeps the explicit step within the clamp/limit Schur envelope and rejects an excess gain', () => {
    const good = controllerDampingEnvelope();
    for (const step of good.steps) {
      expect(f.motor.kdNmsPerRad).toBeLessThan(step.ceilingKd);
      expect(step.controlSlack).toBeGreaterThan(0);
      expect(step.activeLimitCoefficient).toBeGreaterThan(0);
    }
    expect(good.steps[0].ceilingKd).toBeCloseTo(0.16418021513061556, 14);
    expect(good.steps[0].activeLimitCoefficient).toBeCloseTo(3.4791666666666665, 14);
    const excessiveKd = 0.17;
    const bad = controllerDampingEnvelope(excessiveKd);
    expect(bad.steps[0].controlSlack).toBeLessThan(0);
    // The conservative scalar modal envelope has a root outside the unit disk.
    // It is not a claim that the full nonlinear mechanism at kd=.17 was simulated.
    const m = bad.lowerInertia;
    const h = bad.steps[0].h;
    const a = -2 + (h * excessiveKd + h ** 2 * f.motor.kpNmPerRad) / m;
    const b = 1 - (h * excessiveKd) / m;
    const negativeRoot = (-a - Math.sqrt(a * a - 4 * b)) / 2;
    expect(negativeRoot).toBeLessThan(-1);
  });
  it('opposes the sampled joint velocity and leaves drive-off exactly zero', () => {
    const c = scenario('A');
    const ids = idsFor(c);
    const state = nativeState([Math.PI / 4, Math.PI / 4, Math.PI / 4]);
    state.qvel = [0.2, -0.2, 2];
    expect(controlAt(f, c, 0, state, ids.joints).raw).toEqual([-0.03, 0.03, -0.3]);
    // Raw ctrl remains unbounded; the unchanged native motor performs its force clamp.
    expect(controlAt(f, c, 0, state, ids.joints).raw[2]).toBeLessThan(-0.08);
    expect(controlAt(f, c, 12000, state, ids.joints).raw).toEqual([0, 0, 0]);
  });
  it('resolves native IDs and coordinate addresses by names', () => {
    const c = scenario('B');
    const table = new Map(
      ['L1', 'L2', 'L3', 'L1_geom', 'L2_geom', 'L3_geom', 'J3', 'M3', 'wall'].map((name) => [
        name,
        name === 'wall' || name === 'J3' || name === 'M3' ? 0 : Number(name[1]),
      ]),
    );
    const kindName = (kind: number, id: number) =>
      kind === 1
        ? 'L' + id
        : kind === 3
          ? 'J3'
          : kind === 19
            ? 'M3'
            : id === 0
              ? 'wall'
              : 'L' + id + '_geom';
    const M = {
      mj_name2id: (_model: unknown, _kind: number, name: string) => table.get(name) ?? -1,
      mj_id2name: (_model: unknown, kind: number, id: number) => kindName(kind, id),
    };
    const ids = resolveMechanismIds(M, { jnt_qposadr: [0], jnt_dofadr: [0] }, c);
    expect(ids.joints).toEqual([
      { name: 'J3', index: 3, jointId: 0, bodyId: 3, qposAdr: 0, dofAdr: 0, actuatorId: 0 },
    ]);
  });
  it('verifies pinned offline artifact bytes without initializing a module', () => {
    const artifact = verifyMechanismArtifacts(f);
    expect(artifact.version).toBe('4.0.0');
    expect(artifact.wasmSha256).toBe(f.engine.wasmSha256);
    expect(artifact.networkRequiredForRun).toBe(false);
  });
});

describe('native frames, bounded torque and signed force semantics (synthetic)', () => {
  it('checks proximal anchors while COM stays0.06m from each body origin', () => {
    const c = scenario('A');
    const ids = idsFor(c);
    const good = assessMechanismEndpoint(
      f,
      ids,
      nativeState([0, 0, 0]),
      bodiesAtZero(),
      framesAtZero(c),
    );
    expect(good.maxAnchorErrorM).toBe(0);
    const bad = framesAtZero(c);
    bad.anchors[3] += 0.00101;
    expect(() =>
      assessMechanismEndpoint(f, ids, nativeState([0, 0, 0]), bodiesAtZero(), bad),
    ).toThrow('ANCHOR_GATE');
  });
  it('fails angular overshoot on either side without using the anchor tolerance as radians', () => {
    const c = scenario('A');
    const ids = idsFor(c);
    for (const side of [-1, 1]) {
      const q = side * (Math.PI / 6 + radians(0.250001));
      expect(() =>
        assessMechanismEndpoint(f, ids, nativeState([q, 0, 0]), bodiesAtZero(), framesAtZero(c)),
      ).toThrow('ANGLE_OVERSHOOT');
    }
  });
  it('derives box support from native orientation instead of a body-origin height', () => {
    const q = Math.PI / 6;
    const r = [Math.cos(q), -Math.sin(q), 0, Math.sin(q), Math.cos(q), 0, 0, 0, 1];
    expect(
      projectedBoxMaxY(
        [0.24 + 0.06 * Math.cos(q), 0.06 * Math.sin(q), 0.25],
        r,
        f.bodies.halfExtentsM,
      ),
    ).toBeCloseTo(0.07732050807568877, 14);
  });
  it('treats positive upper-limit lambda as negative generalized restoring torque', () => {
    const r = forceRecord();
    const result = assessMechanismForces(f, r.condition, r.ids, r.forward, r.force);
    expect(result.limitRows[0]).toMatchObject({
      side: 'upper',
      lambda: 0.08,
      generalizedTorqueNm: -0.08,
    });
    expect(result.loaded.J3.upper).toBe(true);
    expect(result.loaded.J3.lower).toBe(false);
  });
  it('gives a lower-limit row a positive restoring generalized torque', () => {
    const r = forceRecord();
    r.forward.state.qpos[0] = -Math.PI / 6 - 0.001;
    r.forward.efcJ[0] = 1;
    r.force.qfrcConstraint[0] = 0.08;
    const result = assessMechanismForces(f, r.condition, r.ids, r.forward, r.force);
    expect(result.limitRows[0]).toMatchObject({
      side: 'lower',
      lambda: 0.08,
      generalizedTorqueNm: 0.08,
    });
  });
  it.each([false, true])(
    'handles wall geom order reversal=%s with the same outward force',
    (reverse) => {
      const c = scenario('B');
      const ids = idsFor(c);
      const fn = f.wall.reference.staticForceAtCapN;
      const lever = f.wall.reference.contactLeverM;
      const contact = {
        index: 0,
        geom: reverse ? [3, 0] : [0, 3],
        dim: 1,
        adhesion: 0,
        includemargin: 0,
        surfacevel: [0, 0, 0],
        frame: reverse ? [0, 1, 0, 1, 0, 0, 0, 0, -1] : [0, -1, 0, 1, 0, 0, 0, 0, 1],
        pos: [0.24 + lever, 0.06, 0.25],
        dist: 0,
        exclude: 0,
        efc_address: 0,
        solref: f.contact.solref,
        solimp: f.contact.solimp,
        force: [fn, 0, 0, 0, 0, 0],
      };
      const forward = {
        state: nativeState([f.wall.reference.firstTouchRad]),
        bodies: bodiesAtZero(),
        contacts: [contact],
        ncon: 1,
        nefc: 1,
        efcJ: [-lever],
        efcType: [5],
        efcId: [0],
        efcVel: [0],
      };
      const force = { contacts: [contact], efcForce: [fn], qfrcConstraint: [-lever * fn] };
      const observed = assessMechanismForces(f, c, ids, forward, force);
      expect(observed.wallLoadedContacts).toBe(1);
      expect(observed.wallOutwardForceN).toBe(fn);
      expect(observed.limitRows).toHaveLength(0);
      expect(observed.contactGeneralized[0]).toBeCloseTo(-0.08, 14);
      contact.dim = 3;
      expect(() => assessMechanismForces(f, c, ids, forward, force)).toThrow(
        'WALL_CONTACT_PROFILE',
      );
    },
  );
  it('rejects a force copied from the wrong phase/sign or a negative unilateral lambda', () => {
    for (const modify of [
      (r: ReturnType<typeof forceRecord>) => {
        r.force.qfrcConstraint[0] = 0.08;
      },
      (r: ReturnType<typeof forceRecord>) => {
        r.force.efcForce[0] = -0.08;
      },
      (r: ReturnType<typeof forceRecord>) => {
        r.forward.state.qpos[0] = 0;
      },
      (r: ReturnType<typeof forceRecord>) => {
        r.forward.efcType[0] = 0;
      },
    ]) {
      const r = forceRecord();
      modify(r);
      expect(() => assessMechanismForces(f, r.condition, r.ids, r.forward, r.force)).toThrow();
    }
  });
  it('rejects duplicated limit rows rather than overstating fresh witnesses', () => {
    const r = forceRecord();
    r.forward.nefc = 2;
    r.forward.efcJ = [-1, -1];
    r.forward.efcType = [3, 3];
    r.forward.efcId = [0, 0];
    r.forward.efcVel = [0, 0];
    r.force.efcForce = [0.04, 0.04];
    expect(() => assessMechanismForces(f, r.condition, r.ids, r.forward, r.force)).toThrow(
      'DUPLICATE_JOINT_LIMIT_ROW',
    );
  });
  it('enforces the exact native force cap and keeps signed work', () => {
    const c = scenario('C');
    const ids = idsFor(c);
    const pre = nativeState([0]);
    const post = nativeState([-0.01]);
    post.qvel[0] = -0.2;
    const forward = { actuatorLength: [0], actuatorVelocity: [0] };
    const force = { actuatorForce: [0.08], qfrcActuator: [0.08] };
    const control = { raw: [0.2], off: false };
    const result = assessMechanismActuation(f, ids, pre, post, control, forward, force, 500);
    expect(result.coordinateWorkJ).toBe(-0.0008);
    expect(result.midpointWorkJ).toBeCloseTo(-0.000004, 15);
    force.actuatorForce[0] = 0.08 + Number.EPSILON;
    expect(() => assessMechanismActuation(f, ids, pre, post, control, forward, force, 500)).toThrow(
      'TORQUE_CAP',
    );
  });
  it('does not accept stale force under an unsaturated command or a drive-off force', () => {
    const ids = idsFor(scenario('C'));
    const state = nativeState([0]);
    const forward = { actuatorLength: [0], actuatorVelocity: [0] };
    expect(() =>
      assessMechanismActuation(
        f,
        ids,
        state,
        state,
        { raw: [0.02], off: false },
        forward,
        { actuatorForce: [0.08], qfrcActuator: [0.08] },
        500,
      ),
    ).toThrow('FORCE_MAPPING');
    expect(() =>
      assessMechanismActuation(
        f,
        ids,
        state,
        state,
        { raw: [0], off: true },
        forward,
        { actuatorForce: [Number.EPSILON], qfrcActuator: [Number.EPSILON] },
        500,
      ),
    ).toThrow('DRIVE_OFF_NONZERO');
  });
});

describe('whole stationary windows include final endpoints', () => {
  it.each(['A', 'B', 'C', 'D'])(
    'accepts a complete synthetic%s window with the required fresh witnesses',
    (name) => {
      expect(completeWindow(name).every((w) => w.accepted && w.intervals === 2000)).toBe(true);
    },
  );
  it('rejects a bad final endpoint velocity even when every pre state was stationary', () => {
    expect(() =>
      completeWindow('C', (r, i, n) => {
        if (i === n) r.endpoint.qvel[0] = 0.005001;
      }),
    ).toThrow('STATIONARY_OR_REACTION_GATE');
  });
  it('rejects range growth hidden between the first and last samples', () => {
    expect(() =>
      completeWindow('C', (r, i) => {
        if (i === 1000) r.endpoint.qpos[0] += radians(0.100001);
      }),
    ).toThrow('STATIONARY_OR_REACTION_GATE');
  });
  it('requires each joint reaction on every A interval, not one earlier hit', () => {
    expect(() =>
      completeWindow('A', (r, i) => {
        if (i === 1000) r.reaction.loaded.J2.upper = false;
      }),
    ).toThrow('STATIONARY_OR_REACTION_GATE');
  });
  it('rejects a B window supported by an angle limit even with wall contact', () => {
    expect(() =>
      completeWindow('B', (r, i) => {
        if (i === 10)
          r.reaction.limitRows.push({
            row: 1,
            joint: 'J3',
            side: 'upper',
            lambda: 0.01,
            generalizedTorqueNm: -0.01,
          });
      }),
    ).toThrow('STATIONARY_OR_REACTION_GATE');
  });
  it('rejects missing wall load and any loaded D constraint', () => {
    expect(() =>
      completeWindow('B', (r, i) => {
        if (i === 20) r.reaction.wallLoadedContacts = 0;
      }),
    ).toThrow('STATIONARY_OR_REACTION_GATE');
    expect(() =>
      completeWindow('D', (r, i) => {
        if (i === 20) r.reaction.loadedLimitRows = 1;
      }),
    ).toThrow('STATIONARY_OR_REACTION_GATE');
  });
  it('does not shift a missing window start or silently skip an interval', () => {
    const c = scenario('C');
    const w = stationaryWindows(f, c)[0];
    const ids = idsFor(c);
    expect(() =>
      observeStationaryWindow(f, w, windowRecord(c, 1, w.startUs / c.dtUs + 2), ids),
    ).toThrow('NONCONSECUTIVE');
  });
});

function stressRecord(n: number, contacts: number, rows: number, limitRows: number, wall = true) {
  const condition = { ...scenario(wall ? 'B' : 'A'), articulated: n === 3 };
  const ids = idsFor(condition);
  const state = nativeState(zeros(n), 7);
  const bodies = bodiesAtZero();
  const frames = framesAtZero(condition);
  const oneContact = (index: number) => ({
    index,
    dist: 0,
    includemargin: 0,
    mu: 0,
    dim: 1,
    geom1: 0,
    geom2: 3,
    exclude: 0,
    efc_address: index,
    adhesion: 0,
    pos: zeros(3),
    frame: identity.slice(),
    friction: zeros(5),
    solref: [0.004, 1],
    solreffriction: zeros(2),
    solimp: [0.99, 0.99, 0.001, 0.5, 2],
    geom: [0, 3],
    flex: [-1, -1],
    elem: [-1, -1],
    vert: [-1, -1],
    surfacevel: zeros(3),
    H: zeros(36),
  });
  const contactData = Array.from({ length: contacts }, (_, i) => oneContact(i));
  const forward = {
    state: { qpos: state.qpos, qvel: state.qvel, time: state.time },
    bodies,
    contacts: contactData,
    efcVel: zeros(rows),
    efcType: zeros(rows),
    efcId: zeros(rows),
    ncon: contacts,
    nefc: rows,
    efcJ: zeros(rows * n),
    efcPos: zeros(rows),
    actuatorLength: zeros(n),
    actuatorVelocity: zeros(n),
    frames,
  };
  const force = {
    contacts: contactData.map((c) => ({ ...c, force: zeros(6) })),
    efcForce: zeros(rows),
    qfrcConstraint: zeros(n),
    qfrcActuator: zeros(n),
    actuatorForce: zeros(n),
    qacc: zeros(n),
    solverIterations: zeros(20),
    islands: 1,
    warnings: Array.from({ length: 7 }, () => [0, 0]),
    endpoint: state,
  };
  const geometry = {
    anchors: ids.links.map((l) => ({
      link: l.name,
      joint: 'J' + l.index,
      welded: false,
      errorM: 0,
    })),
    maxAnchorErrorM: 0,
    maxFrameError: 0,
    l3MaxYM: 0,
  };
  const reaction = {
    ...emptyReaction(n),
    limitRows: Array.from({ length: limitRows }, (_, i) => ({
      row: i,
      joint: 'J3',
      side: 'upper',
      lambda: 0,
      generalizedTorqueNm: 0,
    })),
    aggregation: Array.from({ length: n }, (_, i) => ({
      dof: i,
      summedNm: 0,
      nativeNm: 0,
      errorNm: 0,
      budgetNm: 0,
    })),
  };
  const actuation = {
    motors: ids.joints.map((j) => ({
      joint: j.name,
      raw: 0,
      nativeTorqueNm: 0,
      expectedNativeTorqueNm: 0,
      qfrcActuatorNm: 0,
      coordinateWorkJ: 0,
      midpointWorkJ: 0,
      saturated: false,
    })),
    coordinateWorkJ: 0,
    midpointWorkJ: 0,
    prePowerW: 0,
  };
  const cumulative = {
    status: 'DIAGNOSTIC_ONLY',
    baselineMechanicalJ: 0,
    coordinateWorkJ: 0,
    absoluteCoordinateWorkJ: 0,
    midpointWorkJ: 0,
    constraintWorkJ: 0,
    finalMechanicalJ: 0,
    maxMechanicalMinusInputJ: 0,
  };
  return makeMechanismTickRecord({
    tick: 28000,
    dtUs: 250,
    control: {
      intervalStartUs: 6999750,
      phase: 'DRIVE_LOWER',
      targetRad: 0,
      off: false,
      raw: zeros(n),
    },
    pre: state,
    forward,
    force,
    endpointBodies: bodies,
    endpointFrames: frames,
    preGeometry: geometry,
    endpointGeometry: geometry,
    reaction,
    actuation,
    energy: { kineticJ: 0, potentialJ: 0, mechanicalJ: 0, constraintWorkJ: 0, cumulative },
    singleJointBalance: {
      status: 'DIAGNOSTIC_ONLY',
      inertiaKgM2: 0,
      inertialTorqueNm: 0,
      appliedTorqueNm: 0,
      residualNm: 0,
    },
    iterations: [0],
  });
}

describe('bounded retained evidence, pure byte accounting', () => {
  it('proves the fixed successful-record schemas and14world journal envelope', () => {
    const records = {
      genericCaps: stressRecord(3, 8, 16, 16),
      A: stressRecord(3, 0, 3, 3, false),
      B: stressRecord(1, 8, 9, 1),
      C: stressRecord(1, 0, 1, 1, false),
      D: stressRecord(3, 0, 3, 3, false),
    };
    const sizes = Object.fromEntries(
      Object.entries(records).map(([key, record]) => {
        const bytes = canonicalBytes(record);
        expect(bytes.length).toBeLessThanOrEqual(65536);
        expect(bytes.buffer.byteLength).toBe(bytes.length);
        return [key, bytes.length];
      }),
    );
    //12 successful event worlds(A/B/C); one additional D first-event window
    //only on the first failing world. All later worlds abort. Each window:
    //<=800 pre +1 current +800 post. Sparse records are separately bounded.
    const eventWindows = 1601 * (4 * sizes.A + 4 * sizes.B + 4 * sizes.C + sizes.D + 13 * 1024);
    const sparseTicks =
      4 * 14 * (sizes.A + 1024) +
      4 * 8 * (sizes.B + 1024) +
      4 * 7 * (sizes.C + 1024) +
      2 * 10 * (sizes.D + 1024);
    const compact = 620 * (f.retention.maxCompactRecordBytes + 4);
    const worldMetadata = 28 * (f.retention.maxWorldMetadataBytes + 4);
    const cleanupAndInvocation = 17 * (f.retention.maxCompactRecordBytes + 4);
    const upper =
      eventWindows +
      sparseTicks +
      compact +
      worldMetadata +
      cleanupAndInvocation +
      f.retention.reservedFailureTrailerBytes;
    expect(upper).toBeLessThan(f.retention.maxJournalBytes);
    expect(f.retention.maxRingTicks * f.retention.maxTickBytes).toBe(52428800);
    expect(f.retention.reservedFailureTrailerBytes).toBeGreaterThanOrEqual(
      800 * (65536 + 1024) + 262144 + 65536,
    );
    console.info(
      'MECHANISM_PURE_RETENTION_PROOF ' +
        JSON.stringify({
          sizes,
          eventWindows,
          sparseTicks,
          compact,
          worldMetadata,
          cleanupAndInvocation,
          reservedFailureBytes: f.retention.reservedFailureTrailerBytes,
          journalEnvelopeBytes: upper,
          journalCapBytes: f.retention.maxJournalBytes,
          nativeInitializations: 0,
        }),
    );
  });
  it('owns exact64KiB backing buffers and caps800ring entries', () => {
    const journal = { append: () => {}, checkpoint: () => {} };
    const retention = new TickRetention(journal, f, 'pure-max-ring', 250);
    const overhead = canonicalBytes({ tick: 1, payload: Buffer.alloc(0) }).length;
    const payload = Buffer.alloc(65536 - overhead);
    for (let tick = 1; tick <= 801; tick += 1) retention.retain({ tick, payload });
    expect(retention.size).toBe(800);
    expect(retention.ring.reduce((sum, item) => sum + item.bytes.buffer.byteLength, 0)).toBe(
      52428800,
    );
    expect(retention.ring.every((item) => item.bytes.length === 65536)).toBe(true);
  });
  it('keeps a fresh failure ring after the first event post-window has ended', () => {
    const saved: { record: Record<string, unknown>; emergency: boolean }[] = [];
    const journal = {
      append: (record: Record<string, unknown>, emergency = false) =>
        saved.push({ record, emergency }),
      checkpoint: () => {},
    };
    const retention = new TickRetention(journal, f, 'pure-late-failure', 250);
    for (let tick = 1; tick <= 1700; tick += 1) {
      const record = { tick, value: tick };
      const bytes = retention.prepare(record);
      if (tick === 10) retention.event(tick, { side: 'upper' }, record);
      retention.retain(record, bytes);
    }
    retention.failure(1701, { tick: 1701 }, new Error('LATE_LOWER_LIMIT_FAILURE'));
    const failure = saved.filter((s) => s.record.kind === 'pre-failure-tick');
    expect(failure).toHaveLength(800);
    expect(failure[0].record.tick).toBe(901);
    expect(failure.at(-1)!.record.tick).toBe(1700);
    expect(failure.every((s) => s.emergency)).toBe(true);
    expect(saved.some((s) => s.record.kind === 'failure' && s.record.tick === 1701)).toBe(true);
  });
  it('leaves the failure trailer reserve available after a normal-write cap', () => {
    const dir = mkdtempSync(join(tmpdir(), 'asa-mechanism-journal-pure-'));
    try {
      const path = join(dir, 'bounded.raw');
      const journal = new RawJournal(path, {
        ...f.retention,
        maxJournalBytes: 8192,
        reservedFailureTrailerBytes: 2048,
      });
      journal.append({ payload: Buffer.alloc(4000) });
      expect(() => journal.append({ payload: Buffer.alloc(4000) })).toThrow(
        'RESOURCE_JOURNAL_BYTE_CAP',
      );
      const result = journal.finish({ kind: 'failure', verdict: 'FAIL' });
      expect(result.trailerError).toBeNull();
      expect(result.closeError).toBeNull();
      expect(readFileSync(path).length).toBe(result.bytes);
      expect(result.bytes).toBeLessThanOrEqual(8192);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('explicit CLI/source freeze without executing physics', () => {
  it('has inert help/default and an explicit plan with zero native counters', async () => {
    const output: string[] = [];
    expect(await runMechanismCli([], (s) => output.push(s))).toBe(0);
    expect(output.join('')).toContain('--preregister');
    output.length = 0;
    expect(await runMechanismCli(['--plan'], (s) => output.push(s))).toBe(0);
    const result = evidenceParse(output.join(''));
    expect(result).toMatchObject({
      moduleInitializations: 0,
      modelCreations: 0,
      dataCreations: 0,
      nativeAdvances: 0,
      physics: 'NOT_RUN',
    });
  });
  it.each([
    ['--admission'],
    ['--main'],
    ['--main', '--write-evidence'],
    ['--run'],
    ['--preregister', '--main'],
  ])('rejects incomplete/unallocated modes%s', (...args) =>
    expect(() => parseMechanismArgs(args)).toThrow('EXPLICIT_CLI_REQUIRED'),
  );
  it('requires an exact source freeze before any main invocation', () => {
    const manifest = { source: 'abc' };
    const e = { preregistrations: [], attempts: [] };
    expect(() => assertMechanismRunAllowed(e, 'fixture', manifest, 'qualification')).toThrow(
      'FROZEN_SOURCE_MISMATCH',
    );
    expect(
      sourceMatches({ fixtureSha256: 'fixture', sourceManifest: manifest }, 'fixture', {
        source: 'changed',
      }),
    ).toBe(false);
  });
  it('blocks incomplete/failed attempts and makes a successful replay explicit', () => {
    const snapshot = { fixtureSha256: 'fixture', sourceManifest: { source: 'abc' } };
    for (const status of ['RUNNING', 'FAIL']) {
      const e = {
        preregistrations: [snapshot],
        attempts: [
          { ...snapshot, status, operation: 'qualification', assessment: { verdict: 'FAIL' } },
        ],
      };
      expect(() =>
        assertMechanismRunAllowed(e, 'fixture', snapshot.sourceManifest, 'qualification'),
      ).toThrow('PRIOR_INCOMPLETE_OR_FAILED');
    }
    const previous = {
      ...snapshot,
      status: 'FINISHED',
      operation: 'qualification',
      assessment: { verdict: 'PASS' },
    };
    const e = { preregistrations: [snapshot], attempts: [previous] };
    expect(() =>
      assertMechanismRunAllowed(e, 'fixture', snapshot.sourceManifest, 'qualification'),
    ).toThrow('ALREADY_RECORDED');
    expect(
      assertMechanismRunAllowed(e, 'fixture', snapshot.sourceManifest, 'explicit-replay').previous,
    ).toBe(previous);
  });
  it('retains signed zero and nonfinite failure values in JSON evidence', () => {
    const result = evidenceParse(evidenceStringify([-0, NaN, Infinity, -Infinity]));
    expect(Object.is(result[0], -0)).toBe(true);
    expect(Number.isNaN(result[1])).toBe(true);
    expect(result.slice(2)).toEqual([Infinity, -Infinity]);
  });
  it('does not load a native module at import time or dispatch it from default tests', () => {
    const module = readFileSync(
      new URL('../../../tools/robotics-field-core/mujoco-mechanism.mjs', import.meta.url),
      'utf8',
    );
    const executor = module.indexOf('export async function executeMechanism');
    expect(module.indexOf('await import(')).toBeGreaterThan(executor);
    expect(module.slice(0, executor)).not.toContain('await initialize(');
    expect(module).not.toMatch(
      /data\.(?:qpos|qvel|qacc|qacc_warmstart)\s*(?:\[[^\]]+\])?\s*=(?!=)/,
    );
    expect(module).not.toContain('M.mj_step(');
  });
});

describe('creation-failure cleanup and PRE event accounting using JS stubs', () => {
  it('does not touch any module/model in the World constructor', () => {
    const M = new Proxy(
      {},
      {
        get: () => {
          throw new Error('UNEXPECTED_MOCK_API_ACCESS');
        },
      },
    );
    const world = new MechanismWorld(
      M,
      f,
      scenario('A'),
      {},
      { append: () => {}, checkpoint: () => {} },
    );
    expect(world.tick).toBe(0);
    expect(world.summary.modelCreationAttempted).toBe(false);
  });
  it('cleans the created model when data construction fails', () => {
    let deleted = 0;
    const M = {
      MjModel: {
        from_xml_string: () => ({
          delete: () => {
            deleted += 1;
          },
        }),
      },
      MjData: class {
        constructor() {
          throw new Error('SYNTHETIC_DATA_CONSTRUCTION_FAILURE');
        }
      },
    };
    const total = {
      allowedWorlds: 14,
      allowedConcurrentWorlds: 1,
      modelCreationDispatched: 0,
      modelsCreated: 0,
      modelsFreed: 0,
      maxConcurrentWorlds: 0,
      dataCreationDispatched: 0,
      dataCreated: 0,
      dataFreed: 0,
    };
    const world = new MechanismWorld(M, f, scenario('A'), total, {
      append: () => {},
      checkpoint: () => {},
    });
    expect(() => world.create()).toThrow('SYNTHETIC_DATA_CONSTRUCTION_FAILURE');
    world.dispose();
    expect(deleted).toBe(1);
    expect(total.modelCreationDispatched).toBe(1);
    expect(total.dataCreated).toBe(0);
    expect(total.modelsFreed).toBe(1);
  });
  it('timestamps positive lambda at saved PRE time and preserves negative restoring torque', () => {
    const journal = { append: () => {}, checkpoint: () => {} };
    const world = new MechanismWorld({}, f, scenario('C'), {}, journal);
    const record = {
      tick: 3,
      intervalStartUs: 1000,
      intervalEndUs: 1500,
      pre: { time: 0.001 },
      reaction: {
        wallLoadedContacts: 0,
        limitRows: [{ joint: 'J3', side: 'upper', lambda: 0.08, generalizedTorqueNm: -0.08 }],
      },
    };
    world.observeEvents(record);
    expect(world.summary.firstLoaded.limits.J3.upper).toMatchObject({
      intervalStartUs: 1000,
      nativePreTime: 0.001,
      lambda: 0.08,
      generalizedTorqueNm: -0.08,
    });
  });
});

function comparisonSummaries() {
  return plan.map((p) => ({
    id: p.id,
    condition: p,
    status: 'PASS',
    ticks: p.maxSteps,
    rawChain: { ticks: p.maxSteps, sha256: digest(p.case + '-' + p.dtUs) },
    physicalChain: { ticks: p.maxSteps, sha256: digest(p.case + '-' + p.dtUs + '-physical') },
    finalState: nativeState(zeros(p.articulated ? 3 : 1), p.durationUs / 1e6),
    finalBodies: Object.fromEntries(
      ['L1', 'L2', 'L3'].map((name) => [name, { com: [0.3, 0, 0.25], quaternion: quat.slice() }]),
    ),
    firstLoaded: {
      wall: { intervalStartUs: 100000 },
      limits: { J3: { upper: { intervalStartUs: 150000 } } },
    },
    windows: [
      {
        minL3MaxYM: p.case === 'B' ? 0.06 : 0.07732050807568877,
        maxL3MaxYM: p.case === 'B' ? 0.06 : 0.07732050807568877,
      },
    ],
  }));
}
describe('paired comparisons do not inflate reference size', () => {
  it('keeps A/D refinement diagnostic, B/C hard and all repeated cases exact', () => {
    const comparisons = assessMechanismComparisons(f, comparisonSummaries());
    expect(comparisons.filter((c) => c.kind === 'exact-repeat')).toHaveLength(6);
    expect(
      comparisons.filter((c) => c.kind === 'dt-refinement' && c.verdict === 'PASS'),
    ).toHaveLength(4);
    expect(
      comparisons.filter((c) => c.kind === 'dt-refinement' && c.verdict === 'DIAGNOSTIC_ONLY'),
    ).toHaveLength(3);
    expect(f.refinement.referenceSizeM).toBe(0.12);
    expect(f.refinement.finalComMaxDifferenceM).toBe(0.0012);
  });
  it('fails B/C at1.2mm COM difference and at more than10ms PRE event difference', () => {
    const moved = comparisonSummaries();
    moved.find((s) => s.id === 'B-250-r1')!.finalBodies.L3.com[0] += 0.001201;
    expect(() => assessMechanismComparisons(f, moved)).toThrow('BC_REFINEMENT_GATE');
    const late = comparisonSummaries();
    late.find((s) => s.id === 'C-250-r1')!.firstLoaded.limits.J3.upper.intervalStartUs += 10001;
    expect(() => assessMechanismComparisons(f, late)).toThrow('BC_REFINEMENT_GATE');
  });
  it('requires10mm separation across the entire stationary B/C windows', () => {
    const summaries = comparisonSummaries();
    summaries.find((s) => s.id === 'C-500-r1')!.windows[0].minL3MaxYM = 0.069999;
    expect(() => assessMechanismComparisons(f, summaries)).toThrow('STATIONARY_GAP');
  });
  it('does not label an incomplete or duplicated set as a physical PASS', () => {
    const summaries = comparisonSummaries();
    summaries[1] = summaries[0];
    expect(() => assessMechanismComparisons(f, summaries)).toThrow('INCOMPLETE_OR_DUPLICATE');
    expect(canonicalEqual(-0, 0)).toBe(false);
  });
});
