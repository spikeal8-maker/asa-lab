// TEST_ONLY, no Worker/glue import or native initialization in this module.
// eslint-disable-next-line @nx/enforce-module-boundaries -- Canonical E1 TEST_ONLY selection explicitly reuses this unchanged, engine-free qualification helper.
import {
  createEditableRampGeometry,
  rampRiseForAngle,
} from '../../../../../../tests/robotics/field-core-qualification/editable-ramp-geometry';
import configuration from './scene.fixture.json';
import type {
  Fixture,
  XYZ,
  WXYZ,
  R5Landmark,
  R5RunCase,
  R5StandScene,
  Pose,
  Loaded,
  Span,
  Frame,
  NativeState,
} from './ramp.worker';

export { configuration, rampRiseForAngle };
export interface RampParameters {
  widthMeters: number;
  heightMeters: number;
  originXMeters: number;
  originYMeters: number;
}
export const BASELINE: RampParameters = configuration.baseline;
export const EDITED: RampParameters = configuration.edited;
export const RADIANS_PER_DEGREE = Math.PI / 180;
export const LENGTH = 0.8;
export const THICKNESS = 0.05;
export const SOURCE_FIXTURE = configuration.baselineFixture as unknown as Fixture;
export const MAX_PAIR_RAW = 253920000;
export const MAX_WORLD_RAW = MAX_PAIR_RAW / 2;
export function check(value: unknown, code: string): asserts value {
  if (!value) throw new Error(code);
}
export function parameters(input: unknown): RampParameters {
  check(input !== null && typeof input === 'object' && !Array.isArray(input), 'RAMP_PARAMETERS');
  const p = input as Record<string, unknown>;
  check(
    Object.keys(p).every((k) =>
      ['id', 'widthMeters', 'heightMeters', 'originXMeters', 'originYMeters'].includes(k),
    ),
    'RAMP_UNKNOWN_PARAMETER',
  );
  const out = {} as RampParameters;
  for (const key of ['widthMeters', 'heightMeters', 'originXMeters', 'originYMeters'] as const) {
    const value = p[key],
      range = configuration.limits[key];
    check(
      typeof value === 'number' &&
        Number.isFinite(value) &&
        value >= range[0]! &&
        value <= range[1]!,
      'RAMP_RANGE_' + key,
    );
    out[key] = Object.is(value, -0) ? 0 : value;
  }
  return out;
}
export function sameParameters(a: RampParameters, b: RampParameters): boolean {
  return (Object.keys(BASELINE) as (keyof RampParameters)[])
    .filter((k) => k in a && k in b)
    .every((k) => Object.is(a[k], b[k]));
}
export function rampGeometry(input: RampParameters) {
  const p = parameters(input);
  return createEditableRampGeometry({
    lengthMeters: LENGTH,
    widthMeters: p.widthMeters,
    riseMeters: p.heightMeters,
    baseThicknessMeters: THICKNESS,
    originMeters: [p.originXMeters, p.originYMeters, 0],
    headingRadians: 0,
  });
}
export function buildRampScene(source: Fixture, input: RampParameters) {
  const p = parameters(input),
    geometry = rampGeometry(p);
  const f = structuredClone(source);
  check(source.xml.join('\n') === SOURCE_FIXTURE.xml.join('\n'), 'RAMP_IMMUTABLE_SOURCE_XML');
  const x = p.originXMeters,
    y = p.originYMeters,
    H = p.heightMeters,
    W = p.widthMeters;
  const terrain = f.physical.terrain;
  terrain.halfY = W / 2;
  terrain.height = H;
  terrain.angleDeg = sameParameters(p, BASELINE)
    ? source.physical.terrain.angleDeg
    : (geometry.angleRadians * 180) / Math.PI;
  terrain.originXMeters = x;
  terrain.originYMeters = y;
  terrain.lower = [-0.8 + x, x];
  terrain.slope = [x, 0.8 + x];
  terrain.upper = [0.8 + x, 3 + x];
  terrain.vertices = geometry.vertices.map((v) => [...v] as XYZ);
  terrain.faces = geometry.faces.map((v) => [...v] as XYZ);
  f.physical.can.startX = x + 1.35;
  f.physical.can.initialComZ = H + f.physical.can.comHeight;
  // Entire original rover must be on the approach, not moved to accommodate a bad placement.
  check(
    -0.25 - 0.2 / 2 >= terrain.lower[0]! &&
      -0.25 + 0.2 / 2 < terrain.lower[1]! &&
      Math.abs(y) + 0.065 + 0.01 < W / 2 &&
      f.physical.can.startX - f.physical.can.radius > terrain.upper[0]! &&
      f.physical.can.startX + f.physical.can.radius < terrain.upper[1]!,
    'RAMP_FACTORY_SUPPORT_CLEARANCE',
  );
  const boom = f.physical.boom;
  const corners = [-1, 1].flatMap((a) =>
    [-1, 1].flatMap((b) =>
      [-1, 1].map((c) => {
        const r = rotate(boom.quatWxyz, [
          a * boom.halfSizeM[0],
          b * boom.halfSizeM[1],
          c * boom.halfSizeM[2],
        ]);
        return [
          -0.25 + boom.centerM[0] + r[0],
          boom.centerM[1] + r[1],
          0.06 + boom.centerM[2] + r[2],
        ] as XYZ;
      }),
    ),
  );
  const leading = Math.max(...corners.map((v) => v[0])) - x;
  const terrainCeiling = H * Math.max(0, Math.min(1, leading / LENGTH));
  check(
    Math.min(...corners.map((v) => v[2])) > terrainCeiling &&
      Math.max(...corners.map((v) => Math.abs(v[1] - y))) < W / 2 &&
      x + 1.35 - f.physical.can.radius > Math.max(...corners.map((v) => v[0])) &&
      0.06 - 0.016 > 0 &&
      -0.25 + 0.08 < x,
    'RAMP_WHOLE_FACTORY_BUMPER_CHASSIS_CLEARANCE',
  );
  if (!sameParameters(p, BASELINE)) {
    const replace = (fragment: string, next: string) => {
      const found = f.xml.filter((l) => l === fragment);
      check(found.length === 1, 'RAMP_XML_FRAGMENT');
      f.xml[f.xml.indexOf(fragment)] = next;
    };
    const original = SOURCE_FIXTURE.xml;
    const mesh = original.find((l) => l.startsWith('<asset><mesh name="incline"'))!;
    check(mesh, 'RAMP_XML_MESH');
    replace(
      mesh,
      '<asset><mesh name="incline" vertex="' +
        geometry.vertices.flat().join(' ') +
        '" face="' +
        geometry.faces.flat().join(' ') +
        '"/></asset>',
    );
    replace(
      original.find((l) => l.startsWith('<geom name="lower"'))!,
      `<geom name="lower" type="box" pos="${x - 0.4} ${y} -0.025" size="0.4 ${W / 2} 0.025"/>`,
    );
    replace(
      original.find((l) => l.startsWith('<geom name="upper"'))!,
      `<geom name="upper" type="box" pos="${x + 1.9} ${y} ${H - 0.025}" size="1.1 ${W / 2} 0.025"/>`,
    );
    replace(
      original.find((l) => l.startsWith('<body name="empty-can"'))!,
      `<body name="empty-can" pos="${f.physical.can.startX} ${y} ${H + 0.0576}"><freejoint name="can-free"/>`,
    );
  }
  const xml = f.xml.join('\n') + '\n';
  return {
    fixture: f,
    parameters: p,
    geometry,
    xml,
    expected: {
      boxes: [
        { id: 0, position: [x - 0.4, y, -0.025], halfSize: [0.4, W / 2, 0.025] },
        { id: 2, position: [x + 1.9, y, H - 0.025], halfSize: [1.1, W / 2, 0.025] },
      ],
      canOrigin: [x + 1.35, y, H + 0.0576],
      vertices: geometry.vertices,
      faces: geometry.faces,
    },
  };
}
export function rawByteCost(ncon: number, active: number): number {
  check(
    Number.isSafeInteger(ncon) &&
      ncon >= 0 &&
      ncon <= 132 &&
      Number.isSafeInteger(active) &&
      active >= 0 &&
      active <= ncon,
    'RAW_CENSUS',
  );
  return 8 * (210 + ncon + 24 * active);
}
export function admitNextCensus(count: number, bytes: number, ncon: number, active: number) {
  const cost = rawByteCost(ncon, active);
  check(
    Number.isSafeInteger(count) &&
      count >= 0 &&
      count + ncon <= 450000 &&
      bytes + cost <= MAX_WORLD_RAW,
    'PRE_STEP2_FULL_CENSUS_CAP',
  );
  return { count: count + ncon, bytes: bytes + cost };
}
export function decodeFrame(words: Float64Array, offset = 0) {
  check(offset >= 0 && offset + 210 <= words.length, 'RAW_HEADER');
  const ncon = words[offset + 208]!,
    active = words[offset + 209]!;
  const width = rawByteCost(ncon, active) / 8;
  check(words[offset] === width - 1 && offset + width <= words.length, 'RAW_WIDTH');
  const values = words.subarray(offset, offset + width);
  check(values.every(Number.isFinite), 'RAW_FINITE');
  return {
    values,
    ncon,
    active,
    next: offset + width,
    from: words[offset + 1]!,
    to: words[offset + 2]!,
  };
}
/** A dispose invalidates every asynchronous stage before its ACK. Cleanup failure is sticky. */
export class PreparationGate {
  private revision = 0;
  private fault: unknown;
  private stopped = false;
  capture(): number {
    return this.revision;
  }
  current(ticket: number): boolean {
    return !this.stopped && this.fault === undefined && ticket === this.revision;
  }
  invalidate(): number {
    return ++this.revision;
  }
  healthy(): void {
    if (this.fault !== undefined) throw this.fault;
    check(!this.stopped, 'WORKER_DISPOSED_TERMINALLY');
  }
  stop(): void {
    this.invalidate();
    this.stopped = true;
  }
  cleanup(close: () => void): void {
    try {
      if (this.fault !== undefined) throw this.fault;
      close();
    } catch (error) {
      this.fault ??= error;
      throw this.fault;
    }
  }
}
/** Shared by the actual Worker and deferred no-native regression: allocation is synchronous. */
export async function guardedPreparation<A, D, R>(
  gate: PreparationGate,
  ticket: number,
  assets: Promise<A>,
  derive: (assets: A) => Promise<D>,
  allocate: (derived: D, assets: A) => R,
): Promise<R | undefined> {
  const original = await assets;
  if (!gate.current(ticket)) return undefined;
  const derived = await derive(original);
  if (!gate.current(ticket)) return undefined;
  gate.healthy();
  return allocate(derived, original);
}

export async function disposePreparation(
  gate: PreparationGate,
  pendingAssets: Promise<unknown> | undefined,
  close: () => void,
  acknowledge: () => void,
): Promise<void> {
  gate.stop();
  // An already-entered module factory may finish, but must close before any disposed ACK.
  await pendingAssets?.catch(() => undefined);
  gate.cleanup(close);
  acknowledge();
}

/** Real dispatcher identity gate: an unaccepted future signature has no teardown authority. */
export async function disposeGeneration(
  generation: number,
  acceptedGeneration: number,
  gate: PreparationGate,
  pendingAssets: Promise<unknown> | undefined,
  close: () => void,
  acknowledge: () => void,
): Promise<boolean> {
  if (!Number.isSafeInteger(generation) || generation < 0 || generation !== acceptedGeneration)
    return false;
  await disposePreparation(gate, pendingAssets, close, acknowledge);
  return true;
}
/** Publish the construction cause before cleanup; the outer promise catch cannot duplicate or replace it. */
export class StartupFailures {
  private readonly first = new Map<number, { runCase: R5RunCase; error: string }>();
  constructor(
    private readonly emit: (generation: number, runCase: R5RunCase, error: string) => void,
  ) {}
  report(generation: number, runCase: R5RunCase, cause: unknown): string {
    const previous = this.first.get(generation);
    if (previous) {
      check(previous.runCase === runCase, 'STARTUP_RUN_CASE_IDENTITY');
      return previous.error;
    }
    check(
      Number.isSafeInteger(generation) && generation >= 1 && generation <= 8 && this.first.size < 8,
      'STARTUP_ERROR_BOUND',
    );
    const error = String(cause).slice(0, 1600);
    this.first.set(generation, { runCase, error });
    this.emit(generation, runCase, error);
    return error;
  }
}

export class GenerationBudget {
  private latest = 0;
  private constructed = 0;
  reserve(generation: number) {
    check(
      Number.isSafeInteger(generation) && generation > this.latest && this.constructed < 8,
      'GENERATION_LIMIT_OR_STALE',
    );
    this.latest = generation;
    this.constructed++;
  }
  current(generation: number) {
    return generation === this.latest;
  }
  count() {
    return this.constructed;
  }
}

export interface AdmissionPayload {
  nonce: string;
  generation: number;
  runCase: 'powered' | 'control';
  parameters: RampParameters;
}
export interface AdmissionPermit extends AdmissionPayload {
  signature: string;
}
export function admissionText(value: AdmissionPayload): string {
  check(
    /^[a-f0-9]{64}$/.test(value.nonce) &&
      Number.isSafeInteger(value.generation) &&
      value.generation >= 1 &&
      value.generation <= 8 &&
      (value.runCase === 'powered' || value.runCase === 'control'),
    'CONTROLLER_ADMISSION_IDENTITY',
  );
  return JSON.stringify({
    nonce: value.nonce,
    generation: value.generation,
    runCase: value.runCase,
    parameters: parameters(value.parameters),
  });
}
export async function verifyAdmission(
  key: JsonWebKey,
  nonce: string,
  permit: AdmissionPermit,
): Promise<boolean> {
  try {
    check(
      permit.nonce === nonce && /^[A-Za-z0-9+/]+={0,2}$/.test(permit.signature),
      'CONTROLLER_NONCE_OR_SIGNATURE',
    );
    const publicKey = await crypto.subtle.importKey(
      'jwk',
      key,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    const bytes = Uint8Array.from(atob(permit.signature), (c) => c.charCodeAt(0));
    check(bytes.length === 64, 'CONTROLLER_SIGNATURE_WIDTH');
    return await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      bytes,
      new TextEncoder().encode(admissionText(permit)),
    );
  } catch {
    return false;
  }
}

export function compiledRampWitness(
  actual: { localF32: number[]; faces: number[]; position: number[]; matrix: number[] },
  expected: ReturnType<typeof buildRampScene>['expected'],
) {
  check(
    actual.localF32.length === 24 &&
      actual.faces.length === 36 &&
      actual.position.length === 3 &&
      actual.matrix.length === 9 &&
      [...actual.localF32, ...actual.position, ...actual.matrix].every(Number.isFinite),
    'COMPILED_STORAGE',
  );
  check(
    actual.localF32.every((v) => Object.is(Math.fround(v), v)),
    'COMPILED_F32',
  );
  const p = actual.position,
    R = actual.matrix;
  for (let row = 0; row < 3; row++)
    for (let col = 0; col < 3; col++) {
      let dot = 0;
      for (let k = 0; k < 3; k++) dot += R[row * 3 + k]! * R[col * 3 + k]!;
      check(Math.abs(dot - Number(row === col)) <= 1e-12, 'COMPILED_ORTHONORMAL');
    }
  const vertices = Array.from(
    { length: 8 },
    (_, i) =>
      [0, 1, 2].map(
        (row) =>
          p[row]! +
          [0, 1, 2].reduce((sum, k) => sum + R[row * 3 + k]! * actual.localF32[i * 3 + k]!, 0),
      ) as unknown as XYZ,
  );
  const used = new Set<number>();
  const map = vertices.map((v) => {
    const id = expected.vertices.findIndex(
      (e, i) => !used.has(i) && Math.hypot(...e.map((x, k) => x - v[k]!)) <= 2e-7,
    );
    check(id >= 0, 'COMPILED_WORLD_HULL');
    used.add(id);
    return id;
  });
  check(
    actual.faces.every((i) => Number.isSafeInteger(i) && i >= 0 && i < 8),
    'COMPILED_FACE_INDEX',
  );
  const key = (face: number[]) => [...face].sort((a, b) => a - b).join(',');
  const faces = Array.from(
    { length: 12 },
    (_, i) => actual.faces.slice(i * 3, i * 3 + 3) as unknown as XYZ,
  );
  check(
    faces
      .map((f) => key(f.map((i) => map[i]!)))
      .sort()
      .join('|') ===
      expected.faces
        .map((f) => key([...f]))
        .sort()
        .join('|'),
    'COMPILED_FACE_PARITY',
  );
  return { vertices, faces, map };
}

// Shared actual runtime/offline R5 observer: numerical/physical criteria are unchanged.

function requireThat(condition: unknown, code: string): asserts condition {
  check(condition, code);
}
const ngeom = 10,
  axleQ = 7;
const [lower, slope, upper, chassis, bumper, rearLeft, rearRight, frontLeft, frontRight, can] = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
] as const;
const wheelIds = [rearLeft, rearRight, frontLeft, frontRight] as const;
const geomBodies = [0, 0, 0, 1, 1, 2, 2, 3, 4, 5];
const up: XYZ = [0, 0, 1],
  zero: XYZ = [0, 0, 0];
const unit: WXYZ = [1, 0, 0, 0];
const basis: XYZ[] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];
const minimumFlybackCurrent = 1e-6;
const pairKey = (a: number, b: number) => Math.min(a, b) * ngeom + Math.max(a, b);
function keepSpan(previous: Span | null, from: number, to: number, keep: boolean): Span | null {
  return keep ? { from: previous?.to === from ? previous.from : from, to } : null;
}
function finite(value: unknown, code: string): number {
  requireThat(typeof value === 'number' && Number.isFinite(value), code);
  return value;
}
function near(value: number, target: number, epsilon: number, code: string): void {
  requireThat(Number.isFinite(value) && Math.abs(value - target) <= epsilon, code);
}
export function sameWords(left: ArrayLike<number>, right: ArrayLike<number>): boolean {
  return (
    left.length === right.length &&
    Array.from(left).every((word, index) => Object.is(word, right[index]))
  );
}
function vec(value: ArrayLike<number>, offset = 0): XYZ {
  return [
    finite(value[offset], 'VEC_X'),
    finite(value[offset + 1], 'VEC_Y'),
    finite(value[offset + 2], 'VEC_Z'),
  ];
}
function quat(value: ArrayLike<number>, offset = 0): WXYZ {
  return [finite(value[offset], 'QUAT_W'), ...vec(value, offset + 1)];
}
const add = (a: XYZ, b: XYZ): XYZ => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: XYZ, b: XYZ): XYZ => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (v: XYZ, s: number): XYZ => [v[0] * s, v[1] * s, v[2] * s];
const dot = (a: XYZ, b: XYZ): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: XYZ, b: XYZ): XYZ => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (v: XYZ): number => Math.hypot(...v);
const radians = (deg: number): number => (deg * Math.PI) / 180;
const conjugate = (q: WXYZ): WXYZ => [q[0], -q[1], -q[2], -q[3]];
function rotate(q: WXYZ, p: XYZ): XYZ {
  const axis = vec(q, 1);
  const t = scale(cross(axis, p), 2);
  return add(p, add(scale(t, q[0]), cross(axis, t)));
}
function multiply(a: WXYZ, b: WXYZ): WXYZ {
  const av = vec(a, 1),
    bv = vec(b, 1);
  return [a[0] * b[0] - dot(av, bv), ...add(add(scale(bv, a[0]), scale(av, b[0])), cross(av, bv))];
}
function rotationDistance(a: WXYZ, b: WXYZ): number {
  const q = multiply(b, conjugate(a));
  return 2 * Math.atan2(norm(vec(q, 1)), Math.abs(q[0]));
}
function terrainNormal(id: number, f: Fixture): XYZ {
  const angle = radians(f.physical.terrain.angleDeg);
  return id === slope ? [-Math.sin(angle), 0, Math.cos(angle)] : up;
}
function worldForce(contact: Loaded): XYZ {
  return add(
    add(
      scale(vec(contact.frame), contact.force[0]),
      scale(vec(contact.frame, 3), contact.force[1]),
    ),
    scale(vec(contact.frame, 6), contact.force[2]),
  );
}
function forceOn(contact: Loaded, geom: number, force: XYZ): XYZ {
  return scale(force, contact.second === geom ? 1 : -1);
}
export function onTop(id: number, point: XYZ, f: Fixture, domainError = 0): boolean {
  const { terrain, limits } = f.physical;
  const local: XYZ = [
    point[0] - (terrain.originXMeters ?? 0),
    point[1] - (terrain.originYMeters ?? 0),
    point[2],
  ];
  check(domainError === 0 || domainError === 2e-7, 'COMPILED_DOMAIN_BUDGET');
  if (Math.abs(local[1]) > terrain.halfY + domainError) return false;
  if (id === slope) {
    const normal = terrainNormal(id, f);
    const distance = dot(local, normal);
    const projected = sub(local, scale(normal, distance));
    return (
      Math.abs(distance) <= limits.faceDistanceM &&
      projected[0] >= -domainError &&
      projected[0] <= 0.8 + domainError
    );
  }
  const extent = id === lower ? terrain.lower : terrain.upper;
  const level = id === lower ? 0 : terrain.height;
  return (
    Math.abs(point[2] - level) <= limits.faceDistanceM &&
    point[0] >= extent[0]! - domainError &&
    point[0] <= extent[1]! + domainError
  );
}
function validSupport(
  contact: Loaded,
  terrain: number,
  body: number,
  force: XYZ,
  f: Fixture,
  domainError = 0,
): boolean {
  const normal = terrainNormal(terrain, f);
  return (
    onTop(terrain, contact.point, f, domainError) &&
    dot(forceOn(contact, body, vec(contact.frame)), normal) >=
      Math.cos(radians(f.physical.limits.faceNormalAllowDeg)) &&
    dot(forceOn(contact, body, force), normal) > 0 &&
    dot(forceOn(contact, body, force), up) > 0
  );
}
function canCom(pose: Pose, f: Fixture): XYZ {
  return add(pose.p, rotate(pose.q, [0, 0, f.physical.can.comHeight - f.physical.can.height / 2]));
}
function pointOnSide(point: XYZ, pose: Pose, f: Fixture): boolean {
  const local = rotate(conjugate(pose.q), sub(point, pose.p));
  const { can, limits } = f.physical;
  return (
    Math.abs(Math.hypot(local[0], local[1]) - can.radius) <= limits.faceDistanceM &&
    Math.abs(local[2]) <= can.height / 2 + limits.faceDistanceM
  );
}
function projection(pose: Pose, geom: R5StandScene['geometries'][number], axis: XYZ) {
  const center = dot(add(pose.p, rotate(pose.q, geom.positionMeters)), axis);
  const q = multiply(pose.q, geom.quaternionWxyz);
  const shape = geom.shape;
  requireThat(shape.kind !== 'mesh', 'CLEARANCE_PRIMITIVE');
  if (shape.kind === 'box') {
    return {
      center,
      half: basis.reduce(
        (sum, direction, i) =>
          sum + shape.halfExtentsMeters[i]! * Math.abs(dot(rotate(q, direction), axis)),
        0,
      ),
    };
  }
  const cosine = Math.min(1, Math.abs(dot(rotate(q, up), axis)));
  return {
    center,
    half: cosine * shape.halfHeightMeters + Math.sqrt(1 - cosine ** 2) * shape.radiusMeters,
  };
}
function shapeReach(geom: R5StandScene['geometries'][number]): number {
  const shape = geom.shape;
  requireThat(shape.kind !== 'mesh', 'CLEARANCE_REACH');
  if (shape.kind === 'cylinder')
    return norm(geom.positionMeters) + Math.hypot(shape.radiusMeters, shape.halfHeightMeters);
  return Math.max(
    ...[-1, 1].flatMap((x) =>
      [-1, 1].flatMap((y) =>
        [-1, 1].map((z) =>
          norm(
            add(
              geom.positionMeters,
              rotate(geom.quaternionWxyz, [
                x * shape.halfExtentsMeters[0],
                y * shape.halfExtentsMeters[1],
                z * shape.halfExtentsMeters[2],
              ]),
            ),
          ),
        ),
      ),
    ),
  );
}
function clearanceBound(before: Pose[], after: Pose[], scene: R5StandScene): number {
  const shapes = scene.geometries;
  const canGeom = shapes[can]!;
  const swept = (body: number, radius: number) => {
    const a = before[body]!,
      b = after[body]!;
    return norm(sub(b.p, a.p)) + radius * rotationDistance(a.q, b.q);
  };
  const canSweep = swept(5, shapeReach(canGeom));
  const bound = (key: number) => {
    const owner = geomBodies[key]!,
      geom = shapes[key]!;
    const gap = (poses: Pose[]) =>
      Math.max(
        ...basis.map((axis) => {
          const a = projection(poses[owner]!, geom, axis),
            b = projection(poses[5]!, canGeom, axis);
          return Math.abs(a.center - b.center) - a.half - b.half;
        }),
      );
    return { gap: Math.min(gap(before), gap(after)), sweep: swept(owner, shapeReach(geom)) };
  };
  const chassisBound = bound(chassis);
  const bumperBound = bound(bumper);
  const tires = wheelIds.map(bound);
  return (
    Math.min(
      chassisBound.gap - chassisBound.sweep,
      bumperBound.gap - bumperBound.sweep,
      Math.min(...tires.map(({ gap }) => gap)) - Math.max(...tires.map(({ sweep }) => sweep)),
    ) - canSweep
  );
}

export interface SupportWindow {
  span: Span | null;
  firstWindow: Span | null;
  longestUs: number;
}
export function retainSupportWindow(
  previous: SupportWindow,
  from: number,
  to: number,
  supported: boolean,
  requiredUs: number,
): SupportWindow {
  check(
    Number.isSafeInteger(from) && Number.isSafeInteger(to) && to > from && requiredUs === 100000,
    'UPPER_WINDOW_CLOCK',
  );
  const span = keepSpan(previous.span, from, to, supported);
  return {
    span,
    firstWindow:
      previous.firstWindow ?? (span && to - span.from >= requiredUs ? { ...span } : null),
    longestUs: Math.max(previous.longestUs, span ? to - span.from : 0),
  };
}

export class PhysicalWitness {
  readonly landmarks: R5Landmark[] = [];
  readonly failures = new Map<string, number>();
  private fullEnergy: FullEnergyWitness | undefined;
  startEnergy(endpoint: EndpointEnergy): void {
    check(!this.historical && !this.fullEnergy, 'INITIAL_ENERGY_ONCE');
    this.fullEnergy = new FullEnergyWitness(endpoint);
  }
  private settled: Span | null = null;
  private upward: Span | null = null;
  private upperSupport: SupportWindow = { span: null, firstWindow: null, longestUs: 0 };
  private upright: Span | null = null;
  private side: Span | null = null;
  private resting: Pose | undefined;
  private rampZ = 0;
  private sideClearance = Infinity;
  private bumpImpulse = 0;
  private pitchImpulse = 0;
  private flyback = 0;
  private controlTravel = 0;
  private shaftPositive = 0;
  private shaftSigned = 0;
  private loadedContactWork = 0;
  private supplyWork = 0;
  private circuitLoss = 0;
  private reverseViolations = 0;
  private firstReverseViolation: { from: number; to: number; work: number } | undefined;
  private recontact = { ticks: 0, loadedTimeUs: 0, impulseNs: 0, lastUs: 0 };

  constructor(
    private readonly f: Fixture,
    private readonly runCase: R5RunCase,
    private readonly scene: R5StandScene,
    private readonly historical = false,
  ) {}

  private has(key: R5Landmark['key']): boolean {
    return this.landmarks.some((value) => value.key === key);
  }
  private add(key: R5Landmark['key'], atMicroseconds: number, value?: number): void {
    this.landmarks.push({ key, atMicroseconds, ...(value === undefined ? {} : { value }) });
  }
  private fail(reason: string, at: number): void {
    if (!this.failures.has(reason)) this.failures.set(reason, at);
  }

  observe(frame: Omit<Frame, 'identities'>): void {
    const f = this.f,
      { terrain, can: canSpec, limits } = f.physical;
    const { from, to, before, after, contacts } = frame;
    this.fullEnergy?.observe(frame);
    const dt = (to - from) * 1e-6;
    const preCan = before[5]!,
      postCan = after[5]!,
      preCom = canCom(preCan, f),
      postCom = canCom(postCan, f);
    if (
      postCom[0] < terrain.upper[0]! ||
      postCom[0] > terrain.upper[1]! ||
      Math.abs(postCom[1] - (terrain.originYMeters ?? 0)) > terrain.halfY ||
      postCom[2] <= terrain.height
    )
      this.fail('CAN_LEFT_FINITE_SUPPORTED_FIELD', to);
    const preAxis = rotate(preCan.q, up),
      postAxis = rotate(postCan.q, up);
    const preTip = Math.atan2(Math.hypot(preAxis[0], preAxis[1]), preAxis[2]);
    const postTip = Math.atan2(Math.hypot(postAxis[0], postAxis[1]), postAxis[2]);
    const support = new Map<number, Set<number>>();
    const rejected = new Set<number>();
    let slip = 0,
      strikeHeight = Infinity,
      pitch = 0,
      impulse = 0,
      robotTouchesCan = false;
    let sideContact = false,
      supportedCan = false,
      laterImpulse = 0;
    const slopeNormal = terrainNormal(slope, f);
    const slopeDirection: XYZ = [slopeNormal[2], 0, -slopeNormal[0]];
    const appliedWork = frame.effort * (frame.post.qpos[axleQ]! - frame.pre.qpos[axleQ]!);
    this.shaftPositive += Math.max(0, appliedWork);
    this.shaftSigned += appliedWork;
    this.supplyWork += frame.circuit.powerIn * dt;
    this.circuitLoss += frame.circuit.powerCircuit * dt;
    if (frame.reverse && from >= f.comparison.interventionUs && appliedWork > 0) {
      this.reverseViolations++;
      this.firstReverseViolation ??= { from, to, work: appliedWork };
    }
    for (const c of contacts) {
      this.loadedContactWork += dot(c.force, c.delta);
      if (c.force[0] === 0) continue;
      const terrainId = c.first <= upper ? c.first : c.second <= upper ? c.second : -1;
      const other = terrainId === c.first ? c.second : c.first;
      const force = worldForce(c);
      if (terrainId >= 0) {
        if (other === chassis || other === bumper) this.fail('BODY_DRAGGED_ON_TERRAIN', from);
        if (wheelIds.some((wheel) => wheel === other)) {
          if (!validSupport(c, terrainId, other, force, f, this.historical ? 0 : 2e-7)) {
            rejected.add(other);
          } else {
            const foot = support.get(other) ?? new Set<number>();
            foot.add(terrainId);
            support.set(other, foot);
            if (terrainId === slope) {
              const speed = worldForce({ ...c, force: c.velocity });
              slip = Math.max(slip, Math.abs(dot(speed, slopeDirection)));
            }
          }
        }
        if (other === can) {
          if (terrainId !== upper) this.fail('CAN_LEFT_UPPER_DECK', from);
          if (
            terrainId === upper &&
            validSupport(c, terrainId, can, force, f, this.historical ? 0 : 2e-7)
          ) {
            supportedCan = true;
            sideContact ||= pointOnSide(c.point, preCan, f);
          }
        }
      } else if (c.first === can || c.second === can) {
        robotTouchesCan = true;
        if (this.has('free-side')) laterImpulse += c.force[0] * dt;
        if (pairKey(c.first, c.second) === pairKey(bumper, can)) {
          strikeHeight = Math.min(strikeHeight, c.point[2] - preCom[2]);
          impulse += c.force[0] * dt;
          pitch += cross(sub(c.point, preCom), forceOn(c, can, force))[1] * dt;
        } else if (!this.has('tip')) this.fail('UNREGISTERED_ROBOT_CAN_CAUSE', from);
      }
    }
    if (laterImpulse > 0) {
      if (!this.has('late-recontact')) this.add('late-recontact', from);
      this.recontact.ticks++;
      this.recontact.loadedTimeUs += to - from;
      this.recontact.impulseNs += laterImpulse;
      this.recontact.lastUs = to;
    }

    const on = (wheel: number, surface: number) => {
      const surfaces = support.get(wheel);
      return !rejected.has(wheel) && surfaces?.size === 1 && surfaces.has(surface);
    };
    const allOn = (surface: number) => wheelIds.every((wheel) => on(wheel, surface));
    const rover0 = before[1]!,
      rover1 = after[1]!;
    if (to <= f.programs.divergeUs) {
      this.settled = keepSpan(this.settled, from, to, allOn(lower));
      if (
        to === f.programs.divergeUs &&
        this.settled &&
        to - this.settled.from >= limits.staticUs
      ) {
        this.resting = rover1;
        this.add('settled', to, rover1.p[2]);
      }
    }
    if (this.resting)
      this.controlTravel = Math.max(this.controlTravel, Math.abs(rover1.p[0] - this.resting.p[0]));
    if (this.runCase === 'control') {
      if (
        robotTouchesCan ||
        wheelIds.some((wheel) => on(wheel, slope)) ||
        postTip >= canSpec.tipAngleRad
      )
        this.fail('LOW_CONTROL_LEFT_REST', from);
    } else {
      if (
        !this.has('mixed') &&
        this.resting &&
        on(frontLeft, slope) &&
        on(frontRight, slope) &&
        on(rearLeft, lower) &&
        on(rearRight, lower)
      )
        this.add('mixed', to, rover0.p[2]);
      if (this.has('mixed') && !this.has('ramp')) {
        const valid = allOn(slope) && slip <= limits.maxSlipMps;
        if (valid && this.upward?.to !== from) this.rampZ = rover0.p[2];
        this.upward = keepSpan(this.upward, from, to, valid);
        if (this.upward && to - this.upward.from >= limits.rampUs && rover1.p[2] > this.rampZ)
          this.add('ramp', to, rover1.p[2] - this.rampZ);
      }
      if (!this.historical)
        this.upperSupport = retainSupportWindow(
          this.upperSupport,
          from,
          to,
          this.has('ramp') && allOn(upper),
          limits.rampUs,
        );
      if (this.has('ramp') && !this.has('top') && allOn(upper) && this.resting) {
        const rise = rover1.p[2] - this.resting.p[2];
        this.add('top', to, rise);
        if (rise < limits.minElevationM) this.fail('INSUFFICIENT_ELEVATION', to);
      }
    }

    if (impulse > 0 && !this.has('impact')) {
      this.add('impact', from, strikeHeight);
      if (
        !this.has('top') ||
        (this.landmarks.find(({ key }) => key === 'top')?.atMicroseconds ?? Infinity) > from
      )
        this.fail('IMPACT_BEFORE_TOP', from);
      if (strikeHeight < limits.impactAboveComM || pitch <= 0)
        this.fail('IMPACT_COM_HEIGHT_OR_PITCH_SIGN', from);
      if (!this.upright || this.upright.to !== from || from - this.upright.from < limits.staticUs)
        this.fail('CAN_NOT_UPRIGHT_50MS_BEFORE_IMPACT', from);
    }
    this.upright = keepSpan(
      this.upright,
      from,
      to,
      supportedCan &&
        !robotTouchesCan &&
        preTip <= radians(limits.canUprightDeg) &&
        postTip <= radians(limits.canUprightDeg),
    );
    if (this.has('impact') && !this.has('tip')) {
      this.bumpImpulse += impulse;
      this.pitchImpulse += pitch;
    }
    if (this.runCase === 'powered' && !this.has('tip') && postTip >= canSpec.tipAngleRad) {
      this.add('tip', to, postTip);
      if (
        !this.has('impact') ||
        preTip >= canSpec.tipAngleRad ||
        this.bumpImpulse <= 0 ||
        this.pitchImpulse <= 0
      )
        this.fail('TIP_OUTSIDE_NATIVE_CAUSAL_ORDER', to);
    }
    if (this.runCase === 'powered' && from >= f.programs.offUs && frame.circuit.logic === 0) {
      if (frame.circuit.windV < 0) this.flyback = Math.max(this.flyback, frame.circuit.diodeA);
      if (!this.has('final-low')) {
        this.add('final-low', from);
        if (from !== f.programs.offUs) this.fail('FINAL_LOW_AT_WRONG_BOUNDARY', from);
      }
    }
    const crossing = this.landmarks.find(({ key }) => key === 'tip')?.atMicroseconds;
    const sideBand = Math.sin(radians(limits.canSideFromHorizontalDeg));
    const targetDrop = limits.canDropFraction * (canSpec.comHeight - canSpec.radius);
    const side =
      crossing !== undefined &&
      crossing <= from &&
      from >= f.programs.offUs &&
      frame.circuit.logic === 0 &&
      sideContact &&
      !robotTouchesCan &&
      Math.abs(preAxis[2]) <= sideBand &&
      Math.abs(postAxis[2]) <= sideBand &&
      canSpec.initialComZ - preCom[2] >= targetDrop &&
      canSpec.initialComZ - postCom[2] >= targetDrop;
    const gap = side ? clearanceBound(before, after, this.scene) : Infinity;
    if (side && (!this.side || this.side.to !== from)) this.sideClearance = Infinity;
    this.side = keepSpan(this.side, from, to, side && gap > 0);
    if (this.side) {
      this.sideClearance = Math.min(this.sideClearance, gap);
      if (!this.has('free-side') && to - this.side.from >= limits.sideUs)
        this.add('free-side', to, this.sideClearance);
    }
    if (
      this.has('top') &&
      (rover1.p[0] > terrain.upper[1]! ||
        Math.abs(rover1.p[1] - (terrain.originYMeters ?? 0)) > terrain.halfY ||
        rover1.p[2] <= terrain.height)
    )
      this.fail('ROVER_LEFT_TOP_SUPPORTED_FIELD', to);
  }

  complete(at: number, endpoint?: EndpointEnergy) {
    let fullEnergy: ReturnType<FullEnergyWitness['finish']> | undefined;
    if (!this.historical) {
      check(this.fullEnergy && endpoint, 'BOTH_NATIVE_ENERGY_ENDPOINTS_REQUIRED');
      fullEnergy = this.fullEnergy.finish(endpoint);
      if (!fullEnergy.pass) this.fail('FULL_ENERGY_BUDGET', at);
    }
    if (!this.resting) this.fail('NO_INITIAL_50MS_CONTACT_SETTLE', at);
    if (this.runCase === 'powered') {
      for (const key of [
        'mixed',
        'ramp',
        'top',
        'impact',
        'tip',
        'final-low',
        'free-side',
        'late-recontact',
      ] as const)
        if (!this.has(key)) this.fail('MISSING_' + key, at);
      if (!this.historical && !this.upperSupport.firstWindow)
        this.fail('NO_100MS_UPPER_SUPPORT', at);
      if (this.flyback < minimumFlybackCurrent) this.fail('NO_FINAL_FLYBACK_WITNESS', at);
    } else {
      if (
        this.controlTravel > this.f.physical.limits.controlMaxTravelM ||
        this.shaftPositive > this.f.physical.limits.controlPositiveShaftMaxJ
      )
        this.fail('CONTROL_TRAVEL_OR_POSITIVE_WORK', at);
      if (
        !this.upright ||
        this.upright.to !== at ||
        at - this.upright.from < this.f.physical.limits.sideUs
      )
        this.fail('CONTROL_FINAL_UPRIGHT_WINDOW', at);
    }
    return {
      ...(fullEnergy ? { fullEnergy } : {}),
      ...(!this.historical
        ? {
            upperSupport: {
              firstWindow: this.upperSupport.firstWindow,
              longestUs: this.upperSupport.longestUs,
              requiredUs: this.f.physical.limits.rampUs,
            },
          }
        : {}),
      physical: this.failures.size === 0 ? 'PASS' : 'FAIL',
      causal: 'GAP_CAUSAL_ALT',
      failures: Array.from(this.failures),
      landmarks: this.landmarks,
      controlTravel: this.controlTravel,
      maxFlybackAmp: this.flyback,
      signedPitchImpulse: this.pitchImpulse,
      normalImpulse: this.bumpImpulse,
      recontact: this.recontact,
      energy: {
        signedShaftWorkJ: this.shaftSigned,
        positiveShaftWorkJ: this.shaftPositive,
        contactWorkJ: this.loadedContactWork,
        sourceWorkJ: this.supplyWork,
        circuitLossJ: this.circuitLoss,
        reversePositiveIntervals: this.reverseViolations,
        firstActualReversePositive: this.firstReverseViolation ?? null,
      },
    };
  }
}

export const ENERGY_MODEL = Object.freeze({
  resistanceOhm: 4,
  inductanceHenry: 0.00035,
  backEmf: 0.004265352474862795,
  torqueConstant: 0.004265352474862795,
  viscosity: 5.430815443229305e-7,
  gearRatio: 48,
  reflectedInertia: 0.0004608,
});
export interface EndpointEnergy {
  state: NativeState;
  poses: Pose[];
  potentialJ: number;
  kineticJ: number;
  massTimesVelocity: number[];
  bodies: {
    id: number;
    com: XYZ;
    omega: XYZ;
    velocity: XYZ;
    inertialToWorld: number[];
    mass: number;
    moments: XYZ;
  }[];
  gravity: XYZ;
  reflectedInertia: number;
  f64leHex?: string;
}
/** Lossless bounded endpoint primitive packet; JSON labels are never the bit authority. */
export function endpointPacket(endpoint: EndpointEnergy): string {
  const words = [
    endpoint.state.time,
    ...endpoint.state.qpos,
    ...endpoint.state.qvel,
    ...endpoint.poses.flatMap((p) => [...p.p, ...p.q]),
    endpoint.potentialJ,
    endpoint.kineticJ,
    ...endpoint.massTimesVelocity,
    ...endpoint.bodies.flatMap((b) => [
      b.id,
      ...b.com,
      ...b.omega,
      ...b.velocity,
      ...b.inertialToWorld,
      b.mass,
      ...b.moments,
    ]),
    ...endpoint.gravity,
    endpoint.reflectedInertia,
  ];
  check(words.length <= 256 && words.every(Number.isFinite), 'ENDPOINT_FINITE_PACKET_CAP');
  const bytes = new Uint8Array(words.length * 8),
    view = new DataView(bytes.buffer);
  words.forEach((v, i) => view.setFloat64(i * 8, v, true));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
export function checkEndpointEnergy(endpoint: EndpointEnergy) {
  check(
    endpoint.state.qpos.length === 17 &&
      endpoint.state.qvel.length === 15 &&
      endpoint.poses.length === 6 &&
      endpoint.bodies.length === 5 &&
      endpoint.massTimesVelocity.length === 15 &&
      sameWords(endpoint.gravity, [0, 0, -9.81]) &&
      endpoint.reflectedInertia === ENERGY_MODEL.reflectedInertia,
    'ENDPOINT_PRIMITIVE_MECHANICS',
  );
  const packet = endpointPacket(endpoint);
  if (endpoint.f64leHex !== undefined)
    check(endpoint.f64leHex === packet, 'ENDPOINT_F64_PACKET_BITS');
  let kinetic = 0.5 * endpoint.reflectedInertia * endpoint.state.qvel[6]! ** 2,
    potential = 0;
  for (const [index, body] of endpoint.bodies.entries()) {
    check(
      body.id === index + 1 &&
        body.mass > 0 &&
        body.moments.every((v) => v > 0) &&
        body.inertialToWorld.length === 9,
      'ENDPOINT_PRIMITIVE_BODY_ID_INERTIA',
    );
    const R = body.inertialToWorld;
    const axes = [0, 1, 2].map((i) => [R[i]!, R[i + 3]!, R[i + 6]!] as XYZ);
    for (const [i, axis] of axes.entries())
      for (const [j, other] of axes.entries())
        near(dot(axis, other), Number(i === j), 1e-12, 'ENDPOINT_INERTIAL_ROTATION');
    const omega = axes.map((a) => dot(a, body.omega));
    kinetic +=
      (body.mass * dot(body.velocity, body.velocity) +
        body.moments.reduce((n, I, i) => n + I * omega[i]! ** 2, 0)) /
      2;
    potential -= body.mass * dot(endpoint.gravity, body.com);
  }
  const massDot =
    endpoint.state.qvel.reduce((n, v, i) => n + v * endpoint.massTimesVelocity[i]!, 0) / 2;
  const agree = (a: number, b: number, code: string) =>
    near(a, b, 256 * Number.EPSILON * Math.max(1, Math.abs(a), Math.abs(b)), code);
  agree(endpoint.kineticJ, massDot, 'FULL_MASS_ENERGY_WITH_ARMATURE');
  agree(endpoint.kineticJ, kinetic, 'INDEPENDENT_RIGID_BODY_KINETIC_ENERGY');
  agree(endpoint.potentialJ, potential, 'INDEPENDENT_BODY_GRAVITATIONAL_ENERGY');
  return { kinetic, potential, massDot, packet };
}
export function checkEndpointReadback(
  endpoint: EndpointEnergy,
  model: {
    masses: number[];
    bodyInertia: number[];
    inertialOffsets: XYZ[];
    inertialQuaternions: WXYZ[];
  },
) {
  checkEndpointEnergy(endpoint);
  check(
    model.masses.length === 6 &&
      model.bodyInertia.length === 18 &&
      model.inertialOffsets.length === 6 &&
      model.inertialQuaternions.length === 6,
    'ENDPOINT_MODEL_READBACK_WIDTH',
  );
  for (const body of endpoint.bodies) {
    const id = body.id,
      pose = endpoint.poses[id]!;
    check(
      Object.is(body.mass, model.masses[id]) &&
        sameWords(body.moments, model.bodyInertia.slice(3 * id, 3 * id + 3)),
      'ENDPOINT_MODEL_MASS_INERTIA',
    );
    const com = add(pose.p, rotate(pose.q, model.inertialOffsets[id]!));
    const q = multiply(pose.q, model.inertialQuaternions[id]!);
    const axes = basis.map((axis) => rotate(q, axis));
    for (let i = 0; i < 3; i++) {
      near(body.com[i]!, com[i]!, 1e-12, 'ENDPOINT_BODY_COM');
      for (let j = 0; j < 3; j++)
        near(body.inertialToWorld[i * 3 + j]!, axes[j]![i]!, 1e-12, 'ENDPOINT_BODY_INERTIAL_FRAME');
    }
  }
}
/** The original full energy gate, with measured signed transmission loss clipped only for dissipation. */
export class FullEnergyWitness {
  private previousCurrent = 0;
  private last: NativeState;
  private totals = {
    input: 0,
    positiveInput: 0,
    circuit: 0,
    copper: 0,
    viscous: 0,
    transmission: 0,
    electricalEuler: 0,
    magnet: 0,
    contact: 0,
    signedTransmission: 0,
    negativeTransmissionIntervals: 0,
  };
  constructor(readonly initial: EndpointEnergy) {
    checkEndpointEnergy(initial);
    check(
      initial.state.time === 0 && initial.state.qvel.every((v) => v === 0),
      'SOURCE_TIME_ZERO_ENERGY',
    );
    this.last = initial.state;
  }
  observe(frame: Omit<Frame, 'identities'>) {
    check(
      Object.is(this.last.time, frame.pre.time) &&
        sameWords(this.last.qpos, frame.pre.qpos) &&
        sameWords(this.last.qvel, frame.pre.qvel),
      'ENERGY_PRE_CONTINUITY',
    );
    const dt = (frame.to - frame.from) * 1e-6,
      e = frame.circuit,
      p = ENERGY_MODEL,
      omega = p.gearRatio * frame.pre.qvel[6]!;
    const current =
      (e.windV - p.backEmf * omega + (p.inductanceHenry / dt) * this.previousCurrent) /
      (p.resistanceOhm + p.inductanceHenry / dt);
    near(current, e.current, 1e-10, 'RECONSTRUCTED_IMPLICIT_MNA_WINDING');
    check(e.maxKcl <= e.kcl, 'REPLAY_KCL_MAX');
    const inputTorque = (p.torqueConstant * e.current - p.viscosity * omega) * p.gearRatio;
    const nativeLoss = (inputTorque - frame.effort) * (frame.post.qpos[7]! - frame.pre.qpos[7]!);
    const a = this.totals;
    a.input += e.powerIn * dt;
    a.positiveInput += Math.max(0, e.powerIn) * dt;
    a.circuit += e.powerCircuit * dt;
    a.copper += p.resistanceOhm * e.current ** 2 * dt;
    a.viscous += e.viscousW * dt;
    a.transmission += Math.max(0, nativeLoss);
    a.signedTransmission += nativeLoss;
    a.negativeTransmissionIntervals += Number(nativeLoss < 0);
    a.electricalEuler += 0.5 * p.inductanceHenry * (e.current - this.previousCurrent) ** 2;
    a.magnet = 0.5 * p.inductanceHenry * e.current ** 2;
    for (const c of frame.contacts) a.contact += dot(c.force, c.delta);
    this.previousCurrent = e.current;
    this.last = frame.post;
  }
  finish(end: EndpointEnergy) {
    checkEndpointEnergy(end);
    check(
      Object.is(end.state.time, this.last.time) &&
        sameWords(end.state.qpos, this.last.qpos) &&
        sameWords(end.state.qvel, this.last.qvel),
      'FINAL_ENERGY_ACCEPTED_STATE',
    );
    const a = this.totals;
    const deltaStored =
      end.potentialJ + end.kineticJ - this.initial.potentialJ - this.initial.kineticJ + a.magnet;
    const contactAbsorption = Math.max(0, -a.contact);
    const dissipation =
      a.circuit + a.copper + a.viscous + a.transmission + a.electricalEuler + contactAbsorption;
    const residualJ = deltaStored + dissipation - a.input,
      limitJ = Math.max(0.0001, 0.01 * a.positiveInput);
    check(
      [...Object.values(a), deltaStored, dissipation, residualJ, limitJ].every(Number.isFinite),
      'FULL_ENERGY_FINITE',
    );
    return {
      ...a,
      deltaStored,
      contactAbsorption,
      dissipation,
      residualJ,
      limitJ,
      pass: Math.max(0, residualJ) <= limitJ,
      causal: 'GAP_CAUSAL_ALT' as const,
    };
  }
}

export function frameFromWords(words: Float64Array, offset = 0) {
  const decoded = decodeFrame(words, offset),
    w = decoded.values.subarray(1);
  let cursor = 28;
  const read = (n: number) => {
    const a = Array.from(w.subarray(cursor, cursor + n));
    cursor += n;
    return a;
  };
  const pre = { time: w[2]!, qpos: read(17), qvel: read(15) },
    post = { time: w[3]!, qpos: read(17), qvel: read(15) };
  const poses = () => [
    { p: zero, q: unit },
    ...Array.from({ length: 5 }, () => {
      const a = read(7);
      return { p: vec(a), q: quat(a, 3) };
    }),
  ];
  const before = poses(),
    after = poses();
  const kinematics = [
    { com: zero, omega: zero, velocity: zero },
    ...Array.from({ length: 5 }, () => {
      const a = read(9);
      return { com: vec(a), omega: vec(a, 3), velocity: vec(a, 6) };
    }),
  ];
  check(cursor === 207, 'RAW_FIXED_HEADER_LAYOUT');
  cursor += 2;
  const census = read(decoded.ncon).map((value, index) => {
    check(Number.isSafeInteger(value) && value >= 0, 'RAW_CENSUS_ID');
    const first = value % 10,
      second = Math.floor(value / 10) % 10,
      flags = Math.floor(value / 100);
    check(first !== second && flags < 16, 'RAW_CENSUS_FIELDS');
    return { first, second, index, exclude: flags % 8, active: flags >= 8 };
  });
  const contacts: Loaded[] = [];
  const rows = new Set<number>();
  const indices = new Set<number>();
  for (let i = 0; i < decoded.active; i++) {
    const v = read(24),
      index = v[0]!,
      address = v[1]!,
      c = census[index];
    check(
      c &&
        c.active &&
        c.exclude === 0 &&
        !indices.has(index) &&
        Number.isSafeInteger(address) &&
        address >= 0 &&
        address + 3 <= 3 * decoded.active,
      'RAW_ACTIVE_ID',
    );
    indices.add(index);
    for (let row = address; row < address + 3; row++) {
      check(!rows.has(row), 'RAW_DUPLICATE_ROW');
      rows.add(row);
    }
    const contact: Loaded = {
      ...c,
      address,
      dist: v[2]!,
      point: vec(v, 3),
      frame: v.slice(6, 15),
      force: vec(v, 15),
      velocity: vec(v, 18),
      delta: vec(v, 21),
    };
    check(
      contact.force[0] >= 0 && (contact.force[0] === 0 || contact.dist < 0),
      'RAW_SIGNED_NORMAL_FORCE',
    );
    for (let a = 0; a < 3; a++)
      for (let b = 0; b < 3; b++)
        near(
          dot(vec(contact.frame, a * 3), vec(contact.frame, b * 3)),
          Number(a === b),
          1e-12,
          'RAW_ORTHONORMAL',
        );
    const speed = (id: number) => {
      const body = kinematics[geomBodies[id]!]!;
      return add(body.velocity, cross(body.omega, sub(contact.point, body.com)));
    };
    const relative = sub(speed(c.second), speed(c.first));
    for (let axis = 0; axis < 3; axis++)
      near(
        dot(relative, vec(contact.frame, axis * 3)),
        contact.velocity[axis]!,
        1e-9,
        'RAW_POINT_VELOCITY',
      );
    contacts.push(contact);
  }
  check(
    census.filter((c) => c.active).length === decoded.active &&
      rows.size === 3 * decoded.active &&
      cursor === w.length,
    'RAW_CENSUS_CLOSURE',
  );
  const names = [
    'logic',
    'gpio',
    'gpioA',
    'sourceV',
    'sourceA',
    'windV',
    'current',
    'fetVds',
    'fetVgs',
    'fetA',
    'gateA',
    'diodeV',
    'diodeA',
    'powerIn',
    'powerCircuit',
    'viscousW',
    'transmissionW',
    'impulse',
    'torque',
    'temperature',
    'maxKcl',
    'kcl',
  ] as const;
  const circuit = Object.fromEntries(names.map((name, i) => [name, w[i + 6]!])) as Frame['circuit'];
  const frame: Omit<Frame, 'identities'> = {
    from: w[0]!,
    to: w[1]!,
    pre,
    post,
    before,
    after,
    kinematics,
    circuit,
    effort: w[4]!,
    reverse: w[5] === 1,
    contacts,
  };
  check(w[5] === 0 || w[5] === 1, 'RAW_REVERSE_BOOLEAN');
  return { ...decoded, frame, census };
}
export function verifyElectricalFrame(
  frame: Omit<Frame, 'identities'>,
  f: Fixture,
  runCase: R5RunCase,
) {
  const e = frame.circuit,
    dt = (frame.to - frame.from) * 1e-6;
  const edge = f.programs[runCase].gpio
    .filter((v) => v.kind === 'output-change' && v.atMicroseconds <= frame.from)
    .at(-1);
  check(
    e.logic === (edge?.voltageVolt ?? edge?.voltage) && e.gpio >= 2.5 === (e.logic === 5),
    'REPLAY_GPIO_PHASE',
  );
  near(e.windV + e.fetVds, e.sourceV, f.budgets.terminalReadTolerance, 'REPLAY_KVL');
  near(-e.windV, e.diodeV, f.budgets.terminalReadTolerance, 'REPLAY_DIODE');
  near(e.current, e.fetA + e.diodeA, e.kcl, 'REPLAY_KCL');
  near(e.sourceA + e.diodeA, e.current, e.kcl, 'REPLAY_SOURCE_KCL');
  near(e.gpioA, e.gateA, e.kcl, 'REPLAY_GATE_KCL');
  check(Object.is(e.powerIn, 6 * e.sourceA + e.logic * e.gpioA), 'INDEPENDENT_SOURCE_POWER');
  check(
    Object.is(
      e.powerCircuit,
      (6 - e.sourceV) * e.sourceA +
        (e.logic - e.gpio) * e.gpioA +
        e.fetVds * e.fetA +
        e.fetVgs * e.gateA +
        e.diodeV * e.diodeA,
    ),
    'INDEPENDENT_CIRCUIT_DISSIPATION',
  );
  near(e.torque * dt, e.impulse, 1e-16, 'REPLAY_IMPULSE');
  const motorOmega = 48 * frame.pre.qvel[6]!,
    motorEffort = 0.004265352474862795 * e.current - 5.430815443229305e-7 * motorOmega;
  const reverse = motorOmega * motorEffort < 0;
  check(reverse === frame.reverse, 'REPLAY_REVERSE_PHASE');
  near(
    frame.effort,
    frame.from >= 250003 && reverse ? motorEffort * 48 : e.impulse / dt,
    1e-12,
    'REPLAY_APPLIED_EFFORT',
  );
}

export interface HistoryRecord {
  kind: string;
  generation?: number;
  record?: Record<string, unknown>;
  offset?: number;
  bytes?: number;
  sha256?: string;
  count?: number;
  firstTick?: number;
  runCase?: R5RunCase;
  endpoint?: 'initial' | 'final';
  atNativeSeconds?: number;
}
async function digestBytes(bytes: Uint8Array) {
  const copy = Uint8Array.from(bytes);
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', copy)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}
export async function verifyEndpointDigest(
  endpoint: EndpointEnergy,
  record: Pick<HistoryRecord, 'bytes' | 'sha256' | 'atNativeSeconds'>,
) {
  const packet = checkEndpointEnergy(endpoint).packet;
  const bytes = Uint8Array.from(packet.match(/../g)!, (v) => Number.parseInt(v, 16));
  const digest = await digestBytes(bytes);
  check(
    record.bytes === bytes.length &&
      record.sha256 === digest &&
      Object.is(record.atNativeSeconds, endpoint.state.time),
    'ENDPOINT_RAW_DIGEST',
  );
  return digest;
}

export async function replayPair(
  records: HistoryRecord[],
  binary: Uint8Array,
  expected: { source: string; parameters: RampParameters; historical: boolean },
) {
  const built = buildRampScene(SOURCE_FIXTURE, expected.parameters),
    f = expected.historical ? SOURCE_FIXTURE : built.fixture;
  const expectedXml = expected.historical
    ? configuration.history.xmlSha256
    : sameParameters(parameters(expected.parameters), parameters(BASELINE))
      ? configuration.history.xmlSha256
      : sameParameters(parameters(expected.parameters), parameters(EDITED))
        ? configuration.editedXmlSha256
        : await digestBytes(new TextEncoder().encode(built.xml));
  const worlds = new Map<
    number,
    {
      runCase: R5RunCase;
      observer: PhysicalWitness;
      at: number;
      count: number;
      census: number;
      post: number[] | null;
      prefix: Uint8Array[];
      finish: Record<string, unknown> | null;
      cleanup: Record<string, unknown> | null;
      model: Parameters<typeof checkEndpointReadback>[1];
      initial: EndpointEnergy | null;
      endpointDigests: Partial<Record<'initial' | 'final', string>>;
    }
  >();
  let offset = 0;
  for (const item of records) {
    if (item.kind === 'proof') {
      const r = item.record!;
      check(r && Number.isSafeInteger(item.generation), 'HISTORY_PROOF');
      const generation = item.generation!;
      if (r.kind === 'factory') {
        const pins = r.pins as Record<string, unknown>,
          model = r.model as Record<string, unknown>;
        check(
          !worlds.has(generation) &&
            worlds.size < 2 &&
            (r.runCase === 'powered' || r.runCase === 'control') &&
            pins.buildCommit === expected.source &&
            pins.xmlSha256 === expectedXml &&
            pins.fixtureSha256 === configuration.history.fixtureSha256 &&
            r.runTimeUs === 0,
          'HISTORY_FACTORY_PINS',
        );
        if (!expected.historical) {
          check(
            JSON.stringify(parameters(r.parameters)) ===
              JSON.stringify(parameters(expected.parameters)),
            'REPLAY_FACTORY_PARAMETERS',
          );
          const compiled = model.compiledTerrain as {
            localF32: number[];
            position: number[];
            matrix: number[];
            faces: number[][];
          };
          check(compiled, 'REPLAY_COMPILED_GEOMETRY_REQUIRED');
          compiledRampWitness({ ...compiled, faces: compiled.faces.flat() }, built.expected);
        }
        const observer = new PhysicalWitness(
          f,
          r.runCase,
          { geometries: model.geometry as R5StandScene['geometries'] },
          expected.historical,
        );
        const initial = expected.historical ? null : (r.energy as EndpointEnergy);
        if (initial) {
          check(
            JSON.stringify(model.energyModel) === JSON.stringify(ENERGY_MODEL),
            'REPLAY_PINNED_ENERGY_MODEL',
          );
          checkEndpointReadback(
            initial,
            model as unknown as Parameters<typeof checkEndpointReadback>[1],
          );
          const initialState = model.initial as NativeState;
          check(
            initial.state.time === 0 &&
              sameWords(initial.state.qpos, initialState.qpos) &&
              sameWords(initial.state.qvel, initialState.qvel),
            'REPLAY_FACTORY_ENERGY_STATE',
          );
          observer.startEnergy(initial);
        }
        worlds.set(generation, {
          runCase: r.runCase,
          observer,
          model: model as unknown as Parameters<typeof checkEndpointReadback>[1],
          initial,
          endpointDigests: {},
          at: 0,
          count: 0,
          census: 0,
          post: null,
          prefix: [],
          finish: null,
          cleanup: null,
        });
      } else if (r.kind === 'finish') {
        const owner = worlds.get(generation);
        check(owner && !owner.finish, 'HISTORY_FINISH');
        owner.finish = r;
      } else if (r.kind === 'cleanup') {
        const owner = worlds.get(generation);
        check(owner && !owner.cleanup, 'HISTORY_CLEANUP');
        owner.cleanup = r;
      }
    } else if (item.kind === 'endpoint-energy-digest') {
      const owner = worlds.get(item.generation!);
      check(
        owner && !expected.historical && (item.endpoint === 'initial' || item.endpoint === 'final'),
        'ENDPOINT_DIGEST_OWNER',
      );
      const endpoint =
        item.endpoint === 'initial'
          ? owner.initial
          : (owner.finish?.endpointEnergy as EndpointEnergy | undefined);
      check(endpoint && !owner.endpointDigests[item.endpoint], 'ENDPOINT_DIGEST_ONCE');
      const digest = await verifyEndpointDigest(endpoint, item);
      owner.endpointDigests[item.endpoint] = digest;
    } else if (item.kind === 'binary-chunk') {
      const owner = worlds.get(item.generation!);
      check(
        owner &&
          !owner.finish &&
          item.offset === offset &&
          item.bytes !== undefined &&
          item.bytes > 0 &&
          offset + item.bytes <= binary.length &&
          item.firstTick === owner.count + 1 &&
          item.runCase === owner.runCase,
        'HISTORY_CHUNK_IDENTITY',
      );
      const bytes = binary.subarray(offset, offset + item.bytes!);
      check(
        (await digestBytes(bytes)) === item.sha256 && bytes.length % 8 === 0,
        'HISTORY_CHUNK_DIGEST',
      );
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const words = Float64Array.from({ length: bytes.length / 8 }, (_, i) =>
        view.getFloat64(i * 8, true),
      );
      let at = 0,
        count = 0;
      while (at < words.length) {
        const decoded = frameFromWords(words, at),
          frame = decoded.frame;
        check(
          frame.from === owner.at &&
            Number.isSafeInteger(frame.to) &&
            frame.to > frame.from &&
            frame.to - frame.from <= 500 &&
            frame.to <= 10000000 &&
            Math.abs(frame.pre.time * 1e6 - frame.from) <= 0.01 &&
            Math.abs(frame.post.time * 1e6 - frame.to) <= 0.01,
          'HISTORY_CLOCK',
        );
        if (owner.post)
          check(
            sameWords(owner.post, [...frame.pre.qpos, ...frame.pre.qvel]),
            'HISTORY_CONTINUITY_BITS',
          );
        verifyElectricalFrame(frame, f, owner.runCase);
        owner.observer.observe(frame);
        owner.post = [...frame.post.qpos, ...frame.post.qvel];
        owner.at = frame.to;
        owner.count++;
        owner.census += decoded.ncon;
        check(owner.census <= 450000 && owner.count <= 22000, 'HISTORY_CAP');
        if (frame.to <= 250003) owner.prefix.push(bytes.slice(at * 8, decoded.next * 8));
        at = decoded.next;
        count++;
      }
      check(count === item.count, 'HISTORY_CHUNK_INTERVALS');
      offset += item.bytes!;
    }
  }
  check(offset === binary.length && worlds.size === 2, 'HISTORY_COMPLETE_BYTES');
  const result = [];
  for (const owner of worlds.values()) {
    const { finish, cleanup } = owner;
    check(
      finish &&
        cleanup &&
        owner.count === 20090 &&
        owner.at === 10000000 &&
        finish.runtime === 'COMPLETE' &&
        finish.tickId === owner.count,
      'HISTORY_COMPLETE_WORLD',
    );
    const end = expected.historical ? undefined : (finish.endpointEnergy as EndpointEnergy);
    if (!expected.historical) {
      check(
        end && owner.endpointDigests.initial && owner.endpointDigests.final,
        'BOTH_DURABLE_ENERGY_ENDPOINTS',
      );
      checkEndpointReadback(end!, owner.model);
    }
    const physical = owner.observer.complete(owner.at, end);
    if (!expected.historical)
      check(
        JSON.stringify(physical.fullEnergy) === JSON.stringify(finish.fullEnergy) &&
          JSON.stringify(physical.upperSupport) === JSON.stringify(finish.upperSupport),
        'REPLAY_FULL_ENERGY_AND_UPPER_WINDOW',
      );
    check(
      (!expected.historical || physical.physical === 'PASS') &&
        finish.physical === physical.physical &&
        finish.causal === 'GAP_CAUSAL_ALT' &&
        JSON.stringify(physical.landmarks) === JSON.stringify(finish.landmarks) &&
        JSON.stringify(physical.energy) === JSON.stringify(finish.energy),
      'HISTORY_PHYSICAL_AND_SIGNED_WORK',
    );
    check(
      cleanup.owned === cleanup.freed &&
        ['step1', 'step1Returned', 'step2', 'step2Returned'].every(
          (k) => cleanup[k] === owner.count,
        ) &&
        Array.isArray(cleanup.cleanupFailures) &&
        cleanup.cleanupFailures.length === 0,
      'HISTORY_RESOURCES',
    );
    const size = owner.prefix.reduce((n, b) => n + b.length, 0),
      prefix = new Uint8Array(size);
    let n = 0;
    for (const bytes of owner.prefix) {
      prefix.set(bytes, n);
      n += bytes.length;
    }
    result.push({
      runCase: owner.runCase,
      intervals: owner.count,
      census: owner.census,
      physical: physical.physical,
      energy: physical.energy,
      prefix: await digestBytes(prefix),
    });
  }
  check(
    result[0]!.runCase === 'powered' &&
      result[1]!.runCase === 'control' &&
      result[0]!.prefix === result[1]!.prefix,
    'HISTORY_COMMON_503',
  );
  return {
    schema: 'ASA_EDITABLE_RAMP_PAIR_REPLAY_V1',
    noNative: true,
    intervals: 40180,
    worlds: result,
  };
}

export async function replayHistory(records: HistoryRecord[], binary: Uint8Array) {
  return replayPair(records, binary, {
    source: configuration.history.source,
    parameters: BASELINE,
    historical: true,
  });
}

/** True renderer matrices, column-major Three/WebGL convention; observation only. */
export function groundScreenPoint(
  projection: number[],
  inverseWorld: number[],
  width: number,
  height: number,
  x: number,
  y: number,
) {
  check(
    projection.length === 16 &&
      inverseWorld.length === 16 &&
      [...projection, ...inverseWorld, width, height, x, y].every(Number.isFinite) &&
      width > 0 &&
      height > 0,
    'RENDER_PROJECTION',
  );
  const multiply = (m: number[], v: number[]) =>
    [0, 1, 2, 3].map((row) => [0, 1, 2, 3].reduce((sum, k) => sum + m[k * 4 + row]! * v[k]!, 0));
  const p = multiply(projection, multiply(inverseWorld, [x, 0, -y, 1]));
  check(p[3]! > 0 && Number.isFinite(p[3]), 'RENDER_FORWARD_POINT');
  return { x: ((p[0]! / p[3]! + 1) * width) / 2, y: ((1 - p[1]! / p[3]!) * height) / 2 };
}
