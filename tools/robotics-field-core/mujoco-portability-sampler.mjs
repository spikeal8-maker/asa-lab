// TEST_ONLY. Native sampling of the unchanged pinned PHY01 scene; no solver.
// The original Node assessor remains the only physical acceptance assessor.
export const STATE_BYTES = 208;
export const WARNING_BYTES = 112;
export const RECORD_BYTES = 352;
export const RECORD_KIND = Object.freeze({
  initial: 0,
  endpoint: 1,
  offlineResume: 2,
  quotaRefusal: 3,
  failure: 4,
});
export const STATE_FIELDS = Object.freeze(['qpos', 'qvel', 'qacc', 'qacc_warmstart', 'time']);
const LENGTHS = Object.freeze({ qpos: 7, qvel: 6, qacc: 6, qacc_warmstart: 6 });
const TOPOLOGY = Object.freeze({
  nq: 7,
  nv: 6,
  na: 0,
  nu: 0,
  nbody: 2,
  ngeom: 2,
  njnt: 1,
  nplugin: 0,
  nsensor: 0,
  ntree: 1,
});
const MODEL_LENGTHS = Object.freeze({
  body_mass: 2,
  body_ipos: 6,
  body_iquat: 8,
  body_inertia: 6,
  body_pos: 6,
  body_quat: 8,
  jnt_type: 1,
  jnt_qposadr: 1,
  jnt_dofadr: 1,
  geom_type: 2,
  geom_size: 6,
  geom_pos: 6,
  dof_damping: 6,
  dof_armature: 6,
  dof_frictionloss: 6,
  jnt_stiffness: 1,
});
export class PortabilityError extends Error {
  constructor(code, detail = null) {
    super(code);
    this.name = 'PortabilityError';
    this.code = code;
    this.detail = detail;
  }
}
export const demand = (condition, message) => {
  if (!condition) throw new PortabilityError(message);
};
function failureClass(code) {
  const interruption =
    /^(?:TIMEOUT:|OVERALL_WALL_DEADLINE$|(?:NODE_CHILD|BROWSER_REALM)_INCOMPLETE$|NODE_CHILD_LOST$|WORKER_LOST$|FORCED_TERMINATION$|RESOURCE_DISPOSAL_INCOMPLETE$)/.test(
      code,
    );
  const nativeInvariant =
    /^(?:MUJOCO_PHY01_(?:MODEL|RUNTIME|PHASE):|STATE_NONFINITE$|NATIVE_STATE_VIEW:|NATIVE_ARRAY_LENGTH:|NATIVE_TOPOLOGY:|WARNING_COUNT$|WARNING_MISSING$|QUOTA_CHANGED_NATIVE_STATE$|OFFLINE_CHANGED_(?:NATIVE_STATE|NATIVE_INPUT|COUNTERS)$|CROSS_REALM_NATIVE_BYTES$|RAW_(?:ENDPOINT_INVARIANTS|NATIVE_WARNING|CONTINUATION_CHANGED_STATE)$|PHYSICAL_ASSESSMENT_FAILED$)/.test(
      code,
    );
  return {
    kind: interruption ? 'INTERRUPTION' : nativeInvariant ? 'NATIVE_INVARIANT' : 'HARNESS_FAILURE',
    classification: nativeInvariant && !interruption ? 'FAIL' : 'INCOMPLETE',
  };
}
function validateFailure(record) {
  demand(
    record?.schema === 'MUJOCO_PORTABILITY_FAILURE_V1' &&
      JSON.stringify(Object.keys(record).sort()) ===
        JSON.stringify(
          ['schema', 'code', 'message', 'phase', 'kind', 'classification', 'detail'].sort(),
        ) &&
      typeof record.code === 'string' &&
      record.code.length > 0 &&
      record.code.length <= 256 &&
      typeof record.message === 'string' &&
      record.message.length <= 4096 &&
      (record.phase === null || (typeof record.phase === 'string' && record.phase.length <= 128)) &&
      (record.detail === null ||
        (typeof record.detail === 'string' && record.detail.length <= 4096)),
    'FAILURE_RECEIPT_SCHEMA',
  );
  const expected = failureClass(record.code);
  demand(
    record.kind === expected.kind && record.classification === expected.classification,
    'FAILURE_RECEIPT_CLASSIFICATION',
  );
  return record;
}
export function failureRecord(error, phase = null) {
  if (error?.failure?.schema === 'MUJOCO_PORTABILITY_FAILURE_V1')
    return { ...validateFailure(error.failure) };
  const code =
    String(
      error?.code ??
        (error?.name === 'TimeoutError' ? 'TIMEOUT:browser-api' : 'UNCLASSIFIED_ERROR'),
    ).slice(0, 256) || 'UNCLASSIFIED_ERROR';
  let detail = null;
  if (error?.detail != null) {
    try {
      detail = JSON.stringify(error.detail).slice(0, 4096);
    } catch {
      detail = 'UNSERIALIZABLE_ERROR_DETAIL';
    }
  }
  return {
    schema: 'MUJOCO_PORTABILITY_FAILURE_V1',
    code,
    message: String(error?.message ?? error).slice(0, 4096),
    phase: phase == null ? null : String(phase).slice(0, 128),
    ...failureClass(code),
    detail,
  };
}
export function failureError(record) {
  validateFailure(record);
  const error = new PortabilityError(record.code);
  error.failure = { ...record };
  return error;
}
export function failureOutcome(records) {
  for (const record of records) validateFailure(record);
  if (records.some((item) => item.kind === 'INTERRUPTION')) return 'INCOMPLETE';
  return records.some((item) => item.classification === 'FAIL') ? 'FAIL' : 'INCOMPLETE';
}
export function createRecordAccounting() {
  return {
    validatedEndpoints: 0,
    emittedEndpoints: 0,
    acknowledgedEndpoints: 0,
    emittedFailureFrames: 0,
    acknowledgedFailureFrames: 0,
    packetsDispatched: 0,
    packetsAcknowledged: 0,
  };
}
export async function dispatchRecordBatch(accounting, kinds, dispatch) {
  demand(
    kinds.length >= 1 &&
      kinds.length <= 100 &&
      kinds.every((kind) => Number.isInteger(kind) && kind >= 0 && kind <= 4),
    'RECORD_BATCH_KINDS',
  );
  const endpoints = kinds.filter((kind) => kind === RECORD_KIND.endpoint).length;
  const failures = kinds.filter((kind) => kind === RECORD_KIND.failure).length;
  let dispatched = false;
  await dispatch(() => {
    demand(!dispatched, 'RECORD_BATCH_REDISPATCH');
    dispatched = true;
    accounting.packetsDispatched += 1;
    accounting.emittedEndpoints += endpoints;
    accounting.emittedFailureFrames += failures;
  });
  demand(dispatched, 'RECORD_TRANSPORT_UNOBSERVED');
  accounting.packetsAcknowledged += 1;
  accounting.acknowledgedEndpoints += endpoints;
  accounting.acknowledgedFailureFrames += failures;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const finiteArray = (a, n) => Array.isArray(a) && a.length === n && a.every(Number.isFinite);
const zeroArray = (a) => Array.isArray(a) && a.every((v) => v === 0);
const norm = (a) => Math.hypot(...a);

/** Runs before JSON/hash/asset IO. The later SHA admission enforces the exact fixture. */
export function validatePhysicalInput(f) {
  let visited = 0;
  const visit = (value, depth) => {
    demand(++visited <= 1024 && depth <= 32, 'INPUT_STRUCTURE_LIMIT');
    if (typeof value === 'number') demand(Number.isFinite(value), 'FINITE_INPUT_REJECTED');
    else if (Array.isArray(value)) {
      demand(value.length <= 64, 'INPUT_ARRAY_LIMIT');
      for (const item of value) visit(item, depth + 1);
    } else if (value && typeof value === 'object') {
      demand(Object.getPrototypeOf(value) === Object.prototype, 'INPUT_OBJECT_TYPE');
      const entries = Object.entries(value);
      demand(entries.length <= 64, 'INPUT_OBJECT_LIMIT');
      for (const [key, item] of entries) {
        demand(key.length <= 128, 'INPUT_KEY_LIMIT');
        visit(item, depth + 1);
      }
    } else
      demand(
        value === null ||
          typeof value === 'boolean' ||
          (typeof value === 'string' && value.length <= 4096),
        'INPUT_VALUE_TYPE',
      );
  };
  visit(f, 0);
  demand(f && typeof f === 'object', 'INPUT_FIXTURE_TYPE');
  demand(finiteArray(f.massesKg, 3) && f.massesKg.every((m) => m > 0), 'POSITIVE_MASS_REJECTED');
  demand(finiteArray(f.gravity, 3), 'GRAVITY_REJECTED');
  demand(Number.isFinite(f.sphereRadiusM) && f.sphereRadiusM > 0, 'POSITIVE_GEOMETRY_REJECTED');
  demand(
    finiteArray(f.floorHalfExtentsM, 3) && f.floorHalfExtentsM.every((x) => x > 0),
    'POSITIVE_GEOMETRY_REJECTED',
  );
  demand(finiteArray(f.initialQpos, 7) && finiteArray(f.initialQvel, 6), 'INITIAL_STATE_REJECTED');
  demand(
    finiteArray(f.nativeStepUs, 2) && finiteArray(f.sampleTimesUs, 4),
    'INTEGER_SCHEDULE_REJECTED',
  );
  demand(Number.isSafeInteger(f.macroStepUs) && f.macroStepUs > 0, 'INTEGER_SCHEDULE_REJECTED');
  for (const dt of f.nativeStepUs) {
    demand(
      Number.isSafeInteger(dt) && dt > 0 && f.macroStepUs % dt === 0,
      'INTEGER_SCHEDULE_REJECTED',
    );
    demand(
      f.sampleTimesUs.every(
        (t, index) =>
          Number.isSafeInteger(t) &&
          t > 0 &&
          t % dt === 0 &&
          (index === 0 || t > f.sampleTimesUs[index - 1]),
      ),
      'INTEGER_SCHEDULE_REJECTED',
    );
  }
  return f;
}
export function float64Bytes(values, allowNonFinite = false) {
  demand(
    Array.isArray(values) &&
      values.every((x) => typeof x === 'number' && (allowNonFinite || Number.isFinite(x))),
    'STATE_NONFINITE',
  );
  const bytes = new Uint8Array(values.length * 8);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setFloat64(index * 8, value, true));
  return bytes;
}
export function stateBytes(state, fields = STATE_FIELDS, allowNonFinite = false) {
  return float64Bytes(
    fields.flatMap((key) => (key === 'time' ? [state.time] : state[key])),
    allowNonFinite,
  );
}
export function equalBytes(a, b) {
  return a.byteLength === b.byteLength && a.every((value, index) => value === b[index]);
}
export function warningBytes(warnings, allowNonFinite = false) {
  demand(Array.isArray(warnings) && warnings.length === 7, 'WARNING_COUNT');
  return float64Bytes(
    warnings.flatMap((w) => [w.number, w.lastinfo]),
    allowNonFinite,
  );
}
function boundedView(view, length, field) {
  demand(
    ArrayBuffer.isView(view) && !(view instanceof DataView) && view.length === length,
    'NATIVE_ARRAY_LENGTH:' + field,
  );
  return Array.from(view);
}
export function copyNative(data) {
  const state = { time: data.time };
  for (const [field, length] of Object.entries(LENGTHS)) {
    const view = data[field];
    demand(view instanceof Float64Array && view.length === length, 'NATIVE_STATE_VIEW:' + field);
    state[field] = Array.from(view);
  }
  return state;
}
export function copyWarnings(data, counters) {
  const vector = data.warning; // Borrowed embedded reference; never delete.
  counters.warningSizeCalls += 1;
  demand(vector.size() === 7, 'WARNING_COUNT');
  const result = [];
  for (let index = 0; index < 7; index += 1) {
    demand(counters.liveWarningCopies === 0, 'WARNING_OWNERSHIP');
    demand(
      counters.warningGet.dispatched < (counters.realm === 'node-child' ? 24026 : 24027) * 7 + 7,
      'WARNING_COPY_BUDGET',
    );
    counters.warningGet.dispatched += 1;
    const value = vector.get(index); // Owned copy under register_vector.get.
    demand(value != null, 'WARNING_MISSING');
    counters.warningGet.returned += 1;
    counters.liveWarningCopies += 1;
    counters.maxLiveWarningCopies = Math.max(
      counters.maxLiveWarningCopies,
      counters.liveWarningCopies,
    );
    try {
      result.push({ number: value.number, lastinfo: value.lastinfo });
    } finally {
      counters.warningDelete.dispatched += 1;
      value.delete();
      counters.warningDelete.returned += 1;
      counters.liveWarningCopies -= 1;
    }
  }
  counters.warningObservations += 1;
  return result;
}
function zeroWarnings(warnings) {
  return (
    Array.isArray(warnings) &&
    warnings.length === 7 &&
    warnings.every((w) => w.number === 0 && w.lastinfo === 0)
  );
}
function zeroInputs(data) {
  return [
    ['ctrl', 0],
    ['act', 0],
    ['qfrc_applied', 6],
    ['xfrc_applied', 12],
  ].every(([field, length]) => zeroArray(boundedView(data[field], length, field)));
}
export function createNativeCounters(realm) {
  const calls = () => ({ dispatched: 0, returned: 0 });
  return {
    realm,
    worlds: 0,
    models: calls(),
    data: calls(),
    modelsDeleted: calls(),
    dataDeleted: calls(),
    liveModels: 0,
    liveData: 0,
    maxLiveModels: 0,
    maxLiveData: 0,
    advanceAttempts: 0,
    advanceSlotsReserved: 0,
    advancesDispatched: 0,
    advancesCompleted: 0,
    mj_step1: calls(),
    mj_step2: calls(),
    mj_step: calls(),
    warningSizeCalls: 0,
    warningGet: calls(),
    warningDelete: calls(),
    warningObservations: 0,
    liveWarningCopies: 0,
    maxLiveWarningCopies: 0,
    failureObservations: 0,
    quotaRefusals: 0,
  };
}
/** Consumes the slot BEFORE mj_step1, not only before the advancing mj_step2. */
export function reserveAdvance(counters, completed, nextTick, dtUs, caseLimit) {
  counters.advanceAttempts += 1;
  demand(
    Number.isSafeInteger(completed) &&
      completed >= 0 &&
      Number.isSafeInteger(nextTick) &&
      nextTick === completed + 1,
    'NEXT_TICK_REJECTED',
  );
  demand(
    (dtUs === 500 || dtUs === 250) && Number.isSafeInteger(nextTick * dtUs),
    'INTEGER_SCHEDULE_REJECTED',
  );
  demand(
    Number.isSafeInteger(caseLimit) && caseLimit > 0 && caseLimit <= 1600,
    'CASE_QUOTA_REJECTED',
  );
  if (nextTick > caseLimit || counters.advanceSlotsReserved >= 24004)
    throw new PortabilityError('COMPUTE_QUOTA');
  counters.advanceSlotsReserved += 1;
}
export function encodeRecord({
  kind,
  entry,
  worldOrdinal,
  step,
  state,
  warnings,
  ncon,
  nefc,
  awake,
  flags = 0,
}) {
  demand(Number.isInteger(kind) && kind >= 0 && kind <= 4, 'RECORD_KIND');
  demand(Number.isInteger(worldOrdinal) && worldOrdinal >= 0 && worldOrdinal < 63, 'RECORD_WORLD');
  demand(Number.isSafeInteger(step) && step >= 0 && step <= 1600, 'RECORD_STEP');
  demand(entry.mode === 'split' || entry.mode === 'full', 'RECORD_MODE');
  demand(entry.dtUs === 500 || entry.dtUs === 250, 'RECORD_DT');
  for (const value of [ncon, nefc, awake])
    demand(
      Number.isInteger(value) && value >= -2147483648 && value <= 2147483647,
      'RECORD_NATIVE_INTEGER',
    );
  const result = new Uint8Array(RECORD_BYTES);
  const view = new DataView(result.buffer);
  view.setUint16(0, 1, true);
  view.setUint8(2, kind);
  view.setUint8(3, entry.mode === 'split' ? 0 : 1);
  view.setUint16(4, worldOrdinal, true);
  view.setUint16(6, flags, true);
  view.setUint32(8, step, true);
  view.setUint32(12, step * entry.dtUs, true);
  view.setInt32(16, ncon, true);
  view.setInt32(20, nefc, true);
  view.setInt32(24, awake, true);
  const statePart = stateBytes(state, STATE_FIELDS, kind === RECORD_KIND.failure);
  demand(statePart.byteLength === STATE_BYTES, 'RECORD_STATE_LENGTH');
  result.set(statePart, 32);
  result.set(warningBytes(warnings, kind === RECORD_KIND.failure), 240);
  return result;
}
export function decodeRecord(bytes) {
  demand(bytes instanceof Uint8Array && bytes.byteLength === RECORD_BYTES, 'RECORD_LENGTH');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  demand(view.getUint16(0, true) === 1 && view.getUint32(28, true) === 0, 'RECORD_SCHEMA');
  const kind = view.getUint8(2),
    mode = view.getUint8(3);
  demand(kind <= 4 && mode <= 1, 'RECORD_ENUM');
  let offset = 32;
  const state = {};
  for (const [name, length] of Object.entries(LENGTHS)) {
    state[name] = Array.from({ length }, () => {
      const value = view.getFloat64(offset, true);
      offset += 8;
      return value;
    });
  }
  state.time = view.getFloat64(offset, true);
  const warnings = Array.from({ length: 7 }, (_, index) => ({
    number: view.getFloat64(240 + index * 16, true),
    lastinfo: view.getFloat64(248 + index * 16, true),
  }));
  return {
    kind,
    mode: mode === 0 ? 'split' : 'full',
    worldOrdinal: view.getUint16(4, true),
    flags: view.getUint16(6, true),
    step: view.getUint32(8, true),
    timeUs: view.getUint32(12, true),
    ncon: view.getInt32(16, true),
    nefc: view.getInt32(20, true),
    awake: view.getInt32(24, true),
    state,
    warnings,
  };
}
export function analyticalAt(f, timeUs) {
  const t = timeUs / 1e6;
  const displacement = f.gravity.map((g) => (g * t * t) / 2);
  const velocity = f.gravity.map((g) => g * t);
  return {
    displacement,
    velocity,
    positionToleranceM: Math.max(
      f.tolerance.positionAbsoluteM,
      f.tolerance.relative * norm(displacement),
    ),
    velocityToleranceMps: Math.max(
      f.tolerance.velocityAbsoluteMps,
      f.tolerance.relative * norm(velocity),
    ),
  };
}
export function nativeTimeBudget(step, dtUs) {
  const h = dtUs / 1e6;
  const t = (step * dtUs) / 1e6;
  const gamma = (step * Number.EPSILON) / (1 - step * Number.EPSILON);
  return (gamma + 2 * Number.EPSILON) * Math.max(t, h);
}
export function makeModelXml(f, massKg, dtUs) {
  validatePhysicalInput(f);
  demand(
    f.massesKg.includes(massKg) && f.nativeStepUs.includes(dtUs),
    'MUJOCO_PHY01_MODEL: unregistered identity',
  );
  const inertia = (2 * massKg * f.sphereRadiusM ** 2) / 5;
  return [
    '<mujoco model="asa_phy01_mujoco">',
    '<compiler angle="radian" inertiafromgeom="false" autolimits="false"/>',
    '<option timestep="' +
      dtUs / 1e6 +
      '" gravity="' +
      f.gravity.join(' ') +
      '" integrator="' +
      f.solver.integrator +
      '" solver="' +
      f.solver.solver +
      '" jacobian="' +
      f.solver.jacobian +
      '" cone="' +
      f.solver.cone +
      '" iterations="' +
      f.solver.iterations +
      '" tolerance="' +
      f.solver.tolerance +
      '" density="0" viscosity="0" wind="0 0 0"><flag sleep="disable"/></option>',
    '<default><joint damping="0" armature="0" frictionloss="0" stiffness="0" limited="false"/>' +
      '<geom friction="0 0 0" margin="0" gap="0"/></default>',
    '<worldbody><geom name="floor" type="box" size="' +
      f.floorHalfExtentsM.join(' ') +
      '" pos="0 0 ' +
      (f.floorTopZ - f.floorHalfExtentsM[2]) +
      '"/>',
    '<body name="falling_sphere" pos="0 0 2" quat="1 0 0 0"><joint name="free" type="free"/>',
    '<inertial pos="0 0 0" quat="1 0 0 0" mass="' +
      massKg +
      '" diaginertia="' +
      [inertia, inertia, inertia].join(' ') +
      '"/>',
    '<geom name="sphere" type="sphere" size="' + f.sphereRadiusM + '"/>',
    '</body></worldbody></mujoco>',
  ].join('\n');
}
export function readModel(model, data, counters) {
  for (const [name, expected] of Object.entries(TOPOLOGY))
    demand(model[name] === expected, 'NATIVE_TOPOLOGY:' + name);
  for (const [name, length] of Object.entries(MODEL_LENGTHS))
    demand(
      ArrayBuffer.isView(model[name]) && model[name].length === length,
      'NATIVE_ARRAY_LENGTH:' + name,
    );
  for (const [name, length] of [
    ['ctrl', 0],
    ['act', 0],
    ['qfrc_applied', 6],
    ['xfrc_applied', 12],
  ])
    demand(
      ArrayBuffer.isView(data[name]) && data[name].length === length,
      'NATIVE_ARRAY_LENGTH:' + name,
    );
  const opt = model.opt;
  demand(opt.gravity.length === 3 && opt.wind.length === 3, 'NATIVE_OPTION_ARRAY_LENGTH');
  const value = {
    counts: Object.fromEntries(
      ['nq', 'nv', 'na', 'nu', 'nbody', 'ngeom', 'njnt', 'nplugin', 'nsensor', 'ntree'].map(
        (key) => [key, model[key]],
      ),
    ),
    arrays: Object.fromEntries(
      [
        'body_mass',
        'body_ipos',
        'body_iquat',
        'body_inertia',
        'body_pos',
        'body_quat',
        'jnt_type',
        'jnt_qposadr',
        'jnt_dofadr',
        'geom_type',
        'geom_size',
        'geom_pos',
        'dof_damping',
        'dof_armature',
        'dof_frictionloss',
        'jnt_stiffness',
      ].map((key) => [key, Array.from(model[key])]),
    ),
    options: Object.fromEntries(
      [
        'timestep',
        'integrator',
        'solver',
        'jacobian',
        'cone',
        'iterations',
        'tolerance',
        'disableflags',
        'enableflags',
        'density',
        'viscosity',
      ].map((key) => [key, opt[key]]),
    ),
    gravity: Array.from(opt.gravity),
    wind: Array.from(opt.wind),
    initial: copyNative(data),
    warnings: copyWarnings(data, counters),
    controls: Array.from(data.ctrl),
    act: Array.from(data.act),
    qfrcApplied: Array.from(data.qfrc_applied),
    xfrcApplied: Array.from(data.xfrc_applied),
  };
  return value;
}
export function validateModelReadback(f, massKg, dtUs, r) {
  demand(
    r &&
      same(r.counts, {
        nq: 7,
        nv: 6,
        na: 0,
        nu: 0,
        nbody: 2,
        ngeom: 2,
        njnt: 1,
        nplugin: 0,
        nsensor: 0,
        ntree: 1,
      }),
    'MUJOCO_PHY01_MODEL: unexpected model topology',
  );
  const a = r.arrays;
  demand(
    same(a.body_ipos, [0, 0, 0, 0, 0, 0]) &&
      same(a.body_iquat, [1, 0, 0, 0, 1, 0, 0, 0]) &&
      same(a.body_pos, [0, 0, 0, 0, 0, 2]) &&
      same(a.body_quat, [1, 0, 0, 0, 1, 0, 0, 0]),
    'MUJOCO_PHY01_MODEL: nonzero COM or changed body frame',
  );
  demand(
    finiteArray(a.body_mass, 2) &&
      a.body_mass[0] === 0 &&
      Math.abs(a.body_mass[1] - massKg) <= massKg * f.tolerance.massReadbackRelative,
    'MUJOCO_PHY01_MODEL: mass mismatch',
  );
  const inertia = (2 * massKg * f.sphereRadiusM ** 2) / 5;
  demand(
    finiteArray(a.body_inertia, 6) &&
      a.body_inertia.slice(0, 3).every((v) => v === 0) &&
      a.body_inertia
        .slice(3)
        .every((v) => Math.abs(v - inertia) <= inertia * f.tolerance.massReadbackRelative),
    'MUJOCO_PHY01_MODEL: inertia mismatch',
  );
  demand(
    same(a.jnt_type, [0]) && same(a.jnt_qposadr, [0]) && same(a.jnt_dofadr, [0]),
    'MUJOCO_PHY01_MODEL: free-joint coordinate layout mismatch',
  );
  demand(
    same(a.geom_type, [6, 2]) &&
      same(a.geom_size, [...f.floorHalfExtentsM, f.sphereRadiusM, 0, 0]) &&
      same(a.geom_pos, [0, 0, -0.01, 0, 0, 0]),
    'MUJOCO_PHY01_MODEL: geometry mismatch',
  );
  for (const key of ['dof_damping', 'dof_armature', 'dof_frictionloss', 'jnt_stiffness'])
    demand(zeroArray(a[key]), 'MUJOCO_PHY01_MODEL: nonzero passive parameter ' + key);
  demand(
    same(r.options, {
      timestep: dtUs / 1e6,
      integrator: 3,
      solver: 2,
      jacobian: 0,
      cone: 1,
      iterations: f.solver.iterations,
      tolerance: f.solver.tolerance,
      disableflags: 0,
      enableflags: 0,
      density: 0,
      viscosity: 0,
    }) &&
      same(r.gravity, f.gravity) &&
      same(r.wind, [0, 0, 0]),
    'MUJOCO_PHY01_MODEL: native option mismatch',
  );
  demand(
    same(r.initial.qpos, f.initialQpos) &&
      same(r.initial.qvel, f.initialQvel) &&
      r.initial.time === 0,
    'MUJOCO_PHY01_MODEL: initial state mismatch',
  );
  demand(zeroWarnings(r.warnings), 'MUJOCO_PHY01_MODEL: nonzero initial warning');
  demand(
    r.controls.length === 0 &&
      r.act.length === 0 &&
      zeroArray(r.qfrcApplied) &&
      zeroArray(r.xfrcApplied),
    'MUJOCO_PHY01_MODEL: unexpected initial inputs',
  );
}
export function runPlan(f) {
  validatePhysicalInput(f);
  const plan = [];
  for (const dtUs of f.nativeStepUs)
    for (const massKg of f.massesKg)
      for (let repeat = 0; repeat < f.repeats; repeat += 1)
        plan.push({ mode: 'split', massKg, dtUs, repeat });
  for (const dtUs of f.nativeStepUs)
    plan.push({ mode: 'full', massKg: f.phase.referenceMassKg, dtUs, repeat: 0 });
  return plan;
}

/** This function is called only after observed real native factory admission. */
export async function sampleWorld({
  M,
  fixture: f,
  entry,
  worldOrdinal,
  counters,
  sha256,
  onRecords,
  onStart,
  onOfflineBarrier,
  quota = false,
}) {
  const run = {
    ...entry,
    worldOrdinal,
    quota,
    steps: 0,
    attemptedStepIndex: 0,
    phase: 'before_model_creation',
    samples: [],
    nativeCalls: {
      mj_step1: { dispatched: 0, returned: 0 },
      mj_step2: { dispatched: 0, returned: 0 },
      mj_step: { dispatched: 0, returned: 0 },
    },
    invariantCounts: {
      step1Preserved: 0,
      finite: 0,
      noContact: 0,
      warningFree: 0,
      zeroInput: 0,
      nativeTime: 0,
    },
    initialReadback: null,
    xmlSha256: null,
    error: null,
    failure: null,
    recordAccounting: createRecordAccounting(),
    cleanupErrors: [],
    cleanupFailures: [],
    failureObservationError: null,
  };
  let model, data;
  const wallDeadline = Date.now() + 60000;
  let records = new Uint8Array(RECORD_BYTES * 100),
    recordCount = 0,
    recordKinds = [];
  const flush = async () => {
    if (!recordCount) return;
    const payload = records.slice(0, recordCount * RECORD_BYTES);
    const count = recordCount;
    const kinds = recordKinds;
    recordCount = 0;
    recordKinds = [];
    await dispatchRecordBatch(run.recordAccounting, kinds, (onDispatched) =>
      onRecords(payload, count, worldOrdinal, onDispatched),
    );
  };
  const emit = async (snapshot, kind, flags = 0, separate = false) => {
    if (separate) await flush();
    records.set(
      encodeRecord({ kind, entry, worldOrdinal, step: run.steps, ...snapshot, flags }),
      recordCount * RECORD_BYTES,
    );
    recordCount += 1;
    recordKinds.push(kind);
    if (kind === RECORD_KIND.endpoint) run.recordAccounting.validatedEndpoints += 1;
    if (separate || recordCount === 100) await flush();
  };
  const observe = () => ({
    state: copyNative(data),
    warnings: copyWarnings(data, counters),
    ncon: data.ncon,
    nefc: data.nefc,
    awake: data.ntree_awake,
  });
  const assertSameSnapshot = (a, b, code) =>
    demand(
      equalBytes(stateBytes(a.state), stateBytes(b.state)) &&
        equalBytes(warningBytes(a.warnings), warningBytes(b.warnings)) &&
        a.ncon === b.ncon &&
        a.nefc === b.nefc &&
        a.awake === b.awake,
      code,
    );
  const dispatch = (name) => {
    counters[name].dispatched += 1;
    run.nativeCalls[name].dispatched += 1;
    M[name](model, data);
    counters[name].returned += 1;
    run.nativeCalls[name].returned += 1;
  };
  try {
    validatePhysicalInput(f);
    demand(
      (await sha256(new globalThis.TextEncoder().encode(JSON.stringify(f)))) ===
        '52562ead409721a49732e9d9f985b230d757edbdd2ecee9b88c13d2115580bea',
      'FIXTURE_IDENTITY',
    );
    demand(
      counters.worlds < 21 &&
        counters.liveModels === 0 &&
        counters.liveData === 0 &&
        counters.liveWarningCopies === 0,
      'WORLD_OWNERSHIP_BUDGET',
    );
    await onStart({ ...entry, worldOrdinal, quota });
    const xml = makeModelXml(f, entry.massKg, entry.dtUs);
    run.xml = xml;
    run.xmlSha256 = await sha256(new globalThis.TextEncoder().encode(xml));
    counters.worlds += 1;
    run.phase = 'create_model';
    demand(Date.now() <= wallDeadline, 'TIMEOUT:world');
    counters.models.dispatched += 1;
    model = M.MjModel.from_xml_string(xml);
    counters.models.returned += 1;
    demand(model && typeof model.delete === 'function', 'MODEL_HANDLE');
    counters.liveModels += 1;
    counters.maxLiveModels = Math.max(counters.maxLiveModels, counters.liveModels);
    run.phase = 'create_data';
    counters.data.dispatched += 1;
    data = new M.MjData(model);
    counters.data.returned += 1;
    demand(data && typeof data.delete === 'function', 'DATA_HANDLE');
    counters.liveData += 1;
    counters.maxLiveData = Math.max(counters.maxLiveData, counters.liveData);
    run.phase = 'initial_readback';
    run.initialReadback = readModel(model, data, counters);
    validateModelReadback(f, entry.massKg, entry.dtUs, run.initialReadback);
    await emit(
      {
        state: run.initialReadback.initial,
        warnings: run.initialReadback.warnings,
        ncon: data.ncon,
        nefc: data.nefc,
        awake: data.ntree_awake,
      },
      RECORD_KIND.initial,
      512,
      true,
    );
    const limit = quota ? 4 : f.sampleTimesUs.at(-1) / entry.dtUs;
    const attempts = quota ? 5 : limit;
    let previous;
    for (let step = 1; step <= attempts; step += 1) {
      run.attemptedStepIndex = step;
      run.phase = 'before_native_step';
      try {
        demand(Date.now() <= wallDeadline, 'TIMEOUT:world');
        reserveAdvance(counters, run.steps, step, entry.dtUs, limit);
      } catch (error) {
        if (!(quota && step === 5 && error.code === 'COMPUTE_QUOTA')) throw error;
        counters.quotaRefusals += 1;
        const after = observe();
        assertSameSnapshot(previous, after, 'QUOTA_CHANGED_NATIVE_STATE');
        run.lastObservation = { stepIndex: run.steps, phase: 'quota_refused', ...after };
        await emit(after, RECORD_KIND.quotaRefusal, 256, true);
        run.phase = 'quota_refused';
        break;
      }
      demand(zeroInputs(data), 'MUJOCO_PHY01_RUNTIME: nonzero input before step');
      if (entry.mode === 'split') {
        const before = stateBytes(copyNative(data), f.phase.preserveAcrossStep1);
        run.phase = 'mj_step1';
        dispatch('mj_step1');
        demand(
          equalBytes(before, stateBytes(copyNative(data), f.phase.preserveAcrossStep1)),
          'MUJOCO_PHY01_PHASE: mj_step1 changed qpos/qvel/time',
        );
        demand(data.ncon === 0 && data.nefc === 0, 'MUJOCO_PHY01_PHASE: contact after mj_step1');
        run.invariantCounts.step1Preserved += 1;
        run.phase = 'mj_step2';
        counters.advancesDispatched += 1;
        dispatch('mj_step2');
      } else {
        run.phase = 'mj_step';
        counters.advancesDispatched += 1;
        dispatch('mj_step');
      }
      counters.advancesCompleted += 1;
      run.steps = step;
      run.phase = 'endpoint_observation';
      const snapshot = observe();
      const { state, warnings, ncon, nefc, awake } = snapshot;
      run.lastObservation = {
        stepIndex: step,
        phase: run.phase,
        state,
        warnings,
        contactCount: ncon,
        constraintCount: nefc,
      };
      stateBytes(state);
      demand(
        same(state.qpos.slice(3), [1, 0, 0, 0]) && zeroArray(state.qvel.slice(3)),
        'MUJOCO_PHY01_RUNTIME: unexpected rotation',
      );
      run.invariantCounts.finite += 1;
      demand(
        ncon === 0 && nefc === 0 && awake === model.ntree,
        'MUJOCO_PHY01_RUNTIME: contact, constraint or sleeping tree',
      );
      run.invariantCounts.noContact += 1;
      demand(zeroWarnings(warnings), 'MUJOCO_PHY01_RUNTIME: native warning');
      run.invariantCounts.warningFree += 1;
      demand(zeroInputs(data), 'MUJOCO_PHY01_RUNTIME: nonzero applied input');
      run.invariantCounts.zeroInput += 1;
      const timeUs = step * entry.dtUs;
      demand(
        Math.abs(state.time - timeUs / 1e6) <= nativeTimeBudget(step, entry.dtUs),
        'MUJOCO_PHY01_RUNTIME: native time does not match integer schedule',
      );
      run.invariantCounts.nativeTime += 1;
      await emit(snapshot, RECORD_KIND.endpoint, entry.mode === 'split' ? 255 : 127);
      if (f.sampleTimesUs.includes(timeUs))
        run.samples.push({
          timeUs,
          stepIndex: step,
          nativeTime: state.time,
          position: state.qpos.slice(0, 3),
          quaternion: state.qpos.slice(3),
          velocity: state.qvel.slice(0, 3),
          angularVelocity: state.qvel.slice(3),
          acceleration: state.qacc.slice(0, 3),
          nativeState: state,
          contactCount: ncon,
          constraintCount: nefc,
          clearanceM: state.qpos[2] - f.sphereRadiusM - f.floorTopZ,
        });
      previous = snapshot;
      if (onOfflineBarrier && step === 400) {
        await flush();
        run.phase = 'offline_barrier';
        const beforeCounts = [
          counters.worlds,
          counters.models.returned,
          counters.data.returned,
          counters.advanceSlotsReserved,
          counters.advancesDispatched,
          counters.advancesCompleted,
          counters.mj_step1.dispatched,
          counters.mj_step2.dispatched,
          counters.mj_step.dispatched,
        ];
        await onOfflineBarrier({
          worldOrdinal,
          tick: step,
          sourceTimeUs: timeUs,
          stateSha256: await sha256(stateBytes(state)),
          counters: beforeCounts,
        });
        demand(
          same(beforeCounts, [
            counters.worlds,
            counters.models.returned,
            counters.data.returned,
            counters.advanceSlotsReserved,
            counters.advancesDispatched,
            counters.advancesCompleted,
            counters.mj_step1.dispatched,
            counters.mj_step2.dispatched,
            counters.mj_step.dispatched,
          ]),
          'OFFLINE_CHANGED_COUNTERS',
        );
        const resumed = observe();
        assertSameSnapshot(snapshot, resumed, 'OFFLINE_CHANGED_NATIVE_STATE');
        demand(zeroInputs(data), 'OFFLINE_CHANGED_NATIVE_INPUT');
        await emit(resumed, RECORD_KIND.offlineResume, 256, true);
      }
    }
    await flush();
    if (!quota) run.phase = 'complete';
  } catch (error) {
    run.error = String(error);
    run.errorPhase = run.phase;
    run.failure = failureRecord(error, run.phase);
    if (data && counters.failureObservations === 0) {
      counters.failureObservations += 1;
      try {
        await emit(observe(), RECORD_KIND.failure, 0, true);
      } catch (diagnosticError) {
        run.failureObservationError = String(diagnosticError);
        run.failureObservationFailure = failureRecord(diagnosticError, 'failure_observation');
      }
    }
  } finally {
    if (data) {
      counters.dataDeleted.dispatched += 1;
      try {
        data.delete();
        counters.dataDeleted.returned += 1;
        counters.liveData -= 1;
      } catch (error) {
        run.cleanupErrors.push('data: ' + String(error));
        run.cleanupFailures.push(failureRecord(error, 'delete_data'));
      }
    }
    if (model) {
      counters.modelsDeleted.dispatched += 1;
      try {
        model.delete();
        counters.modelsDeleted.returned += 1;
        counters.liveModels -= 1;
      } catch (error) {
        run.cleanupErrors.push('model: ' + String(error));
        run.cleanupFailures.push(failureRecord(error, 'delete_model'));
      }
    }
    records = null;
    if (run.cleanupErrors.length && !run.failure) {
      run.failure = run.cleanupFailures[0];
      run.error = run.cleanupErrors[0];
      run.errorPhase = run.failure.phase;
    }
  }
  return run;
}
