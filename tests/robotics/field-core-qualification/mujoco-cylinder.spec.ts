import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  RawJournal,
  TickRetention,
  assessContacts,
  assessWindow,
  canonicalBytes,
  canonicalEqual,
  canonicalKeyCacheUsage,
  numberVectorEqual,
  contactWorldForce,
  effectiveTorque,
  floorFrame,
  forceAggregationBudget,
  frameError,
  radians,
  relativePointVelocity,
  ry,
  supportWitness,
  tiltState,
  witnessPoints,
  boundedNativeArray,
  captureGeometry,
  copyContacts,
  copyState,
  copyWarnings,
  copyGeometryWarnings,
  quaternionMatrix,
  rotate,
} from '../../../tools/robotics-field-core/mujoco-contact-observer.mjs';
import {
  blockInertia,
  controlAt,
  cylinderPlan,
  makeCylinderXml,
  makeTickRecord,
  readCylinderFixture,
  validateCylinderFixture,
  validateGeometryReadback,
  worldIds,
  assessCylinderGeometry,
  createGeometryReport,
  cylinderRetentionProof,
  cylinderScenarioLimits,
  decodeFloat64Words,
  decodeRetainedGeometryInput,
  finalizeCylinderGeometry,
  float64Words,
  geometryJournalRetention,
  runCylinderGeometrySession,
  validateModel,
  acceptedCylinderGeometry,
  cylinderDynamicBudget,
  cylinderPhysicsTransition,
  CylinderNativeLedger,
  executeCylinderStage,
  finalizeCylinderDynamic,
  validateCylinderDynamicAuthorization,
  World,
} from '../../../tools/robotics-field-core/mujoco-cylinder.mjs';
import {
  parseGeometryCli,
  parseCylinderDynamicCli,
  encodeCylinderDynamicReceipt,
  runCylinderCli,
  validateGeometryAuthorization,
} from '../../../tools/robotics-field-core/run-mujoco-cylinder.mjs';

// Pure observer contracts only: synthetic records and temporary journal bytes.
// This spec does not load a physics engine or call the explicit qualification runner.
const { fixture } = readCylinderFixture();
type PlanEntry = ReturnType<typeof cylinderPlan>[number];
const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const target = radians(10);

type Body = {
  com: number[];
  rotation: number[];
  velocity: number[];
  omega: number[];
};
type WindowState = {
  theta: number;
  omega: number;
  phi: number;
  beta: number;
  relativeOmega: number;
  relativeOmegaY: number;
  uphillRimLift: number | null;
  uphillDirectionValid: boolean;
};
type Interval = {
  tick: number;
  pre: WindowState;
  post: WindowState;
  loaded: boolean;
  supported: boolean;
  positiveSupport: boolean;
  noSlip: boolean;
  downhillRim: boolean;
};
type RetainedRecord = {
  kind: string;
  world?: string;
  tick?: number;
  count?: number;
  bytes?: Buffer;
  [key: string]: unknown;
};

function body(overrides: Partial<Body> = {}): Body {
  return {
    com: [0, 0, 0],
    rotation: identity.slice(),
    velocity: [0, 0, 0],
    omega: [0, 0, 0],
    ...overrides,
  };
}
function expectVector(actual: number[], expected: number[], digits = 12) {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((value, i) => expect(actual[i]).toBeCloseTo(value, digits));
}
function state(overrides: Partial<WindowState> = {}): WindowState {
  return {
    theta: target,
    omega: 0,
    phi: 0,
    beta: 0,
    relativeOmega: 0,
    relativeOmegaY: 0,
    uphillRimLift: 0,
    uphillDirectionValid: true,
    ...overrides,
  };
}
function windowRecords(type: 'stable' | 'tip' = 'stable', dtUs = 500): Interval[] {
  const count = fixture.tilt.stationaryWindowUs / dtUs;
  const beta0 = radians(fixture.tilt.tip.minDownhillBetaDeg + 0.1);
  // The last PRE state is below the growth threshold; the last POST crosses it.
  const increment = radians(fixture.tilt.tip.minBetaGrowthDeg) / (count - 0.5);
  const at = (i: number) =>
    type === 'stable'
      ? state()
      : state({
          beta: beta0 + increment * i,
          phi: beta0 + increment * i,
          relativeOmega: increment / (dtUs / 1e6),
          relativeOmegaY: increment / (dtUs / 1e6),
          uphillRimLift: fixture.tilt.tip.minUphillRimLiftM + 0.001,
        });
  return Array.from({ length: count }, (_, i) => ({
    tick: 101 + i,
    pre: at(i),
    post: at(i + 1),
    loaded: true,
    supported: true,
    positiveSupport: true,
    noSlip: true,
    downhillRim: true,
  }));
}
function syntheticContact(reverse = false) {
  const shape = {
    name: 'cylinder',
    kind: 'cylinder',
    mass: fixture.bodies.cylinder.massKg,
    radius: fixture.bodies.cylinder.radiusM,
    height: fixture.bodies.cylinder.heightM,
    geomId: 1,
    bodyId: 1,
    dofAdr: 0,
  };
  const cylinder = body({ com: [0, 0, shape.height / 2 - 0.002] });
  const frame = reverse ? [0, 0, -1, 1, 0, 0, 0, -1, 0] : [0, 0, 1, 1, 0, 0, 0, 1, 0];
  const contact = {
    geom: reverse ? [1, 0] : [0, 1],
    pos: [0.03, 0, -0.001],
    dist: -0.002,
    frame,
    dim: 3,
    efc_address: 0,
    exclude: 0,
    includemargin: 0,
    adhesion: 0,
    friction: [...fixture.contact.effectiveFriction],
    solref: [...fixture.contact.solref],
    solreffriction: [...fixture.contact.solreffriction],
    solimp: [...fixture.contact.solimp],
    surfacevel: [0, 0, 0],
  };
  const normalForce = 4.905;
  const forward = {
    ncon: 1,
    nefc: 3,
    contacts: [contact],
    bodies: {
      0: body({ com: [0, 0, -0.025] }),
      1: cylinder,
    },
    efcVel: [0, 0, 0],
    efcType: [7, 7, 7],
    efcId: [0, 0, 0],
  };
  const force = {
    contacts: [{ ...contact, force: [normalForce, 0, 0, 0, 0, 0] }],
    efcForce: [normalForce, 0, 0],
    qfrcConstraint: [0, 0, normalForce],
    islands: 1,
  };
  return {
    contact,
    cylinder,
    shape,
    forward,
    force,
    floor: floorFrame(0),
    ids: { floorGeom: 0, geomBodies: { 0: 0, 1: 1 }, freeBodies: [shape] },
  };
}
function framedPayloads(bytes: Buffer) {
  const payloads: Buffer[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    expect(bytes.length - offset).toBeGreaterThanOrEqual(4);
    const length = bytes.readUInt32LE(offset);
    offset += 4;
    expect(length).toBeLessThanOrEqual(bytes.length - offset);
    payloads.push(bytes.subarray(offset, offset + length));
    offset += length;
  }
  expect(offset).toBe(bytes.length);
  return payloads;
}
function withJournal(
  limit: number,
  check: (journal: InstanceType<typeof RawJournal>, path: string) => void,
) {
  const directory = mkdtempSync(join(tmpdir(), 'asa-cylinder-pure-journal-'));
  let journal: InstanceType<typeof RawJournal> | undefined;
  try {
    const path = join(directory, 'observations.bin');
    journal = new RawJournal(path, {
      ...fixture.retention,
      maxJournalBytes: limit,
      reservedFailureTrailerBytes: 65536,
    });
    check(journal, path);
  } finally {
    if (journal && !journal.closed) journal.finish({ kind: 'test-cleanup' });
    rmSync(directory, { recursive: true, force: true });
  }
}
function memoryRetention(maxTickBytes = 1024) {
  const records: RetainedRecord[] = [];
  let checkpoints = 0;
  const journal = {
    append(record: RetainedRecord) {
      records.push(record);
    },
    checkpoint() {
      checkpoints += 1;
    },
  };
  const mini = {
    ...fixture,
    retention: {
      ...fixture.retention,
      preWindowUs: 1500,
      postWindowUs: 1000,
      maxRingTicks: 3,
      maxTickBytes,
    },
  };
  return {
    records,
    journal,
    mini,
    getCheckpoints: () => checkpoints,
    retained: new TickRetention(journal, mini, 'synthetic-world', 500),
  };
}

function xmlElements(xml: string, tag: string): Record<string, string>[] {
  return Array.from(xml.matchAll(new RegExp('<' + tag + '\\b([^>]*)>', 'g')), (match) =>
    Object.fromEntries(
      Array.from(match[1].matchAll(/([A-Za-z_]\w*)="([^"]*)"/g), ([, key, value]) => [key, value]),
    ),
  );
}

function geometryReadback(kind: 'static' | 'tilt') {
  const c = fixture.bodies.cylinder;
  const b = fixture.bodies.block;
  const tilt = kind === 'tilt';
  const quaternions = (count: number) => Array.from({ length: count }, () => [1, 0, 0, 0]).flat();
  // Declared geometry and inertial layout only; these are ordinary copied arrays.
  return {
    body_mass: tilt ? [0, fixture.stand.massKg, c.massKg] : [0, c.massKg, b.massKg],
    geom_size: tilt
      ? [...fixture.bodies.floor.halfExtentsM, c.radiusM, c.heightM / 2, 0]
      : [
          ...fixture.bodies.floor.halfExtentsM,
          c.radiusM,
          c.heightM / 2,
          0,
          ...b.dimensionsM.map((value: number) => value / 2),
        ],
    geom_pos: tilt ? [0, 0, -0.025, 0, 0, 0] : [0, 0, -0.025, 0, 0, 0, 0, 0, 0],
    geom_quat: quaternions(tilt ? 2 : 3),
    geom_bodyid: tilt ? [1, 2] : [0, 1, 2],
    body_parentid: [0, 0, 0],
    body_pos: tilt
      ? [0, 0, 0, 0, 0, 0, 0, 0, c.heightM / 2 + fixture.initialGapM]
      : [
          0,
          0,
          0,
          c.restX,
          0,
          c.heightM / 2 + fixture.initialGapM,
          b.restX,
          0,
          b.dimensionsM[2] / 2 + fixture.initialGapM,
        ],
    body_quat: quaternions(3),
    body_ipos: tilt ? [0, 0, 0, ...fixture.stand.com, 0, 0, 0] : Array(9).fill(0),
    body_iquat: quaternions(3),
    body_dofadr: tilt ? [-1, 0, 1] : [-1, 0, 6],
    body_dofnum: tilt ? [0, 1, 6] : [0, 6, 6],
    jnt_bodyid: [1, 2],
    jnt_qposadr: tilt ? [0, 1] : [0, 7],
    jnt_dofadr: tilt ? [0, 1] : [0, 6],
    jnt_pos: [0, 0, 0, 0, 0, 0],
  };
}

function eightContactTick() {
  const condition = cylinderPlan(fixture, 'admission')[0];
  const ids = worldIds(fixture, condition);
  const nativeBodies: Record<number, Body & { quaternion: number[] }> = {
    0: { ...body(), quaternion: [1, 0, 0, 0] },
  };
  const endpointBodies: Record<string, Body & { quaternion: number[] }> = {};
  const qpos: number[] = [];
  const qvel: number[] = [];
  const depth = 0.00001;
  for (const shape of ids.freeBodies) {
    const cylinder = shape.kind === 'cylinder';
    const com = [
      cylinder ? -0.15 : 0.15,
      0,
      (cylinder ? shape.height : shape.dimensions[2]) / 2 - depth,
    ];
    const observed = {
      ...body({
        com,
        velocity: [cylinder ? 0.01 : -0.005, 0, 0],
        omega: [0, 0, cylinder ? 0.2 : -0.1],
      }),
      quaternion: [1, 0, 0, 0],
    };
    nativeBodies[shape.bodyId] = observed;
    endpointBodies[shape.name] = observed;
    qpos.push(...com, ...observed.quaternion);
    qvel.push(...observed.velocity, ...observed.omega);
  }
  type FullContact = ReturnType<typeof syntheticContact>['contact'] & {
    index: number;
    geom1: number;
    geom2: number;
    mu: number;
    friction: number[];
    solref: number[];
    solreffriction: number[];
    solimp: number[];
    flex: number[];
    elem: number[];
    vert: number[];
    H: number[];
  };
  const contacts: FullContact[] = [];
  const efcVel: number[] = [];
  const efcType: number[] = [];
  const efcId: number[] = [];
  for (const shape of ids.freeBodies) {
    const center = nativeBodies[shape.bodyId].com;
    const offsets =
      shape.kind === 'cylinder'
        ? [
            [0.03, 0],
            [0, 0.03],
            [-0.03, 0],
            [0, -0.03],
          ]
        : [
            [0.04, 0.02],
            [-0.04, 0.02],
            [-0.04, -0.02],
            [0.04, -0.02],
          ];
    for (const [x, y] of offsets) {
      const index = contacts.length;
      const contact = {
        index,
        dist: -depth,
        includemargin: 0,
        mu: 1,
        dim: 3,
        geom1: 0,
        geom2: shape.geomId,
        exclude: 0,
        efc_address: 3 * index,
        adhesion: 0,
        pos: [center[0] + x, center[1] + y, -depth / 2],
        frame: [0, 0, 1, 1, 0, 0, 0, 1, 0],
        friction: [...fixture.contact.effectiveFriction],
        solref: [0.004, 1],
        solreffriction: [0, 0],
        solimp: [0.99, 0.99, 0.001, 0.5, 2],
        geom: [0, shape.geomId],
        flex: [-1, -1],
        elem: [-1, -1],
        vert: [-1, -1],
        surfacevel: [0, 0, 0],
        H: Array(36).fill(0),
      };
      contacts.push(contact);
      const observed = nativeBodies[shape.bodyId];
      efcVel.push(0, observed.velocity[0] - observed.omega[2] * y, observed.omega[2] * x);
      efcType.push(7, 7, 7);
      efcId.push(index, index, index);
    }
  }
  const endpoint = {
    time: condition.dtUs / 1e6,
    qpos,
    qvel,
    qacc: Array(12).fill(0),
    qacc_warmstart: Array(12).fill(0),
  };
  const forward = {
    state: { time: 0, qpos, qvel },
    bodies: nativeBodies,
    contacts,
    efcVel,
    efcType,
    efcId,
    ncon: 8,
    nefc: 24,
  };
  const force = {
    contacts: contacts.map((contact) => ({
      ...contact,
      force: [1.22625, 0, 0, 0, 0, 0],
    })),
    efcForce: Array.from({ length: 8 }, () => [1.22625, 0, 0]).flat(),
    qfrcConstraint: [0, 0, 4.905, 0, 0, 0, 0, 0, 4.905, 0, 0, 0],
    qfrcActuator: Array(12).fill(0),
    actuatorForce: [],
    endpoint,
    warnings: Array.from({ length: 7 }, () => [0, 0]),
    islands: 2,
  };
  const contact = assessContacts(fixture, forward, force, ids, floorFrame(0));
  const control = controlAt(fixture, condition, 0);
  return makeTickRecord({
    tick: 1,
    dtUs: condition.dtUs,
    phase: control.phase,
    control,
    forward,
    force,
    contact,
    torque: null,
    preTilt: null,
    postTilt: null,
    endpointBodies,
    activeIterations: [30, 30],
  });
}

describe('Cylinder observer canonical binary contracts without native dynamics', () => {
  it('preserves signed zero, including nested parity fields', () => {
    expect(canonicalBytes(0).toString('hex')).toBe('030000000000000000');
    expect(canonicalBytes(-0).toString('hex')).toBe('030000000000000080');
    expect(canonicalEqual({ qvel: [0] }, { qvel: [-0] })).toBe(false);
  });

  it('canonicalizes distinct NaN payloads without converting them to null', () => {
    const a = Buffer.alloc(8);
    const b = Buffer.alloc(8);
    a.writeBigUInt64LE(0x7ff0000000000001n);
    b.writeBigUInt64LE(0xfff8000000000042n);
    expect(Number.isNaN(a.readDoubleLE())).toBe(true);
    expect(Number.isNaN(b.readDoubleLE())).toBe(true);
    expect(canonicalBytes(a.readDoubleLE()).toString('hex')).toBe('03000000000000f87f');
    expect(canonicalEqual(a.readDoubleLE(), b.readDoubleLE())).toBe(true);
    expect(canonicalEqual(NaN, null)).toBe(false);
  });

  it('preserves infinities as distinct failed-observation values', () => {
    expect(canonicalBytes(Infinity).toString('hex')).toBe('03000000000000f07f');
    expect(canonicalBytes(-Infinity).toString('hex')).toBe('03000000000000f0ff');
    expect(canonicalEqual(Infinity, -Infinity)).toBe(false);
  });

  it('sorts keys by UTF8 bytes, including a UTF16-versus-UTF8 ordering trap', () => {
    const a = { '\u{10000}': 1, '\uE000': 2 };
    const b = { '\uE000': 2, '\u{10000}': 1 };
    const expected =
      '0602000000' + '0403000000ee8080030000000000000040' + '0404000000f090808003000000000000f03f';
    expect(canonicalBytes(a).toString('hex')).toBe(expected);
    expect(canonicalEqual(a, b)).toBe(true);
  });

  it('frames strings, array entries and object keys without concatenation collisions', () => {
    expect(canonicalBytes('é').toString('hex')).toBe('0402000000c3a9');
    expect(canonicalEqual(['ab', 'c'], ['a', 'bc'])).toBe(false);
    expect(canonicalEqual({ a: 'bc' }, { ab: 'c' })).toBe(false);
    expect(canonicalEqual([], {})).toBe(false);
  });

  it('distinguishes raw bytes from strings and numeric arrays', () => {
    expect(canonicalBytes(Buffer.from([0, 255])).toString('hex')).toBe('070200000000ff');
    expect(canonicalEqual(Buffer.from('ab'), 'ab')).toBe(false);
    expect(canonicalEqual(Buffer.from([1, 2]), [1, 2])).toBe(false);
    expect(canonicalEqual(new Float64Array([1, -0]), [1, -0])).toBe(true);
  });

  it('keeps framing and all bytes when the encoder grows beyond its initial buffer', () => {
    const value = 'x'.repeat(5000);
    const bytes = canonicalBytes(value);
    expect(bytes.length).toBe(5005);
    expect(bytes[0]).toBe(4);
    expect(bytes.readUInt32LE(1)).toBe(5000);
    expect(bytes.subarray(5).equals(Buffer.from(value))).toBe(true);
  });

  it.each([undefined, 1n, Symbol('unsupported'), () => 0])(
    'rejects an unsupported value rather than silently omitting it: %s',
    (value) => {
      expect(() => canonicalBytes({ value })).toThrow('RAW_UNSUPPORTED_TYPE');
    },
  );
});

describe('Cylinder contact geometry and force observers on synthetic records', () => {
  it.each([false, true])('reconstructs both witnesses with geom order reversed=%s', (reverse) => {
    const sample = syntheticContact(reverse);
    const points = witnessPoints(sample.contact);
    const bodySlot = reverse ? 0 : 1;
    expectVector(points[bodySlot], [0.03, 0, -0.002]);
    expectVector(points[1 - bodySlot], [0.03, 0, 0]);
    expect(points[bodySlot][2]).not.toBe(sample.contact.pos[2]);
    expect(points[1 - bodySlot][2]).not.toBe(sample.contact.pos[2]);
    const support = supportWitness(
      sample.contact,
      1,
      sample.cylinder,
      sample.floor,
      sample.shape,
      fixture,
    );
    expect(support.supported).toBe(true);
    expect(support.downhillRim).toBe(true);
  });

  it('evaluates both rotational lever arms at the same native contact midpoint', () => {
    const a = body({ com: [1, 0, 0], velocity: [1, 2, 3], omega: [0, 0, 2] });
    const b = body({ com: [0, 1, 0], velocity: [-1, 3, 2], omega: [0, 2, 0] });
    expectVector(relativePointVelocity([1, 1, 1], a, b), [2, 1, -3]);
    expectVector(relativePointVelocity([1, 1, 1], b, a), [-2, -1, 3]);
    // Using the two separated witnesses instead would yield [1.6, 1, -3].
    expect(relativePointVelocity([1, 1, 1], a, b)[0]).not.toBeCloseTo(1.6, 12);
  });

  it('cancels a shared rigid twist even when the bodies have different COM positions', () => {
    const a = body({ com: [1, 0, 0], velocity: [0, 2, 0], omega: [0, 0, 2] });
    const b = body({ com: [0, 1, 0], velocity: [-2, 0, 0], omega: [0, 0, 2] });
    expectVector(relativePointVelocity([3, 4, 5], a, b), [0, 0, 0]);
  });

  it('accepts an orthonormal right-handed contact frame and applies its transpose to force', () => {
    const frame = [0, 1, 0, -1, 0, 0, 0, 0, 1];
    expect(frameError(frame)).toBe(0);
    expectVector(contactWorldForce(frame, [5, 2, -3, 7, 11, 13]), [-2, 5, -3]);
  });

  it.each([
    ['reflection', [0, 0, 1, 1, 0, 0, 0, -1, 0]],
    ['duplicate axis', [0, 0, 1, 0, 0, 1, 0, 1, 0]],
    ['nonunit normal', [0, 0, 2, 1, 0, 0, 0, 1, 0]],
  ])('detects the invalid %s contact frame', (_name, frame) => {
    expect(frameError(frame)).toBeGreaterThan(fixture.contact.frameOrthonormalTolerance);
  });

  it('uses a roundoff-sized force aggregation budget, including the mass/gravity term', () => {
    const bound = forceAggregationBudget(4, 100, 0.5);
    expect(bound).toBeGreaterThan(1.84e-12);
    expect(bound).toBeLessThan(1.85e-12);
    const zeroProducts = forceAggregationBudget(0, 0, 0.5);
    expect(zeroProducts).toBeGreaterThan(6.96e-14);
    expect(zeroProducts).toBeLessThan(6.98e-14);
    expect(forceAggregationBudget(8, 100, 0.5)).toBeGreaterThan(bound);
    expect(forceAggregationBudget(4, 200, 0.5)).toBeGreaterThan(bound);
    expect(forceAggregationBudget(4, 100, 1)).toBeGreaterThan(bound);
  });

  it.each([false, true])(
    'aggregates the outward body force with geom order reversed=%s',
    (reverse) => {
      const sample = syntheticContact(reverse);
      const report = assessContacts(
        fixture,
        sample.forward,
        sample.force,
        sample.ids,
        sample.floor,
      );
      expect(report.bodies.cylinder.loaded).toBe(1);
      expect(report.bodies.cylinder.supported).toBe(true);
      expect(report.bodies.cylinder.outwardForce).toBeCloseTo(4.905, 12);
      expectVector(report.bodies.cylinder.forceSum, [0, 0, 4.905]);
      expect(report.maxForceAggregationError).toBe(0);
    },
  );

  it.each([
    ['negative normal', 'UNKNOWN_NEGATIVE_NORMAL_FORCE_WITH_ZERO_ADHESION'],
    ['missing rows', 'UNKNOWN_LOADED_CONTACT_DOMAIN'],
    ['wrong row force', 'CONTACT_FORCE_EFC_PARITY'],
    ['wrong aggregate', 'CONTACT_FORCE_AGGREGATION_TRANSLATION'],
  ])('rejects %s in an otherwise supported loaded contact', (mutation, error) => {
    const sample = syntheticContact();
    if (mutation === 'negative normal') sample.force.contacts[0].force[0] = -0.1;
    if (mutation === 'missing rows') sample.forward.efcType[1] = 0;
    if (mutation === 'wrong row force') sample.force.efcForce[1] = 0.1;
    if (mutation === 'wrong aggregate') sample.force.qfrcConstraint[2] += 1e-6;
    expect(() =>
      assessContacts(fixture, sample.forward, sample.force, sample.ids, sample.floor),
    ).toThrow(error);
  });

  it.each(['friction', 'solref', 'solimp', 'surfacevel'] as const)(
    'rejects an unregistered effective contact %s before accepting force evidence',
    (field) => {
      const sample = syntheticContact();
      sample.contact[field][0] += 0.001;
      expect(() =>
        assessContacts(fixture, sample.forward, sample.force, sample.ids, sample.floor),
      ).toThrow('NATIVE_EFFECTIVE_CONTACT_PARAMETERS');
    },
  );

  it('distinguishes supported uphill contact from loaded downhill rim support', () => {
    const sample = syntheticContact();
    sample.contact.pos[0] = -0.03;
    const support = supportWitness(
      sample.contact,
      1,
      sample.cylinder,
      sample.floor,
      sample.shape,
      fixture,
    );
    expect(support.supported).toBe(true);
    expect(support.downhillRadius).toBeCloseTo(-0.03, 12);
    expect(support.downhillRim).toBe(false);
  });

  it('rejects a candidate witness outside the cylinder footprint', () => {
    const sample = syntheticContact();
    sample.contact.pos[0] = fixture.bodies.cylinder.radiusM + 0.01;
    const support = supportWitness(
      sample.contact,
      1,
      sample.cylinder,
      sample.floor,
      sample.shape,
      fixture,
    );
    expect(support.baseError).toBeLessThan(1e-12);
    expect(support.floorError).toBeLessThan(1e-12);
    expect(support.footprint).toBe(false);
    expect(support.supported).toBe(false);
  });

  it('checks block witness planes without imposing an unregistered normal-angle gate', () => {
    const shape = { kind: 'block', dimensions: fixture.bodies.block.dimensionsM };
    for (const angle of [0, 0.2]) {
      const n = [Math.sin(angle), 0, Math.cos(angle)];
      const contact = {
        geom: [0, 1],
        pos: n.map((v) => -0.001 * v),
        dist: -0.002,
        frame: [...n, Math.cos(angle), 0, -Math.sin(angle), 0, 1, 0],
      };
      const block = body({
        com: [-0.002 * n[0], 0, shape.dimensions[2] / 2 - 0.002 * n[2]],
      });
      const support = supportWitness(contact, 1, block, floorFrame(0), shape, fixture);
      expect(support.baseError).toBeLessThan(1e-12);
      expect(support.floorError).toBeLessThan(1e-12);
      expect(support.supported).toBe(true);
      block.com[2] += 0.001;
      const outside = supportWitness(contact, 1, block, floorFrame(0), shape, fixture);
      expect(outside.baseError).toBeGreaterThan(fixture.contact.basePlaneToleranceM);
      expect(outside.faceDomain).toBe(false);
      expect(outside.supported).toBe(false);
    }
  });

  it('requires every loaded contact to be on the downhill rim, not just one', () => {
    const sample = syntheticContact();
    const second = { ...sample.contact, efc_address: 3, pos: [-0.03, 0, -0.001] };
    sample.forward.contacts.push(second);
    sample.forward.ncon = 2;
    sample.forward.nefc = 6;
    sample.forward.efcVel.push(0, 0, 0);
    sample.forward.efcType.push(7, 7, 7);
    sample.forward.efcId.push(1, 1, 1);
    sample.force.contacts.push({ ...second, force: [4.905, 0, 0, 0, 0, 0] });
    sample.force.efcForce.push(4.905, 0, 0);
    sample.force.qfrcConstraint[2] = 9.81;
    const report = assessContacts(fixture, sample.forward, sample.force, sample.ids, sample.floor);
    expect(report.bodies.cylinder.loaded).toBe(2);
    expect(report.bodies.cylinder.supported).toBe(true);
    expect(report.contacts[0].witness.downhillRim).toBe(true);
    expect(report.contacts[1].witness.downhillRim).toBe(false);
    expect(report.bodies.cylinder.downhillRim).toBe(false);
  });

  it('does not infer rim support from an unloaded contact', () => {
    const sample = syntheticContact();
    sample.force.contacts[0].force[0] = 0;
    sample.force.efcForce[0] = 0;
    sample.force.qfrcConstraint[2] = 0;
    const report = assessContacts(fixture, sample.forward, sample.force, sample.ids, sample.floor);
    expect(report.bodies.cylinder.loaded).toBe(0);
    expect(report.bodies.cylinder.downhillRim).toBe(false);
  });
});

describe('Cylinder floor frame, full-axis tilt and implicit actuator arithmetic', () => {
  it.each([-0.4, 0, 0.4])('uses Ry(theta) and a positive Y tipping axis at theta=%s', (theta) => {
    const floor = floorFrame(theta);
    expectVector(floor.normal, [Math.sin(theta), 0, Math.cos(theta)]);
    expectVector(floor.downhill, [Math.cos(theta), 0, -Math.sin(theta)]);
    expectVector(floor.positiveTipAxis, [0, 1, 0]);
  });

  it.each([-0.1, 0.1])(
    'keeps the sign of downhill beta=%s and relative angular velocity',
    (beta) => {
      const theta = 0.2;
      const cylinder = body({ rotation: ry(theta + beta), omega: [0, 0.07, 0] });
      const tilt = tiltState(cylinder, theta, 0.02, fixture);
      expect(tilt.beta).toBeCloseTo(beta, 12);
      expect(tilt.phi).toBeCloseTo(Math.abs(beta), 12);
      expect(tilt.relativeOmegaY).toBeCloseTo(0.05, 12);
      expect(tilt.relativeOmega).toBeCloseTo(0.05, 12);
    },
  );

  it('rejects sideways tilt through full phi even when downhill beta remains zero', () => {
    const angle = radians(1);
    const cylinder = body({
      rotation: [
        1,
        0,
        0,
        0,
        Math.cos(angle),
        -Math.sin(angle),
        0,
        Math.sin(angle),
        Math.cos(angle),
      ],
    });
    const tilt = tiltState(cylinder, 0, 0, fixture);
    expect(tilt.beta).toBeCloseTo(0, 12);
    expect(tilt.phi).toBeCloseTo(angle, 12);
    const records = windowRecords();
    records[records.length - 1].post.phi = tilt.phi;
    expect(assessWindow(records, fixture, 500, target, 'stable').accepted).toBe(false);
  });

  it('distinguishes the uphill rim from the higher sideways rim', () => {
    const angle = 0.2;
    const sine = Math.sin(angle);
    const cosine = Math.cos(angle);
    const halfHeight = fixture.bodies.cylinder.heightM / 2;
    const cylinder = body({
      com: [0, -sine * halfHeight, cosine * halfHeight + 0.003],
      rotation: [1, 0, 0, 0, cosine, -sine, 0, sine, cosine],
    });
    const tilt = tiltState(cylinder, 0, 0, fixture);
    expect(tilt.uphillDirectionValid).toBe(true);
    expect(tilt.uphillRimLift).toBeCloseTo(0.003, 12);
    expect(tilt.maximumRimLift).toBeCloseTo(0.003 + 0.033 * sine, 12);
    expect(tilt.maximumRimLift).toBeGreaterThan(0.003);
  });

  it('marks the uphill direction undefined when the cylinder axis is exactly downhill', () => {
    const cylinder = body({ rotation: [0, 0, 1, 0, 1, 0, -1, 0, 0] });
    const tilt = tiltState(cylinder, 0, 0, fixture);
    expect(tilt.uphillDirectionValid).toBe(false);
    expect(tilt.uphillRimLift).toBeNull();
    expect(tilt.maximumRimLift).toBeCloseTo(0.033, 12);
    const records = windowRecords('tip');
    records[records.length - 1].post.uphillDirectionValid = false;
    records[records.length - 1].post.uphillRimLift = null;
    expect(assessWindow(records, fixture, 500, target, 'tip').accepted).toBe(false);
  });

  it('reconstructs the unsaturated implicit contribution using the velocity increment', () => {
    const { kp, kv } = fixture.stand;
    const thetaPre = 0.01;
    const omegaPre = 0.02;
    const u = thetaPre + (10 + kv * omegaPre) / kp;
    const torque = effectiveTorque(u, thetaPre, omegaPre, 0.03, 10, fixture.stand);
    expect(torque.saturated).toBe(false);
    expect(torque.effective).toBeCloseTo(7.9, 12);
    expect(torque.endpointFormula).toBeCloseTo(7.9, 10);
    expect(torque.nativeForce).toBe(10);
  });

  it.each([-32, 32])('uses D=0 at the inclusive native-force boundary %s', (nativeForce) => {
    const torque = effectiveTorque(0.1, 0.05, -0.2, 0.3, nativeForce, fixture.stand);
    expect(torque.saturated).toBe(true);
    expect(torque.effective).toBe(nativeForce);
    expect(torque.endpointFormula).toBe(nativeForce);
  });

  it.each([-1, 1])('retains the damping derivative just inside boundary sign=%s', (sign) => {
    const nativeForce = sign * (32 - 32 * Number.EPSILON);
    const torque = effectiveTorque(0, 0, 0, 0.1, nativeForce, fixture.stand);
    expect(torque.saturated).toBe(false);
    expect(torque.effective).toBeCloseTo(nativeForce - 21, 12);
  });

  it('does not add an unregistered second clamp to the implicit effective torque', () => {
    const torque = effectiveTorque(31 / 25000, 0, 0, -0.1, 31, fixture.stand);
    expect(torque.saturated).toBe(false);
    expect(torque.effective).toBeCloseTo(52, 12);
    expect(torque.nativeForce).toBe(31);
  });
});

describe('Cylinder stationary windows contain complete native intervals', () => {
  it.each([500, 250])('accepts exactly 100 ms of stable intervals at dt=%s us', (dtUs) => {
    const records = windowRecords('stable', dtUs);
    const result = assessWindow(records, fixture, dtUs, target, 'stable');
    expect(result.accepted).toBe(true);
    expect(result.intervals).toBe(100000 / dtUs);
    expect(result.durationUs).toBe(100000);
    expect(result.firstTick).toBe(101);
    expect(result.lastTick).toBe(100 + records.length);
  });

  it.each([500, 250])('uses the final endpoint in beta growth at dt=%s us', (dtUs) => {
    const records = windowRecords('tip', dtUs);
    const first = records[0];
    const last = records[records.length - 1];
    const threshold = radians(fixture.tilt.tip.minBetaGrowthDeg);
    expect(last.pre.beta - first.pre.beta).toBeLessThan(threshold);
    expect(last.post.beta - first.pre.beta).toBeGreaterThan(threshold);
    const result = assessWindow(records, fixture, dtUs, target, 'tip');
    expect(result.accepted).toBe(true);
    expect(result.growth).toBeCloseTo(last.post.beta - first.pre.beta, 14);
  });

  it.each(['empty', 'short', 'long'])('rejects an %s interval window', (kind) => {
    const records = windowRecords();
    if (kind === 'empty') records.length = 0;
    if (kind === 'short') records.pop();
    if (kind === 'long') records.push({ ...records[records.length - 1], tick: 1000 });
    expect(assessWindow(records, fixture, 500, target, 'stable')).toEqual({
      accepted: false,
      reason: 'INCOMPLETE_WINDOW',
    });
  });

  it.each(['duplicate', 'gap', 'reverse'])('rejects %s native interval identities', (kind) => {
    const records = windowRecords();
    if (kind === 'duplicate') records[50].tick = records[49].tick;
    if (kind === 'gap') records[50].tick += 1;
    if (kind === 'reverse') records.reverse();
    expect(() => assessWindow(records, fixture, 500, target, 'stable')).toThrow(
      'WINDOW_NONCONSECUTIVE',
    );
  });

  it.each(['phi', 'relativeOmega', 'theta', 'omega'] as const)(
    'rejects an invalid final endpoint %s even when every pre-state is valid',
    (field) => {
      const records = windowRecords();
      const last = records[records.length - 1].post;
      if (field === 'phi') last.phi = radians(fixture.tilt.stable.maxFullAxisAngleDeg * 2);
      if (field === 'relativeOmega')
        last.relativeOmega = fixture.tilt.stable.maxRelativeOmegaRadps * 2;
      if (field === 'theta') last.theta += radians(fixture.tilt.stable.maxTrackingDeg * 2);
      if (field === 'omega') last.omega = fixture.tilt.stable.maxFloorSpeedRadps * 2;
      expect(assessWindow(records, fixture, 500, target, 'stable').accepted).toBe(false);
    },
  );

  it('includes the last endpoint in the floor-angle range separately from tracking', () => {
    const records = windowRecords();
    const delta = radians(0.002);
    expect(delta).toBeLessThan(radians(fixture.tilt.stable.maxTrackingDeg));
    records[records.length - 1].post.theta += delta;
    const result = assessWindow(records, fixture, 500, target, 'stable');
    expect(result.range).toBeCloseTo(delta, 14);
    expect(result.accepted).toBe(false);
  });

  it.each(['loaded', 'supported', 'positiveSupport', 'noSlip'] as const)(
    'rejects a missing %s contact predicate inside either kind of window',
    (predicate) => {
      for (const type of ['stable', 'tip'] as const) {
        const records = windowRecords(type);
        records[50][predicate] = false;
        expect(assessWindow(records, fixture, 500, target, type).accepted).toBe(false);
      }
    },
  );

  it('rejects tip confirmation when any loaded interval lacks the downhill rim', () => {
    const records = windowRecords('tip');
    records[50].downhillRim = false;
    expect(assessWindow(records, fixture, 500, target, 'tip').accepted).toBe(false);
  });

  it.each(['beta', 'relativeOmegaY', 'uphillRimLift'] as const)(
    'rejects a negative final tip endpoint %s',
    (field) => {
      const records = windowRecords('tip');
      records[records.length - 1].post[field] = -0.001;
      expect(assessWindow(records, fixture, 500, target, 'tip').accepted).toBe(false);
    },
  );

  it('rejects insufficient beta growth despite valid tip state thresholds', () => {
    const records = windowRecords('tip');
    records[records.length - 1].post.beta =
      records[0].pre.beta + radians(fixture.tilt.tip.minBetaGrowthDeg / 2);
    expect(assessWindow(records, fixture, 500, target, 'tip').accepted).toBe(false);
  });

  it('rejects a fractional interval count and an unrecognized window type', () => {
    const records = windowRecords();
    expect(() => assessWindow(records, fixture, 333, target, 'stable')).toThrow(
      'WINDOW_INTEGER_COUNT',
    );
    expect(() => assessWindow(records, fixture, 500, target, 'other')).toThrow('WINDOW_TYPE');
  });
});

describe('Cylinder retained journal and ring contracts without physics', () => {
  it('writes U32LE record framing and returns the SHA256 of the actual retained bytes', () => {
    withJournal(131072, (journal, path) => {
      const a = { kind: 'tick', tick: 1, value: -0 };
      const b = { kind: 'tick', tick: 2, value: NaN };
      journal.append(a);
      journal.append(b);
      const trailer = { kind: 'finish', ticks: 2 };
      const result = journal.finish(trailer);
      const bytes = readFileSync(path);
      const payloads = framedPayloads(bytes);
      expect(payloads).toHaveLength(4);
      expect(payloads[1].equals(canonicalBytes(a))).toBe(true);
      expect(payloads[2].equals(canonicalBytes(b))).toBe(true);
      expect(payloads[3].equals(canonicalBytes(trailer))).toBe(true);
      expect(result.bytes).toBe(bytes.length);
      expect(result.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
      expect(result.trailerError).toBeNull();
      expect(journal.finish({ kind: 'ignored-second-finish' })).toBe(result);
      expect(readFileSync(path).equals(bytes)).toBe(true);
      expect(() => journal.append(a)).toThrow('RAW_JOURNAL_CLOSED');
    });
  });

  it('preserves the committed prefix at the ordinary byte cap and uses the failure reserve', () => {
    withJournal(65536 + 4096, (journal, path) => {
      const overhead = 4 + canonicalBytes({ kind: 'padding', bytes: Buffer.alloc(0) }).length;
      const size = journal.limit - journal.reserve - journal.bytes - overhead;
      expect(size).toBeGreaterThan(0);
      journal.append({ kind: 'padding', bytes: Buffer.alloc(size, 0x5a) });
      expect(journal.bytes).toBe(journal.limit - journal.reserve);
      const prefix = readFileSync(path);
      expect(() => journal.append({ kind: 'overflow' })).toThrow('RESOURCE_JOURNAL_BYTE_CAP');
      expect(readFileSync(path).equals(prefix)).toBe(true);
      const failure = { kind: 'failure', reason: 'RESOURCE_JOURNAL_BYTE_CAP', tick: 7 };
      const result = journal.finish(failure);
      const bytes = readFileSync(path);
      expect(bytes.subarray(0, prefix.length).equals(prefix)).toBe(true);
      expect(framedPayloads(bytes).at(-1)?.equals(canonicalBytes(failure))).toBe(true);
      expect(result.trailerError).toBeNull();
      expect(bytes.length).toBeLessThanOrEqual(journal.limit);
    });
  });

  it('reports an oversized failure trailer and retains its complete existing prefix', () => {
    withJournal(65536 + 4096, (journal, path) => {
      const prefix = readFileSync(path);
      const result = journal.finish({ kind: 'failure', bytes: Buffer.alloc(journal.limit) });
      expect(result.trailerError).toContain('RESOURCE_JOURNAL_BYTE_CAP');
      expect(journal.closed).toBe(true);
      expect(readFileSync(path).equals(prefix)).toBe(true);
      expect(result.bytes).toBe(prefix.length);
      expect(result.sha256).toBe(createHash('sha256').update(prefix).digest('hex'));
    });
  });

  it('retains chronological wrapped windows and freezes the first event and its post horizon', () => {
    const memory = memoryRetention();
    for (let tick = 1; tick <= 5; tick += 1) memory.retained.retain({ tick, value: tick });
    memory.retained.event(5, { type: 'tip' }, { tick: 5 });
    expect(memory.records.filter((r) => r.kind === 'pre-event-tick').map((r) => r.tick)).toEqual([
      3, 4, 5,
    ]);
    for (let tick = 6; tick <= 8; tick += 1) memory.retained.retain({ tick, value: tick });
    expect(memory.records.filter((r) => r.kind === 'post-event-tick').map((r) => r.tick)).toEqual([
      6, 7,
    ]);
    expect(memory.retained.chain.checkpoint().ticks).toBe(8);
    expect(() => memory.retained.event(8, { type: 'replacement' }, { tick: 8 })).toThrow(
      'FIRST_EVENT_ALREADY_FROZEN',
    );
    expect(memory.retained.firstEventTick).toBe(5);
    memory.retained.failure(8, { finite: false }, new Error('synthetic failure'));
    const size = memory.records.length;
    memory.retained.failure(9, { finite: true }, new Error('must not replace first failure'));
    expect(memory.records).toHaveLength(size);
    expect(memory.records.filter((r) => r.kind === 'pre-failure-tick').map((r) => r.tick)).toEqual([
      6, 7, 8,
    ]);
    expect(memory.records.filter((r) => r.kind === 'failure')).toHaveLength(1);
    expect(memory.getCheckpoints()).toBe(3);
  });

  it('hashes a prepared tick once and inserts it into the ring only after retain', () => {
    const memory = memoryRetention();
    const record = { tick: 1, value: -0 };
    const prepared = memory.retained.prepare(record);
    expect(prepared.equals(canonicalBytes(record))).toBe(true);
    expect(memory.retained.chain.checkpoint().ticks).toBe(1);
    expect(memory.retained.size).toBe(0);
    memory.retained.retain(record, prepared);
    expect(memory.retained.chain.checkpoint().ticks).toBe(1);
    expect(memory.retained.size).toBe(1);
    expect(memory.retained.ring[0].bytes.equals(prepared)).toBe(true);
  });

  it('rejects an oversized tick before advancing its digest chain or ring', () => {
    const memory = memoryRetention(64);
    const before = memory.retained.chain.checkpoint();
    expect(() => memory.retained.retain({ tick: 1, bytes: Buffer.alloc(64) })).toThrow(
      'RESOURCE_TICK_BYTE_CAP',
    );
    expect(memory.retained.chain.checkpoint()).toEqual(before);
    expect(memory.retained.lastTickDigest).toBeNull();
    expect(memory.retained.size).toBe(0);
    expect(memory.records).toHaveLength(0);
  });

  it('rejects a ring that exceeds its tick cap or has a fractional native interval count', () => {
    const memory = memoryRetention();
    for (const preWindowUs of [2000, 1501]) {
      const bad = {
        ...memory.mini,
        retention: { ...memory.mini.retention, preWindowUs },
      };
      expect(() => new TickRetention(memory.journal, bad, 'synthetic-world', 500)).toThrow(
        'RESOURCE_RING_COUNT',
      );
    }
  });
});

describe('Cylinder registered plans and authored model text without native initialization', () => {
  it('validates the exact fixture bytes and the complete emergency retention allowance', () => {
    const readback = readCylinderFixture();
    expect(validateCylinderFixture(readback.fixture)).toEqual(fixture);
    expect(readback.fixtureSha256).toBe(
      createHash('sha256')
        .update(readFileSync(new URL('./mujoco-cylinder.fixture.json', import.meta.url)))
        .digest('hex'),
    );
    const retention = fixture.retention;
    const required =
      retention.maxSimultaneouslyLiveWorlds *
        (retention.maxRingTicks *
          (retention.maxTickBytes + retention.emergencyRecordOverheadBytes) +
          retention.maxFailureObservationBytes +
          retention.emergencyRecordOverheadBytes) +
      retention.emergencyTrailerBytes;
    expect(retention.reservedFailureTrailerBytes).toBe(41551872);
    expect(retention.reservedFailureTrailerBytes).toBeGreaterThanOrEqual(required);
    expect(retention.reservedFailureTrailerBytes).toBeLessThan(retention.maxJournalBytes);
  });

  it.each(['step', 'solver', 'force', 'retention'])(
    'rejects an altered registered %s contract before constructing model text',
    (mutation) => {
      const changed = structuredClone(fixture);
      if (mutation === 'step') changed.nativeStepUs[0] = 1000;
      if (mutation === 'solver') changed.solver.sleep = true;
      if (mutation === 'force') changed.stand.forceRangeNm[1] = 64;
      if (mutation === 'retention') changed.retention.maxTickBytes += 1;
      expect(() => validateCylinderFixture(changed)).toThrow(
        'CYLINDER_REGISTERED_CONTRACT_MISMATCH',
      );
    },
  );

  it('derives exactly eight admission worlds and 40200 permitted advances', () => {
    const plan = cylinderPlan(fixture, 'admission');
    expect(plan).toHaveLength(8);
    expect(new Set(plan.map((entry: PlanEntry) => entry.id)).size).toBe(8);
    expect(plan.filter((entry: PlanEntry) => entry.probe === 'A')).toHaveLength(4);
    expect(plan.filter((entry: PlanEntry) => entry.probe === 'B')).toHaveLength(4);
    expect(plan.reduce((sum: number, entry: PlanEntry) => sum + entry.maxSteps, 0)).toBe(40200);
    expect(Math.max(...plan.map((entry: PlanEntry) => entry.maxSteps))).toBe(13000);
    expect(plan.filter((entry: PlanEntry) => entry.phase === 'full')).toHaveLength(4);
  });

  it('derives twelve main worlds and the 7542000-step ceiling without hidden replays', () => {
    const plan = cylinderPlan(fixture, 'main');
    expect(plan).toHaveLength(12);
    expect(new Set(plan.map((entry: PlanEntry) => entry.id)).size).toBe(12);
    expect(plan.filter((entry: PlanEntry) => entry.kind === 'static')).toHaveLength(4);
    expect(plan.filter((entry: PlanEntry) => entry.kind === 'tilt')).toHaveLength(8);
    expect(plan.every((entry: PlanEntry) => entry.phase === 'split')).toBe(true);
    expect(plan.reduce((sum: number, entry: PlanEntry) => sum + entry.maxSteps, 0)).toBe(7542000);
    expect(Math.max(...plan.map((entry: PlanEntry) => entry.maxSteps))).toBe(1508000);
    expect(() => cylinderPlan(fixture, 'automatic')).toThrow('CYLINDER_EXPLICIT_MODE_REQUIRED');
  });

  it('keeps the static and hinge-prefixed qpos/qvel address layouts distinct', () => {
    const plan = cylinderPlan(fixture, 'admission');
    const rest = plan.find((entry: PlanEntry) => entry.probe === 'A');
    const tilt = plan.find((entry: PlanEntry) => entry.probe === 'B');
    if (!rest || !tilt) throw new Error('Missing registered admission worlds');
    const restIds = worldIds(fixture, rest);
    const tiltIds = worldIds(fixture, tilt);
    expect(restIds.geomBodies).toEqual([0, 1, 2]);
    expect(
      restIds.freeBodies.map((shape: { qposAdr: number; dofAdr: number }) => [
        shape.qposAdr,
        shape.dofAdr,
      ]),
    ).toEqual([
      [0, 0],
      [7, 6],
    ]);
    expect(tiltIds.geomBodies).toEqual([1, 2]);
    expect(tiltIds.floorBody).toBe(1);
    expect(tiltIds.freeBodies).toHaveLength(1);
    expect(tiltIds.freeBodies[0]).toMatchObject({ bodyId: 2, geomId: 1, qposAdr: 1, dofAdr: 1 });
    expectVector(
      blockInertia(fixture),
      [0.00014166666666666668, 0.0004541666666666668, 0.0005208333333333334],
      14,
    );
  });

  it.each(['static', 'tilt'] as const)(
    'accepts declared %s geometry and joint address readback without constructing a model',
    (kind) => {
      const condition = cylinderPlan(fixture, 'admission').find(
        (entry: PlanEntry) => entry.kind === kind,
      );
      if (!condition) throw new Error('Missing registered geometry world');
      const readback = geometryReadback(kind);
      expect(validateGeometryReadback(fixture, condition, readback)).toBe(true);
    },
  );

  it.each([
    ['radius', 'MODEL_GEOM_SIZE_FRAME'],
    ['collider offset', 'MODEL_GEOM_SIZE_FRAME'],
    ['parent', 'MODEL_BODY_TOPOLOGY_OR_FRAME'],
    ['dof address', 'MODEL_FREE_BODY_DOF_LAYOUT'],
  ])('rejects an incorrect %s even when every declared body mass is correct', (mutation, error) => {
    for (const kind of ['static', 'tilt'] as const) {
      const condition = cylinderPlan(fixture, 'admission').find(
        (entry: PlanEntry) => entry.kind === kind,
      );
      if (!condition) throw new Error('Missing registered geometry world');
      const readback = geometryReadback(kind);
      const masses = readback.body_mass.slice();
      const cylinderBody = kind === 'tilt' ? 2 : 1;
      if (mutation === 'radius') readback.geom_size[3] += 0.001;
      if (mutation === 'collider offset') readback.geom_pos[3] = 0.001;
      if (mutation === 'parent') readback.body_parentid[cylinderBody] = kind === 'tilt' ? 1 : 2;
      if (mutation === 'dof address') readback.body_dofadr[cylinderBody] += 1;
      expect(readback.body_mass).toEqual(masses);
      expect(() => validateGeometryReadback(fixture, condition, readback)).toThrow(error);
    }
  });

  it.each(['A', 'B'])(
    'authors the registered native flags and zero passive defaults for %s',
    (probe) => {
      const condition = cylinderPlan(fixture, 'admission').find(
        (entry: PlanEntry) =>
          entry.probe === probe && entry.dtUs === 500 && entry.phase === 'split',
      );
      if (!condition) throw new Error('Missing registered admission world');
      const xml = makeCylinderXml(fixture, condition);
      expect(xmlElements(xml, 'compiler')[0]).toMatchObject({
        angle: 'radian',
        inertiafromgeom: 'false',
        autolimits: 'false',
      });
      expect(xmlElements(xml, 'option')[0]).toMatchObject({
        timestep: '0.0005',
        integrator: 'implicitfast',
        solver: 'Newton',
        jacobian: 'dense',
        cone: 'elliptic',
        density: '0',
        viscosity: '0',
        wind: '0 0 0',
      });
      expect(xmlElements(xml, 'flag')[0]).toMatchObject({
        diagexact: 'enable',
        nativeccd: 'disable',
        multiccd: 'enable',
        sleep: 'disable',
        autoreset: 'disable',
        override: 'disable',
        ipc: 'disable',
        speculative: 'disable',
      });
      expect(xmlElements(xml, 'joint')[0]).toEqual({
        damping: '0',
        frictionloss: '0',
        armature: '0',
        stiffness: '0',
        limited: 'false',
      });
      for (const joint of xmlElements(xml, 'joint')) expect(joint.limited).toBe('false');
      for (const pair of xmlElements(xml, 'pair')) {
        expect(pair).toMatchObject({ margin: '0', gap: '0', condim: '3', friction: '1 1 0 0 0' });
      }
      expect(xml).not.toMatch(/<(?:equality|weld|plugin|sensor)\b/);
      expect(() =>
        makeCylinderXml(fixture, { ...condition, maxSteps: condition.maxSteps + 1 }),
      ).toThrow('CYLINDER_UNREGISTERED_WORLD');
    },
  );

  it('authors exactly one native position actuator with the registered force and control limits', () => {
    const condition = cylinderPlan(fixture, 'admission').find(
      (entry: PlanEntry) => entry.probe === 'B',
    );
    if (!condition) throw new Error('Missing registered B world');
    const actuators = xmlElements(makeCylinderXml(fixture, condition), 'position');
    expect(actuators).toHaveLength(1);
    expect(actuators[0]).toMatchObject({
      joint: 'floor_hinge',
      gear: '1',
      kp: '25000',
      kv: '210',
      forcelimited: 'true',
      forcerange: '-32 32',
      ctrllimited: 'true',
      ctrlrange: '0 0.6283185307179586',
    });
    expect(actuators[0]).not.toHaveProperty('timeconst');
    expect(actuators[0]).not.toHaveProperty('dampratio');
  });

  it('places the A probe velocities in an authored keyframe and omits it from main rest worlds', () => {
    const condition = cylinderPlan(fixture, 'admission')[0];
    const keys = xmlElements(makeCylinderXml(fixture, condition), 'key');
    expect(keys).toHaveLength(1);
    expect(keys[0].qvel.split(' ').map(Number)).toEqual([
      0.01, 0, 0, 0, 0, 0.2, -0.005, 0, 0, 0, 0, -0.1,
    ]);
    expect(
      xmlElements(makeCylinderXml(fixture, cylinderPlan(fixture, 'main')[0]), 'key'),
    ).toHaveLength(0);
  });

  it('samples target-one quintic control at the integer left endpoint and enters the full hold', () => {
    const condition = cylinderPlan(fixture, 'admission').find(
      (entry: PlanEntry) => entry.probe === 'B' && entry.dtUs === 500 && entry.phase === 'split',
    );
    if (!condition) throw new Error('Missing registered B world');
    const start = 2000000 / 500;
    expect(controlAt(fixture, condition, start - 1)).toMatchObject({
      u: 0,
      stage: 0,
      phase: 'SETTLING',
    });
    expect(controlAt(fixture, condition, start)).toMatchObject({
      u: 0,
      stage: 1,
      phase: 'RAMP',
      target: fixture.tilt.targetStepRad,
      stageEndUs: 3250000,
    });
    const quarter = start + 62500 / 500;
    const quarterValue = fixture.tilt.targetStepRad * 0.103515625;
    expect(controlAt(fixture, condition, quarter).u).toBeCloseTo(quarterValue, 15);
    expect(controlAt(fixture, condition, quarter - 1).u).toBeLessThan(quarterValue);
    expect(controlAt(fixture, condition, quarter + 1).u).toBeGreaterThan(quarterValue);
    expect(controlAt(fixture, condition, start + 125000 / 500).u).toBeCloseTo(
      fixture.tilt.targetStepRad / 2,
      15,
    );
    expect(controlAt(fixture, condition, start + 250000 / 500)).toMatchObject({
      u: fixture.tilt.targetStepRad,
      stage: 1,
      phase: 'HOLD',
      stageEndUs: 3250000,
    });
    expect(controlAt(fixture, condition, condition.maxSteps - 1)).toMatchObject({
      u: fixture.tilt.targetStepRad,
      stage: 1,
      phase: 'HOLD',
    });
    for (const invalid of [-1, 0.5, NaN, Infinity]) {
      expect(() => controlAt(fixture, condition, invalid)).toThrow('CONTROL_INTEGER_TICK');
    }
  });

  it('fits a complete eligible 4-cylinder-plus-4-block contact tick within the registered byte cap', () => {
    const record = eightContactTick();
    expect(record.nativeCounts).toMatchObject({ ncon: 8, nefc: 24, nisland: 2 });
    expect(record.parity.contacts).toHaveLength(8);
    expect(record.parity.solved).toHaveLength(8);
    expect(record.contact.bodies.cylinder.loaded).toBe(4);
    expect(record.contact.bodies.block.loaded).toBe(4);
    for (const contact of record.parity.contacts) {
      expect(contact.surfacevel).toHaveLength(3);
      expect(contact).not.toHaveProperty('H');
      expect(contact).not.toHaveProperty('mu');
    }
    for (const solved of record.parity.solved) {
      expect(solved.H).toHaveLength(36);
      expect(solved.force).toHaveLength(6);
      expect(solved).toHaveProperty('mu');
    }
    const bytes = canonicalBytes(record);
    expect(bytes.length, 'Full eligible A/rest record bytes: ' + bytes.length).toBeLessThanOrEqual(
      fixture.retention.maxTickBytes,
    );
  });
});

describe('Static observer phase labels', () => {
  it('changes from settling to rest at the exact integer boundary and names admission A separately', () => {
    const rest = cylinderPlan(fixture, 'main').find((p: { kind: string }) => p.kind === 'static');
    const boundary = fixture.rest.settleUs / rest.dtUs;
    expect(controlAt(fixture, rest, boundary - 1).phase).toBe('SETTLING');
    expect(controlAt(fixture, rest, boundary).phase).toBe('REST_MEASUREMENT');
    const probe = cylinderPlan(fixture, 'admission')[0];
    expect(controlAt(fixture, probe, 0).phase).toBe('ADMISSION_A');
  });
});

// Frozen aaf8427f canonical byte oracle. Only TypeScript annotations and the
// local function names differ; the encoding algorithm and error order remain.
// The external pure proof also imports the entire original module byte-exact
// (SHA256 dd22ed00fc47a68cce8c27f4c1e82145b0f6d26b2924908a9f42317115726a8c).
function baselineDemand(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function baselineCanonicalBytes(value: unknown): Buffer {
  let out = Buffer.allocUnsafe(4096);
  let at = 0;
  const room = (n: number) => {
    if (at + n <= out.length) return;
    const next = Buffer.allocUnsafe(Math.max(out.length * 2, at + n));
    out.copy(next, 0, 0, at);
    out = next;
  };
  const tag = (n: number) => {
    room(1);
    out[at++] = n;
  };
  const u32 = (n: number) => {
    baselineDemand(Number.isSafeInteger(n) && n >= 0 && n <= 0xffffffff, 'RAW_LENGTH');
    room(4);
    out.writeUInt32LE(n, at);
    at += 4;
  };
  const write = (v: unknown): void => {
    if (v === null) return tag(0);
    if (v === false) return tag(1);
    if (v === true) return tag(2);
    if (typeof v === 'number') {
      tag(3);
      room(8);
      if (Number.isNaN(v)) out.writeBigUInt64LE(0x7ff8000000000000n, at);
      else out.writeDoubleLE(v, at);
      at += 8;
      return;
    }
    if (typeof v === 'string' || Buffer.isBuffer(v)) {
      tag(typeof v === 'string' ? 4 : 7);
      const bytes = typeof v === 'string' ? Buffer.from(v, 'utf8') : v;
      u32(bytes.length);
      room(bytes.length);
      bytes.copy(out, at);
      at += bytes.length;
      return;
    }
    if (Array.isArray(v) || ArrayBuffer.isView(v)) {
      tag(5);
      const sequence = v as { length: number } & Iterable<unknown>;
      u32(sequence.length);
      for (const x of sequence) write(x);
      return;
    }
    baselineDemand(v && typeof v === 'object', 'RAW_UNSUPPORTED_TYPE ' + typeof v);
    const keys = Object.keys(v).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
    tag(6);
    u32(keys.length);
    for (const key of keys) {
      write(key);
      write((v as Record<string, unknown>)[key]);
    }
  };
  write(value);
  // Ring bytes own exactly their payload allocation, not an oversized backing
  // buffer retained by subarray. This makes the registered RAM bound literal.
  return Buffer.from(out.subarray(0, at));
}

type EqualityInput = (trace: string[]) => [unknown, unknown];

function equalityObservation(compare: (a: unknown, b: unknown) => boolean, make: EqualityInput) {
  const trace: string[] = [];
  const [a, b] = make(trace);
  try {
    return { result: compare(a, b), trace };
  } catch (error) {
    return {
      error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
      trace,
    };
  }
}

describe('Bounded observer candidate preserves the aaf8427f byte contract', () => {
  const baselineEqual = (a: unknown, b: unknown) =>
    baselineCanonicalBytes(a).equals(baselineCanonicalBytes(b));

  it.each([
    { name: 'two numbers', a: [1, 2], b: [1, 2] },
    { name: 'three numbers', a: [1, 2, 3], b: [1, 2, 4] },
    { name: 'five numbers', a: [1, 2, 3, 4, 5], b: [1, 2, 3, 4, 5] },
    { name: 'positive and negative zero', a: [0, 2], b: [-0, 2] },
    { name: 'equal signed zeros', a: [-0, 0], b: [-0, 0] },
    { name: 'canonical NaNs', a: [NaN, 2], b: [NaN, 2] },
    { name: 'infinities', a: [Infinity, -Infinity], b: [Infinity, -Infinity] },
    { name: 'different infinities', a: [Infinity, 2], b: [-Infinity, 2] },
    { name: 'subnormal', a: [Number.MIN_VALUE, -Number.MIN_VALUE], b: [0, -0] },
    { name: 'different eligible lengths', a: [1, 2], b: [1, 2, 3] },
    { name: 'empty fallback', a: [], b: [] },
    { name: 'four-number fallback', a: [1, 2, 3, 4], b: [1, 2, 3, 4] },
  ])('number vectors: $name', ({ a, b }) => {
    expect(numberVectorEqual(a, b)).toBe(baselineEqual(a, b));
  });

  const fallbackCases: Array<{ name: string; make: EqualityInput }> = [
    {
      name: 'later unsupported left value',
      make: () => [
        [0, undefined],
        [1, 2],
      ],
    },
    {
      name: 'later unsupported right value and different length',
      make: () => [
        [0, 1],
        [2, 3, 1n],
      ],
    },
    { name: 'sparse array', make: () => [new Array(2), [0, 0]] },
    { name: 'bytes versus numbers', make: () => [Buffer.from([1, 2]), [1, 2]] },
    { name: 'numeric typed arrays', make: () => [new Float64Array([NaN, -0]), [NaN, -0]] },
    { name: 'bigint typed array', make: () => [new BigInt64Array([1n, 2n]), [1, 2]] },
    { name: 'DataView error', make: () => [new DataView(new ArrayBuffer(8)), []] },
    { name: 'string UTF8 collision', make: () => ['\uD800', '\uFFFD'] },
    {
      name: 'array subclass',
      make: () => {
        class NumericArray extends Array<number> {}
        return [new NumericArray(1, 2), [1, 2]];
      },
    },
    {
      name: 'index getter order',
      make: (trace) => {
        const a = [1, 2];
        const b = [1, 2];
        Object.defineProperty(a, '1', {
          get: () => {
            trace.push('a1');
            return 2;
          },
        });
        Object.defineProperty(b, '0', {
          get: () => {
            trace.push('b0');
            return 1;
          },
        });
        return [a, b];
      },
    },
    {
      name: 'throwing late getter',
      make: (trace) => {
        const a = [0, 2];
        Object.defineProperty(a, '1', {
          get: () => {
            trace.push('throw');
            throw new Error('late getter');
          },
        });
        return [a, [1, 2]];
      },
    },
    {
      name: 'ignored extra getter',
      make: (trace) => {
        const a = [1, 2];
        Object.defineProperty(a, 'extra', {
          get: () => {
            trace.push('must not read');
            return 9;
          },
        });
        return [a, [1, 2]];
      },
    },
    {
      name: 'custom iterator',
      make: (trace) => {
        const a = [1, 2];
        a[Symbol.iterator] = function* () {
          trace.push('iterate');
          yield 9;
          yield 8;
        };
        return [a, [9, 8]];
      },
    },
    {
      name: 'iterator getter',
      make: (trace) => {
        const a = [1, 2];
        Object.defineProperty(a, Symbol.iterator, {
          get: () => {
            trace.push('iterator getter');
            return function* () {
              yield 4;
              yield 5;
            };
          },
        });
        return [a, [4, 5]];
      },
    },
    {
      name: 'proxy trap order',
      make: (trace) => [
        new Proxy([1, 2], {
          get: (target, key, receiver) => {
            trace.push('get:' + String(key));
            return Reflect.get(target, key, receiver);
          },
          ownKeys: (target) => {
            trace.push('ownKeys');
            return Reflect.ownKeys(target);
          },
          getPrototypeOf: (target) => {
            trace.push('prototype');
            return Reflect.getPrototypeOf(target);
          },
          getOwnPropertyDescriptor: (target, key) => {
            trace.push('descriptor:' + String(key));
            return Reflect.getOwnPropertyDescriptor(target, key);
          },
        }),
        [1, 2],
      ],
    },
    {
      name: 'revoked proxy',
      make: () => {
        const value = Proxy.revocable([1, 2], {});
        value.revoke();
        return [value.proxy, [1, 2]];
      },
    },
  ];

  it.each(fallbackCases)('original fallback and error trace: $name', ({ make }) => {
    expect(equalityObservation(numberVectorEqual, make)).toEqual(
      equalityObservation(baselineEqual, make),
    );
  });

  it('falls back when the ordinary array iterator is replaced', () => {
    const descriptor = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator)!;
    let actual: boolean | undefined;
    let expected: boolean | undefined;
    try {
      Object.defineProperty(Array.prototype, Symbol.iterator, {
        ...descriptor,
        value: function (this: unknown[]) {
          let i = 0;
          const length = this.length;
          return {
            next: () =>
              i++ < length ? { done: false, value: 0 } : { done: true, value: undefined },
          };
        },
      });
      actual = numberVectorEqual([1, 2], [3, 4]);
      expected = baselineEqual([1, 2], [3, 4]);
    } finally {
      Object.defineProperty(Array.prototype, Symbol.iterator, descriptor);
    }
    expect(actual).toBe(true);
    expect(actual).toBe(expected);
  });

  it('falls back when the array iterator next method is replaced', () => {
    const prototype = Object.getPrototypeOf([][Symbol.iterator]());
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'next')!;
    const next = descriptor.value as (this: unknown) => IteratorResult<unknown>;
    let actual: boolean | undefined;
    let expected: boolean | undefined;
    try {
      Object.defineProperty(prototype, 'next', {
        ...descriptor,
        value: function (this: unknown) {
          const result = Reflect.apply(next, this, []);
          return result.done ? result : { done: false, value: 0 };
        },
      });
      actual = numberVectorEqual([1, 2], [3, 4]);
      expected = baselineEqual([1, 2], [3, 4]);
    } finally {
      Object.defineProperty(prototype, 'next', descriptor);
    }
    expect(actual).toBe(true);
    expect(actual).toBe(expected);
  });

  it('retains stable UTF8 ordering ties for malformed surrogate keys', () => {
    for (const keys of [
      ['\uD800', '\uD801', '\uFFFD', 'a', 'é', '😀'],
      ['\uFFFD', '\uD801', '\uD800', '😀', 'é', 'a'],
    ]) {
      const value: Record<string, unknown> = Object.create(null);
      keys.forEach((key, i) => {
        value[key] = { value: i, nested: [NaN, -0] };
      });
      expect(canonicalBytes(value)).toEqual(baselineCanonicalBytes(value));
    }
    const a = { ['\uD800']: 1, ['\uD801']: 2 };
    const b = { ['\uD801']: 2, ['\uD800']: 1 };
    expect(canonicalEqual(a, b)).toBe(false);
    expect(canonicalEqual(a, b)).toBe(baselineEqual(a, b));
  });

  it('preserves object getters and key/value framing', () => {
    const make = (trace: string[]) => ({
      get z() {
        trace.push('z');
        return ['ab', 'c'];
      },
      get a() {
        trace.push('a');
        return Buffer.from([0, 255]);
      },
      ['\uD800']: 'value',
    });
    const trace: string[] = [];
    const oldTrace: string[] = [];
    expect(canonicalBytes(make(trace))).toEqual(baselineCanonicalBytes(make(oldTrace)));
    expect(trace).toEqual(oldTrace);
    expect(canonicalBytes({ a: 'bc' })).not.toEqual(canonicalBytes({ ab: 'c' }));
  });

  it('keeps a saturated cache bounded and all uncached bytes exact', () => {
    for (let i = 0; i < 768; i += 1) {
      const key = 'candidate-cache-' + i + '-'.repeat(i % 90);
      const value = { [key]: [i, -0, NaN], ['\uD800']: i, ['\uD801']: -i };
      expect(canonicalBytes(value)).toEqual(baselineCanonicalBytes(value));
    }
    const before = canonicalKeyCacheUsage();
    const oversized = { ['x'.repeat(257)]: 1, ['\uD800'.repeat(257)]: 2 };
    expect(canonicalBytes(oversized)).toEqual(baselineCanonicalBytes(oversized));
    const usage = canonicalKeyCacheUsage();
    expect(usage).toEqual(before);
    expect(usage.entries).toBeLessThanOrEqual(256);
    expect(usage.payloadBytes).toBeLessThanOrEqual(16384);
    expect(usage.retainedBackingBytes).toBe(usage.payloadBytes);
    expect(usage.stringCodeUnits).toBeLessThanOrEqual(usage.payloadBytes);
    expect(usage.unpooled).toBe(true);
    expect(Object.isFrozen(usage)).toBe(true);
  });

  it('never exposes cached bytes through returned canonical payloads', () => {
    const value = { 'private-key-payload': [1, -0, NaN] };
    const bytes = canonicalBytes(value);
    bytes.fill(0);
    expect(canonicalBytes(value)).toEqual(baselineCanonicalBytes(value));
    expect(
      Object.values(canonicalKeyCacheUsage()).every(
        (v) => typeof v === 'number' || typeof v === 'boolean',
      ),
    ).toBe(true);
  });
});

// All inputs below are SYNTHETIC_GEOMETRY_UNIT_INPUT. They are neither native
// contacts nor the sealed401 history. The real CLI accepts only the sealed hash.
function syntheticGeometryInputs(count = fixture.geometryOnly.poseCount) {
  const poses = Array.from({ length: count }, (_, index) => {
    const qpos = [0, 0, -0, fixture.bodies.cylinder.heightM / 2 - 0.00001, 1, 0, 0, 0];
    const tick = fixture.geometryOnly.firstTick + index;
    const time = (tick - 1) * 0.0005;
    return {
      tick,
      intervalStartUs: (tick - 1) * 500,
      qpos,
      time,
      sourceRecordSha256: '1'.repeat(64),
      words: { qpos: float64Words(qpos), time: float64Words([time]) },
    };
  });
  return { inputSha256: fixture.geometryOnly.inputSha256, poses };
}

function syntheticGeometryDocument() {
  const input = syntheticGeometryInputs();
  const g = fixture.geometryOnly;
  const document = {
    schema: g.inputSchema,
    world: g.world,
    first: g.firstTick,
    last: g.lastTick,
    count: g.poseCount,
    origin: 'SYNTHETIC_GEOMETRY_UNIT_INPUT',
    records: input.poses.map((pose) => ({
      tick: pose.tick,
      intervalStartUs: pose.intervalStartUs,
      recordBytes: 1000,
      recordSha256: pose.sourceRecordSha256,
      preState: { qpos: pose.qpos, qvel: new Array(7).fill(0), time: pose.time },
      preStateFloat64LE: { ...pose.words, qvel: float64Words(new Array(7).fill(0)) },
    })),
  };
  const bind = (value = document) => {
    const bytes = Buffer.from(JSON.stringify(value));
    return {
      bytes,
      binding: {
        ...g,
        inputBytes: bytes.length,
        inputSha256: createHash('sha256').update(bytes).digest('hex'),
      },
    };
  };
  return { document, bind };
}

function syntheticGeometryModel() {
  const f = fixture;
  const s = f.solver;
  const zeros = (n: number) => new Array(n).fill(0);
  return {
    ...geometryReadback('tilt'),
    nq: 8,
    nv: 7,
    na: 0,
    nu: 1,
    nbody: 3,
    ngeom: 2,
    njnt: 2,
    ntree: 2,
    npair: 1,
    nkey: 0,
    nsensor: 0,
    nplugin: 0,
    neq: 0,
    nflex: 0,
    ntendon: 0,
    nmocap: 0,
    body_mass: [0, f.stand.massKg, f.bodies.cylinder.massKg],
    body_inertia: [...zeros(3), ...f.stand.inertiaKgM2, ...f.bodies.cylinder.inertiaKgM2],
    body_gravcomp: zeros(3),
    geom_type: [6, 5],
    geom_friction: [...f.contact.geomFriction, ...f.contact.geomFriction],
    geom_condim: [3, 3],
    geom_margin: zeros(2),
    geom_gap: zeros(2),
    geom_solref: [...f.contact.solref, ...f.contact.solref],
    geom_solimp: [...f.contact.solimp, ...f.contact.solimp],
    geom_adhesion: zeros(2),
    geom_surfacevel: zeros(12),
    pair_adhesion: [0],
    jnt_type: [3, 0],
    jnt_axis: [0, 1, 0, 0, 0, 1],
    jnt_limited: [0, 0],
    jnt_stiffness: [0, 0],
    dof_damping: zeros(7),
    dof_dampingpoly: zeros(14),
    dof_frictionloss: zeros(7),
    dof_armature: zeros(7),
    pair_dim: [3],
    pair_geom1: [0],
    pair_geom2: [1],
    pair_friction: [...f.contact.pairFriction],
    pair_margin: [0],
    pair_gap: [0],
    pair_solref: [...f.contact.solref],
    pair_solreffriction: [...f.contact.solreffriction],
    pair_solimp: [...f.contact.solimp],
    actuator_gear: [1, 0, 0, 0, 0, 0],
    actuator_gainprm: [f.stand.kp, ...zeros(9)],
    actuator_biasprm: [0, -f.stand.kp, -f.stand.kv, ...zeros(7)],
    actuator_dynprm: zeros(10),
    actuator_dyntype: [0],
    actuator_gaintype: [0],
    actuator_biastype: [1],
    actuator_ctrllimited: [1],
    actuator_forcelimited: [1],
    actuator_ctrlrange: [...f.stand.ctrlRangeRad],
    actuator_forcerange: [...f.stand.forceRangeNm],
    actuator_trnid: [0, -1],
    actuator_trntype: [0],
    actuator_damping: [0],
    actuator_dampingpoly: [0, 0],
    actuator_delay: [0],
    actuator_armature: [0],
    opt: {
      timestep: 0.0005,
      integrator: 3,
      solver: 2,
      jacobian: 0,
      cone: 1,
      iterations: s.iterations,
      tolerance: s.tolerance,
      ls_iterations: s.lsIterations,
      ls_tolerance: s.lsTolerance,
      noslip_iterations: s.noSlipIterations,
      noslip_tolerance: s.noSlipTolerance,
      impratio: s.impratio,
      ccd_iterations: s.ccdIterations,
      ccd_tolerance: s.ccdTolerance,
      disableflags: 196608,
      enableflags: 32,
      density: 0,
      viscosity: 0,
      disableactuator: 0,
      gravity: [...f.gravity],
      wind: [0, 0, 0],
    },
    delete() {
      /* synthetic ownership spy replaces this method */
    },
  };
}

function syntheticGeometryObservation(qpos: number[], count = 5) {
  const floor = floorFrame(qpos[0]);
  const rotation = quaternionMatrix(qpos.slice(4));
  const com = qpos.slice(1, 4);
  const center = rotate(floor.rotation, fixture.stand.com);
  const depth = 0.00001;
  const contacts = Array.from({ length: count }, (_, index) => ({
    index,
    dist: -depth,
    includemargin: 0,
    dim: 3,
    geom1: 0,
    geom2: 1,
    exclude: 0,
    efc_address: index * 3,
    adhesion: 0,
    pos: [
      0.02 * Math.cos((index * 2 * Math.PI) / count),
      0.02 * Math.sin((index * 2 * Math.PI) / count),
      -depth / 2,
    ],
    frame: [0, 0, 1, 1, 0, 0, 0, 1, 0],
    friction: [...fixture.contact.effectiveFriction],
    solref: [...fixture.contact.solref],
    solreffriction: [...fixture.contact.solreffriction],
    solimp: [...fixture.contact.solimp],
    geom: [0, 1],
    flex: [-1, -1],
    elem: [-1, -1],
    vert: [-1, -1],
    surfacevel: new Array(3).fill(0),
  }));
  return {
    contacts,
    ncon: count,
    nefc: count * 3,
    nisland: 2,
    poses: {
      xpos: [0, 0, 0, 0, 0, 0, ...com],
      xipos: [0, 0, 0, ...center, ...com],
      xmat: [...identity, ...floor.rotation, ...rotation],
      xquat: [1, 0, 0, 0, Math.cos(qpos[0] / 2), 0, Math.sin(qpos[0] / 2), 0, ...qpos.slice(4)],
      geom_xpos: [...center, ...com],
      geom_xmat: [...floor.rotation, ...rotation],
    },
    efcType: new Array(count * 3).fill(7),
    efcId: contacts.flatMap((c) => [c.index, c.index, c.index]),
    warnings: Array.from({ length: 7 }, () => [0, 0]),
  };
}

function syntheticNativeGeometry(failure = '') {
  const calls = {
    position: 0,
    modelCreates: 0,
    dataCreates: 0,
    modelDeletes: 0,
    dataDeletes: 0,
    vectorDeletes: 0,
    contactGets: 0,
    contactDeletes: 0,
    warningGets: 0,
    warningDeletes: 0,
    arrayReads: 0,
    journalWrites: 0,
    checkpoints: 0,
    forbidden: [] as string[],
  };
  const model = syntheticGeometryModel();
  if (failure === 'before-dispatch') model.body_mass[2] += 1;
  model.delete = () => {
    calls.modelDeletes += 1;
    if (failure === 'model-cleanup') throw new Error('SYNTHETIC_MODEL_CLEANUP');
  };
  let current = syntheticGeometryObservation(syntheticGeometryInputs().poses[0].qpos);
  const data = {
    qpos: new Float64Array([
      0,
      0,
      0,
      fixture.bodies.cylinder.heightM / 2 + fixture.initialGapM,
      1,
      0,
      0,
      0,
    ]),
    qvel: new Float64Array(7),
    time: 0,
    qfrc_applied: new Float64Array(7),
    xfrc_applied: new Float64Array(18),
    act: new Float64Array(0),
    ctrl: new Float64Array(1),
    mocap_pos: new Float64Array(0),
    mocap_quat: new Float64Array(0),
    get ncon() {
      return current.ncon;
    },
    get nefc() {
      return current.nefc;
    },
    get nisland() {
      return current.nisland;
    },
    get efc_type() {
      return new Int32Array(current.efcType);
    },
    get efc_id() {
      return new Int32Array(current.efcId);
    },
    get contact() {
      return {
        size: () => current.contacts.length,
        get(index: number) {
          calls.contactGets += 1;
          if (failure === 'contact-get' && index === 1) throw new Error('SYNTHETIC_CONTACT_GET');
          const saved = current.contacts[index];
          const wrapped: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(saved)) {
            if (!Array.isArray(value)) {
              wrapped[key] = value;
              continue;
            }
            Object.defineProperty(wrapped, key, {
              get() {
                calls.arrayReads += 1;
                if (failure === 'contact-array' && key === 'pos')
                  throw new Error('SYNTHETIC_CONTACT_ARRAY');
                return new Float64Array(value);
              },
            });
          }
          for (const key of ['H', 'mu'])
            Object.defineProperty(wrapped, key, {
              get() {
                calls.forbidden.push(key);
                throw new Error('FORBIDDEN_' + key);
              },
            });
          wrapped.delete = () => {
            calls.contactDeletes += 1;
            if (failure === 'contact-cleanup' && index === 0)
              throw new Error('SYNTHETIC_CONTACT_CLEANUP');
          };
          return wrapped;
        },
        delete() {
          calls.vectorDeletes += 1;
        },
      };
    },
    get warning() {
      return {
        size: () => 7,
        get(index: number) {
          calls.warningGets += 1;
          if (failure === 'warning-get' && index === 3) throw new Error('SYNTHETIC_WARNING_GET');
          return {
            number: 0,
            lastinfo: 0,
            delete() {
              calls.warningDeletes += 1;
            },
          };
        },
      };
    },
    delete() {
      calls.dataDeletes += 1;
      if (failure === 'data-cleanup') throw new Error('SYNTHETIC_DATA_CLEANUP');
    },
  };
  for (const key of Object.keys(current.poses))
    Object.defineProperty(data, key, {
      get() {
        return new Float64Array(current.poses[key as keyof typeof current.poses]);
      },
    });
  for (const key of [
    'efc_force',
    'efc_vel',
    'qfrc_constraint',
    'qacc',
    'qacc_warmstart',
    'qfrc_passive',
  ])
    Object.defineProperty(data, key, {
      get() {
        calls.forbidden.push(key);
        throw new Error('FORBIDDEN_' + key);
      },
    });
  const M = new Proxy(
    {
      MjModel: {
        from_xml_string() {
          calls.modelCreates += 1;
          if (failure === 'model-create') throw new Error('SYNTHETIC_MODEL_CREATE');
          return model;
        },
      },
      MjData: class {
        constructor() {
          calls.dataCreates += 1;
          if (failure === 'data-create') throw new Error('SYNTHETIC_DATA_CREATE');
          return data;
        }
      },
      mj_fwdPosition() {
        calls.position += 1;
        if (failure === 'dispatch') throw new Error('SYNTHETIC_POSITION_DISPATCH');
        current = syntheticGeometryObservation(Array.from(data.qpos));
        if (failure === 'after-dispatch') data.time += 1;
        if (failure === 'bad-contact') current.contacts[0].dist = 0;
        if (failure === 'extra-row-type') current.efcType[0] = 8;
      },
    },
    {
      get(target, key, receiver) {
        if (typeof key === 'string' && key.startsWith('mj_') && key !== 'mj_fwdPosition') {
          calls.forbidden.push(key);
          throw new Error('FORBIDDEN_' + key);
        }
        return Reflect.get(target, key, receiver);
      },
    },
  );
  const records: Record<string, unknown>[] = [];
  const journal = {
    append(record: Record<string, unknown>) {
      calls.journalWrites += 1;
      if (failure === 'journal-write' && record.kind === 'geometry-pose')
        throw new Error('SYNTHETIC_JOURNAL_WRITE');
      records.push(structuredClone(record));
    },
    checkpoint() {
      calls.checkpoints += 1;
      if (failure === 'journal-checkpoint' && calls.checkpoints === 2)
        throw new Error('SYNTHETIC_JOURNAL_CHECKPOINT');
    },
    finish(record: Record<string, unknown>) {
      records.push(record);
      return {
        bytes: 1,
        sha256: '2'.repeat(64),
        trailerError: failure === 'journal-finish' ? 'SYNTHETIC_FINISH' : null,
        closeError: null,
      };
    },
  };
  return { calls, model, data, M, journal, records };
}

function geometryLimits() {
  return {
    ...cylinderScenarioLimits(fixture, { kind: 'tilt' }),
    nbody: 3,
    ngeom: 2,
    maxContactVectors: 401,
    maxContactGets: 2005,
    maxWarningGets: 2814,
    maxWarningObservations: 402,
  };
}

function resourceCounters() {
  return { temporaryCreated: 0, temporaryDeleted: 0, warningObservations: 0, cleanupErrors: [] };
}

function approvalInputs() {
  const f = fixture;
  const sourceManifest = { newInputs: { source: '3'.repeat(64) } };
  const actual = {
    fixtureSha256: '4'.repeat(64),
    sourceHead: '5'.repeat(40),
    sourceManifest,
    engineArtifacts: { synthetic: { bytes: 10, sha256: '6'.repeat(64) } },
    inputPath: '/synthetic/saved.json',
    outputDirectory: '/synthetic/external',
    preregistrationSha256: '7'.repeat(64),
    sourceReviewSha256: '8'.repeat(64),
  };
  const registration = {
    schema: 'CYLINDER_G0_PREREGISTRATION_V1',
    decision: 'ROOT_PREREGISTERED_AWAIT_SEPARATE_GO',
    operation: f.geometryOnly.id,
    profile: f.candidateProfile.id,
    fixtureSha256: actual.fixtureSha256,
    sourceHead: actual.sourceHead,
    sourceManifest,
    engineArtifacts: actual.engineArtifacts,
    budget: f.geometryOnly,
    input: {
      path: actual.inputPath,
      sha256: f.geometryOnly.inputSha256,
      bytes: f.geometryOnly.inputBytes,
    },
    outputDirectory: actual.outputDirectory,
    sourceReviewSha256: actual.sourceReviewSha256,
  };
  const review = {
    schema: 'CYLINDER_G0_SOURCE_REVIEW_V1',
    decision: 'NO_BLOCKING_SOURCE_FINDINGS',
    profile: f.candidateProfile.id,
    fixtureSha256: actual.fixtureSha256,
    sourceManifest,
    engineArtifacts: actual.engineArtifacts,
    inputSha256: f.geometryOnly.inputSha256,
  };
  const go = {
    schema: 'CYLINDER_G0_EXECUTION_GO_V1',
    decision: 'ROOT_EXECUTION_GO',
    operation: f.geometryOnly.id,
    preregistrationSha256: actual.preregistrationSha256,
    sourceReviewSha256: actual.sourceReviewSha256,
    oneInvocation: true,
    noRetry: true,
    outputDirectory: actual.outputDirectory,
    budget: f.geometryOnly,
    invocationId: 'synthetic-unit',
  };
  return { actual, registration, review, go };
}

describe('LEGACY_CCD_MULTI5 S0 group 1: immutable physical profile', () => {
  it('changes only the collision option in authored physical XML', () => {
    const condition = cylinderPlan(fixture, 'main').find(
      (c) => c.id === fixture.geometryOnly.world,
    )!;
    const xml = makeCylinderXml(fixture, condition);
    expect(xml).toContain('nativeccd="disable" multiccd="enable"');
    expect(fixture.solver.disableFlags).toBe(196608);
    expect(fixture.solver.enableFlags).toBe(32);
    expect(fixture.contact.cylinderNativeContactCap).toBe(5);
    expect(fixture.contact.boxBoxNativeContactCap).toBe(8);
    expect(fixture.engine.moduleSha256).toBe(
      '85fdadb2c5acee97756e2b0257085f795a2af542f0c4cb97412a6d377abe39e2',
    );
  });
  it.each(['mass', 'inertia', 'material', 'stand-pd', 'dt', 'hold', 'stable-gate'])(
    'rejects unrelated physical delta: %s',
    (delta) => {
      const changed = structuredClone(fixture);
      if (delta === 'mass') changed.bodies.cylinder.massKg += 0.001;
      if (delta === 'inertia') changed.bodies.cylinder.inertiaKgM2[0] += 1e-9;
      if (delta === 'material') changed.contact.solref[0] += 1e-6;
      if (delta === 'stand-pd') changed.stand.kp += 1;
      if (delta === 'dt') changed.nativeStepUs[0] += 1;
      if (delta === 'hold') changed.tilt.rates[0].holdUs += 500;
      if (delta === 'stable-gate') changed.tilt.stable.maxRelativeOmegaRadps += 1e-6;
      expect(() => validateCylinderFixture(changed)).toThrow(
        'CYLINDER_REGISTERED_CONTRACT_MISMATCH',
      );
    },
  );
  it('requires compiled legacy196608/32 and zero geometry dependencies before position dispatch', () => {
    const fake = syntheticNativeGeometry();
    const model = fake.model;
    const readback = { ...model, options: model.opt };
    const initial = { time: 0, qpos: Array.from(fake.data.qpos), qvel: Array.from(fake.data.qvel) };
    const condition = cylinderPlan(fixture, 'main').find(
      (c) => c.id === fixture.geometryOnly.world,
    )!;
    expect(() => validateModel(fixture, condition, readback, initial)).not.toThrow();
    for (const key of ['neq', 'nflex', 'ntendon', 'nmocap', 'nplugin', 'nsensor']) {
      expect(() => validateModel(fixture, condition, { ...readback, [key]: 1 }, initial)).toThrow(
        'MODEL_EXTRA_CAPABILITY',
      );
    }
    expect(() =>
      validateModel(
        fixture,
        condition,
        { ...readback, options: { ...readback.options, disableflags: 65536 } },
        initial,
      ),
    ).toThrow('MODEL_OPTION disableflags');
  });
});

describe('LEGACY_CCD_MULTI5 S0 group 2: source bounds before array copies', () => {
  it('admits exact static13/39 and tilt5/15 limits with islands2', () => {
    expect(cylinderScenarioLimits(fixture, { kind: 'static' })).toMatchObject({
      maxContacts: 13,
      maxConstraintRows: 39,
      maxIslands: 2,
      pairCaps: [
        { geom: [0, 1], maxContacts: 5 },
        { geom: [0, 2], maxContacts: 8 },
      ],
    });
    expect(geometryLimits()).toMatchObject({
      maxContacts: 5,
      maxConstraintRows: 15,
      maxIslands: 2,
    });
  });
  it.each(['sixth-cylinder', 'ninth-box', 'fourteenth-static', 'extra-row', 'extra-island'])(
    'rejects %s before reading any contact arrays',
    (bad) => {
      let arrays = 0;
      let vectors = 0;
      let deleted = 0;
      const count = bad === 'fourteenth-static' ? 14 : bad === 'ninth-box' ? 9 : 6;
      const data = {
        ncon: count,
        nefc: bad === 'extra-row' ? 40 : count * 3,
        nisland: bad === 'extra-island' ? 3 : 2,
        efc_type: new Int32Array(count * 3).fill(7),
        efc_id: Int32Array.from({ length: count * 3 }, (_, row) => Math.floor(row / 3)),
        get contact() {
          vectors += 1;
          return {
            size: () => count,
            get() {
              return {
                geom1: 0,
                geom2: bad === 'ninth-box' ? 2 : 1,
                dim: 3,
                get pos() {
                  arrays += 1;
                  throw new Error('ARRAY_READ_BEFORE_BOUNDS');
                },
                delete() {
                  deleted += 1;
                },
              };
            },
            delete() {
              deleted += 1;
            },
          };
        },
      };
      const resources = resourceCounters();
      expect(() =>
        copyContacts(data, resources, cylinderScenarioLimits(fixture, { kind: 'static' })),
      ).toThrow(/RESOURCE/);
      expect(arrays).toBe(0);
      expect(resources.temporaryCreated).toBe(resources.temporaryDeleted);
      expect(deleted).toBe(resources.temporaryDeleted);
      if (['fourteenth-static', 'extra-row', 'extra-island'].includes(bad)) expect(vectors).toBe(0);
    },
  );
  it('rejects extra constraint types and mismatched array lengths', () => {
    const fake = syntheticNativeGeometry('extra-row-type');
    fake.data.qpos.set(syntheticGeometryInputs().poses[0].qpos);
    fake.M.mj_fwdPosition();
    expect(() => captureGeometry(fake.data, resourceCounters(), geometryLimits())).toThrow(
      'RESOURCE_SCENARIO_CONSTRAINT_TYPE_OR_ID',
    );
    expect(() => boundedNativeArray(new Float64Array(10), 9, 'frame')).toThrow(
      'NATIVE_ARRAY_SHAPE',
    );
  });
  it('bounds the borrowed warning vector before acquiring owned get values', () => {
    let gets = 0;
    const data = {
      warning: {
        size: () => 8,
        get() {
          gets += 1;
        },
      },
    };
    expect(() => copyGeometryWarnings(data, resourceCounters(), geometryLimits())).toThrow(
      'NATIVE_WARNING_COUNT',
    );
    expect(gets).toBe(0);
  });
});

describe('Contact surface velocity ABI contract', () => {
  function replaceSurfaceVelocity(fake: ReturnType<typeof syntheticNativeGeometry>, view: unknown) {
    const vector = fake.data.contact;
    Object.defineProperty(fake.data, 'contact', {
      get() {
        return {
          size: () => vector.size(),
          get(index: number) {
            const wrapped = Object.create(vector.get(index));
            Object.defineProperty(wrapped, 'surfacevel', { value: view });
            return wrapped;
          },
          delete: () => vector.delete(),
        };
      },
    });
  }

  it('copies exactly the three declared contact components and keeps model surface velocity at six per geom', () => {
    const fake = syntheticNativeGeometry();
    const view = new Float64Array([0.125, -0, -0.25]);
    replaceSurfaceVelocity(fake, view);
    const resources = resourceCounters();
    const observed = captureGeometry(fake.data, resources, geometryLimits());
    expect(observed.contacts).toHaveLength(5);
    for (const contact of observed.contacts) {
      expect(contact.surfacevel).toEqual([0.125, -0, -0.25]);
      expect(Object.is(contact.surfacevel[1], -0)).toBe(true);
    }
    expect(view).toEqual(new Float64Array([0.125, -0, -0.25]));
    expect(fake.model.geom_surfacevel).toHaveLength(fake.model.ngeom * 6);
    expect(fake.model.geom_surfacevel).toHaveLength(12);
    expect(resources).toMatchObject({
      temporaryCreated: 13,
      temporaryDeleted: 13,
      cleanupErrors: [],
    });
    expect(fake.calls.contactGets).toBe(5);
    expect(fake.calls.contactDeletes).toBe(5);
    expect(fake.calls.vectorDeletes).toBe(1);
    expect(fake.calls.forbidden).toEqual([]);
  });

  it.each(['six-components', 'two-components', 'plain-array', 'data-view', 'null'])(
    'rejects %s before copying and releases every acquired contact',
    (bad) => {
      const fake = syntheticNativeGeometry();
      const views: Record<string, unknown> = {
        'six-components': new Float64Array(6),
        'two-components': new Float64Array(2),
        'plain-array': [0, 0, 0],
        'data-view': new DataView(new ArrayBuffer(24)),
        null: null,
      };
      const view = views[bad];
      let copied = 0;
      if (view !== null && typeof view === 'object')
        Object.defineProperty(view, Symbol.iterator, {
          value() {
            copied += 1;
            throw new Error('INVALID_SURFACEVEL_COPIED');
          },
        });
      replaceSurfaceVelocity(fake, view);
      const resources = resourceCounters();
      expect(() => captureGeometry(fake.data, resources, geometryLimits())).toThrow(
        'NATIVE_ARRAY_SHAPE surfacevel',
      );
      expect(copied).toBe(0);
      expect(resources).toMatchObject({
        temporaryCreated: 6,
        temporaryDeleted: 6,
        cleanupErrors: [],
      });
      expect(fake.calls.contactGets).toBe(5);
      expect(fake.calls.contactDeletes).toBe(5);
      expect(fake.calls.vectorDeletes).toBe(1);
      expect(fake.calls.warningGets).toBe(0);
      expect(fake.calls.forbidden).toEqual([]);
    },
  );

  it.each([NaN, Infinity])('rejects a nonfinite component %s and preserves cleanup', (value) => {
    const fake = syntheticNativeGeometry();
    replaceSurfaceVelocity(fake, new Float64Array([0, value, 0]));
    const resources = resourceCounters();
    expect(() => captureGeometry(fake.data, resources, geometryLimits())).toThrow(
      'NONFINITE_NATIVE_ARRAY surfacevel',
    );
    expect(resources).toMatchObject({
      temporaryCreated: 6,
      temporaryDeleted: 6,
      cleanupErrors: [],
    });
    expect(fake.calls.contactDeletes).toBe(5);
    expect(fake.calls.vectorDeletes).toBe(1);
    expect(fake.calls.warningGets).toBe(0);
  });
});

describe('LEGACY_CCD_MULTI5 S0 group 3: position-only call and observation boundary', () => {
  it('retains401 complete synthetic poses with one permitted call each and all5220 owned wrappers deleted', () => {
    const fake = syntheticNativeGeometry();
    const report = runCylinderGeometrySession(
      fake.M,
      fixture,
      syntheticGeometryInputs(),
      fake.journal,
    );
    expect(report.status).toBe('OBSERVATIONS_COMPLETE');
    expect(report.counts).toMatchObject({
      modelCreationDispatched: 1,
      modelsCreated: 1,
      dataCreationDispatched: 1,
      dataCreated: 1,
      positionDispatched: 401,
      positionReturned: 401,
      poseRecordsAppended: 401,
      retainedPoseRecords: 401,
      modelsFreed: 1,
      dataFreed: 1,
      nativeAdvances: 0,
      otherDirectMjCalls: 0,
      resets: 0,
      doubleBuffers: 0,
    });
    expect(fake.calls.forbidden).toEqual([]);
    expect(fake.calls.position).toBe(401);
    expect(report.resources).toMatchObject({
      temporaryCreated: 5220,
      temporaryDeleted: 5220,
      contactVectorsCreated: 401,
      contactGetsCreated: 2005,
      warningGetsCreated: 2814,
      warningObservations: 402,
      cleanupErrors: [],
    });
    expect(report.assessment.verdict).toBe('PENDING_DURABLE_FINALIZATION');
    expect(fake.data.qvel).toEqual(new Float64Array(7));
    expect(Object.is(fake.data.qpos[2], -0)).toBe(true);
    const record = fake.records[1] as { observation: { contacts: Record<string, unknown>[] } };
    expect(record.observation.contacts[0]).not.toHaveProperty('H');
    expect(record.observation.contacts[0]).not.toHaveProperty('mu');
    expect(record.observation).not.toHaveProperty('efcVel');
    expect(record.observation).not.toHaveProperty('efcForce');
  });
  it('makes importing the CLI inert and rejects old candidate dynamic modes before writing reports', async () => {
    await expect(runCylinderCli(['--preregister'])).rejects.toThrow(
      'LEGACY_CANDIDATE_DYNAMIC_MODES_REQUIRE_SEPARATE_ROOT_PATH_AND_STAGE_PLAN',
    );
  });
});

describe('LEGACY_CCD_MULTI5 S0 group 4: actual input words and ordered history', () => {
  it('decodes synthetic401 Float64LE inputs with signed zero and does not invent absent PRE caches', () => {
    const sample = syntheticGeometryDocument();
    const { bytes, binding } = sample.bind();
    const result = decodeRetainedGeometryInput(bytes, binding);
    expect(result.poses).toHaveLength(401);
    expect(Object.is(result.poses[0].qpos[2], -0)).toBe(true);
    expect(result.poses[0]).not.toHaveProperty('qvel');
    expect(result.poses[0]).not.toHaveProperty('qacc');
    expect(result.poses[0]).not.toHaveProperty('qacc_warmstart');
    expect(decodeFloat64Words('0000000000000080', 1, 'signed-zero')).toEqual([-0]);
  });
  it.each(['missing', 'duplicate', 'out-of-order', 'invented-cache', 'json-mismatch', 'word-nan'])(
    'rejects malformed saved input: %s',
    (bad) => {
      const sample = syntheticGeometryDocument();
      const d = sample.document;
      if (bad === 'missing') d.records.pop();
      if (bad === 'duplicate') d.records[1] = d.records[0];
      if (bad === 'out-of-order') [d.records[0], d.records[1]] = [d.records[1], d.records[0]];
      if (bad === 'invented-cache') Object.assign(d.records[0].preState, { qacc_warmstart: [] });
      if (bad === 'json-mismatch') d.records[0].preState.qpos[1] += 1;
      if (bad === 'word-nan') d.records[0].preStateFloat64LE.time = '000000000000f87f';
      const { bytes, binding } = sample.bind(d);
      expect(() => decodeRetainedGeometryInput(bytes, binding)).toThrow(/GEOMETRY_INPUT/);
    },
  );
  it('rejects any byte/hash mismatch, including a synthetic document passed to the real fixture binding', () => {
    const sample = syntheticGeometryDocument().bind();
    expect(() => decodeRetainedGeometryInput(sample.bytes, fixture.geometryOnly)).toThrow(
      'GEOMETRY_INPUT_IDENTITY',
    );
    const altered = Buffer.from(sample.bytes);
    altered[100] ^= 1;
    expect(() => decodeRetainedGeometryInput(altered, sample.binding)).toThrow(
      'GEOMETRY_INPUT_IDENTITY',
    );
  });
});

describe('LEGACY_CCD_MULTI5 S0 group 5: unchanged support geometry', () => {
  it('admits negative penetration with authored zero margin and handles both geom slots without repair', () => {
    const qpos = syntheticGeometryInputs().poses[0].qpos;
    for (const reversed of [false, true]) {
      const observed = syntheticGeometryObservation(qpos);
      if (reversed)
        for (const contact of observed.contacts) {
          contact.geom = [1, 0];
          contact.geom1 = 1;
          contact.geom2 = 0;
          contact.frame = [0, 0, -1, 1, 0, 0, 0, -1, 0];
        }
      const before = canonicalBytes(observed);
      const result = assessCylinderGeometry(fixture, qpos, observed);
      expect(result.candidates).toHaveLength(5);
      expect(result.candidates.every((candidate) => candidate.supported)).toBe(true);
      expect(canonicalBytes(observed)).toEqual(before);
    }
  });
  it.each([
    'base',
    'floor',
    'radius',
    'interior',
    'frame',
    'zero-distance',
    'positive-distance',
    'excluded',
    'material',
    'pose',
  ])('fails an invalid original contact: %s', (bad) => {
    const qpos = syntheticGeometryInputs().poses[0].qpos;
    const observed = syntheticGeometryObservation(qpos);
    const c = observed.contacts[0];
    if (bad === 'base') c.dist = -0.001;
    if (bad === 'floor') c.pos[2] += 0.001;
    if (bad === 'radius') c.pos[0] = fixture.bodies.cylinder.radiusM + 0.000101;
    if (bad === 'interior') c.pos[0] = 0.491;
    if (bad === 'frame') c.frame[2] += 1e-9;
    if (bad === 'zero-distance') c.dist = 0;
    if (bad === 'positive-distance') c.dist = 1e-9;
    if (bad === 'excluded') c.exclude = 1;
    if (bad === 'material') c.solref[0] += 0.001;
    if (bad === 'pose') observed.poses.geom_xpos[3] += 1e-10;
    const before = canonicalBytes(observed);
    expect(() => assessCylinderGeometry(fixture, qpos, observed)).toThrow(/GEOMETRY/);
    expect(canonicalBytes(observed)).toEqual(before);
  });
});

describe('LEGACY_CCD_MULTI5 S0 group 6: partial dispatch, wrappers and cleanup', () => {
  it.each([
    'model-create',
    'data-create',
    'before-dispatch',
    'dispatch',
    'after-dispatch',
    'contact-get',
    'contact-array',
    'contact-cleanup',
    'warning-get',
    'journal-write',
    'journal-checkpoint',
    'data-cleanup',
    'model-cleanup',
  ])('keeps real partial counts and cannot pass after %s', (failure) => {
    const fake = syntheticNativeGeometry(failure);
    const report = runCylinderGeometrySession(
      fake.M,
      fixture,
      syntheticGeometryInputs(),
      fake.journal,
    );
    expect(report.assessment.verdict).toBe('FAIL');
    expect(report.failures.length).toBeGreaterThan(0);
    expect(report.counts.positionDispatched).toBe(fake.calls.position);
    expect(report.counts.positionReturned).toBe(
      fake.calls.position - (failure === 'dispatch' ? 1 : 0),
    );
    expect(report.counts.retainedPoseRecords).toBeLessThanOrEqual(report.counts.positionReturned);
    expect(fake.calls.forbidden).toEqual([]);
    if (!['model-create'].includes(failure)) expect(fake.calls.modelDeletes).toBe(1);
    if (!['model-create', 'data-create'].includes(failure)) expect(fake.calls.dataDeletes).toBe(1);
    if (failure === 'contact-cleanup') {
      expect(fake.calls.contactDeletes).toBe(5);
      expect(fake.calls.vectorDeletes).toBe(1);
      expect(report.resources.temporaryCreated - report.resources.temporaryDeleted).toBe(1);
      expect(report.resources.cleanupErrors).toHaveLength(1);
    } else expect(report.resources.temporaryCreated).toBe(report.resources.temporaryDeleted);
    if (failure === 'journal-checkpoint')
      expect(report.counts).toMatchObject({ poseRecordsAppended: 1, retainedPoseRecords: 0 });
  });
  it('halts before the first dispatch when the bounded wall deadline expires', () => {
    const fake = syntheticNativeGeometry();
    const report = runCylinderGeometrySession(
      fake.M,
      fixture,
      syntheticGeometryInputs(),
      fake.journal,
      createGeometryReport(fixture),
      () => 120001,
      0,
    );
    expect(report.counts.positionDispatched).toBe(0);
    expect(report.counts.modelCreationDispatched).toBe(0);
    expect(report.assessment.verdict).toBe('FAIL');
  });
  it('does not grant a geometry verdict when journal finalization failed', () => {
    const fake = syntheticNativeGeometry('journal-finish');
    const report = runCylinderGeometrySession(
      fake.M,
      fixture,
      syntheticGeometryInputs(),
      fake.journal,
    );
    const final = finalizeCylinderGeometry(fixture, report, fake.journal);
    expect(final.assessment.verdict).toBe('FAIL');
    expect(final.journal.trailerError).toBe('SYNTHETIC_FINISH');
  });
  it('finalizes only the narrow geometry verdict after exact synthetic native-budget accounting and durable close', () => {
    const fake = syntheticNativeGeometry();
    const report = runCylinderGeometrySession(
      fake.M,
      fixture,
      syntheticGeometryInputs(),
      fake.journal,
    );
    // Synthetic counters exercise finalization only; no real import/factory occurs.
    Object.assign(report.counts, {
      nativeImportsDispatched: 1,
      nativeImportsReturned: 1,
      factoriesDispatched: 1,
      factoriesReturned: 1,
    });
    const final = finalizeCylinderGeometry(fixture, report, fake.journal);
    expect(final.assessment.verdict).toBe('GEOMETRY_ADMITTED_ON_SAVED_POSES');
    expect(final.unqualified).toEqual([
      'force',
      'velocity',
      'phase',
      'stability',
      'tip',
      'slip',
      'energy',
      'dt',
      'rate',
    ]);
  });
});

describe('LEGACY_CCD_MULTI5 S0 group 7: complete schema and hard resource caps', () => {
  it('proves schedule-aware32768000B live rings and34996224B emergency ledger within unchanged budgets', () => {
    expect(cylinderRetentionProof(fixture)).toEqual({
      live: {
        admissionA: 32768000,
        admissionB: 26214400,
        mainStatic: 32768000,
        mainTilt: 13107200,
      },
      maxLiveRing: 32768000,
      overhead: 1638400,
      partial: 524288,
      trailer: 65536,
      total: 34996224,
    });
    expect(fixture.retention.maxJournalBytes).toBe(268435456);
    expect(fixture.retention.reservedFailureTrailerBytes).toBe(41551872);
    const changed = structuredClone(fixture);
    changed.retention.scenarioTickBytes.static += 1;
    expect(() => cylinderRetentionProof(changed)).toThrow('RESOURCE_SCHEDULE_RING_OR_RESERVE');
  });
  it('keeps existing TickRetention defaults and explicitly bounds the candidate scenario record', () => {
    const memory = memoryRetention(1024);
    const ordinary = new TickRetention(memory.journal, memory.mini, 'synthetic-default', 500);
    const tighter = new TickRetention(memory.journal, memory.mini, 'synthetic-override', 500, 128);
    const record = { tick: 1, payload: 'x'.repeat(200) };
    expect(ordinary.prepare(record).length).toBeLessThan(1024);
    expect(() => tighter.prepare(record)).toThrow('RESOURCE_TICK_BYTE_CAP');
    expect(ordinary.chain.checkpoint().ticks).toBe(1);
    expect(tighter.chain.checkpoint().ticks).toBe(0);
    expect(memory.mini.retention.maxTickBytes).toBe(1024);
  });
  it('fits the full401 maximum-contact geometry schema within16KiB per pose and8MiB raw', () => {
    const fake = syntheticNativeGeometry();
    const report = runCylinderGeometrySession(
      fake.M,
      fixture,
      syntheticGeometryInputs(),
      fake.journal,
    );
    expect(report.status).toBe('OBSERVATIONS_COMPLETE');
    const poseRecords = fake.records.filter((record) => record.kind === 'geometry-pose');
    expect(poseRecords).toHaveLength(401);
    expect(poseRecords.every((record) => canonicalBytes(record).length <= 16384)).toBe(true);
    const framed = fake.records.reduce((sum, record) => sum + 4 + canonicalBytes(record).length, 0);
    expect(framed + 65540).toBeLessThan(8388608);
    expect(1048576 + 4 + 401 * (16384 + 4) + 65536 + 4).toBe(7685708);
    expect(geometryJournalRetention(fixture).maxJournalBytes).toBe(8388608);
  });
  it('rejects exactly one byte over a prepared record cap without advancing its chain or retaining a field-stripped substitute', () => {
    const memory = memoryRetention(1024);
    const record = eightContactTick();
    const bytes = canonicalBytes(record);
    const retention = new TickRetention(
      memory.journal,
      memory.mini,
      'synthetic-overflow',
      500,
      bytes.length - 1,
    );
    expect(() => retention.retain(record)).toThrow('RESOURCE_TICK_BYTE_CAP');
    expect(retention.chain.checkpoint().ticks).toBe(0);
    expect(retention.size).toBe(0);
    expect(canonicalBytes(record)).toEqual(bytes);
  });
});

describe('LEGACY_CCD_MULTI5 S0 group 8: external authorization and preserved failure', () => {
  it('requires separate source review, registration, exact binding and explicit execution GO', () => {
    const a = approvalInputs();
    expect(validateGeometryAuthorization(fixture, a.registration, a.review, a.go, a.actual)).toBe(
      true,
    );
    expect(() =>
      validateGeometryAuthorization(
        fixture,
        a.registration,
        a.review,
        { ...a.go, decision: 'NOT_GRANTED' },
        a.actual,
      ),
    ).toThrow('GEOMETRY_SEPARATE_EXECUTION_GO_REQUIRED');
    expect(() =>
      validateGeometryAuthorization(
        fixture,
        a.registration,
        { ...a.review, decision: 'SELF_REVIEW' },
        a.go,
        a.actual,
      ),
    ).toThrow('GEOMETRY_INDEPENDENT_SOURCE_REVIEW_BINDING');
    expect(() =>
      validateGeometryAuthorization(fixture, a.registration, a.review, a.go, {
        ...a.actual,
        sourceHead: '9'.repeat(40),
      }),
    ).toThrow('GEOMETRY_PREREGISTRATION_BINDING');
    expect(() =>
      validateGeometryAuthorization(
        fixture,
        { ...a.registration, budget: { ...fixture.geometryOnly, maxPositionCalls: 402 } },
        a.review,
        a.go,
        a.actual,
      ),
    ).toThrow('GEOMETRY_PREREGISTRATION_BINDING');
  });
  it('rejects implicit paths, missing authorization and automatic next-stage arguments', () => {
    expect(() => parseGeometryCli(['--geometry-only'])).toThrow('Usage:');
    const absolute = join(tmpdir(), 'synthetic');
    const args = [
      '--geometry-only',
      '--input',
      absolute,
      '--preregistration',
      absolute,
      '--source-review',
      absolute,
      '--execution-go',
      absolute,
      '--journal-dir',
      absolute,
    ];
    expect(parseGeometryCli(args)['--input']).toBe(absolute);
    expect(() => parseGeometryCli([...args, '--admission'])).toThrow('Usage:');
    args[2] = 'relative.json';
    expect(() => parseGeometryCli(args)).toThrow('GEOMETRY_EXPLICIT_CLI_PATH');
  });
  it('retains a3 speed violation under the original0.005rad/s stable threshold', () => {
    expect(fixture.tilt.stable.maxRelativeOmegaRadps).toBe(0.005);
    expect(0.007719689221037876).toBeGreaterThan(fixture.tilt.stable.maxRelativeOmegaRadps);
    const retainedFailureExample = windowRecords();
    retainedFailureExample[retainedFailureExample.length - 1].post.relativeOmega =
      0.007719689221037876;
    expect(assessWindow(retainedFailureExample, fixture, 500, target, 'stable').accepted).toBe(
      false,
    );
    expect(fixture.candidateProfile.nativeQualification).toBe('NOT_RUN');
    expect(fixture.geometryOnly.unqualified).toContain('stability');
  });
});

function maximumRetainedScenarioTick(kind: 'static' | 'tilt') {
  const condition = cylinderPlan(fixture, 'main').find((c) => c.kind === kind)!;
  const ids = worldIds(fixture, condition);
  const depth = 0.00001;
  const qpos = kind === 'tilt' ? [0] : [];
  const qvel = new Array(kind === 'tilt' ? 7 : 12).fill(0);
  const bodies: Record<number, Body & { quaternion: number[] }> = {
    0: { ...body(), quaternion: [1, 0, 0, 0] },
  };
  if (kind === 'tilt')
    bodies[1] = { ...body({ com: [...fixture.stand.com] }), quaternion: [1, 0, 0, 0] };
  const contacts: ReturnType<typeof eightContactTick>['parity']['solved'] = [];
  const efcForce: number[] = [];
  const qfrcConstraint = [...qvel];
  for (const shape of ids.freeBodies) {
    const count = shape.kind === 'cylinder' ? 5 : 8;
    const x = kind === 'tilt' ? 0 : shape.kind === 'cylinder' ? -0.15 : 0.15;
    const half = shape.kind === 'cylinder' ? shape.height / 2 : shape.dimensions[2] / 2;
    const observed = { ...body({ com: [x, 0, half - depth] }), quaternion: [1, 0, 0, 0] };
    bodies[shape.bodyId] = observed;
    qpos.push(...observed.com, ...observed.quaternion);
    qfrcConstraint[shape.dofAdr + 2] = shape.mass * 9.81;
    for (let j = 0; j < count; j += 1) {
      const index = contacts.length;
      const contact = {
        ...structuredClone(eightContactTick().parity.solved[0]),
        index,
        geom1: 0,
        geom2: shape.geomId,
        geom: [0, shape.geomId],
        pos: [
          x + 0.02 * Math.cos((j * Math.PI * 2) / count),
          0.02 * Math.sin((j * Math.PI * 2) / count),
          -depth / 2,
        ],
        efc_address: index * 3,
        force: [(shape.mass * 9.81) / count, 0, 0, 0, 0, 0],
      };
      contacts.push(contact);
      efcForce.push(...contact.force.slice(0, 3));
    }
  }
  const ncon = contacts.length;
  const endpoint = {
    time: 0.0005,
    qpos,
    qvel,
    qacc: new Array(qvel.length).fill(0),
    qacc_warmstart: new Array(qvel.length).fill(0),
  };
  const forward = {
    state: { time: 0, qpos, qvel },
    bodies,
    contacts: contacts.map((contact) => {
      const saved = { ...contact };
      Reflect.deleteProperty(saved, 'force');
      return saved;
    }),
    efcVel: new Array(3 * ncon).fill(0),
    efcType: new Array(3 * ncon).fill(7),
    efcId: contacts.flatMap((contact) => [contact.index, contact.index, contact.index]),
    ncon,
    nefc: ncon * 3,
  };
  const force = {
    contacts,
    efcForce,
    qfrcConstraint,
    qfrcActuator: new Array(qvel.length).fill(0),
    actuatorForce: kind === 'tilt' ? [0] : [],
    endpoint,
    warnings: Array.from({ length: 7 }, () => [0, 0]),
    islands: 2,
  };
  const contact = assessContacts(fixture, forward, force, ids, floorFrame(0));
  const control = controlAt(
    fixture,
    condition,
    kind === 'static' ? fixture.rest.settleUs / condition.dtUs : 0,
  );
  const tilt = kind === 'tilt' ? tiltState(bodies[2], 0, 0, fixture) : null;
  const torque =
    kind === 'tilt' ? { ...effectiveTorque(0, 0, 0, 0, 0, fixture.stand), qfrcActuator: 0 } : null;
  return makeTickRecord({
    tick: 1,
    dtUs: condition.dtUs,
    phase: kind === 'static' ? 'REST_MEASUREMENT' : 'POST_EVENT_DIAGNOSTIC',
    control,
    forward,
    force,
    contact,
    torque,
    preTilt: tilt,
    postTilt: tilt,
    activeIterations: [120, 120],
  });
}

describe('LEGACY_CCD_MULTI5 S0 group 7 complete dynamic retained schemas', () => {
  it('copies all13 native-shaped contacts with legacy caller parity and balanced wrapper ownership', () => {
    const record = maximumRetainedScenarioTick('static');
    const data = {
      ncon: 13,
      nefc: 39,
      nisland: 2,
      efc_type: new Int32Array(39).fill(7),
      efc_id: Int32Array.from({ length: 39 }, (_, row) => Math.floor(row / 3)),
      get contact() {
        return {
          size: () => 13,
          get(index: number) {
            return {
              ...Object.fromEntries(
                Object.entries(record.parity.solved[index]).map(([key, value]) => [
                  key,
                  Array.isArray(value) ? new Float64Array(value) : value,
                ]),
              ),
              delete() {
                return undefined;
              },
            };
          },
          delete() {
            return undefined;
          },
        };
      },
    };
    const oldResources = resourceCounters();
    const scenarioResources = resourceCounters();
    const oldValues = copyContacts(data, oldResources);
    const boundedValues = copyContacts(
      data,
      scenarioResources,
      cylinderScenarioLimits(fixture, { kind: 'static' }),
    );
    expect(canonicalBytes(boundedValues)).toEqual(canonicalBytes(oldValues));
    expect(boundedValues).toHaveLength(13);
    expect(oldResources.temporaryCreated).toBe(14);
    expect(oldResources.temporaryDeleted).toBe(14);
    expect(scenarioResources.temporaryCreated).toBe(14);
    expect(scenarioResources.temporaryDeleted).toBe(14);
  });
  it.each(['static', 'tilt'] as const)(
    'fits complete maximum %s contact/row schema and longest strings',
    (kind) => {
      const record = maximumRetainedScenarioTick(kind);
      const count = kind === 'static' ? 13 : 5;
      expect(record.parity.contacts).toHaveLength(count);
      expect(record.parity.solved).toHaveLength(count);
      expect(record.contact.contacts).toHaveLength(count);
      expect(record.parity.efcVel).toHaveLength(count * 3);
      expect(record.parity.efcForce).toHaveLength(count * 3);
      expect(record.parity.solved.every((contact) => contact.H.length === 36)).toBe(true);
      expect(record.contact.contacts.every((contact) => contact.witness !== null)).toBe(true);
      expect(record.parity.endpoint.qacc_warmstart).toHaveLength(kind === 'static' ? 12 : 7);
      expect(record.nativeCounts.solverIterations).toHaveLength(2);
      expect(record.phase.length).toBe(kind === 'static' ? 16 : 21);
      expect(record.control.phase.length).toBe(kind === 'static' ? 16 : 8);
      const bytes = canonicalBytes(record);
      expect(bytes.length).toBeLessThanOrEqual(fixture.retention.scenarioTickBytes[kind]);
      const memory = memoryRetention(1024);
      const retention = new TickRetention(
        memory.journal,
        memory.mini,
        'synthetic-max-schema',
        500,
        fixture.retention.scenarioTickBytes[kind],
      );
      expect(retention.prepare(record)).toEqual(bytes);
      const oneByteOver = new TickRetention(
        memory.journal,
        memory.mini,
        'synthetic-hard-cap',
        500,
        bytes.length - 1,
      );
      expect(() => oneByteOver.prepare(record)).toThrow('RESOURCE_TICK_BYTE_CAP');
    },
  );
});

function dynamicApprovalInputs(stage: 'ADMISSION' | 'MAIN' = 'ADMISSION') {
  const geometry = acceptedCylinderGeometry();
  const sourceManifest = {
    newInputs: { ...geometry.sourceInputs },
    immutableParents: { synthetic: '1'.repeat(64) },
  };
  const outputDirectory = join(tmpdir(), 'synthetic-cylinder-dynamic-controls');
  const actual = {
    fixtureSha256:
      geometry.sourceInputs['tests/robotics/field-core-qualification/mujoco-cylinder.fixture.json'],
    sourceHead: 'a'.repeat(40),
    sourceManifest,
    geometry,
    engineArtifacts: { synthetic: { bytes: 1, sha256: '2'.repeat(64) } },
    outputDirectory,
    outputs: {
      claim: join(outputDirectory, 'claim.json'),
      raw: join(outputDirectory, 'raw'),
      receipt: join(outputDirectory, 'receipt.json'),
    },
    preregistrationSha256: '3'.repeat(64),
    sourceReviewSha256: '4'.repeat(64),
    supervisorReviewSha256: '5'.repeat(64),
    executionGoSha256: '6'.repeat(64),
    supervisorHelper: {
      path: join(tmpdir(), 'synthetic-supervisor.py'),
      bytes: 1,
      sha256: '7'.repeat(64),
    },
    admissionReviewSha256: stage === 'MAIN' ? '8'.repeat(64) : null,
    admissionRaw: {
      path: join(tmpdir(), 'synthetic-admission.raw'),
      bytes: 1,
      sha256: '9'.repeat(64),
    },
    admissionReceipt: {
      path: join(tmpdir(), 'synthetic-admission.json'),
      bytes: 1,
      sha256: 'b'.repeat(64),
    },
    admissionReceiptValue: {
      schema: 'CYLINDER_DYNAMIC_RECEIPT_V1',
      stage: 'ADMISSION',
      invocationId: 'synthetic_A',
      sourceHead: 'a'.repeat(40),
      executionGoSha256: 'c'.repeat(64),
      report: {
        assessment: { verdict: 'PASS' },
        budget: { advanceDispatched: 40200, advanceReturned: 40200 },
        worlds: Array.from({ length: 8 }, () => ({ status: 'PASS' })),
        nativeLedger: {
          knowledge: 'ACTUAL_DISPATCHED_AND_RETURNED',
          firstFailure: null,
          outstanding: [],
          acquisitionUnknown: [],
          cleanupUnknown: [],
          calls: Object.fromEntries(
            Object.entries(cylinderDynamicBudget(fixture, 'ADMISSION').calls).map(([api, cap]) => [
              api,
              { dispatched: cap, returned: cap },
            ]),
          ),
        },
        journal: { bytes: 1, sha256: '9'.repeat(64), trailerError: null, closeError: null },
      },
    },
  };
  const budget = cylinderDynamicBudget(fixture, stage);
  const transition = cylinderPhysicsTransition(fixture, actual.sourceHead, sourceManifest);
  // Synthetic parser value only: this is not an operational deadline selection.
  const operationalBudget = {
    wallTimeoutSeconds: 1,
    anchor: 'ORIGINAL_OWNED_JOB_CREATEPROCESS_DISPATCH',
    noGrace: true,
    terminateOnDeadline: true,
    maxCreateProcess: 1,
    maxResumeThread: 1,
  };
  const registration = {
    schema: 'CYLINDER_DYNAMIC_PREREGISTRATION_V1',
    status: 'PREPARED_AWAIT_SEPARATE_ROOT_GO',
    stage,
    profile: fixture.candidateProfile.id,
    sourceHead: actual.sourceHead,
    sourceManifest,
    fixtureSha256: actual.fixtureSha256,
    engineArtifacts: actual.engineArtifacts,
    geometry,
    transition,
    budget,
    retention: fixture.retention,
    outputs: actual.outputs,
    outputDirectory,
    sourceReviewSha256: actual.sourceReviewSha256,
    supervisorReviewSha256: actual.supervisorReviewSha256,
    operationalBudget,
    admissionReviewSha256: actual.admissionReviewSha256,
  };
  const review = {
    schema: 'CYLINDER_DYNAMIC_SOURCE_PHYSICS_REVIEW_V1',
    decision: 'NO_BLOCKING_SOURCE_AND_PHYSICS_TRANSITION_FINDINGS',
    independentReviewPerformed: true,
    blockingFindings: [],
    transition,
    budget,
    engineArtifacts: actual.engineArtifacts,
    geometry,
  };
  const supervision = {
    schema: 'CYLINDER_DYNAMIC_SUPERVISION_REVIEW_V1',
    decision: 'NO_BLOCKING_DYNAMIC_OWNED_JOB_FINDINGS',
    independentReviewPerformed: true,
    blockingFindings: [],
    stage,
    sourceHead: actual.sourceHead,
    sourceManifest,
    operationalBudget,
    helper: actual.supervisorHelper,
    atomicOwnedJobCreation: true,
    unknownNeverPromoted: true,
    originalDeadlineThroughRootExitAndDrain: true,
  };
  const go = {
    schema: 'CYLINDER_DYNAMIC_EXECUTION_GO_V1',
    decision: 'ROOT_EXECUTION_GO',
    selectedBy: 'ROOT',
    stage,
    oneInvocation: true,
    noRetry: true,
    noAutoChain: true,
    invocationId: 'synthetic_' + stage,
    preregistrationSha256: actual.preregistrationSha256,
    sourceReviewSha256: actual.sourceReviewSha256,
    supervisorReviewSha256: actual.supervisorReviewSha256,
    sourceHead: actual.sourceHead,
    sourceManifest,
    geometry,
    transition,
    budget,
    operationalBudget,
    outputs: actual.outputs,
    outputDirectory,
    nativeResourceReservation: {
      owner: 'CYLINDER_DYNAMIC_' + stage,
      exclusive: true,
      confirmedBy: 'ROOT',
      otherNativeStopped: true,
    },
    admissionReviewSha256: actual.admissionReviewSha256,
  };
  const admission =
    stage === 'MAIN'
      ? {
          schema: 'CYLINDER_ADMISSION_RESULT_REVIEW_V1',
          decision: 'ADMISSION_ADMITTED_ON_CURRENT_SOURCE',
          independentReviewPerformed: true,
          blockingFindings: [],
          stage: 'ADMISSION',
          sourceHead: actual.sourceHead,
          sourceManifest,
          engineArtifacts: actual.engineArtifacts,
          geometry,
          transition,
          observedWorlds: 8,
          observedNativeAdvances: 40200,
          allPhysicalChecksPassed: true,
          ledgerClosed: true,
          journalClosed: true,
          invocationId: 'synthetic_A',
          receipt: actual.admissionReceipt,
          raw: actual.admissionRaw,
        }
      : null;
  const validate = () =>
    validateCylinderDynamicAuthorization(
      fixture,
      stage,
      registration,
      review,
      supervision,
      go,
      actual,
      admission,
    );
  return { actual, registration, review, supervision, go, admission, validate };
}

function dynamicWorldHarness(failure = '', phase: 'split' | 'full' = 'split') {
  const condition = cylinderPlan(fixture, 'admission').find(
    (c: PlanEntry) => c.probe === 'B' && c.dtUs === 500 && c.phase === phase,
  )!;
  const ledger = new CylinderNativeLedger(cylinderDynamicBudget(fixture, 'ADMISSION'));
  const hooks = ledger.forWorld(condition.id);
  const calls = {
    model: 0,
    data: 0,
    buffer: 0,
    modelDelete: 0,
    dataDelete: 0,
    bufferDelete: 0,
    warningGets: 0,
    warningDeletes: 0,
    warningVectors: 0,
    steps: 0,
    extraReads: 0,
  };
  const model = syntheticGeometryModel();
  for (const [key, value] of Object.entries(model))
    if (Array.isArray(value)) Reflect.set(model, key, new Float64Array(value));
  Reflect.set(model.opt, 'gravity', new Float64Array(model.opt.gravity));
  Reflect.set(model.opt, 'wind', new Float64Array(model.opt.wind));
  model.delete = () => {
    calls.modelDelete += 1;
    if (failure === 'model-delete') throw new Error('SYNTHETIC_MODEL_DELETE');
  };
  const qpos = new Float64Array([
    0,
    0,
    0,
    fixture.bodies.cylinder.heightM / 2 + fixture.initialGapM,
    1,
    0,
    0,
    0,
  ]);
  const observation = syntheticGeometryObservation(Array.from(qpos));
  const data = {
    time: 0,
    qpos,
    qvel: new Float64Array(7),
    qacc: new Float64Array(7),
    qacc_warmstart: new Float64Array(7),
    qfrc_applied: new Float64Array(7),
    xfrc_applied: new Float64Array(18),
    qfrc_passive: new Float64Array(7),
    act: new Float64Array(0),
    ctrl: new Float64Array(1),
    ncon: 5,
    nefc: 15,
    nisland: 2,
    efc_type: new Int32Array(observation.efcType),
    efc_id: new Int32Array(observation.efcId),
    efc_vel: new Float64Array(15),
    ...Object.fromEntries(
      Object.entries(observation.poses).map(([key, value]) => [key, new Float64Array(value)]),
    ),
    get warning() {
      calls.warningVectors += 1;
      return {
        size: () => (failure === 'warning-size' ? 8 : 7),
        get(index: number) {
          calls.warningGets += 1;
          if (failure === 'warning-get' && index === 2) throw new Error('SYNTHETIC_WARNING_GET');
          return {
            number: 0,
            lastinfo: 0,
            delete() {
              calls.warningDeletes += 1;
              if (failure === 'warning-delete') throw new Error('SYNTHETIC_WARNING_DELETE');
            },
          };
        },
      };
    },
    get contact() {
      return {
        size: () => 5,
        get(index: number) {
          return {
            ...Object.fromEntries(
              Object.entries(observation.contacts[index]).map(([key, value]) => [
                key,
                Array.isArray(value) ? new Float64Array(value) : value,
              ]),
            ),
            H: new Float64Array(36),
            mu: 1,
            delete() {
              return undefined;
            },
          };
        },
        delete() {
          return undefined;
        },
      };
    },
    delete() {
      calls.dataDelete += 1;
      if (failure === 'data-delete') throw new Error('SYNTHETIC_DATA_DELETE');
    },
  };
  const M = {
    MjModel: {
      from_xml_string() {
        calls.model += 1;
        if (failure === 'model-create') throw new Error('SYNTHETIC_MODEL_CREATE');
        return model;
      },
    },
    MjData: class {
      constructor() {
        calls.data += 1;
        if (failure === 'data-create') throw new Error('SYNTHETIC_DATA_CREATE');
        return data;
      }
    },
    DoubleBuffer: class {
      constructor() {
        calls.buffer += 1;
        if (failure === 'buffer-create') throw new Error('SYNTHETIC_BUFFER_CREATE');
      }
      GetView() {
        if (failure === 'get-view') throw new Error('SYNTHETIC_GET_VIEW');
        return new Float64Array(6);
      }
      delete() {
        calls.bufferDelete += 1;
        if (failure === 'buffer-delete') throw new Error('SYNTHETIC_BUFFER_DELETE');
      }
    },
    mj_step1() {
      calls.steps += 1;
      if (failure === 'step1') throw new Error('SYNTHETIC_STEP1');
    },
    mj_step2() {
      calls.steps += 1;
      throw new Error('SYNTHETIC_STEP2');
    },
    mj_step() {
      calls.steps += 1;
      throw new Error('SYNTHETIC_FULL_STEP');
    },
    mj_objectVelocity() {
      return undefined;
    },
  };
  const total = {
    allowedWorlds: 8,
    allowedNativeSteps: 40200,
    allowedConcurrentWorlds: 2,
    maxConcurrentWorlds: 0,
    modelCreationDispatched: 0,
    modelsCreated: 0,
    modelsFreed: 0,
    dataCreationDispatched: 0,
    dataCreated: 0,
    dataFreed: 0,
    keyframeResets: 0,
    step1Dispatched: 0,
    step1Returned: 0,
    advanceDispatched: 0,
    advanceReturned: 0,
    scheduleConfirmedAdvances: 0,
  };
  const records: Record<string, unknown>[] = [];
  const journal = {
    append(record: Record<string, unknown>) {
      records.push(structuredClone(record));
    },
    checkpoint() {
      return undefined;
    },
  };
  const world = new World(M, fixture, condition, total, journal, hooks);
  const forbidFailureReads = () => {
    for (const key of Object.keys(data)) {
      if (key === 'delete') continue;
      Object.defineProperty(data, key, {
        configurable: true,
        get() {
          calls.extraReads += 1;
          throw new Error('FORBIDDEN_FAILURE_QUERY');
        },
      });
    }
  };
  return { world, ledger, hooks, calls, total, data, model, journal, records, forbidFailureReads };
}

describe('external cylinder dynamic stage source contracts (PURE; no engine)', () => {
  it.each(['ADMISSION', 'MAIN'] as const)(
    'derives unchanged %s operation and retention ceilings',
    (stage) => {
      const b = cylinderDynamicBudget(fixture, stage);
      expect(b.classification).toBe('PLANNED_CAPS_NOT_OBSERVED_RESULTS');
      expect(b.retention).toEqual(fixture.retention);
      expect(b.worlds).toBe(stage === 'ADMISSION' ? 8 : 12);
      expect(b.maxNativeAdvances).toBe(stage === 'ADMISSION' ? 40200 : 7542000);
      expect(b.maxStepsPerWorld).toBe(stage === 'ADMISSION' ? 13000 : 1508000);
      expect(b.maxConcurrentWorlds).toBe(stage === 'ADMISSION' ? 2 : 1);
      expect(b.calls.mj_step1).toBe(stage === 'ADMISSION' ? 20100 : 7542000);
      expect(b.calls.mj_step2).toBe(b.calls.mj_step1);
      for (const api of ['mj_kinematics', 'mj_comPos', 'mj_comVel'])
        expect(b.calls[api]).toBe(b.calls.mj_step1);
      expect(b.calls.mj_step).toBe(stage === 'ADMISSION' ? 20100 : 0);
      expect(b.calls.mj_resetDataKeyframe).toBe(stage === 'ADMISSION' ? 4 : 0);
      expect(b.calls.mj_objectVelocity).toBe(stage === 'ADMISSION' ? 141300 : 30912000);
      expect(b.calls.mj_contactForce).toBe(stage === 'ADMISSION' ? 210600 : 43662000);
      expect(b.calls['data.contact']).toBe(2 * b.maxNativeAdvances);
      expect(b.calls['contact.get']).toBe(2 * b.calls.mj_contactForce);
      expect(b.calls['warning.get']).toBe(7 * (b.maxNativeAdvances + b.worlds));
      expect(b.calls['DoubleBuffer.GetView']).toBe(
        2 * b.worlds + b.calls.mj_objectVelocity + b.calls.mj_contactForce,
      );
      expect(b.byWorld.every((w) => w.shape.solverSlots === 20)).toBe(true);
      expect(b.coverage).toContain('not a claim about every internal WASM call');
    },
  );

  it.each(['ADMISSION', 'MAIN'] as const)(
    'requires separate complete %s typed bindings',
    (stage) => {
      expect(dynamicApprovalInputs(stage).validate()).toMatchObject({
        stage,
        schema: 'CYLINDER_DYNAMIC_VALIDATED_PERMIT_V1',
      });
    },
  );

  it.each([
    ['stage', 'go.stage', 'MAIN'],
    ['old G0 schema', 'go.schema', 'CYLINDER_G0_EXECUTION_GO_V1'],
    ['consumed ID', 'go.invocationId', 'cylinder_legacy_g0_saved401_20261112'],
    ['no GO', 'go.decision', 'PREPARED_AWAIT_REVIEW'],
    ['autochain', 'go.noAutoChain', false],
    ['source transition', 'review.transition.fromSourceHead', '0'.repeat(40)],
    ['source review independence', 'review.independentReviewPerformed', false],
    ['geometry outcome', 'actual.geometry.verdict', 'INCOMPLETE'],
    ['geometry raw', 'actual.geometry.raw.sha256', '0'.repeat(64)],
    ['world cap', 'registration.budget.worlds', 9],
    ['retention cap', 'registration.retention.maxJournalBytes', 268435457],
    ['deadline missing', 'registration.operationalBudget.wallTimeoutSeconds', null],
    ['deadline zero', 'registration.operationalBudget.wallTimeoutSeconds', 0],
    ['deadline reanchor', 'registration.operationalBudget.anchor', 'ROOT_EXIT'],
    ['grace', 'registration.operationalBudget.noGrace', false],
    ['job fallback', 'supervision.atomicOwnedJobCreation', false],
    ['late promotion', 'supervision.unknownNeverPromoted', false],
    ['reservation', 'go.nativeResourceReservation.otherNativeStopped', false],
    ['output binding', 'go.outputs.raw', '/different/raw'],
  ] as const)('rejects %s before an execution permit exists', (_label, path, value) => {
    const input = dynamicApprovalInputs();
    // Sever shared synthetic object references, as separate JSON files would.
    const copy = JSON.parse(JSON.stringify(input));
    const parts = path.split('.');
    let object: Record<string, unknown> = copy;
    for (const key of parts.slice(0, -1)) object = object[key] as Record<string, unknown>;
    object[parts[parts.length - 1]] = value;
    expect(() =>
      validateCylinderDynamicAuthorization(
        fixture,
        'ADMISSION',
        copy.registration,
        copy.review,
        copy.supervision,
        copy.go,
        copy.actual,
        null,
      ),
    ).toThrow();
  });

  it.each([
    'missing',
    'wrong-source',
    'incomplete',
    'zero-advances',
    'open-ledger',
    'partial-ledger',
    'raw-mismatch',
    'same-go',
    'failed-world',
  ])('does not infer MAIN admission from G0: %s', (failure) => {
    const input = dynamicApprovalInputs('MAIN');
    if (failure === 'missing') input.admission = null;
    if (failure === 'wrong-source') input.admission!.sourceHead = '0'.repeat(40);
    if (failure === 'incomplete') input.admission!.decision = 'INCOMPLETE';
    if (failure === 'zero-advances') input.admission!.observedNativeAdvances = 0;
    if (failure === 'open-ledger')
      input.actual.admissionReceiptValue.report.nativeLedger.knowledge =
        'UNKNOWN_NATIVE_CALL_OR_OWNERSHIP';
    if (failure === 'partial-ledger')
      Reflect.set(input.actual.admissionReceiptValue.report.nativeLedger, 'calls', {});
    if (failure === 'raw-mismatch')
      input.actual.admissionReceiptValue.report.journal.sha256 = '0'.repeat(64);
    if (failure === 'same-go')
      input.actual.admissionReceiptValue.executionGoSha256 = input.actual.executionGoSha256;
    if (failure === 'failed-world')
      input.actual.admissionReceiptValue.report.worlds[0].status = 'FAIL';
    expect(() =>
      validateCylinderDynamicAuthorization(
        fixture,
        'MAIN',
        input.registration,
        input.review,
        input.supervision,
        input.go,
        input.actual,
        input.admission,
      ),
    ).toThrow('DYNAMIC_MAIN_REQUIRES_ACTUAL_INDEPENDENT_ADMISSION');
  });

  it('requires the new route, a distinct stage and every absolute control path', async () => {
    const path = join(tmpdir(), 'synthetic-control.json');
    const args = [
      '--dynamic-stage',
      'ADMISSION',
      '--preregistration',
      path,
      '--source-review',
      path,
      '--supervisor-review',
      path,
      '--execution-go',
      path,
      '--journal-dir',
      tmpdir(),
    ];
    expect(parseCylinderDynamicCli(args).stage).toBe('ADMISSION');
    expect(() => parseCylinderDynamicCli(args.slice(0, -2))).toThrow(
      'DYNAMIC_EXPLICIT_CLI_ARGUMENTS',
    );
    expect(() =>
      parseCylinderDynamicCli(args.map((x) => (x === path ? 'relative.json' : x))),
    ).toThrow('DYNAMIC_EXPLICIT_ABSOLUTE_PATH');
    expect(() =>
      parseCylinderDynamicCli(args.map((x) => (x === 'ADMISSION' ? 'MAIN' : x))),
    ).toThrow('DYNAMIC_EXPLICIT_CLI_ARGUMENTS');
    await expect(runCylinderCli(['--main', '--write-evidence'])).rejects.toThrow(
      'LEGACY_CANDIDATE_DYNAMIC_MODES_REQUIRE_SEPARATE_ROOT_PATH_AND_STAGE_PLAN',
    );
  });

  it('rejects a fabricated permit before creating/importing any engine', async () => {
    await expect(
      executeCylinderStage(fixture, 'ADMISSION', null, { stage: 'ADMISSION' }),
    ).rejects.toThrow('DYNAMIC_VALIDATED_SINGLE_USE_PERMIT');
  });
});

describe('dynamic native dispatch and ownership ledger (PURE)', () => {
  const cappedApis = Object.keys(cylinderDynamicBudget(fixture, 'ADMISSION').calls).filter(
    (api) => !api.endsWith('.delete'),
  );
  it.each(cappedApis)('blocks %s at its cap before the supplied operation', (api) => {
    const budget = cylinderDynamicBudget(fixture, 'ADMISSION');
    budget.calls[api] = 0;
    const ledger = new CylinderNativeLedger(budget);
    let observed = 0;
    expect(() =>
      ledger.invoke(api, () => {
        observed += 1;
        return {};
      }),
    ).toThrow('DYNAMIC_API_CAP_BEFORE_DISPATCH');
    expect(observed).toBe(0);
    expect(ledger.snapshot().calls[api]).toEqual({ dispatched: 0, returned: 0 });
  });

  it('caps live owned worlds before creation and rejects foreign/repeated deletion', () => {
    const b = cylinderDynamicBudget(fixture, 'MAIN');
    const ledger = new CylinderNativeLedger(b);
    const handle = ledger.invoke('MjModel.create', () => ({}));
    let creates = 0;
    expect(() =>
      ledger.invoke('MjModel.create', () => {
        creates += 1;
        return {};
      }),
    ).toThrow('DYNAMIC_LIVE_CAP_BEFORE_DISPATCH');
    expect(creates).toBe(0);
    let deletes = 0;
    expect(() =>
      ledger.invoke(
        'MjModel.delete',
        () => {
          deletes += 1;
        },
        {},
      ),
    ).toThrow('DYNAMIC_CLEANUP_NOT_OWNED');
    ledger.invoke(
      'MjModel.delete',
      () => {
        deletes += 1;
      },
      handle,
    );
    expect(() =>
      ledger.invoke(
        'MjModel.delete',
        () => {
          deletes += 1;
        },
        handle,
      ),
    ).toThrow('DYNAMIC_CLEANUP_NOT_OWNED');
    expect(deletes).toBe(1);
  });

  it('charges a throwing acquisition and never fabricates a returned handle', () => {
    const ledger = new CylinderNativeLedger(cylinderDynamicBudget(fixture, 'ADMISSION'));
    expect(() =>
      ledger.invoke('MjData.create', () => {
        throw new Error('SYNTHETIC_ALLOCATION');
      }),
    ).toThrow('SYNTHETIC_ALLOCATION');
    const saved = ledger.snapshot();
    expect(saved.calls['MjData.create']).toEqual({ dispatched: 1, returned: 0 });
    expect(saved.acquisitionUnknown).toEqual([
      { api: 'MjData.create', world: null, returnObserved: false, usableOwnedHandle: false },
    ]);
    expect(saved.ownership.data.confirmedCreated).toBe(0);
    expect(saved.knowledge).toBe('UNKNOWN_NATIVE_CALL_OR_OWNERSHIP');
    expect(() => ledger.assertClosed()).toThrow('DYNAMIC_LEDGER_NOT_CLOSED');
  });

  it('keeps an invalid returned acquisition unknown while counting its actual return', () => {
    const ledger = new CylinderNativeLedger(cylinderDynamicBudget(fixture, 'ADMISSION'));
    expect(() => ledger.invoke('MjModel.create', () => null)).toThrow(
      'DYNAMIC_OWNED_HANDLE_MISSING',
    );
    const saved = ledger.snapshot();
    expect(saved.calls['MjModel.create']).toEqual({ dispatched: 1, returned: 1 });
    expect(saved.acquisitionUnknown[0].returnObserved).toBe(true);
    expect(saved.knowledge).toBe('UNKNOWN_NATIVE_CALL_OR_OWNERSHIP');
  });

  it('allows only known cleanup after a native throw, with no cleanup retry', () => {
    const ledger = new CylinderNativeLedger(cylinderDynamicBudget(fixture, 'ADMISSION'));
    const model = ledger.invoke('MjModel.create', () => ({}));
    const data = ledger.invoke('MjData.create', () => ({}));
    let deletes = 0;
    expect(() =>
      ledger.invoke(
        'MjData.delete',
        () => {
          deletes += 1;
          throw new Error('UNKNOWN_DELETE');
        },
        data,
      ),
    ).toThrow('UNKNOWN_DELETE');
    expect(() =>
      ledger.invoke('mj_step2', () => {
        throw new Error('MUST_NOT_RUN');
      }),
    ).toThrow('DYNAMIC_STOPPED_BEFORE_DISPATCH');
    ledger.invoke(
      'MjModel.delete',
      () => {
        deletes += 1;
      },
      model,
    );
    expect(() =>
      ledger.invoke(
        'MjData.delete',
        () => {
          deletes += 1;
        },
        data,
      ),
    ).toThrow('DYNAMIC_CLEANUP_NOT_OWNED');
    expect(deletes).toBe(2);
    expect(ledger.snapshot().cleanupUnknown).toHaveLength(1);
    expect(ledger.snapshot().outstanding).toHaveLength(1);
  });

  it('records asynchronous factory rejection once with no follow-on module calls', async () => {
    const ledger = new CylinderNativeLedger(cylinderDynamicBudget(fixture, 'ADMISSION'));
    await expect(
      ledger.invokeAsync('module.factory', async () => {
        throw new Error('SYNTHETIC_FACTORY');
      }),
    ).rejects.toThrow('SYNTHETIC_FACTORY');
    expect(ledger.snapshot().calls['module.factory']).toEqual({ dispatched: 1, returned: 0 });
    expect(() => ledger.invoke('mj_version', () => 4000000)).toThrow(
      'DYNAMIC_STOPPED_BEFORE_DISPATCH',
    );
  });

  it('enforces each world cap independently of the larger invocation cap', () => {
    const budget = cylinderDynamicBudget(fixture, 'ADMISSION');
    budget.byWorld[0].calls.mj_step1 = 1;
    const ledger = new CylinderNativeLedger(budget);
    const hooks = ledger.forWorld(budget.byWorld[0].id);
    let calls = 0;
    hooks.invoke('mj_step1', () => {
      calls += 1;
    });
    expect(() =>
      hooks.invoke('mj_step1', () => {
        calls += 1;
      }),
    ).toThrow('DYNAMIC_API_CAP_BEFORE_DISPATCH');
    expect(calls).toBe(1);
  });
});

describe('dynamic World cleanup and bounded observations (PURE injected objects)', () => {
  it('checks the warning count before any of the seven owned copies', () => {
    const mock = dynamicWorldHarness('warning-size');
    expect(() => mock.world.create()).toThrow('NATIVE_WARNING_COUNT_BEFORE_COPY');
    mock.forbidFailureReads();
    mock.world.fail(new Error('SYNTHETIC_BOUND_FAILURE'));
    mock.world.dispose();
    expect(mock.calls.warningGets).toBe(0);
    expect(mock.calls.extraReads).toBe(0);
    expect(mock.calls.bufferDelete).toBe(1);
    expect(mock.calls.dataDelete).toBe(1);
    expect(mock.calls.modelDelete).toBe(1);
  });

  it.each([
    'model-create',
    'data-create',
    'buffer-create',
    'get-view',
    'warning-get',
    'warning-delete',
  ])('preserves actual %s failure and cleans only known handles', (failure) => {
    const mock = dynamicWorldHarness(failure);
    expect(() => mock.world.create()).toThrow();
    mock.forbidFailureReads();
    mock.world.fail(new Error('SYNTHETIC_CREATION_FAILED'));
    try {
      mock.world.dispose();
    } catch (error) {
      expect(String(error)).toContain('RESOURCE_OWNED_WRAPPER_CLEANUP');
    }
    mock.world.dispose();
    expect(mock.calls.extraReads).toBe(0);
    expect(mock.calls.modelDelete).toBe(failure === 'model-create' ? 0 : 1);
    expect(mock.calls.dataDelete).toBe(['model-create', 'data-create'].includes(failure) ? 0 : 1);
    expect(mock.calls.bufferDelete).toBe(
      ['model-create', 'data-create', 'buffer-create'].includes(failure) ? 0 : 1,
    );
    expect(mock.ledger.snapshot().knowledge).toBe('UNKNOWN_NATIVE_CALL_OR_OWNERSHIP');
    expect(() => mock.ledger.assertClosed()).toThrow('DYNAMIC_LEDGER_NOT_CLOSED');
    if (failure === 'warning-get') {
      expect(mock.calls.warningGets).toBe(3);
      expect(mock.calls.warningDeletes).toBe(2);
    }
    if (failure === 'warning-delete') {
      expect(mock.calls.warningGets).toBe(1);
      expect(mock.calls.warningDeletes).toBe(1);
    }
  });

  it.each(['buffer-delete', 'data-delete', 'model-delete'])(
    'continues known cleanup after %s and never retries',
    (failure) => {
      const mock = dynamicWorldHarness(failure);
      mock.world.create();
      mock.forbidFailureReads();
      expect(() => mock.world.dispose()).toThrow('RESOURCE_OWNED_WRAPPER_CLEANUP');
      mock.world.dispose();
      expect([mock.calls.bufferDelete, mock.calls.dataDelete, mock.calls.modelDelete]).toEqual([
        1, 1, 1,
      ]);
      expect(mock.calls.extraReads).toBe(0);
      expect(mock.ledger.snapshot().cleanupUnknown).toHaveLength(1);
    },
  );

  it.each([
    ['step1', 'split', 'mj_step1'],
    ['step2', 'split', 'mj_step2'],
    ['step', 'full', 'mj_step'],
  ] as const)(
    'retains the actual %s prefix with no failure-path getters',
    (failure, phase, api) => {
      const mock = dynamicWorldHarness(failure, phase);
      mock.world.create();
      expect(() => mock.world.advance()).toThrow('SYNTHETIC_');
      const prior = structuredClone(mock.world.lastObservation);
      mock.forbidFailureReads();
      const failed = mock.world.fail(new Error('SYNTHETIC_STOP'));
      mock.world.dispose();
      expect(failed.partial.lastObservation).toEqual(prior);
      expect(failed.partial.native.knowledge).toBe('PRIOR_PLAIN_OBSERVATIONS_ONLY');
      expect(mock.calls.extraReads).toBe(0);
      expect(mock.ledger.snapshot().calls[api]).toEqual({ dispatched: 1, returned: 0 });
      expect(failed.status).toBe('FAIL');
    },
  );

  it('keeps the same bounded contact values and accounts every owned copy/size/deletion', () => {
    const mock = dynamicWorldHarness();
    const before = resourceCounters();
    const after = resourceCounters();
    const limits = cylinderScenarioLimits(fixture, { kind: 'tilt' });
    expect(copyContacts(mock.data, after, limits, mock.hooks)).toEqual(
      copyContacts(mock.data, before, limits),
    );
    const calls = mock.ledger.snapshot().calls;
    expect(calls['data.contact']).toEqual({ dispatched: 1, returned: 1 });
    expect(calls['contact.size']).toEqual({ dispatched: 1, returned: 1 });
    expect(calls['contact.get']).toEqual({ dispatched: 5, returned: 5 });
    expect(calls['contact.delete']).toEqual({ dispatched: 5, returned: 5 });
    expect(calls['contactVector.delete']).toEqual({ dispatched: 1, returned: 1 });
    expect(after.temporaryCreated).toBe(6);
    expect(after.temporaryDeleted).toBe(6);
    mock.ledger.assertClosed();
  });

  it('retains contact cleanup knowledge and releases the remaining known copies after a delete throw', () => {
    const mock = dynamicWorldHarness();
    const vector = mock.data.contact;
    let deletes = 0;
    const data = {
      ...mock.data,
      contact: {
        size: () => vector.size(),
        get(index: number) {
          const contact = vector.get(index);
          contact.delete = () => {
            deletes += 1;
            if (index === 0) throw new Error('SYNTHETIC_CONTACT_DELETE');
          };
          return contact;
        },
        delete: () => vector.delete(),
      },
    };
    expect(() =>
      copyContacts(
        data,
        resourceCounters(),
        cylinderScenarioLimits(fixture, { kind: 'tilt' }),
        mock.hooks,
      ),
    ).toThrow('NATIVE_WRAPPER_CLEANUP');
    expect(deletes).toBe(5);
    expect(mock.ledger.snapshot().calls['contactVector.delete']).toEqual({
      dispatched: 1,
      returned: 1,
    });
    expect(mock.ledger.snapshot().cleanupUnknown).toHaveLength(1);
    expect(mock.ledger.snapshot().outstanding).toHaveLength(1);
  });

  it('bounds Float64 state shape before copy and leaves historical callers opt-out', () => {
    const mock = dynamicWorldHarness();
    const bad = new Float64Array(9);
    Object.defineProperty(bad, Symbol.iterator, {
      value() {
        throw new Error('COPIED_BEFORE_SHAPE');
      },
    });
    const data = { ...mock.data, qpos: bad };
    expect(() => copyState(data, mock.hooks)).toThrow('NATIVE_ARRAY_SHAPE qpos');
    expect(copyState(mock.data, mock.hooks)).toEqual(copyState(mock.data));
    const resources = resourceCounters();
    expect(copyWarnings(mock.data, resources, mock.hooks)).toEqual(new Array(7).fill([0, 0]));
    expect(resources.temporaryCreated).toBe(7);
    expect(resources.temporaryDeleted).toBe(7);
  });

  it('does not change physical functions in the generated stage contract', () => {
    const input = dynamicApprovalInputs();
    expect(input.registration.transition.preserved).toContain('evaluate');
    expect(input.registration.transition.preserved).toContain('controlAt');
    expect(input.registration.transition.preserved).toContain('assessComparisons');
    expect(input.registration.transition.geometryDoesNotQualify).toEqual(
      fixture.geometryOnly.unqualified,
    );
  });
});

describe('dynamic durable finalization and retained failure caps (PURE)', () => {
  it.each(['trailerError', 'closeError', 'open', 'bytes'])(
    'does not promote %s to PASS',
    (failure) => {
      const report = { assessment: { verdict: 'PASS', failures: [] as string[] } };
      const journal = {
        closed: failure !== 'open',
        finish() {
          return {
            bytes: failure === 'bytes' ? fixture.retention.maxJournalBytes + 1 : 1,
            sha256: 'd'.repeat(64),
            trailerError: failure === 'trailerError' ? 'SYNTHETIC' : null,
            closeError: failure === 'closeError' ? 'SYNTHETIC' : null,
          };
        },
      };
      expect(finalizeCylinderDynamic(fixture, report, journal).assessment.verdict).toBe('FAIL');
    },
  );

  it('fails an oversized final trailer without enlarging its fixed cap', () => {
    const report = {
      assessment: { verdict: 'PASS', failures: [] as string[] },
      nativeLedger: { oversized: 'x'.repeat(fixture.retention.emergencyTrailerBytes) },
    };
    let saved: Record<string, unknown> = {};
    const journal = {
      closed: true,
      finish(record: Record<string, unknown>) {
        saved = record;
        return { bytes: 1, sha256: 'e'.repeat(64), trailerError: null, closeError: null };
      },
    };
    expect(finalizeCylinderDynamic(fixture, report, journal).assessment.verdict).toBe('FAIL');
    expect(saved.status).toBe('FAIL');
    expect(canonicalBytes(saved).length).toBeLessThan(fixture.retention.emergencyTrailerBytes);
  });

  it('retains a compact FAIL, never a truncated PASS, when MAIN summary fit is unproved', () => {
    const receipt = {
      schema: 'CYLINDER_DYNAMIC_RECEIPT_V1',
      stage: 'MAIN',
      report: {
        assessment: { verdict: 'PASS', failures: [] },
        worlds: [{ oversized: 'x'.repeat(fixture.retention.maxCommittedSummaryBytes) }],
        budget: { advanceReturned: 1 },
        nativeLedger: { knowledge: 'ACTUAL_DISPATCHED_AND_RETURNED' },
        journal: { bytes: 42, sha256: 'f'.repeat(64) },
        worldDisposition: {},
      },
    };
    const encoded = encodeCylinderDynamicReceipt(fixture, receipt);
    expect(Buffer.byteLength(encoded.text, 'utf8')).toBeLessThanOrEqual(
      fixture.retention.maxCommittedSummaryBytes,
    );
    expect(encoded.receipt.report.assessment.verdict).toBe('FAIL');
    expect(encoded.receipt.report.journal).toEqual(receipt.report.journal);
    expect(encoded.receipt.report.oversizedSummary.bytes).toBeGreaterThan(
      fixture.retention.maxCommittedSummaryBytes,
    );
  });
});

describe('strict dynamic contact fallback exclusion (PURE)', () => {
  it('rejects absent registered pair limits before any contact acquisition', () => {
    const ledger = new CylinderNativeLedger(cylinderDynamicBudget(fixture, 'ADMISSION'));
    const hooks = ledger.forWorld(cylinderPlan(fixture, 'admission')[0].id);
    let acquisitions = 0;
    const data = {
      get contact() {
        acquisitions += 1;
        throw new Error('MUST_NOT_ACQUIRE');
      },
    };
    expect(() => copyContacts(data, resourceCounters(), null, hooks)).toThrow(
      'DYNAMIC_REGISTERED_CONTACT_LIMITS_REQUIRED',
    );
    expect(acquisitions).toBe(0);
    expect(ledger.snapshot().calls['data.contact']).toEqual({ dispatched: 0, returned: 0 });
  });
});
