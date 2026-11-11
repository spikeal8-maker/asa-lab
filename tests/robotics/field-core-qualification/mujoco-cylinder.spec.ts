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
} from '../../../tools/robotics-field-core/mujoco-cylinder.mjs';

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
    surfacevel: [0, 0, 0, 0, 0, 0],
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
        surfacevel: [0, 0, 0, 0, 0, 0],
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
        nativeccd: 'enable',
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
      expect(contact.surfacevel).toHaveLength(6);
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
