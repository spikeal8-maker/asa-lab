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
import type polyFixtureData from './mujoco-cylinder-epa-polytope-trace.fixture.json';

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
const polyFixturePath = join(
  dirname(sourcePath),
  'mujoco-cylinder-epa-polytope-trace.fixture.json',
);
const p = parseSigned(readFileSync(polyFixturePath, 'utf8')) as typeof polyFixtureData;
const repo = resolve(dirname(sourcePath), '../../..');
const token = 'one-union-cylinder-static-witness-1071';
const nativeEnabled =
  process.env.ASA_EPA_POLYTOPE_NATIVE !== undefined ||
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
type CaseExecutor = typeof runCase;
function exactCaseTerminals(actual: unknown[]) {
  const terminals = (actual as ReplayRecord[]).filter((v) => v.kind === 'case-finish');
  check(
    terminals.length === f.cases.length &&
      f.cases.every((c) => terminals.filter((v) => v.case === c.id).length === 1),
    'TRACE_EXACT_CASE_TERMINALS',
  );
}
function acquireTraceCases(
  M: Native,
  l: Ledger,
  sink: Sink,
  collector: TraceCollector,
  baseline: unknown[],
  execute: CaseExecutor = runCase,
) {
  const parity = new PublicParity(baseline),
    actual: unknown[] = [];
  const durable: Sink = {
    reserve: () => sink.reserve(),
    write(record, footer) {
      sink.write(record, footer);
      actual.push(structuredClone(record));
    },
  };
  const hooks: OperationHooks = {
    before: (kind, c, pair) => collector.begin(kind, c, pair),
    after: (event) => {
      collector.end(event);
      parity.observe(event);
    },
  };
  // runCase.calls deliberately excludes its finally-written terminal. The shared
  // actual path therefore records the full durable sink stream, including cleanup.
  for (const c of f.cases) {
    const start = actual.length;
    execute(M, c, l, durable, hooks);
    const terminal = (actual.slice(start) as ReplayRecord[]).filter(
      (v) => v.kind === 'case-finish',
    );
    check(terminal.length === 1 && terminal[0]!.case === c.id, 'TRACE_EXACT_CASE_TERMINALS');
  }
  exactCaseTerminals(actual);
  parity.complete();
  replay(actual, false);
  sink.write({ kind: 'trace-public-parity', exact: true, operations: 8, position: 4, distance: 4 });
  return { actual, parity };
}
async function nativeRun(env: NodeJS.ProcessEnv) {
  if (env.ASA_EPA_POLYTOPE_NATIVE !== undefined) return polyNativeRun(env);
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
    const { parity } = acquireTraceCases(M, l, journal, collector, traceInputs.baseline);
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
function privateArtifact(env: NodeJS.ProcessEnv, baselineWasm: Buffer, configuration = t) {
  const cfg = configuration;
  const path = required(env, 'ASA_CCD_TRACE_BUILD_RECEIPT'),
    digest = required(env, 'ASA_CCD_TRACE_BUILD_RECEIPT_SHA256');
  check(/^[0-9a-f]{64}$/.test(digest), 'REVIEWED_BUILD_RECEIPT_SHA256');
  const raw = readFileSync(path);
  check(raw.length < 1048576 && sha(raw) === digest, 'REVIEWED_PRIVATE_BUILD_RECEIPT');
  const root = dirname(realpathSync(path));
  check(inside(realpathSync(tmpdir()), root) && !inside(repo, root), 'PRIVATE_BUILD_OS_TEMP');
  const b = parseSigned(raw.toString()) as TraceBuild;
  check(
    b.schema === cfg.build.schema &&
      b.patchSha256 === cfg.patch.sha256 &&
      b.originalGjkSha256 === cfg.immutableInputs.upstream_gjk.sha256 &&
      b.patchedGjkSha256 === cfg.patch.patchedSha256 &&
      b.inheritedBuildSha256 === f.engine.buildReceipt.sha256,
    'PRIVATE_BUILD_SOURCE_LINK',
  );
  // The reviewed build receipt records the frozen original recipe verbatim. Actual commands
  // may relocate only source/object/output/archive paths under its owned private workspace.
  check(
    same(b.compileCommand, cfg.build.command) && same(b.linkCommand, cfg.build.inheritedLink),
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
    b.files.patchedSource.bytes === cfg.patch.patchedBytes &&
      b.files.patchedSource.sha256 === cfg.patch.patchedSha256,
    'PRIVATE_PATCHED_SOURCE_PIN',
  );
  read('patchedSource');
  const inherited = cfg.build.inheritedInputs.filter(
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
    sha(wasm) !== f.engine.wasm.sha256 && wasm.includes(Buffer.from(cfg.frame.prefix + ' ints=')),
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
      const envelope = traceEnvelope(active.lines[0]!);
      // Only integer identity/context is inspected here. Coefficients and all
      // floating-point semantic interpretation remain behind complete public parity.
      const identity = envelope[1]!.split(',').slice(0, 5).map(Number),
        query = t.queries.find((q) => q.case === active.case && same(q.pair, active.pair));
      check(
        query && same(identity, [query.index, ...query.pair, 5, 7]),
        'TRACE_INTEGER_QUERY_CONTEXT',
      );
    }
    this.completed.push(structuredClone(active));
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

function mockAssembledTrace(collector?: TraceCollector, duplicateAt?: number) {
  const mocks = f.cases.map((c) => mockNative(c));
  let active = -1,
    queries = 0;
  const M: Native = {
    MjModel: {
      from_xml_string(text) {
        active++;
        check(
          active < mocks.length && sha(text) === f.cases[active]!.xml_sha256,
          'MOCK_ASSEMBLED_FACTORY',
        );
        return mocks[active]!.M.MjModel.from_xml_string(text);
      },
    },
    MjData: function (model: Model) {
      return new mocks[active]!.M.MjData(model);
    } as unknown as Native['MjData'],
    DoubleBuffer: function (n: number) {
      return new mocks[active]!.M.DoubleBuffer(n);
    } as unknown as Native['DoubleBuffer'],
    mj_version: () => 4000000,
    mj_versionString: () => f.engine.version,
    mj_fwdPosition(model, data) {
      mocks[active]!.M.mj_fwdPosition(model, data);
    },
    mj_geomDistance(model, data, first, second, cutoff, out) {
      mocks[active]!.M.mj_geomDistance(model, data, first, second, cutoff, out);
      const q = t.queries[queries]!;
      check(
        q.case === f.cases[active]!.id && same(q.pair, [first, second]),
        'MOCK_ASSEMBLED_QUERY',
      );
      out.GetView().set(decodePacket(q.fromto.f64le));
      collector?.accept([syntheticTraceLine(queries === duplicateAt ? queries - 1 : queries)]);
      queries++;
      return decodePacket(q.distance.f64le)[0]!;
    },
  };
  return { M, mocks, queryCount: () => queries };
}
function assembledBaseline() {
  const stub = mockAssembledTrace(),
    l = ledger(),
    sink = memorySink();
  l.handles.module.attempted = 1;
  l.handles.module.returned = 1;
  for (const c of f.cases) runCase(stub.M, c, l, sink);
  return sink.events;
}
it('executes the same live acquisition assembly and hooks with injected mocks, retaining exactly both durable terminals before replay/parity and before coefficients', () => {
  const baseline = assembledBaseline(),
    sink = memorySink(),
    stream = new TraceCollector(sink),
    mock = mockAssembledTrace(stream),
    l = ledger();
  l.handles.module.attempted = 1;
  l.handles.module.returned = 1;
  stream.endStartup();
  const result = acquireTraceCases(mock.M, l, sink, stream, baseline);
  expect(result.parity.admitted()).toHaveLength(8);
  expect(result.actual.filter((v) => (v as ReplayRecord).kind === 'case-finish')).toHaveLength(2);
  expect(replay(result.actual, false)).toHaveLength(2);
  expect(stream.complete()).toHaveLength(4);
  expect(interpretTraces(stream.complete(), result.parity)).toHaveLength(4);
  expect(sink.events.filter((v) => (v as ReplayRecord).kind === 'case-finish')).toEqual(
    result.actual.filter((v) => (v as ReplayRecord).kind === 'case-finish'),
  );
  expect(l.position).toEqual({ attempted: 4, returned: 4 });
  expect(l.distance).toEqual({ attempted: 4, returned: 4 });
  for (const mode of ['missing', 'duplicate']) {
    const journal = memorySink(),
      collector = new TraceCollector(journal),
      native = mockAssembledTrace(collector),
      counts = ledger();
    counts.handles.module.attempted = 1;
    counts.handles.module.returned = 1;
    collector.endStartup();
    const altered: CaseExecutor = (M, c, l, sink, hooks) =>
      runCase(
        M,
        c,
        l,
        {
          reserve: () => sink.reserve(),
          write(record, footer) {
            if ((record as ReplayRecord).kind === 'case-finish') {
              if (mode === 'missing') return;
              sink.write(record, footer);
            }
            sink.write(record, footer);
          },
        },
        hooks,
      );
    expect(() =>
      acquireTraceCases(native.M, counts, journal, collector, baseline, altered),
    ).toThrow('TRACE_EXACT_CASE_TERMINALS');
    expect(counts.handles.model.returned).toBe(1);
    expect(counts.position.attempted).toBe(2);
    expect(counts.distance.attempted).toBe(2);
  }
});
it('rejects a prior valid query trace in the next live API context and never advances to another public API/model', () => {
  const baseline = assembledBaseline(),
    sink = memorySink(),
    stream = new TraceCollector(sink),
    mock = mockAssembledTrace(stream, 1),
    l = ledger();
  l.handles.module.attempted = 1;
  l.handles.module.returned = 1;
  stream.endStartup();
  expect(() => acquireTraceCases(mock.M, l, sink, stream, baseline)).toThrow(
    'TRACE_INTEGER_QUERY_CONTEXT',
  );
  expect(l.position).toEqual({ attempted: 1, returned: 1 });
  expect(l.distance).toEqual({ attempted: 2, returned: 2 });
  expect(l.handles.model.returned).toBe(1);
  expect(l.handles.model.deleted).toBe(1);
  expect(l.handles.data.deleted).toBe(1);
  expect(stream.snapshot().completed).toHaveLength(2);
  expect(stream.snapshot().active.pair).toEqual([6, 1]);
  const finish = sink.events.find(
    (v) => (v as ReplayRecord).kind === 'case-finish',
  ) as ReplayRecord;
  expect(finish.firstError).toContain('TRACE_INTEGER_QUERY_CONTEXT');
  expect(sink.events.filter((v) => (v as ReplayRecord).kind === 'distance')).toHaveLength(2);
  expect(
    sink.events.filter((v) => (v as { kind: string }).kind === 'trace-stderr-raw'),
  ).toHaveLength(2);
  expect(() => stream.begin('position', f.cases[0]!)).toThrow('TRACE_NO_OVERWRITTEN_CONTEXT');
});

// V2 is a separately admitted observation mode. V1 remains independently parseable.
type PolyVertex = { id: number; indices: number[]; flags: number; words: Packet };
type PolyFace = {
  id: number;
  packed: number;
  adj: number[];
  index: number;
  flags: number;
  words: Packet;
};
type PolySnapshot = {
  tag: 1;
  header: number[];
  scalars: Packet;
  vertices: PolyVertex[];
  faces: PolyFace[];
  map: number[];
  horizon: number[][];
};
type PolyMeta = { tag: 2 | 3; header: number[] };
type PolyRecord = PolySnapshot | PolyMeta;
function polyAdmission(env: NodeJS.ProcessEnv) {
  check(env.ASA_EPA_POLYTOPE_NATIVE === p.polytope.token, 'EXACT_POLYTOPE_OPT_IN');
  for (const key of Object.keys(env))
    if (key !== 'ASA_EPA_POLYTOPE_NATIVE' && /^ASA_/.test(key) && /(?:NATIVE|ACQUIRE)/.test(key))
      check(env[key] === undefined, 'POLYTOPE_AMBIGUOUS_OR_CONSUMED_' + key);
}
function polyBudget() {
  const l = p.polytope.layout,
    c = p.polytope.profile;
  const snapshot = 1 + 32 * 4 + 16 * 8 + c.vertices * 88 + c.faces * 64 + c.map * 4 + c.horizon * 8;
  // Successful seed >=4 faces. Inside epa slots monotonically append; at most20 attaches.
  // Seed fallback/pop/reset is BEFORE this commit and has its own <=16 metadata records.
  // Discarded trial arrays are not claimed as snapshots. Every value copied into the
  // successful ACTIVE seed is retained there, including copied support IDs/points.
  const count = 1 + c.visits * 3 + (c.faces - 4) + 1;
  const encoded = snapshot * count + l.contextReserve + l.footerReserve;
  check(snapshot === 4009 && count === 46 && encoded === 194654, 'POLY_EXACT_LAYOUT_PROOF');
  check(c.metadata * 65 <= l.contextReserve && encoded <= l.binaryCap, 'POLY_BINARY_BOUND');
  check(snapshot * count + l.contextReserve <= l.mainCap, 'POLY_RESERVED_ERROR_BOUND');
  const framed = l.maxChunks * (l.chunkRawBytes * 2 + l.chunkEnvelopeMaxBytes) + 4096 + 256;
  check(framed <= l.perQueryStderr && framed * 4 <= l.totalStderr, 'POLY_FRAMED_BOUND');
  // Raw callback + per-API stream + final stream + decoded lossless data <=4 copies.
  // <=2MiB framed each, <=1MiB binary represented as <=2MiB hex. Fixed model/errors <=2MiB.
  const external = l.totalStderr * 4 + l.binaryCap * 4 * 2 + 2 * 1048576;
  check(external <= l.externalBytes, 'POLY_DURABLE_DUPLICATES_BOUND');
  return { snapshot, count, encoded, framed, external };
}
function polyOperationInverse(source: string) {
  const inverse = source.replace(
    /^\/\/ ASA_EPA_V2_BEGIN [a-z]+\n[\s\S]*?^\/\/ ASA_EPA_V2_END [a-z]+\n/gm,
    '',
  );
  check(
    !inverse.includes('asa_poly') && !inverse.includes('ASAPoly'),
    'POLY_NO_UNACCOUNTED_OPERATIONS',
  );
  return inverse;
}
function polyPatchPreflight(env: NodeJS.ProcessEnv) {
  const original = pinFile(required(env, 'ASA_CCD_TRACE_UPSTREAM_GJK'), {
    bytes: p.patch.upstreamBytes,
    sha256: p.immutableInputs.upstream_gjk.sha256,
  });
  const patch = pinFile(join(dirname(sourcePath), p.patch.file), p.patch);
  const cumulative = applyTracePatch(original.toString(), patch.toString());
  check(
    Buffer.byteLength(cumulative) === p.patch.patchedBytes &&
      sha(cumulative) === p.patch.patchedSha256,
    'POLY_CUMULATIVE_C_PIN',
  );
  const v1 = polyOperationInverse(cumulative);
  check(
    Buffer.byteLength(v1) === p.v1Source.bytes && sha(v1) === p.v1Source.sha256,
    'POLY_INVERSE_EXACT_V1',
  );
  check(traceOperationInverse(v1) === original.toString(), 'POLY_INVERSE_EXACT_UPSTREAM');
  return { patch: p.patch, v1: p.v1Source, upstream: sha(original), budget: polyBudget() };
}
class PolyJournal implements Sink {
  private fd: number;
  private used = 0;
  private closed = false;
  constructor(readonly path: string) {
    check(isAbsolute(path), 'POLY_RECEIPT_ABSOLUTE');
    const parent = realpathSync(dirname(path));
    check(inside(realpathSync(tmpdir()), parent) && !inside(repo, parent), 'POLY_RECEIPT_TEMP');
    check(
      !lstatSync(parent).isSymbolicLink() && readdirSync(parent).length === 0,
      'POLY_EXCLUSIVE_EMPTY_PARENT',
    );
    this.fd = openSync(path, 'wx');
  }
  reserve() {
    check(
      this.used + 3 * 1048576 <= p.polytope.layout.externalBytes - 1048576,
      'POLY_PRE_API_RECEIPT_RESERVE',
    );
  }
  write(record: unknown, footer = false) {
    const encoded = Buffer.from(stringifySigned(record) + '\n');
    check(
      this.used + encoded.length <= p.polytope.layout.externalBytes - (footer ? 0 : 1048576),
      'POLY_RECEIPT_CAP',
    );
    let at = 0;
    while (at < encoded.length) {
      const n = writeSync(this.fd, encoded, at, encoded.length - at);
      check(n > 0, 'POLY_RECEIPT_SHORT_WRITE');
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
function decodePoly(raw: Buffer, query: number) {
  check(raw.length <= p.polytope.layout.binaryCap, 'POLY_BINARY_CAP');
  let at = 0,
    seq = 0,
    snapshots = 0,
    metadata = 0;
  const records: PolyRecord[] = [];
  const take = (n: number) => {
    check(n >= 0 && at + n <= raw.length, 'POLY_TRUNCATED');
    const b = raw.subarray(at, at + n);
    at += n;
    return b;
  };
  const ints = (n: number) => {
    const b = take(n * 4);
    return Array.from({ length: n }, (_, i) => b.readInt32LE(i * 4));
  };
  const floats = (n: number) => {
    const b = take(n * 8);
    const v = packet(decodePacket(b.toString('hex')));
    validatePacket(v, n, 'POLY_F64');
    return v;
  };
  while (at < raw.length) {
    const tag = take(1)[0]!;
    check(tag === 1 || tag === 2 || tag === 3, 'POLY_TAG');
    const h = ints(tag === 1 ? 32 : 16);
    check(h[0] === query && h[1] === ++seq, 'POLY_QUERY_SEQUENCE');
    if (tag !== 1) {
      check(
        h.slice(tag === 2 ? 8 : 13).every((v) => v === 0),
        'POLY_META_RESERVED',
      );
      if (tag === 2) {
        check(++metadata <= 16 && (h[2] === 1 || h[2] === 2), 'POLY_SEED_METADATA');
      } else {
        check(
          at === raw.length && h[12] === at - 65 && h[8] === snapshots && h[11] === metadata,
          'POLY_FOOTER_CENSUS',
        );
      }
      records.push({ tag, header: h });
      continue;
    }
    check(
      ++snapshots <= 46 && h[2]! >= 0 && h[2]! <= 5 && h[3]! >= 0 && h[4]! >= -1 && h[4]! <= 100,
      'POLY_SNAPSHOT_ID',
    );
    check(
      h[5]! >= 0 && h[5]! <= 7 && h[16]! >= 0 && h[16]! <= 8 && h[17] === 1,
      'POLY_SCALAR_MASK',
    );
    check(
      same(h.slice(18, 23), [100, 105, 600, 600, 89]) && h.slice(23).every((v) => v === 0),
      'POLY_NATIVE_UNCHANGED_CAPACITY',
    );
    check(
      h.slice(10, 14).every((id) => id >= -2 && id < 600) &&
        h[14]! >= 0 &&
        h[14]! <= 12 &&
        (h[15] === 0 || h[15] === 1),
      'POLY_INTEGER_REFERENCES',
    );
    const [nv, nf, nm, nh] = h.slice(6, 10) as [number, number, number, number];
    check(
      nv >= 0 && nv <= 16 && nf >= 0 && nf <= 24 && nm >= 0 && nm <= 24 && nh >= 0 && nh <= 89,
      'POLY_PROFILE_COUNTS',
    );
    const scalars = floats(16);
    check(
      scalars.f64le.slice(9 * 16) === packet(Array(7).fill(0) as number[]).f64le,
      'POLY_SCALAR_RESERVED',
    );
    const vertices: PolyVertex[] = [];
    for (let i = 0; i < nv; i++) {
      const r = ints(4);
      check(r[0] === i && r[3] === 7, 'POLY_VERTEX_ID');
      vertices.push({ id: i, indices: r.slice(1, 3), flags: r[3]!, words: floats(9) });
    }
    const faces: PolyFace[] = [];
    for (let i = 0; i < nf; i++) {
      const r = ints(8),
        w = floats(4),
        flags = r[6]!;
      check(r[0] === i && r[7] === 0 && [3, 7, 31].includes(flags), 'POLY_FACE_DEFINED');
      check(r[1]! >= 0 && r[1]! < 1 << 30, 'POLY_FACE_PACKED');
      if (!(flags & 4))
        check(w.f64le.slice(0, 48) === packet([0, 0, 0]).f64le, 'POLY_UNDEFINED_PROJECTION');
      if (!(flags & 8)) check(w.f64le.slice(48) === packet([0]).f64le, 'POLY_UNDEFINED_DIST2');
      if (!(flags & 16)) check(r[5] === 0, 'POLY_UNDEFINED_INDEX');
      faces.push({ id: i, packed: r[1]!, adj: r.slice(2, 5), index: r[5]!, flags, words: w });
    }
    const map = ints(nm),
      horizon = Array.from({ length: nh }, () => ints(2));
    check(map.every((i) => i >= 0 && i < nf) && new Set(map).size === map.length, 'POLY_MAP_IDS');
    check(
      horizon.every((r) => r[0]! >= 0 && r[0]! < nf && r[1]! >= 0 && r[1]! < 3),
      'POLY_HORIZON_IDS',
    );
    records.push({ tag: 1, header: h, scalars, vertices, faces, map, horizon });
  }
  check(
    records.at(-1)?.tag === 3 && records.filter((v) => v.tag === 3).length === 1,
    'POLY_EXACT_TERMINAL',
  );
  return records;
}
type PolyContext = {
  kind: 'position' | 'distance';
  case: string;
  pair?: number[];
  query: number;
  lines: string[];
  bytes: number;
};
class PolyCollector extends TraceCollector {
  private context: PolyContext | undefined;
  private v2Errors: string[] = [];
  private v2Used = 0;
  private v2Complete: PolyContext[] = [];
  constructor(private polySink: Sink) {
    super(polySink);
  }
  override accept(args: unknown[]) {
    const text = args.length === 1 && typeof args[0] === 'string' ? args[0] : '';
    if (!text.startsWith(p.polytope.prefix)) {
      super.accept(args);
      return;
    }
    try {
      check(this.context?.kind === 'distance', 'POLY_OUTSIDE_DIRECT_QUERY');
      const n = Buffer.byteLength(text) + 1;
      check(
        n <= 2176 &&
          this.context.bytes + n <= p.polytope.layout.perQueryStderr &&
          this.v2Used + n <= p.polytope.layout.totalStderr,
        'POLY_STDERR_CAP',
      );
      this.context.bytes += n;
      this.v2Used += n;
      this.context.lines.push(text);
      this.polySink.write({
        kind: 'polytope-stderr-raw',
        case: this.context.case,
        pair: this.context.pair,
        query: this.context.query,
        text,
        bytes: n,
      });
    } catch (error) {
      this.v2Errors.push(String(error));
      try {
        this.polySink.write(
          {
            kind: 'polytope-capture-error',
            error: String(error),
            bytes: Buffer.byteLength(text),
            sha256: sha(text),
            prefix: text.slice(0, 1024),
          },
          true,
        );
      } catch (e) {
        this.v2Errors.push(String(e));
      }
    }
  }
  override begin(kind: 'position' | 'distance', c: Case, pair?: number[]) {
    check(!this.context && this.v2Errors.length === 0, 'POLY_PENDING_ERROR_OR_CONTEXT');
    check(
      this.v2Used + p.polytope.layout.perQueryStderr <= p.polytope.layout.totalStderr,
      'POLY_PRE_API_STDERR_RESERVE',
    );
    super.begin(kind, c, pair);
    const query =
      kind === 'distance' ? t.queries.find((q) => q.case === c.id && same(q.pair, pair))?.index : 0;
    check(query !== undefined, 'POLY_REGISTERED_QUERY');
    this.context = { kind, case: c.id, ...(pair ? { pair } : {}), query, lines: [], bytes: 0 };
  }
  override end(event: ReplayRecord) {
    const c = this.context;
    check(c, 'POLY_NO_CONTEXT');
    this.polySink.write({ kind: 'polytope-api-stream', context: c, errors: this.v2Errors });
    check(this.v2Errors.length === 0, 'POLY_CAPTURE_FAILED_' + this.v2Errors[0]);
    // Only structural/integer/defined-field guards before next API. No lambda/topology interpretation.
    if (c.kind === 'distance') parsePolyLines(c.lines, c.query);
    else check(c.lines.length === 0, 'POLY_NO_POSITION_TRACE');
    super.end(event);
    this.v2Complete.push(structuredClone(c));
    this.context = undefined;
  }
  polySnapshot() {
    return {
      used: this.v2Used,
      errors: this.v2Errors,
      contexts: this.v2Complete,
      active: this.context ?? null,
    };
  }
  polyComplete() {
    check(
      this.v2Errors.length === 0 && !this.context && this.v2Complete.length === 8,
      'POLY_ALL_8_CONTEXTS',
    );
    const q = this.v2Complete.filter((c) => c.kind === 'distance');
    check(q.length === 4, 'POLY_EXACT_FOUR_QUERIES');
    return q;
  }
}
function parsePolyLines(lines: string[], query: number) {
  check(lines.length >= 2 && lines.length <= 193, 'POLY_CHUNK_COUNT');
  const end =
    /^ASA_EPA_POLYTOPE_V2_END q=(\d+) chunks=(\d+) bytes=(\d+) error=(\d+) records=(\d+)$/.exec(
      lines.at(-1)!,
    );
  check(
    end && Number(end[1]) === query && Number(end[2]) === lines.length - 1,
    'POLY_END_IDENTITY',
  );
  const total = Number(end[3]);
  check(total > 0 && total <= 196608 && Number(end[4]) === 0, 'POLY_RECORDER_COMPLETE');
  const chunks = lines.slice(0, -1).map((line, i) => {
    const m =
      /^ASA_EPA_POLYTOPE_V2 q=(\d+) chunk=(\d+) bytes=(\d+) total=(\d+) hex=([0-9a-f]+)$/.exec(
        line,
      );
    check(
      m && Number(m[1]) === query && Number(m[2]) === i && Number(m[4]) === total,
      'POLY_CHUNK_IDENTITY',
    );
    const raw = Buffer.from(m[5]!, 'hex');
    check(
      m[5]!.length === raw.length * 2 &&
        raw.length === Number(m[3]) &&
        raw.length === (i === lines.length - 2 ? total - i * 1024 : 1024),
      'POLY_CHUNK_BYTES',
    );
    check(Buffer.byteLength(line) - m[5]!.length + 1 <= 128, 'POLY_ENVELOPE_BOUND');
    return raw;
  });
  const raw = Buffer.concat(chunks);
  check(raw.length === total, 'POLY_TOTAL_BYTES');
  const records = decodePoly(raw, query),
    footer = records.at(-1) as PolyMeta;
  check(footer.header[2] === 0 && footer.header[1] === Number(end[5]), 'POLY_FOOTER_END_IDENTITY');
  return { raw, records, sha256: sha(raw) };
}
function polyOrderedMinimum(s: PolySnapshot) {
  let face = s.header[11]!,
    lower = 1e10;
  for (const id of s.map) {
    const f = s.faces[id]!;
    check(f.flags === 31 && f.index === s.map.indexOf(id), 'POLY_ACTUAL_ORDERED_MAP');
    if (f.words.values[3]! < lower) {
      lower = f.words.values[3]!;
      face = id;
    }
  }
  return { face, lower };
}
function polySeedEpochs(records: PolyRecord[]) {
  let epoch = 0,
    committed = false;
  for (const r of records) {
    if (r.tag === 2) {
      check(!committed && r.header[3] === epoch, 'POLY_SEED_EPOCH');
      if (r.header[2] === 2) epoch++;
      else
        check(
          [2, 3, 4].includes(r.header[4]!) && r.header.slice(5, 8).every((v) => v >= 0 && v <= 600),
          'POLY_SEED_ATTEMPT',
        );
    } else if (r.tag === 1) {
      check(r.header[3] === epoch, 'POLY_COMMITTED_EPOCH');
      if (r.header[2] === 0) {
        check(!committed, 'POLY_SINGLE_SEED_COMMIT');
        committed = true;
      } else check(committed, 'POLY_NO_PRECOMMIT_SNAPSHOT');
    }
  }
  check(committed, 'POLY_SEED_COMMIT_REQUIRED');
}
function polyExitCheck(snapshots: PolySnapshot[]) {
  const last = snapshots.at(-1)!;
  const support = [...snapshots]
    .reverse()
    .find((s) => s.header[2] === 2 && s.header[4] === last.header[4]);
  const h = last.header,
    s = last.scalars.values,
    reason = h[14]!;
  check(reason >= 1 && reason <= 12, 'POLY_EXPLICIT_EXIT_REASON');
  if (reason === 1) check(s[3]! > s[5]! || h[10] === -1, 'POLY_EXIT_INVALID');
  if (reason === 2) check(s[3]! <= 0, 'POLY_EXIT_ZERO');
  if (reason === 3)
    check(
      support && support.scalars.values[7]! - support.scalars.values[6]! < 1e-8,
      'POLY_GAP_BRANCH',
    );
  if (reason === 4)
    check(
      support && h[4] === 0 && support.scalars.values[4]! < support.scalars.values[6]! - 1e-8,
      'POLY_NOCONTACT_BRANCH',
    );
  if (reason === 5) check(support, 'POLY_REPEAT_SUPPORT_BRANCH');
  if (reason === 6)
    check(
      snapshots.some((v) => v.header[2] === 3 && v.header[14] === 6),
      'POLY_HORIZON_ERROR_BRANCH',
    );
  if (reason === 7) check(h[9]! < 3, 'POLY_HORIZON_SHORT_BRANCH');
  if (reason === 8) check(h[9]! > 600 - h[7]!, 'POLY_FACE_CAPACITY_BRANCH');
  if (reason === 9)
    check(
      snapshots.some((v) => v.header[2] === 4 && v.header[14] === 9 && v.scalars.values[8] === 0),
      'POLY_FIRST_ATTACH_ZERO_BRANCH',
    );
  if (reason === 10) check(false, 'POLY_LATER_ZERO_MUST_REACH_EMPTY_MAP_BRANCH');
  if (reason === 11) check(h[8] === 0 || h[10] === -1, 'POLY_EMPTY_MAP_BRANCH');
  if (reason === 12) check(h[4] === 100, 'POLY_ITERATION_LIMIT_BRANCH');
}
function polyFaceIds(f: PolyFace) {
  return [f.packed & 1023, (f.packed >>> 10) & 1023, (f.packed >>> 20) & 1023];
}
function polyVec(v: readonly number[], at = 0): Vec {
  return [v[at]!, v[at + 1]!, v[at + 2]!];
}
function polySub(a: readonly number[], b: readonly number[]): Vec {
  return [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
}
function polyDot(a: readonly number[], b: readonly number[]) {
  return a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
}
function polyCross(a: readonly number[], b: readonly number[]): Vec {
  return [
    a[1]! * b[2]! - a[2]! * b[1]!,
    a[2]! * b[0]! - a[0]! * b[2]!,
    a[0]! * b[1]! - a[1]! * b[0]!,
  ];
}
function polyClosestTriangle(a: Vec, b: Vec, c: Vec) {
  const ab = polySub(b, a),
    ac = polySub(c, a),
    normal = polyCross(ab, ac),
    nn = polyDot(normal, normal);
  const options: { kind: string; lambda: number[]; point: Vec; dist2: number }[] = [];
  for (const [i, j] of [
    [0, 1],
    [1, 2],
    [2, 0],
  ]) {
    const v = [a, b, c],
      u = v[i!]!,
      w = v[j!]!,
      d = polySub(w, u),
      dd = polyDot(d, d),
      t = dd ? Math.max(0, Math.min(1, -polyDot(u, d) / dd)) : 0;
    const point: Vec = [u[0] + t * d[0], u[1] + t * d[1], u[2] + t * d[2]],
      lambda = [0, 0, 0];
    lambda[i!] = 1 - t;
    lambda[j!] = t;
    options.push({
      kind: t > 0 && t < 1 ? 'EDGE' : 'VERTEX',
      lambda,
      point,
      dist2: polyDot(point, point),
    });
  }
  if (nn > 0) {
    const point = normal.map((x) => (x * polyDot(normal, a)) / nn) as Vec;
    const den = polyDot(ab, ab) * polyDot(ac, ac) - polyDot(ab, ac) ** 2;
    if (den > 0) {
      const ap = polySub(point, a),
        v = (polyDot(ac, ac) * polyDot(ap, ab) - polyDot(ab, ac) * polyDot(ap, ac)) / den,
        w = (polyDot(ab, ab) * polyDot(ap, ac) - polyDot(ab, ac) * polyDot(ap, ab)) / den;
      const lambda = [1 - v - w, v, w];
      if (lambda.every((x) => x >= 0))
        options.push({ kind: 'FACE', lambda, point, dist2: polyDot(point, point) });
    }
  }
  return options.reduce((a, b) => (a.dist2 <= b.dist2 ? a : b));
}
function polyHullObservation(s: PolySnapshot) {
  const active = s.faces.filter((f) => f.flags === 31 && f.index !== -2),
    center = s.scalars.values.slice(0, 3),
    issues: string[] = [],
    edges = new Map<string, string[]>();
  const activeVertexIDs = [...new Set(active.flatMap((f) => polyFaceIds(f)))]
    .filter((i) => i < s.vertices.length)
    .sort((a, b) => a - b);
  const unusedVertexIDs = s.vertices.map((v) => v.id).filter((i) => !activeVertexIDs.includes(i));
  const unusedOutside = new Map(unusedVertexIDs.map((id) => [id, 0]));
  let nearest: unknown = null,
    best = Infinity;
  for (const f of active) {
    const ids = polyFaceIds(f);
    if (ids.some((i) => i >= s.vertices.length)) {
      issues.push('FACE_VERTEX_RANGE_' + f.id);
      continue;
    }
    const points = ids.map((i) => polyVec(s.vertices[i]!.words.values)),
      [a, b, c] = points as [Vec, Vec, Vec];
    let n = polyCross(polySub(b, a), polySub(c, a));
    const length = Math.sqrt(polyDot(n, n));
    if (!length) {
      issues.push('DEGENERATE_' + f.id);
      continue;
    }
    if (polyDot(n, polySub(center, a)) > 0) n = n.map((x) => -x) as Vec;
    const d = polyDot(n, a),
      scale = Math.max(1, ...points.flat().map(Math.abs)),
      roundoff = 128 * Number.EPSILON * length * scale;
    if (d < -roundoff) issues.push('ORIGIN_OUTSIDE_' + f.id);
    if (
      activeVertexIDs.some((id) => polyDot(n, polyVec(s.vertices[id]!.words.values)) - d > roundoff)
    )
      issues.push('NONCONVEX_' + f.id);
    for (const id of unusedVertexIDs)
      unusedOutside.set(
        id,
        Math.max(
          unusedOutside.get(id)!,
          (polyDot(n, polyVec(s.vertices[id]!.words.values)) - d) / length,
        ),
      );
    for (const [i, j] of [
      [0, 1],
      [1, 2],
      [2, 0],
    ]) {
      const key = [ids[i!]!, ids[j!]!].sort((a, b) => a - b).join(',');
      const rows = edges.get(key) ?? [];
      rows.push(ids[i!] + ',' + ids[j!]);
      edges.set(key, rows);
    }
    const closest = polyClosestTriangle(a, b, c);
    if (closest.dist2 < best) {
      best = closest.dist2;
      nearest = { face: f.id, ...closest };
    }
    f.adj.forEach((j, k) => {
      const other = s.faces[j];
      if (!other || other.index === -2 || !other.adj.includes(f.id))
        issues.push('ADJACENCY_' + f.id + '_' + k);
    });
  }
  for (const [key, rows] of edges)
    if (rows.length !== 2 || rows[0] !== rows[1]!.split(',').reverse().join(','))
      issues.push('OPEN_OR_ORIENTATION_' + key);
  // Defects are observations, never erased as parse failures or converted to physical PASS.
  return {
    activeFaces: active.length,
    allocatedVertices: s.vertices.length,
    activeVertexIDs,
    unusedVertexIDs,
    unusedSupportOutside: unusedVertexIDs.map((id) => ({
      id,
      maxSignedPlaneDistance: unusedOutside.get(id)!,
    })),
    issues,
    nearestRecordedFiniteFeature: nearest,
    closedConvexOriginCandidate: issues.length === 0,
    roundoffPolicy: '128eps forward-error diagnostic only; no physical tolerance or repair',
  };
}
function interpretPoly(contexts: PolyContext[], v1: TraceContext[], parity: PublicParity) {
  parity.admitted();
  check(contexts.length === 4 && v1.length === 4, 'POLY_INTERPRET_AFTER_ALL_PARITY');
  return contexts.map((context, index) => {
    const decoded = parsePolyLines(context.lines, index + 1),
      records = decoded.records,
      snapshots = records.filter((r): r is PolySnapshot => r.tag === 1);
    check(snapshots[0]?.header[2] === 0 && snapshots.at(-1)?.header[2] === 5, 'POLY_SEED_FINAL');
    polySeedEpochs(records);
    let epoch = -1,
      lastK = -1,
      selects = 0,
      previous: PolySnapshot | undefined;
    for (const s of snapshots) {
      check(s.header[3]! >= epoch, 'POLY_EPOCH_ORDER');
      epoch = s.header[3]!;
      check(
        s.faces.every((f) => polyFaceIds(f).every((id) => id < s.vertices.length)),
        'POLY_DEFINED_VERTEX_RANGE',
      );
      if (previous) {
        check(
          s.vertices.length >= previous.vertices.length && s.faces.length >= previous.faces.length,
          'POLY_POST_SEED_MONOTONIC',
        );
        for (let j = 0; j < previous.vertices.length; j++)
          check(same(s.vertices[j], previous.vertices[j]), 'POLY_IMMUTABLE_VERTEX');
        for (let j = 0; j < previous.faces.length; j++) {
          const a = previous.faces[j]!,
            b = s.faces[j]!;
          check(
            a.packed === b.packed && (a.flags & b.flags) === a.flags,
            'POLY_IMMUTABLE_FACE_OR_DEFINED',
          );
          if (a.flags & 4)
            check(
              a.words.f64le.slice(0, 48) === b.words.f64le.slice(0, 48),
              'POLY_IMMUTABLE_FACE_PROJECTION',
            );
          if (a.flags & 8)
            check(a.words.f64le.slice(48) === b.words.f64le.slice(48), 'POLY_IMMUTABLE_FACE_DIST2');
        }
      }
      if (s.header[2] === 1) {
        check(s.header[4] === lastK + 1, 'POLY_SELECTION_ITERATION');
        lastK = s.header[4]!;
        selects++;
        const { face, lower } = polyOrderedMinimum(s);
        check(
          face === s.header[10] && packet([lower]).f64le === s.scalars.f64le.slice(48, 64),
          'POLY_STRICT_ORDERED_MIN',
        );
      }
      previous = s;
    }
    const last = snapshots.at(-1)!,
      v = decodeTrace(v1[index]!.lines[0]!, index),
      face = last.faces[last.header[10]!]!;
    check(
      face &&
        face.flags === 31 &&
        face.packed === v.ints[13] &&
        face.index === v.ints[14] &&
        last.header[4] === v.ints[10] &&
        same(last.header.slice(6, 9), v.ints.slice(15, 18)),
      'POLY_FINAL_V1_IDENTITY',
    );
    check(face.words.f64le === v.words.f64le.slice(3 * 16, 7 * 16), 'POLY_FINAL_V1_FACE_BITS');
    const ids = polyFaceIds(face);
    ids.forEach((id, i) => {
      const vertex = last.vertices[id]!;
      check(
        vertex.words.f64le === v.words.f64le.slice((7 + 9 * i) * 16, (16 + 9 * i) * 16) &&
          same(vertex.indices, v.ints.slice(21 + 2 * i, 23 + 2 * i)),
        'POLY_FINAL_V1_SUPPORT_BITS',
      );
    });
    check(
      last.header[14]! > 0 && last.header[14]! <= 12 && selects === last.header[16],
      'POLY_EXPLICIT_EXIT',
    );
    const support = [...snapshots].reverse().find((s) => s.header[2] === 2);
    if (last.header[14] === 3)
      check(
        support && support.scalars.values[7]! - support.scalars.values[6]! < 1e-8,
        'POLY_GAP_BRANCH',
      );
    if (last.header[14] === 4)
      check(
        support &&
          support.header[4] === 0 &&
          support.scalars.values[4]! < support.scalars.values[6]! - 1e-8,
        'POLY_NOCONTACT_BRANCH',
      );
    polyExitCheck(snapshots);
    return {
      query: index + 1,
      sha256: decoded.sha256,
      records: records.length,
      snapshots: snapshots.length,
      selectionVisits: selects,
      exit: p.polytope.exitReasons[last.header[14]!],
      finalHull: polyHullObservation(last),
      scope: 'INITIALIZED_EPA_OBSERVATION_ONLY_HISTORICAL_FAIL_GAP_UNCHANGED',
    };
  });
}
function polyHistorical(env: NodeJS.ProcessEnv) {
  pinFile(traceFixturePath, p.priorEvidence.fixture);
  pinFile(join(dirname(sourcePath), p.priorEvidence.patch.file), p.priorEvidence.patch);
  pinFile(fixturePath, p.immutableInputs.static_source.fixture);
  const old = historicalTraceInputs(env),
    patch = polyPatchPreflight(env);
  const spec = pinFile(required(env, 'ASA_EPA_POLYTOPE_V1_SPEC'), p.priorEvidence.spec);
  const raw = pinFile(required(env, 'ASA_EPA_POLYTOPE_V1_RAW'), p.v1Raw);
  const audit = pinFile(required(env, 'ASA_EPA_POLYTOPE_V1_AUDIT'), p.priorEvidence.audit);
  const triangle = pinFile(
    required(env, 'ASA_EPA_POLYTOPE_TRIANGLE_REPORT'),
    p.priorEvidence.triangle,
  );
  const build = pinFile(required(env, 'ASA_EPA_POLYTOPE_V1_BUILD'), p.priorEvidence.build);
  // Whole pinned artifacts are immutable inputs, never imported executable modules.
  check(
    sha(spec) === p.priorEvidence.spec.sha256 &&
      audit.length > 0 &&
      triangle.length > 0 &&
      build.length > 0,
    'POLY_COMPLETE_PRIOR_INPUTS',
  );
  const records = raw
    .toString()
    .trim()
    .split('\n')
    .map((line) => parseSigned(line)) as ReplayRecord[];
  const finish = records.at(-1) as ReplayRecord & { phase?: string; runtime?: string };
  check(
    finish.kind === 'finish' && finish.phase === 'COMPLETE' && finish.runtime === 'COMPLETE',
    'POLY_PRIOR_TRACE_COMPLETE',
  );
  const header = records.find((v) => v.kind === 'header') as ReplayRecord & {
    traceAdmission?: { artifact?: { receipt?: Pin } };
  };
  check(
    header?.source?.sha256 === p.priorEvidence.spec.sha256 &&
      header.fixture?.sha256 === t.immutableInputs.static_source.fixture.sha256 &&
      same(header.traceAdmission?.artifact?.receipt, p.priorEvidence.build),
    'POLY_PRIOR_SOURCE_BUILD_RAW_LINK',
  );
  replay(records, false);
  const publicParity = new PublicParity(old.baseline);
  records
    .filter((v) => v.kind === 'position' || v.kind === 'distance')
    .forEach((v) => publicParity.observe(v));
  publicParity.complete();
  const trace = records.filter((v) => v.kind === 'trace-stderr-raw') as unknown as {
    case: string;
    pair: number[];
    text: string;
  }[];
  check(trace.length === 4, 'POLY_PRIOR_EXACT_FOUR_V1');
  const streams: TraceContext[] = trace.map((v, i) => {
    check(v.case === t.queries[i]!.case && same(v.pair, t.queries[i]!.pair), 'POLY_PRIOR_V1_ORDER');
    return {
      kind: 'distance',
      case: v.case,
      pair: v.pair,
      lines: [v.text],
      bytes: Buffer.byteLength(v.text) + 1,
    };
  });
  check(
    same(
      streams.map((v) => v.lines[0]),
      p.frozenV1Lines,
    ),
    'POLY_FIXTURE_EXACT_PRIOR_V1_LINES',
  );
  interpretTraces(streams, publicParity);
  return {
    baseline: old.baseline,
    streams,
    proof: {
      old: old.proof,
      patch,
      source: p.priorEvidence.spec,
      raw: p.v1Raw,
      audit: p.priorEvidence.audit,
      triangle: p.priorEvidence.triangle,
      build: p.priorEvidence.build,
    },
  };
}
async function polyNativeRun(env: NodeJS.ProcessEnv) {
  polyAdmission(env);
  const source = required(env, 'ASA_EPA_POLYTOPE_SOURCE_SHA256'),
    fixture = required(env, 'ASA_EPA_POLYTOPE_FIXTURE_SHA256');
  const path = required(env, 'ASA_EPA_POLYTOPE_RECEIPT'),
    journal = new PolyJournal(path),
    l = ledger();
  let first: unknown,
    phase = 'PRE_IMPORT',
    collector: PolyCollector | undefined;
  try {
    journal.write({
      kind: 'polytope-preflight',
      source: { bytes: readFileSync(sourcePath).length, sha256: sha(readFileSync(sourcePath)) },
      declaredSource: source,
      fixture: {
        bytes: readFileSync(polyFixturePath).length,
        sha256: sha(readFileSync(polyFixturePath)),
      },
      declaredFixture: fixture,
      counters: l,
    });
    check(
      sha(readFileSync(sourcePath)) === source && sha(readFileSync(polyFixturePath)) === fixture,
      'POLY_CURRENT_SOURCE_FIXTURE_PINS',
    );
    polyBudget();
    const inputs = readInputs(env),
      historical = polyHistorical(env),
      artifact = privateArtifact(env, inputs.wasm, p);
    collector = new PolyCollector(journal);
    journal.write({
      kind: 'header',
      schema: p.schema,
      source: { bytes: readFileSync(sourcePath).length, sha256: source },
      fixture: { bytes: readFileSync(polyFixturePath).length, sha256: fixture },
      pins: { inputs: inputs.proof, historical: historical.proof, artifact: artifact.proof },
      profile: f.profile,
      protocol: f.protocol,
      caps: p.caps,
      polytope: p.polytope,
      counters: l,
    });
    const header = parseSigned(readFileSync(path, 'utf8').trim().split('\n').at(-1)!);
    check(
      header.source.sha256 === source && header.fixture.sha256 === fixture,
      'POLY_HEADER_READBACK_BEFORE_IMPORT',
    );
    journal.reserve();
    phase = 'MODULE_IMPORT';
    const factory = (await import(pathToFileURL(artifact.gluePath).href)).default as (
      options: Record<string, unknown>,
    ) => Promise<Native>;
    check(l.handles.module.attempted === 0, 'POLY_SINGLE_MODULE');
    l.handles.module.attempted++;
    const M = await factory({
      wasmBinary: artifact.wasm,
      printErr: (...args: unknown[]) => collector!.accept(args),
      locateFile: (name: string) => {
        check(name === f.engine.wasm.file, 'POLY_NO_EXTRA_RESOURCE');
        return artifact.wasmPath;
      },
    });
    l.handles.module.returned++;
    check(
      M.mj_version() === 4000000 &&
        M.mj_versionString() === '4.0.0' &&
        typeof M.mj_fwdPosition === 'function' &&
        typeof M.mj_geomDistance === 'function' &&
        typeof M.DoubleBuffer === 'function',
      'POLY_EXACT_BINDINGS',
    );
    collector.endStartup();
    phase = 'POSITION_DISPATCH';
    const acquired = acquireTraceCases(M, l, journal, collector, historical.baseline),
      streams = collector.complete();
    check(
      same(
        streams.map((v) => v.lines),
        historical.streams.map((v) => v.lines),
      ),
      'POLY_EXACT_ALL_FOUR_PRIOR_V1_BYTES',
    );
    polyFinalLedger(l);
    const prior = interpretTraces(streams, acquired.parity),
      observation = interpretPoly(collector.polyComplete(), streams, acquired.parity);
    journal.write({
      kind: 'polytope-evidence',
      publicParity: true,
      v1ByteParity: true,
      prior,
      observation,
      scope: 'NO_PHYSICAL_REASSESSMENT_NO_REPAIR',
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
          traceStream: collector?.snapshot() ?? null,
          polytopeStream: collector?.polySnapshot() ?? null,
          physical: 'NOT_REASSESSED_HISTORICAL_FAIL_UNCHANGED',
          causal: 'HISTORICAL_GAP_UNCHANGED',
          formal: 'D01_D02_OPEN',
        },
        true,
      );
    } catch (error) {
      if (first) l.cleanupErrors.push('polytope-footer: ' + String(error));
      else first = error;
    } finally {
      try {
        journal.close();
      } catch (error) {
        if (first) l.cleanupErrors.push('polytope-close: ' + String(error));
        else first = error;
      }
    }
  }
  if (first) throw first;
}
it.runIf(process.env.ASA_EPA_POLYTOPE_VERIFY_INPUTS === 'verify')(
  'verifies V2 whole historical source/raw/audits, double C inverse and immutable native bytes without importing glue',
  () => {
    readInputs(process.env);
    polyHistorical(process.env);
  },
);

// Pure binary producer mirrors only the explicit framing, never C struct padding.
function encodePoly(records: PolyRecord[]) {
  const parts: Buffer[] = [];
  const i32 = (v: number[]) => {
    const b = Buffer.alloc(v.length * 4);
    v.forEach((x, i) => b.writeInt32LE(x, i * 4));
    return b;
  };
  for (const r of records) {
    parts.push(Buffer.from([r.tag]), i32(r.header));
    if (r.tag === 1) {
      parts.push(Buffer.from(r.scalars.f64le, 'hex'));
      for (const v of r.vertices)
        parts.push(i32([v.id, ...v.indices, v.flags]), Buffer.from(v.words.f64le, 'hex'));
      for (const f of r.faces)
        parts.push(
          i32([f.id, f.packed, ...f.adj, f.index, f.flags, 0]),
          Buffer.from(f.words.f64le, 'hex'),
        );
      parts.push(i32(r.map));
      for (const h of r.horizon) parts.push(i32(h));
    }
  }
  return Buffer.concat(parts);
}
function polyLines(raw: Buffer, query: number, recordCount: number, error = 0) {
  const n = Math.ceil(raw.length / 1024),
    lines = Array.from({ length: n }, (_, i) => {
      const b = raw.subarray(i * 1024, (i + 1) * 1024);
      return (
        p.polytope.prefix +
        ' q=' +
        query +
        ' chunk=' +
        i +
        ' bytes=' +
        b.length +
        ' total=' +
        raw.length +
        ' hex=' +
        b.toString('hex')
      );
    });
  lines.push(
    p.polytope.prefix +
      '_END q=' +
      query +
      ' chunks=' +
      n +
      ' bytes=' +
      raw.length +
      ' error=' +
      error +
      ' records=' +
      recordCount,
  );
  return lines;
}
function polyMockRecords(index: number) {
  const v = decodeTrace(p.frozenV1Lines[index]!, index),
    query = index + 1,
    target = v.ints[16]!,
    nv = v.ints[15]!,
    nm = v.ints[17]!,
    slot = v.ints[14]!;
  const vertices: PolyVertex[] = Array.from({ length: nv }, (_, id) => ({
    id,
    indices: [0, 0],
    flags: 7,
    words: packet([0, 0, 1, 0, 0, 1, 0, 0, 0]),
  }));
  for (let i = 0; i < 3; i++)
    vertices[v.ints[18 + i]!] = {
      id: v.ints[18 + i]!,
      indices: v.ints.slice(21 + 2 * i, 23 + 2 * i),
      flags: 7,
      words: packet(v.words.values.slice(7 + 9 * i, 16 + 9 * i)),
    };
  const faces: PolyFace[] = Array.from({ length: target }, (_, id) => ({
    id,
    packed: 0 + (1 << 10) + (2 << 20),
    adj: [0, 0, 0],
    index: -1,
    flags: 31,
    words: packet([0, 0, 2 * Math.sqrt(v.words.values[6]!), 4 * v.words.values[6]!]),
  }));
  const chosen = target - 1;
  faces[chosen] = {
    id: chosen,
    packed: v.ints[13]!,
    adj: [0, 0, 0],
    index: slot,
    flags: 31,
    words: packet(v.words.values.slice(3, 7)),
  };
  let seq = 0;
  const result: PolyRecord[] = [];
  const meta = Array(16).fill(0) as number[];
  meta[0] = query;
  meta[1] = ++seq;
  meta[2] = 1;
  meta[4] = 4;
  result.push({ tag: 2, header: meta });
  let currentFaces = 4;
  const snapshot = (kind: number, k: number, vc: number, fc: number, map: number[], reason = 0) => {
    const h = Array(32).fill(0) as number[];
    [
      query,
      ++seq,
      kind,
      0,
      k,
      kind === 4 ? 7 : kind === 2 || kind === 3 || kind === 5 ? 3 : 1,
      vc,
      fc,
      map.length,
      0,
      map[slot] ?? map[0] ?? -1,
      k ? 0 : -1,
      kind === 2 ? vc - 1 : -1,
      -1,
      reason,
      1,
      k + 1,
      1,
      100,
      105,
      600,
      600,
      89,
    ].forEach((x, i) => (h[i] = x));
    if (kind === 4) h[13] = fc - 1;
    if (kind === 0) {
      h[4] = -1;
      h[5] = 0;
      h[16] = 0;
      h[10] = -1;
    }
    const fs = structuredClone(faces.slice(0, fc));
    for (const f of fs) f.index = map.indexOf(f.id);
    const selected = h[10]! >= 0 ? fs[h[10]!]! : fs[0]!;
    const s = Array(16).fill(0) as number[];
    s[3] = selected.words.values[3]!;
    s[4] = 1;
    s[5] = 1;
    s[6] = Math.sqrt(s[3]!);
    s[7] = kind === 5 || k === 4 ? s[6]! + 5e-9 : s[6]! + 1e-6;
    result.push({
      tag: 1,
      header: h,
      scalars: packet(s),
      vertices: structuredClone(vertices.slice(0, vc)),
      faces: fs,
      map,
      horizon: [],
    });
  };
  snapshot(0, -1, 4, currentFaces, [0]);
  for (let k = 0; k < 5; k++) {
    const final = k === 4,
      map = final
        ? Array.from({ length: nm }, (_, i) => (i === slot ? chosen : i < slot ? i : i - 1))
        : [0];
    snapshot(1, k, 4 + k, currentFaces, map);
    snapshot(2, k, 5 + k, currentFaces, map);
    if (k < 4) {
      snapshot(3, k, 5 + k, currentFaces, map);
      const add = k === 3 ? target - currentFaces : Math.min(3, target - currentFaces);
      for (let j = 0; j < add; j++) {
        currentFaces++;
        snapshot(4, k, 5 + k, currentFaces, [0]);
      }
    }
  }
  const map = Array.from({ length: nm }, (_, i) => (i === slot ? chosen : i < slot ? i : i - 1));
  snapshot(5, 4, nv, target, map, 3);
  const before = encodePoly(result).length,
    footer = Array(16).fill(0) as number[];
  [
    query,
    ++seq,
    0,
    0,
    0,
    0,
    0,
    0,
    result.filter((r) => r.tag === 1).length,
    5,
    3,
    1,
    before,
  ].forEach((x, i) => (footer[i] = x));
  result.push({ tag: 3, header: footer });
  return result;
}
function polyMockLines(index: number) {
  const r = polyMockRecords(index);
  return polyLines(encodePoly(r), index + 1, r.length);
}
it('V2 proves exact bounded snapshot/U8 framing and durable duplication budgets without claiming N100 full snapshots fit', () => {
  expect(polyBudget()).toEqual({
    snapshot: 4009,
    count: 46,
    encoded: 194654,
    framed: 422144,
    external: 12058624,
  });
  expect(p.polytope.profile).toEqual({
    visits: 8,
    vertices: 16,
    faces: 24,
    map: 24,
    horizon: 89,
    snapshots: 46,
    metadata: 16,
  });
  const code = readFileSync(join(dirname(sourcePath), p.patch.file), 'utf8');
  expect(sha(code)).toBe(p.patch.sha256);
  expect(Buffer.byteLength(code)).toBe(p.patch.bytes);
  expect(code).toContain('sizeof(Vertex) == 80 && sizeof(Face) == 56');
  expect(code).toContain('asa_poly_defined(pt, ret == 0, 0)');
  expect(code).toContain('asa_poly_meta(1, pt, 4)');
  expect(code).toContain('asa_poly_reset(pt)');
  expect(code).not.toMatch(/^\+.*\b(?:malloc|calloc|realloc|mj_step|mj_forward|mjc_support)\s*\(/m);
});
it('V2 denies ambiguous/consumed modes before even receipt creation/import and keeps default dispatch skipped', async () => {
  expect(() => polyAdmission({})).toThrow('EXACT_POLYTOPE_OPT_IN');
  expect(() => polyAdmission({ ASA_EPA_POLYTOPE_NATIVE: p.polytope.token })).not.toThrow();
  for (const key of [
    'ASA_CCD_TRACE_NATIVE',
    'ASA_STATIC_WITNESS_NATIVE',
    'ASA_TT_UNION_RECOVERY_NATIVE',
    'ASA_TT_SPHERE_NATIVE',
    'ASA_OTHER_ACQUIRE',
  ]) {
    const env = { ASA_EPA_POLYTOPE_NATIVE: p.polytope.token, [key]: 'consumed' };
    expect(() => polyAdmission(env)).toThrow('POLYTOPE_AMBIGUOUS_OR_CONSUMED');
    await expect(polyNativeRun(env)).rejects.toThrow('POLYTOPE_AMBIGUOUS_OR_CONSUMED');
  }
});
it('V2 preserves actual signed-zero packets through complete binary and on-disk raw framing, rejecting bits/labels/count tampering', () => {
  const records = polyMockRecords(0),
    seed = records.find((v): v is PolySnapshot => v.tag === 1)!;
  seed.scalars = packet([-0, ...seed.scalars.values.slice(1)]);
  const raw = encodePoly(records),
    lines = polyLines(raw, 1, records.length),
    dir = mkdtempSync(join(tmpdir(), 'asa-poly-codec-')),
    file = join(dir, 'roundtrip.json');
  try {
    const fd = openSync(file, 'wx');
    try {
      writeSync(fd, stringifySigned(lines));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    const decoded = parsePolyLines(parseSigned(readFileSync(file, 'utf8')) as string[], 1);
    expect(decoded.raw.equals(raw)).toBe(true);
    const first = decoded.records.find((v): v is PolySnapshot => v.tag === 1)!;
    expect(Object.is(first.scalars.values[0], -0)).toBe(true);
    for (const mutate of [
      (v: string[]) => {
        v[0] = v[0]!.replace('q=1', 'q=2');
      },
      (v: string[]) => {
        v[0] = v[0]!.replace('chunk=0', 'chunk=1');
      },
      (v: string[]) => {
        v.pop();
      },
      (v: string[]) => {
        v.splice(0, 0, v[0]!);
      },
      (v: string[]) => {
        v[v.length - 1] = v.at(-1)!.replace('error=0', 'error=4');
      },
      (v: string[]) => {
        v[0] = v[0]!.replace(/hex=../, 'hex=ff');
      },
    ]) {
      const forged = [...lines];
      mutate(forged);
      expect(() => parsePolyLines(forged, 1)).toThrow();
    }
    expect(() => decodePoly(raw.subarray(0, -1), 1)).toThrow('POLY_TRUNCATED');
    expect(() => parseSigned('{"x":"float64:NaN"}')).toThrow('SIGNED_ZERO_LABEL');
  } finally {
    unlinkSync(file);
    rmdirSync(dir);
  }
});
it('V2 represents partial attach safely and separates seed fallback reset epochs before monotonic EPA state', () => {
  const records = polyMockRecords(0),
    s = records.find((v): v is PolySnapshot => v.tag === 1)!;
  s.faces[0]!.flags = 3;
  s.faces[0]!.index = 0;
  s.faces[0]!.words = packet([0, 0, 0, 0]);
  expect(() => decodePoly(encodePoly(records), 1)).not.toThrow();
  s.faces[0]!.words = packet([1, 0, 0, 0]);
  expect(() => decodePoly(encodePoly(records), 1)).toThrow('POLY_UNDEFINED_PROJECTION');
  s.faces[0]!.words = packet([0, 0, 0, 1]);
  expect(() => decodePoly(encodePoly(records), 1)).toThrow('POLY_UNDEFINED_DIST2');
  s.faces[0]!.words = packet([0, 0, 0, 0]);
  s.faces[0]!.index = -1;
  expect(() => decodePoly(encodePoly(records), 1)).toThrow('POLY_UNDEFINED_INDEX');
  const code = readFileSync(join(dirname(sourcePath), p.patch.file), 'utf8');
  expect(code.indexOf('pt->horizon.nedges > 89')).toBeLessThan(
    code.indexOf('for (int i = 0; i < pt->horizon.nedges; i++)'),
  );
});
function polyAssembledMock(collector: PolyCollector, bad?: 'query' | 'overflow' | 'incomplete') {
  const stub = mockAssembledTrace(),
    base = stub.M.mj_geomDistance;
  stub.M.mj_geomDistance = (...args) => {
    const value = base(...args),
      index = stub.queryCount() - 1;
    collector.accept([p.frozenV1Lines[index]!]);
    const lines = polyMockLines(index);
    if (bad === 'query' && index === 1) lines[0] = lines[0]!.replace('q=2', 'q=1');
    if (bad === 'incomplete' && index === 0) lines.pop();
    if (bad === 'overflow' && index === 0) lines[0] = 'ASA_EPA_POLYTOPE_V2 ' + 'x'.repeat(524288);
    for (const line of lines) collector.accept([line]);
    return value;
  };
  return stub;
}
it('V2 uses the SAME live acquisition hooks, cleanup and all8 public/V1 comparisons before semantic interpretation', () => {
  const sink = memorySink(),
    collector = new PolyCollector(sink),
    mock = polyAssembledMock(collector),
    l = ledger();
  l.handles.module.attempted = l.handles.module.returned = 1;
  collector.endStartup();
  const acquired = acquireTraceCases(mock.M, l, sink, collector, assembledBaseline()),
    v1 = collector.complete();
  expect(acquired.parity.admitted()).toHaveLength(8);
  expect(v1.map((v) => v.lines[0])).toEqual(p.frozenV1Lines);
  expect(interpretPoly(collector.polyComplete(), v1, acquired.parity)).toHaveLength(4);
  expect(replay(acquired.actual, false)).toHaveLength(2);
  expect(l.position).toEqual({ attempted: 4, returned: 4 });
  expect(l.distance).toEqual({ attempted: 4, returned: 4 });
  for (const [kind, c] of Object.entries(l.handles))
    if (kind !== 'module') expect(c.deleted).toBe(c.returned);
  expect(sink.events.filter((v) => (v as ReplayRecord).kind === 'case-finish')).toHaveLength(2);
});
it('V2 stops before next API on wrong active query, incomplete stream or overflow while preserving first records and cleanup', () => {
  for (const bad of ['query', 'incomplete', 'overflow'] as const) {
    const sink = memorySink(),
      collector = new PolyCollector(sink),
      mock = polyAssembledMock(collector, bad),
      l = ledger();
    l.handles.module.attempted = l.handles.module.returned = 1;
    collector.endStartup();
    expect(() => acquireTraceCases(mock.M, l, sink, collector, assembledBaseline())).toThrow(
      /POLY_/,
    );
    expect(l.distance.attempted).toBe(bad === 'query' ? 2 : 1);
    expect(l.position.attempted).toBe(1);
    for (const [kind, c] of Object.entries(l.handles))
      if (kind !== 'module') expect(c.deleted).toBe(c.returned);
    expect(sink.events.some((v) => (v as ReplayRecord).kind === 'case-finish')).toBe(true);
    expect(sink.events.some((v) => (v as { kind: string }).kind === 'polytope-api-stream')).toBe(
      true,
    );
  }
});
it('V2 independently replays ordered minimum including ties, detects forged state/selection and leaves geometric defects observable', () => {
  const sink = memorySink(),
    collector = new PolyCollector(sink),
    mock = polyAssembledMock(collector),
    l = ledger();
  l.handles.module.attempted = l.handles.module.returned = 1;
  collector.endStartup();
  const acquired = acquireTraceCases(mock.M, l, sink, collector, assembledBaseline()),
    contexts = collector.polyComplete(),
    v1 = collector.complete();
  const observed = interpretPoly(contexts, v1, acquired.parity);
  expect(observed[0]!.finalHull.issues.length).toBeGreaterThan(0);
  const mutate = (edit: (r: PolyRecord[]) => void) => {
    const cs = structuredClone(contexts),
      r = polyMockRecords(0);
    edit(r);
    cs[0]!.lines = polyLines(encodePoly(r), 1, r.length);
    return () => interpretPoly(cs, v1, acquired.parity);
  };
  expect(
    mutate((r) => {
      const s = r.find((v): v is PolySnapshot => v.tag === 1 && v.header[2] === 1)!;
      s.header[10] = 1;
    }),
  ).toThrow('POLY_STRICT_ORDERED_MIN');
  expect(
    mutate((r) => {
      const s = r.find((v): v is PolySnapshot => v.tag === 1 && v.header[2] === 2)!;
      s.vertices[0]!.words.values[0] = 7;
      s.vertices[0]!.words = packet(s.vertices[0]!.words.values);
    }),
  ).toThrow('POLY_IMMUTABLE_VERTEX');
  const unready = new PublicParity(assembledBaseline());
  expect(() => interpretPoly(contexts, v1, unready)).toThrow(
    'NO_TRACE_INTERPRETATION_BEFORE_PUBLIC_PARITY',
  );
});
it('V2 replays seed epoch reset chronology and strict first-in-map ties without claiming discarded trial arrays', () => {
  const r = polyMockRecords(0),
    snap = r.find((v): v is PolySnapshot => v.tag === 1 && v.header[2] === 1)!;
  const f0 = snap.faces[0]!,
    f1 = snap.faces[1]!;
  f0.index = 0;
  f1.index = 1;
  snap.map = [0, 1];
  snap.header[11] = -1;
  expect(polyOrderedMinimum(snap).face).toBe(0);
  snap.map = [1, 0];
  f0.index = 1;
  f1.index = 0;
  expect(polyOrderedMinimum(snap).face).toBe(1);
  const initial = r[0] as PolyMeta,
    reset = structuredClone(initial);
  reset.header[1] = 2;
  reset.header[2] = 2;
  const next = structuredClone(initial);
  next.header[1] = 3;
  next.header[3] = 1;
  next.header[4] = 3;
  for (const v of r) if (v.tag === 1) v.header[3] = 1;
  polySeedEpochs([initial, reset, next, ...r.slice(1)]);
  expect(() => polySeedEpochs([initial, next, ...r.slice(1)])).toThrow('POLY_SEED_EPOCH');
  expect(() => polySeedEpochs([initial, ...r.slice(1)])).toThrow('POLY_COMMITTED_EPOCH');
});
it('V2 explicit exit predicates retain first/later attach distinction and reject invalid reason claims', () => {
  const source = polyMockRecords(0).filter((r): r is PolySnapshot => r.tag === 1),
    base = structuredClone(source.at(-1)!);
  const make = (reason: number) => {
    const h = structuredClone(base);
    h.header[14] = reason;
    return h;
  };
  for (const reason of [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12]) {
    const last = make(reason),
      support = structuredClone(source.find((r) => r.header[2] === 2)!);
    support.header[4] = last.header[4];
    const h = last.header,
      s = last.scalars.values;
    if (reason === 1) {
      s[3] = 2;
      s[5] = 1;
    }
    if (reason === 2) s[3] = 0;
    if (reason === 3) {
      support.scalars = packet([0, 0, 0, 1, 1, 1, 1, 1 + 5e-9, 0, 0, 0, 0, 0, 0, 0, 0]);
    }
    if (reason === 4) {
      h[4] = 0;
      support.header[4] = 0;
      support.scalars = packet([0, 0, 0, 1, 0.5, 0.25, 1, 0.5, 0, 0, 0, 0, 0, 0, 0, 0]);
    }
    if (reason === 7) h[9] = 2;
    if (reason === 8) {
      h[7] = 599;
      h[9] = 2;
    }
    if (reason === 11) h[8] = 0;
    if (reason === 12) h[4] = 100;
    const extra = structuredClone(last);
    extra.header[2] = reason === 6 ? 3 : 4;
    extra.header[14] = reason;
    extra.scalars.values[8] = 0;
    expect(() => polyExitCheck([support, extra, last])).not.toThrow();
  }
  expect(() => polyExitCheck([make(10)])).toThrow('POLY_LATER_ZERO_MUST_REACH_EMPTY_MAP_BRANCH');
  const bad = make(3);
  bad.header[4] = 1;
  expect(() => polyExitCheck([bad])).toThrow('POLY_GAP_BRANCH');
});
function polyFinalLedger(l: Ledger) {
  check(
    same(l.position, { attempted: 4, returned: 4 }) &&
      same(l.distance, { attempted: 4, returned: 4 }) &&
      l.step1 === 0 &&
      l.step2 === 0 &&
      l.forward === 0 &&
      l.cleanupErrors.length === 0,
    'POLY_FINAL_EXACT_CALLS',
  );
  check(
    l.handles.module.attempted === 1 &&
      l.handles.module.returned === 1 &&
      l.handles.model.returned === 2 &&
      l.handles.data.returned === 2 &&
      l.handles.buffer.returned === 4,
    'POLY_FINAL_CREATION_CENSUS',
  );
  for (const [kind, c] of Object.entries(l.handles))
    if (kind !== 'module')
      check(
        c.attempted === c.returned && c.returned === c.deleteAttempted && c.returned === c.deleted,
        'POLY_FINAL_RELEASE_' + kind,
      );
}
function replayPolyRecords(
  all: ReplayRecord[],
  historical: { baseline: unknown[]; streams: TraceContext[] },
  sourceSha: string,
  fixtureSha: string,
) {
  const header = all.find((v) => v.kind === 'header') as
      (ReplayRecord & { schema?: string }) | undefined,
    finish = all.at(-1);
  check(
    header?.schema === p.schema && header.fixture?.sha256 === fixtureSha,
    'POLY_DISK_SOURCE_SCHEMA',
  );
  check(header.source?.sha256 === sourceSha, 'POLY_DISK_SOURCE_PIN');
  check(
    finish?.kind === 'finish' &&
      finish.runtime === 'COMPLETE' &&
      finish.diagnostic === 'COMPLETE' &&
      finish.acquisition === 'CONSUMED' &&
      finish.firstError === null,
    'POLY_DISK_COMPLETE',
  );
  check(finish.ledger, 'POLY_DISK_LEDGER');
  polyFinalLedger(finish.ledger);
  replay(all, false);
  const parity = new PublicParity(historical.baseline);
  const actual = all.filter((v) => v.kind === 'position' || v.kind === 'distance');
  actual.forEach((v) => parity.observe(v));
  parity.complete();
  const v1 = all
    .filter((v) => v.kind === 'trace-api-stderr')
    .map((v) => (v as unknown as { stream: TraceContext }).stream)
    .filter((v) => v.kind === 'distance');
  check(
    same(
      v1.map((v) => v.lines),
      historical.streams.map((v) => v.lines),
    ),
    'POLY_DISK_V1_EXACT',
  );
  interpretTraces(v1, parity);
  const contexts = all
    .filter((v) => v.kind === 'polytope-api-stream')
    .map((v) => (v as unknown as { context: PolyContext }).context);
  check(
    contexts.length === 8 &&
      contexts.every(
        (v, i) =>
          v.kind === actual[i]!.kind &&
          v.case === actual[i]!.case &&
          same(v.pair ?? null, actual[i]!.pair ?? null),
      ),
    'POLY_DISK_ALL_API_IDENTITIES',
  );
  const queries = contexts.filter((v) => v.kind === 'distance');
  for (const q of queries) {
    const rawLines = all
      .filter(
        (v) =>
          v.kind === 'polytope-stderr-raw' && (v as unknown as { query: number }).query === q.query,
      )
      .map((v) => (v as unknown as { text: string }).text);
    check(same(rawLines, q.lines), 'POLY_DISK_DUPLICATE_REPRESENTATION');
  }
  return interpretPoly(queries, v1, parity);
}
function replayPolyDisk(path: string, digest: string, env: NodeJS.ProcessEnv) {
  check(/^[0-9a-f]{64}$/.test(digest), 'POLY_REPLAY_EXPECTED_SHA256');
  const raw = readFileSync(path);
  check(
    raw.length <= p.polytope.layout.externalBytes && sha(raw) === digest,
    'POLY_DISK_RECEIPT_PIN',
  );
  const all = raw
    .toString()
    .trim()
    .split('\n')
    .map((v) => parseSigned(v)) as ReplayRecord[];
  return replayPolyRecords(
    all,
    polyHistorical(env),
    env.ASA_EPA_POLYTOPE_REPLAY_SOURCE_SHA256 ?? sha(readFileSync(sourcePath)),
    sha(readFileSync(polyFixturePath)),
  );
}
it.runIf(process.env.ASA_EPA_POLYTOPE_REPLAY_RECEIPT !== undefined)(
  'replays full exclusive V2 receipt from disk with original inputs, all public/V1 parity and geometry observations, no native',
  () => {
    expect(
      replayPolyDisk(
        required(process.env, 'ASA_EPA_POLYTOPE_REPLAY_RECEIPT'),
        required(process.env, 'ASA_EPA_POLYTOPE_REPLAY_SHA256'),
        process.env,
      ),
    ).toHaveLength(4);
  },
);
it('V2 executes the actual shared full receipt replay after disk roundtrip and rejects corrupted terminal resources and stream duplicates', () => {
  const sink = memorySink(),
    collector = new PolyCollector(sink),
    mock = polyAssembledMock(collector),
    l = ledger(),
    baseline = assembledBaseline();
  const source = sha('pure-source'),
    fixture = sha(readFileSync(polyFixturePath));
  sink.write({
    kind: 'header',
    schema: p.schema,
    source: { sha256: source },
    fixture: { sha256: fixture },
  });
  l.handles.module.attempted = l.handles.module.returned = 1;
  collector.endStartup();
  acquireTraceCases(mock.M, l, sink, collector, baseline);
  sink.write({
    kind: 'finish',
    runtime: 'COMPLETE',
    diagnostic: 'COMPLETE',
    acquisition: 'CONSUMED',
    firstError: null,
    ledger: l,
    polytopeStream: collector.polySnapshot(),
    traceStream: collector.snapshot(),
  });
  const dir = mkdtempSync(join(tmpdir(), 'asa-poly-full-replay-')),
    file = join(dir, 'full.jsonl');
  try {
    const fd = openSync(file, 'wx');
    try {
      for (const r of sink.events) writeSync(fd, stringifySigned(r) + '\n');
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    const all = readFileSync(file, 'utf8')
      .trim()
      .split('\n')
      .map((v) => parseSigned(v)) as ReplayRecord[];
    const historical = { baseline, streams: collector.complete() };
    expect(replayPolyRecords(all, historical, source, fixture)).toHaveLength(4);
    const forged = structuredClone(all);
    forged.at(-1)!.ledger!.handles.data.deleted--;
    expect(() => replayPolyRecords(forged, historical, source, fixture)).toThrow(
      'POLY_FINAL_RELEASE_data',
    );
    const bad = structuredClone(all);
    const r = bad.find((v) => v.kind === 'polytope-stderr-raw') as unknown as { text: string };
    r.text += 'x';
    expect(() => replayPolyRecords(bad, historical, source, fixture)).toThrow(
      'POLY_DISK_DUPLICATE_REPRESENTATION',
    );
  } finally {
    unlinkSync(file);
    rmdirSync(dir);
  }
});
it('V2 separates complete allocated support pool from ACTIVE hull vertices when convergence leaves an unincorporated outside support', () => {
  const points: Vec[] = [
    [1, 1, 1],
    [-1, -1, 1],
    [-1, 1, -1],
    [1, -1, -1],
    [4, 0, 0],
  ];
  const ids = [
    [0, 2, 1],
    [0, 1, 3],
    [0, 3, 2],
    [1, 2, 3],
  ];
  const faces: PolyFace[] = ids.map((v, id) => {
    const a = points[v[0]!]!,
      b = points[v[1]!]!,
      c = points[v[2]!]!,
      n = polyCross(polySub(b, a), polySub(c, a)),
      d = polyDot(n, a),
      nn = polyDot(n, n),
      pv = n.map((x) => (x * d) / nn);
    return {
      id,
      packed: v[0]! + (v[1]! << 10) + (v[2]! << 20),
      adj: [0, 1, 2, 3].filter((i) => i !== id),
      index: id,
      flags: 31,
      words: packet([...pv, (d * d) / nn]),
    };
  });
  const state: PolySnapshot = {
    tag: 1,
    header: Array(32).fill(0) as number[],
    scalars: packet(Array(16).fill(0) as number[]),
    vertices: points.map((v, id) => ({
      id,
      indices: [0, 0],
      flags: 7,
      words: packet([...v, ...v, 0, 0, 0]),
    })),
    faces,
    map: [0, 1, 2, 3],
    horizon: [],
  };
  const observed = polyHullObservation(state);
  expect(observed.activeVertexIDs).toEqual([0, 1, 2, 3]);
  expect(observed.unusedVertexIDs).toEqual([4]);
  expect(observed.issues).toEqual([]);
  expect(observed.closedConvexOriginCandidate).toBe(true);
  expect(observed.unusedSupportOutside[0]!.maxSignedPlaneDistance).toBeGreaterThan(0);
});
