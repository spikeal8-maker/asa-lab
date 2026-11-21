import { createHash } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import fixture from './editable-ramp-rolling.fixture.json';
import {
  createEditableRampGeometry,
  rampRiseForAngle,
  type RampVector,
} from './editable-ramp-geometry.js';

const f = fixture;
type Vec = RampVector;
type Handle = { delete(): void };
type Vector<T> = Handle & { size(): number; get(index: number): T | undefined };
type Model = Handle & {
  [key: string]: unknown;
  nq: number;
  nv: number;
  nbody: number;
  ngeom: number;
  njnt: number;
  npair: number;
  nmesh: number;
  opt: Record<string, unknown>;
};
type ContactHandle = Handle & {
  [key: string]: unknown;
  dim: number;
  exclude: number;
  efc_address: number;
  dist: number;
  includemargin: number;
  adhesion: number;
};
type Data = Handle & {
  [key: string]: unknown;
  time: number;
  ncon: number;
  nefc: number;
  nJ: number;
  contact: Vector<ContactHandle>;
  warning: Vector<Handle & { number: number; lastinfo: number }>;
};
type BufferHandle = Handle & { GetView(): unknown; GetElementCount(): number };
type Native = {
  MjModel: { from_xml_string(xml: string): Model };
  MjData: new (model: Model) => Data;
  DoubleBuffer: new (size: number) => BufferHandle;
  mj_versionString(): string;
  mj_version(): number;
  mj_isSparse(model: Model): number;
  mj_maxContact(model: Model, first: number, second: number, margin: number): number;
  mj_forward(model: Model, data: Data): void;
  mj_step1(model: Model, data: Data): void;
  mj_step2(model: Model, data: Data): void;
  mj_objectVelocity(
    model: Model,
    data: Data,
    type: number,
    id: number,
    buffer: BufferHandle,
    local: number,
  ): void;
  mj_contactForce(model: Model, data: Data, id: number, buffer: BufferHandle): void;
};
type State = { time: number; qpos: number[]; qvel: number[]; omega: number[] };
type Contact = {
  geom: number[];
  dim: number;
  exclude: number;
  address: number;
  dist: number;
  margin: number;
  point: number[];
  frame: number[];
  friction: number[];
  solref: number[];
  solrefFriction: number[];
  solimp: number[];
  surfacevel: number[];
  adhesion: number;
};
type Geometry = {
  contacts: Contact[];
  types: number[];
  ids: number[];
  velocity: number[];
  jacobian: number[];
};
type Interval = {
  pre: State;
  post: State;
  geometry: Geometry;
  forces: number[][];
  rowForces: number[];
  pointVelocities: number[][];
};
type Ledger = {
  created: number;
  deleted: number;
  step1: number;
  step1Returned: number;
  step2: number;
  step2Returned: number;
  cleanupErrors: string[];
};
const folder = dirname(fileURLToPath(import.meta.url));
const env = process.env;
const radius = f.sphere.radiusMeters;
const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const rad = (degrees: number) => (degrees * Math.PI) / 180;
const dot = (a: readonly number[], b: readonly number[]) =>
  a.reduce((sum, x, i) => sum + x * b[i]!, 0);
const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec, k: number): Vec => [a[0] * k, a[1] * k, a[2] * k];
const norm = (a: readonly number[]) => Math.hypot(...a);
const cross = (a: Vec, b: Vec): Vec => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const vec = (a: readonly number[], offset = 0): Vec => [a[offset]!, a[offset + 1]!, a[offset + 2]!];
function requireThat(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new Error(reason);
}
function near(a: number, b: number, tolerance: number, label: string) {
  requireThat(Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance, label);
}
function same(a: unknown, b: unknown, label: string) {
  requireThat(JSON.stringify(a) === JSON.stringify(b), label);
}
function rotate(q: readonly number[], v: Vec): Vec {
  const u = vec(q, 1);
  return add(v, add(scale(cross(u, v), 2 * q[0]!), scale(cross(u, cross(u, v)), 2)));
}
function numbers(value: unknown, length: number, kind: 'f64' | 'i32', label: string): number[] {
  requireThat(value instanceof Float64Array || value instanceof Int32Array, label + '_TYPE');
  requireThat(
    kind === 'f64' ? value instanceof Float64Array : value instanceof Int32Array,
    label + '_TYPE',
  );
  requireThat(value.length === length, label + '_WIDTH');
  const values = Array.from(value);
  requireThat(values.every(Number.isFinite), label + '_FINITE');
  return values;
}
const f64 = (value: unknown, length: number, label: string) => numbers(value, length, 'f64', label);
const i32 = (value: unknown, length: number, label: string) => numbers(value, length, 'i32', label);
function nativeState(data: Data): State {
  const qpos = f64(data.qpos, 7, 'QPOS'),
    qvel = f64(data.qvel, 6, 'QVEL');
  near(norm(qpos.slice(3)), 1, 1e-10, 'UNIT_NATIVE_QUATERNION');
  requireThat(Number.isFinite(data.time), 'NATIVE_TIME');
  return { time: data.time, qpos, qvel, omega: [...rotate(qpos.slice(3), vec(qvel, 3))] };
}
function owned<T extends Handle>(value: T, ledger: Ledger): T {
  requireThat(value && typeof value.delete === 'function', 'NATIVE_HANDLE');
  ledger.created++;
  return value;
}
function release(value: Handle, ledger: Ledger) {
  try {
    value.delete();
    ledger.deleted++;
  } catch (error) {
    ledger.cleanupErrors.push(String(error));
  }
}
function warnings(data: Data, ledger: Ledger) {
  const vector = owned(data.warning, ledger);
  try {
    requireThat(vector.size() === 7, 'WARNING_WIDTH');
    for (let i = 0; i < 7; i++) {
      const got = vector.get(i);
      requireThat(got, 'WARNING_HANDLE');
      const item = owned(got, ledger);
      try {
        requireThat(item.number === 0 && item.lastinfo === 0, 'NATIVE_WARNING');
      } finally {
        release(item, ledger);
      }
    }
  } finally {
    release(vector, ledger);
  }
  requireThat(ledger.cleanupErrors.length === 0, 'WARNING_RESOURCE_ERROR');
}
function localPoint(ramp: ReturnType<typeof modelInput>['ramp'], world: Vec): Vec {
  const shifted = sub(world, vec(f.ramp.originMeters));
  return [dot(shifted, ramp.upslope), dot(shifted, ramp.transverse), dot(shifted, ramp.normal)];
}
function modelInput(caseIndex: number) {
  const entry = f.cases[caseIndex];
  requireThat(entry, 'CASE_ID');
  const theta = rad(entry.angleDegrees);
  const ramp = createEditableRampGeometry({
    lengthMeters: f.ramp.lengthMeters,
    widthMeters: f.ramp.widthMeters,
    riseMeters: rampRiseForAngle(f.ramp.lengthMeters, theta),
    baseThicknessMeters: f.ramp.baseThicknessMeters,
    originMeters: vec(f.ramp.originMeters),
    headingRadians: rad(entry.headingDegrees),
  });
  const top = add(
    vec(f.ramp.originMeters),
    add(scale(ramp.upslope, f.ramp.releaseU), [0, 0, f.ramp.releaseU * Math.tan(theta)]),
  );
  const centre = add(add(top, scale(ramp.transverse, f.ramp.releaseV)), scale(ramp.normal, radius));
  const a =
    (9.81 * Math.sin(theta)) /
    (1 + f.sphere.principalInertiaKgM2 / (f.sphere.massKg * radius ** 2));
  const downhill = scale(ramp.tangent, -1);
  const acceleration = scale(downhill, a);
  const angularAcceleration = scale(cross(ramp.normal, downhill), a / radius);
  const xml = [
    '<mujoco model="asa_editable_ramp_sphere">',
    '<compiler angle="radian" inertiafromgeom="false" autolimits="false"/>',
    '<option timestep="0.0005" gravity="0 0 -9.81" integrator="implicitfast" solver="Newton" jacobian="dense" cone="elliptic" iterations="100" tolerance="1e-10" ls_iterations="50" ls_tolerance="0.01" noslip_iterations="20" noslip_tolerance="1e-12" impratio="1" ccd_iterations="100" ccd_tolerance="1e-8" density="0" viscosity="0" wind="0 0 0">',
    '<flag warmstart="enable" island="enable" refsafe="enable" nativeccd="enable" multiccd="enable" diagexact="enable" autoreset="disable" sleep="disable" override="disable" fwdinv="disable" invdiscrete="disable" energy="disable" ipc="disable" speculative="disable"/>',
    '</option>',
    '<default><geom contype="0" conaffinity="0" condim="3" margin="0" gap="0"/></default>',
    '<asset><mesh name="ramp-mesh" vertex="' +
      ramp.vertices.flat().join(' ') +
      '" face="' +
      ramp.faces.flat().join(' ') +
      '"/></asset>',
    '<worldbody><geom name="ramp" type="mesh" mesh="ramp-mesh"/>',
    '<body name="sphere-body" pos="' + centre.join(' ') + '"><freejoint name="sphere-free"/>',
    '<inertial pos="0 0 0" mass="0.1" diaginertia="0.0001 0.0001 0.0001"/>',
    '<geom name="sphere" type="sphere" size="0.05"/></body></worldbody>',
    '<contact><pair geom1="ramp" geom2="sphere" condim="3" margin="0" gap="0" friction="0.5 0.5 0 0 0" solref="0.004 1" solreffriction="0 0" solimp="0.99 0.99 0.001 0.5 2"/></contact>',
    '</mujoco>',
    '',
  ].join('\n');
  return { entry, ramp, centre, acceleration, angularAcceleration, xml, xmlSha256: hash(xml) };
}
function checkUnforced(model: Model, data: Data) {
  same(f64(data.qfrc_applied, 6, 'QFRC_APPLIED'), Array(6).fill(0), 'EXTERNAL_FORCE');
  same(
    f64(data.xfrc_applied, model.nbody * 6, 'XFRC_APPLIED'),
    Array(model.nbody * 6).fill(0),
    'EXTERNAL_WRENCH',
  );
}
function readback(M: Native, model: Model, data: Data, input: ReturnType<typeof modelInput>) {
  same(
    [model.nq, model.nv, model.nbody, model.ngeom, model.njnt, model.npair, model.nmesh],
    [7, 6, 2, 2, 1, 1, 1],
    'MODEL_DIMENSIONS',
  );
  requireThat(M.mj_isSparse(model) === 0, 'DENSE_MODEL');
  const options: Record<string, unknown> = {};
  for (const [key, expected] of Object.entries(f.profile)) {
    const actual = Array.isArray(expected)
      ? f64(model.opt[key], expected.length, 'OPTION_' + key)
      : model.opt[key];
    same(actual, expected, 'OPTION_' + key);
    options[key] = actual;
  }
  same(f64(model.opt.wind, 3, 'WIND'), [0, 0, 0], 'NO_WIND');
  for (const [key, width] of Object.entries({
    geom_surfacevel: model.ngeom * 6,
    geom_margin: model.ngeom,
    geom_gap: model.ngeom,
    geom_adhesion: model.ngeom,
    body_gravcomp: model.nbody,
    dof_damping: model.nv,
    dof_frictionloss: model.nv,
    dof_armature: model.nv,
    pair_margin: model.npair,
    pair_gap: model.npair,
    pair_adhesion: model.npair,
  }))
    same(f64(model[key], width, key), Array(width).fill(0), 'ZERO_' + key);
  same(i32(model.geom_type, 2, 'GEOM_TYPE'), [7, 2], 'GEOM_TYPES');
  same(i32(model.geom_bodyid, 2, 'GEOM_BODY'), [0, 1], 'GEOM_OWNERS');
  same(i32(model.geom_contype, 2, 'CONTYPE'), [0, 0], 'EXPLICIT_CONTACT_ONLY');
  same(i32(model.geom_conaffinity, 2, 'CONAFFINITY'), [0, 0], 'EXPLICIT_AFFINITY_ONLY');
  same(i32(model.jnt_type, 1, 'JOINT_TYPE'), [0], 'FREE_SPHERE');
  same(i32(model.jnt_qposadr, 1, 'QPOS_ADDRESS'), [0], 'QPOS_ADDRESS');
  same(i32(model.jnt_dofadr, 1, 'DOF_ADDRESS'), [0], 'DOF_ADDRESS');
  const pairGeoms = [
    i32(model.pair_geom1, 1, 'PAIR_GEOM1')[0]!,
    i32(model.pair_geom2, 1, 'PAIR_GEOM2')[0]!,
  ];
  same(
    [...pairGeoms].sort((a, b) => a - b),
    [0, 1],
    'PAIR_GEOMETRY',
  );
  same(i32(model.pair_dim, 1, 'PAIR_DIM'), [3], 'PAIR_DIM');
  same(f64(model.pair_friction, 5, 'PAIR_FRICTION'), f.contact.friction, 'PAIR_FRICTION');
  same(f64(model.pair_solref, 2, 'PAIR_SOLREF'), f.contact.solref, 'PAIR_SOLREF');
  same(f64(model.pair_solreffriction, 2, 'PAIR_SOLREFFRICTION'), [0, 0], 'PAIR_SOLREFFRICTION');
  same(f64(model.pair_solimp, 5, 'PAIR_SOLIMP'), f.contact.solimp, 'PAIR_SOLIMP');
  same(f64(model.body_mass, 2, 'BODY_MASS'), [0, f.sphere.massKg], 'EXACT_SPHERE_MASS');
  same(
    f64(model.body_inertia, 6, 'BODY_INERTIA'),
    [0, 0, 0, ...Array(3).fill(f.sphere.principalInertiaKgM2)],
    'EXACT_SPHERE_INERTIA',
  );
  same(f64(model.body_ipos, 6, 'BODY_IPOS'), Array(6).fill(0), 'CENTRAL_COM');
  const initial = nativeState(data);
  requireThat(initial.time === 0, 'FACTORY_TIME');
  initial.qpos.forEach((x, i) =>
    near(x, [...input.centre, 1, 0, 0, 0][i]!, f.limits.readback, 'FACTORY_QPOS'),
  );
  same(initial.qvel, Array(6).fill(0), 'FACTORY_QVEL');
  const capacity = M.mj_maxContact(model, 0, 1, 0);
  requireThat(
    Number.isSafeInteger(capacity) &&
      capacity > 0 &&
      capacity <= f.limits.contacts &&
      3 * capacity <= f.limits.rows,
    'PAIR_NATIVE_CAPACITY',
  );
  checkUnforced(model, data);
  return { options, capacity, initial };
}
function verifyWorldGeometry(model: Model, data: Data, input: ReturnType<typeof modelInput>) {
  const positions = f64(data.geom_xpos, model.ngeom * 3, 'GEOM_XPOS');
  const matrices = f64(data.geom_xmat, model.ngeom * 9, 'GEOM_XMAT');
  const starts = i32(model.mesh_vertadr, 1, 'MESH_VERTADR');
  const counts = i32(model.mesh_vertnum, 1, 'MESH_VERTNUM');
  requireThat(starts[0] === 0 && counts[0] === 8, 'MESH_TOPOLOGY');
  requireThat(
    model.mesh_vert instanceof Float32Array && model.mesh_vert.length === 24,
    'MESH_VERTEX_ARRAY',
  );
  const points = Array.from(model.mesh_vert);
  const nativeVertices = Array.from({ length: 8 }, (_, i): Vec =>
    add(vec(positions), [
      dot(matrices.slice(0, 3), vec(points, 3 * i)),
      dot(matrices.slice(3, 6), vec(points, 3 * i)),
      dot(matrices.slice(6, 9), vec(points, 3 * i)),
    ]),
  );
  // MuJoCo stores mesh vertices as float32 and centres/rotates the compiled mesh.
  for (const expected of input.ramp.vertices)
    requireThat(
      nativeVertices.some((p) => norm(sub(p, expected)) <= f.limits.meshVertexMeters),
      'COMPILED_FINITE_RAMP_GEOMETRY',
    );
  const sizes = f64(model.geom_size, model.ngeom * 3, 'GEOM_SIZE');
  near(sizes[3]!, radius, f.limits.readback, 'SPHERE_RADIUS');
  near(norm(sub(vec(positions, 3), input.centre)), 0, f.limits.readback, 'SPHERE_WORLD_CENTRE');
  return nativeVertices;
}
function capture(data: Data, ledger: Ledger, onCapture?: (geometry: Geometry) => void): Geometry {
  requireThat(
    Number.isSafeInteger(data.ncon) && data.ncon >= 0 && data.ncon <= f.limits.contacts,
    'CONTACT_COUNT',
  );
  requireThat(
    Number.isSafeInteger(data.nefc) && data.nefc >= 0 && data.nefc <= f.limits.rows,
    'ROW_COUNT',
  );
  requireThat(data.nJ === data.nefc * 6, 'DENSE_JACOBIAN_SIZE');
  const vector = owned(data.contact, ledger);
  const contacts: Contact[] = [];
  try {
    requireThat(vector.size() === data.ncon, 'CONTACT_VECTOR_WIDTH');
    for (let i = 0; i < data.ncon; i++) {
      const got = vector.get(i);
      requireThat(got, 'CONTACT_COPY');
      const c = owned(got, ledger);
      try {
        contacts.push({
          geom: i32(c.geom, 2, 'CONTACT_GEOM'),
          dim: c.dim,
          exclude: c.exclude,
          address: c.efc_address,
          dist: c.dist,
          margin: c.includemargin,
          point: f64(c.pos, 3, 'CONTACT_POS'),
          frame: f64(c.frame, 9, 'CONTACT_FRAME'),
          friction: f64(c.friction, 5, 'CONTACT_FRICTION'),
          solref: f64(c.solref, 2, 'CONTACT_SOLREF'),
          solrefFriction: f64(c.solreffriction, 2, 'CONTACT_SOLREFFRICTION'),
          solimp: f64(c.solimp, 5, 'CONTACT_SOLIMP'),
          surfacevel: f64(c.surfacevel, 3, 'CONTACT_SURFACEVEL'),
          adhesion: c.adhesion,
        });
      } finally {
        release(c, ledger);
      }
    }
  } finally {
    release(vector, ledger);
  }
  const result = {
    contacts,
    types: i32(data.efc_type, data.nefc, 'EFC_TYPES'),
    ids: i32(data.efc_id, data.nefc, 'EFC_IDS'),
    velocity: f64(data.efc_vel, data.nefc, 'EFC_VEL'),
    jacobian: f64(data.efc_J, data.nJ, 'EFC_J'),
  };
  onCapture?.(result);
  const rows = new Set<number>();
  for (const [index, c] of contacts.entries()) {
    same(
      [...c.geom].sort((a, b) => a - b),
      [0, 1],
      'SPHERE_RAMP_CONTACT_PAIR',
    );
    requireThat(
      c.dim === 3 &&
        Number.isSafeInteger(c.exclude) &&
        c.exclude >= 0 &&
        c.exclude <= 7 &&
        Number.isSafeInteger(c.address) &&
        c.address >= -1 &&
        Number.isFinite(c.dist) &&
        c.margin === 0 &&
        c.adhesion === 0,
      'CONTACT_METADATA',
    );
    same(c.friction, f.contact.nativeFrictionClamp, 'CONTACT_FRICTION');
    same(c.solref, f.contact.solref, 'CONTACT_SOLREF');
    same(c.solrefFriction, [0, 0], 'CONTACT_SOLREF_FRICTION');
    same(c.solimp, f.contact.solimp, 'CONTACT_SOLIMP');
    same(c.surfacevel, [0, 0, 0], 'CONTACT_SURFACE_VELOCITY');
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++)
        near(
          dot(vec(c.frame, 3 * i), vec(c.frame, 3 * j)),
          Number(i === j),
          f.limits.readback,
          'CONTACT_ORTHONORMAL',
        );
    near(
      norm(sub(cross(vec(c.frame), vec(c.frame, 3)), vec(c.frame, 6))),
      0,
      f.limits.readback,
      'CONTACT_RIGHT_HANDED',
    );
    if (c.address < 0) continue;
    requireThat(c.exclude === 0, 'ACTIVE_CONTACT_EXCLUDE');
    for (let k = 0; k < 3; k++) {
      const row = c.address + k;
      requireThat(
        row < result.types.length &&
          !rows.has(row) &&
          result.types[row] === 7 &&
          result.ids[row] === index,
        'CONTACT_ROW_IDENTITY',
      );
      rows.add(row);
    }
  }
  requireThat(rows.size === data.nefc, 'NO_ORPHAN_ROWS');
  requireThat(ledger.cleanupErrors.length === 0, 'CONTACT_RESOURCE_ERROR');
  return result;
}

function metrics(state: State, input: ReturnType<typeof modelInput>) {
  const p = vec(state.qpos),
    v = vec(state.qvel),
    omega = vec(state.omega),
    n = input.ramp.normal;
  const patch = add(v, cross(omega, scale(n, -radius)));
  const tangent = sub(patch, scale(n, dot(patch, n)));
  const foot = sub(p, scale(n, radius));
  const coordinates = localPoint(input.ramp, foot);
  return {
    clearance: dot(sub(p, vec(f.ramp.originMeters)), n) - radius,
    normalVelocity: dot(v, n),
    slip: norm(tangent),
    u: coordinates[0],
    v: coordinates[1],
  };
}
function physicalFrame(frame: Interval, input: ReturnType<typeof modelInput>) {
  const failures: string[] = [];
  const endpoints = [frame.pre, frame.post].filter(
    (s) => s.time >= f.schedule.analysisStartUs / 1e6 - f.limits.clockSeconds,
  );
  for (const endpoint of endpoints) {
    const got = metrics(endpoint, input);
    if (Math.abs(got.clearance) > f.limits.clearanceMeters) failures.push('SUPPORT_CLEARANCE');
    if (Math.abs(got.normalVelocity) > f.limits.normalVelocityMps) failures.push('NORMAL_VELOCITY');
    if (got.slip > f.limits.tangentSlipMps) failures.push('NO_SLIP');
    if (!(got.u > 0 && got.u < f.ramp.lengthMeters && Math.abs(got.v) < f.ramp.widthMeters / 2))
      failures.push('FINITE_FACE_DOMAIN');
  }
  if (endpoints.length === 0)
    return { failures, pre: metrics(frame.pre, input), post: metrics(frame.post, input) };
  let loaded = 0;
  for (const [index, c] of frame.geometry.contacts.entries()) {
    const sphereSign = c.geom[1] === 1 ? 1 : -1;
    const n = scale(vec(c.frame), sphereSign),
      force = frame.forces[index]!;
    if (norm(sub(n, input.ramp.normal)) > f.limits.normalVectorDistance)
      failures.push('SUPPORT_NORMAL');
    const facePoint = sub(vec(c.point), scale(n, c.dist / 2));
    const spherePoint = add(vec(c.point), scale(n, c.dist / 2));
    const local = localPoint(input.ramp, facePoint);
    if (
      Math.abs(local[2]) > f.limits.clearanceMeters ||
      !(
        local[0] > 0 &&
        local[0] < f.ramp.lengthMeters &&
        Math.abs(local[1]) < f.ramp.widthMeters / 2
      ) ||
      Math.abs(norm(sub(spherePoint, vec(frame.pre.qpos))) - radius) > f.limits.clearanceMeters
    )
      failures.push('NATIVE_CONTACT_WITNESS');
    if (force[0]! < 0) failures.push('NEGATIVE_NORMAL_FORCE');
    if (c.address >= 0 && force[0]! > 0) {
      const world = scale(
        add(
          scale(vec(c.frame), force[0]!),
          add(scale(vec(c.frame, 3), force[1]!), scale(vec(c.frame, 6), force[2]!)),
        ),
        sphereSign,
      );
      if (dot(world, input.ramp.normal) > 0) loaded++;
    }
  }
  if (loaded === 0) failures.push('NO_LOADED_SUPPORT');
  return { failures, pre: metrics(frame.pre, input), post: metrics(frame.post, input) };
}
function accelerationAssessment(
  samples: Map<number, State>,
  input: ReturnType<typeof modelInput>,
  physicalFailures: Map<string, number>,
) {
  if (physicalFailures.size) return { accepted: false, withheld: true, comparisons: [] };
  const comparisons = [];
  for (let i = 1; i < f.schedule.samplesUs.length; i++) {
    const earlier = f.schedule.samplesUs[i - 1]!,
      later = f.schedule.samplesUs[i]!;
    const a = samples.get(earlier),
      b = samples.get(later);
    requireThat(a && b, 'MISSING_ACCELERATION_SAMPLE');
    const dt = (later - earlier) / 1e6;
    const linear = scale(sub(vec(b.qvel), vec(a.qvel)), 1 / dt);
    const angular = scale(sub(vec(b.omega), vec(a.omega)), 1 / dt);
    const linearError = norm(sub(linear, input.acceleration));
    const angularError = norm(sub(angular, input.angularAcceleration));
    comparisons.push({
      fromUs: earlier,
      toUs: later,
      linear,
      angular,
      linearError,
      angularError,
      accepted:
        linearError <= f.limits.relativeAcceleration * norm(input.acceleration) &&
        angularError <= f.limits.relativeAcceleration * norm(input.angularAcceleration),
    });
  }
  return { accepted: comparisons.every((c) => c.accepted), withheld: false, comparisons };
}

function encodeInterval(frame: Interval): Buffer {
  const state = (s: State) => [s.time, ...s.qpos, ...s.qvel, ...s.omega];
  const words = [
    ...state(frame.pre),
    ...state(frame.post),
    frame.geometry.contacts.length,
    frame.geometry.types.length,
    frame.geometry.jacobian.length,
    ...frame.geometry.contacts.flatMap((c, index) => [
      ...c.geom,
      c.dim,
      c.exclude,
      c.address,
      c.dist,
      c.margin,
      ...c.point,
      ...c.frame,
      ...c.friction,
      ...c.solref,
      ...c.solrefFriction,
      ...c.solimp,
      ...c.surfacevel,
      c.adhesion,
      ...frame.forces[index]!,
      ...frame.pointVelocities[index]!,
    ]),
    ...frame.geometry.types,
    ...frame.geometry.ids,
    ...frame.geometry.velocity,
    ...frame.rowForces,
    ...frame.geometry.jacobian,
  ];
  const data = Buffer.alloc(words.length * 8);
  words.forEach((word, index) => {
    requireThat(Number.isFinite(word), 'NONFINITE_BINARY_EVIDENCE');
    data.writeDoubleLE(word, index * 8);
  });
  return data;
}
function decodeInterval(buffer: Buffer): Interval {
  requireThat(buffer.length >= 37 * 8 && buffer.length % 8 === 0, 'INTERVAL_ENCODING_SIZE');
  let cursor = 0;
  const take = (length: number) => {
    requireThat(
      Number.isSafeInteger(length) && length >= 0 && cursor + length * 8 <= buffer.length,
      'INTERVAL_ENCODING_BOUND',
    );
    const words = Array.from({ length }, (_, i) => buffer.readDoubleLE(cursor + i * 8));
    cursor += length * 8;
    requireThat(words.every(Number.isFinite), 'INTERVAL_ENCODING_FINITE');
    return words;
  };
  const state = (): State => ({ time: take(1)[0]!, qpos: take(7), qvel: take(6), omega: take(3) });
  const pre = state(),
    post = state();
  const [count, rows, j] = take(3) as [number, number, number];
  requireThat(
    Number.isSafeInteger(count) &&
      count >= 0 &&
      count <= f.limits.contacts &&
      Number.isSafeInteger(rows) &&
      rows >= 0 &&
      rows <= f.limits.rows &&
      j === rows * 6,
    'INTERVAL_ENCODING_LAYOUT',
  );
  const contacts: Contact[] = [],
    forces: number[][] = [],
    pointVelocities: number[][] = [];
  for (let i = 0; i < count; i++) {
    const geom = take(2),
      [dim, exclude, address, dist, margin] = take(5) as [number, number, number, number, number];
    contacts.push({
      geom,
      dim,
      exclude,
      address,
      dist,
      margin,
      point: take(3),
      frame: take(9),
      friction: take(5),
      solref: take(2),
      solrefFriction: take(2),
      solimp: take(5),
      surfacevel: take(3),
      adhesion: take(1)[0]!,
    });
    forces.push(take(6));
    pointVelocities.push(take(3));
  }
  const types = take(rows),
    ids = take(rows),
    velocity = take(rows),
    rowForces = take(rows),
    jacobian = take(j);
  requireThat(cursor === buffer.length, 'INTERVAL_ENCODING_TRAILING');
  return {
    pre,
    post,
    geometry: { contacts, types, ids, velocity, jacobian },
    forces,
    rowForces,
    pointVelocities,
  };
}
class Journal {
  private bytes = 0;
  private closed = false;
  constructor(private readonly fd: number) {}
  reserve(bytes: number) {
    requireThat(
      this.bytes + bytes + 65536 <= f.limits.rawBytes,
      'RAW_CAPTURE_CAPACITY_BEFORE_DISPATCH',
    );
  }
  write(record: unknown) {
    const raw = Buffer.from(
      JSON.stringify(record, (_, value: unknown) =>
        typeof value === 'number' && !Number.isFinite(value) ? String(value) : value,
      ) + '\n',
    );
    requireThat(this.bytes + raw.length <= f.limits.rawBytes, 'RAW_CAPTURE_LIMIT');
    let offset = 0;
    while (offset < raw.length) offset += writeSync(this.fd, raw, offset, raw.length - offset);
    this.bytes += raw.length;
  }
  finish() {
    if (this.closed) return;
    this.closed = true;
    try {
      fsyncSync(this.fd);
    } finally {
      closeSync(this.fd);
    }
  }
}
function openJournal(path: string) {
  requireThat(isAbsolute(path), 'ABSOLUTE_EXTERNAL_RECEIPT');
  const parent = realpathSync(dirname(path));
  const temporary = realpathSync(tmpdir());
  const rel = relative(temporary, parent);
  const checkout = resolve(folder, '../../..');
  const relCheckout = relative(checkout, parent);
  requireThat(
    parent === resolve(dirname(path)) &&
      rel !== '' &&
      !isAbsolute(rel) &&
      rel !== '..' &&
      !rel.startsWith('..' + sep) &&
      (isAbsolute(relCheckout) || relCheckout === '..' || relCheckout.startsWith('..' + sep)),
    'OS_TEMP_EXTERNAL_RECEIPT',
  );
  return new Journal(openSync(path, 'wx'));
}
function pinnedFile(path: string, pin: { bytes: number; sha256: string }) {
  const stat = lstatSync(path);
  requireThat(
    stat.isFile() && !stat.isSymbolicLink() && stat.size === pin.bytes,
    'PINNED_FILE_SIZE ' + path,
  );
  const raw = readFileSync(path);
  requireThat(hash(raw) === pin.sha256, 'PINNED_FILE_DIGEST ' + path);
  return raw;
}
function sourcePins() {
  const inputs = [
    ['editable-ramp-geometry.ts', 'ASA_RAMP_GEOMETRY_SHA256'],
    ['editable-ramp-rolling.fixture.json', 'ASA_RAMP_FIXTURE_SHA256'],
    ['editable-ramp-rolling.spec.ts', 'ASA_RAMP_SOURCE_SHA256'],
  ] as const;
  return inputs.map(([file, key]) => {
    const pin = env[key] ?? '';
    requireThat(/^[a-f0-9]{64}$/.test(pin), 'EXACT_SOURCE_ADMISSION ' + key);
    const raw = readFileSync(join(folder, file));
    requireThat(hash(raw) === pin, 'EXACT_SOURCE_SHA256 ' + file);
    return { file, bytes: raw.length, sha256: pin };
  });
}
function engineInputs() {
  const root = env['ASA_RAMP_ENGINE'] ?? '';
  requireThat(isAbsolute(root) && realpathSync(root) === resolve(root), 'EXACT_ENGINE_DIRECTORY');
  const files = Object.fromEntries(
    (['glue', 'wasm', 'declarations'] as const).map((key) => {
      const entry = f.engine[key];
      return [key, pinnedFile(join(root, entry.file), entry)];
    }),
  ) as Record<'glue' | 'wasm' | 'declarations', Buffer>;
  const licensePath = env['ASA_RAMP_LICENSE'] ?? '';
  requireThat(isAbsolute(licensePath), 'EXACT_LICENSE_PATH');
  pinnedFile(licensePath, f.engine.license);
  const build = pinnedFile(join(dirname(root), 'build-receipt.json'), f.engine.buildReceipt);
  const browser = pinnedFile(join(dirname(root), 'browser-receipt.json'), f.engine.browserReceipt);
  requireThat(
    JSON.parse(build.toString()).accepted === true &&
      JSON.parse(browser.toString()).accepted === true &&
      JSON.parse(browser.toString()).buildReceiptSha256 === f.engine.buildReceipt.sha256,
    'ENGINE_ADMISSION_RECEIPTS',
  );
  requireThat(files.wasm.subarray(0, 4).equals(Buffer.from([0, 97, 115, 109])), 'WASM_MAGIC');
  return { root, ...files };
}
async function loadNative(inputs: ReturnType<typeof engineInputs>): Promise<Native> {
  const file = join(inputs.root, f.engine.glue.file);
  pinnedFile(file, f.engine.glue);
  const loaded = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as {
    default(options: { wasmBinary: Buffer; locateFile(name: string): string }): Promise<Native>;
  };
  pinnedFile(file, f.engine.glue);
  const M = await loaded.default({
    wasmBinary: inputs.wasm,
    locateFile(name) {
      requireThat(name === 'mujoco.wasm', 'UNEXPECTED_NATIVE_RESOURCE');
      return join(inputs.root, name);
    },
  });
  requireThat(
    M.mj_version() === 4000000 && M.mj_versionString() === f.engine.version,
    'EXACT_NATIVE_VERSION',
  );
  return M;
}
function preVelocities(
  M: Native,
  model: Model,
  data: Data,
  buffer: BufferHandle,
  pre: State,
  geometry: Geometry,
) {
  M.mj_objectVelocity(model, data, 1, 1, buffer, 0);
  const twist = f64(buffer.GetView(), 6, 'NATIVE_WORLD_TWIST');
  twist.forEach((value, i) =>
    near(
      value,
      [...pre.omega, ...pre.qvel.slice(0, 3)][i]!,
      f.limits.velocityParity,
      'NATIVE_WORLD_TWIST_MAPPING',
    ),
  );
  return geometry.contacts.map((c) => {
    const sphereVelocity = add(
      vec(pre.qvel),
      cross(vec(pre.omega), sub(vec(c.point), vec(pre.qpos))),
    );
    const relative = scale(sphereVelocity, c.geom[1] === 1 ? 1 : -1);
    if (c.address >= 0)
      for (let k = 0; k < 3; k++) {
        near(
          dot(relative, vec(c.frame, 3 * k)),
          geometry.velocity[c.address + k]!,
          f.limits.velocityParity,
          'POINT_VELOCITY_ROW',
        );
        near(
          dot(geometry.jacobian.slice((c.address + k) * 6, (c.address + k + 1) * 6), pre.qvel),
          geometry.velocity[c.address + k]!,
          f.limits.velocityParity,
          'JACOBIAN_VELOCITY_ROW',
        );
      }
    return [...relative];
  });
}
function resolvedForces(
  M: Native,
  model: Model,
  data: Data,
  buffer: BufferHandle,
  geometry: Geometry,
  ledger: Ledger,
  onCapture: (geometry: Geometry) => void,
  onForce: (values: number[]) => void,
) {
  const after = capture(data, ledger, onCapture);
  same(after.contacts, geometry.contacts, 'PRE_POST_CONTACT_IDENTITIES');
  same(after.types, geometry.types, 'PRE_POST_ROW_TYPES');
  same(after.ids, geometry.ids, 'PRE_POST_ROW_IDS');
  const rowForces = f64(data.efc_force, after.types.length, 'SOLVED_ROW_FORCE');
  const forces = geometry.contacts.map((c, index) => {
    M.mj_contactForce(model, data, index, buffer);
    const values = f64(buffer.GetView(), 6, 'SOLVED_CONTACT_FORCE');
    onForce(values);
    if (c.address < 0) same(values, Array(6).fill(0), 'INACTIVE_CONTACT_FORCE');
    else {
      same(
        values.slice(0, 3),
        rowForces.slice(c.address, c.address + 3),
        'CONTACT_FORCE_ROW_PARITY',
      );
      same(values.slice(3), [0, 0, 0], 'DIM3_CONTACT_TORQUE');
    }
    return values;
  });
  return { forces, rowForces };
}
type Census = { step1: number; step1Returned: number; step2: number; step2Returned: number };
function executeWorld(
  M: Native,
  input: ReturnType<typeof modelInput>,
  repeat: number,
  journal: Journal,
  census: Census,
) {
  const ledger: Ledger = {
    created: 0,
    deleted: 0,
    step1: 0,
    step1Returned: 0,
    step2: 0,
    step2Returned: 0,
    cleanupErrors: [],
  };
  const handles: Handle[] = [];
  const take = <T extends Handle>(handle: T): T => {
    owned(handle, ledger);
    handles.unshift(handle);
    return handle;
  };
  const failures = new Map<string, number>();
  const digest = createHash('sha256');
  const samples = new Map<number, State>();
  let final: State | undefined;
  let inFlight: Record<string, unknown> | null = null;
  let runtimeError: unknown;
  let result: ReturnType<typeof accelerationAssessment> | undefined;
  try {
    const model = take(M.MjModel.from_xml_string(input.xml));
    const data = take(new M.MjData(model));
    const buffer = take(new M.DoubleBuffer(6));
    requireThat(buffer.GetElementCount() === 6, 'DOUBLE_BUFFER_SHAPE');
    const configuration = readback(M, model, data, input);
    M.mj_forward(model, data);
    const initial = nativeState(data);
    same(initial, configuration.initial, 'FACTORY_FORWARD_CHANGED_STATE');
    const vertices = verifyWorldGeometry(model, data, input);
    warnings(data, ledger);
    journal.write({
      kind: 'factory',
      caseId: input.entry.id,
      repeat,
      xml: input.xml,
      xmlSha256: input.xmlSha256,
      configuration,
      vertices,
      initial,
      analytic: { linear: input.acceleration, angular: input.angularAcceleration },
      ledger,
    });
    let previous = initial;
    for (let tick = 1; tick <= f.schedule.maxIntervalsPerWorld; tick++) {
      requireThat(
        ledger.cleanupErrors.length === 0 && ledger.step1 === tick - 1 && ledger.step2 === tick - 1,
        'WORLD_DISPATCH_BOUNDS',
      );
      // Maximum encoded numeric frame is bounded by the registered contact/row limits.
      const maximumWords = 37 + 46 * f.limits.contacts + 10 * f.limits.rows;
      journal.reserve(4 * Math.ceil((maximumWords * 8) / 3) + 2048);
      checkUnforced(model, data);
      inFlight = {
        tick,
        phase: 'before-step1',
        previous,
        counts: { ncon: data.ncon, nefc: data.nefc, nJ: data.nJ },
      };
      ledger.step1++;
      census.step1++;
      M.mj_step1(model, data);
      ledger.step1Returned++;
      census.step1Returned++;
      const pre = nativeState(data);
      inFlight.pre = pre;
      same(pre, previous, 'STEP1_CHANGED_NATIVE_STATE');
      const geometry = capture(data, ledger, (g) => {
        inFlight!.geometry = g;
      });
      requireThat(geometry.contacts.length <= configuration.capacity, 'COMPILED_PAIR_ALLOCATION');
      const pointVelocities = preVelocities(M, model, data, buffer, pre, geometry);
      requireThat(ledger.cleanupErrors.length === 0, 'PRE_CONTACT_CLEANUP_ERROR');
      inFlight.pointVelocities = pointVelocities;
      inFlight.phase = 'before-step2';
      ledger.step2++;
      census.step2++;
      M.mj_step2(model, data);
      ledger.step2Returned++;
      census.step2Returned++;
      inFlight.postReadback = {
        time: data.time,
        qpos: Array.from(data.qpos as Float64Array),
        qvel: Array.from(data.qvel as Float64Array),
        efcForce: Array.from(data.efc_force as Float64Array),
      };
      const post = nativeState(data);
      final = post;
      const observedForces: number[][] = [];
      inFlight.observedForces = observedForces;
      const { forces, rowForces } = resolvedForces(
        M,
        model,
        data,
        buffer,
        geometry,
        ledger,
        (g) => {
          inFlight!.afterGeometry = g;
        },
        (values) => observedForces.push(values),
      );
      inFlight.forces = forces;
      inFlight.rowForces = rowForces;
      const frame = { pre, post, geometry, pointVelocities, forces, rowForces };
      const raw = encodeInterval(frame);
      // Persist the complete interval before physical predicates or analytical assertions.
      journal.write({
        kind: 'interval',
        caseId: input.entry.id,
        repeat,
        tick,
        data: raw.toString('base64'),
      });
      digest.update(raw);
      inFlight = null;
      near(pre.time, (tick - 1) * f.profile.timestep, f.limits.clockSeconds, 'PRE_CLOCK');
      near(post.time, tick * f.profile.timestep, f.limits.clockSeconds, 'POST_CLOCK');
      checkUnforced(model, data);
      warnings(data, ledger);
      const physical = physicalFrame(frame, input);
      for (const reason of physical.failures) if (!failures.has(reason)) failures.set(reason, tick);
      const at = tick * f.schedule.stepUs;
      if (f.schedule.samplesUs.includes(at)) samples.set(at, post);
      previous = post;
    }
    result = accelerationAssessment(samples, input, failures);
    journal.write({
      kind: 'world-assessment',
      caseId: input.entry.id,
      repeat,
      physical: failures.size === 0 && result.accepted ? 'PASS' : 'FAIL',
      failures: Array.from(failures),
      acceleration: result,
      streamSha256: digest.copy().digest('hex'),
      final,
      ledger,
    });
  } catch (error) {
    runtimeError = error;
    journal.write({
      kind: 'world-error',
      caseId: input.entry.id,
      repeat,
      error: String(error),
      partial: inFlight,
      final: final ?? null,
      ledger,
    });
  } finally {
    for (const handle of handles) release(handle, ledger);
    journal.write({ kind: 'cleanup', caseId: input.entry.id, repeat, ledger });
  }
  requireThat(
    ledger.created === ledger.deleted && ledger.cleanupErrors.length === 0,
    'NATIVE_RESOURCE_LEAK',
  );
  if (runtimeError) throw runtimeError;
  requireThat(
    result &&
      ledger.step1 === 2000 &&
      ledger.step1Returned === 2000 &&
      ledger.step2 === 2000 &&
      ledger.step2Returned === 2000,
    'WORLD_COMPLETE_CENSUS',
  );
  return {
    caseId: input.entry.id,
    repeat,
    physical: failures.size === 0 && result.accepted ? 'PASS' : 'FAIL',
    streamSha256: digest.digest('hex'),
    failures: Array.from(failures),
    acceleration: result,
  };
}

function referenceState(input: ReturnType<typeof modelInput>, time: number): State {
  const omega = scale(input.angularAcceleration, time);
  const axis = scale(input.angularAcceleration, 1 / norm(input.angularAcceleration));
  const angle = (norm(input.angularAcceleration) * time * time) / 2;
  const position = add(input.centre, scale(input.acceleration, (time * time) / 2));
  return {
    time,
    qpos: [...position, Math.cos(angle / 2), ...scale(axis, Math.sin(angle / 2))],
    qvel: [...scale(input.acceleration, time), ...omega],
    omega: [...omega],
  };
}
function referenceInterval(caseIndex = 0): Interval {
  const input = modelInput(caseIndex);
  const pre = referenceState(input, 0.4),
    post = referenceState(input, 0.4005);
  const normal = input.ramp.normal;
  return {
    pre,
    post,
    geometry: {
      contacts: [
        {
          geom: [0, 1],
          dim: 3,
          exclude: 0,
          address: 0,
          dist: 0,
          margin: 0,
          point: [...sub(vec(pre.qpos), scale(normal, radius))],
          frame: [...normal, ...input.ramp.transverse, ...cross(normal, input.ramp.transverse)],
          friction: f.contact.nativeFrictionClamp,
          solref: f.contact.solref,
          solrefFriction: [0, 0],
          solimp: f.contact.solimp,
          surfacevel: [0, 0, 0],
          adhesion: 0,
        },
      ],
      types: [7, 7, 7],
      ids: [0, 0, 0],
      velocity: [0, 0, 0],
      jacobian: Array(18).fill(0),
    },
    forces: [[1, 0, 0, 0, 0, 0]],
    rowForces: [1, 0, 0],
    pointVelocities: [[0, 0, 0]],
  };
}
it('builds a finite closed convex ramp with consistent metric plan and profile at every registered heading', () => {
  for (let i = 0; i < f.cases.length; i++) {
    const { ramp } = modelInput(i);
    const theta = rad(f.cases[i]!.angleDegrees);
    near(ramp.angleRadians, theta, 1e-15, 'ANGLE');
    near(dot(ramp.normal, ramp.tangent), 0, 1e-15, 'ORTHOGONAL');
    near(norm(ramp.normal), 1, 1e-15, 'UNIT_NORMAL');
    const centroid = scale(
      ramp.vertices.reduce((a, b) => add(a, b), [0, 0, 0] as Vec),
      1 / 8,
    );
    let volume = 0;
    const edges = new Map<string, number>();
    for (const [a, b, c] of ramp.faces) {
      const va = ramp.vertices[a]!,
        vb = ramp.vertices[b]!,
        vc = ramp.vertices[c]!;
      const outward = cross(sub(vb, va), sub(vc, va));
      requireThat(dot(outward, sub(centroid, va)) < 0, 'OUTWARD_CONVEX_FACE');
      volume += dot(sub(va, centroid), cross(sub(vb, centroid), sub(vc, centroid))) / 6;
      for (const [u, v] of [
        [a, b],
        [b, c],
        [c, a],
      ]) {
        const key = [Math.min(u!, v!), Math.max(u!, v!)].join(':');
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
    expect([...edges.values()].every((n) => n === 2)).toBe(true);
    near(volume, ramp.volumeCubicMeters, 1e-14, 'CLOSED_VOLUME');
    ramp.top.forEach((point, k) => {
      near(dot(sub(point, vec(f.ramp.originMeters)), ramp.normal), 0, 1e-15, 'TOP_PLANE');
      expect(ramp.plan[k]).toEqual(point.slice(0, 2));
    });
    near(ramp.profile[2]![1], f.ramp.lengthMeters * Math.tan(theta), 1e-15, 'PROFILE_RISE');
  }
});
it('keeps horizontal length fixed for angle edits and supports a level translated plate without changing inputs', () => {
  const input = {
    lengthMeters: 2,
    widthMeters: 0.5,
    riseMeters: 0,
    baseThicknessMeters: 0.05,
    originMeters: [3, -2, 1] as Vec,
    headingRadians: Math.PI / 3,
  };
  const before = structuredClone(input);
  const plate = createEditableRampGeometry(input);
  expect(plate.angleRadians).toBe(0);
  expect(plate.normal).toEqual([-0, -0, 1]);
  near(plate.volumeCubicMeters, 0.05, 1e-15, 'LEVEL_VOLUME');
  for (const theta of [0, 0.1, 0.5, 1]) {
    const rise = rampRiseForAngle(input.lengthMeters, theta);
    const next = createEditableRampGeometry({ ...input, riseMeters: rise });
    near(next.angleRadians, theta, 1e-15, 'ANGLE_ROUNDTRIP');
    expect(next.profile[1]![0]).toBe(input.lengthMeters);
  }
  expect(input).toEqual(before);
});
it('rejects invalid or unrepresentable geometry and angle edits instead of silently changing the requested slope', () => {
  const valid = {
    lengthMeters: 2,
    widthMeters: 0.5,
    riseMeters: 0.2,
    baseThicknessMeters: 0.05,
    originMeters: [0, 0, 0] as Vec,
    headingRadians: 0,
  };
  for (const length of [0, -1, NaN, Infinity])
    expect(() => createEditableRampGeometry({ ...valid, lengthMeters: length })).toThrow();
  for (const width of [0, -1, NaN, Infinity])
    expect(() => createEditableRampGeometry({ ...valid, widthMeters: width })).toThrow();
  for (const rise of [-1, NaN, Infinity, 1e20])
    expect(() => createEditableRampGeometry({ ...valid, riseMeters: rise })).toThrow();
  for (const theta of [-0.1, Math.PI / 2, NaN, Infinity])
    expect(() => rampRiseForAngle(2, theta)).toThrow();
  expect(() => rampRiseForAngle(Number.MIN_VALUE, 0.5)).toThrow('UNREPRESENTABLE');
  expect(() => createEditableRampGeometry({ ...valid, originMeters: [1e300, 0, 0] })).toThrow();
  expect(() =>
    createEditableRampGeometry({
      ...valid,
      widthMeters: Number.MIN_VALUE,
      baseThicknessMeters: Number.MIN_VALUE,
    }),
  ).toThrow();
});
it('pins the required solid sphere, old support/slip thresholds, six-world schedule and unchanged specification', () => {
  expect(hash(readFileSync(resolve(folder, '../../../', f.specification.path)))).toBe(
    f.specification.sha256,
  );
  expect(f.cases.map((item) => [item.angleDegrees, item.headingDegrees])).toEqual([
    [10, 0],
    [5, 45],
    [15, -90],
  ]);
  near(
    f.sphere.principalInertiaKgM2,
    (2 * f.sphere.massKg * radius ** 2) / 5,
    1e-18,
    'SOLID_SPHERE_INERTIA',
  );
  expect([
    f.limits.tangentSlipMps,
    f.limits.clearanceMeters,
    f.limits.normalVelocityMps,
    f.limits.relativeAcceleration,
  ]).toEqual([0.001, 0.001, 0.001, 0.05]);
  expect(f.schedule.maxIntervalsPerWorld * f.schedule.repeats * f.cases.length).toBe(
    f.schedule.maxIntervalsTotal,
  );
  expect(f.schedule.stepUs * f.schedule.maxIntervalsPerWorld).toBe(f.schedule.durationUs);
  expect(f.engine.wasm.sha256).toBe(
    'd2caf28d73afa997a2534ef0aa940587757c16797653bf476c22994bd2405241',
  );
});
it('retains and decodes all lossless native words and rejects malformed or extra data', () => {
  const original = referenceInterval();
  const raw = encodeInterval(original);
  expect(decodeInterval(raw)).toEqual(original);
  expect(() => decodeInterval(raw.subarray(8))).toThrow();
  expect(() => decodeInterval(Buffer.concat([raw, Buffer.alloc(8)]))).toThrow('TRAILING');
  const bad = Buffer.from(raw);
  bad.writeDoubleLE(NaN, 0);
  expect(() => decodeInterval(bad)).toThrow('FINITE');
  const changed = structuredClone(original);
  changed.post.qvel[0]! += 1e-12;
  expect(hash(encodeInterval(changed))).not.toBe(hash(raw));
});
it('establishes support and complete tangent no-slip before reporting analytic linear and angular acceleration', () => {
  const input = modelInput(0),
    frame = referenceInterval();
  expect(physicalFrame(frame, input).failures).toEqual([]);
  const reversed = structuredClone(frame);
  reversed.geometry.contacts[0]!.geom = [1, 0];
  reversed.geometry.contacts[0]!.frame = frame.geometry.contacts[0]!.frame.map((x, i) =>
    i < 6 ? -x : x,
  );
  expect(physicalFrame(reversed, input).failures).toEqual([]);
  const samples = new Map(f.schedule.samplesUs.map((at) => [at, referenceState(input, at / 1e6)]));
  expect(accelerationAssessment(samples, input, new Map()).accepted).toBe(true);
  const slip = structuredClone(frame);
  slip.post.omega = [0, 0, 0];
  expect(physicalFrame(slip, input).failures).toContain('NO_SLIP');
  const noLoad = structuredClone(frame);
  noLoad.forces[0]![0] = 0;
  expect(physicalFrame(noLoad, input).failures).toContain('NO_LOADED_SUPPORT');
  const transverse = structuredClone(frame);
  transverse.post.qvel[1]! += 0.002;
  expect(physicalFrame(transverse, input).failures).toContain('NO_SLIP');
  expect(accelerationAssessment(samples, input, new Map([['NO_SLIP', 800]])).withheld).toBe(true);
  samples.get(800000)!.omega = [0, 0, 0];
  expect(accelerationAssessment(samples, input, new Map()).accepted).toBe(false);
});
it.skipIf(!env['ASA_RAMP_ENGINE'] || !env['ASA_RAMP_LICENSE'])(
  'checks externally supplied exact engine bytes and declarations without importing native code',
  () => {
    const inputs = engineInputs();
    expect(inputs.declarations.toString()).toContain('mj_step2(');
    expect(inputs.declarations.toString()).toContain('GetElementCount(): number');
  },
);

const nativeEnabled = env['ASA_RAMP_ROLLING_RUN'] === 'six-frozen-worlds-1071';
it.skipIf(!nativeEnabled)(
  'measures the six fresh native sphere worlds under the frozen finite-ramp oracle',
  async () => {
    const journal = openJournal(env['ASA_RAMP_OUTPUT'] ?? '');
    const census: Census = { step1: 0, step1Returned: 0, step2: 0, step2Returned: 0 };
    let initialized = false;
    let physical: string = 'UNRESOLVED';
    let recordedError: unknown;
    try {
      journal.write({
        kind: 'start',
        fixtureId: f.id,
        scope: f.scope,
        registration: f.registration,
        census,
      });
      const sources = sourcePins();
      const inputs = engineInputs();
      const cases = f.cases.map((_, index) => modelInput(index));
      journal.write({
        kind: 'inputs',
        sources,
        fixture: f,
        models: cases.map((item) => ({ id: item.entry.id, xml: item.xml, sha256: item.xmlSha256 })),
      });
      const M = await loadNative(inputs);
      initialized = true;
      const results = [];
      for (const input of cases) {
        for (let repeat = 0; repeat < f.schedule.repeats; repeat++)
          results.push(executeWorld(M, input, repeat, journal, census));
        same(
          results.at(-1)!.streamSha256,
          results.at(-2)!.streamSha256,
          'FRESH_WORLD_EXACT_REPEAT',
        );
      }
      requireThat(
        census.step1 === 12000 &&
          census.step1Returned === 12000 &&
          census.step2 === 12000 &&
          census.step2Returned === 12000,
        'ACQUISITION_COMPLETE_CENSUS',
      );
      physical = results.every((item) => item.physical === 'PASS') ? 'PASS' : 'FAIL';
      journal.write({
        kind: 'finish',
        runtime: 'COMPLETE',
        physical,
        initialized,
        census,
        results,
      });
    } catch (error) {
      recordedError = error;
      journal.write({
        kind: 'terminal-error',
        runtime: 'ERROR',
        physical: 'UNRESOLVED',
        initialized,
        census,
        error: String(error),
      });
    } finally {
      journal.finish();
    }
    if (recordedError) throw recordedError;
    expect(physical).toBe('PASS');
  },
  120000,
);
