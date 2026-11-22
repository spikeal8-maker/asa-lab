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
const repo = resolve(dirname(sourcePath), '../../..');
const token = 'one-union-cylinder-static-witness-1071';
const nativeEnabled = process.env.ASA_STATIC_WITNESS_NATIVE !== undefined;
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
function runCase(M: Native, c: Case, l: Ledger, sink: Sink) {
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
        remember({
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
        });
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
  deniedEnvironment(env);
  const expectedSource = required(env, 'ASA_STATIC_SOURCE_SHA256'),
    expectedFixture = required(env, 'ASA_STATIC_FIXTURE_SHA256');
  const path = required(env, 'ASA_STATIC_RECEIPT');
  const journal = new Journal(path),
    l = ledger();
  let first: unknown,
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
    journal.write({
      kind: 'header',
      schema: f.receipt.schema,
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
    const factory = (
      await import(pathToFileURL(join(inputs.paths.engine, f.engine.glue.file)).href)
    ).default as (options: Record<string, unknown>) => Promise<Native>;
    check(l.handles.module.attempted === 0, 'MODULE_CAP');
    l.handles.module.attempted++;
    const M = await factory({
      wasmBinary: inputs.wasm,
      locateFile: (name: string) => {
        check(name === f.engine.wasm.file, 'NO_UNREGISTERED_NATIVE_RESOURCE');
        return join(inputs.paths.engine, name);
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
    phase = 'POSITION_DISPATCH';
    for (const c of f.cases) runCase(M, c, l, journal);
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
  'acquires the once-only registered position comparator with immutable exclusive raw and zero dynamics',
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
