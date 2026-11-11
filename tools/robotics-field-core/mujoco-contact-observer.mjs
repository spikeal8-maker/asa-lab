import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { closeSync, fsyncSync, openSync, writeSync } from 'node:fs';
import { types } from 'node:util';

export const demand = (value, message) => {
  if (!value) throw new Error(message);
};
export const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
export const add = (a, b) => a.map((x, i) => x + b[i]);
export const sub = (a, b) => a.map((x, i) => x - b[i]);
export const scale = (a, s) => a.map((x) => x * s);
export const norm = (a) => Math.hypot(...a);
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const radians = (degrees) => (degrees * Math.PI) / 180;
export const degrees = (angle) => (angle * 180) / Math.PI;
export const gamma = (n) => (n * Number.EPSILON) / (1 - n * Number.EPSILON);
export const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const portableError = (error) =>
  String(error)
    .replace(/^Error: /, '')
    .match(/^[A-Z][A-Z0-9_]+/)?.[0] ?? 'NATIVE_OR_IO_ERROR';
export const finite = (v) => {
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v) || ArrayBuffer.isView(v)) return Array.from(v).every(finite);
  if (v && typeof v === 'object') return Object.values(v).every(finite);
  return true;
};

const KEY_CACHE_MAX_ENTRIES = 256;
const KEY_CACHE_MAX_BYTES = 16 * 1024;
const KEY_CACHE_MAX_KEY_BYTES = 256;
const objectKeyBytesCache = new Map();
let objectKeyPayloadBytes = 0;

// Keys alone are immutable strings. Each retained payload owns an unpooled,
// exact-sized allocation; saturated/oversized misses retain nothing.
function objectKeyBytes(key) {
  const hit = objectKeyBytesCache.get(key);
  if (hit !== undefined) return hit;
  const length = Buffer.byteLength(key, 'utf8');
  if (
    length > KEY_CACHE_MAX_KEY_BYTES ||
    objectKeyBytesCache.size >= KEY_CACHE_MAX_ENTRIES ||
    objectKeyPayloadBytes + length > KEY_CACHE_MAX_BYTES
  ) {
    return Buffer.from(key, 'utf8');
  }
  const bytes = Buffer.allocUnsafeSlow(length);
  demand(bytes.write(key, 0, length, 'utf8') === length, 'RAW_KEY_UTF8_LENGTH');
  objectKeyBytesCache.set(key, bytes);
  objectKeyPayloadBytes += length;
  return bytes;
}

// Pure accounting only: no key, Buffer, backing store or cache mutation escapes.
export function canonicalKeyCacheUsage() {
  let retainedBackingBytes = 0;
  let stringCodeUnits = 0;
  let unpooled = true;
  for (const [key, bytes] of objectKeyBytesCache) {
    retainedBackingBytes += bytes.buffer.byteLength;
    stringCodeUnits += key.length;
    unpooled &&= bytes.byteOffset === 0 && bytes.buffer.byteLength === bytes.length;
  }
  return Object.freeze({
    entries: objectKeyBytesCache.size,
    payloadBytes: objectKeyPayloadBytes,
    retainedBackingBytes,
    stringCodeUnits,
    unpooled,
    maxEntries: KEY_CACHE_MAX_ENTRIES,
    maxPayloadBytes: KEY_CACHE_MAX_BYTES,
    maxKeyBytes: KEY_CACHE_MAX_KEY_BYTES,
  });
}

const ordinaryArrayIterator = Object.getOwnPropertyDescriptor(
  Array.prototype,
  Symbol.iterator,
).value;
const arrayIteratorPrototype = Object.getPrototypeOf(ordinaryArrayIterator.call([]));
const ordinaryArrayIteratorNext = Object.getOwnPropertyDescriptor(
  arrayIteratorPrototype,
  'next',
).value;

function ordinaryArrayIteration() {
  return (
    Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator)?.value ===
      ordinaryArrayIterator &&
    Object.getOwnPropertyDescriptor(arrayIteratorPrototype, 'next')?.value ===
      ordinaryArrayIteratorNext
  );
}

function smallPlainNumberVector(value) {
  if (
    types.isProxy(value) ||
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype
  ) {
    return false;
  }
  const length = value.length;
  if (length !== 2 && length !== 3 && length !== 5) return false;
  // Includes Symbol.iterator and non-index keys, without invoking accessors.
  if (Reflect.ownKeys(value).length !== length + 1) return false;
  for (let i = 0; i < length; i += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, i);
    if (
      !descriptor ||
      !Object.hasOwn(descriptor, 'value') ||
      typeof descriptor.value !== 'number'
    ) {
      return false;
    }
  }
  return true;
}

// Only the five 2/3/5-number assessContacts comparisons use this fast domain.
// Validate BOTH complete vectors before any unequal result: an unsupported
// later element must still reach the original byte encoder and its error.
export function numberVectorEqual(a, b) {
  if (!ordinaryArrayIteration() || !smallPlainNumberVector(a) || !smallPlainNumberVector(b)) {
    return canonicalEqual(a, b);
  }
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (!Object.is(a[i], b[i])) return false;
  }
  return true;
}

/** Fixed schema tags: null0,false1,true2,f64=3,UTF8=4,array5,object6,bytes7.
 * Lengths/counts are U32LE; object keys sort by UTF8 bytes; f64 keeps signed zero.
 * All NaN payloads canonicalize to quiet 0x7ff8000000000000. Nonfinite values
 * still fail the physical guards: this encoding preserves the failed attempt.
 */
export function canonicalBytes(value) {
  let out = Buffer.allocUnsafe(4096);
  let at = 0;
  const room = (n) => {
    if (at + n <= out.length) return;
    const next = Buffer.allocUnsafe(Math.max(out.length * 2, at + n));
    out.copy(next, 0, 0, at);
    out = next;
  };
  const tag = (n) => {
    room(1);
    out[at++] = n;
  };
  const u32 = (n) => {
    demand(Number.isSafeInteger(n) && n >= 0 && n <= 0xffffffff, 'RAW_LENGTH');
    room(4);
    out.writeUInt32LE(n, at);
    at += 4;
  };
  const write = (v) => {
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
      u32(v.length);
      for (const x of v) write(x);
      return;
    }
    demand(v && typeof v === 'object', 'RAW_UNSUPPORTED_TYPE ' + typeof v);
    const keys = Object.keys(v).sort((a, b) =>
      Buffer.compare(objectKeyBytes(a), objectKeyBytes(b)),
    );
    tag(6);
    u32(keys.length);
    for (const key of keys) {
      const bytes = objectKeyBytes(key);
      tag(4);
      u32(bytes.length);
      room(bytes.length);
      bytes.copy(out, at);
      at += bytes.length;
      write(v[key]);
    }
  };
  write(value);
  // Ring bytes own exactly their payload allocation, not an oversized backing
  // buffer retained by subarray. This makes the registered RAM bound literal.
  return Buffer.from(out.subarray(0, at));
}

export function canonicalEqual(a, b) {
  return canonicalBytes(a).equals(canonicalBytes(b));
}

export class StepChain {
  constructor() {
    this.hash = createHash('sha256');
    this.count = 0;
  }
  push(bytes) {
    const h = createHash('sha256').update(bytes).digest();
    this.hash.update(h);
    this.count += 1;
    return h.toString('hex');
  }
  checkpoint() {
    return { ticks: this.count, sha256: this.hash.copy().digest('hex') };
  }
}

/** Streaming retained journal, not a dense trajectory archive. */
export class RawJournal {
  constructor(path, retention) {
    this.path = path;
    this.limit = retention.maxJournalBytes;
    this.bytes = 0;
    this.hash = createHash('sha256');
    this.fd = openSync(path, 'wx');
    this.closed = false;
    this.reserve = retention.reservedFailureTrailerBytes;
    try {
      this.append({
        kind: 'schema',
        schema: retention.schema,
        encoding: retention.numericEncoding,
        framing: retention.recordFraming,
        strings: retention.strings,
        perTick: retention.perTick,
        reservedFailureTrailerBytes: this.reserve,
      });
    } catch (primary) {
      let closeError = null;
      try {
        closeSync(this.fd);
      } catch (error) {
        closeError = String(error);
      }
      this.closed = true;
      throw new Error(String(primary) + (closeError ? '; close: ' + closeError : ''), {
        cause: primary,
      });
    }
  }
  append(record, final = false) {
    demand(!this.closed, 'RAW_JOURNAL_CLOSED');
    const bytes = canonicalBytes(record);
    const size = Buffer.alloc(4);
    size.writeUInt32LE(bytes.length);
    demand(
      this.bytes + 4 + bytes.length <= this.limit - (final ? 0 : this.reserve),
      'RESOURCE_JOURNAL_BYTE_CAP',
    );
    for (const b of [size, bytes]) {
      let offset = 0;
      while (offset < b.length) {
        const written = writeSync(this.fd, b, offset, b.length - offset);
        demand(written > 0, 'RAW_WRITE_ZERO');
        this.hash.update(b.subarray(offset, offset + written));
        this.bytes += written;
        offset += written;
      }
    }
  }
  checkpoint() {
    fsyncSync(this.fd);
  }
  finish(record) {
    if (this.closed) return this.result;
    let trailerError = null;
    let closeError = null;
    try {
      this.append(record, true);
      fsyncSync(this.fd);
    } catch (error) {
      trailerError = String(error);
    } finally {
      try {
        closeSync(this.fd);
      } catch (error) {
        closeError = String(error);
      }
      this.closed = true;
    }
    this.result = { bytes: this.bytes, sha256: this.hash.digest('hex'), trailerError, closeError };
    return this.result;
  }
}

export class TickRetention {
  constructor(journal, fixture, world, dtUs) {
    this.journal = journal;
    this.r = fixture.retention;
    this.world = world;
    this.count = this.r.preWindowUs / dtUs;
    demand(
      Number.isInteger(this.count) && this.count <= this.r.maxRingTicks,
      'RESOURCE_RING_COUNT',
    );
    this.ring = new Array(this.count);
    this.size = 0;
    this.cursor = 0;
    this.firstEventTick = null;
    this.failureSaved = false;
    this.postTicks = this.r.postWindowUs / dtUs;
    this.dtUs = dtUs;
    this.chain = new StepChain();
    this.lastTickDigest = null;
  }
  prepare(record) {
    const bytes = canonicalBytes(record);
    demand(bytes.length <= this.r.maxTickBytes, 'RESOURCE_TICK_BYTE_CAP');
    this.lastTickDigest = this.chain.push(bytes);
    return bytes;
  }
  retain(record, prepared = null) {
    const bytes = prepared ?? this.prepare(record);
    if (
      this.firstEventTick !== null &&
      record.tick > this.firstEventTick &&
      record.tick <= this.firstEventTick + this.postTicks
    ) {
      this.journal.append({ kind: 'post-event-tick', world: this.world, tick: record.tick, bytes });
    }
    this.ring[this.cursor] = { tick: record.tick, bytes };
    this.cursor = (this.cursor + 1) % this.count;
    this.size = Math.min(this.size + 1, this.count);
  }
  window(kind, emergency = false) {
    this.journal.append(
      { kind: kind + '-window-start', world: this.world, count: this.size },
      emergency,
    );
    for (let i = 0; i < this.size; i += 1) {
      const item = this.ring[(this.cursor - this.size + i + this.count) % this.count];
      this.journal.append(
        { kind, world: this.world, tick: item.tick, bytes: item.bytes },
        emergency,
      );
    }
    this.journal.checkpoint();
  }
  event(tick, event, observation) {
    demand(this.firstEventTick === null, 'FIRST_EVENT_ALREADY_FROZEN');
    this.firstEventTick = tick;
    this.window('pre-event-tick');
    this.journal.append({
      kind: 'first-event',
      world: this.world,
      tick,
      event,
      observation,
      chain: this.chain.checkpoint(),
    });
  }
  failure(tick, observation, error) {
    if (this.failureSaved) return;
    this.window('pre-failure-tick', true);
    let saved = observation;
    const observationBytes = canonicalBytes(observation);
    if (observationBytes.length > this.r.maxFailureObservationBytes) {
      // A record-size violation cannot recursively overrun the emergency
      // reserve. The external attempt receipt still keeps the full observation.
      saved = {
        resourceFailure: 'FAILURE_OBSERVATION_BYTE_CAP',
        fullObservationBytes: observationBytes.length,
        fullObservationSha256: digest(observationBytes),
        tick: observation.tick,
        dispatch: observation.dispatch,
        returned: observation.returned,
        unreturnedNativeAdvancePossible: observation.unreturnedNativeAdvancePossible,
        native: observation.native,
        nativeReadErrors: observation.nativeReadErrors,
      };
    }
    this.journal.append(
      {
        kind: 'failure',
        world: this.world,
        tick,
        observation: saved,
        error: portableError(error),
        chain: this.chain.checkpoint(),
      },
      true,
    );
    this.journal.checkpoint();
    this.failureSaved = true;
  }
}

export function quaternionMatrix(q) {
  const [w, x, y, z] = q;
  return [
    1 - 2 * (y * y + z * z),
    2 * (x * y - w * z),
    2 * (x * z + w * y),
    2 * (x * y + w * z),
    1 - 2 * (x * x + z * z),
    2 * (y * z - w * x),
    2 * (x * z - w * y),
    2 * (y * z + w * x),
    1 - 2 * (x * x + y * y),
  ];
}
export const rotate = (r, v) => [0, 1, 2].map((i) => dot(r.slice(3 * i, 3 * i + 3), v));
export const unrotate = (r, v) =>
  [0, 1, 2].map((i) => r[i] * v[0] + r[i + 3] * v[1] + r[i + 6] * v[2]);
export const ry = (angle) => [
  Math.cos(angle),
  0,
  Math.sin(angle),
  0,
  1,
  0,
  -Math.sin(angle),
  0,
  Math.cos(angle),
];
export function floorFrame(theta) {
  const rotation = ry(theta);
  const normal = rotate(rotation, [0, 0, 1]);
  const downhill = rotate(rotation, [1, 0, 0]);
  return { rotation, normal, downhill, positiveTipAxis: cross(normal, downhill) };
}
export function relativePointVelocity(p, a, b) {
  return sub(
    add(b.velocity, cross(b.omega, sub(p, b.com))),
    add(a.velocity, cross(a.omega, sub(p, a.com))),
  );
}
export function witnessPoints(contact) {
  const half = scale(contact.frame.slice(0, 3), contact.dist / 2);
  return [sub(contact.pos, half), add(contact.pos, half)];
}
export function contactWorldForce(frame, force) {
  return [0, 1, 2].map(
    (i) => frame[i] * force[0] + frame[i + 3] * force[1] + frame[i + 6] * force[2],
  );
}
export function forceAggregationBudget(contacts, sumAbsProducts, massKg, gravity = 9.81) {
  return gamma(4 * contacts + 64) * sumAbsProducts + 64 * Number.EPSILON * massKg * gravity;
}
export function frameError(frame) {
  const rows = [frame.slice(0, 3), frame.slice(3, 6), frame.slice(6, 9)];
  const e = [];
  for (let i = 0; i < 3; i += 1)
    for (let j = 0; j < 3; j += 1) e.push(Math.abs(dot(rows[i], rows[j]) - (i === j ? 1 : 0)));
  e.push(norm(sub(cross(rows[0], rows[1]), rows[2])));
  return Math.max(...e);
}

export function copyState(data) {
  const state = { time: data.time };
  for (const key of ['qpos', 'qvel', 'qacc', 'qacc_warmstart']) {
    const view = data[key];
    demand(view instanceof Float64Array, 'NATIVE_FLOAT64 ' + key);
    state[key] = Array.from(view);
  }
  return state;
}
export function phaseState(state) {
  return { qpos: state.qpos, qvel: state.qvel, time: state.time };
}
export function copyWarnings(data, resources) {
  // data.warning and model.opt are borrowed embedded references: never delete them.
  const vector = data.warning;
  const values = [];
  for (let i = 0; i < vector.size(); i += 1) {
    const stat = vector.get(i);
    demand(stat, 'NATIVE_WARNING_COPY_MISSING');
    resources.temporaryCreated += 1;
    try {
      values.push([stat.number, stat.lastinfo]);
    } finally {
      stat.delete();
      resources.temporaryDeleted += 1;
    }
  }
  return values;
}

const contactScalars = [
  'dist',
  'includemargin',
  'mu',
  'dim',
  'geom1',
  'geom2',
  'exclude',
  'efc_address',
  'adhesion',
];
const contactArrays = [
  'pos',
  'frame',
  'friction',
  'solref',
  'solreffriction',
  'solimp',
  'geom',
  'flex',
  'elem',
  'vert',
  'surfacevel',
  'H',
];
export function copyContacts(data, resources) {
  // Unlike warning, contact() RETURNS std::vector<MjContact> BY VALUE.
  const vector = data.contact;
  resources.temporaryCreated += 1;
  const values = [];
  try {
    demand(vector.size() === data.ncon, 'CONTACT_VECTOR_COUNT');
    for (let i = 0; i < vector.size(); i += 1) {
      const c = vector.get(i);
      demand(c, 'CONTACT_COPY_MISSING');
      resources.temporaryCreated += 1;
      try {
        const saved = { index: i };
        for (const key of contactScalars) saved[key] = c[key];
        for (const key of contactArrays) saved[key] = Array.from(c[key]);
        values.push(saved);
      } finally {
        c.delete();
        resources.temporaryDeleted += 1;
      }
    }
  } finally {
    vector.delete();
    resources.temporaryDeleted += 1;
  }
  return values;
}
export function contactIdentity(c) {
  // mu and H are solver caches, explicitly excluded; geometry and authored
  // contact parameters must remain unchanged between forward and force capture.
  const v = {};
  for (const key of [
    ...contactScalars.filter((x) => x !== 'mu'),
    ...contactArrays.filter((x) => x !== 'H'),
  ])
    v[key] = c[key];
  return v;
}

export function nativeBodyKinematics(M, model, data, bodyIds, resources, buffer) {
  const result = {};
  for (const id of bodyIds) {
    M.mj_objectVelocity(model, data, 1, id, buffer, 0);
    const velocity = Array.from(buffer.GetView());
    demand(velocity.length === 6 && finite(velocity), 'BODY_VELOCITY_BUFFER');
    result[id] = {
      com: Array.from(data.xipos).slice(id * 3, id * 3 + 3),
      rotation: Array.from(data.xmat).slice(id * 9, id * 9 + 9),
      quaternion: Array.from(data.xquat).slice(id * 4, id * 4 + 4),
      omega: velocity.slice(0, 3),
      velocity: velocity.slice(3, 6),
    };
    resources.velocityCalls += 1;
  }
  return result;
}

export function nativeObservationBounds(data, limits) {
  for (const [key, cap] of [
    ['ncon', limits.maxContacts],
    ['nefc', limits.maxConstraintRows],
    ['nisland', limits.maxIslands],
  ])
    demand(
      Number.isSafeInteger(data[key]) && data[key] >= 0 && data[key] <= cap,
      'RESOURCE_BEFORE_NATIVE_OBSERVATION ' + key,
    );
}
export function captureForward(M, model, data, preState, ids, resources, buffer, limits) {
  nativeObservationBounds(data, limits);
  const contacts = copyContacts(data, resources);
  return {
    state: phaseState(preState),
    bodies: nativeBodyKinematics(M, model, data, ids.bodyIds, resources, buffer),
    contacts,
    efcVel: Array.from(data.efc_vel),
    efcType: Array.from(data.efc_type),
    efcId: Array.from(data.efc_id),
    ncon: data.ncon,
    nefc: data.nefc,
  };
}
export function captureForces(M, model, data, forward, resources, buffer, limits) {
  nativeObservationBounds(data, limits);
  const after = copyContacts(data, resources);
  demand(
    canonicalEqual(forward.contacts.map(contactIdentity), after.map(contactIdentity)),
    'CONTACT_GEOMETRY_CHANGED_DURING_STEP2',
  );
  const contacts = after.map((contact, i) => {
    M.mj_contactForce(model, data, i, buffer);
    resources.contactForceCalls += 1;
    return { ...contact, force: Array.from(buffer.GetView()) };
  });
  return {
    contacts,
    efcForce: Array.from(data.efc_force),
    qfrcConstraint: Array.from(data.qfrc_constraint),
    qfrcActuator: Array.from(data.qfrc_actuator),
    actuatorForce: Array.from(data.actuator_force),
    qacc: Array.from(data.qacc),
    solverIterations: Array.from(data.solver_niter),
    islands: data.nisland,
    warnings: copyWarnings(data, resources),
    endpoint: copyState(data),
  };
}

/** Support is a source-backed candidate witness check, not a CCD normal bound. */
export function supportWitness(contact, bodyGeom, body, floor, shape, f) {
  const geom = contact.geom;
  const bodySlot = geom[0] === bodyGeom ? 0 : geom[1] === bodyGeom ? 1 : -1;
  demand(bodySlot >= 0, 'SUPPORT_BODY_GEOM_NOT_IN_CONTACT');
  const points = witnessPoints(contact);
  const localBody = unrotate(body.rotation, sub(points[bodySlot], body.com));
  const localFloor = unrotate(floor.rotation, points[1 - bodySlot]);
  const c = f.contact;
  const halfHeight = shape.kind === 'cylinder' ? shape.height / 2 : shape.dimensions[2] / 2;
  const baseError = Math.abs(localBody[2] + halfHeight);
  const floorError = Math.abs(localFloor[2]);
  let footprint;
  if (shape.kind === 'cylinder')
    footprint = Math.hypot(localBody[0], localBody[1]) <= shape.radius + c.cylinderRadiusAllowanceM;
  else
    footprint =
      Math.abs(localBody[0]) <= shape.dimensions[0] / 2 + c.basePlaneToleranceM &&
      Math.abs(localBody[1]) <= shape.dimensions[1] / 2 + c.basePlaneToleranceM;
  const floorInterior =
    Math.abs(localFloor[0]) <= f.bodies.floor.halfExtentsM[0] - c.floorInteriorMarginM &&
    Math.abs(localFloor[1]) <= f.bodies.floor.halfExtentsM[1] - c.floorInteriorMarginM;
  // Face-domain candidates are admitted only by both surface/footprint checks.
  // This does not assert a normal-direction accuracy bound or a general
  // edge-edge witness theorem. Unsupported candidate geometry stays UNKNOWN.
  const faceDomain =
    shape.kind !== 'block' ||
    (baseError <= c.basePlaneToleranceM &&
      floorError <= c.floorPlaneToleranceM &&
      footprint &&
      floorInterior);
  const baseWorld = add(body.com, rotate(body.rotation, [0, 0, -halfHeight]));
  const downhillRadius = dot(sub(points[bodySlot], baseWorld), floor.downhill);
  return {
    supported:
      baseError <= c.basePlaneToleranceM &&
      floorError <= c.floorPlaneToleranceM &&
      footprint &&
      floorInterior &&
      faceDomain,
    baseError,
    floorError,
    footprint,
    floorInterior,
    faceDomain,
    localBody,
    localFloor,
    bodyPoint: points[bodySlot],
    floorPoint: points[1 - bodySlot],
    downhillRadius,
    downhillRim:
      shape.kind === 'cylinder' && downhillRadius >= c.loadedDownhillRimFraction * shape.radius,
  };
}

export function assessContacts(f, forward, force, ids, floor) {
  demand(finite(forward) && finite(force), 'NONFINITE_CONTACT_OR_FORCE');
  demand(
    forward.ncon <= f.resources.maxContacts &&
      forward.nefc <= f.resources.maxConstraintRows &&
      force.islands <= f.resources.maxIslands,
    'RESOURCE_NATIVE_CONTACT_ROWS_ISLANDS',
  );
  const report = {
    bodies: {},
    contacts: [],
    maxVelocityError: 0,
    maxFrameError: 0,
    maxForceAggregationError: 0,
    maxForceAggregationBudget: 0,
  };
  for (const shape of ids.freeBodies)
    report.bodies[shape.name] = {
      loaded: 0,
      maxSlip: 0,
      outwardForce: 0,
      supported: true,
      downhillRim: true,
      forceSum: [0, 0, 0],
      sumAbsProducts: [0, 0, 0],
      contactCount: 0,
    };
  for (let i = 0; i < forward.contacts.length; i += 1) {
    const c = forward.contacts[i];
    const solved = force.contacts[i];
    const fn = solved.force[0];
    demand(fn >= 0, 'UNKNOWN_NEGATIVE_NORMAL_FORCE_WITH_ZERO_ADHESION');
    const frameErr = frameError(c.frame);
    report.maxFrameError = Math.max(report.maxFrameError, frameErr);
    demand(frameErr <= f.contact.frameOrthonormalTolerance, 'CONTACT_FRAME_ORTHONORMALITY');
    const pair = ids.freeBodies.find((b) => c.geom.includes(b.geomId));
    demand(
      pair && c.geom.includes(ids.floorGeom) && c.dim === 3,
      'UNREGISTERED_CONTACT_PAIR_OR_DIM',
    );
    demand(
      numberVectorEqual(c.friction, f.contact.effectiveFriction) &&
        numberVectorEqual(c.solref, f.contact.solref) &&
        numberVectorEqual(c.solreffriction, f.contact.solreffriction) &&
        numberVectorEqual(c.solimp, f.contact.solimp) &&
        c.includemargin === 0 &&
        c.adhesion === 0 &&
        c.surfacevel.every((v) => v === 0),
      'NATIVE_EFFECTIVE_CONTACT_PARAMETERS',
    );
    const g0body = ids.geomBodies[c.geom[0]];
    const g1body = ids.geomBodies[c.geom[1]];
    const u = relativePointVelocity(c.pos, forward.bodies[g0body], forward.bodies[g1body]);
    const analytic = [0, 1, 2].map((row) => dot(c.frame.slice(row * 3, row * 3 + 3), u));
    const address = c.efc_address;
    const rowsValid =
      address >= 0 &&
      address + 3 <= forward.nefc &&
      [0, 1, 2].every(
        (j) => forward.efcType[address + j] === 7 && forward.efcId[address + j] === i,
      );
    const native = rowsValid ? forward.efcVel.slice(address, address + 3) : [];
    const err = rowsValid ? Math.max(...native.map((v, j) => Math.abs(v - analytic[j]))) : null;
    if (rowsValid) {
      report.maxVelocityError = Math.max(report.maxVelocityError, err);
      demand(
        err <= f.contact.velocityReconstructionToleranceMps,
        'CONTACT_POINT_VELOCITY_RECONSTRUCTION',
      );
    }
    const tangent = sub(u, scale(floor.normal, dot(u, floor.normal)));
    const speed = rowsValid ? Math.max(Math.hypot(native[1], native[2]), norm(tangent)) : null;
    const wforce = contactWorldForce(c.frame, solved.force);
    const body = report.bodies[pair.name];
    const sign = c.geom[1] === pair.geomId ? 1 : -1;
    body.contactCount += 1;
    for (let axis = 0; axis < 3; axis += 1) {
      body.forceSum[axis] += sign * wforce[axis];
      body.sumAbsProducts[axis] += [0, 1, 2].reduce(
        (s, k) => s + Math.abs(c.frame[3 * k + axis] * solved.force[k]),
        0,
      );
    }
    const rowForces = rowsValid ? force.efcForce.slice(address, address + 3) : [];
    if (rowsValid)
      demand(numberVectorEqual(rowForces, solved.force.slice(0, 3)), 'CONTACT_FORCE_EFC_PARITY');
    let witness = null;
    if (fn > 0) {
      demand(
        c.exclude === 0 && c.dist < 0 && c.includemargin === 0 && rowsValid,
        'UNKNOWN_LOADED_CONTACT_DOMAIN',
      );
      demand(
        c.adhesion === 0 &&
          c.surfacevel.every((x) => x === 0) &&
          solved.force.slice(3).every((x) => x === 0),
        'CONTACT_EXTRA_FORCE_DOF',
      );
      witness = supportWitness(c, pair.geomId, forward.bodies[pair.bodyId], floor, pair, f);
      body.loaded += 1;
      body.maxSlip = Math.max(body.maxSlip, speed);
      body.outwardForce += sign * dot(wforce, floor.normal);
      body.supported = body.supported && witness.supported;
      body.downhillRim = body.downhillRim && witness.downhillRim;
    }
    report.contacts.push({
      index: i,
      loaded: fn > 0,
      fn,
      speed,
      velocityError: err,
      nativeVelocity: native,
      reconstructedVelocity: analytic,
      worldForce: wforce,
      witness,
    });
  }
  for (const shape of ids.freeBodies) {
    const body = report.bodies[shape.name];
    body.downhillRim = body.loaded > 0 && body.downhillRim;
    for (let axis = 0; axis < 3; axis += 1) {
      const actual = force.qfrcConstraint[shape.dofAdr + axis];
      const error = Math.abs(body.forceSum[axis] - actual);
      const bound = forceAggregationBudget(
        body.contactCount,
        body.sumAbsProducts[axis],
        shape.mass,
      );
      report.maxForceAggregationError = Math.max(report.maxForceAggregationError, error);
      report.maxForceAggregationBudget = Math.max(report.maxForceAggregationBudget, bound);
      demand(error <= bound, 'CONTACT_FORCE_AGGREGATION_TRANSLATION');
    }
  }
  return report;
}

export function bodyEndpoint(state, shape) {
  const q = state.qpos.slice(shape.qposAdr + 3, shape.qposAdr + 7);
  const rotation = quaternionMatrix(q);
  // MuJoCo free-joint translational qvel is global; rotational qvel is local.
  return {
    com: state.qpos.slice(shape.qposAdr, shape.qposAdr + 3),
    quaternion: q,
    rotation,
    velocity: state.qvel.slice(shape.dofAdr, shape.dofAdr + 3),
    omega: rotate(rotation, state.qvel.slice(shape.dofAdr + 3, shape.dofAdr + 6)),
  };
}
export function tiltState(body, theta, omega, f) {
  const floor = floorFrame(theta);
  const axis = rotate(body.rotation, [0, 0, 1]);
  const relative = sub(body.omega, [0, omega, 0]);
  const phi = Math.atan2(norm(cross(axis, floor.normal)), dot(axis, floor.normal));
  const beta = Math.atan2(dot(axis, floor.downhill), dot(axis, floor.normal));
  const baseCenter = sub(body.com, scale(axis, f.bodies.cylinder.heightM / 2));
  // The uphill direction is the projection of -downhill onto the base plane.
  // The maximum rim height would be a different metric under sideways tilt.
  const uphill = add(scale(floor.downhill, -1), scale(axis, dot(axis, floor.downhill)));
  const uphillNorm = norm(uphill);
  const uphillDirectionValid = Number.isFinite(uphillNorm) && uphillNorm > 0;
  const uphillPoint = uphillDirectionValid
    ? add(baseCenter, scale(uphill, f.bodies.cylinder.radiusM / uphillNorm))
    : null;
  const lift = uphillPoint ? dot(uphillPoint, floor.normal) : null;
  const maximumRimLift =
    dot(baseCenter, floor.normal) + f.bodies.cylinder.radiusM * norm(cross(axis, floor.normal));
  return {
    theta,
    omega,
    phi,
    beta,
    relativeOmega: norm(relative),
    relativeOmegaY: dot(relative, floor.positiveTipAxis),
    uphillRimLift: lift,
    uphillDirectionValid,
    maximumRimLift,
  };
}
export function bodyEnergy(body, shape, gravity) {
  const localOmega = unrotate(body.rotation, body.omega);
  return (
    shape.mass * gravity * body.com[2] +
    0.5 * shape.mass * dot(body.velocity, body.velocity) +
    0.5 * localOmega.reduce((s, w, i) => s + shape.inertia[i] * w * w, 0)
  );
}
export function quaternionAngle(a, b) {
  const d = Math.abs(dot(a, b)) / (norm(a) * norm(b));
  return 2 * Math.acos(Math.min(1, Math.max(-1, d)));
}
export function effectiveTorque(u, thetaPre, omegaPre, omegaPost, nativeForce, stand) {
  const [lo, hi] = stand.forceRangeNm;
  const saturated = nativeForce <= lo || nativeForce >= hi;
  const effective = saturated ? nativeForce : nativeForce - stand.kv * (omegaPost - omegaPre);
  const endpointFormula = saturated
    ? nativeForce
    : stand.kp * (u - thetaPre) - stand.kv * omegaPost;
  const algebraBudget =
    gamma(12) *
      (Math.abs(stand.kp * u) +
        Math.abs(stand.kp * thetaPre) +
        Math.abs(stand.kv * omegaPre) +
        Math.abs(stand.kv * omegaPost) +
        Math.abs(nativeForce)) +
    8 * Number.EPSILON * Math.max(Math.abs(stand.forceRangeNm[0]), Math.abs(stand.forceRangeNm[1]));
  return {
    u,
    thetaPre,
    omegaPre,
    omegaPost,
    nativeForce,
    saturated,
    effective,
    endpointFormula,
    algebraBudget,
  };
}

/** N complete native intervals, including the final endpoint state-only check. */
export function assessWindow(records, f, dtUs, target, type) {
  const count = f.tilt.stationaryWindowUs / dtUs;
  demand(Number.isInteger(count), 'WINDOW_INTEGER_COUNT');
  if (records.length !== count) return { accepted: false, reason: 'INCOMPLETE_WINDOW' };
  for (let i = 1; i < count; i += 1)
    demand(records[i].tick === records[i - 1].tick + 1, 'WINDOW_NONCONSECUTIVE');
  const first = records[0];
  const last = records.at(-1);
  const states = records.map((r) => r.pre).concat([last.post]);
  const range = Math.max(...states.map((s) => s.theta)) - Math.min(...states.map((s) => s.theta));
  const supported = records.every((r) => r.loaded && r.supported && r.positiveSupport && r.noSlip);
  if (type === 'stable') {
    const t = f.tilt.stable;
    const stateOkay = states.every(
      (s) =>
        s.phi <= radians(t.maxFullAxisAngleDeg) &&
        s.relativeOmega <= t.maxRelativeOmegaRadps &&
        Math.abs(target - s.theta) <= radians(t.maxTrackingDeg) &&
        Math.abs(s.omega) <= t.maxFloorSpeedRadps,
    );
    return {
      accepted: supported && stateOkay && range <= radians(t.maxFloorAngleRangeDeg),
      range,
      intervals: count,
      durationUs: count * dtUs,
      firstTick: first.tick,
      lastTick: last.tick,
    };
  }
  demand(type === 'tip', 'WINDOW_TYPE');
  const t = f.tilt.tip;
  const stateOkay = states.every(
    (s) =>
      s.uphillDirectionValid &&
      s.beta >= radians(t.minDownhillBetaDeg) &&
      s.relativeOmegaY >= t.minRelativeOmegaYRadps &&
      s.uphillRimLift >= t.minUphillRimLiftM,
  );
  const growth = last.post.beta - first.pre.beta;
  return {
    accepted:
      supported &&
      records.every((r) => r.downhillRim) &&
      stateOkay &&
      growth >= radians(t.minBetaGrowthDeg),
    growth,
    range,
    intervals: count,
    durationUs: count * dtUs,
    firstTick: first.tick,
    lastTick: last.tick,
  };
}
