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
  constructor(journal, fixture, world, dtUs, tickByteCap = fixture.retention.maxTickBytes) {
    this.journal = journal;
    this.r = fixture.retention;
    this.world = world;
    demand(Number.isSafeInteger(tickByteCap) && tickByteCap > 0, 'RESOURCE_TICK_CAP');
    this.tickByteCap = tickByteCap;
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
    demand(bytes.length <= this.tickByteCap, 'RESOURCE_TICK_BYTE_CAP');
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

/** Explicit opt-in dispatch hook. Historical callers, including G0, omit it. */
export function nativeBoundary(hooks, api, operation, owned = null) {
  return hooks ? hooks.invoke(api, operation, owned) : operation();
}

export function copyState(data, hooks = null) {
  const state = { time: data.time };
  for (const key of ['qpos', 'qvel', 'qacc', 'qacc_warmstart']) {
    const view = data[key];
    demand(view instanceof Float64Array, 'NATIVE_FLOAT64 ' + key);
    state[key] = hooks?.strictDynamic
      ? boundedNativeArray(view, key === 'qpos' ? hooks.shape.nq : hooks.shape.nv, key, true)
      : Array.from(view);
  }
  if (hooks?.strictDynamic) demand(finite(state), 'NONFINITE_NATIVE_STATE');
  return state;
}
export function phaseState(state) {
  return { qpos: state.qpos, qvel: state.qvel, time: state.time };
}
export function copyWarnings(data, resources, hooks = null) {
  if (hooks?.strictDynamic) {
    // The embedded vector is borrowed; each get() result is owned.
    const vector = nativeBoundary(hooks, 'data.warning', () => data.warning);
    demand(
      nativeBoundary(hooks, 'warning.size', () => vector.size()) === hooks.warningCount,
      'NATIVE_WARNING_COUNT_BEFORE_COPY',
    );
    const values = [];
    for (let i = 0; i < hooks.warningCount; i += 1) {
      let stat = null;
      let primary = null;
      let cleanup = null;
      try {
        stat = nativeBoundary(hooks, 'warning.get', () => vector.get(i));
        noteOwned(resources, 'warningGetsCreated');
        const value = [stat.number, stat.lastinfo];
        demand(value.every(Number.isSafeInteger), 'NATIVE_WARNING_VALUE');
        values.push(value);
      } catch (error) {
        primary = error;
        hooks.stop(error);
      } finally {
        if (stat) cleanup = deleteOwned(stat, resources, 'warning', hooks);
      }
      if (primary) throw primary;
      if (cleanup) throw new Error('NATIVE_WRAPPER_CLEANUP', { cause: cleanup });
    }
    return values;
  }
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
export function copyContacts(data, resources, limits = null, hooks = null) {
  if (hooks?.strictDynamic) demand(limits?.pairCaps, 'DYNAMIC_REGISTERED_CONTACT_LIMITS_REQUIRED');
  if (limits?.pairCaps) return boundedContactCopies(data, resources, limits, false, hooks);
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

const boundedContactLengths = {
  pos: 3,
  frame: 9,
  friction: 5,
  solref: 2,
  solreffriction: 2,
  solimp: 5,
  geom: 2,
  flex: 2,
  elem: 2,
  vert: 2,
  surfacevel: 3,
  H: 36,
};

/** Check shape before allocation/copy; never truncate a native observation. */
export function boundedNativeArray(view, length, label, float64 = false) {
  demand(
    ArrayBuffer.isView(view) &&
      !(view instanceof DataView) &&
      view.length === length &&
      (!float64 || view instanceof Float64Array),
    'NATIVE_ARRAY_SHAPE ' + label,
  );
  const copied = Array.from(view);
  demand(finite(copied), 'NONFINITE_NATIVE_ARRAY ' + label);
  return copied;
}

function noteOwned(resources, kind, limit) {
  resources.temporaryCreated += 1;
  resources[kind] = (resources[kind] ?? 0) + 1;
  if (limit !== undefined) demand(resources[kind] <= limit, 'RESOURCE_OWNED_WRAPPER ' + kind);
}

function deleteOwned(value, resources, label, hooks = null) {
  try {
    const api = label === 'contact-vector' ? 'contactVector.delete' : label + '.delete';
    nativeBoundary(hooks, api, () => value.delete(), value);
    resources.temporaryDeleted += 1;
    return null;
  } catch (error) {
    const failure = { label, error: String(error) };
    (resources.cleanupErrors ??= []).push(failure);
    return error;
  }
}

/** Single acquisition per contact. Validate ALL pair counts before reading any
 * contact arrays. Limits are opt-in, so prior observer callers retain their path. */
function boundedContactCopies(data, resources, limits, geometryOnly, hooks = null) {
  nativeObservationBounds(data, limits);
  const vector = nativeBoundary(hooks, 'data.contact', () => {
    resources.contactVectorDispatched = (resources.contactVectorDispatched ?? 0) + 1;
    return data.contact;
  });
  resources.contactVectorReturned = (resources.contactVectorReturned ?? 0) + 1;
  const held = [];
  let primary = null;
  let cleanup = null;
  let values;
  try {
    noteOwned(resources, 'contactVectorsCreated', limits.maxContactVectors);
    demand(
      vector && nativeBoundary(hooks, 'contact.size', () => vector.size()) === data.ncon,
      'CONTACT_VECTOR_COUNT',
    );
    const counts = new Array(limits.pairCaps.length).fill(0);
    for (let i = 0; i < data.ncon; i += 1) {
      const contact = nativeBoundary(hooks, 'contact.get', () => {
        resources.contactGetDispatched = (resources.contactGetDispatched ?? 0) + 1;
        return vector.get(i);
      });
      resources.contactGetReturned = (resources.contactGetReturned ?? 0) + 1;
      demand(contact, 'CONTACT_COPY_MISSING');
      held.push(contact);
      noteOwned(resources, 'contactGetsCreated', limits.maxContactGets);
      const g0 = contact.geom1;
      const g1 = contact.geom2;
      const pair = limits.pairCaps.findIndex(
        (p) => (p.geom[0] === g0 && p.geom[1] === g1) || (p.geom[1] === g0 && p.geom[0] === g1),
      );
      demand(pair >= 0 && contact.dim === 3, 'UNREGISTERED_CONTACT_PAIR_OR_DIM');
      counts[pair] += 1;
      demand(counts[pair] <= limits.pairCaps[pair].maxContacts, 'RESOURCE_CONTACT_PAIR_CAP');
    }
    values = held.map((contact, index) => {
      const saved = { index };
      for (const key of contactScalars) {
        if (geometryOnly && key === 'mu') continue;
        saved[key] = contact[key];
      }
      for (const key of contactArrays) {
        if (geometryOnly && key === 'H') continue;
        saved[key] = boundedNativeArray(contact[key], boundedContactLengths[key], key);
      }
      demand(
        canonicalEqual(saved.geom, [saved.geom1, saved.geom2]),
        'CONTACT_GEOM_SCALAR_ARRAY_MISMATCH',
      );
      demand(finite(saved), 'NONFINITE_NATIVE_CONTACT');
      return saved;
    });
  } catch (error) {
    primary = error;
    hooks?.stop(error);
  } finally {
    for (const contact of held) {
      const error = deleteOwned(contact, resources, 'contact', hooks);
      cleanup ??= error;
    }
    // Do not short-circuit deletion after an earlier cleanup failure.
    const vectorError = deleteOwned(vector, resources, 'contact-vector', hooks);
    cleanup ??= vectorError;
  }
  if (primary) throw primary;
  if (cleanup) throw new Error('NATIVE_WRAPPER_CLEANUP', { cause: cleanup });
  return values;
}

export function copyGeometryWarnings(data, resources, limits) {
  const vector = data.warning; // borrowed vector; its get() values are owned
  let primary = null;
  let cleanup = null;
  const values = [];
  resources.warningObservations = (resources.warningObservations ?? 0) + 1;
  demand(
    resources.warningObservations <= limits.maxWarningObservations,
    'RESOURCE_WARNING_OBSERVATIONS',
  );
  demand(vector.size() === limits.warningCount, 'NATIVE_WARNING_COUNT');
  for (let i = 0; i < limits.warningCount; i += 1) {
    let stat = null;
    try {
      resources.warningGetDispatched = (resources.warningGetDispatched ?? 0) + 1;
      stat = vector.get(i);
      resources.warningGetReturned = (resources.warningGetReturned ?? 0) + 1;
      demand(stat, 'NATIVE_WARNING_COPY_MISSING');
      noteOwned(resources, 'warningGetsCreated', limits.maxWarningGets);
      const value = [stat.number, stat.lastinfo];
      demand(value.every(Number.isSafeInteger), 'NATIVE_WARNING_VALUE');
      values.push(value);
    } catch (error) {
      primary = error;
    } finally {
      if (stat) {
        const error = deleteOwned(stat, resources, 'warning');
        cleanup ??= error;
      }
    }
    if (primary || cleanup) break;
  }
  if (primary) throw primary;
  if (cleanup) throw new Error('NATIVE_WRAPPER_CLEANUP', { cause: cleanup });
  return values;
}

/** Position-stage only: no velocity/force routines, H, mu, or solved caches. */
export function captureGeometry(data, resources, limits) {
  nativeObservationBounds(data, limits);
  const contacts = boundedContactCopies(data, resources, limits, true);
  const nbody = limits.nbody;
  const ngeom = limits.ngeom;
  const poses = {};
  for (const [key, length] of Object.entries({
    xpos: nbody * 3,
    xipos: nbody * 3,
    xmat: nbody * 9,
    xquat: nbody * 4,
    geom_xpos: ngeom * 3,
    geom_xmat: ngeom * 9,
  }))
    poses[key] = boundedNativeArray(data[key], length, key, true);
  const efcType = boundedNativeArray(data.efc_type, data.nefc, 'efc_type');
  const efcId = boundedNativeArray(data.efc_id, data.nefc, 'efc_id');
  demand(
    efcType.every((type) => type === 7),
    'GEOMETRY_UNREGISTERED_CONSTRAINT_TYPE',
  );
  return {
    contacts,
    poses,
    efcType,
    efcId,
    ncon: data.ncon,
    nefc: data.nefc,
    nisland: data.nisland,
    warnings: copyGeometryWarnings(data, resources, limits),
  };
}

export function nativeBodyKinematics(M, model, data, bodyIds, resources, buffer, hooks = null) {
  const result = {};
  for (const id of bodyIds) {
    nativeBoundary(hooks, 'mj_objectVelocity', () =>
      M.mj_objectVelocity(model, data, 1, id, buffer, 0),
    );
    const view = nativeBoundary(hooks, 'DoubleBuffer.GetView', () => buffer.GetView());
    const velocity = hooks?.strictDynamic
      ? boundedNativeArray(view, 6, 'body-velocity', true)
      : Array.from(view);
    demand(velocity.length === 6 && finite(velocity), 'BODY_VELOCITY_BUFFER');
    result[id] = {
      com: (hooks?.strictDynamic
        ? boundedNativeArray(data.xipos, hooks.shape.nbody * 3, 'xipos', true)
        : Array.from(data.xipos)
      ).slice(id * 3, id * 3 + 3),
      rotation: (hooks?.strictDynamic
        ? boundedNativeArray(data.xmat, hooks.shape.nbody * 9, 'xmat', true)
        : Array.from(data.xmat)
      ).slice(id * 9, id * 9 + 9),
      quaternion: (hooks?.strictDynamic
        ? boundedNativeArray(data.xquat, hooks.shape.nbody * 4, 'xquat', true)
        : Array.from(data.xquat)
      ).slice(id * 4, id * 4 + 4),
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
  if (limits.pairCaps) {
    // Scenario constraints can only be rows of the registered elliptic contacts.
    // Inspect bounded views before copying any variable contact/constraint array.
    const types = data.efc_type;
    const ids = data.efc_id;
    demand(
      ArrayBuffer.isView(types) &&
        ArrayBuffer.isView(ids) &&
        types.length === data.nefc &&
        ids.length === data.nefc,
      'RESOURCE_SCENARIO_CONSTRAINT_ARRAY',
    );
    for (let row = 0; row < data.nefc; row += 1)
      demand(
        types[row] === 7 && Number.isSafeInteger(ids[row]) && ids[row] >= 0 && ids[row] < data.ncon,
        'RESOURCE_SCENARIO_CONSTRAINT_TYPE_OR_ID',
      );
  }
}
export function captureForward(
  M,
  model,
  data,
  preState,
  ids,
  resources,
  buffer,
  limits,
  hooks = null,
) {
  nativeObservationBounds(data, limits);
  const contacts = copyContacts(data, resources, limits, hooks);
  return {
    state: phaseState(preState),
    bodies: nativeBodyKinematics(M, model, data, ids.bodyIds, resources, buffer, hooks),
    contacts,
    efcVel: limits.pairCaps
      ? boundedNativeArray(data.efc_vel, data.nefc, 'efc_vel', true)
      : Array.from(data.efc_vel),
    efcType: limits.pairCaps
      ? boundedNativeArray(data.efc_type, data.nefc, 'efc_type')
      : Array.from(data.efc_type),
    efcId: limits.pairCaps
      ? boundedNativeArray(data.efc_id, data.nefc, 'efc_id')
      : Array.from(data.efc_id),
    ncon: data.ncon,
    nefc: data.nefc,
  };
}
export function captureForces(M, model, data, forward, resources, buffer, limits, hooks = null) {
  nativeObservationBounds(data, limits);
  const after = copyContacts(data, resources, limits, hooks);
  demand(
    canonicalEqual(forward.contacts.map(contactIdentity), after.map(contactIdentity)),
    'CONTACT_GEOMETRY_CHANGED_DURING_STEP2',
  );
  const contacts = after.map((contact, i) => {
    nativeBoundary(hooks, 'mj_contactForce', () => M.mj_contactForce(model, data, i, buffer));
    resources.contactForceCalls += 1;
    const view = nativeBoundary(hooks, 'DoubleBuffer.GetView', () => buffer.GetView());
    return {
      ...contact,
      force: hooks?.strictDynamic
        ? boundedNativeArray(view, 6, 'contact-force', true)
        : Array.from(view),
    };
  });
  return {
    contacts,
    efcForce: limits.pairCaps
      ? boundedNativeArray(data.efc_force, data.nefc, 'efc_force', true)
      : Array.from(data.efc_force),
    qfrcConstraint: hooks?.strictDynamic
      ? boundedNativeArray(data.qfrc_constraint, hooks.shape.nv, 'qfrc_constraint', true)
      : Array.from(data.qfrc_constraint),
    qfrcActuator: hooks?.strictDynamic
      ? boundedNativeArray(data.qfrc_actuator, hooks.shape.nv, 'qfrc_actuator', true)
      : Array.from(data.qfrc_actuator),
    actuatorForce: hooks?.strictDynamic
      ? boundedNativeArray(data.actuator_force, hooks.shape.nu, 'actuator_force', true)
      : Array.from(data.actuator_force),
    qacc: hooks?.strictDynamic
      ? boundedNativeArray(data.qacc, hooks.shape.nv, 'qacc', true)
      : Array.from(data.qacc),
    solverIterations: hooks?.strictDynamic
      ? boundedNativeArray(data.solver_niter, hooks.shape.solverSlots, 'solver_niter')
      : Array.from(data.solver_niter),
    islands: data.nisland,
    warnings: copyWarnings(data, resources, hooks),
    endpoint: copyState(data, hooks),
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
