import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { expect, it } from 'vitest';

import { createEditableRampGeometry, type RampVector } from './editable-ramp-geometry.js';
import fixture from './editable-ramp-native-static.fixture.json';

const folder = dirname(fileURLToPath(import.meta.url));
const root = resolve(folder, '../../..');
const sourceFile = basename(fileURLToPath(import.meta.url));
const fixtureFile = 'editable-ramp-native-static.fixture.json';
const geometryFile = 'editable-ramp-geometry.ts';
const guardVersion = 'ASA_RAMP_NATIVE_STATIC_ADMISSION_V1';
const optIn = 'I_ACCEPT_ONE_NATIVE_STATIC_RUN';
const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const { common, tolerances, limits, engine } = fixture;
type Case = (typeof fixture.cases)[number];

function check(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(code);
}

const dot = (a: readonly number[], b: readonly number[]) =>
  a.reduce((sum, value, index) => sum + value * b[index]!, 0);
const v = (a: readonly number[], offset = 0): RampVector => [
  a[offset]!,
  a[offset + 1]!,
  a[offset + 2]!,
];
const difference = (a: RampVector, b: RampVector): RampVector => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2],
];
const distance = (a: RampVector, b: RampVector) => Math.hypot(...difference(a, b));
const cross = (a: RampVector, b: RampVector): RampVector => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

function near(actual: number, expected: number, tolerance: number, code: string) {
  check(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance, code);
}

function closeVector(
  actual: readonly number[],
  expected: readonly number[],
  tolerance: number,
  code: string,
) {
  check(actual.length === expected.length, code);
  actual.forEach((value, index) => near(value, expected[index]!, tolerance, code));
}

function prepared(entry: Case) {
  const shape = createEditableRampGeometry({
    lengthMeters: common.run,
    widthMeters: entry.width,
    riseMeters: entry.rise,
    baseThicknessMeters: common.thickness,
    originMeters: [entry.x, common.y, common.z],
    headingRadians: common.heading,
  });
  const witness = (contact: typeof common.support) => {
    const point: RampVector = [
      entry.x + contact.u,
      common.y + contact.v,
      common.z + (contact.u / common.run) * entry.rise,
    ];
    const center = point.map(
      (coordinate, index) =>
        coordinate + (common.radius + contact.clearance) * shape.normal[index]!,
    );
    return { point, center };
  };
  const support = witness(common.support);
  const separated = witness(common.separated);
  const xml = [
    '<mujoco model="asa_static_' + entry.id + '">',
    '<compiler inertiafromgeom="true"/>',
    '<option gravity="0 0 -9.81" cone="elliptic"/>',
    '<default><geom contype="0" conaffinity="0" condim="3" margin="0" gap="0"/></default>',
    '<asset><mesh name="incline" vertex="' +
      shape.vertices.flat().join(' ') +
      '" face="' +
      shape.faces.flat().join(' ') +
      '"/></asset>',
    '<worldbody><geom name="ramp" type="mesh" mesh="incline"/>',
    '<body name="support-body" pos="' +
      support.center.join(' ') +
      '"><freejoint/><geom name="support" type="sphere" size="0.05" mass="0.1"/></body>',
    '<body name="separated-body" pos="' +
      separated.center.join(' ') +
      '"><freejoint/><geom name="separated" type="sphere" size="0.05" mass="0.1"/></body>',
    '</worldbody><contact><pair geom1="ramp" geom2="support" condim="3" margin="0" gap="0"/><pair geom1="ramp" geom2="separated" condim="3" margin="0" gap="0"/></contact>',
    '</mujoco>',
    '',
  ].join('\n');
  const pin = sha256(xml);
  check(pin === entry.staticXmlSha256, 'STATIC_XML_PIN_' + entry.id);
  closeVector(shape.normal, entry.oracle.normal, tolerances.state, 'PINNED_NORMAL');
  closeVector(
    support.center,
    entry.oracle.supportCenter,
    tolerances.state,
    'PINNED_SUPPORT_CENTER',
  );
  closeVector(support.point, entry.oracle.supportPoint, tolerances.state, 'PINNED_SUPPORT_POINT');
  closeVector(
    separated.center,
    entry.oracle.separatedCenter,
    tolerances.state,
    'PINNED_CLEARANCE_CENTER',
  );
  near(shape.angleRadians, (entry.angleDegrees * Math.PI) / 180, tolerances.state, 'PINNED_ANGLE');
  return { entry, shape, xml, pin, support, separated };
}

type Input = ReturnType<typeof prepared>;
function rigidMatrix(matrix: number[], quaternion: number[]) {
  const row = [v(matrix), v(matrix, 3), v(matrix, 6)] as const;
  row.forEach((a, i) =>
    row.forEach((b, j) =>
      near(dot(a, b), Number(i === j), tolerances.transform, 'ORTHONORMAL_GEOM'),
    ),
  );
  near(dot(row[0], cross(row[1], row[2])), 1, tolerances.transform, 'RIGHT_HANDED_GEOM');
  const [w, x, y, z] = quaternion as [number, number, number, number];
  near(Math.hypot(w, x, y, z), 1, tolerances.transform, 'UNIT_GEOM_QUATERNION');
  closeVector(
    matrix,
    [
      1 - 2 * (y * y + z * z),
      2 * (x * y - z * w),
      2 * (x * z + y * w),
      2 * (x * y + z * w),
      1 - 2 * (x * x + z * z),
      2 * (y * z - x * w),
      2 * (x * z - y * w),
      2 * (y * z + x * w),
      1 - 2 * (x * x + y * y),
    ],
    tolerances.transform,
    'GEOM_QUATERNION_WORLD_MATRIX',
  );
  return row;
}

function compiled(
  input: Input,
  local: number[],
  faces: number[],
  origin: RampVector,
  matrix: number[],
  quat: number[],
) {
  check(local.length === 24 && faces.length === 36, 'MESH_ARRAY_SHAPE');
  check(
    local.every((item) => Number.isFinite(item) && Math.fround(item) === item),
    'MESH_FLOAT32',
  );
  const rotation = rigidMatrix(matrix, quat);
  const world = Array.from(
    { length: 8 },
    (_, i) =>
      rotation.map((row, k) => origin[k]! + dot(row, v(local, 3 * i))) as unknown as RampVector,
  );
  const used = new Set<number>();
  const assignment = world.map((point) => {
    const index = input.shape.vertices.findIndex(
      (target, i) => !used.has(i) && distance(point, target) <= tolerances.vertexMeters,
    );
    check(index >= 0, 'COMPILED_BIJECTIVE_WORLD_CORNERS');
    used.add(index);
    return index;
  });

  const faceKey = (values: readonly number[]) => [...values].sort((a, b) => a - b).join(',');
  check(
    faces.every((index) => Number.isSafeInteger(index) && index >= 0 && index < 8),
    'FACE_INDEX',
  );
  const actual = Array.from({ length: 12 }, (_, i) =>
    faces.slice(3 * i, 3 * i + 3).map((index) => assignment[index]!),
  );
  check(
    actual.map(faceKey).sort().join('|') === input.shape.faces.map(faceKey).sort().join('|'),
    'CLOSED_FACE_PARITY',
  );

  const ordered = input.shape.vertices.map((_, i) => world[assignment.indexOf(i)]!);
  const average = (vertices: readonly RampVector[]) =>
    [0, 1, 2].map((axis) => vertices.reduce((sum, pos) => sum + pos[axis]!, 0) / vertices.length);
  const center = average(ordered);
  closeVector(center, average(input.shape.vertices), tolerances.vertexMeters, 'COMPILED_CENTER');
  const low = ordered[4]!;
  const high = ordered[5]!;
  const across = ordered[7]!;
  const topNormal = cross(difference(high, low), difference(across, low));
  closeVector(
    topNormal.map((value) => value / Math.hypot(...topNormal)),
    input.shape.normal,
    tolerances.normal,
    'COMPILED_TOP_NORMAL',
  );
  const footprint = {
    x: low[0],
    y: (low[1] + across[1]) / 2,
    run: high[0] - low[0],
    width: across[1] - low[1],
    rise: high[2] - low[2],
    base: ordered[0]![2],
  };
  closeVector(
    Object.values(footprint),
    [input.entry.x, common.y, common.run, input.entry.width, input.entry.rise, -common.thickness],
    2 * tolerances.vertexMeters,
    'COMPILED_FOOTPRINT_AND_PROFILE',
  );
  near(
    Math.atan2(footprint.rise, footprint.run),
    input.shape.angleRadians,
    tolerances.normal,
    'COMPILED_SLOPE',
  );
  return { origin, matrix, quat, local, world: ordered, actual, center, footprint };
}

type Handle = { delete(): void };
type BorrowedVector<T> = { size(): number; get(index: number): T | undefined };
type RecordHandle = Handle & Record<string, unknown>;
type Model = RecordHandle & {
  nq: number;
  nv: number;
  nu: number;
  ngeom: number;
  nbody: number;
  nmesh: number;
  npair: number;
  opt: { cone: number; gravity: unknown };
};
type Contact = RecordHandle & { dim: number; dist: number; exclude: number; efc_address: number };
type Data = RecordHandle & {
  time: number;
  ncon: number;
  nefc: number;
  contact: Handle & BorrowedVector<Contact>;
  warning: BorrowedVector<Handle & { number: number; lastinfo: number }>;
};
type Engine = {
  mj_version(): number;
  mj_versionString(): string;
  mj_forward(model: Model, data: Data): void;
  MjModel: { from_xml_string(xml: string): Model };
  MjData: new (model: Model) => Data;
};

function nativeNumbers(
  raw: unknown,
  type: 'f64' | 'f32' | 'i32',
  size: number,
  code: string,
): number[] {
  check(
    type === 'f64'
      ? raw instanceof Float64Array
      : type === 'f32'
        ? raw instanceof Float32Array
        : raw instanceof Int32Array,
    code + '_TYPE',
  );
  const values = Array.from(raw as Float64Array | Float32Array | Int32Array);
  check(values.length === size && values.every(Number.isFinite), code + '_SHAPE');
  return values;
}

function snapshot(model: Model, data: Data) {
  return {
    time: data.time,
    qpos: nativeNumbers(data.qpos, 'f64', model.nq, 'QPOS'),
    qvel: nativeNumbers(data.qvel, 'f64', model.nv, 'QVEL'),
    qfrcApplied: nativeNumbers(data.qfrc_applied, 'f64', model.nv, 'QFRC_APPLIED'),
    xfrcApplied: nativeNumbers(data.xfrc_applied, 'f64', 6 * model.nbody, 'XFRC_APPLIED'),
    ctrl: model.nu === 0 ? [] : nativeNumbers(data.ctrl, 'f64', model.nu, 'CTRL'),
  };
}

function counters() {
  return { attempted: 0, returned: 0 };
}

function ledger() {
  return {
    module: counters(),
    model: counters(),
    data: counters(),
    forward: counters(),
    nativeSteps: 0,
    owned: 0,
    released: 0,
    peakWorlds: 0,
    activeWorlds: 0,
    cleanupErrors: [] as string[],
  };
}
type Ledger = ReturnType<typeof ledger>;

function own<T extends Handle>(item: T | undefined, record: Ledger): T {
  check(item && typeof item.delete === 'function', 'NATIVE_HANDLE');
  record.owned++;
  return item;
}

function release(item: Handle, record: Ledger) {
  try {
    item.delete();
    record.released++;
  } catch (error) {
    record.cleanupErrors.push(String(error).slice(0, 320));
  }
}

function invoke<T>(record: ReturnType<typeof counters>, call: () => T): T {
  record.attempted++;
  const value = call();
  record.returned++;
  return value;
}

function clearances(input: Input, support: RampVector, separated: RampVector) {
  const signed = (centre: RampVector) =>
    dot(difference(centre, input.support.point), input.shape.normal) - common.radius;
  const observation = { support: signed(support), separated: signed(separated) };
  near(observation.support, common.support.clearance, tolerances.state, 'SUPPORT_SIGNED_GAP');
  near(
    observation.separated,
    common.separated.clearance,
    tolerances.state,
    'CONTROL_POSITIVE_CLEARANCE',
  );
  check(observation.support < 0 && observation.separated > 0, 'DISTINCT_SUPPORT_AND_CONTROL');
  return observation;
}

function readContact(data: Data, input: Input, record: Ledger) {
  check(Number.isInteger(data.ncon) && data.ncon <= limits.maxContacts, 'CONTACT_CAPACITY');
  check(data.ncon === 1 && data.nefc === 3, 'SUPPORT_ONLY_CONTACT_ROWS');
  const vector = own(data.contact, record);
  try {
    check(vector.size() === data.ncon, 'CONTACT_VECTOR_LENGTH');
    const contact = own(vector.get(0), record);
    try {
      const pair = nativeNumbers(contact.geom, 'i32', 2, 'CONTACT_PAIR');
      check(
        (pair[0] === 0 && pair[1] === 1) || (pair[0] === 1 && pair[1] === 0),
        'SUPPORT_PAIR_ID',
      );
      check(
        contact.dim === 3 && contact.exclude === 0 && contact.efc_address === 0,
        'ACTIVE_CONTACT',
      );
      const frame = nativeNumbers(contact.frame, 'f64', 9, 'CONTACT_FRAME');
      const sign = pair[0] === 0 ? 1 : -1;
      const normal = v(frame).map((value) => value * sign);
      closeVector(normal, input.shape.normal, tolerances.normal, 'SUPPORT_NORMAL');
      near(
        contact.dist,
        common.support.clearance,
        tolerances.contactDistanceMeters,
        'SUPPORT_NATIVE_DISTANCE',
      );
      const position = v(nativeNumbers(contact.pos, 'f64', 3, 'CONTACT_POINT'));
      check(
        distance(position, input.support.point) <= tolerances.contactLocationMeters,
        'FINITE_FACE_INTERIOR_CONTACT',
      );
      return { pair, normal, position, dist: contact.dist, rows: data.nefc };
    } finally {
      release(contact, record);
    }
  } finally {
    release(vector, record);
  }
}

function warningReadback(data: Data, record: Ledger) {
  const warnings = data.warning;
  check(warnings.size() === 7, 'WARNING_VECTOR_LENGTH');
  return Array.from({ length: 7 }, (_, i) => {
    const item = own(warnings.get(i), record);
    try {
      return { number: item.number, lastinfo: item.lastinfo };
    } finally {
      release(item, record);
    }
  });
}

function readWorld(model: Model, data: Data, input: Input, record: Ledger) {
  const pos = nativeNumbers(data.geom_xpos, 'f64', model.ngeom * 3, 'GEOM_XPOS');
  const mat = nativeNumbers(data.geom_xmat, 'f64', model.ngeom * 9, 'GEOM_XMAT');
  const authoredGeomPos = nativeNumbers(model.geom_pos, 'f64', model.ngeom * 3, 'GEOM_POS');
  const quat = nativeNumbers(model.geom_quat, 'f64', model.ngeom * 4, 'GEOM_QUAT');
  const mesh = nativeNumbers(model.geom_dataid, 'i32', model.ngeom, 'GEOM_DATAID')[0]!;
  check(mesh === 0 && model.nmesh === 1, 'ACTUAL_MESH_BINDING');
  const indexed = (key: string, expected: number) =>
    near(nativeNumbers(model[key], 'i32', model.nmesh, key)[mesh]!, expected, 0, key);
  indexed('mesh_vertadr', 0);
  indexed('mesh_vertnum', 8);
  indexed('mesh_faceadr', 0);
  indexed('mesh_facenum', 12);
  closeVector(
    pos.slice(0, 3),
    authoredGeomPos.slice(0, 3),
    tolerances.transform,
    'STATIC_GEOM_TRANSLATION',
  );
  const geometry = compiled(
    input,
    nativeNumbers(model.mesh_vert, 'f32', 24, 'MESH_VERT'),
    nativeNumbers(model.mesh_face, 'i32', 36, 'MESH_FACE'),
    v(pos),
    mat.slice(0, 9),
    quat.slice(0, 4),
  );
  closeVector(v(pos, 3), input.support.center, tolerances.state, 'NATIVE_SUPPORT_CENTER');
  closeVector(v(pos, 6), input.separated.center, tolerances.state, 'NATIVE_CONTROL_CENTER');
  const gap = clearances(input, v(pos, 3), v(pos, 6));
  const contact = readContact(data, input, record);
  const warnings = warningReadback(data, record);
  check(
    warnings.every(({ number, lastinfo }) => number === 0 && lastinfo === 0),
    'NATIVE_WARNINGS',
  );
  return { geometry, gap, contact, warnings, sphereCenters: [v(pos, 3), v(pos, 6)] };
}

function checkFactory(model: Model, before: ReturnType<typeof snapshot>, input: Input) {
  check(
    model.nq === 14 &&
      model.nv === 12 &&
      model.nu === 0 &&
      model.ngeom === 3 &&
      model.nbody === 3 &&
      model.nmesh === 1 &&
      model.npair === 2,
    'NATIVE_FACTORY_DIMENSIONS',
  );
  check(model.opt.cone === 1, 'ELLIPTIC_CONTACT_CONE');
  closeVector(
    nativeNumbers(model.opt.gravity, 'f64', 3, 'GRAVITY'),
    [0, 0, -9.81],
    0,
    'EXACT_GRAVITY',
  );
  closeVector(
    nativeNumbers(model.geom_bodyid, 'i32', model.ngeom, 'GEOM_BODY'),
    [0, 1, 2],
    0,
    'FACTORY_BODIES',
  );
  closeVector(
    before.qpos,
    [...input.support.center, 1, 0, 0, 0, ...input.separated.center, 1, 0, 0, 0],
    tolerances.state,
    'FACTORY_QPOS',
  );
  check(
    before.time === 0 &&
      [...before.qvel, ...before.qfrcApplied, ...before.xfrcApplied, ...before.ctrl].every(
        (value) => value === 0,
      ),
    'ZERO_TIME_UNFORCED_STATIONARY_FACTORY',
  );
}

function runCase(module: Engine, input: Input, record: Ledger, stage: (next: string) => void) {
  let model: Model | undefined;
  let data: Data | undefined;
  check(record.activeWorlds === 0 && record.model.attempted < limits.worlds, 'ONE_WORLD_AT_A_TIME');
  try {
    stage('compile');
    model = own(
      invoke(record.model, () => module.MjModel.from_xml_string(input.xml)),
      record,
    );
    record.activeWorlds++;
    record.peakWorlds = Math.max(record.peakWorlds, record.activeWorlds);
    stage('data');
    const active = model;
    data = own(
      invoke(record.data, () => new module.MjData(active)),
      record,
    );
    stage('stationary-factory');
    const before = snapshot(model, data);
    checkFactory(model, before, input);
    stage('forward');
    const state = data;
    invoke(record.forward, () => module.mj_forward(active, state));
    stage('zero-time-parity');
    const after = snapshot(model, data);
    check(JSON.stringify(before) === JSON.stringify(after), 'FORWARD_CHANGED_ZERO_TIME_STATE');
    stage('compile-and-contact-readback');
    return {
      id: input.entry.id,
      xml: input.xml,
      xmlSha256: input.pin,
      before,
      after,
      ...readWorld(model, data, input, record),
    };
  } finally {
    if (data) release(data, record);
    if (model) {
      release(model, record);
      record.activeWorlds--;
    }
  }
}

type Pin = { file: string; bytes: number; sha256: string };
const assetPins = [
  engine.glue,
  engine.wasm,
  engine.declarations,
  engine.license,
  engine.buildReceipt,
  engine.browserReceipt,
];

function filePin(path: string, maxBytes: number): Pin {
  check(
    isAbsolute(path) && realpathSync(path) === resolve(path),
    'CANONICAL_FILE_' + basename(path),
  );
  const stat = lstatSync(path);
  check(
    stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= maxBytes,
    'FILE_SHAPE_' + basename(path),
  );
  const bytes = readFileSync(path);
  check(bytes.length === stat.size, 'FILE_CHANGED_SIZE_' + basename(path));
  return { file: basename(path), bytes: bytes.length, sha256: sha256(bytes) };
}

function checkedAsset(path: string, expected: Pin): Buffer {
  const actual = filePin(path, expected.bytes);
  check(
    actual.file === expected.file &&
      actual.bytes === expected.bytes &&
      actual.sha256 === expected.sha256,
    'PINNED_ASSET_' + expected.file,
  );
  const bytes = readFileSync(path);
  check(
    bytes.length === expected.bytes && sha256(bytes) === expected.sha256,
    'ASSET_CHANGED_' + expected.file,
  );
  return bytes;
}

type Manifest = { name: string; bytes: number; sha256: string };
function manifestLink(first: Manifest[], second: Manifest[]) {
  check(
    Array.isArray(first) && Array.isArray(second) && first.length === 4 && second.length === 4,
    'SEALED_MANIFEST_SHAPE',
  );
  for (let index = 0; index < first.length; index++) {
    const a = first[index]!;
    const b = second[index]!;
    check(
      a.name === b.name && a.bytes === b.bytes && a.sha256 === b.sha256,
      'BROWSER_LINKED_SAME_OBJECT_' + a.name,
    );
  }
  for (const pin of [engine.glue, engine.wasm, engine.declarations]) {
    const matches = first.filter((item) => item.name === pin.file);
    check(
      matches.length === 1 && matches[0]!.bytes === pin.bytes && matches[0]!.sha256 === pin.sha256,
      'BUILD_LINKED_OBJECT_' + pin.file,
    );
  }
}

type Source = {
  source: string;
  tree: string;
  files: Pin[];
};
type Runtime = { platform: string; arch: string; node: string; executable: Pin };
type Guard = {
  schema: string;
  nonce: string;
  issuedAt: string;
  source: string;
  tree: string;
  files: Pin[];
  runtime: Runtime;
  sourceReview: 'HIGH';
  artifactReview: 'HIGH';
  assets: Pin[];
};
const git = (...args: string[]) =>
  execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 32768,
    windowsHide: true,
  }).trim();

function sourceIdentity(): Source {
  check(git('status', '--porcelain', '--untracked-files=all').length === 0, 'CLEAN_EXACT_CHECKOUT');
  const files = [sourceFile, fixtureFile, geometryFile].map((name) =>
    filePin(join(folder, name), 131072),
  );
  check(files[2]!.sha256 === fixture.geometrySha256, 'EXACT_IMMUTABLE_GEOMETRY');
  check(
    filePin(join(root, fixture.specification.path), 524288).sha256 === fixture.specification.sha256,
    'EXACT_FIELD_SPEC',
  );
  return {
    source: git('rev-parse', '--verify', 'HEAD'),
    tree: git('rev-parse', '--verify', 'HEAD^{tree}'),
    files,
  };
}

function pinEquals(actual: Pin, pin: Pin) {
  return actual.file === pin.file && actual.bytes === pin.bytes && actual.sha256 === pin.sha256;
}

function pinList(actual: Pin[], pins: Pin[], code: string) {
  check(
    Array.isArray(actual) &&
      actual.length === pins.length &&
      actual.every((pin, index) => pinEquals(pin, pins[index]!)),
    code,
  );
}

function validateGuard(value: unknown, source: Source, runtime: Runtime, now: number): Guard {
  check(typeof value === 'object' && value !== null && !Array.isArray(value), 'ADMISSION_OBJECT');
  const guard = value as Guard;
  const keys = [
    'artifactReview',
    'assets',
    'files',
    'issuedAt',
    'nonce',
    'runtime',
    'schema',
    'source',
    'sourceReview',
    'tree',
  ];
  check(Object.keys(guard).sort().join('|') === keys.join('|'), 'EXACT_ADMISSION_KEYS');
  check(
    guard.schema === guardVersion &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(guard.nonce),
    'FRESH_STATIC_GUARD_ONLY',
  );
  const issuedAt = Date.parse(guard.issuedAt);
  check(
    Number.isFinite(issuedAt) &&
      new Date(issuedAt).toISOString() === guard.issuedAt &&
      now >= issuedAt &&
      now - issuedAt <= limits.maxGuardAgeMs,
    'FRESH_EXACT_ADMISSION_TIME',
  );
  check(
    /^[a-f0-9]{40}$/.test(guard.source) &&
      /^[a-f0-9]{40}$/.test(guard.tree) &&
      guard.source === source.source &&
      guard.tree === source.tree,
    'EXACT_ADMITTED_GIT_SOURCE_TREE',
  );
  check(
    guard.sourceReview === 'HIGH' && guard.artifactReview === 'HIGH',
    'SOURCE_AND_ARTIFACT_HIGH',
  );
  pinList(guard.files, source.files, 'EXACT_ADMITTED_SOURCE_FILES');
  pinList(guard.assets, assetPins, 'EXACT_ADMITTED_ASSETS');
  check(
    guard.runtime?.platform === runtime.platform &&
      guard.runtime.arch === runtime.arch &&
      guard.runtime.node === runtime.node &&
      pinEquals(guard.runtime.executable, runtime.executable),
    'EXACT_ADMITTED_NODE_HOST',
  );
  return guard;
}

function exactDirectory(path: string, code: string) {
  check(
    isAbsolute(path) && realpathSync(path) === resolve(path) && lstatSync(path).isDirectory(),
    code,
  );
  return path;
}

function engineInputs() {
  const directory = exactDirectory(
    process.env['ASA_RAMP_STATIC_ENGINE'] ?? '',
    'EXACT_ENGINE_DIRECTORY',
  );
  const licensePath = process.env['ASA_RAMP_STATIC_LICENSE'] ?? '';
  const glue = join(directory, engine.glue.file);
  checkedAsset(glue, engine.glue);
  checkedAsset(join(directory, engine.declarations.file), engine.declarations);
  const license = checkedAsset(licensePath, engine.license);
  check(license.toString().includes('Apache License'), 'PINNED_APACHE_LICENSE');
  const build = JSON.parse(
    checkedAsset(
      join(dirname(directory), engine.buildReceipt.file),
      engine.buildReceipt,
    ).toString(),
  ) as {
    mode: string;
    accepted: boolean;
    error: unknown;
    child: { status: number };
    artifacts: Manifest[];
  };
  const browser = JSON.parse(
    checkedAsset(
      join(dirname(directory), engine.browserReceipt.file),
      engine.browserReceipt,
    ).toString(),
  ) as {
    mode: string;
    accepted: boolean;
    error: unknown;
    browserClosed: boolean;
    artifactManifest: Manifest[];
    buildReceiptSha256: string;
  };
  check(
    build.mode === 'isolated-link' &&
      build.accepted &&
      build.error === null &&
      build.child.status === 0 &&
      browser.mode === 'isolated-browser' &&
      browser.accepted &&
      browser.error === null &&
      browser.browserClosed &&
      browser.buildReceiptSha256 === engine.buildReceipt.sha256,
    'SEALED_ENGINE_BUILD_AND_BROWSER_RECEIPTS',
  );
  manifestLink(build.artifacts, browser.artifactManifest);
  const wasm = checkedAsset(join(directory, engine.wasm.file), engine.wasm);
  check(wasm.subarray(0, 4).equals(Buffer.from([0, 97, 115, 109])), 'WASM_MAGIC');
  return { directory, glue, wasm };
}

function exclusiveFile(path: string, bytes: Buffer) {
  const fd = openSync(path, 'wx');
  try {
    writeFileSync(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function publishReceipt(directory: string, receipt: unknown) {
  const bytes = Buffer.from(JSON.stringify(receipt, null, 2) + '\n');
  check(bytes.length <= limits.maxReceiptBytes, 'BOUNDED_RECEIPT_BYTES');
  const pending = join(directory, 'receipt.pending');
  exclusiveFile(pending, bytes);
  try {
    // A hardlink publishes atomically without replacing an existing final receipt.
    linkSync(pending, join(directory, 'receipt.json'));
  } finally {
    unlinkSync(pending);
  }
}

async function initEngine(
  inputs: ReturnType<typeof engineInputs>,
  record: Ledger,
  diagnostics: { stderr: string[]; stderrBytes: number; overflow: boolean },
) {
  check(record.module.attempted === 0, 'ONLY_ONE_MODULE_INITIALIZATION');
  checkedAsset(inputs.glue, engine.glue);
  const loaded = (await import(/* @vite-ignore */ pathToFileURL(inputs.glue).href)) as {
    default(options: {
      wasmBinary: Buffer;
      printErr(line: string): void;
      locateFile(name: string): string;
    }): Promise<Engine>;
  };
  checkedAsset(inputs.glue, engine.glue);
  record.module.attempted++;
  const module = await loaded.default({
    wasmBinary: inputs.wasm,
    printErr(line) {
      const bytes = Buffer.byteLength(line);
      diagnostics.stderrBytes += bytes;
      if (diagnostics.stderrBytes > limits.maxStderrBytes) diagnostics.overflow = true;
      else diagnostics.stderr.push(line);
    },
    locateFile(name) {
      check(name === engine.wasm.file, 'UNEXPECTED_ENGINE_RESOURCE');
      return join(inputs.directory, name);
    },
  });
  record.module.returned++;
  check(
    module.mj_version() === 4000000 && module.mj_versionString() === engine.version,
    'ACTUAL_ENGINE_VERSION',
  );
  return module;
}

function geometryDeltas(
  baseline: ReturnType<typeof runCase>,
  edited: ReturnType<typeof runCase>,
  cases: Input[],
) {
  const first = baseline.geometry.footprint;
  const second = edited.geometry.footprint;
  const deltas = {
    x: second.x - first.x,
    y: second.y - first.y,
    run: second.run - first.run,
    width: second.width - first.width,
    rise: second.rise - first.rise,
    base: second.base - first.base,
  };
  const [a, b] = cases as [Input, Input];
  closeVector(
    Object.values(deltas),
    [b.entry.x - a.entry.x, 0, 0, b.entry.width - a.entry.width, b.entry.rise - a.entry.rise, 0],
    4 * tolerances.vertexMeters,
    'NATIVE_BASELINE_EDITED_DELTAS',
  );
  return deltas;
}

async function nativeProgram() {
  check(
    process.env['ASA_RAMP_STATIC_ENABLE'] === optIn && !process.env['CI'],
    'EXPLICIT_LOCAL_NATIVE_OPT_IN',
  );
  const temporary = realpathSync(tmpdir());
  const directory = exactDirectory(
    process.env['ASA_RAMP_STATIC_RUN_DIRECTORY'] ?? '',
    'EXACT_EXTERNAL_RUN_DIRECTORY',
  );
  check(
    dirname(directory) === temporary && basename(directory).startsWith('asa-ramp-native-static-'),
    'ISOLATED_RUN_DIRECTORY',
  );
  for (const name of ['receipt.json', 'receipt.pending', 'dispatched.lock']) {
    check(!existsSync(join(directory, name)), 'NO_CONSUMED_RUN_OR_RECEIPT');
  }
  const source = sourceIdentity();
  const runtime: Runtime = {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    executable: filePin(realpathSync(process.execPath), 256 * 1024 * 1024),
  };
  const guardPath = join(directory, 'admission.json');
  const guardPin = filePin(guardPath, limits.maxAdmissionBytes);
  const rawGuard = checkedAsset(guardPath, guardPin);
  const guard = validateGuard(JSON.parse(rawGuard.toString()), source, runtime, Date.now());
  check(basename(directory) === 'asa-ramp-native-static-' + guard.nonce, 'GUARD_RUN_DIRECTORY');
  const cases = fixture.cases.map(prepared);
  check(
    cases.length === limits.worlds &&
      cases.map((item) => item.entry.id).join(',') === 'baseline5,edited6',
    'EXACT_STATIC_CASE_ORDER',
  );
  const inputs = engineInputs();
  const afterAdmission = sourceIdentity();
  check(
    source.source === afterAdmission.source && source.tree === afterAdmission.tree,
    'SOURCE_CHANGED_BEFORE_DISPATCH',
  );
  pinList(afterAdmission.files, source.files, 'SOURCE_FILES_CHANGED_BEFORE_DISPATCH');
  validateGuard(guard, source, runtime, Date.now());

  // No native import before the one-shot exclusive dispatch record succeeds.
  exclusiveFile(
    join(directory, 'dispatched.lock'),
    Buffer.from(
      JSON.stringify({
        nonce: guard.nonce,
        guardSha256: guardPin.sha256,
        source: source.source,
        tree: source.tree,
      }) + '\n',
    ),
  );
  const record = ledger();
  const diagnostics = { stderr: [] as string[], stderrBytes: 0, overflow: false };
  const observations: ReturnType<typeof runCase>[] = [];
  let deltas: ReturnType<typeof geometryDeltas> | null = null;
  let stage = 'module-import';
  let caseId: string | null = null;
  let failure: { stage: string; caseId: string | null; message: string } | null = null;
  try {
    const module = await initEngine(inputs, record, diagnostics);
    for (const item of cases) {
      caseId = item.entry.id;
      observations.push(
        runCase(module, item, record, (next) => {
          stage = next;
        }),
      );
      stage = 'world-cleanup';
      check(
        record.cleanupErrors.length === 0 &&
          record.owned === record.released &&
          record.activeWorlds === 0,
        'COMPLETE_WORLD_CLEANUP',
      );
      check(!diagnostics.overflow && diagnostics.stderr.length === 0, 'NATIVE_DIAGNOSTICS');
    }
    stage = 'cross-case-deltas';
    deltas = geometryDeltas(observations[0]!, observations[1]!, cases);
    stage = 'final-ledger';
    check(
      record.module.attempted === 1 &&
        record.module.returned === 1 &&
        [record.model, record.data].every(
          (counter) => counter.attempted === limits.worlds && counter.returned === limits.worlds,
        ) &&
        record.forward.attempted === limits.worlds * limits.forwardCallsPerWorld &&
        record.forward.returned === record.forward.attempted &&
        record.nativeSteps === limits.nativeSteps &&
        record.peakWorlds === limits.concurrentWorlds,
      'EXACT_NATIVE_CALL_BUDGET',
    );
  } catch (error) {
    failure = { stage, caseId, message: String(error).slice(0, 1024) };
  }
  publishReceipt(directory, {
    schema: 'ASA_RAMP_NATIVE_STATIC_RECEIPT_V1',
    scope: fixture.scope,
    nonce: guard.nonce,
    guard: guardPin,
    source,
    runtime,
    engine: { version: engine.version, upstream: engine.upstream, pins: assetPins },
    staticXmlPins: cases.map((item) => ({ case: item.entry.id, sha256: item.pin })),
    observations,
    deltas,
    ledger: record,
    diagnostics,
    accepted: failure === null,
    failure,
  });
  check(!failure, failure ? failure.stage + ' ' + failure.message : '');
}

it('freezes exact immutable geometry, analytic witness coordinates and static XML before native use', () => {
  expect(filePin(join(folder, geometryFile), 131072).sha256).toBe(fixture.geometrySha256);
  const [baseline, edited] = fixture.cases.map(prepared);
  expect(baseline!.entry.id).toBe('baseline5');
  expect(edited!.entry.id).toBe('edited6');
  expect(edited!.entry.x - baseline!.entry.x).toBeCloseTo(0.02, 12);
  expect(edited!.entry.width - baseline!.entry.width).toBeCloseTo(-0.2, 12);
  expect(edited!.shape.angleRadians - baseline!.shape.angleRadians).toBeCloseTo(Math.PI / 180, 12);
  for (const input of [baseline!, edited!]) {
    expect(input.pin).not.toBe(
      fixture.historicalFixture.fullXmlReference[input.entry.id as 'baseline5' | 'edited6'],
    );
    expect(
      clearances(input, v(input.support.center), v(input.separated.center)).separated,
    ).toBeCloseTo(0.02, 12);
  }
});

it('verifies reindexed real-shaped vertices and rigid rotation, rejecting wrong faces or reflected axes', () => {
  const input = prepared(fixture.cases[1]!);
  const permutation = [1, 7, 4, 0, 6, 2, 3, 5];
  const origin: RampVector = [0.37, -0.41, 0.22];
  const rotation = [0, -1, 0, 1, 0, 0, 0, 0, 1];
  const quaternion = [Math.SQRT1_2, 0, 0, Math.SQRT1_2];
  const local = permutation.flatMap((index) => {
    const [x, y, z] = difference(input.shape.vertices[index]!, origin);
    return [y, -x, z].map(Math.fround);
  });
  const faces = input.shape.faces.flat().map((index) => permutation.indexOf(index));
  expect(compiled(input, local, faces, origin, rotation, quaternion).footprint.width).toBeCloseTo(
    input.entry.width,
    6,
  );
  const malformed = [...faces];
  malformed[0] = malformed[1]!;
  expect(() => compiled(input, local, malformed, origin, rotation, quaternion)).toThrow(
    'CLOSED_FACE_PARITY',
  );
  expect(() =>
    compiled(input, local, faces, origin, [0, 1, 0, 1, 0, 0, 0, 0, 1], quaternion),
  ).toThrow('RIGHT_HANDED_GEOM');
});

it('rejects missing, stale, foreign and non-HIGH admission before native import', () => {
  const source = { source: 'a'.repeat(40), tree: 'b'.repeat(40), files: [] };
  const runtime = { arch: 'x64', platform: 'test', node: 'test', executable: engine.glue };
  const now = Date.parse('2026-11-28T10:00:00.000Z');
  const valid = {
    ...source,
    runtime,
    schema: guardVersion,
    nonce: 'be77fcb2-342a-424c-b50a-479bb9d198e3',
    issuedAt: new Date(now).toISOString(),
    assets: assetPins,
    sourceReview: 'HIGH',
    artifactReview: 'HIGH',
  };
  expect(validateGuard(valid, source, runtime, now).nonce).toBe(valid.nonce);
  expect(() => validateGuard(undefined, source, runtime, now)).toThrow('ADMISSION_OBJECT');
  expect(() => validateGuard(valid, source, runtime, now + limits.maxGuardAgeMs + 1)).toThrow(
    'FRESH_EXACT_ADMISSION_TIME',
  );
  expect(() => validateGuard({ ...valid, source: 'c'.repeat(40) }, source, runtime, now)).toThrow(
    'EXACT_ADMITTED_GIT_SOURCE_TREE',
  );
  expect(() =>
    validateGuard({ ...valid, artifactReview: 'PENDING' }, source, runtime, now),
  ).toThrow('SOURCE_AND_ARTIFACT_HIGH');
});

it('rejects a mismatched artifact even when manifest names match', () => {
  const assets = [engine.glue, engine.wasm, engine.declarations].map(({ file, ...pin }) => ({
    name: file,
    ...pin,
  }));
  const manifest = [...assets, { name: 'mujoco.wasm.map', bytes: 1, sha256: 'f'.repeat(64) }];
  expect(() => manifestLink(manifest, structuredClone(manifest))).not.toThrow();
  const mismatched = structuredClone(manifest);
  mismatched[1]!.sha256 = 'a'.repeat(64);
  expect(() => manifestLink(manifest, mismatched)).toThrow('BROWSER_LINKED_SAME_OBJECT');
  expect(() => manifestLink(mismatched, mismatched)).toThrow('BUILD_LINKED_OBJECT');
});

it.skipIf(process.env['ASA_RAMP_STATIC_ENABLE'] === undefined)(
  'admits one exact native static program with two forwards and zero steps',
  nativeProgram,
  30_000,
);
