import { createHash } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmdirSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import type fixtureData from './mujoco-union-cylinder-static-witness.fixture.json';
import type traceFixtureData from './mujoco-cylinder-primary-trace.fixture.json';

// This module imports no previous spec, engine glue, session, CLI or numerical solver.
// Only the explicitly enabled final test may dynamically import the verified AOT glue.
type Pin = { bytes: number; sha256: string };
type Vec = [number, number, number];
type Quat = [number, number, number, number];
type Case = (typeof f.cases)[number];
type Packet = { values: number[]; f64le: string };
type Handle = { delete(): void };
type Vector<T> = { size(): number; get(i: number): T | undefined };
type Contact = Handle & {
  geom: Int32Array;
  dim: number;
  exclude: number;
  efc_address: number;
  dist: number;
  pos: Float64Array;
  frame: Float64Array;
};
type Model = Handle & Record<string, unknown> & { opt: Record<string, unknown> };
type Data = Handle & {
  time: number;
  qpos: Float64Array;
  qvel: Float64Array;
  xpos: Float64Array;
  xquat: Float64Array;
  xipos: Float64Array;
  ximat: Float64Array;
  geom_xpos: Float64Array;
  geom_xmat: Float64Array;
  ncon: number;
  nefc: number;
  efc_type: Int32Array;
  efc_id: Int32Array;
  contact: Handle & Vector<Contact>;
  warning: Vector<Handle & { number: number; lastinfo: number }>;
};
type DoubleBuffer = Handle & { GetView(): Float64Array };
type Native = {
  MjModel: { from_xml_string(xml: string): Model };
  MjData: new (model: Model) => Data;
  DoubleBuffer: new (length: number) => DoubleBuffer;
  mj_version(): number;
  mj_versionString(): string;
  mj_fwdPosition(model: Model, data: Data): void;
  mj_geomDistance(
    model: Model,
    data: Data,
    first: number,
    second: number,
    distmax: number,
    out: DoubleBuffer,
  ): number;
  // Intentionally no mj_forward, STEP1/STEP2, scheduler, controller or force binding.
};
type Kind =
  'module' | 'model' | 'data' | 'buffer' | 'contactVector' | 'contactCopy' | 'warningCopy';
type Count = { attempted: number; returned: number; deleteAttempted: number; deleted: number };
type Ledger = {
  handles: Record<Kind, Count>;
  position: { attempted: number; returned: number };
  distance: { attempted: number; returned: number };
  step1: 0;
  step2: 0;
  forward: 0;
  cleanupErrors: string[];
};
type ContactRecord = {
  index: number;
  geom: number[];
  dim: number;
  exclude: number;
  address: number;
  distance: Packet;
  point: Packet;
  frame: Packet;
};
type Geometry = {
  ncon: number;
  nefc: number;
  contacts: ContactRecord[];
  efcType: number[];
  efcId: number[];
  transforms: Record<string, Packet>;
};
type Snapshot = { state: Packet; geometry: Geometry };
type Sink = { write(record: unknown, footer?: boolean): void; reserve(): void };
const sourcePath = fileURLToPath(import.meta.url);
const fixturePath = join(dirname(sourcePath), 'mujoco-union-cylinder-static-witness.fixture.json');
// Read the immutable JSON bytes through the same codec; bundler JSON transforms can normalize -0.
const f = parseSigned(readFileSync(fixturePath, 'utf8')) as typeof fixtureData;
const traceFixturePath = join(dirname(sourcePath), 'mujoco-cylinder-primary-trace.fixture.json');
const t = parseSigned(readFileSync(traceFixturePath, 'utf8')) as typeof traceFixtureData;
const repo = resolve(dirname(sourcePath), '../../..');
const token = 'one-union-cylinder-static-witness-1071';
const nativeEnabled =
  process.env.ASA_CCD_TRACE_NATIVE !== undefined ||
  process.env.ASA_STATIC_WITNESS_NATIVE !== undefined;
const sha = (input: Uint8Array | string) => createHash('sha256').update(input).digest('hex');
function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function finite(value: number, message: string) {
  check(Number.isFinite(value), message);
  return value;
}
function bytes(values: ArrayLike<number>) {
  const out = Buffer.alloc(values.length * 8);
  Array.from(values).forEach((v, i) => out.writeDoubleLE(v, i * 8));
  return out;
}
function packet(values: ArrayLike<number>): Packet {
  return { values: Array.from(values), f64le: bytes(values).toString('hex') };
}
// The reserved scalar matches the historical raw convention. Every durable JSON
// writer AND reader uses this codec, including model readbacks and header inputs.
// Packet.f64le remains the independent exact-bit authority; inconsistent values fail.
function stringifySigned(value: unknown) {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (typeof v === 'number' && Object.is(v, -0)) return 'float64:-0';
    if (typeof v === 'string' && v.startsWith('float64:'))
      check(v === 'float64:-0', 'SIGNED_ZERO_LABEL');
    return v;
  });
}
function parseSigned(text: string): ReturnType<typeof JSON.parse> {
  return JSON.parse(text, (_key, v: unknown) => {
    if (typeof v === 'string' && v.startsWith('float64:')) {
      check(v === 'float64:-0', 'SIGNED_ZERO_LABEL');
      return -0;
    }
    return v;
  });
}
function legacyFloats(values: readonly (number | string)[]) {
  return values.map((v) => {
    if (v === 'float64:-0') return -0;
    check(typeof v === 'number' && Number.isFinite(v), 'ARCHIVED_SIGNED_F64');
    return v;
  });
}
function decodePacket(raw: string) {
  check(/^(?:[0-9a-f]{16})*$/.test(raw), 'F64LE_HEX');
  const b = Buffer.from(raw, 'hex');
  return Array.from({ length: b.length / 8 }, (_, i) => b.readDoubleLE(i * 8));
}
function same(a: unknown, b: unknown) {
  return stringifySigned(a) === stringifySigned(b);
}
function doubles(value: unknown, length: number, label: string): Float64Array {
  check(value instanceof Float64Array && value.length === length, 'F64_WIDTH_' + label);
  return value;
}
function integers(value: unknown, length: number, label: string): number[] {
  check(value instanceof Int32Array && value.length === length, 'I32_WIDTH_' + label);
  return Array.from(value);
}
function validatePacket(p: Packet, length: number, label: string) {
  check(
    p.values.length === length && p.f64le === bytes(p.values).toString('hex'),
    'PACKET_' + label,
  );
  p.values.forEach((v) => finite(v, 'NONFINITE_' + label));
}
function ledger(): Ledger {
  const handles = Object.fromEntries(
    ['module', 'model', 'data', 'buffer', 'contactVector', 'contactCopy', 'warningCopy'].map(
      (k) => [k, { attempted: 0, returned: 0, deleteAttempted: 0, deleted: 0 }],
    ),
  ) as Record<Kind, Count>;
  return {
    handles,
    position: { attempted: 0, returned: 0 },
    distance: { attempted: 0, returned: 0 },
    step1: 0,
    step2: 0,
    forward: 0,
    cleanupErrors: [],
  };
}
function release(h: Handle, kind: Kind, l: Ledger) {
  l.handles[kind].deleteAttempted++;
  try {
    h.delete();
    l.handles[kind].deleted++;
  } catch (error) {
    l.cleanupErrors.push(kind + ': ' + String(error));
  }
}
function acquire<T>(kind: Kind, l: Ledger, factory: () => T): NonNullable<T> {
  l.handles[kind].attempted++;
  const result = factory();
  check(result, 'MISSING_' + kind);
  l.handles[kind].returned++;
  return result as NonNullable<T>;
}
function state(data: Data) {
  return packet([data.time, ...doubles(data.qpos, 10, 'qpos'), ...doubles(data.qvel, 9, 'qvel')]);
}
function restore(data: Data, expected: Packet) {
  validatePacket(expected, 20, 'RESTORE');
  check(data.time === 0, 'FRESH_DATA_TIME');
  const values = decodePacket(expected.f64le);
  data.time = values[0]!;
  doubles(data.qpos, 10, 'restoreQpos').set(values.slice(1, 11));
  doubles(data.qvel, 9, 'restoreQvel').set(values.slice(11));
  check(state(data).f64le === expected.f64le, 'RESTORE_ONCE_EXACT_BITS');
}
function warn(data: Data, l: Ledger) {
  // warning is returned by reference (bindings.h:4863): NEVER delete the borrowed vector.
  // Each get() still yields an owned copy. contact below is a distinct BY-VALUE owned vector.
  const vector = data.warning,
    warnings: { number: number; lastinfo: number }[] = [];
  check(vector.size() === 7, 'WARNING_WIDTH_7');
  for (let i = 0; i < 7; i++) {
    const entry = acquire('warningCopy', l, () => vector.get(i));
    try {
      warnings.push({ number: entry.number, lastinfo: entry.lastinfo });
    } finally {
      release(entry, 'warningCopy', l);
    }
  }
  return warnings;
}
function capture(data: Data, c: Case, l: Ledger): Snapshot {
  const max = c.archivedFactory.readback.max;
  check(Number.isInteger(data.ncon) && data.ncon >= 0 && data.ncon <= max, 'CONTACT_CAP');
  check(Number.isInteger(data.nefc) && data.nefc >= 0 && data.nefc <= max * 3, 'ROW_CAP');
  const contacts: ContactRecord[] = [];
  // contact is returned BY VALUE: own the vector even when empty; own every copied contact.
  const vector = acquire('contactVector', l, () => data.contact);
  try {
    check(vector.size() === data.ncon, 'ALL_CONTACT_VECTOR_SIZE');
    for (let i = 0; i < data.ncon; i++) {
      const contact = acquire('contactCopy', l, () => vector.get(i));
      try {
        contacts.push({
          index: i,
          geom: integers(contact.geom, 2, 'contactGeom'),
          dim: contact.dim,
          exclude: contact.exclude,
          address: contact.efc_address,
          distance: packet([contact.dist]),
          point: packet(doubles(contact.pos, 3, 'contactPoint')),
          frame: packet(doubles(contact.frame, 9, 'contactFrame')),
        });
      } finally {
        release(contact, 'contactCopy', l);
      }
    }
  } finally {
    release(vector, 'contactVector', l);
  }
  const ngeom = c.native_counts[3]!,
    transforms = Object.fromEntries(
      Object.entries({
        xpos: 15,
        xquat: 20,
        xipos: 15,
        ximat: 45,
        geom_xpos: 3 * ngeom,
        geom_xmat: 9 * ngeom,
      }).map(([k, n]) => [k, packet(doubles(data[k as keyof Data], n, k))]),
    );
  return {
    state: state(data),
    geometry: {
      ncon: data.ncon,
      nefc: data.nefc,
      contacts,
      efcType: integers(data.efc_type, data.nefc, 'efc_type'),
      efcId: integers(data.efc_id, data.nefc, 'efc_id'),
      transforms,
    },
  };
}
function validateSnapshot(s: Snapshot, c: Case) {
  validatePacket(s.state, 20, 'STATE');
  const g = s.geometry;
  check(
    g.contacts.length === g.ncon && g.efcType.length === g.nefc && g.efcId.length === g.nefc,
    'CENSUS',
  );
  let rows = 0;
  for (const [i, ct] of g.contacts.entries()) {
    check(
      ct.index === i &&
        ct.geom.length === 2 &&
        ct.geom.every((id) => Number.isInteger(id) && id >= 0 && id < c.native_counts[3]!) &&
        ct.dim === 3 &&
        Number.isInteger(ct.exclude) &&
        ct.exclude >= 0 &&
        ct.exclude <= 6,
      'CONTACT_IDENTITY',
    );
    validatePacket(ct.distance, 1, 'DISTANCE');
    validatePacket(ct.point, 3, 'POINT');
    validatePacket(ct.frame, 9, 'FRAME');
    if (ct.address >= 0) {
      check(ct.exclude === 0 && ct.address === rows, 'ROW_ADDRESS');
      for (let j = 0; j < 3; j++)
        check(g.efcType[rows + j] === 7 && g.efcId[rows + j] === i, 'ROW_TYPE_ID');
      rows += 3;
    } else check(ct.address === -1, 'INACTIVE_ADDRESS');
  }
  check(rows === g.nefc, 'ORPHAN_ROWS');
  for (const [name, p] of Object.entries(g.transforms)) validatePacket(p, p.values.length, name);
}
function xml(c: Case) {
  // Read only original JSON data, never import its spec or any old executable.
  const pin = c.id.startsWith('recovered')
    ? f.immutableInputs.union_fixture
    : f.immutableInputs.five_mesh_fixture;
  const raw = readFileSync(join(repo, pin.path));
  check(raw.length === pin.bytes && sha(raw) === pin.sha256, 'XML_FIXTURE_PIN');
  const value = parseSigned(raw.toString()) as { xml: string[] };
  check(
    Array.isArray(value.xml) && value.xml.every((line) => typeof line === 'string'),
    'XML_ARRAY',
  );
  const text = value.xml.join('\n') + '\n';
  check(sha(text) === c.xml_sha256, 'EXACT_ORIGINAL_XML');
  return text;
}
function decodeFrame(c: Case, input = Buffer.from(c.frameHex, 'hex')) {
  check(input.length === c.frame_bytes && sha(input) === c.frame_sha256, 'EXACT_FRAME_PIN');
  const get = (at: number, n: number) =>
    Array.from({ length: n }, (_, i) => finite(input.readDoubleLE(at + i * 8), 'RAW_FINITE'));
  const ncon = input.readDoubleLE(24),
    nefc = input.readUInt16LE(872);
  check(
    Number.isInteger(ncon) &&
      ncon >= 0 &&
      ncon <= c.archivedFactory.readback.max &&
      input.length === 2048 + ncon * 176,
    'FRAME_SHAPE',
  );
  check(input.readDoubleLE(0) === c.raw_from_us, 'FRAME_CLOCK');
  const pre = packet([input.readDoubleLE(16), ...get(32, 10), ...get(112, 9)]);
  check(
    sha(Buffer.from(pre.f64le, 'hex')) === input.subarray(1984, 2016).toString('hex'),
    'ARCHIVED_STEP1_PHASE_HASH',
  );
  const contacts: ContactRecord[] = [],
    efcType: number[] = [],
    efcId: number[] = [];
  for (let i = 0; i < ncon; i++) {
    const offset = 2048 + i * 176,
      bits = input.readUInt16LE(offset + 4),
      link = input.readUInt16LE(offset + 6),
      group = link & 255,
      address = group === 255 ? -1 : group * 3;
    check(link >>> 8 === i && (bits >>> 15 !== 0) === address >= 0, 'ARCHIVED_INDEX_ACTIVE');
    const rowTypes = bits & 4095;
    if (address >= 0) {
      check(address === efcType.length && rowTypes === 0x777, 'ARCHIVED_ROW_TYPES');
      efcType.push(7, 7, 7);
      efcId.push(i, i, i);
    } else check(rowTypes === 0, 'ARCHIVED_INACTIVE_TYPES');
    contacts.push({
      index: i,
      geom: [input.readUInt16LE(offset), input.readUInt16LE(offset + 2)],
      dim: 3,
      exclude: (bits >>> 12) & 7,
      address,
      distance: packet(get(896 + i * 8, 1)),
      point: packet(get(offset + 8, 3)),
      frame: packet(get(offset + 32, 9)),
    });
  }
  check(efcType.length === nefc, 'ARCHIVED_ALL_ROWS');
  const poses = get(184, 28),
    xpos = [0, 0, 0],
    xquat = [1, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    xpos.push(...poses.slice(i * 7, i * 7 + 3));
    xquat.push(...poses.slice(i * 7 + 3, i * 7 + 7));
  }
  return {
    pre,
    identity: { ncon, nefc, contacts, efcType, efcId },
    body: { xpos: packet(xpos), xquat: packet(xquat) },
  };
}
function differences(actual: Snapshot, c: Case) {
  const expected = decodeFrame(c),
    diff: string[] = [];
  if (actual.state.f64le !== expected.pre.f64le) diff.push('state');
  const { transforms, ...identity } = actual.geometry;
  if (!same(identity, expected.identity)) diff.push('all_contact_geometry_rows_order');
  for (const key of ['xpos', 'xquat'] as const)
    if (transforms[key]!.f64le !== expected.body[key].f64le) diff.push(key);
  const terrainCount = c.native_counts[0]!;
  const native = c.archivedFactory.mesh.native;
  for (const [key, width, values] of [
    ['geom_xpos', 3, native.worldPositionsF64],
    ['geom_xmat', 9, native.worldRotationsF64],
  ] as const) {
    const actual = transforms[key]!.values.slice(0, terrainCount * width);
    if (
      bytes(actual).toString('hex') !==
      bytes(legacyFloats(values.slice(0, terrainCount * width))).toString('hex')
    )
      diff.push('static_' + key);
  }
  return diff;
}
function modelReadback(model: Model, c: Case) {
  const a = c.archivedFactory.readback,
    m = c.archivedFactory.mesh.native;
  const counts = Object.fromEntries(
    Object.entries(a.counts).map(([k, n]) => {
      check(model[k] === n, 'MODEL_COUNT_' + k);
      return [k, model[k]];
    }),
  );
  const arrays: Record<string, Packet | number[]> = {};
  for (const [k, expected] of Object.entries(m.integers)) {
    const actual = integers(model[k], expected.length, k);
    check(same(actual, expected), 'MODEL_I32_' + k);
    arrays[k] = actual;
  }
  const floatArrays: Record<string, number[]> = {
    ...m.doubles,
    body_mass: a.masses,
    body_ipos: a.ipos,
    body_inertia: a.inertia,
    dof_armature: a.arms,
    pair_friction: a.pairs.friction,
    pair_solref: a.pairs.solref,
    pair_solreffriction: a.pairs.solreffriction,
    pair_solimp: a.pairs.solimp,
  };
  for (const [k, expected] of Object.entries(floatArrays)) {
    const actual = packet(doubles(model[k], expected.length, k));
    check(actual.f64le === bytes(expected).toString('hex'), 'MODEL_F64_' + k);
    arrays[k] = actual;
  }
  for (const [k, expected] of Object.entries({
    pair_geom1: a.pairs.first,
    pair_geom2: a.pairs.second,
    pair_dim: a.pairs.dims,
    body_parentid: [0, 0, 1, 1, 1],
  })) {
    const actual = integers(model[k], expected.length, k);
    check(same(actual, expected), 'MODEL_I32_' + k);
    arrays[k] = actual;
  }
  check(
    model.mesh_vert instanceof Float32Array && model.mesh_vert.length === m.verticesF32.length,
    'MODEL_VERT_F32_WIDTH',
  );
  const vertices = Array.from(model.mesh_vert);
  check(same(vertices, m.verticesF32), 'MODEL_VERT_F32_EXACT');
  arrays.mesh_face = integers(model.mesh_face, m.facesI32.length, 'mesh_face');
  check(same(arrays.mesh_face, m.facesI32), 'MODEL_FACE_EXACT');
  arrays.body_iquat = packet(doubles(model.body_iquat, 20, 'body_iquat'));
  validatePacket(arrays.body_iquat as Packet, 20, 'BODY_IQUAT');
  for (const [k, n] of Object.entries({
    geom_surfacevel: c.native_counts[3]! * 6,
    geom_gap: c.native_counts[3]!,
    geom_margin: c.native_counts[3]!,
    geom_adhesion: c.native_counts[3]!,
    dof_damping: 9,
    dof_frictionloss: 9,
    body_gravcomp: 5,
    pair_gap: a.counts.npair,
    pair_margin: a.counts.npair,
    pair_adhesion: a.counts.npair,
  })) {
    const actual = packet(doubles(model[k], n, k));
    check(
      actual.values.every((v) => v === 0),
      'MODEL_ZERO_' + k,
    );
    arrays[k] = actual;
  }
  const settings: Record<string, number | Packet> = {};
  // opt is a borrowed reference: copy values, never delete or mutate it.
  for (const [k, v] of Object.entries(a.settings)) {
    if (Array.isArray(v)) {
      const p = packet(doubles(model.opt[k], v.length, k));
      check(p.f64le === bytes(v).toString('hex'), 'MODEL_OPT_' + k);
      settings[k] = p;
    } else {
      check(Object.is(model.opt[k], v), 'MODEL_OPT_' + k);
      settings[k] = v;
    }
  }
  settings.wind = packet(doubles(model.opt.wind, 3, 'wind'));
  check(
    (settings.wind as Packet).values.every((v) => v === 0),
    'MODEL_WIND',
  );
  return {
    counts,
    arrays,
    settings,
    verticesF32: vertices,
    verticesF32le: Buffer.from(new Float32Array(vertices).buffer).toString('hex'),
    sourceFactoryMesh: c.archivedFactory.mesh.native,
  };
}
const dot = (a: Vec, b: Vec) => a.reduce((sum, x, i) => sum + x * b[i]!, 0);
const add = (a: Vec, b: Vec): Vec => a.map((v, i) => v + b[i]!) as Vec;
const sub = (a: Vec, b: Vec): Vec => a.map((v, i) => v - b[i]!) as Vec;
const mul = (a: Vec, s: number): Vec => a.map((v) => v * s) as Vec;
function rotate(q: Quat, v: Vec): Vec {
  const [w, x, y, z] = q,
    [a, b, c] = v;
  return [
    (1 - 2 * (y * y + z * z)) * a + 2 * (x * y - z * w) * b + 2 * (x * z + y * w) * c,
    2 * (x * y + z * w) * a + (1 - 2 * (x * x + z * z)) * b + 2 * (y * z - x * w) * c,
    2 * (x * z - y * w) * a + 2 * (y * z + x * w) * b + (1 - 2 * (x * x + y * y)) * c,
  ];
}
function cylinder(point: Vec, center: Vec, axis: Vec, radius: number, halfWidth: number) {
  [...point, ...center, ...axis, radius, halfWidth].forEach((v) => finite(v, 'CYLINDER_FINITE'));
  check(radius > 0 && halfWidth > 0 && Math.abs(dot(axis, axis) - 1) < 1e-12, 'CYLINDER_SHAPE');
  const delta = sub(point, center),
    axial = dot(delta, axis),
    radial = Math.hypot(...sub(delta, mul(axis, axial))),
    roundoff = 256 * Number.EPSILON * Math.max(1, ...point.map(Math.abs), ...center.map(Math.abs));
  return {
    axial,
    radial,
    halfWidth,
    radius,
    roundoff,
    axialExcess: Math.max(0, Math.abs(axial) - halfWidth),
    radialExcess: Math.max(0, radial - radius),
    outside: Math.abs(axial) > halfWidth + roundoff || radial > radius + roundoff,
    negativeAffineMassLowerBound: Math.max(0, (Math.abs(axial) / halfWidth - 1) / 2),
  };
}
function wheelShape(model: Model, s: Snapshot, id: number) {
  const type = integers(model.geom_type, model.ngeom as number, 'geom_type');
  check(type[id] === 5, 'QUERY_FIRST_IS_CYLINDER');
  const p = s.geometry.transforms.geom_xpos!.values.slice(id * 3, id * 3 + 3) as Vec,
    m = s.geometry.transforms.geom_xmat!.values.slice(id * 9, id * 9 + 9),
    size = doubles(model.geom_size, (model.ngeom as number) * 3, 'geom_size');
  return {
    center: p,
    axis: [m[2]!, m[5]!, m[8]!] as Vec,
    radius: size[id * 3]!,
    halfWidth: size[id * 3 + 1]!,
  };
}
function meshEndpoint(model: Model, s: Snapshot, id: number, point: Vec) {
  const ng = model.ngeom as number,
    nm = model.nmesh as number;
  check(integers(model.geom_type, ng, 'geom_type')[id] === 7, 'QUERY_SECOND_IS_MESH');
  const mesh = integers(model.geom_dataid, ng, 'geom_dataid')[id]!;
  check(mesh >= 0 && mesh < nm, 'TERRAIN_MESH_ID');
  const vertexStart = integers(model.mesh_vertadr, nm, 'mesh_vertadr')[mesh]!,
    vertexCount = integers(model.mesh_vertnum, nm, 'mesh_vertnum')[mesh]!,
    faceStart = integers(model.mesh_faceadr, nm, 'mesh_faceadr')[mesh]!,
    faceCount = integers(model.mesh_facenum, nm, 'mesh_facenum')[mesh]!;
  const v = model.mesh_vert as Float32Array,
    faces = model.mesh_face as Int32Array,
    p = s.geometry.transforms.geom_xpos!.values.slice(id * 3, id * 3 + 3) as Vec,
    m = s.geometry.transforms.geom_xmat!.values.slice(id * 9, id * 9 + 9);
  // Compiled mesh vertices already contain compiler scaling/centering; use actual geom transform once.
  const vertices = Array.from({ length: vertexCount }, (_, i) =>
    add(
      p,
      [0, 1, 2].map(
        (row) =>
          m[row * 3]! * v[(vertexStart + i) * 3]! +
          m[row * 3 + 1]! * v[(vertexStart + i) * 3 + 1]! +
          m[row * 3 + 2]! * v[(vertexStart + i) * 3 + 2]!,
      ) as Vec,
    ),
  );
  const center = mul(
    vertices.reduce<Vec>((a, b) => add(a, b), [0, 0, 0]),
    1 / vertexCount,
  );
  const planes = Array.from({ length: faceCount }, (_, i) => {
    const ids = Array.from(faces.slice((faceStart + i) * 3, (faceStart + i + 1) * 3));
    check(
      ids.every((v) => v >= 0 && v < vertexCount),
      'MESH_FACE_VERTEX_ID',
    );
    const [a, b, c] = ids.map((i) => vertices[i]!) as [Vec, Vec, Vec],
      u = sub(b, a),
      v = sub(c, a),
      cross: Vec = [
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
      ],
      length = Math.hypot(...cross);
    check(length > 0, 'MESH_TRIANGLE_AREA');
    const n = mul(cross, 1 / length);
    check(dot(n, sub(center, a)) < 0, 'MESH_OUTWARD_FACE');
    return {
      face: faceStart + i,
      vertices: ids,
      normal: n,
      offset: dot(n, a),
      signed: dot(n, sub(point, a)),
    };
  });
  const roundoff =
    256 * Number.EPSILON * Math.max(1, ...vertices.flat().map(Math.abs), ...point.map(Math.abs));
  return {
    mesh,
    point: packet(point),
    planes,
    roundoff,
    maxOutwardDistance: Math.max(...planes.map((p) => p.signed)),
    outside: planes.some((p) => p.signed > roundoff),
  };
}
function classify(
  model: Model,
  s: Snapshot,
  c: Case,
  pair: number[],
  distance: number,
  out: Packet,
) {
  if (distance === 0)
    return { verdict: 'INCONCLUSIVE_ZERO_TOUCH_OR_CUTOFF', distance, endpointsCertified: false };
  check(distance < 0, 'DISTMAX_ZERO_POSITIVE');
  const shape = wheelShape(model, s, pair[0]!),
    primary = cylinder(
      out.values.slice(0, 3) as Vec,
      shape.center,
      shape.axis,
      shape.radius,
      shape.halfWidth,
    );
  const contacts = s.geometry.contacts
    .filter((ct) => ct.geom[0] === pair[0] && ct.geom[1] === pair[1])
    .map((ct) => {
      // Actual pair is wheel first: native frame normal points wheel->terrain.
      // The signed midpoint decomposition is wheel=midpoint-dist*normal/2.
      const wheel = sub(
        ct.point.values as Vec,
        mul(ct.frame.values.slice(0, 3) as Vec, ct.distance.values[0]! / 2),
      );
      return {
        index: ct.index,
        wheelWitness: packet(wheel),
        domain: cylinder(wheel, shape.center, shape.axis, shape.radius, shape.halfWidth),
      };
    });
  const terrain = meshEndpoint(model, s, pair[1]!, out.values.slice(3, 6) as Vec);
  return {
    verdict: primary.outside
      ? 'PRIMARY_ENDPOINT_OUTSIDE_FINITE_CYLINDER'
      : terrain.outside
        ? 'INCONCLUSIVE_TERRAIN_ENDPOINT_OUTSIDE_COMPILED_HULL'
        : contacts.some((ct) => ct.domain.outside)
          ? 'PRIMARY_ENDPOINTS_VALID_FINAL_WHEEL_WITNESS_INVALID_DOWNSTREAM_LOCUS'
          : 'INCONCLUSIVE_NO_DOMAIN_DISCREPANCY',
    distance,
    endpointsCertified: true,
    shape,
    primary,
    terrain,
    contacts,
    scope: 'NO_UNIQUE_EPA_OR_MULTICCD_CAUSE_NO_PHYSICAL_ACCEPTANCE',
  };
}
class Journal implements Sink {
  private fd: number;
  private used = 0;
  private closed = false;
  constructor(readonly path: string) {
    check(isAbsolute(path), 'RECEIPT_ABSOLUTE');
    const parent = realpathSync(dirname(path)),
      temp = realpathSync(tmpdir());
    check(inside(temp, parent) && !inside(repo, parent), 'RECEIPT_OS_TEMP_OUTSIDE_CHECKOUT');
    check(!lstatSync(parent).isSymbolicLink(), 'RECEIPT_PARENT_NO_LINK');
    check(readdirSync(parent).length === 0, 'RECEIPT_FRESH_EMPTY_DIRECTORY');
    this.fd = openSync(path, 'wx');
  }
  reserve() {
    check(
      this.used + f.receipt.footerReserve <= f.receipt.maxBytes - f.receipt.footerReserve,
      'RECEIPT_PRECALL_RESERVE',
    );
  }
  write(record: unknown, footer = false) {
    const encoded = Buffer.from(stringifySigned(record) + '\n');
    check(
      this.used + encoded.length <= f.receipt.maxBytes - (footer ? 0 : f.receipt.footerReserve),
      'RECEIPT_CAP',
    );
    let at = 0;
    while (at < encoded.length) {
      const n = writeSync(this.fd, encoded, at, encoded.length - at);
      check(n > 0, 'RECEIPT_SHORT_WRITE');
      at += n;
    }
    this.used += encoded.length;
    fsyncSync(this.fd);
  }
  close() {
    if (!this.closed) {
      this.closed = true;
      closeSync(this.fd);
    }
  }
}
function inside(parent: string, child: string) {
  const r = relative(parent, child);
  return r === '' || (!r.startsWith('..' + sep) && r !== '..' && !isAbsolute(r));
}
function deniedEnvironment(env: NodeJS.ProcessEnv) {
  check(env.ASA_STATIC_WITNESS_NATIVE === token, 'EXACT_DISTINCT_NATIVE_OPT_IN');
  for (const key of Object.keys(env))
    if (key !== 'ASA_STATIC_WITNESS_NATIVE' && /(?:NATIVE|ACQUIRE)/.test(key) && /^ASA_/.test(key))
      check(env[key] === undefined, 'LEGACY_OR_AMBIGUOUS_NATIVE_ENV_' + key);
  for (const key of f.receipt.legacyNativeEnvironmentDenied)
    check(env[key] === undefined, 'LEGACY_NATIVE_ENV_' + key);
}
function pinFile(path: string, pin: Pin) {
  check(isAbsolute(path), 'INPUT_ABSOLUTE');
  check(!lstatSync(path).isSymbolicLink(), 'INPUT_NO_LINK');
  const raw = readFileSync(path);
  check(raw.length === pin.bytes && sha(raw) === pin.sha256, 'INPUT_PIN_' + path);
  return raw;
}
function required(env: NodeJS.ProcessEnv, key: string) {
  const value = env[key];
  check(value, 'MISSING_' + key);
  return value;
}
function readInputs(env: NodeJS.ProcessEnv) {
  const p = f.immutableInputs,
    paths = {
      union: required(env, 'ASA_STATIC_UNION_RAW'),
      five: required(env, 'ASA_STATIC_FIVE_RAW'),
      unionReplay: required(env, 'ASA_STATIC_UNION_REPLAY'),
      fiveReplay: required(env, 'ASA_STATIC_FIVE_REPLAY'),
      certificate: required(env, 'ASA_STATIC_CERTIFICATE'),
      engine: required(env, 'ASA_STATIC_ENGINE'),
      license: required(env, 'ASA_STATIC_LICENSE'),
      build: required(env, 'ASA_STATIC_BUILD_RECEIPT'),
      browser: required(env, 'ASA_STATIC_BROWSER_RECEIPT'),
    };
  const source = pinFile(join(repo, p.recovered_source_spec.path), p.recovered_source_spec);
  pinFile(join(repo, p.five_mesh_fixture.path), p.five_mesh_fixture);
  pinFile(join(repo, p.union_fixture.path), p.union_fixture);
  const rawUnion = pinFile(join(paths.union, p.union_raw_binary.file), p.union_raw_binary),
    metaUnion = pinFile(join(paths.union, p.union_raw_metadata.file), p.union_raw_metadata),
    rawFive = pinFile(join(paths.five, p.old_five_mesh_binary.file), p.old_five_mesh_binary),
    metaFive = pinFile(join(paths.five, p.old_five_mesh_metadata.file), p.old_five_mesh_metadata);
  const unionReplay = parseSigned(pinFile(paths.unionReplay, p.independent_full_replay).toString()),
    fiveReplay = parseSigned(
      pinFile(paths.fiveReplay, p.old_five_mesh_independent_replay).toString(),
    ),
    certificate = parseSigned(pinFile(paths.certificate, p.finite_cylinder_certificate).toString());
  check(
    unionReplay.source_commit === f.cases[0]!.source &&
      unionReplay.source_tree === 'f9b81501a2a0e6aa46accb945520afcd6ad867a8' &&
      unionReplay.verdict.runtime === 'COMPLETE' &&
      unionReplay.verdict.physical === 'FAIL' &&
      unionReplay.verdict.causal === 'GAP' &&
      unionReplay.native_calls === 0,
    'UNION_REPLAY_LINK',
  );
  check(
    fiveReplay.source_commit === f.cases[1]!.source &&
      fiveReplay.verdict.physical === 'FAIL' &&
      fiveReplay.verdict.causal === 'GAP',
    'FIVE_REPLAY_LINK',
  );
  for (const [report, bin, meta] of [
    [unionReplay, p.union_raw_binary, p.union_raw_metadata],
    [fiveReplay, p.old_five_mesh_binary, p.old_five_mesh_metadata],
  ] as const)
    check(
      report.inputs.binary.sha256 === bin.sha256 &&
        report.inputs.jsonl.sha256 === meta.sha256 &&
        report.full_replay.parsed_intervals === 40180,
      'FULL_REPLAY_EXACT_RAW_LINK',
    );
  check(same(certificate, f.certificate) && certificate.native_calls === 0, 'CERTIFICATE_LINK');
  f.cases.forEach((c, i) => {
    const raw = (i === 0 ? rawUnion : rawFive).subarray(
      c.frame_offset,
      c.frame_offset + c.frame_bytes,
    );
    check(
      raw.toString('hex') === c.frameHex && sha(raw) === c.frame_sha256,
      'SELECTED_WHOLE_RAW_FRAME_LINK',
    );
    const metadata = (i === 0 ? metaUnion : metaFive)
      .toString()
      .trim()
      .split('\n')
      .map((line) => parseSigned(line));
    const start = metadata.find((x) => x.kind === 'world-start' && x.world === 'powered');
    check(
      start &&
        same(start.mesh.native, c.archivedFactory.mesh.native) &&
        same(start.readback, c.archivedFactory.readback),
      'WHOLE_METADATA_MODEL_LINK',
    );
    check(sha(xml(c)) === c.xml_sha256, 'EXACT_XML_LINK');
  });
  const e = f.engine;
  const glue = pinFile(join(paths.engine, e.glue.file), e.glue),
    wasm = pinFile(join(paths.engine, e.wasm.file), e.wasm);
  pinFile(join(paths.engine, e.declarations.file), e.declarations);
  pinFile(paths.license, e.license);
  pinFile(paths.build, e.buildReceipt);
  pinFile(paths.browser, e.browserReceipt);
  return {
    paths,
    wasm,
    proof: {
      source: sha(source),
      immutableInputs: p,
      engine: e,
      glueSha256: sha(glue),
      nativeImports: 0,
    },
  };
}
function rawModel(model: Model, c: Case) {
  const a = c.archivedFactory.readback,
    m = c.archivedFactory.mesh.native;
  const keys = new Set([
    ...Object.keys(m.integers),
    ...Object.keys(m.doubles),
    'mesh_vert',
    'mesh_face',
    'body_mass',
    'body_ipos',
    'body_inertia',
    'body_iquat',
    'dof_armature',
    'pair_friction',
    'pair_solref',
    'pair_solreffriction',
    'pair_solimp',
    'pair_geom1',
    'pair_geom2',
    'pair_dim',
    'body_parentid',
    'geom_surfacevel',
    'geom_gap',
    'geom_margin',
    'geom_adhesion',
    'dof_damping',
    'dof_frictionloss',
    'body_gravcomp',
    'pair_gap',
    'pair_margin',
    'pair_adhesion',
  ]);
  return {
    counts: Object.fromEntries(Object.keys(a.counts).map((k) => [k, model[k]])),
    arrays: Object.fromEntries(
      [...keys].map((k) => {
        const v = model[k];
        return [
          k,
          v instanceof Float64Array
            ? packet(v)
            : v instanceof Float32Array || v instanceof Int32Array
              ? {
                  values: Array.from(v),
                  bytes: Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString('hex'),
                  type: v.constructor.name,
                }
              : String(v),
        ];
      }),
    ),
    settings: Object.fromEntries(
      [...Object.keys(a.settings), 'wind'].map((k) => [
        k,
        model.opt[k] instanceof Float64Array ? packet(model.opt[k] as Float64Array) : model.opt[k],
      ]),
    ),
  };
}
function modelSnapshot(model: Model, c: Case) {
  return modelReadback(model, c);
}
type OperationHooks = {
  before(kind: 'position' | 'distance', c: Case, pair?: number[]): void;
  after(event: ReplayRecord): void;
};
function runCase(M: Native, c: Case, l: Ledger, sink: Sink, hooks?: OperationHooks) {
  let model: Model | undefined, data: Data | undefined, first: unknown;
  let phase = 'factory',
    baseline: Snapshot | undefined;
  const calls: unknown[] = [],
    conclusions: unknown[] = [];
  const remember = (event: unknown) => {
    calls.push(event);
    sink.write(event);
  };
  try {
    check(l.handles.model.attempted < 2 && l.handles.data.attempted < 2, 'MODEL_DATA_CAP');
    sink.reserve();
    model = acquire('model', l, () => M.MjModel.from_xml_string(xml(c)));
    data = acquire('data', l, () => new M.MjData(model!));
    remember({ kind: 'model-raw-before-validation', case: c.id, readback: rawModel(model, c) });
    const readback = modelSnapshot(model, c);
    remember({ kind: 'model', case: c.id, readback });
    restore(data, decodeFrame(c).pre);
    const factoryWarnings = warn(data, l);
    remember({ kind: 'restore-once', case: c.id, state: state(data), warnings: factoryWarnings });
    check(
      factoryWarnings.every((v) => v.number === 0),
      'FACTORY_NATIVE_WARNING',
    );
    check(l.cleanupErrors.length === 0, 'FACTORY_OWNERSHIP_CLEANUP');
    const expected = decodeFrame(c).pre.f64le;
    const operation = (kind: 'position' | 'distance', pair?: number[]) => {
      check(!first, 'NO_RETRY_AFTER_ERROR');
      sink.reserve();
      const before = capture(data!, c, l);
      validateSnapshot(before, c);
      // Sampling owns temporary copies. A failed release is already a known error,
      // so preserve that sample and STOP before any public native call/counter.
      if (l.cleanupErrors.length) {
        const error = new Error('PRE_API_OWNERSHIP_CLEANUP: ' + l.cleanupErrors[0]);
        try {
          remember({
            kind: 'pre-api-error',
            case: c.id,
            api: kind,
            before,
            firstError: String(error),
            ledger: structuredClone(l),
          });
        } catch (io) {
          l.cleanupErrors.push('pre-api-receipt: ' + String(io));
        }
        throw error;
      }
      check(before.state.f64le === expected, 'PRE_API_STATE_EXACT');
      const counter = l[kind],
        cap = kind === 'position' ? f.caps.max_position_calls : f.caps.max_distance_calls;
      check(counter.attempted < cap, 'API_CAP_' + kind);
      hooks?.before(kind, c, pair);
      let out: DoubleBuffer | undefined,
        result: number | undefined,
        fromto: Packet | undefined,
        apiError: unknown,
        after: Snapshot | undefined,
        warnings: unknown;
      try {
        if (kind === 'distance') {
          check(pair?.length === 2, 'EXACT_PAIR');
          out = acquire('buffer', l, () => new M.DoubleBuffer(6));
          doubles(out.GetView(), 6, 'DoubleBuffer6');
        }
        counter.attempted++;
        if (kind === 'position') M.mj_fwdPosition(model!, data!);
        else result = M.mj_geomDistance(model!, data!, pair![0]!, pair![1]!, 0, out!);
        counter.returned++;
      } catch (error) {
        apiError = error;
      } finally {
        if (out) {
          try {
            fromto = packet(doubles(out.GetView(), 6, 'DoubleBuffer6Result'));
          } catch (error) {
            apiError ??= error;
          }
          release(out, 'buffer', l);
        }
        try {
          after = capture(data!, c, l);
          warnings = warn(data!, l);
        } catch (error) {
          apiError ??= error;
        }
        const event = {
          kind,
          case: c.id,
          pair: pair ?? null,
          distmax: kind === 'distance' ? 0 : null,
          before,
          after: after ?? null,
          result: result === undefined ? null : packet([result]),
          fromto: fromto ?? null,
          warnings: warnings ?? null,
          error: apiError ? String(apiError) : null,
          counters: structuredClone(l),
        };
        remember(event);
        try {
          hooks?.after(event as ReplayRecord);
        } catch (error) {
          apiError ??= error;
        }
      }
      if (apiError) throw apiError;
      check(after, 'AFTER_CAPTURE');
      validateSnapshot(after, c);
      check(after.state.f64le === expected, 'POST_API_STATE_EXACT');
      check(l.cleanupErrors.length === 0, 'OWNERSHIP_CLEANUP_ERROR');
      check(
        (warnings as { number: number }[]).every((v) => v.number === 0),
        'NATIVE_WARNING',
      );
      if (kind === 'distance') {
        check(same(before.geometry, after.geometry), 'DISTANCE_GEOMETRY_MUTATION');
        check(result !== undefined, 'DISTANCE_RETURN');
        finite(result, 'DISTANCE_FINITE');
        validatePacket(fromto!, 6, 'FROMTO');
        return { snapshot: after, result, fromto: fromto! };
      }
      return { snapshot: after, result: undefined, fromto: undefined };
    };
    phase = 'first-position';
    baseline = operation('position').snapshot;
    const diff = differences(baseline, c);
    remember({
      kind: 'baseline-comparison',
      case: c.id,
      differences: diff,
      exact: diff.length === 0,
    });
    check(diff.length === 0, 'INCONCLUSIVE_ARCHIVED_GEOMETRY_MISMATCH');
    phase = 'distance';
    for (const pair of c.native_pairs_in_exact_input_order) {
      const q = operation('distance', pair);
      const conclusion = classify(model, q.snapshot, c, pair, q.result!, q.fromto!);
      conclusions.push(conclusion);
      remember({ kind: 'direct-classification', case: c.id, pair, conclusion });
    }
    phase = 'repeat-position';
    const repeat = operation('position').snapshot;
    check(same(repeat, baseline), 'INCONCLUSIVE_REPEAT_GEOMETRY_MISMATCH');
    remember({ kind: 'repeat-comparison', case: c.id, exact: true });
    phase = 'complete';
  } catch (error) {
    first = error;
  } finally {
    if (data) release(data, 'data', l);
    if (model) release(model, 'model', l);
    if (!first && l.cleanupErrors.length)
      first = new Error('FINAL_CLEANUP_ERRORS: ' + l.cleanupErrors.join('; '));
    try {
      sink.write(
        {
          kind: 'case-finish',
          case: c.id,
          phase,
          runtime: first ? 'ERROR' : 'COMPLETE',
          comparator: first ? 'INCONCLUSIVE' : 'COMPLETE',
          firstError: first ? String(first) : null,
          conclusions,
          ledger: structuredClone(l),
          scope: 'STATIC_GEOMETRY_ONLY_OLD_FAIL_GAP_D01_D02_UNCHANGED',
        },
        true,
      );
    } catch (error) {
      if (first) l.cleanupErrors.push('case-footer: ' + String(error));
      else first = error;
    }
  }
  if (first) throw first;
  check(l.cleanupErrors.length === 0, 'FINAL_CLEANUP_ERRORS');
  return { conclusions, calls };
}
async function nativeRun(env: NodeJS.ProcessEnv) {
  traceAdmission(env);
  const expectedSource = required(env, 'ASA_CCD_TRACE_SOURCE_SHA256'),
    expectedFixture = required(env, 'ASA_STATIC_FIXTURE_SHA256');
  const path = required(env, 'ASA_CCD_TRACE_RECEIPT');
  const journal = new Journal(path),
    l = ledger();
  let first: unknown,
    collector: TraceCollector | undefined,
    phase = 'PRE_IMPORT';
  try {
    journal.write({
      kind: 'preflight',
      source: { bytes: readFileSync(sourcePath).length, sha256: sha(readFileSync(sourcePath)) },
      declaredSource: expectedSource,
      declaredFixture: expectedFixture,
      counters: l,
    });
    check(sha(readFileSync(sourcePath)) === expectedSource, 'CURRENT_SOURCE_PIN');
    check(sha(readFileSync(fixturePath)) === expectedFixture, 'CURRENT_FIXTURE_PIN');
    const inputs = readInputs(env);
    const traceInputs = tracePreflight(env, inputs);
    collector = new TraceCollector(journal);
    journal.write({
      kind: 'header',
      schema: f.receipt.schema,
      traceFixture: {
        bytes: readFileSync(traceFixturePath).length,
        sha256: sha(readFileSync(traceFixturePath)),
      },
      traceAdmission: traceInputs.proof,
      profile: f.profile,
      source: { bytes: readFileSync(sourcePath).length, sha256: expectedSource },
      fixture: { bytes: readFileSync(fixturePath).length, sha256: expectedFixture },
      pins: inputs.proof,
      protocol: f.protocol,
      caps: f.caps,
      counters: l,
    });
    // Persisted header is read back BEFORE any glue import, module init or restore.
    const header = parseSigned(readFileSync(path, 'utf8').trim().split('\n').at(-1)!);
    check(
      header.source.sha256 === expectedSource && header.fixture.sha256 === expectedFixture,
      'HEADER_READBACK',
    );
    journal.reserve();
    phase = 'MODULE_IMPORT';
    const factory = (await import(pathToFileURL(traceInputs.gluePath).href)).default as (
      options: Record<string, unknown>,
    ) => Promise<Native>;
    check(l.handles.module.attempted === 0, 'MODULE_CAP');
    l.handles.module.attempted++;
    const M = await factory({
      wasmBinary: traceInputs.wasm,
      printErr: (...args: unknown[]) => collector!.accept(args),
      locateFile: (name: string) => {
        check(name === f.engine.wasm.file, 'NO_UNREGISTERED_NATIVE_RESOURCE');
        return traceInputs.wasmPath;
      },
    });
    l.handles.module.returned++;
    check(M.mj_version() === 4000000 && M.mj_versionString() === '4.0.0', 'EXACT_ENGINE_VERSION');
    check(
      typeof M.mj_fwdPosition === 'function' &&
        typeof M.mj_geomDistance === 'function' &&
        typeof M.DoubleBuffer === 'function',
      'EXACT_BINDINGS',
    );
    collector.endStartup();
    phase = 'POSITION_DISPATCH';
    const parity = new PublicParity(traceInputs.baseline);
    const hooks: OperationHooks = {
      before: (kind, c, pair) => collector!.begin(kind, c, pair),
      after: (event) => {
        collector!.end(event);
        parity.observe(event);
      },
    };
    const actual: unknown[] = [];
    for (const c of f.cases) actual.push(...runCase(M, c, l, journal, hooks).calls);
    parity.complete();
    replay(actual, false);
    journal.write({
      kind: 'trace-public-parity',
      exact: true,
      operations: 8,
      position: 4,
      distance: 4,
    });
    const evidence = interpretTraces(collector.complete(), parity);
    journal.write({
      kind: 'trace-evidence',
      evidence,
      scope: 'CHOSEN_EPA_INPUTS_AND_AFFINE_OPERATION_ONLY_NO_PHYSICS_ACCEPTANCE',
    });
    phase = 'COMPLETE';
  } catch (error) {
    first = error;
  } finally {
    try {
      journal.write(
        {
          kind: 'finish',
          phase,
          runtime: first ? 'ERROR' : 'COMPLETE',
          diagnostic: first ? 'INCONCLUSIVE' : 'COMPLETE',
          acquisition: l.position.attempted || l.distance.attempted ? 'CONSUMED' : 'PRE_DISPATCH',
          firstError: first ? String(first) : null,
          ledger: l,
          physical: 'NOT_REASSESSED_HISTORICAL_FAIL_UNCHANGED',
          causal: 'HISTORICAL_GAP_UNCHANGED',
          formal: 'D01_D02_OPEN',
          traceStream: collector?.snapshot() ?? null,
        },
        true,
      );
    } catch (error) {
      if (first) l.cleanupErrors.push('finish-footer: ' + String(error));
      else first = error;
    } finally {
      try {
        journal.close();
      } catch (error) {
        if (first) l.cleanupErrors.push('receipt-close: ' + String(error));
        else first = error;
      }
    }
  }
  if (first) throw first;
}
function infinitePlaneSupport(
  center: Vec,
  axis: Vec,
  radius: number,
  halfWidth: number,
  n: Vec,
  offset: number,
) {
  const along = dot(axis, n),
    transverse = sub(n, mul(axis, along)),
    norm = Math.hypot(...transverse),
    cap = along >= 0 ? -halfWidth : halfWidth;
  const point = add(
    add(center, mul(axis, cap)),
    norm > 0 ? mul(transverse, -radius / norm) : [0, 0, 0],
  );
  return {
    point,
    gap: dot(n, point) - offset,
    minimum: dot(n, center) - halfWidth * Math.abs(along) - radius * norm,
  };
}
function membership(point: Vec, vertices: number[][], normal: Vec, offset: number) {
  const [a, b, c] = vertices as [Vec, Vec, Vec],
    u = sub(b, a),
    v = sub(c, a),
    w = sub(point, a),
    uu = dot(u, u),
    uv = dot(u, v),
    vv = dot(v, v),
    wu = dot(w, u),
    wv = dot(w, v),
    den = uu * vv - uv * uv;
  check(den > 0, 'NONDEGENERATE_TRIANGLE');
  const s = (vv * wu - uv * wv) / den,
    t = (uu * wv - uv * wu) / den;
  return {
    barycentric: [1 - s - t, s, t],
    signedPlane: dot(normal, point) - offset,
    interior: s > 0 && t > 0 && s + t < 1,
  };
}
type ReplayRecord = {
  kind: string;
  case?: string;
  before?: Snapshot;
  after?: Snapshot;
  pair?: number[];
  distmax?: number;
  result?: Packet;
  fromto?: Packet;
  error?: string | null;
  readback?: ReturnType<typeof modelReadback>;
  conclusion?: unknown;
  exact?: boolean;
  differences?: string[];
  runtime?: string;
  comparator?: string;
  firstError?: string | null;
  conclusions?: unknown[];
  ledger?: Ledger;
  counters?: Ledger;
  source?: Pin;
  fixture?: Pin;
  diagnostic?: string;
  acquisition?: string;
};
function modelFromReceipt(readback: ReturnType<typeof modelReadback>): Model {
  const model = {
    ...readback.counts,
    opt: {},
    delete() {
      throw new Error('PURE_MODEL_NO_NATIVE_OWNERSHIP');
    },
  } as Model;
  for (const [k, v] of Object.entries(readback.arrays))
    model[k] = Array.isArray(v) ? new Int32Array(v) : new Float64Array(decodePacket(v.f64le));
  for (const [k, v] of Object.entries(readback.settings))
    model.opt[k] = typeof v === 'number' ? v : new Float64Array(decodePacket(v.f64le));
  model.mesh_vert = new Float32Array(readback.verticesF32);
  return model;
}
function replay(records: unknown[], fullReceipt = false) {
  const rows = records as ReplayRecord[];
  let position = 0,
    distance = 0;
  const result: unknown[] = [];
  for (const c of f.cases) {
    const events = rows.filter((v) => v.case === c.id),
      modelRecord = events.find((v) => v.kind === 'model');
    check(modelRecord?.readback, 'REPLAY_MODEL_REQUIRED');
    const model = modelFromReceipt(modelRecord.readback);
    check(same(modelReadback(model, c), modelRecord.readback), 'REPLAY_MODEL_READBACK');
    const ops = events.filter((v) => v.kind === 'position' || v.kind === 'distance');
    check(
      same(
        ops.map((v) => v.kind),
        ['position', 'distance', 'distance', 'position'],
      ),
      'REPLAY_EXACT_OPERATION_ORDER',
    );
    const expected = decodeFrame(c).pre.f64le,
      first = ops[0]!.after;
    check(first, 'REPLAY_FIRST_POSITION');
    check(differences(first, c).length === 0, 'REPLAY_ARCHIVED_GEOMETRY');
    const cmp = events.find((v) => v.kind === 'baseline-comparison');
    check(cmp?.exact === true && same(cmp.differences, []), 'REPLAY_BASELINE_LABEL');
    const derived: unknown[] = [];
    let query = 0;
    for (const op of ops) {
      check(op.error === null && op.before && op.after, 'REPLAY_RAW_OPERATION');
      validateSnapshot(op.before, c);
      validateSnapshot(op.after, c);
      check(
        op.before.state.f64le === expected && op.after.state.f64le === expected,
        'REPLAY_STATE',
      );
      if (op.kind === 'position') position++;
      else distance++;
      check(
        op.counters?.position.attempted === position &&
          op.counters.position.returned === position &&
          op.counters.distance.attempted === distance &&
          op.counters.distance.returned === distance,
        'REPLAY_ACTUAL_CALL_COUNTERS',
      );
      if (op.kind === 'distance') {
        check(
          same(op.pair, c.native_pairs_in_exact_input_order[query++]) && op.distmax === 0,
          'REPLAY_QUERY_INPUT_ORDER',
        );
        check(
          same(op.before.geometry, op.after.geometry) && same(op.after.geometry, first.geometry),
          'REPLAY_DISTANCE_MUTATION',
        );
        check(op.result && op.fromto, 'REPLAY_DIRECT_OUTPUT');
        validatePacket(op.result, 1, 'REPLAY_DISTANCE');
        validatePacket(op.fromto, 6, 'REPLAY_FROMTO');
        derived.push(classify(model, op.after, c, op.pair!, op.result.values[0]!, op.fromto));
      }
    }
    check(same(ops[3]!.after, first), 'REPLAY_REPEAT_GEOMETRY');
    check(
      events.find((v) => v.kind === 'repeat-comparison')?.exact === true,
      'REPLAY_REPEAT_LABEL',
    );
    const labels = events
      .filter((v) => v.kind === 'direct-classification')
      .map((v) => v.conclusion);
    check(same(labels, derived), 'REPLAY_FORGED_CLASSIFICATION');
    const finish = events.find((v) => v.kind === 'case-finish');
    check(
      finish?.runtime === 'COMPLETE' &&
        finish.comparator === 'COMPLETE' &&
        finish.firstError === null &&
        same(finish.conclusions, derived),
      'REPLAY_CASE_TERMINAL',
    );
    result.push({ case: c.id, derived });
  }
  check(position === 4 && distance === 4, 'REPLAY_FOUR_PLUS_FOUR');
  if (fullReceipt) {
    const header = rows.find((v) => v.kind === 'header'),
      finish = rows.at(-1);
    check(
      header?.source?.sha256 === sha(readFileSync(sourcePath)) &&
        header.fixture?.sha256 === sha(readFileSync(fixturePath)),
      'REPLAY_CURRENT_SOURCE_FIXTURE',
    );
    check(
      finish?.kind === 'finish' &&
        finish.runtime === 'COMPLETE' &&
        finish.diagnostic === 'COMPLETE' &&
        finish.acquisition === 'CONSUMED' &&
        finish.firstError === null &&
        finish.ledger,
      'REPLAY_FINAL_TERMINAL',
    );
    const l = finish.ledger;
    check(
      l.position.attempted === 4 &&
        l.position.returned === 4 &&
        l.distance.attempted === 4 &&
        l.distance.returned === 4 &&
        l.step1 === 0 &&
        l.step2 === 0 &&
        l.forward === 0 &&
        l.cleanupErrors.length === 0,
      'REPLAY_FINAL_CALLS',
    );
    check(
      l.handles.module.attempted === 1 &&
        l.handles.module.returned === 1 &&
        l.handles.model.returned === 2 &&
        l.handles.data.returned === 2 &&
        l.handles.buffer.returned === 4,
      'REPLAY_FINAL_HANDLES',
    );
    for (const kind of [
      'model',
      'data',
      'buffer',
      'contactVector',
      'contactCopy',
      'warningCopy',
    ] as Kind[]) {
      const h = l.handles[kind];
      check(
        h.attempted === h.returned && h.deleteAttempted === h.returned && h.deleted === h.returned,
        'REPLAY_CLEANUP_' + kind,
      );
    }
  }
  return result;
}

// Separately selected logging-only mode. These helpers perform no compilation or engine import.
const traceToken = 'one-cylinder-primary-epa-trace-1071';
function traceAdmission(env: NodeJS.ProcessEnv) {
  check(env.ASA_CCD_TRACE_NATIVE === traceToken, 'EXACT_TRACE_OPT_IN_OLD_STATIC_CONSUMED');
  for (const key of Object.keys(env))
    if (key !== 'ASA_CCD_TRACE_NATIVE' && /^ASA_/.test(key) && /(?:NATIVE|ACQUIRE)/.test(key))
      check(env[key] === undefined, 'AMBIGUOUS_OR_CONSUMED_MODE_' + key);
}
function applyTracePatch(original: string, patch: string) {
  const input = original.split('\n');
  if (input.at(-1) === '') input.pop();
  const output: string[] = [];
  let cursor = 0,
    hunks = 0;
  const lines = patch.split('\n');
  check(
    lines[0] === '--- a/src/engine/engine_collision_gjk.c' &&
      lines[1] === '+++ b/src/engine/engine_collision_gjk.c',
    'PATCH_ONLY_GJK',
  );
  for (let i = 2; i < lines.length; i++) {
    const line = lines[i]!;
    if (line === '') continue;
    const h = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@$/.exec(line);
    check(h, 'PATCH_HUNK');
    const oldCount = h[2] === undefined ? 1 : Number(h[2]),
      newCount = h[4] === undefined ? 1 : Number(h[4]);
    const from = Number(h[1]) - (oldCount === 0 ? 0 : 1);
    check(from >= cursor, 'PATCH_ORDER');
    output.push(...input.slice(cursor, from));
    cursor = from;
    let removed = 0,
      added = 0;
    hunks++;
    while (i + 1 < lines.length && !lines[i + 1]!.startsWith('@@ ')) {
      const row = lines[++i]!;
      if (row === '' && i === lines.length - 1) break;
      const tag = row[0],
        body = row.slice(1);
      check(tag === ' ' || tag === '+' || tag === '-', 'PATCH_LINE');
      if (tag !== '+') {
        check(input[cursor] === body, 'PATCH_CONTEXT_EXACT');
        cursor++;
        removed++;
      }
      if (tag !== '-') {
        output.push(body);
        added++;
      }
    }
    check(removed === oldCount && added === newCount, 'PATCH_HUNK_COUNTS');
  }
  check(hunks > 0, 'PATCH_NONEMPTY');
  output.push(...input.slice(cursor));
  return output.join('\n') + '\n';
}
function traceOperationInverse(patched: string) {
  let inverse = patched
    .replace(
      /^\/\/ ASA_PRIMARY_EPA_TRACE_BEGIN helpers\n[\s\S]*?^\/\/ ASA_PRIMARY_EPA_TRACE_END helpers\n\n/gm,
      '',
    )
    .replace(
      /^\/\/ ASA_PRIMARY_EPA_TRACE_BEGIN [a-z]+\n[\s\S]*?^\/\/ ASA_PRIMARY_EPA_TRACE_END [a-z]+\n/gm,
      '',
    );
  for (const rewrite of t.patch.inverseRewrites) {
    check(inverse.split(rewrite.after).length === 2, 'EXACT_PRIVATE_ARGUMENT_REWRITE');
    inverse = inverse.replace(rewrite.after, rewrite.before);
  }
  check(
    !inverse.includes('asa_primary') &&
      !inverse.includes('asa_trace') &&
      !inverse.includes('ASAPrimary'),
    'NO_UNACCOUNTED_TRACE_OPERATIONS',
  );
  return inverse;
}
function patchPreflight(env: NodeJS.ProcessEnv) {
  const raw = pinFile(required(env, 'ASA_CCD_TRACE_UPSTREAM_GJK'), {
    bytes: t.patch.upstreamBytes,
    sha256: t.immutableInputs.upstream_gjk.sha256,
  });
  const patch = pinFile(join(dirname(sourcePath), t.patch.file), t.patch),
    patched = applyTracePatch(raw.toString(), patch.toString());
  check(
    Buffer.byteLength(patched) === t.patch.patchedBytes && sha(patched) === t.patch.patchedSha256,
    'PATCHED_GJK_EXACT',
  );
  check(
    Buffer.from(traceOperationInverse(patched)).equals(raw),
    'UNCHANGED_NUMERICAL_OPERATIONS_INVERSE',
  );
  return { patch: sha(patch), original: sha(raw), patched: sha(patched) };
}
function archiveMembers(raw: Buffer) {
  check(raw.subarray(0, 8).toString() === '!<arch>\n', 'AR_MAGIC');
  let at = 8,
    table: Buffer = Buffer.alloc(0);
  const out = new Map<string, Buffer>();
  while (at < raw.length) {
    check(at + 60 <= raw.length, 'AR_HEADER');
    const h = raw.subarray(at, at + 60);
    check(h.subarray(58).toString() === '`\n', 'AR_HEADER_END');
    const sizeText = h.subarray(48, 58).toString().trim();
    check(/^\d+$/.test(sizeText), 'AR_SIZE');
    const size = Number(sizeText);
    check(Number.isSafeInteger(size) && at + 60 + size <= raw.length, 'AR_BODY');
    let name = h.subarray(0, 16).toString().trim(),
      body = raw.subarray(at + 60, at + 60 + size);
    at += 60 + size + (size % 2);
    check(at <= raw.length, 'AR_PADDING');
    if (name === '//') {
      table = body;
      continue;
    }
    if (name === '/' || name === '/SYM64/') continue;
    if (/^\/\d+$/.test(name)) {
      const start = Number(name.slice(1)),
        end = table.indexOf('/\n', start);
      check(end >= start, 'AR_LONG_NAME');
      name = table.subarray(start, end).toString();
    } else if (name.startsWith('#1/')) {
      const n = Number(name.slice(3));
      check(Number.isInteger(n) && n > 0 && n <= body.length, 'AR_BSD_NAME');
      name = body.subarray(0, n).toString().replace(/\0+$/, '');
      body = body.subarray(n);
    } else name = name.replace(/\/$/, '');
    check(name.length > 0 && !out.has(name), 'AR_UNIQUE_MEMBER');
    out.set(name, body);
  }
  check(at === raw.length, 'AR_END');
  return out;
}
function verifyArchive(raw: Buffer, candidate = false) {
  const members = archiveMembers(raw);
  check(members.size === t.build.archive.members.length, 'AR_72_MEMBERS');
  for (const expected of t.build.archive.members) {
    const body = members.get(expected.name);
    check(body, 'AR_MISSING_MEMBER');
    if (candidate && expected.name === t.build.archive.changedMember)
      check(sha(body) !== expected.sha256, 'AR_GJK_ACTUALLY_CHANGED');
    else
      check(
        body.length === expected.bytes && sha(body) === expected.sha256,
        'AR_UNCHANGED_MEMBER_' + expected.name,
      );
  }
  return members.get(t.build.archive.changedMember)!;
}
function wasmExports(raw: Buffer) {
  check(
    raw.subarray(0, 8).equals(Buffer.from([0, 97, 115, 109, 1, 0, 0, 0])),
    'WASM_BINARY_HEADER',
  );
  let at = 8;
  const leb = () => {
    let value = 0,
      shift = 0;
    let b: number;
    do {
      check(at < raw.length && shift < 35, 'WASM_ULEB');
      b = raw[at++]!;
      value += (b & 127) * 2 ** shift;
      shift += 7;
    } while (b & 128);
    return value;
  };
  while (at < raw.length) {
    const id = raw[at++]!,
      size = leb(),
      end = at + size;
    check(end <= raw.length, 'WASM_SECTION_CAP');
    if (id === 7) {
      const count = leb(),
        exports: { name: string; kind: number }[] = [];
      check(count < 10000, 'WASM_EXPORT_CAP');
      for (let i = 0; i < count; i++) {
        const n = leb();
        check(at + n <= end, 'WASM_EXPORT_NAME');
        const name = raw.subarray(at, at + n).toString();
        at += n;
        const kind = raw[at++]!;
        leb();
        exports.push({ name, kind });
      }
      check(at === end, 'WASM_EXPORT_SECTION_END');
      return exports;
    }
    at = end;
  }
  throw new Error('WASM_EXPORTS_REQUIRED');
}
function historicalTraceInputs(env: NodeJS.ProcessEnv) {
  const p = t.immutableInputs;
  pinFile(required(env, 'ASA_CCD_TRACE_ARCHIVED_SPEC'), p.static_source.spec);
  pinFile(fixturePath, p.static_source.fixture);
  const patch = patchPreflight(env),
    raw = pinFile(required(env, 'ASA_CCD_TRACE_BASELINE'), p.static_raw),
    baseline = raw
      .toString()
      .trim()
      .split('\n')
      .map((line) => parseSigned(line)) as ReplayRecord[];
  replay(baseline, false);
  const header = baseline.find((v) => v.kind === 'header'),
    finish = baseline.at(-1);
  check(
    header?.source?.sha256 === p.static_source.spec.sha256 &&
      header.fixture?.sha256 === p.static_source.fixture.sha256,
    'BASELINE_SOURCE_BINDING',
  );
  check(
    finish?.kind === 'finish' &&
      finish.runtime === 'COMPLETE' &&
      finish.diagnostic === 'COMPLETE' &&
      finish.acquisition === 'CONSUMED' &&
      finish.firstError === null &&
      finish.ledger,
    'BASELINE_COMPLETE_CONSUMED',
  );
  const l = finish.ledger;
  check(
    l.position.attempted === 4 &&
      l.position.returned === 4 &&
      l.distance.attempted === 4 &&
      l.distance.returned === 4 &&
      l.step1 === 0 &&
      l.step2 === 0 &&
      l.forward === 0 &&
      l.cleanupErrors.length === 0,
    'BASELINE_CALLS',
  );
  const audit = parseSigned(
    pinFile(required(env, 'ASA_CCD_TRACE_BASELINE_AUDIT'), p.independent_static_audit).toString(),
  );
  check(
    audit.schema === 'ASA_INDEPENDENT_STATIC_WHEEL_DISK_AUDIT_V1' &&
      audit.source_commit === p.static_source.commit &&
      audit.source_tree === p.static_source.tree &&
      audit.input_pins.position_receipt.sha256 === p.static_raw.sha256 &&
      audit.input_pins.source.sha256 === p.static_source.spec.sha256 &&
      audit.input_pins.fixture.sha256 === p.static_source.fixture.sha256 &&
      audit.verdict === 'COMPLETE_VALID_POSITION_ONLY_OBSERVATION',
    'BASELINE_INDEPENDENT_AUDIT',
  );
  const archive = pinFile(required(env, 'ASA_CCD_TRACE_BASE_ARCHIVE'), t.build.archive);
  verifyArchive(archive);
  pinFile(required(env, 'ASA_CCD_TRACE_COMPILE_COMMANDS'), t.build.compileCommands);
  return {
    baseline,
    proof: {
      patch,
      baseline: p.static_raw,
      audit: p.independent_static_audit,
      originalArchive: t.build.archive.sha256,
    },
  };
}
type BuildCommand = { executable: string; argv: string[]; cwd: string };
type TraceBuild = {
  schema: string;
  patchSha256: string;
  originalGjkSha256: string;
  patchedGjkSha256: string;
  inheritedBuildSha256: string;
  compileCommand: typeof t.build.command;
  actualCompile: BuildCommand;
  actualLink: BuildCommand;
  linkCommand: typeof t.build.inheritedLink;
  files: Record<
    'archive' | 'object' | 'glue' | 'wasm' | 'declarations' | 'patchedSource',
    Pin & { file: string }
  >;
  reused: { inheritedPath: string; file: string }[];
};
function childFile(root: string, file: string) {
  check(!isAbsolute(file) && file.length > 0, 'PRIVATE_RELATIVE_FILE');
  const path = resolve(root, file);
  check(inside(root, path) && path !== root, 'PRIVATE_FILE_SCOPE');
  check(
    inside(root, realpathSync(path)) && !lstatSync(path).isSymbolicLink(),
    'PRIVATE_REAL_FILE_SCOPE',
  );
  return path;
}

function commandRecipe(b: TraceBuild, root: string) {
  const norm = (value: string) => value.replace(/\\/g, '/'),
    oldRoot = norm(t.build.inheritedLink.cwd).replace(/\/scratch$/, ''),
    newRoot = norm(root);
  const old = t.build.command.command.split(/\s+/).map(norm),
    expected = old.slice(1);
  const inputIndex = expected.indexOf('-c') + 1,
    outputIndex = expected.indexOf('-o') + 1;
  check(inputIndex > 0 && outputIndex > 0, 'ORIGINAL_COMPILE_ROLES');
  expected[inputIndex] = '<GJK_SOURCE>';
  expected[outputIndex] = '<GJK_OBJECT>';
  check(
    norm(b.actualCompile.executable) === norm(t.build.inheritedLink.executable) &&
      norm(b.actualLink.executable) === norm(t.build.inheritedLink.executable),
    'PINNED_PYTHON_EXECUTABLE',
  );
  const emxx = norm(t.build.inheritedLink.argv[4]!),
    emcc = emxx.replace(/em\+\+\.py$/, 'emcc.py');
  check(
    norm(b.actualCompile.argv[4]!) === emcc && norm(b.actualLink.argv[4]!) === emxx,
    'PINNED_COMPILER_ENTRY',
  );
  check(
    same(b.actualCompile.argv.slice(0, 3), t.build.inheritedLink.argv.slice(0, 3)) &&
      b.actualCompile.argv[3]!.startsWith('pycache_prefix=') &&
      inside(root, resolve(b.actualCompile.argv[3]!.slice('pycache_prefix='.length))),
    'PROCESS_LOCAL_COMPILER_PREFIX',
  );
  check(
    inside(root, resolve(b.actualCompile.cwd)) && inside(root, resolve(b.actualLink.cwd)),
    'PRIVATE_COMMAND_CWD',
  );
  const actual = b.actualCompile.argv.slice(5).map(norm),
    actualInput = actual.indexOf('-c') + 1,
    actualOutput = actual.indexOf('-o') + 1;
  check(
    actualInput > 0 &&
      actualOutput > 0 &&
      resolve(b.actualCompile.cwd, actual[actualInput]!) ===
        resolve(root, b.files.patchedSource.file) &&
      resolve(b.actualCompile.cwd, actual[actualOutput]!) === resolve(root, b.files.object.file),
    'PRIVATE_EXACT_COMPILE_SOURCE_OUTPUT',
  );
  actual[actualInput] = '<GJK_SOURCE>';
  actual[actualOutput] = '<GJK_OBJECT>';
  check(same(actual, expected), 'UNCHANGED_ALL_COMPILE_FLAGS_AND_HEADERS');
  const relocate = (args: string[], prefix: string) =>
    args.map((v) => norm(v).split(prefix).join('<PRIVATE>'));
  check(
    same(relocate(b.actualLink.argv, newRoot), relocate(t.build.inheritedLink.argv, oldRoot)) &&
      norm(b.actualLink.cwd).split(newRoot).join('<PRIVATE>') ===
        norm(t.build.inheritedLink.cwd).split(oldRoot).join('<PRIVATE>'),
    'UNCHANGED_LINK_FLAGS_ONLY_PRIVATE_RELOCATION',
  );
  check(
    norm(b.files.glue.file) === 'artifact/mujoco.js' &&
      norm(b.files.wasm.file) === 'artifact/mujoco.wasm' &&
      norm(b.files.declarations.file) === 'artifact/mujoco.d.ts' &&
      norm(b.files.archive.file) === 'input/lib/libmujoco.a',
    'EXACT_PRIVATE_INHERITED_LAYOUT',
  );
  for (const item of b.reused) {
    const pin = t.build.inheritedInputs.find((v) => v.path === item.inheritedPath);
    check(pin, 'REUSED_COMMAND_PIN');
    const suffix = pin.path.split('/build/')[1]!;
    const original = t.build.inheritedLink.argv.find((v) => norm(v).endsWith('/' + suffix));
    check(original && norm(original).startsWith(oldRoot + '/'), 'REUSED_ORIGINAL_LINK_INPUT');
    check(
      norm(item.file) === norm(original).slice(oldRoot.length + 1),
      'REUSED_BYTES_ARE_ACTUAL_LINK_INPUT',
    );
  }
}
function privateArtifact(env: NodeJS.ProcessEnv, baselineWasm: Buffer) {
  const path = required(env, 'ASA_CCD_TRACE_BUILD_RECEIPT'),
    digest = required(env, 'ASA_CCD_TRACE_BUILD_RECEIPT_SHA256');
  check(/^[0-9a-f]{64}$/.test(digest), 'REVIEWED_BUILD_RECEIPT_SHA256');
  const raw = readFileSync(path);
  check(raw.length < 1048576 && sha(raw) === digest, 'REVIEWED_PRIVATE_BUILD_RECEIPT');
  const root = dirname(realpathSync(path));
  check(inside(realpathSync(tmpdir()), root) && !inside(repo, root), 'PRIVATE_BUILD_OS_TEMP');
  const b = parseSigned(raw.toString()) as TraceBuild;
  check(
    b.schema === t.build.schema &&
      b.patchSha256 === t.patch.sha256 &&
      b.originalGjkSha256 === t.immutableInputs.upstream_gjk.sha256 &&
      b.patchedGjkSha256 === t.patch.patchedSha256 &&
      b.inheritedBuildSha256 === f.engine.buildReceipt.sha256,
    'PRIVATE_BUILD_SOURCE_LINK',
  );
  // The reviewed build receipt records the frozen original recipe verbatim. Actual commands
  // may relocate only source/object/output/archive paths under its owned private workspace.
  check(
    same(b.compileCommand, t.build.command) && same(b.linkCommand, t.build.inheritedLink),
    'PRIVATE_BUILD_INHERITED_RECIPES',
  );
  commandRecipe(b, root);
  const read = (key: keyof TraceBuild['files']) => {
    const pin = b.files[key];
    check(pin && typeof pin.file === 'string', 'PRIVATE_ARTIFACT_FIELD');
    return pinFile(childFile(root, pin.file), pin);
  };
  const archive = read('archive'),
    object = read('object'),
    member = verifyArchive(archive, true);
  check(member.equals(object), 'PRIVATE_EXACT_REPLACEMENT_OBJECT');
  check(
    b.files.patchedSource.bytes === t.patch.patchedBytes &&
      b.files.patchedSource.sha256 === t.patch.patchedSha256,
    'PRIVATE_PATCHED_SOURCE_PIN',
  );
  read('patchedSource');
  const inherited = t.build.inheritedInputs.filter(
    (v) => !v.path.endsWith('/libmujoco.a') && !v.path.endsWith('/engine_collision_gjk.c.o'),
  );
  check(
    b.reused.length === inherited.length &&
      new Set(b.reused.map((v) => v.inheritedPath)).size === inherited.length,
    'PRIVATE_REUSED_INPUT_CENSUS',
  );
  for (const pin of inherited) {
    const found = b.reused.find((v) => v.inheritedPath === pin.path);
    check(found, 'PRIVATE_REUSED_INPUT_REQUIRED');
    pinFile(childFile(root, found.file), pin);
  }
  const glue = read('glue'),
    wasm = read('wasm'),
    declarations = read('declarations');
  check(
    sha(wasm) !== f.engine.wasm.sha256 && wasm.includes(Buffer.from(t.frame.prefix + ' ints=')),
    'PRIVATE_LOGGING_WASM_REQUIRED',
  );
  check(
    declarations.length === f.engine.declarations.bytes &&
      sha(declarations) === f.engine.declarations.sha256,
    'NO_DECLARATION_API_CHANGE',
  );
  check(same(wasmExports(baselineWasm), wasmExports(wasm)), 'NO_WASM_EXPORT_API_CHANGE');
  check(
    b.files.glue.file.endsWith('/mujoco.js') && b.files.wasm.file.endsWith('/mujoco.wasm'),
    'PRIVATE_ORIGINAL_RESOURCE_NAMES',
  );
  return {
    gluePath: childFile(root, b.files.glue.file),
    wasmPath: childFile(root, b.files.wasm.file),
    wasm,
    proof: {
      receipt: { bytes: raw.length, sha256: digest },
      files: b.files,
      reused: b.reused,
      archiveMembers: 72,
      oneReplacedObjectSha256: sha(object),
      glueSha256: sha(glue),
      exports: wasmExports(wasm),
    },
  };
}
function tracePreflight(env: NodeJS.ProcessEnv, inputs: ReturnType<typeof readInputs>) {
  check(
    sha(readFileSync(traceFixturePath)) === required(env, 'ASA_CCD_TRACE_FIXTURE_SHA256'),
    'CURRENT_TRACE_FIXTURE_PIN',
  );
  const historical = historicalTraceInputs(env),
    artifact = privateArtifact(env, inputs.wasm);
  return {
    ...artifact,
    baseline: historical.baseline,
    proof: { historical: historical.proof, artifact: artifact.proof },
  };
}
function publicProjection(v: ReplayRecord) {
  const {
    kind,
    case: id,
    pair,
    distmax,
    before,
    after,
    result,
    fromto,
    warnings,
    error,
    counters,
  } = v as ReplayRecord & { warnings?: unknown };
  return {
    kind,
    case: id,
    pair,
    distmax,
    before,
    after,
    result,
    fromto,
    warnings,
    error,
    counters,
  };
}
class PublicParity {
  private index = 0;
  private completed = false;
  readonly actual: ReplayRecord[] = [];
  private expected: ReplayRecord[];
  constructor(records: unknown[]) {
    this.expected = (records as ReplayRecord[]).filter(
      (v) => v.kind === 'position' || v.kind === 'distance',
    );
    check(this.expected.length === 8, 'PARITY_EXACT_8_EXPECTED');
  }
  observe(event: ReplayRecord) {
    check(!this.completed && this.index < 8, 'PARITY_NO_EXTRA_API');
    check(
      same(publicProjection(event), publicProjection(this.expected[this.index]!)),
      'PUBLIC_F64_GEOMETRY_STATE_FROMTO_DIST_COUNTER_PARITY',
    );
    this.actual.push(event);
    this.index++;
  }
  complete() {
    check(
      this.index === 8 && this.actual.filter((v) => v.kind === 'distance').length === 4,
      'PUBLIC_BOTH_CASES_COMPLETE',
    );
    this.completed = true;
  }
  admitted() {
    check(this.completed, 'NO_TRACE_INTERPRETATION_BEFORE_PUBLIC_PARITY');
    return this.actual;
  }
}
type TraceContext = {
  kind: 'module' | 'position' | 'distance';
  case?: string;
  pair?: number[];
  lines: string[];
  bytes: number;
};
class TraceCollector {
  private startupDone = false;
  private active: TraceContext = { kind: 'module', lines: [], bytes: 0 };
  private errors: string[] = [];
  private used = 0;
  private completed: TraceContext[] = [];
  constructor(private sink: Sink) {}
  accept(args: unknown[]) {
    // Never throw out of an engine print callback. Capture/latch, then stop after return.
    try {
      const text = args.map(String).join(' '),
        count = Buffer.byteLength(text) + 1,
        remaining = t.caps.max_stderr_bytes - this.used;
      if (args.length !== 1 || typeof args[0] !== 'string')
        this.errors.push('TRACE_CALLBACK_ARGUMENTS');
      if (count > remaining) {
        this.errors.push('TRACE_STDERR_OVERFLOW bytes=' + count + ' sha256=' + sha(text));
        this.sink.write(
          {
            kind: 'trace-stderr-overflow',
            context: this.active.kind,
            case: this.active.case,
            bytes: count,
            sha256: sha(text),
            prefix: text.slice(0, Math.max(0, remaining - 1)),
          },
          true,
        );
        this.used = t.caps.max_stderr_bytes;
        return;
      }
      if (this.startupDone && this.active.kind === 'module')
        this.errors.push('TRACE_OUTSIDE_PUBLIC_API');
      this.used += count;
      this.active.bytes += count;
      this.active.lines.push(text);
      this.sink.write({
        kind: 'trace-stderr-raw',
        context: this.active.kind,
        case: this.active.case,
        pair: this.active.pair ?? null,
        text,
        bytes: count,
      });
      if (count > t.frame.maxRecordBytes) this.errors.push('TRACE_RECORD_OVERFLOW');
    } catch (error) {
      this.errors.push('TRACE_CAPTURE_ERROR: ' + String(error));
    }
  }
  endStartup() {
    this.sink.write({ kind: 'trace-startup-stderr', stream: this.active, errors: this.errors });
    check(this.active.lines.length === 0 && this.errors.length === 0, 'UNEXPECTED_STARTUP_STDERR');
    this.active = { kind: 'module', lines: [], bytes: 0 };
    this.startupDone = true;
  }
  begin(kind: 'position' | 'distance', c: Case, pair?: number[]) {
    check(
      this.startupDone && this.active.kind === 'module' && this.active.lines.length === 0,
      'TRACE_NO_OVERWRITTEN_CONTEXT',
    );
    check(this.errors.length === 0, 'TRACE_PENDING_ERROR');
    check(
      this.used + t.frame.maxRecordBytes <= t.caps.max_stderr_bytes,
      'TRACE_PRECALL_BYTE_RESERVE',
    );
    check(this.completed.length < 8, 'TRACE_API_CONTEXT_CAP');
    this.active = { kind, case: c.id, pair, lines: [], bytes: 0 };
  }
  end(event: ReplayRecord) {
    const active = this.active;
    this.completed.push(structuredClone(active));
    this.sink.write({ kind: 'trace-api-stderr', stream: active, errors: this.errors });
    check(
      event.kind === active.kind &&
        event.case === active.case &&
        same(event.pair ?? undefined, active.pair),
      'TRACE_API_CONTEXT',
    );
    check(this.errors.length === 0, 'TRACE_CAPTURE_FAILED: ' + this.errors[0]);
    check(
      active.lines.length === (active.kind === 'distance' ? 1 : 0),
      'TRACE_EXACT_CONTEXT_RECORD_COUNT',
    );
    if (active.kind === 'distance') {
      check(active.lines[0]!.startsWith(t.frame.prefix + ' ints='), 'TRACE_FRAMED_PREFIX');
      traceEnvelope(active.lines[0]!); // syntax only; never read coefficients before full public parity
    }
    this.active = { kind: 'module', lines: [], bytes: 0 };
  }
  snapshot() {
    return {
      bytes: this.used,
      errors: this.errors,
      completed: this.completed,
      active: this.active,
    };
  }
  complete() {
    check(
      this.errors.length === 0 &&
        this.completed.length === 8 &&
        this.active.kind === 'module' &&
        this.active.lines.length === 0,
      'TRACE_STREAM_COMPLETE',
    );
    const queries = this.completed.filter((v) => v.kind === 'distance');
    check(
      queries.length === t.caps.max_trace_records && queries.every((v) => v.lines.length === 1),
      'TRACE_EXACT_FOUR',
    );
    return queries;
  }
}
type DecodedTrace = { ints: number[]; words: Packet; query: (typeof t.queries)[number] };
function traceEnvelope(line: string) {
  check(!line.includes('\n') && !line.includes('\r'), 'TRACE_SINGLE_LINE');
  const match = /^ASA_PRIMARY_EPA_V1 ints=([-0-9,]+) f64le=([0-9a-f]+)$/.exec(line);
  check(
    match && match[1]!.split(',').length === 32 && match[2]!.length === 75 * 16,
    'TRACE_FRAMING',
  );
  check(
    match[1]!.split(',').every((v) => /^(?:0|-?[1-9][0-9]*)$/.test(v)),
    'TRACE_INTEGER_ENCODING',
  );
  return match;
}
function decodeTrace(line: string, index: number): DecodedTrace {
  check(Buffer.byteLength(line) + 1 <= t.frame.maxRecordBytes, 'TRACE_LINE_CAP');
  check(!line.includes('\n') && !line.includes('\r'), 'TRACE_SINGLE_LINE');
  const match = /^ASA_PRIMARY_EPA_V1 ints=([-0-9,]+) f64le=([0-9a-f]+)$/.exec(line);
  check(match, 'TRACE_FRAMING');
  const parts = match[1]!.split(',');
  check(
    parts.length === t.frame.ints.length && parts.every((p) => /^(?:0|-?[1-9][0-9]*)$/.test(p)),
    'TRACE_INTEGER_ENCODING',
  );
  const ints = parts.map(Number);
  check(
    ints.every((n) => Number.isSafeInteger(n) && n >= -2147483648 && n <= 2147483647),
    'TRACE_INT32',
  );
  check(match[2]!.length === t.frame.words * 16, 'TRACE_75_F64');
  const words = packet(decodePacket(match[2]!));
  validatePacket(words, 75, 'TRACE_WORDS');
  const query = t.queries[index];
  check(
    query && ints[0] === query.index && same(ints.slice(1, 5), [...query.pair, 5, 7]),
    'TRACE_QUERY_IDENTITY',
  );
  check(
    same(ints.slice(5, 9), [100, 1, 0, 0]) &&
      ints[11] === 0 &&
      ints[12] === 1 &&
      ints[27] === 3 &&
      ints[28] === 3 &&
      ints[31] === 1,
    'TRACE_FROZEN_DISPATCH',
  );
  check(
    ints[9]! >= 0 &&
      ints[9]! <= 100 &&
      ints[10]! >= 0 &&
      ints[10]! <= 100 &&
      ints[15]! >= 3 &&
      ints[15]! <= 105 &&
      ints[16]! >= 0 &&
      ints[16]! <= 600 &&
      ints[17]! >= 0 &&
      ints[17]! <= 600,
    'TRACE_INTERNAL_CAPS',
  );
  check(
    same(ints.slice(18, 21), [
      ints[13]! & 1023,
      (ints[13]! >>> 10) & 1023,
      (ints[13]! >>> 20) & 1023,
    ]) && ints.slice(18, 21).every((n) => n >= 0 && n < ints[15]!),
    'TRACE_FACE_VERTEX_IDS',
  );
  const c = f.cases.find((c) => c.id === query.case)!,
    native = c.archivedFactory.mesh.native,
    mesh = native.integers.geom_dataid[query.pair[1]!]!,
    vertices = native.integers.mesh_vertnum[mesh]!;
  check(
    ints[29] === vertices &&
      (ints[30] === 0 || ints[30] === 1) &&
      (vertices >= 10 || ints[30] === 0),
    'TRACE_ACTUAL_MESH_DISPATCH',
  );
  for (let i = 0; i < 3; i++)
    check(
      (ints[21 + 2 * i] === 0 || ints[21 + 2 * i] === 1) &&
        ints[22 + 2 * i]! >= 0 &&
        ints[22 + 2 * i]! < vertices,
      'TRACE_SELECTED_SUPPORT_IDS',
    );
  const hex = words.f64le;
  check(
    hex.slice(41 * 16, 56 * 16) === query.objectF64le[0] &&
      hex.slice(57 * 16, 72 * 16) === query.objectF64le[1] &&
      hex.slice(56 * 16, 57 * 16) === packet([0]).f64le &&
      hex.slice(72 * 16, 73 * 16) === packet([0]).f64le &&
      hex.slice(73 * 16) === packet([1e-8, 0]).f64le,
    'TRACE_EXACT_CONTEXT_BITS',
  );
  check(
    hex.slice(34 * 16, 40 * 16) === query.fromto.f64le &&
      hex.slice(40 * 16, 41 * 16) === query.distance.f64le,
    'TRACE_PUBLIC_OUTPUT_BITS',
  );
  return { ints, words, query };
}
function nextUpPositive(value: number) {
  check(Number.isFinite(value) && value >= 0, 'FINITE_ARITHMETIC_ENVELOPE');
  if (value === 0) return Number.MIN_VALUE;
  const raw = bytes([value]);
  raw.writeBigUInt64LE(raw.readBigUInt64LE() + 1n);
  return raw.readDoubleLE();
}
const upSum = (values: number[]) => values.reduce((a, b) => nextUpPositive(a + b), 0);
function arithmeticEnvelope(a: number[], b: number[]) {
  check(a.length === b.length && a.length > 0, 'ARITHMETIC_TERMS');
  const u = Number.EPSILON / 2,
    ops = 2 * a.length - 1,
    gamma = nextUpPositive((ops * u) / (1 - ops * u)),
    magnitude = upSum(a.map((x, i) => nextUpPositive(Math.abs(x) * Math.abs(b[i]!))));
  return nextUpPositive(nextUpPositive(gamma * magnitude) + ops * Number.MIN_VALUE);
}
function interpretTraces(stream: TraceContext[], parity: PublicParity) {
  const operations = parity.admitted(),
    distance = operations.filter((v) => v.kind === 'distance');
  check(stream.length === 4 && distance.length === 4, 'TRACE_INTERPRET_COMPLETE_PAIR');
  return stream.map((raw, index) => {
    const decoded = decodeTrace(raw.lines[0]!, index),
      v = decoded.words.values,
      lambda = v.slice(0, 3),
      vertices = [7, 16, 25].map((at) => ({
        minkowski: v.slice(at, at + 3) as Vec,
        first: v.slice(at + 3, at + 6) as Vec,
        second: v.slice(at + 6, at + 9) as Vec,
      }));
    const operation = distance[index]!;
    check(
      operation.case === raw.case &&
        same(operation.pair, raw.pair) &&
        operation.after &&
        operation.result &&
        operation.fromto,
      'TRACE_RETAINED_QUERY_CONTEXT',
    );
    check(
      operation.fromto.f64le === decoded.words.f64le.slice(34 * 16, 40 * 16) &&
        operation.result.f64le === decoded.words.f64le.slice(40 * 16, 41 * 16),
      'TRACE_ACTUAL_MEASURED_OUTPUT_LINK',
    );
    const components = (key: 'first' | 'second', native: number[]) =>
      [0, 1, 2].map((axis) => {
        const a = vertices.map((p) => p[key][axis]!),
          predicted = lambda[0]! * a[0]! + lambda[1]! * a[1]! + lambda[2]! * a[2]!,
          bound = arithmeticEnvelope(lambda, a),
          allowance = nextUpPositive(2 * bound),
          residual = Math.abs(predicted - native[axis]!);
        check(residual <= allowance, 'TRACE_AFFINE_RECONSTRUCTION');
        return { predicted, actual: native[axis]!, residual, bound: allowance };
      });
    const reconstructed = {
      first: components('first', v.slice(34, 37)),
      second: components('second', v.slice(37, 40)),
    };
    const minkowski = vertices.map((point) =>
      point.minkowski.map((actual, axis) => {
        const predicted = point.first[axis]! - point.second[axis]!,
          bound = nextUpPositive(
            2 * arithmeticEnvelope([1, -1], [point.first[axis]!, point.second[axis]!]),
          );
        check(Math.abs(predicted - actual) <= bound, 'TRACE_MINKOWSKI_RECONSTRUCTION');
        return { actual, predicted, bound };
      }),
    );
    const sum = lambda[0]! + lambda[1]! + lambda[2]!,
      sumBound = arithmeticEnvelope([1, 1, 1], lambda),
      negativeMass = lambda.reduce((a, b) => a + Math.max(0, -b), 0);
    const c = f.cases.find((c) => c.id === operation.case)!,
      readbackModel = traceModelFromCase(c),
      shape = wheelShape(readbackModel, operation.after, raw.pair![0]!);
    const supports = vertices.map((point) => ({
      first: packet(point.first),
      second: packet(point.second),
      cylinder: cylinder(point.first, shape.center, shape.axis, shape.radius, shape.halfWidth),
      mesh: meshEndpoint(readbackModel, operation.after!, raw.pair![1]!, point.second),
    }));
    const final = cylinder(
      v.slice(34, 37) as Vec,
      shape.center,
      shape.axis,
      shape.radius,
      shape.halfWidth,
    );
    return {
      query: decoded.query.index,
      case: raw.case,
      pair: raw.pair,
      raw: decoded,
      lambda: packet(lambda),
      sum,
      sumBound,
      negativeMass,
      reconstructed,
      minkowski,
      supports,
      final,
      observation:
        final.outside && supports.every((s) => !s.cylinder.outside) && Math.abs(sum - 1) <= sumBound
          ? 'AFFINE_RECOVERY_OUTSIDE_WITH_VALID_CHOSEN_CYLINDER_INPUTS'
          : supports.some((s) => s.cylinder.outside)
            ? 'CHOSEN_CYLINDER_INPUT_ALREADY_OUTSIDE'
            : 'DESCRIPTIVE_CHOSEN_INPUTS_ONLY',
      scope: 'NOT_A_UNIQUE_ROOT_CAUSE_NO_PHYSICS_OR_EPA_FIX_ACCEPTANCE',
    };
  });
}
function traceModelFromCase(c: Case): Model {
  // Pure model shape reconstruction only, with actual native compiled dictionary.
  const m = c.archivedFactory.mesh.native,
    model = {
      ngeom: c.native_counts[3],
      nmesh: c.native_counts[0],
      mesh_vert: new Float32Array(m.verticesF32),
      mesh_face: new Int32Array(m.facesI32),
    } as unknown as Model;
  for (const [k, v] of Object.entries(m.integers)) model[k] = new Int32Array(v);
  for (const [k, v] of Object.entries(m.doubles)) model[k] = new Float64Array(v);
  return model;
}
function mockNative(
  c: Case,
  options: {
    mutateTime?: boolean;
    badBaseline?: boolean;
    distanceError?: boolean;
    deleteError?: boolean;
    zero?: boolean;
    nan?: boolean;
    warnings?: boolean;
    contactVectorDeleteError?: boolean;
  } = {},
) {
  let current: Data | undefined,
    positions = 0,
    distances = 0,
    bufferDeletes = 0,
    dataDeletes = 0,
    modelDeletes = 0,
    warningVectorDeletes = 0;
  const h = decodeFrame(c),
    cert = f.certificate.datasets
      .find(
        (d) =>
          d.dataset ===
          (c.id.startsWith('recovered') ? 'recovered_union' : 'original_five_mesh_descriptive'),
      )!
      .frames.find((v) => v.from_us === 4729500)!;
  const expectedModel = () => {
    const a = c.archivedFactory.readback,
      m = c.archivedFactory.mesh.native;
    const model = {
      ...a.counts,
      opt: {
        ...a.settings,
        gravity: new Float64Array(a.settings.gravity),
        wind: new Float64Array(3),
      },
      delete() {
        modelDeletes++;
      },
    } as unknown as Model;
    for (const [k, v] of Object.entries(m.integers)) model[k] = new Int32Array(v);
    for (const [k, v] of Object.entries(m.doubles)) model[k] = new Float64Array(v);
    Object.assign(model, {
      mesh_vert: new Float32Array(m.verticesF32),
      mesh_face: new Int32Array(m.facesI32),
      body_mass: new Float64Array(a.masses),
      body_ipos: new Float64Array(a.ipos),
      body_inertia: new Float64Array(a.inertia),
      body_iquat: new Float64Array(20),
      dof_armature: new Float64Array(a.arms),
      pair_geom1: new Int32Array(a.pairs.first),
      pair_geom2: new Int32Array(a.pairs.second),
      pair_dim: new Int32Array(a.pairs.dims),
      body_parentid: new Int32Array([0, 0, 1, 1, 1]),
    });
    for (const [k, v] of Object.entries({
      pair_friction: a.pairs.friction,
      pair_solref: a.pairs.solref,
      pair_solreffriction: a.pairs.solreffriction,
      pair_solimp: a.pairs.solimp,
    }))
      model[k] = new Float64Array(v);
    for (const [k, n] of Object.entries({
      geom_surfacevel: c.native_counts[3]! * 6,
      geom_gap: c.native_counts[3]!,
      geom_margin: c.native_counts[3]!,
      geom_adhesion: c.native_counts[3]!,
      dof_damping: 9,
      dof_frictionloss: 9,
      body_gravcomp: 5,
      pair_gap: a.counts.npair,
      pair_margin: a.counts.npair,
      pair_adhesion: a.counts.npair,
    }))
      model[k] = new Float64Array(n);
    return model;
  };
  class MockData {
    time = 0;
    qpos = new Float64Array(10);
    qvel = new Float64Array(9);
    ncon = 0;
    nefc = 0;
    efc_type = new Int32Array();
    efc_id = new Int32Array();
    xpos = new Float64Array(15);
    xquat = new Float64Array(20);
    xipos = new Float64Array(15);
    ximat = new Float64Array(45);
    geom_xpos = new Float64Array(c.native_counts[3]! * 3);
    geom_xmat = new Float64Array(c.native_counts[3]! * 9);
    rows: ContactRecord[] = [];
    get contact() {
      const rows = this.rows;
      return {
        size: () => rows.length,
        get: (i: number) => {
          const r = rows[i]!;
          return {
            geom: new Int32Array(r.geom),
            dim: r.dim,
            exclude: r.exclude,
            efc_address: r.address,
            dist: r.distance.values[0]!,
            pos: new Float64Array(r.point.values),
            frame: new Float64Array(r.frame.values),
            delete() {},
          };
        },
        delete() {
          if (options.contactVectorDeleteError) throw new Error('MOCK_CONTACT_VECTOR_DELETE');
        },
      };
    }
    warning = {
      size: () => 7,
      get: () => ({ number: options.warnings ? 1 : 0, lastinfo: 0, delete() {} }),
      delete() {
        warningVectorDeletes++;
        throw new Error('BORROWED_WARNING_DELETE');
      },
    };
    constructor() {
      current = this as unknown as Data;
    }
    delete() {
      dataDeletes++;
      if (options.deleteError) throw new Error('MOCK_DATA_DELETE');
    }
  }
  class MockBuffer {
    view = new Float64Array(6);
    GetView() {
      return this.view;
    }
    delete() {
      bufferDeletes++;
    }
  }
  const M: Native = {
    MjModel: { from_xml_string: expectedModel },
    MjData: MockData,
    DoubleBuffer: MockBuffer,
    mj_version: () => 4000000,
    mj_versionString: () => f.engine.version,
    mj_fwdPosition(_m, d) {
      positions++;
      const data = d as unknown as MockData;
      data.ncon = h.identity.ncon;
      data.nefc = h.identity.nefc;
      data.efc_type = new Int32Array(h.identity.efcType);
      data.efc_id = new Int32Array(h.identity.efcId);
      data.rows = structuredClone(h.identity.contacts);
      data.xpos.set(h.body.xpos.values);
      data.xquat.set(h.body.xquat.values);
      data.geom_xpos.set(legacyFloats(c.archivedFactory.mesh.native.worldPositionsF64));
      data.geom_xmat.set(legacyFloats(c.archivedFactory.mesh.native.worldRotationsF64));
      for (const row of cert.contacts) {
        data.geom_xpos.set(row.world_center, row.wheel * 3);
        const axis = row.world_unit_axis;
        data.geom_xmat.set([1, 0, axis[0]!, 0, 1, axis[1]!, 0, 0, axis[2]!], row.wheel * 9);
      }
      if (options.badBaseline) data.rows[0]!.point = packet([99, 0, 0]);
      if (options.mutateTime) d.time += 1;
    },
    mj_geomDistance(_m, _d, first, _second, distmax, out) {
      check(distmax === 0, 'MOCK_DISTMAX');
      distances++;
      if (options.distanceError) throw new Error('MOCK_PRIMARY_ERROR');
      const row = cert.contacts.find((v) => v.wheel === first)!;
      out.GetView().set([...row.wheel_side_witness, ...row.terrain_side_witness]);
      if (options.nan) out.GetView()[0] = NaN;
      return options.zero ? 0 : -1e-7;
    },
  };
  return {
    M,
    get current() {
      return current!;
    },
    counts: () => ({
      positions,
      distances,
      bufferDeletes,
      dataDeletes,
      modelDeletes,
      warningVectorDeletes,
    }),
  };
}
function memorySink() {
  const events: unknown[] = [];
  let used = 0;
  return {
    events,
    write(record: unknown) {
      const raw = stringifySigned(record);
      used += Buffer.byteLength(raw);
      check(used < f.receipt.maxBytes, 'MOCK_EXTERNAL_CAP');
      events.push(structuredClone(record));
    },
    reserve() {
      check(used + f.receipt.footerReserve * 2 <= f.receipt.maxBytes, 'MOCK_PRECALL_CAP');
    },
  };
}

it('binds complete original XML, source/fixtures and both exact saved phase frames without Git or old runtime execution', () => {
  const p = f.immutableInputs;
  for (const pin of [p.recovered_source_spec, p.five_mesh_fixture, p.union_fixture]) {
    const raw = readFileSync(join(repo, pin.path));
    expect(raw.length).toBe(pin.bytes);
    expect(sha(raw)).toBe(pin.sha256);
  }
  for (const c of f.cases) {
    expect(sha(xml(c))).toBe(c.xml_sha256);
    const d = decodeFrame(c);
    expect(d.identity.contacts).toHaveLength(c.frame_bytes === 3104 ? 6 : 10);
    expect(d.pre.values[0]).not.toBe(c.raw_from_us / 1e6);
    expect(c.archived_target_contact_ordinals.map((i) => d.identity.contacts[i]!.geom)).toEqual(
      c.native_pairs_in_exact_input_order,
    );
  }
});
it('retains actual F64 sign-zero and rejects truncation, phase mutation and wrong frame identity', () => {
  const p = packet([0, -0, 1]);
  expect(Object.is(decodePacket(p.f64le)[1], -0)).toBe(true);
  expect(p.f64le).not.toBe(packet([0, 0, 1]).f64le);
  const c = f.cases[0]!;
  const mutated = Buffer.from(c.frameHex, 'hex');
  mutated[1984] ^= 1;
  expect(() => decodeFrame(c, mutated)).toThrow('EXACT_FRAME_PIN');
  expect(() => decodeFrame({ ...c, frame_sha256: sha(mutated) }, mutated)).toThrow(
    'ARCHIVED_STEP1_PHASE_HASH',
  );
  expect(() => decodeFrame(c, mutated.subarray(0, -1))).toThrow('EXACT_FRAME_PIN');
});
it('rederives signed midpoint, actual compiled wheel axes and finite-cylinder certificate including descriptive five-mesh control', () => {
  for (const dataset of f.certificate.datasets)
    for (const frame of dataset.frames)
      for (const row of frame.contacts) {
        const axis = rotate(
            row.body_quaternion as Quat,
            rotate(row.geom_local_quaternion as Quat, [0, 0, 1]),
          ),
          center = add(
            row.body_position as Vec,
            rotate(row.body_quaternion as Quat, row.geom_local_position as Vec),
          );
        axis.forEach((v, i) => expect(Math.abs(v - row.world_unit_axis[i]!)).toBeLessThan(1e-14));
        center.forEach((v, i) => expect(Math.abs(v - row.world_center[i]!)).toBeLessThan(1e-14));
        const wheel = add(
            row.midpoint as Vec,
            mul(row.raw_normal_outward as Vec, row.raw_signed_distance_m / 2),
          ),
          terrain = sub(
            row.midpoint as Vec,
            mul(row.raw_normal_outward as Vec, row.raw_signed_distance_m / 2),
          );
        wheel.forEach((v, i) => expect(Object.is(v, row.wheel_side_witness[i]!)).toBe(true));
        terrain.forEach((v, i) => expect(Object.is(v, row.terrain_side_witness[i]!)).toBe(true));
        const result = cylinder(wheel, center, axis, row.radius_m, row.half_width_m);
        expect(Math.abs(result.axial - row.wheel_witness_axial_m)).toBeLessThan(1e-13);
        expect(Math.abs(result.radial - row.wheel_witness_radial_m)).toBeLessThan(1e-13);
        expect(
          Math.abs(
            result.negativeAffineMassLowerBound - row.necessary_negative_affine_mass_lower_bound,
          ),
        ).toBeLessThan(1e-11);
      }
  const union = f.certificate.datasets[0]!.frames.find((v) => v.from_us === 4729500)!;
  expect(union.contacts.every((v) => v.wheel_witness_axial_m > v.half_width_m + 0.001)).toBe(true);
  expect(
    f.certificate.datasets[1]!.frames[0]!.contacts.every(
      (v) => Math.abs(v.wheel_witness_axial_m) < v.half_width_m,
    ),
  ).toBe(true);
});
it('keeps analytic infinite-plane support separate from finite descent membership and later atlas ambiguity', () => {
  const dataset = f.certificate.datasets[0]!;
  for (const frame of dataset.frames)
    for (const row of frame.contacts) {
      const control = row.exact_infinite_plane_cylinder_control;
      const support = infinitePlaneSupport(
        row.world_center as Vec,
        row.world_unit_axis as Vec,
        row.radius_m,
        row.half_width_m,
        control.normal as Vec,
        control.plane_offset_m,
      );
      expect(Math.abs(support.gap - control.signed_plane_gap_m)).toBeLessThan(2e-13);
      expect(Math.abs(support.minimum - control.minimum_support_m)).toBeLessThan(2e-13);
      dataset.compiled_descent_triangles.forEach((t, i) => {
        const m = membership(
          row.terrain_side_witness as Vec,
          t.vertices,
          t.normal as Vec,
          t.offset,
        );
        expect(
          Math.abs(m.signedPlane - row.terrain_point_actual_triangle_membership[i]!.signed_plane_m),
        ).toBeLessThan(1e-13);
      });
    }
  const first = dataset.frames.find((v) => v.from_us === 4729500)!.contacts[0]!;
  expect(
    first.exact_infinite_plane_cylinder_control.finite_descent_membership.every(
      (v) => !v.strict_interior,
    ),
  ).toBe(true);
  const later = dataset.frames.find((v) => v.from_us === 4732500)!;
  expect(
    later.contacts.some(
      (v) => 'conservative_band_descent_flat_alias' in v && v.conservative_band_descent_flat_alias,
    ),
  ).toBe(true);
  expect(f.cases.every((c) => c.raw_from_us !== 4732500)).toBe(true);
});
it('runs exactly two sequential mocked original models, four positions/four same-order primary buffers with complete release', () => {
  const l = ledger(),
    sink = memorySink();
  for (const c of f.cases) {
    const mock = mockNative(c);
    runCase(mock.M, c, l, sink);
    expect(mock.counts()).toEqual({
      positions: 2,
      distances: 2,
      bufferDeletes: 2,
      dataDeletes: 1,
      modelDeletes: 1,
      warningVectorDeletes: 0,
    });
  }
  expect(l.position).toEqual({ attempted: 4, returned: 4 });
  expect(l.distance).toEqual({ attempted: 4, returned: 4 });
  expect(l.step1 + l.step2 + l.forward).toBe(0);
  for (const kind of [
    'model',
    'data',
    'buffer',
    'contactVector',
    'contactCopy',
    'warningCopy',
  ] as Kind[])
    expect(l.handles[kind].deleted).toBe(l.handles[kind].returned);
  const queries = sink.events.filter(
    (v): v is { kind: string; pair: number[] } =>
      !!v && typeof v === 'object' && 'kind' in v && v.kind === 'distance',
  );
  expect(queries.map((v) => v.pair)).toEqual([
    [5, 1],
    [6, 1],
    [7, 3],
    [8, 3],
  ]);
});
it('stops without direct queries or second model after first positional baseline mismatch, preserving all geometry', () => {
  const c = f.cases[0]!,
    mock = mockNative(c, { badBaseline: true }),
    l = ledger(),
    sink = memorySink();
  expect(() => runCase(mock.M, c, l, sink)).toThrow('INCONCLUSIVE_ARCHIVED_GEOMETRY_MISMATCH');
  expect(mock.counts().positions).toBe(1);
  expect(mock.counts().distances).toBe(0);
  expect(sink.events.some((v) => same((v as { kind?: string }).kind, 'baseline-comparison'))).toBe(
    true,
  );
  expect(l.handles.data.deleted).toBe(1);
});
it('fails closed on state mutation, keeps attempted/returned distinction and releases direct buffer on an actual throw', () => {
  const c = f.cases[0]!;
  const mutated = mockNative(c, { mutateTime: true }),
    l = ledger(),
    sink = memorySink();
  expect(() => runCase(mutated.M, c, l, sink)).toThrow('POST_API_STATE_EXACT');
  expect(l.position).toEqual({ attempted: 1, returned: 1 });
  expect(l.distance.attempted).toBe(0);
  const mock = mockNative(c, { distanceError: true, deleteError: true }),
    bad = ledger(),
    raw = memorySink();
  expect(() => runCase(mock.M, c, bad, raw)).toThrow('MOCK_PRIMARY_ERROR');
  expect(bad.distance).toEqual({ attempted: 1, returned: 0 });
  expect(bad.handles.buffer.deleted).toBe(1);
  expect(bad.handles.model.deleted).toBe(1);
  expect(bad.cleanupErrors).toContain('data: Error: MOCK_DATA_DELETE');
  const finish = raw.events.at(-1) as { firstError: string };
  expect(finish.firstError).toContain('MOCK_PRIMARY_ERROR');
});
it('archives nonfinite actual primary output before rejection and never certifies touching/cutoff zero', () => {
  const c = f.cases[0]!,
    mock = mockNative(c, { nan: true }),
    l = ledger(),
    sink = memorySink();
  expect(() => runCase(mock.M, c, l, sink)).toThrow('NONFINITE_FROMTO');
  const item = sink.events.find((v) => (v as { kind: string }).kind === 'distance') as {
    fromto: Packet;
  };
  expect(Number.isNaN(decodePacket(item.fromto.f64le)[0])).toBe(true);
  expect(l.distance.attempted).toBe(1);
  const zero = mockNative(c, { zero: true }),
    result = runCase(zero.M, c, ledger(), memorySink());
  expect(
    result.conclusions.every(
      (v) => (v as { endpointsCertified: boolean }).endpointsCertified === false,
    ),
  ).toBe(true);
});
it('preflights resource and durable raw capacity before a public call, retaining first error through footer/cleanup errors', () => {
  const c = f.cases[0]!,
    mock = mockNative(c),
    l = ledger();
  l.position.attempted = 4;
  expect(() => runCase(mock.M, c, l, memorySink())).toThrow('API_CAP_position');
  expect(mock.counts().positions).toBe(0);
  const capped = mockNative(c),
    cap = ledger();
  expect(() =>
    runCase(capped.M, c, cap, {
      reserve() {
        throw new Error('PRECALL_CAP');
      },
      write() {},
    }),
  ).toThrow('PRECALL_CAP');
  expect(cap.handles.model.attempted).toBe(0);
  const failed = mockNative(c, { distanceError: true }),
    errors = ledger(),
    raw = memorySink();
  expect(() =>
    runCase(failed.M, c, errors, {
      reserve: () => raw.reserve(),
      write(record, footer) {
        if (footer) throw new Error('FOOTER_IO');
        raw.write(record);
      },
    }),
  ).toThrow('MOCK_PRIMARY_ERROR');
  expect(errors.cleanupErrors.some((v) => v.includes('FOOTER_IO'))).toBe(true);
});
it('rejects old/ambiguous opt-ins and requires the exact new token before import; source contains no native dynamics API', () => {
  expect(() => deniedEnvironment({})).toThrow('EXACT_DISTINCT_NATIVE_OPT_IN');
  expect(() => deniedEnvironment({ ASA_STATIC_WITNESS_NATIVE: 'yes' })).toThrow(
    'EXACT_DISTINCT_NATIVE_OPT_IN',
  );
  for (const key of [...f.receipt.legacyNativeEnvironmentDenied, 'ASA_UNREGISTERED_ACQUIRE'])
    expect(() => deniedEnvironment({ ASA_STATIC_WITNESS_NATIVE: token, [key]: '1' })).toThrow();
  expect(() => deniedEnvironment({ ASA_STATIC_WITNESS_NATIVE: token })).not.toThrow();
  const text = readFileSync(sourcePath, 'utf8');
  expect(text).not.toMatch(/\bM\.mj_(?:step1|step2|forward)\s*\(/);
  expect(text).not.toMatch(/import\s*\([^)]*(?:old|composed-terrain-seams\.spec)/);
});
it.runIf(process.env.ASA_STATIC_VERIFY_INPUTS === 'verify')(
  'verifies complete immutable prior inputs and AOT bytes without importing engine or archived executable code',
  () => {
    readInputs(process.env);
  },
);
it.runIf(nativeEnabled)(
  'acquires only the selected isolated EPA trace mode with exact old public parity and zero dynamics',
  async () => {
    await nativeRun(process.env);
  },
  120000,
);

it('replays every actual recorded geometry/query and rejects forged labels, row order, state bits, endpoints and operation counters', () => {
  const sink = memorySink(),
    l = ledger();
  for (const c of f.cases) runCase(mockNative(c).M, c, l, sink);
  expect(replay(sink.events)).toHaveLength(2);
  const mutation = (edit: (v: ReplayRecord[]) => void, message: string) => {
    const records = structuredClone(sink.events) as ReplayRecord[];
    edit(records);
    expect(() => replay(records)).toThrow(message);
  };
  mutation((v) => {
    v.find((v) => v.kind === 'direct-classification')!.conclusion = { verdict: 'FAKE_PASS' };
  }, 'REPLAY_FORGED_CLASSIFICATION');
  mutation((v) => {
    const x = v.find((v) => v.kind === 'position')!.after!;
    x.geometry.efcId[0] = 99;
  }, 'REPLAY_ARCHIVED_GEOMETRY');
  mutation((v) => {
    const x = v.find((v) => v.kind === 'distance')!.after!;
    x.state = packet([x.state.values[0]!, ...Array<number>(19).fill(0)]);
  }, 'REPLAY_STATE');
  mutation((v) => {
    const x = v.find((v) => v.kind === 'distance')!;
    x.fromto = packet([0, 0, 0, 0, 0, 0]);
  }, 'REPLAY_FORGED_CLASSIFICATION');
  mutation((v) => {
    v.find((v) => v.kind === 'distance')!.counters!.distance.returned = 0;
  }, 'REPLAY_ACTUAL_CALL_COUNTERS');
});
it.runIf(process.env.ASA_STATIC_REPLAY_RECEIPT !== undefined)(
  'purely replays complete new receipt from disk without native and rejects content tampering',
  () => {
    const path = required(process.env, 'ASA_STATIC_REPLAY_RECEIPT'),
      digest = required(process.env, 'ASA_STATIC_REPLAY_SHA256'),
      raw = readFileSync(path);
    check(raw.length <= f.receipt.maxBytes && sha(raw) === digest, 'REPLAY_RECEIPT_PIN');
    replay(
      raw
        .toString()
        .trim()
        .split('\n')
        .map((v) => parseSigned(v)),
      true,
    );
  },
);

it('keeps warning vector borrowed, releases copied entries and contact vector after failures without erasing ownership errors', () => {
  const l = ledger();
  let borrowedDeletes = 0,
    copies = 0;
  const warning = {
    size: () => 7,
    get: () => ({
      number: 0,
      lastinfo: 0,
      delete() {
        copies++;
        if (copies === 1) throw new Error('WARNING_COPY_RELEASE');
      },
    }),
    delete() {
      borrowedDeletes++;
    },
  };
  expect(warn({ warning } as unknown as Data, l)).toHaveLength(7);
  expect(copies).toBe(7);
  expect(borrowedDeletes).toBe(0);
  expect(l.handles.warningCopy.deleted).toBe(6);
  expect(l.cleanupErrors[0]).toContain('WARNING_COPY_RELEASE');
  expect(() =>
    warn({ warning: { ...warning, size: () => 8 } } as unknown as Data, ledger()),
  ).toThrow('WARNING_WIDTH_7');
  const mock = mockNative(f.cases[0]!, { warnings: true }),
    startup = ledger();
  expect(() => runCase(mock.M, f.cases[0]!, startup, memorySink())).toThrow(
    'FACTORY_NATIVE_WARNING',
  );
  expect(startup.position.attempted).toBe(0);
  expect(startup.handles.data.deleted).toBe(1);
  let deleted = 0;
  const v = {
    size: () => 1,
    get: () => {
      throw new Error('CONTACT_COPY_GET');
    },
    delete() {
      deleted++;
    },
  };
  const bad = ledger();
  expect(() =>
    capture({ ncon: 1, nefc: 0, contact: v } as unknown as Data, f.cases[0]!, bad),
  ).toThrow('CONTACT_COPY_GET');
  expect(deleted).toBe(1);
  expect(bad.handles.contactVector.deleted).toBe(1);
});
it('rederives compiled descent triangles from local F32 vertices and exact archived native geom transform; affine bound is necessary only', () => {
  const c = f.cases[0]!,
    native = c.archivedFactory.mesh.native,
    mesh = native.integers.geom_dataid[1]!,
    start = native.integers.mesh_vertadr[mesh]!,
    pos = legacyFloats(native.worldPositionsF64).slice(3, 6) as Vec,
    m = legacyFloats(native.worldRotationsF64).slice(9, 18);
  for (const triangle of f.certificate.datasets[0]!.compiled_descent_triangles) {
    native.facesI32
      .slice(
        (native.integers.mesh_faceadr[mesh]! + triangle.native_triangle) * 3,
        (native.integers.mesh_faceadr[mesh]! + triangle.native_triangle + 1) * 3,
      )
      .forEach((id, i) => {
        const local = native.verticesF32.slice((start + id) * 3, (start + id + 1) * 3),
          world = add(
            pos,
            [0, 1, 2].map(
              (row) =>
                m[row * 3]! * local[0]! + m[row * 3 + 1]! * local[1]! + m[row * 3 + 2]! * local[2]!,
            ) as Vec,
          );
        world.forEach((v, k) =>
          expect(Math.abs(v - triangle.vertices[i]![k]!)).toBeLessThan(1e-14),
        );
      });
  }
  const h = 0.01,
    points: [Vec, Vec] = [
      [0, h, 0],
      [0, -h, 0],
    ],
    weights = [1.5, -0.5],
    point = add(mul(points[0], weights[0]!), mul(points[1], weights[1]!)),
    domain = cylinder(point, [0, 0, 0], [0, 1, 0], 0.03, h);
  expect(domain.axial).toBe(0.02);
  expect(domain.negativeAffineMassLowerBound).toBe(0.5);
  expect(weights.reduce((s, w) => s + Math.max(0, -w), 0)).toBe(
    domain.negativeAffineMassLowerBound,
  );
});

it('bounds the full largest original contact census operation below the reserved per-call raw budget', () => {
  const c = f.cases[1]!,
    mock = mockNative(c),
    sink = memorySink(),
    l = ledger();
  runCase(mock.M, c, l, sink);
  const event = structuredClone(
    sink.events.find((v) => (v as { kind: string }).kind === 'distance'),
  ) as ReplayRecord;
  const maximum = c.archivedFactory.readback.max;
  for (const frame of [event.before!, event.after!]) {
    frame.geometry.contacts = Array.from({ length: maximum }, (_, i) => ({
      ...structuredClone(frame.geometry.contacts[0]!),
      index: i,
      address: i * 3,
    }));
    frame.geometry.ncon = maximum;
    frame.geometry.nefc = maximum * 3;
    frame.geometry.efcType = Array<number>(maximum * 3).fill(7);
    frame.geometry.efcId = Array.from({ length: maximum * 3 }, (_, i) => Math.floor(i / 3));
    for (const ct of frame.geometry.contacts) {
      ct.point = packet(Array<number>(3).fill(Number.MAX_VALUE));
      ct.frame = packet(Array<number>(9).fill(-Number.MAX_VALUE));
      ct.distance = packet([-Number.MAX_VALUE]);
    }
    for (const [k, v] of Object.entries(frame.geometry.transforms))
      frame.geometry.transforms[k] = packet(Array<number>(v.values.length).fill(-Number.MAX_VALUE));
    frame.state = packet(Array<number>(20).fill(Number.MAX_VALUE));
  }
  expect(Buffer.byteLength(stringifySigned(event))).toBeLessThan(f.receipt.footerReserve);
});

it('durably round-trips both complete mock cases through the actual Journal and replay, preserving the real archived minus-zero and rejecting bit/label tampering', () => {
  const root = mkdtempSync(join(tmpdir(), 'asa-static-witness-codec-')),
    path = join(root, 'mock-static-witness.jsonl');
  let journal: Journal | undefined;
  try {
    check(inside(realpathSync(tmpdir()), realpathSync(root)), 'OWNED_CODEC_TEMP');
    const archived = decodeFrame(f.cases[1]!).identity.contacts[0]!.frame;
    expect(Object.is(archived.values[7], -0)).toBe(true);
    const l = ledger();
    l.handles.module.attempted = 1;
    l.handles.module.returned = 1; // mock-only module ledger, no engine import
    journal = new Journal(path);
    journal.write({
      kind: 'header',
      source: { bytes: readFileSync(sourcePath).length, sha256: sha(readFileSync(sourcePath)) },
      fixture: { bytes: readFileSync(fixturePath).length, sha256: sha(readFileSync(fixturePath)) },
    });
    for (const c of f.cases) runCase(mockNative(c).M, c, l, journal);
    journal.write(
      {
        kind: 'finish',
        runtime: 'COMPLETE',
        diagnostic: 'COMPLETE',
        acquisition: 'CONSUMED',
        firstError: null,
        ledger: l,
      },
      true,
    );
    journal.close();
    const text = readFileSync(path, 'utf8'),
      records = text
        .trim()
        .split('\n')
        .map((line) => parseSigned(line)) as ReplayRecord[];
    expect(text).toContain('float64:-0');
    expect(replay(records, true)).toHaveLength(2);
    const op = records.find((v) => v.kind === 'position' && v.case === f.cases[1]!.id)!;
    expect(Object.is(op.after!.geometry.contacts[0]!.frame.values[7], -0)).toBe(true);
    expect(op.after!.geometry.contacts[0]!.frame.f64le).toBe(archived.f64le);
    const mutated = parseSigned(stringifySigned(records)) as ReplayRecord[];
    mutated.find((v) => v.kind === 'distance')!.after!.state.values[0] = 0;
    expect(() => replay(mutated, true)).toThrow('PACKET_STATE');
    const badZero = parseSigned(stringifySigned(records)) as ReplayRecord[];
    badZero.find(
      (v) => v.kind === 'position' && v.case === f.cases[1]!.id,
    )!.after!.geometry.contacts[0]!.frame.values[7] = 0;
    expect(() => replay(badZero, true)).toThrow('REPLAY_ARCHIVED_GEOMETRY');
    for (const label of ['float64:+0', 'float64:-00', 'float64:NaN']) {
      expect(() => parseSigned(JSON.stringify({ value: label }))).toThrow('SIGNED_ZERO_LABEL');
      expect(() => stringifySigned({ value: label })).toThrow('SIGNED_ZERO_LABEL');
    }
    expect(Object.is(parseSigned(stringifySigned({ value: -0 })).value, -0)).toBe(true);
  } finally {
    journal?.close();
    check(
      inside(realpathSync(tmpdir()), realpathSync(root)) &&
        path === join(root, 'mock-static-witness.jsonl'),
      'OWNED_CODEC_TEMP_CLEANUP',
    );
    if (journal) unlinkSync(path);
    rmdirSync(root);
  }
});
it('blocks position and distance dispatch on a contact-vector cleanup failure in pre-API sampling, retaining the sample and first error', () => {
  const mock = mockNative(f.cases[0]!, { contactVectorDeleteError: true }),
    l = ledger(),
    sink = memorySink();
  expect(() => runCase(mock.M, f.cases[0]!, l, sink)).toThrow(
    'PRE_API_OWNERSHIP_CLEANUP: contactVector: Error: MOCK_CONTACT_VECTOR_DELETE',
  );
  expect(l.position).toEqual({ attempted: 0, returned: 0 });
  expect(l.distance).toEqual({ attempted: 0, returned: 0 });
  expect(mock.counts().positions).toBe(0);
  expect(mock.counts().distances).toBe(0);
  expect(l.handles.contactVector).toEqual({
    attempted: 1,
    returned: 1,
    deleteAttempted: 1,
    deleted: 0,
  });
  expect(l.handles.data.deleted).toBe(1);
  expect(l.handles.model.deleted).toBe(1);
  const raw = sink.events.find((v) => (v as { kind: string }).kind === 'pre-api-error') as {
    before: Snapshot;
    firstError: string;
    ledger: Ledger;
  };
  expect(raw.before.state.f64le).toBe(decodeFrame(f.cases[0]!).pre.f64le);
  expect(raw.firstError).toContain('MOCK_CONTACT_VECTOR_DELETE');
  expect(raw.ledger.position.attempted).toBe(0);
  const finish = sink.events.at(-1) as { firstError: string; ledger: Ledger };
  expect(finish.firstError).toBe(raw.firstError);
  expect(finish.ledger.cleanupErrors).toContain('contactVector: Error: MOCK_CONTACT_VECTOR_DELETE');
});

// Pure source-only trace tests. Mocks are transport/parity inputs, never physical evidence.
function syntheticTraceLine(index: number) {
  const q = t.queries[index]!,
    ints = Array<number>(32).fill(0),
    v = Array<number>(75).fill(0);
  ints[0] = q.index;
  ints[1] = q.pair[0]!;
  ints[2] = q.pair[1]!;
  ints[3] = 5;
  ints[4] = 7;
  ints[5] = 100;
  ints[6] = 1;
  ints[9] = 3;
  ints[10] = 4;
  ints[11] = 0;
  ints[12] = 1;
  ints[13] = 0 + (1 << 10) + (2 << 20);
  ints[14] = -1;
  ints[15] = 5;
  ints[16] = 6;
  ints[17] = 6;
  ints[18] = 0;
  ints[19] = 1;
  ints[20] = 2;
  ints[27] = 3;
  ints[28] = 3;
  ints[29] = index < 2 ? 12 : 8;
  ints[30] = index < 2 ? 1 : 0;
  ints[31] = 1;
  v[0] = 1;
  const fromto = decodePacket(q.fromto.f64le),
    distance = decodePacket(q.distance.f64le)[0]!;
  v[6] = distance * distance;
  for (const at of [7, 16, 25]) {
    v.splice(
      at,
      9,
      ...fromto.slice(0, 3).map((x, i) => x - fromto[i + 3]!),
      ...fromto.slice(0, 3),
      ...fromto.slice(3),
    );
  }
  v.splice(34, 6, ...fromto);
  v[40] = distance;
  v.splice(41, 15, ...decodePacket(q.objectF64le[0]!));
  v[56] = 0;
  v.splice(57, 15, ...decodePacket(q.objectF64le[1]!));
  v[72] = 0;
  v[73] = 1e-8;
  v[74] = 0;
  return t.frame.prefix + ' ints=' + ints.join(',') + ' f64le=' + packet(v).f64le;
}
function traceTestOperations() {
  const sink = memorySink(),
    l = ledger();
  for (const c of f.cases) runCase(mockNative(c).M, c, l, sink);
  return sink.events.filter((v) =>
    ['position', 'distance'].includes((v as ReplayRecord).kind),
  ) as ReplayRecord[];
}
it('isolates the selected trace opt-in and denies consumed/ambiguous actual native entry before files, import or initialization', async () => {
  expect(() => traceAdmission({ ASA_CCD_TRACE_NATIVE: traceToken })).not.toThrow();
  for (const env of [
    {},
    { ASA_STATIC_WITNESS_NATIVE: token },
    { ASA_CCD_TRACE_NATIVE: 'yes' },
    { ASA_CCD_TRACE_NATIVE: traceToken, ASA_STATIC_WITNESS_NATIVE: token },
    { ASA_CCD_TRACE_NATIVE: traceToken, ASA_TT_UNION_RECOVERY_NATIVE: 'old' },
  ]) {
    expect(() => traceAdmission(env)).toThrow();
    await expect(nativeRun(env)).rejects.toThrow();
  }
});
it('parses only the four exact framed trace identities with75 actual binary64 words and rejects malformed/context/output bits', () => {
  for (let i = 0; i < 4; i++) {
    const line = syntheticTraceLine(i),
      decoded = decodeTrace(line, i);
    expect(decoded.words.values).toHaveLength(75);
    expect(decoded.ints[0]).toBe(i + 1);
    expect(() => decodeTrace(line, (i + 1) % 4)).toThrow('TRACE_QUERY_IDENTITY');
    expect(() => decodeTrace(line + '00', i)).toThrow('TRACE_75_F64');
  }
  const line = syntheticTraceLine(0);
  expect(() => decodeTrace(line.replace('ints=1,', 'ints=01,'), 0)).toThrow(
    'TRACE_INTEGER_ENCODING',
  );
  expect(() => decodeTrace(line.replace('ASA_PRIMARY', 'OTHER'), 0)).toThrow('TRACE_FRAMING');
  const raw = decodeTrace(line, 0).words;
  raw.values[41] = 0;
  expect(() => decodeTrace(line.replace(raw.f64le, packet(raw.values).f64le), 0)).toThrow(
    'TRACE_EXACT_CONTEXT_BITS',
  );
});
it('does not interpret any trace until exact all8 public operations match; preserves signed-zero/counter/output mismatches', () => {
  const ops = traceTestOperations(),
    parity = new PublicParity(ops);
  expect(() => interpretTraces([], parity)).toThrow('NO_TRACE_INTERPRETATION_BEFORE_PUBLIC_PARITY');
  for (const op of ops.slice(0, 7)) parity.observe(op);
  expect(() => parity.complete()).toThrow('PUBLIC_BOTH_CASES_COMPLETE');
  parity.observe(ops[7]!);
  parity.complete();
  expect(parity.admitted()).toHaveLength(8);
  expect(() => parity.observe(ops[0]!)).toThrow('PARITY_NO_EXTRA_API');
  for (const edit of [
    (v: ReplayRecord) => {
      v.after!.state = packet([0, ...v.after!.state.values.slice(1)]);
    },
    (v: ReplayRecord) => {
      v.counters!.position.returned = 0;
    },
    (v: ReplayRecord) => {
      v.after!.geometry.transforms.geom_xmat!.values[0] = -0;
    },
  ]) {
    const mutated = structuredClone(ops[0]!);
    edit(mutated);
    expect(() => new PublicParity(ops).observe(mutated)).toThrow(
      'PUBLIC_F64_GEOMETRY_STATE_FROMTO_DIST_COUNTER_PARITY',
    );
  }
});
it('keeps printErr callback nonthrowing but rejects missing/extra/unrelated/overflow records after actual return, with raw retained', () => {
  const sink = memorySink(),
    stream = new TraceCollector(sink);
  stream.endStartup();
  stream.begin('position', f.cases[0]!);
  expect(() => stream.accept([syntheticTraceLine(0)])).not.toThrow();
  expect(() => stream.end({ kind: 'position', case: f.cases[0]!.id, pair: undefined })).toThrow(
    'TRACE_EXACT_CONTEXT_RECORD_COUNT',
  );
  expect(sink.events.some((v) => (v as { kind: string }).kind === 'trace-stderr-raw')).toBe(true);
  const missing = new TraceCollector(memorySink());
  missing.endStartup();
  missing.begin('distance', f.cases[0]!, [5, 1]);
  expect(() => missing.end({ kind: 'distance', case: f.cases[0]!.id, pair: [5, 1] })).toThrow(
    'TRACE_EXACT_CONTEXT_RECORD_COUNT',
  );
  const overflow = new TraceCollector(memorySink());
  expect(() => overflow.accept(['x'.repeat(t.caps.max_stderr_bytes + 1)])).not.toThrow();
  expect(() => overflow.endStartup()).toThrow('UNEXPECTED_STARTUP_STDERR');
  expect(overflow.snapshot().errors[0]).toContain('TRACE_STDERR_OVERFLOW');
});
it('rounds a prospective5-operation affine envelope upward without coefficient sign assumptions', () => {
  expect(arithmeticEnvelope([1, -1, 1], [1e8, 1e8, 1])).toBeGreaterThan(0);
  expect(arithmeticEnvelope([0, 0, 0], [0, 0, 0])).toBeGreaterThan(0);
  expect(nextUpPositive(1)).toBe(1 + Number.EPSILON);
  expect(nextUpPositive(0)).toBe(Number.MIN_VALUE);
  expect(() => nextUpPositive(Infinity)).toThrow('FINITE_ARITHMETIC_ENVELOPE');
});
it.runIf(process.env.ASA_CCD_TRACE_VERIFY_INPUTS === 'verify')(
  'dry-applies exact trace patch and proves original numerical source inverse, full baseline replay and original72-member archive, without any build/native',
  () => {
    const proof = historicalTraceInputs(process.env);
    expect(proof.baseline).toHaveLength(27);
    expect(proof.proof.patch.patched).toBe(t.patch.patchedSha256);
    const ops = proof.baseline.filter((v) => v.kind === 'position' || v.kind === 'distance');
    const parity = new PublicParity(ops);
    for (const op of ops) parity.observe(op);
    parity.complete();
    for (let i = 0; i < 4; i++)
      expect(decodeTrace(syntheticTraceLine(i), i).query.index).toBe(i + 1);
  },
);

it('requires unchanged actual compiler/link flags and verified private input layout, rather than a provenance label alone', () => {
  const root = resolve(tmpdir(), 'asa-trace-recipe-pure'),
    norm = (s: string) => s.replace(/\\/g, '/'),
    oldRoot = norm(t.build.inheritedLink.cwd).replace(/\/scratch$/, ''),
    argv = t.build.command.command.split(/\s+/).slice(1),
    input = argv.indexOf('-c') + 1,
    output = argv.indexOf('-o') + 1;
  argv[input] = join(root, 'source/engine_collision_gjk.c');
  argv[output] = join(root, 'object/engine_collision_gjk.c.o');
  const paths = {
      archive: 'input/lib/libmujoco.a',
      object: 'object/engine_collision_gjk.c.o',
      glue: 'artifact/mujoco.js',
      wasm: 'artifact/mujoco.wasm',
      declarations: 'artifact/mujoco.d.ts',
      patchedSource: 'source/engine_collision_gjk.c',
    },
    files = Object.fromEntries(
      Object.entries(paths).map(([k, file]) => [k, { file, bytes: 1, sha256: '0'.repeat(64) }]),
    ) as TraceBuild['files'];
  const reused = t.build.inheritedInputs
    .filter(
      (v) => !v.path.endsWith('/libmujoco.a') && !v.path.endsWith('/engine_collision_gjk.c.o'),
    )
    .map((pin) => {
      const suffix = pin.path.split('/build/')[1]!,
        old = t.build.inheritedLink.argv.find((v) => norm(v).endsWith('/' + suffix))!;
      return { inheritedPath: pin.path, file: norm(old).slice(oldRoot.length + 1) };
    });
  const link = t.build.inheritedLink.argv.map((v) => norm(v).split(oldRoot).join(norm(root))),
    compile = [...link.slice(0, 5), ...argv];
  compile[4] = norm(t.build.inheritedLink.argv[4]!).replace(/em\+\+\.py$/, 'emcc.py');
  const b = {
    files,
    reused,
    actualCompile: {
      executable: t.build.inheritedLink.executable,
      argv: compile,
      cwd: join(root, 'scratch'),
    },
    actualLink: {
      executable: t.build.inheritedLink.executable,
      argv: link,
      cwd: join(root, 'scratch'),
    },
  } as TraceBuild;
  expect(() => commandRecipe(b, root)).not.toThrow();
  const bad = structuredClone(b);
  bad.actualCompile.argv.push('-ffast-math');
  expect(() => commandRecipe(bad, root)).toThrow('UNCHANGED_ALL_COMPILE_FLAGS_AND_HEADERS');
  const other = structuredClone(b);
  other.reused[0]!.file = 'unverified.o';
  expect(() => commandRecipe(other, root)).toThrow('REUSED_BYTES_ARE_ACTUAL_LINK_INPUT');
  const flags = structuredClone(b);
  flags.actualLink.argv.push('-sDYNAMIC_EXECUTION=1');
  expect(() => commandRecipe(flags, root)).toThrow('UNCHANGED_LINK_FLAGS_ONLY_PRIVATE_RELOCATION');
});

it('reconstructs synthetic chosen coefficients without assuming signs and rejects a forged affine calculation after full public parity', () => {
  const ops = traceTestOperations();
  let q = 0;
  for (const op of ops)
    if (op.kind === 'distance') {
      op.result = t.queries[q]!.distance;
      op.fromto = t.queries[q]!.fromto;
      q++;
    }
  const parity = new PublicParity(ops);
  for (const op of ops) parity.observe(op);
  parity.complete();
  const stream: TraceContext[] = t.queries.map((query, i) => ({
    kind: 'distance',
    case: query.case,
    pair: query.pair,
    lines: [syntheticTraceLine(i)],
    bytes: Buffer.byteLength(syntheticTraceLine(i)) + 1,
  }));
  const evidence = interpretTraces(stream, parity);
  expect(evidence).toHaveLength(4);
  expect(evidence.every((v) => v.lambda.values[0] === 1 && v.negativeMass === 0)).toBe(true);
  // A separate purely synthetic affine construction supplies valid finite-cap inputs
  // with a negative weight. It demonstrates the prospective oracle, not actual EPA data.
  const d = decodeTrace(stream[0]!.lines[0]!, 0),
    v = d.words.values,
    first = ops.find((v) => v.kind === 'distance')!,
    model = traceModelFromCase(f.cases[0]!),
    shape = wheelShape(model, first.after!, 5),
    out = v.slice(34, 37) as Vec,
    axial = dot(sub(out, shape.center), shape.axis),
    a = (axial / shape.halfWidth + 1) / 2,
    lambda = [a, 1 - a, 0];
  v.splice(0, 3, ...lambda);
  const points = [
    add(out, mul(shape.axis, shape.halfWidth - axial)),
    add(out, mul(shape.axis, -shape.halfWidth - axial)),
    add(out, mul(shape.axis, shape.halfWidth - axial)),
  ];
  for (let i = 0; i < 3; i++) {
    const second = v.slice(37, 40) as Vec;
    v.splice(7 + i * 9, 9, ...sub(points[i]!, second), ...points[i]!, ...second);
  }
  const prefix = stream[0]!.lines[0]!.split(' f64le=')[0]!;
  stream[0]!.lines = [prefix + ' f64le=' + packet(v).f64le];
  const negative = interpretTraces(stream, parity)[0]!;
  expect(negative.negativeMass).toBeGreaterThan(0);
  expect(negative.supports.every((v) => !v.cylinder.outside)).toBe(true);
  expect(negative.observation).toBe('AFFINE_RECOVERY_OUTSIDE_WITH_VALID_CHOSEN_CYLINDER_INPUTS');
  v[0] = 5;
  stream[0]!.lines = [prefix + ' f64le=' + packet(v).f64le];
  expect(() => interpretTraces(stream, parity)).toThrow('TRACE_AFFINE_RECONSTRUCTION');
});
it('latches stderr outside an active public API instead of overwriting its context', () => {
  const c = new TraceCollector(memorySink());
  c.endStartup();
  c.accept([syntheticTraceLine(0)]);
  expect(c.snapshot().errors).toContain('TRACE_OUTSIDE_PUBLIC_API');
  expect(() => c.begin('distance', f.cases[0]!, [5, 1])).toThrow('TRACE_NO_OVERWRITTEN_CONTEXT');
});

it('validates archive and WASM metadata purely, rejecting duplicate/truncated members and changed export API without compiling them', () => {
  const member = (name: string, body: string) => {
    const h =
      (name + '/').padEnd(16) +
      '0'.padEnd(12) +
      '0'.padEnd(6) +
      '0'.padEnd(6) +
      '100644'.padEnd(8) +
      String(Buffer.byteLength(body)).padEnd(10) +
      '`\n';
    return Buffer.concat([
      Buffer.from(h),
      Buffer.from(body),
      Buffer.from(body.length % 2 ? '\n' : ''),
    ]);
  };
  const raw = Buffer.concat([Buffer.from('!<arch>\n'), member('a.o', 'abc')]);
  expect(archiveMembers(raw).get('a.o')!.toString()).toBe('abc');
  expect(() => archiveMembers(raw.subarray(0, -1))).toThrow('AR_PADDING');
  expect(() => archiveMembers(Buffer.concat([raw, member('a.o', 'abc')]))).toThrow(
    'AR_UNIQUE_MEMBER',
  );
  expect(() => archiveMembers(Buffer.from('not-an-archive'))).toThrow('AR_MAGIC');
  const a = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0, 7, 5, 1, 1, 120, 0, 0]),
    b = Buffer.from(a);
  b[12] = 121;
  expect(wasmExports(a)).toEqual([{ name: 'x', kind: 0 }]);
  expect(same(wasmExports(a), wasmExports(b))).toBe(false);
  expect(() => wasmExports(a.subarray(0, -1))).toThrow('WASM_SECTION_CAP');
});
it('validates zero-context patch insertion/replacement and never accepts a second file or unproved numerical edit', () => {
  const prefix =
    '--- a/src/engine/engine_collision_gjk.c\n+++ b/src/engine/engine_collision_gjk.c\n';
  expect(applyTracePatch('a\nb\n', prefix + '@@ -1,0 +2 @@\n+x\n')).toBe('a\nx\nb\n');
  expect(applyTracePatch('a\nb\n', prefix + '@@ -2 +2 @@\n-b\n+x\n')).toBe('a\nx\n');
  expect(() => applyTracePatch('a\nb\n', prefix + '@@ -2 +2 @@\n-c\n+x\n')).toThrow(
    'PATCH_CONTEXT_EXACT',
  );
  expect(() => applyTracePatch('a\n', prefix.replace('+++ b/src', '+++ b/other'))).toThrow(
    'PATCH_ONLY_GJK',
  );
});

it('binds the actual checked-in C patch filters and75-word recorder to four pinned query transforms without building C', () => {
  const patch = pinFile(join(dirname(sourcePath), t.patch.file), t.patch).toString(),
    added = patch
      .split('\n')
      .filter((v) => v.startsWith('+') && !v.startsWith('+++'))
      .map((v) => v.slice(1))
      .join('\n');
  const records = [...added.matchAll(/\{(\d+), (\d+), \{([^}]+)\}\}/g)];
  expect(records).toHaveLength(4);
  records.forEach((match, i) => {
    expect([Number(match[1]), Number(match[2])]).toEqual(t.queries[i]!.pair);
    const bits = [...match[3]!.matchAll(/UINT64_C\(0x([0-9a-f]{16})\)/g)]
      .map((v) => {
        const raw = Buffer.alloc(8);
        raw.writeBigUInt64LE(BigInt('0x' + v[1]));
        return raw.toString('hex');
      })
      .join('');
    expect(bits).toBe(t.queries[i]!.objectF64le.join(''));
  });
  expect(added).toContain('config->max_contacts != 1');
  expect(added).toContain('config->npolygonmax != 0 || config->nmeshdegmax != 0');
  expect(added).toContain('mjtNum words[75]');
  expect(added).toContain('const int ints[32]');
  expect(added).not.toMatch(
    /(?:->support\s*\(|\bgjkSupport\s*\(|\bepaSupport\s*\(|\bmjc_multicontact\s*\()/,
  );
  expect(added).not.toContain('mju_sqrt(');
});

it('rejects malformed textual framing immediately after its actual return without decoding coefficients or starting another API', () => {
  const sink = memorySink(),
    stream = new TraceCollector(sink);
  stream.endStartup();
  stream.begin('distance', f.cases[0]!, [5, 1]);
  stream.accept(['ASA_PRIMARY_EPA_V1 ints=broken f64le=00']);
  expect(() => stream.end({ kind: 'distance', case: f.cases[0]!.id, pair: [5, 1] })).toThrow(
    'TRACE_FRAMING',
  );
  expect(() => stream.begin('distance', f.cases[0]!, [6, 1])).toThrow(
    'TRACE_NO_OVERWRITTEN_CONTEXT',
  );
  expect(() => decodeTrace(syntheticTraceLine(0) + '\n', 0)).toThrow('TRACE_SINGLE_LINE');
});
