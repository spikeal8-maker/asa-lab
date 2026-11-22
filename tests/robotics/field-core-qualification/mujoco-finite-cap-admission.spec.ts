import { createHash } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  openSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import f from './mujoco-finite-cap-admission.fixture.json';

type Vec = [number, number, number];
type Pose = { qpos: number[]; qvel: number[]; time: number };
type Point = { midpoint: Vec; gap: number };
type Body = { center: Vec; quat: number[]; axis: Vec; gravityIntercept: Vec };
type Contact = {
  index: number;
  geom: number[];
  pos: Vec;
  frame: number[];
  dist: number;
  efc_address: number;
  dim: number;
  exclude: number;
  includemargin: number;
  friction: number[];
  solref: number[];
  solreffriction: number[];
  solimp: number[];
};
type Geometry = {
  contacts: Contact[];
  nefc: number;
  ncon: number;
  efcId: number[];
  efcType: number[];
  warnings: number[][];
};
type Ramp = { frame: number; pre: Pose; contacts: Contact[]; efcId: number[]; efcType: number[] };
type RampInit = {
  xml: string;
  kind: string;
  world: string;
  readback: { options: Record<string, number | number[]> };
};
type Observer = {
  frameError: (frame: number[]) => number;
  captureGeometry: (data: NativeData, resources: Resources, limits: object) => Geometry;
};
type Resources = { temporaryCreated: number; temporaryDeleted: number };
type NativeModel = {
  opt: Record<string, number | ArrayLike<number>>;
  nq: number;
  nv: number;
  ngeom: number;
  nbody: number;
  npair: number;
  ntree: number;
  names: ArrayLike<number>;
  name_geomadr: ArrayLike<number>;
  geom_type: ArrayLike<number>;
  geom_contype: ArrayLike<number>;
  geom_conaffinity: ArrayLike<number>;
  pair_geom1: ArrayLike<number>;
  pair_geom2: ArrayLike<number>;
  pair_dim: ArrayLike<number>;
  jnt_qposadr: ArrayLike<number>;
  body_mass: ArrayLike<number>;
  body_inertia: ArrayLike<number>;
  delete(): void;
};
type NativeData = { qpos: Float64Array; qvel: Float64Array; time: number; delete(): void };
type Native = {
  mj_versionString(): string;
  mj_maxContact(model: NativeModel, g1: number, g2: number, hasMargin: number): number;
  MjModel: { from_xml_string(xml: string): NativeModel };
  MjData: new (model: NativeModel) => NativeData;
  mj_fwdPosition(model: NativeModel, data: NativeData): void;
};
type Sample = {
  id: string;
  ramp: Ramp;
  body: Body;
  tick?: number;
  rawRecordSha256?: string;
  expected: Point[];
};
type Pass = {
  name: string;
  modelCount: number;
  dataCount: number;
  dispatches: number;
  returns: number;
  dataFreed: boolean;
  modelFreed: boolean;
  resources: Resources;
  records: unknown[];
};

const env = process.env;
const fixturePath = fileURLToPath(
  new URL('./mujoco-finite-cap-admission.fixture.json', import.meta.url),
);
const patchPath = fileURLToPath(
  new URL('../../../tools/robotics-field-core/mujoco-finite-cap-v1.patch', import.meta.url),
);
const nativeEnabled = env['ASA_D01_CAP_RUN'] === 'position-only-frozen-1168';
const pinPattern = /^[a-f0-9]{64}$/;
const rampNames = [
  'flat',
  'ramp',
  'chassis_geom',
  ...Array.from({ length: 4 }, (_, i) => 'wheel_geom_' + i),
];

function requireThat(value: unknown, error: string): asserts value {
  if (!value) throw new Error(error);
}

function sha(bytes: Buffer | string) {
  return createHash('sha256').update(bytes).digest('hex');
}

function bytesPinned(path: string, pin: string, maxBytes: number, exactSize?: number) {
  requireThat(isAbsolute(path) && pinPattern.test(pin), 'ABSOLUTE_PINNED_INPUT');
  const size = statSync(path).size;
  requireThat(
    size > 0 && size <= maxBytes && (exactSize === undefined || size === exactSize),
    'INPUT_BYTE_CAP ' + path,
  );
  const bytes = readFileSync(path);
  requireThat(bytes.length === size && sha(bytes) === pin, 'INPUT_SHA256 ' + path);
  return bytes;
}

function fromArchive(root: string, entry: { path: string; bytes: number; sha256: string }) {
  const actual = realpathSync(resolve(root, entry.path));
  requireThat(inside(root, actual), 'ARCHIVE_PATH_ESCAPE');
  return bytesPinned(actual, entry.sha256, entry.bytes, entry.bytes);
}

function readTagged<T>(bytes: Buffer, capture?: { trail: string[]; bytes?: Buffer }): T {
  let p = 0;
  function read(depth: number, trail: string[]): unknown {
    const start = p;
    const value = readValue(depth, trail);
    if (
      capture &&
      trail.length === capture.trail.length &&
      trail.every((part, i) => part === capture.trail[i])
    ) {
      requireThat(!capture.bytes, 'DUPLICATE_CAPTURED_RECORD');
      capture.bytes = bytes.subarray(start, p);
    }
    return value;
  }
  function readValue(depth: number, trail: string[]): unknown {
    requireThat(depth < 48 && p < bytes.length, 'TAGGED_CURSOR');
    const tag = bytes.readUInt8(p++);
    if (tag <= 2) return [null, false, true][tag];
    if (tag === 3) {
      const value = bytes.readDoubleLE(p);
      p += 8;
      requireThat(Number.isFinite(value), 'TAGGED_NONFINITE');
      return value;
    }
    const count = bytes.readUInt32LE(p);
    p += 4;
    requireThat(count <= bytes.length - p, 'TAGGED_COUNT');
    if (tag === 4 || tag === 7) {
      const payload = bytes.subarray(p, p + count);
      p += count;
      return tag === 4 ? payload.toString('utf8') : payload;
    }
    if (tag === 5)
      return Array.from({ length: count }, (_, i) => read(depth + 1, [...trail, String(i)]));
    requireThat(tag === 6 && count <= (bytes.length - p) / 2, 'TAGGED_OBJECT');
    return Object.fromEntries(
      Array.from({ length: count }, () => {
        const key = readValue(depth + 1, trail);
        requireThat(typeof key === 'string', 'TAGGED_OBJECT_KEY');
        return [key, read(depth + 1, [...trail, key])];
      }),
    );
  }
  const result = read(0, []);
  requireThat(p === bytes.length, 'TAGGED_TRAILING_DATA');
  return result as T;
}

function wantedFrames(bytes: Buffer, indices: number[]) {
  const requested = new Set(indices);
  const output = new Map<number, Buffer>();
  let start = 0;
  for (let index = 0; index <= Math.max(...indices); index++) {
    const length = bytes.readUInt32LE(start);
    const end = start + 4 + length;
    requireThat(length > 0 && end <= bytes.length, 'ARCHIVE_FRAME_LENGTH');
    if (requested.has(index)) output.set(index, bytes.subarray(start + 4, end));
    start = end;
  }
  return (index: number) => {
    const frame = output.get(index);
    requireThat(frame, 'UNREGISTERED_ARCHIVE_FRAME');
    return frame;
  };
}

function f64(values: ArrayLike<number>) {
  const bytes = Buffer.alloc(values.length * 8);
  Array.from(values).forEach((value, i) => {
    requireThat(Number.isFinite(value), 'FINITE_FLOAT_WORD_REQUIRED');
    bytes.writeDoubleLE(value, i * 8);
  });
  return bytes.toString('hex');
}

const v = (x: number, y: number, z: number): Vec => [x, y, z];
const add = (a: Vec, b: Vec): Vec => v(a[0] + b[0], a[1] + b[1], a[2] + b[2]);
const sub = (a: Vec, b: Vec): Vec => v(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const scale = (a: Vec, k: number): Vec => v(a[0] * k, a[1] * k, a[2] * k);
const cross = (a: Vec, b: Vec): Vec =>
  v(a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]);
const norm = (a: Vec) => Math.hypot(...a);
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const close = (a: number, b: number) => Math.abs(a - b) <= f.math.witnessAgreementM;
const exact = (value: unknown) =>
  JSON.stringify(value, (_, v: unknown) => (Object.is(v, -0) ? 'negative-zero' : v));
const same = (a: unknown, b: unknown) => exact(a) === exact(b);

function canInDeck(qpos: number[]): Body {
  const [theta, x, y, z, w, qx, qy, qz] = qpos;
  const c = Math.cos(theta / 2),
    s = Math.sin(theta / 2);
  const center = v(
    Math.cos(theta) * x - Math.sin(theta) * z,
    y,
    Math.sin(theta) * x + Math.cos(theta) * z,
  );
  const quat = [c * w + s * qy, c * qx - s * qz, c * qy - s * w, c * qz + s * qx];
  const [rw, rx, ry, rz] = quat;
  const axis = v(2 * (rx * rz + rw * ry), 2 * (ry * rz - rw * rx), 1 - 2 * (rx * rx + ry * ry));
  const gravityIntercept = v(center[0] + center[2] * Math.tan(theta), center[1], 0);
  return { center, quat, axis, gravityIntercept };
}

function analyticWitness(body: Body): Point[] {
  const a = body.axis[2] >= 0 ? body.axis : scale(body.axis, -1);
  const radius = f.can.radius;
  const base = sub(body.center, scale(a, f.can.halfHeight));
  const rimUp = v(-a[2] * a[0], -a[2] * a[1], 1 - a[2] * a[2]);
  const rimSlope = norm(rimUp);
  const reach = radius * rimSlope;
  if (!(
    a[2] > 1e-15 &&
    rimSlope > 1e-15 &&
    Math.abs(base[2]) < reach &&
    base[2] - reach > -2 * f.deck.halfSize[2] &&
    base[2] - reach + 2 * f.can.halfHeight * a[2] > 0
  ))
    return [];
  const depth = reach - base[2];
  for (let j = 0; j < 2; j++) {
    const extent = radius * Math.sqrt(Math.max(0, 1 - a[j] * a[j]));
    const immersedEnd = base[j] + (a[j] * depth) / a[2];
    if (
      !(
        Math.max(Math.abs(base[j]), Math.abs(immersedEnd)) + extent <
        f.deck.halfSize[j] - f.deck.interior
      )
    )
      return [];
  }
  const downhill = scale(rimUp, -1 / rimSlope);
  const tangent = cross(a, downhill);
  const phi = Math.acos((1 + base[2] / reach) / 2);
  return [0, phi, -phi].map((angle) => {
    const dir = add(scale(downhill, Math.cos(angle)), scale(tangent, Math.sin(angle)));
    const rim = add(base, scale(dir, radius));
    return { midpoint: v(rim[0], rim[1], rim[2] / 2), gap: rim[2] };
  });
}

function support(points: Vec[], intercept: Vec) {
  const area = cross(sub(points[1], points[0]), sub(points[2], points[0]))[2] / 2;
  const margin = Math.min(
    ...points.map((point, i) => {
      const edge = sub(points[(i + 1) % 3], point);
      return (Math.sign(area) * cross(edge, sub(intercept, point))[2]) / norm(edge);
    }),
  );
  return { margin, area: Math.abs(area) };
}

function sharedXml(xml: string) {
  const deck = f.deck;
  const can = f.can;
  const seam = '</worldbody><contact>';
  requireThat(
    xml.split(seam).length === 2 && xml.split('</contact>').length === 2,
    'R3_MODEL_SEAM',
  );
  const model =
    '<geom name="' +
    deck.supportName +
    '" type="box" size="' +
    deck.halfSize.join(' ') +
    '" pos="0 ' +
    deck.y +
    ' ' +
    -deck.halfSize[2] +
    '" contype="0" conaffinity="0"/>' +
    '<body name="asa1168_can_body" pos="0 ' +
    deck.y +
    ' ' +
    can.halfHeight +
    '"><freejoint name="asa1168_can_free"/><inertial pos="0 0 0" mass="' +
    can.mass +
    '" diaginertia="' +
    can.inertia.join(' ') +
    '"/><geom name="' +
    deck.canName +
    '" type="cylinder" size="' +
    can.radius +
    ' ' +
    can.halfHeight +
    '" contype="0" conaffinity="0"/></body>';
  const pair =
    '<pair geom1="' +
    deck.supportName +
    '" geom2="' +
    deck.canName +
    '" condim="3" margin="0" gap="0" friction="' +
    deck.friction +
    ' ' +
    deck.friction +
    ' 0 0 0" solref="0.004 1" solreffriction="0 0" solimp="0.99 0.99 0.001 0.5 2"/>';
  return xml.replace(seam, model + seam).replace('</contact>', pair + '</contact>');
}

function readInputs() {
  const archiveRoot = env['ASA_D01_CAP_ARCHIVES'] ?? '';
  const oraclePath = env['ASA_D01_CAP_ORACLE'] ?? '';
  requireThat(isAbsolute(archiveRoot), 'ABSOLUTE_ARCHIVE_ROOT');
  const root = realpathSync(archiveRoot);
  const records = JSON.parse(fromArchive(root, f.archives.cylinderPre).toString('utf8')) as {
    raw: { sha256: string; bytes: number };
    world: string;
    schema: string;
    count: number;
    records: {
      tick: number;
      intervalStartUs: number;
      recordBytes: number;
      recordSha256: string;
      preState: Pose;
      preStateFloat64LE: Record<keyof Pose, string>;
    }[];
  };
  const oracle = JSON.parse(
    bytesPinned(oraclePath, f.expectedGeometrySha256, 4_000_000).toString('utf8'),
  ) as {
    poses: {
      tick: number;
      rawFrame: number;
      recordSha256: string;
      stages: {
        interiorMidDepth: {
          contacts: Point[];
          triangle: { margin: number; area: number };
        };
      };
    }[];
  };
  requireThat(
    records.schema === 'CYLINDER_RETAINED_PRE_INPUTS_V1' &&
      records.world === f.can.world &&
      records.count === f.can.count &&
      records.records.length === f.can.count &&
      oracle.poses.length === f.can.count &&
      records.raw.sha256 === f.archives.cylinderJournal.sha256 &&
      records.raw.bytes === f.archives.cylinderJournal.bytes,
    'FROZEN_CYLINDER_INPUTS',
  );
  const originalCan = wantedFrames(
    fromArchive(root, f.archives.cylinderJournal),
    oracle.poses.map((pose) => pose.rawFrame),
  );
  const r3 = wantedFrames(fromArchive(root, f.archives.rollingJournal), [
    f.rolling.invocationFrame,
    f.rolling.initialFrame,
    ...f.rolling.profiles.map((row) => row.frame),
  ]);
  const invokeBytes = r3(f.rolling.invocationFrame);
  const invocation = readTagged<{ kind: string; fixtureSha256: string }>(invokeBytes);
  const initBytes = r3(f.rolling.initialFrame);
  const init = readTagged<RampInit>(initBytes);
  requireThat(
    sha(invokeBytes) === f.rolling.invocationSha256 &&
      invocation.kind === 'invocation' &&
      invocation.fixtureSha256 === f.rolling.sourceFixtureSha256 &&
      sha(initBytes) === f.rolling.initialPayloadSha256 &&
      init.kind === 'world-initialization' &&
      init.world === f.rolling.world &&
      sha(init.xml) === f.rolling.xmlSha256,
    'R3_INVOCATION_AND_ORIGINAL_MODEL',
  );
  const ramps = f.rolling.profiles.map((row) => {
    const original = r3(row.frame);
    const decoded = readTagged<{
      world: string;
      tick: number;
      record: { tick: number; parity: Ramp };
    }>(original);
    const data = decoded.record.parity;
    requireThat(
      sha(original) === row.sha256 &&
        decoded.world === f.rolling.world &&
        decoded.tick === row.tick &&
        decoded.record.tick === row.tick &&
        data.contacts.length === row.contacts &&
        data.pre.qpos.length === 11 &&
        data.pre.qvel.length === 10 &&
        data.efcId.length === 3 * row.contacts &&
        data.efcType.every((kind) => kind === 7),
      'R3_FROZEN_CONTROL_FRAME',
    );
    return { ...data, frame: row.frame };
  });
  const samples: Sample[] = records.records.map((cached, i) => {
    const tick = f.can.firstTick + i;
    const proof = oracle.poses[i];
    const terminal = tick === f.can.lastTick;
    const capture: { trail: string[]; bytes?: Buffer } = {
      trail: ['observation', 'lastObservation'],
    };
    const rawFrame = readTagged<{
      bytes?: Buffer;
      world: string;
      tick: number;
      kind: string;
      error?: string;
    }>(originalCan(proof.rawFrame), terminal ? capture : undefined);
    const inner = terminal ? capture.bytes : rawFrame.bytes;
    requireThat(
      inner &&
        rawFrame.kind === (terminal ? 'failure' : 'pre-failure-tick') &&
        (!terminal || rawFrame.error === 'INDETERMINATE_STAGE_END_NO_STABLE_OR_TIP'),
      'CAN_ORIGINAL_RECORD_KIND',
    );
    const raw = readTagged<{ tick: number; intervalStartUs: number; parity: { pre: Pose } }>(inner);
    const { qpos, qvel, time } = raw.parity.pre;
    requireThat(
      rawFrame.world === f.can.world &&
        rawFrame.tick === tick &&
        raw.tick === tick &&
        cached.tick === tick &&
        proof.tick === tick &&
        tick <= f.can.lastTick &&
        raw.intervalStartUs === (tick - 1) * 500 &&
        cached.intervalStartUs === raw.intervalStartUs &&
        inner.length === cached.recordBytes &&
        sha(inner) === cached.recordSha256 &&
        proof.recordSha256 === cached.recordSha256 &&
        qpos.length === 8 &&
        qvel.length === 7 &&
        same(
          [f64(qpos), f64(qvel), f64([time])],
          [
            cached.preStateFloat64LE.qpos,
            cached.preStateFloat64LE.qvel,
            cached.preStateFloat64LE.time,
          ],
        ) &&
        qpos.every((value, j) => value === cached.preState.qpos[j]) &&
        qvel.every((value, j) => value === cached.preState.qvel[j]) &&
        time === cached.preState.time,
      'CYLINDER_FROZEN_PRE ' + tick,
    );
    const body = canInDeck(qpos);
    const expected = analyticWitness(body);
    const known = proof.stages.interiorMidDepth;
    requireThat(
      expected.length === 3 &&
        expected.every((point) => point.gap < 0) &&
        expected.every(
          (point, j) =>
            close(point.gap, known.contacts[j].gap) &&
            norm(sub(point.midpoint, known.contacts[j].midpoint)) <= f.math.witnessAgreementM,
        ),
      'INDEPENDENT_HALF_DEPTH_WITNESS ' + tick,
    );
    const polygon = support(
      expected.map(({ midpoint }) => v(midpoint[0], midpoint[1], 0)),
      body.gravityIntercept,
    );
    requireThat(
      polygon.margin >= f.math.minimumProjectedSupportM &&
        polygon.area > 0 &&
        close(polygon.margin, known.triangle.margin) &&
        close(polygon.area, known.triangle.area),
      'SEALED_SUPPORT_HULL ' + tick,
    );
    return {
      id: 'pre-' + tick,
      tick,
      rawRecordSha256: cached.recordSha256,
      ramp: ramps[i % ramps.length],
      body,
      expected,
    };
  });
  const primary = samples[0].body;
  const shift = (x: number, z: number): Body => ({
    ...primary,
    center: add(primary.center, v(x, 0, z)),
  });
  const level = (z: number): Body => ({
    ...primary,
    center: v(0, 0, z),
    quat: [1, 0, 0, 0],
    axis: v(0, 0, 1),
  });
  const angle = (80 * Math.PI) / 180;
  const axis = v(Math.sin(angle), 0, Math.cos(angle));
  const near = v(0.482, 0, f.can.radius * axis[0] - 0.004);
  const sweptSide: Body = {
    ...primary,
    center: add(near, scale(axis, f.can.halfHeight)),
    axis,
    quat: [Math.cos(angle / 2), 0, Math.sin(angle / 2), 0],
  };
  const radiusX = f.can.radius * axis[2];
  requireThat(
    near[0] + radiusX < f.deck.halfSize[0] - f.deck.interior &&
      near[0] + (0.004 * axis[0]) / axis[2] + radiusX > f.deck.halfSize[0],
    'SWEEP_HOLDOUT_MUST_DISCRIMINATE',
  );
  const cases = [
    shift(0.48, 0),
    level(f.can.halfHeight - 1e-6),
    shift(0, 0.01),
    shift(0, -0.004),
    level(-2 * f.deck.halfSize[2] - f.can.halfHeight + 1e-6),
    sweptSide,
  ];
  const holdouts: Sample[] = f.holdouts.map((id, i) => {
    const body = cases[i];
    requireThat(analyticWitness(body).length === 0, 'HOLDOUT_IS_IN_CANDIDATE_DOMAIN ' + id);
    return { id, body, ramp: ramps[i % ramps.length], expected: [] };
  });
  const xml = sharedXml(init.xml);
  return { samples, holdouts, xml, options: init.readback.options };
}

function inside(root: string, path: string) {
  const rel = relative(root, path);
  return !!rel && rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel);
}

function layer(root: string, name: string, pin: string, maxBytes: number) {
  requireThat(isAbsolute(root), 'ABSOLUTE_BINARY_ROOT');
  const location = realpathSync(root);
  const path = realpathSync(resolve(location, name));
  requireThat(inside(location, path), 'BINARY_PATH_ESCAPE');
  return { path, bytes: bytesPinned(path, pin, maxBytes) };
}

function openReceipt(path: string) {
  requireThat(
    isAbsolute(path) && /^[a-z0-9][a-z0-9.-]*[.]json$/i.test(basename(path)),
    'ABSOLUTE_JSON_RECEIPT',
  );
  const parent = realpathSync(dirname(path));
  requireThat(inside(realpathSync(tmpdir()), parent), 'RECEIPT_REQUIRES_OS_TEMP_SUBDIR');
  return openSync(resolve(parent, basename(path)), 'wx', 0o600);
}

function allRows(geo: Geometry, contact: Contact) {
  const start = contact.efc_address;
  return (
    Number.isSafeInteger(start) &&
    start >= 0 &&
    start + 3 <= geo.nefc &&
    [0, 1, 2].every((j) => geo.efcType[start + j] === 7 && geo.efcId[start + j] === contact.index)
  );
}

function contactFields(contact: Contact, names: string[]) {
  return [
    contact.geom.map((id) => names[id]),
    contact.pos,
    contact.frame,
    contact.dist,
    contact.dim,
    contact.exclude,
    contact.includemargin,
    contact.friction,
    contact.solref,
    contact.solreffriction,
    contact.solimp,
  ];
}

function sameRamp(geometry: Geometry, raw: Ramp, names: string[]) {
  const contacts = geometry.contacts.filter((c) =>
    c.geom.every((id) => rampNames.includes(names[id])),
  );
  return (
    same(
      contacts.map((c) => contactFields(c, names)),
      raw.contacts.map((c) => contactFields(c, rampNames)),
    ) &&
    contacts.every((c, i) => {
      const old = raw.contacts[i].efc_address;
      return (
        allRows(geometry, c) &&
        old === 3 * i &&
        [0, 1, 2].every((j) => raw.efcType[old + j] === 7 && raw.efcId[old + j] === i)
      );
    })
  );
}

function capProof(can: Contact[], sample: Sample, canId: number, geometry: Geometry) {
  const remaining = new Set(can);
  const rim: Vec[] = [];
  const floor: Vec[] = [];
  requireThat(
    can.length === f.limits.candidateCapContacts && can.length * 3 === f.limits.candidateCapRows,
    'CANDIDATE_CONTACT_COUNT ' + sample.id,
  );
  for (const expected of sample.expected) {
    const found = [...remaining].find(
      (contact) =>
        close(contact.dist, expected.gap) &&
        norm(sub(contact.pos, add(expected.midpoint, v(0, f.deck.y, 0)))) <=
          f.math.witnessAgreementM,
    );
    requireThat(
      found && found.dist < 0 && allRows(geometry, found),
      'NATIVE_SIGNED_RIM_CONTACT ' + sample.id,
    );
    const orientation = found.geom[0] === canId ? -1 : 1;
    const normal = scale(v(found.frame[0], found.frame[1], found.frame[2]), orientation);
    requireThat(
      norm(sub(normal, v(0, 0, 1))) <= f.math.frameTolerance &&
        same(found.friction.slice(0, 2), [f.deck.friction, f.deck.friction]) &&
        same(found.solref, [0.004, 1]) &&
        same(found.solimp, [0.99, 0.99, 0.001, 0.5, 2]),
      'CANDIDATE_NORMAL_OR_MATERIAL ' + sample.id,
    );
    const midpoint = sub(found.pos, v(0, f.deck.y, 0));
    const onDeck = add(midpoint, scale(normal, -found.dist / 2));
    const onCan = add(midpoint, scale(normal, found.dist / 2));
    const fromBase = sub(onCan, sub(sample.body.center, scale(sample.body.axis, f.can.halfHeight)));
    requireThat(
      Math.abs(onDeck[2]) <= f.math.surfaceToleranceM &&
        Math.abs(onDeck[0]) < f.deck.halfSize[0] - f.deck.interior &&
        Math.abs(onDeck[1]) < f.deck.halfSize[1] - f.deck.interior &&
        Math.abs(dot(fromBase, sample.body.axis)) <= f.math.surfaceToleranceM &&
        Math.abs(norm(fromBase) - f.can.radius) <= f.math.surfaceToleranceM,
      'FINITE_FACE_RIM_GEOMETRY ' + sample.id,
    );
    remaining.delete(found);
    rim.push(onCan);
    floor.push(onDeck);
  }
  const polygon = support(floor, sample.body.gravityIntercept);
  requireThat(
    remaining.size === 0 && polygon.margin >= f.math.minimumProjectedSupportM && polygon.area > 0,
    'NATIVE_SUPPORT_HULL ' + sample.id,
  );
  return { ...polygon, rim, floor };
}

function newPass(name: string): Pass {
  return {
    name,
    modelCount: 0,
    dataCount: 0,
    dispatches: 0,
    returns: 0,
    dataFreed: false,
    modelFreed: false,
    resources: { temporaryCreated: 0, temporaryDeleted: 0 },
    records: [],
  };
}

function observe(
  M: Native,
  observer: Observer,
  input: ReturnType<typeof readInputs>,
  samples: Sample[],
  pass: Pass,
) {
  requireThat(M.mj_versionString() === f.engine.version, 'NATIVE_VERSION');
  const model = M.MjModel.from_xml_string(input.xml);
  pass.modelCount++;
  let data: NativeData | undefined;
  try {
    const strings = Buffer.from(Array.from(model.names));
    const names = Array.from(model.name_geomadr, (off) =>
      strings.subarray(off, strings.indexOf(0, off)).toString('utf8'),
    );
    const canId = names.indexOf(f.deck.canName),
      deckId = names.indexOf(f.deck.supportName);
    const pairs = Array.from(model.pair_geom1, (a, i) => ({
      geom: [a, model.pair_geom2[i]],
      maxContacts: M.mj_maxContact(model, a, model.pair_geom2[i], 0),
    }));
    const option = Object.fromEntries(
      Object.entries(input.options).map(([key, val]) => [
        key,
        Array.isArray(val) ? Array.from(model.opt[key] as ArrayLike<number>) : model.opt[key],
      ]),
    );
    const limits = {
      pairCaps: pairs,
      nbody: model.nbody,
      ngeom: model.ngeom,
      maxIslands: model.ntree,
      maxContacts: f.limits.roomContacts,
      maxConstraintRows: f.limits.roomConstraintRows,
      warningCount: 7,
      maxWarningObservations: samples.length,
      maxWarningGets: 7 * samples.length,
      maxContactVectors: samples.length,
      maxContactGets: f.limits.roomContacts * samples.length,
    };
    pass.records.push({ option, names, pairs });
    requireThat(
      model.nq === 18 &&
        model.nv === 16 &&
        model.ngeom === 9 &&
        model.nbody === 7 &&
        model.npair === 9 &&
        same(Array.from(model.jnt_qposadr), [0, 7, 8, 9, 10, 11]) &&
        same(option, input.options) &&
        model.geom_type[canId] === 5 &&
        model.geom_type[deckId] === 6 &&
        model.body_mass[model.nbody - 1] === f.can.mass &&
        same(Array.from(model.body_inertia).slice(-3), f.can.inertia) &&
        [canId, deckId].every(
          (id) => model.geom_contype[id] === 0 && model.geom_conaffinity[id] === 0,
        ) &&
        pairs.every(
          ({ geom, maxContacts }, i) =>
            maxContacts > 0 &&
            maxContacts <= f.limits.stockContactsPerPair &&
            geom.length === 2 &&
            model.pair_dim[i] === 3,
        ) &&
        pairs.reduce((sum, pair) => sum + pair.maxContacts, 0) === f.limits.roomContacts &&
        pairs.some(
          ({ geom, maxContacts }) =>
            geom.includes(canId) &&
            geom.includes(deckId) &&
            maxContacts === f.limits.stockContactsPerPair,
        ),
      'COMPILED_MODEL_AND_PAIR_CAPACITY',
    );
    data = new M.MjData(model);
    pass.dataCount++;
    const received: Contact[][] = [];
    for (const sample of samples) {
      requireThat(pass.dispatches < samples.length, 'POSITION_DISPATCH_CAP');
      const requested = {
        qpos: [
          ...sample.ramp.pre.qpos,
          sample.body.center[0],
          sample.body.center[1] + f.deck.y,
          sample.body.center[2],
          ...sample.body.quat,
        ],
        qvel: [...sample.ramp.pre.qvel, 0, 0, 0, 0, 0, 0],
        time: sample.ramp.pre.time,
      };
      data.qpos.set(requested.qpos);
      data.qvel.set(requested.qvel);
      data.time = requested.time;
      const words = (state: { qpos: ArrayLike<number>; qvel: ArrayLike<number>; time: number }) => [
        f64(state.qpos),
        f64(state.qvel),
        f64([state.time]),
      ];
      const before = words(data);
      requireThat(same(before, words(requested)), 'FROZEN_RESTORE_READBACK');
      const record: Record<string, unknown> = {
        id: sample.id,
        tick: sample.tick,
        ramp: sample.ramp.frame,
        sourceRecordSha256: sample.rawRecordSha256,
        before,
      };
      pass.records.push(record);
      pass.dispatches++;
      M.mj_fwdPosition(model, data);
      pass.returns++;
      const after = words(data);
      const measured = observer.captureGeometry(data, pass.resources, limits);
      const cap = measured.contacts.filter(
        (c) => c.geom.includes(canId) && c.geom.includes(deckId),
      );
      Object.assign(record, {
        after,
        measured,
        expected: sample.expected,
        resources: { ...pass.resources },
      });
      const used = measured.contacts.flatMap((c) => [
        c.efc_address,
        c.efc_address + 1,
        c.efc_address + 2,
      ]);
      requireThat(
        same(before, after) &&
          measured.nefc === 3 * measured.ncon &&
          new Set(used).size === measured.nefc &&
          measured.contacts.length === measured.ncon &&
          pass.resources.temporaryCreated === pass.resources.temporaryDeleted &&
          measured.warnings.every((warning) => warning.every((val) => val === 0)) &&
          measured.contacts.every(
            (c) =>
              c.exclude === 0 &&
              allRows(measured, c) &&
              observer.frameError(c.frame) <= f.math.frameTolerance,
          ),
        'POSITION_STATE_ROWS_OR_CLEANUP ' + sample.id,
      );
      requireThat(sameRamp(measured, sample.ramp, names), 'R3_GEOMETRY_OR_ROW_PARITY ' + sample.id);
      if (sample.expected.length) record.capProof = capProof(cap, sample, canId, measured);
      received.push(cap);
    }
    return { contacts: received, names };
  } finally {
    try {
      if (data) {
        data.delete();
        pass.dataFreed = true;
      }
    } finally {
      model.delete();
      pass.modelFreed = true;
    }
  }
}

async function loadNative(modulePath: string, binary: Buffer) {
  const factory = (await import(/* @vite-ignore */ pathToFileURL(modulePath).href)) as {
    default: (opts: {
      wasmBinary: Buffer;
      locateFile: (name: string) => string;
    }) => Promise<Native>;
  };
  return factory.default({
    wasmBinary: binary,
    locateFile(name) {
      requireThat(name === 'mujoco.wasm', 'UNEXPECTED_RUNTIME_RESOURCE');
      return resolve(dirname(modulePath), name);
    },
  });
}

it('pins the finite pair and the scoped patch without importing either engine', () => {
  expect(sha(readFileSync(patchPath))).toBe(f.patchSha256);
  expect([f.can.count, f.holdouts.length]).toEqual([401, 6]);
  expect(f.limits.candidatePositionCalls).toBe(f.can.count + f.holdouts.length);
  expect(f.limits.stockPositionCalls).toBe(f.holdouts.length);
  expect(f.limits.candidateCapRows).toBe(3 * f.limits.candidateCapContacts);
});

it.runIf(Boolean(env['ASA_D01_CAP_ARCHIVES'] && env['ASA_D01_CAP_ORACLE']))(
  'binds every original PRE record and independently reproduces all sealed top-face witnesses',
  () => {
    const input = readInputs();
    expect(input.samples).toHaveLength(f.can.count);
    expect(input.holdouts).toHaveLength(f.holdouts.length);
    expect(sha(input.xml)).toBe(f.engine.candidate.xmlSha256);
  },
);

it.runIf(nativeEnabled)(
  'acquires only positional geometry for the patched pair and stock controls',
  async () => {
    const fixturePin = env['ASA_D01_CAP_FIXTURE_SHA256'] ?? '';
    const sourcePin = env['ASA_D01_CAP_SOURCE_SHA256'] ?? '';
    bytesPinned(fixturePath, fixturePin, 32_768);
    bytesPinned(fileURLToPath(import.meta.url), sourcePin, 65_536);
    bytesPinned(patchPath, f.patchSha256, 32_768);
    const input = readInputs();
    requireThat(sha(input.xml) === f.engine.candidate.xmlSha256, 'EXACT_COMPOSED_XML');
    const candidateRoot = env['ASA_D01_CAP_CANDIDATE'] ?? '';
    const stockRoot = env['ASA_D01_CAP_STOCK'] ?? '';
    const observer = env['ASA_D01_CAP_OBSERVER'] ?? '';
    bytesPinned(observer, f.observerSha256, 200_000);
    const cModule = layer(candidateRoot, 'mujoco.js', f.engine.candidate.moduleSha256, 2_000_000);
    const cWasm = layer(candidateRoot, 'mujoco.wasm', f.engine.candidate.wasmSha256, 100_000_000);
    layer(candidateRoot, 'mujoco.d.ts', f.engine.candidate.declarationsSha256, 2_000_000);
    layer(candidateRoot, 'build-receipt.json', f.engine.candidate.buildReceiptSha256, 200_000);
    const sModule = layer(stockRoot, 'mujoco.js', f.engine.stock.moduleSha256, 2_000_000);
    const sWasm = layer(stockRoot, 'mujoco.wasm', f.engine.stock.wasmSha256, 100_000_000);
    const out = openReceipt(env['ASA_D01_CAP_OUTPUT'] ?? '');
    const candidate = newPass('candidate');
    const stock = newPass('stock');
    const receipt: Record<string, unknown> = {
      status: 'FAIL',
      sourcePin,
      fixturePin,
      patchPin: f.patchSha256,
      xmlPin: f.engine.candidate.xmlSha256,
      candidate,
      stock,
      dynamicCalls: 0,
    };
    try {
      const observerModule = (await import(
        /* @vite-ignore */ pathToFileURL(observer).href
      )) as Observer;
      const comparison = observe(
        await loadNative(cModule.path, cWasm.bytes),
        observerModule,
        input,
        [...input.samples, ...input.holdouts],
        candidate,
      );
      const original = observe(
        await loadNative(sModule.path, sWasm.bytes),
        observerModule,
        input,
        input.holdouts,
        stock,
      );
      requireThat(
        candidate.dispatches === f.limits.candidatePositionCalls &&
          stock.dispatches === f.limits.stockPositionCalls &&
          [candidate, stock].every(
            (p) =>
              p.modelCount === f.limits.modelsPerPass &&
              p.dataCount === f.limits.dataPerPass &&
              p.dispatches === p.returns &&
              p.dataFreed &&
              p.modelFreed,
          ),
        'EXACT_POSITION_CALL_OR_RESOURCE_TOTAL',
      );
      for (let i = 0; i < input.holdouts.length; i++) {
        requireThat(
          same(
            comparison.contacts[input.samples.length + i].map((c) =>
              contactFields(c, comparison.names),
            ),
            original.contacts[i].map((c) => contactFields(c, original.names)),
          ),
          'STOCK_HOLDOUT_GEOMETRY ' + input.holdouts[i].id,
        );
      }
      receipt.status = 'PASS_POSITION_ONLY';
    } catch (error) {
      receipt.firstDifference = String(error).slice(0, 1200);
      throw error;
    } finally {
      try {
        const bytes = JSON.stringify(receipt) + '\n';
        requireThat(
          Buffer.byteLength(bytes) <= f.limits.maxReceiptBytes,
          'POSITION_RECEIPT_BYTE_CAP',
        );
        writeFileSync(out, bytes);
        fsyncSync(out);
      } finally {
        closeSync(out);
      }
    }
  },
  120_000,
);
