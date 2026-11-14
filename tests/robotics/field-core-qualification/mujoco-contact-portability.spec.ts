import type { MainModule, MjData, MjModel } from '@mujoco/mujoco';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { closeSync, fsyncSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import {
  canonicalEqual,
  captureGeometry,
  dot,
  frameError,
  norm,
  quaternionMatrix,
  rotate,
  scale,
} from '../../../tools/robotics-field-core/mujoco-contact-observer.mjs';
import {
  readFixture,
  verifyEngineArtifacts,
} from '../../../tools/robotics-field-core/mujoco-phy01.mjs';
import fixture from './mujoco-contact-portability.fixture.json';

const fixtureSha256 = '3279bbae02ffb39d9db7c5aaa931bdad9d98faf8c4b2c86d4ffdffb1586b4c38';
const rawPath = process.env['ASA_ROBOTICS_PORTABILITY_RAW'];
const receiptPath = process.env['ASA_ROBOTICS_PORTABILITY_OUTPUT'];
const sourceSha256 = process.env['ASA_ROBOTICS_PORTABILITY_SOURCE_SHA256'];
const nativeFlag = 'nativeccd="enable"';
const archiveError = 'PRECONDITION_TRACTION_CONTINUOUS_LOADED_SUPPORT';

interface Pose {
  qpos: number[];
  time: number;
}
interface ArchivedContact {
  geom: number[];
  frame: number[];
  pos: number[];
  dist: number;
  efc_address: number;
  friction: number[];
  solref: number[];
  solreffriction: number[];
  solimp: number[];
  adhesion: number;
  includemargin: number;
  surfacevel: number[];
  exclude: number;
}
interface SavedRecord {
  tick: number;
  parity: { pre: Pose; endpoint: Pose; contacts: ArchivedContact[] };
  nativeCounts: { ncon: number; nefc: number; nisland: number };
}
interface Frame {
  world: string;
  kind: string;
  schema?: string;
  fixtureSha256?: string;
  assessment?: { verdict: string };
  tick?: number;
  xml?: string;
  readback?: Record<string, number | number[]> & { options: Record<string, number | number[]> };
  record?: SavedRecord;
  bytes?: Buffer;
  error?: string;
  observation?: { forcePhase: string; native: SavedRecord['nativeCounts'] & { state: Pose } };
}
interface PoseInput {
  name: string;
  tick: number;
  frameSha256: string;
  pose: Pose;
  contacts: ArchivedContact[];
  counts: SavedRecord['nativeCounts'];
}
type Registration = (typeof fixture.cases)[number];
type Initialization = Required<Pick<Frame, 'xml' | 'readback'>>;
type LoadedCase = {
  registration: Registration;
  initialization: Initialization;
  inputs: PoseInput[];
};
type Geometry = ReturnType<typeof captureGeometry>;
type Profile = (typeof fixture.profiles)[number];

function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function requireEvidence(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(code);
}

// The journal uses canonical tagged values inside length-prefixed records. Only
// selected, already hash-verified frames are decoded.
function decode(bytes: Buffer): unknown {
  let offset = 0;
  function value(): unknown {
    const tag = bytes.readUInt8(offset++);
    if (tag === 0) return null;
    if (tag === 1) return false;
    if (tag === 2) return true;
    if (tag === 3) {
      const number = bytes.readDoubleLE(offset);
      offset += 8;
      return number;
    }
    const length = bytes.readUInt32LE(offset);
    offset += 4;
    if (tag === 4 || tag === 7) {
      requireEvidence(offset + length <= bytes.length, 'ARCHIVE_SCALAR_LENGTH');
      const part = bytes.subarray(offset, offset + length);
      offset += length;
      return tag === 4 ? part.toString('utf8') : part;
    }
    if (tag === 5) {
      return Array.from({ length }, value);
    }
    requireEvidence(tag === 6, 'ARCHIVE_TAG');
    const fields: [string, unknown][] = [];
    for (let i = 0; i < length; i += 1) {
      const key = value();
      requireEvidence(typeof key === 'string', 'ARCHIVE_KEY');
      fields.push([key, value()]);
    }
    return Object.fromEntries(fields);
  }
  const result = value();
  requireEvidence(offset === bytes.length, 'ARCHIVE_TRAILING_DATA');
  return result;
}

function frameArchive(path: string) {
  const bytes = readFileSync(path);
  requireEvidence(bytes.length === fixture.archive.bytes, 'ARCHIVE_SIZE');
  requireEvidence(sha256(bytes) === fixture.archive.sha256, 'ARCHIVE_HASH');
  const frames: Buffer[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    const length = bytes.readUInt32LE(offset);
    offset += 4;
    requireEvidence(length > 0 && offset + length <= bytes.length, 'ARCHIVE_FRAME_LENGTH');
    frames.push(bytes.subarray(offset, offset + length));
    offset += length;
  }
  requireEvidence(frames.length === fixture.archive.frames, 'ARCHIVE_FRAME_COUNT');
  return (index: number) => ({
    digest: sha256(frames[index]),
    value: decode(frames[index]) as Frame,
  });
}

function readCases(path: string): LoadedCase[] {
  const frame = frameArchive(path);
  const schema = frame(0).value;
  const invocation = frame(1).value;
  const final = frame(fixture.archive.frames - 1).value;
  requireEvidence(
    schema.kind === 'schema' &&
      schema.schema === 'ASA_MUJOCO_ROLLING_CHASSIS_RAW_V1' &&
      invocation.kind === 'invocation' &&
      invocation.fixtureSha256 === fixture.archive.rollingFixtureSha256 &&
      final.kind === 'invocation-end' &&
      final.assessment?.verdict === 'FAIL',
    'ARCHIVE_SCHEMA_FIXTURE_AND_VERDICT',
  );
  return fixture.cases.map((registration) => {
    const init = frame(registration.initializationFrame).value;
    requireEvidence(
      init.kind === 'world-initialization' &&
        init.world === registration.world &&
        init.xml &&
        init.readback &&
        sha256(init.xml) === registration.xmlSha256,
      'ARCHIVE_WORLD_BINDING',
    );
    const initialization = { xml: init.xml, readback: init.readback };
    const inputs = registration.poses.map(({ name, tick, frame: index }): PoseInput => {
      const { value, digest } = frame(index);
      const record = value.record;
      requireEvidence(value.world === registration.world && record, 'ARCHIVE_POSE_BINDING');
      if (name === 'negative-gap') {
        requireEvidence(
          registration.failureFrame !== undefined &&
            registration.independentEndpointFrame !== undefined,
          'ARCHIVE_NEGATIVE_REGISTRATION',
        );
        const failure = frame(registration.failureFrame).value;
        const independent = frame(registration.independentEndpointFrame).value;
        requireEvidence(independent.bytes, 'ARCHIVE_INDEPENDENT_PREVIOUS_ENDPOINT');
        const previous = (decode(independent.bytes) as SavedRecord).parity.endpoint;
        const pose = record.parity.endpoint;
        requireEvidence(
          record.tick === tick - 1 &&
            pose.time === 0.0005 &&
            canonicalEqual(pose, previous) &&
            failure.kind === 'failure' &&
            failure.world === registration.world &&
            failure.tick === tick &&
            failure.error === archiveError &&
            failure.observation?.forcePhase === 'SOLVED_RETAINED_INTERVAL' &&
            failure.observation.native.state.time === 0.001 &&
            failure.observation.native.ncon === 0 &&
            failure.observation.native.nefc === 0 &&
            failure.observation.native.nisland === 0,
          'ARCHIVE_NEGATIVE_PRE_POST_BINDING',
        );
        return {
          name,
          tick,
          frameSha256: digest,
          pose,
          contacts: [],
          counts: { ncon: 0, nefc: 0, nisland: 0 },
        };
      }
      requireEvidence(record.tick === tick && value.tick === tick, 'ARCHIVE_POSITIVE_TICK');
      return {
        name,
        tick,
        frameSha256: digest,
        pose: record.parity.pre,
        contacts: record.parity.contacts,
        counts: record.nativeCounts,
      };
    });
    for (const { pose } of inputs) {
      requireEvidence(
        pose.qpos.length === 11 && [...pose.qpos, pose.time].every(Number.isFinite),
        'ARCHIVE_POSE_SHAPE',
      );
    }
    return { registration, initialization, inputs };
  });
}

function modelXml(xml: string, profile: Profile): string {
  requireEvidence(xml.split(nativeFlag).length === 2, 'ARCHIVE_NATIVECCD_FLAG');
  return profile.disableFlags === fixture.profiles[0].disableFlags
    ? xml
    : xml.replace(nativeFlag, 'nativeccd="disable"');
}

function modelReadback(model: MjModel, expected: Initialization['readback'], profile: Profile) {
  function copy(keys: string[], nativeObject: object) {
    const values = nativeObject as Record<string, number | ArrayLike<number>>;
    return Object.fromEntries(
      keys.map((key) => [
        key,
        typeof values[key] === 'number'
          ? values[key]
          : Array.from(values[key] as ArrayLike<number>),
      ]),
    );
  }
  const { options, ...structure } = expected;
  const actual = {
    ...copy(Object.keys(structure), model),
    options: copy(Object.keys(options), model.opt),
  };
  requireEvidence(
    canonicalEqual(actual, {
      ...expected,
      options: { ...options, disableflags: profile.disableFlags },
    }),
    'NATIVE_MODEL_READBACK',
  );
  return actual;
}

function normalizedReference(vector: number[]): number[] {
  const length = norm(vector);
  requireEvidence(Number.isFinite(length) && length > 0, 'INVALID_GEOMETRY_REFERENCE');
  return scale(vector, 1 / length);
}

function planeNormalAligned(normal: number[], reference: number[], sign: number): boolean {
  return Math.abs(sign * dot(normal, reference) - 1) <= fixture.rollingGeometry.frameTolerance;
}

function projectedCylinderRadius(
  normal: number[],
  axis: number[],
  radius: number,
  halfWidth: number,
) {
  const cos = Math.min(1, Math.abs(dot(normal, axis)));
  return radius * Math.sqrt(Math.max(0, 1 - cos * cos)) + halfWidth * cos;
}

function assessGeometry(input: PoseInput, current: Geometry, readback: Initialization['readback']) {
  const g = fixture.rollingGeometry;
  const radians = (g.slopeDegrees * Math.PI) / 180;
  const slopeNormal = normalizedReference([-Math.sin(radians), 0, Math.cos(radians)]);
  const geomSize = readback.geom_size as number[];
  const pairKey = (pair: number[]) => [...pair].sort((a, b) => a - b).join('/');
  const negative = input.name === 'negative-gap';
  const wheel = (id: number) => {
    const center = current.poses.geom_xpos.slice(3 * id, 3 * id + 3) as number[];
    const axis = [2, 5, 8].map((index) => current.poses.geom_xmat[9 * id + index] as number);
    return { center, axis, radius: geomSize[3 * id], halfWidth: geomSize[3 * id + 1] };
  };
  const clearanceM = negative
    ? [2, 3, 4, 5].map((id) => {
        const { center, axis, radius, halfWidth } = wheel(id);
        return (
          dot(slopeNormal, center) - projectedCylinderRadius(slopeNormal, axis, radius, halfWidth)
        );
      })
    : [];
  const issues: string[] = [];
  if (current.nefc !== 3 * current.ncon) issues.push('CONTACT_CONSTRAINT_ROW_COUNT');
  if (
    negative &&
    (current.ncon !== 0 ||
      current.nefc !== 0 ||
      current.nisland !== 0 ||
      !clearanceM.every((gap) => gap > 0))
  )
    issues.push('NEGATIVE_EXPECTED_SEPARATION');
  const expectedPairs = [...new Set(input.contacts.map((c) => pairKey(c.geom)))].sort();
  const actualPairs = [...new Set(current.contacts.map((c) => pairKey(c.geom)))].sort();
  if (!canonicalEqual(actualPairs, expectedPairs)) issues.push('WHEEL_TERRAIN_PAIR_COVERAGE');

  for (const c of current.contacts) {
    const [terrain, wheelId] = [...c.geom].sort((a, b) => a - b);
    const reference = input.contacts.find((prior) => pairKey(prior.geom) === pairKey(c.geom));
    if (
      !reference ||
      !(
        [
          'friction',
          'solref',
          'solreffriction',
          'solimp',
          'adhesion',
          'includemargin',
          'surfacevel',
        ] as const
      ).every((key) => canonicalEqual(c[key], reference[key]))
    )
      issues.push('CONTACT_MATERIAL');
    if (!(
      c.exclude === 0 &&
      c.efc_address >= 0 &&
      current.efcId.slice(c.efc_address, c.efc_address + 3).length === 3 &&
      current.efcId.slice(c.efc_address, c.efc_address + 3).every((id) => id === c.index) &&
      frameError(c.frame) <= g.frameTolerance &&
      c.dist < 0 &&
      c.dist >= -g.maxPenetrationM
    )) {
      issues.push('CONTACT_FRAME_DISTANCE_OR_ROWS');
    }
    if (negative) continue;
    const { center, axis, radius, halfWidth } = wheel(wheelId);
    const normal = terrain === 1 ? slopeNormal : [0, 0, 1];
    const normalSign = c.geom[1] === wheelId ? 1 : -1;
    const point = c.pos as number[];
    const offset = point.map((component, i) => component - center[i]);
    const axial = dot(axis, offset);
    const radial = Math.sqrt(Math.max(0, dot(offset, offset) - axial ** 2));
    const height = dot(point, normal);
    const x = point[0] - height * normal[0];
    const y = point[1] - height * normal[1];
    const minX = terrain === 1 ? 0 : g.flatMinXM;
    const maxX = terrain === 1 ? g.wedgeHorizontalLengthM : g.flatMaxXM;
    if (
      !planeNormalAligned(c.frame.slice(0, 3), normal, normalSign) ||
      Math.abs(radial - radius) > g.shapeWitnessAllowanceM ||
      Math.abs(axial) > halfWidth + g.shapeWitnessAllowanceM ||
      Math.abs(height) > g.maxPenetrationM / 2 + g.planeWitnessAllowanceM
    )
      issues.push('CONTACT_WITNESS_DOMAIN');
    // At the toe the archived forewheels have pairs from both surfaces, and
    // the finite interior/normal-height admission is deliberately inapplicable.
    if (
      input.name !== 'toe' &&
      (Math.abs(dot(center, normal) - radius) > g.shapeWitnessAllowanceM ||
        x < minX + g.interiorMarginM ||
        x > maxX - g.interiorMarginM ||
        Math.abs(y) > g.wedgeHalfWidthM - g.interiorMarginM)
    )
      issues.push('CONTACT_INTERIOR_SUPPORT_DOMAIN');
  }
  return { clearanceM, expectedPairs, actualPairs, issues };
}

function copyUnintegratedState(data: MjData) {
  return { qpos: Array.from(data.qpos), qvel: Array.from(data.qvel), time: data.time };
}

function openReceipt(path: string) {
  const currentFile = fileURLToPath(import.meta.url);
  const root = realpathSync.native(resolve(dirname(currentFile), '..', '..', '..'));
  const directory = realpathSync.native(dirname(path));
  const temp = realpathSync.native(tmpdir());
  const isUnder = (parent: string, child: string) => {
    const childPath = relative(parent, child);
    return !isAbsolute(childPath) && childPath !== '..' && !childPath.startsWith('..' + sep);
  };
  requireEvidence(
    isAbsolute(path) &&
      resolve(path) === path &&
      directory === dirname(path) &&
      isUnder(temp, directory) &&
      !isUnder(root, directory),
    'RECEIPT_ABSOLUTE_EXTERNAL_TEMP_PATH',
  );
  return openSync(path, 'wx');
}

function measurePositions(
  M: MainModule,
  cases: LoadedCase[],
  receipt: {
    records: unknown[];
    dispatches: number;
    returns: number;
    models: number;
    freed: number;
  },
) {
  for (const profile of fixture.profiles) {
    for (const { registration, initialization, inputs } of cases) {
      requireEvidence(receipt.models < fixture.limits.models, 'MODEL_BUDGET');
      const xml = modelXml(initialization.xml, profile);
      const model = M.MjModel.from_xml_string(xml);
      receipt.models += 1;
      let data: MjData | undefined;
      try {
        const readback = modelReadback(model, initialization.readback, profile);
        const pairA = initialization.readback.pair_geom1 as number[];
        const pairB = initialization.readback.pair_geom2 as number[];
        const maxContacts = pairA.length * fixture.limits.contactsPerPair;
        const limits = {
          nbody: model.nbody,
          ngeom: model.ngeom,
          maxContacts,
          maxConstraintRows: 3 * maxContacts,
          maxIslands: model.ntree,
          pairCaps: pairA.map((geom, i) => ({
            geom: [geom, pairB[i]],
            maxContacts: fixture.limits.contactsPerPair,
          })),
          warningCount: 7,
          maxWarningObservations: inputs.length,
          maxWarningGets: 7 * inputs.length,
          maxContactVectors: inputs.length,
          maxContactGets: maxContacts * inputs.length,
        };
        const resources = { temporaryCreated: 0, temporaryDeleted: 0 };
        receipt.records.push({
          world: registration.world,
          profile,
          xmlSha256: sha256(xml),
          readback,
          resources,
        });
        data = new M.MjData(model);
        for (const input of inputs) {
          requireEvidence(
            receipt.dispatches < fixture.limits.positionCalls,
            'POSITION_CALL_BUDGET',
          );
          data.qpos.set(input.pose.qpos);
          data.time = input.pose.time;
          const before = copyUnintegratedState(data);
          requireEvidence(
            canonicalEqual(before.qpos, input.pose.qpos) &&
              Object.is(before.time, input.pose.time) &&
              before.qvel.every((v) => v === 0),
            'RESTORED_POSITION_READBACK',
          );
          receipt.records.push({
            world: registration.world,
            profile: profile.name,
            phase: 'position-dispatch',
            input,
            before,
          });
          receipt.dispatches += 1;
          M.mj_fwdPosition(model, data);
          receipt.returns += 1;
          const after = copyUnintegratedState(data);
          const geometry = captureGeometry(data, resources, limits);
          const assessment = assessGeometry(input, geometry, initialization.readback);
          const issues = assessment.issues;
          if (!canonicalEqual(before, after)) issues.push('POSITION_STAGE_MUTATED_STATE');
          if (geometry.warnings.some((warning) => warning.some((word) => word !== 0)))
            issues.push('NATIVE_WARNING');
          if (profile === fixture.profiles[0]) {
            const rawKeys = ['geom', 'dist', 'frame', 'pos', 'efc_address'] as const;
            const contacts = (rows: ArchivedContact[]) =>
              rows.map((c) => rawKeys.map((key) => c[key]));
            if (
              /negative/.test(input.name)
                ? geometry.ncon !== 0
                : !(
                    geometry.ncon === input.counts.ncon &&
                    geometry.nefc === input.counts.nefc &&
                    geometry.nisland === input.counts.nisland &&
                    canonicalEqual(
                      contacts(geometry.contacts as ArchivedContact[]),
                      contacts(input.contacts),
                    )
                  )
            )
              issues.push('ARCHIVE_CONTROL_CONTACT_PARITY');
          }
          if (resources.temporaryCreated !== resources.temporaryDeleted)
            issues.push('WRAPPER_LIFETIME');
          receipt.records.push({
            world: registration.world,
            profile: profile.name,
            input,
            before,
            after,
            geometry,
            assessment,
          });
        }
      } finally {
        try {
          data?.delete();
        } finally {
          model.delete();
          receipt.freed += 1;
        }
      }
    }
  }
}

it('locks the case-global profile change and eight position-only calls', () => {
  const fixtureUrl = new URL('./mujoco-contact-portability.fixture.json', import.meta.url);
  expect(sha256(readFileSync(fixtureUrl))).toBe(fixtureSha256);
  expect(fixture.profiles[1].disableFlags ^ fixture.profiles[0].disableFlags).toBe(1 << 17);
  expect(fixture.cases.length * fixture.profiles.length).toBe(fixture.limits.models);
  expect(fixture.cases.flatMap((c) => c.poses).length * fixture.profiles.length).toBe(
    fixture.limits.positionCalls,
  );
  expect(projectedCylinderRadius([0, 0, 1], [0, 1, 0], 0.04, 0.01)).toBe(0.04);
  expect(projectedCylinderRadius([0, 0, 1], [0, 0, 1], 0.04, 0.01)).toBe(0.01);
  const upward = normalizedReference([0, 0, 3]);
  expect(planeNormalAligned([0, 0, 1], upward, 1)).toBe(true);
  expect(planeNormalAligned([0, 0, -1], upward, -1)).toBe(true);
  expect(planeNormalAligned([0, 0, -1], upward, 1)).toBe(false);
  expect(planeNormalAligned([0, 0.6, 0.8], upward, 1)).toBe(false);
  expect(() => normalizedReference([0, 0, 0])).toThrow('INVALID_GEOMETRY_REFERENCE');
  expect(() => normalizedReference([0, 0, Infinity])).toThrow('INVALID_GEOMETRY_REFERENCE');
});

it.runIf(Boolean(rawPath))(
  'validates the archived positive PRE and separate negative endpoint',
  () => {
    const loaded = readCases(rawPath!);
    expect(loaded[0].inputs.map((input) => input.counts.ncon)).toEqual([8, 12, 8]);
    expect(loaded[0].inputs.map(({ counts }) => counts.nefc === 3 * counts.ncon)).toEqual([
      true,
      true,
      true,
    ]);
    expect(loaded[1].inputs[0].pose.time).toBe(0.0005);
    expect(loaded[1].inputs[0].contacts).toEqual([]);
    const { pose } = loaded[1].inputs[0];
    const readback = loaded[1].initialization.readback;
    const rotation = quaternionMatrix(pose.qpos.slice(3, 7));
    const axis = rotate(rotation, [0, 1, 0]);
    const angle = fixture.rollingGeometry.slopeDegrees * (Math.PI / 180);
    const normal = normalizedReference([-Math.sin(angle), 0, Math.cos(angle)]);
    for (const input of loaded[0].inputs) {
      for (const contact of input.contacts) {
        const onRamp = contact.geom.includes(1);
        const terrain = onRamp ? 1 : 0;
        const reference = onRamp ? normal : [0, 0, 1];
        expect(
          planeNormalAligned(
            contact.frame.slice(0, 3),
            reference,
            contact.geom[0] === terrain ? 1 : -1,
          ),
        ).toBe(true);
      }
    }
    const bodyPositions = readback.body_pos as number[];
    const geomSizes = readback.geom_size as number[];
    const gaps = [2, 3, 4, 5].map((id) => {
      const offset = rotate(rotation, bodyPositions.slice(3 * id, 3 * id + 3));
      const center = offset.map((component: number, index: number) => component + pose.qpos[index]);
      return (
        dot(normal, center) -
        projectedCylinderRadius(normal, axis, geomSizes[3 * id], geomSizes[3 * id + 1])
      );
    });
    expect(gaps.every((gap) => gap > 0)).toBe(true);
    const xml = loaded[0].initialization.xml;
    expect(modelXml(xml, fixture.profiles[0])).toBe(xml);
    expect(modelXml(xml, fixture.profiles[1]).replace('nativeccd="disable"', nativeFlag)).toBe(xml);
  },
);

it.runIf(Boolean(receiptPath))(
  'observes the same archived ramp geometry under both global CCD profiles',
  async () => {
    const currentSha256 = sha256(readFileSync(new URL(import.meta.url)));
    const currentFixture = sha256(
      readFileSync(new URL('./mujoco-contact-portability.fixture.json', import.meta.url)),
    );
    requireEvidence(
      sourceSha256?.toLowerCase() === currentSha256 && currentFixture === fixtureSha256,
      'SOURCE_ADMISSION_HASH',
    );
    requireEvidence(rawPath && isAbsolute(rawPath), 'ARCHIVE_ABSOLUTE_INPUT');
    const cases = readCases(rawPath);
    const fd = openReceipt(receiptPath!);
    const receipt = {
      fixture,
      fixtureSha256,
      sourceSha256: currentSha256,
      runtimeVersion: '',
      models: 0,
      freed: 0,
      dispatches: 0,
      returns: 0,
      records: [] as unknown[],
      error: null as string | null,
    };
    try {
      const { packageRoot, ...provenance } = verifyEngineArtifacts(readFixture().fixture);
      requireEvidence(provenance.wasmSha256 === fixture.engine.wasmSha256, 'PINNED_WASM');
      const { default: loadMujoco } = await import(
        pathToFileURL(resolve(packageRoot, 'mujoco.js')).href
      );
      const M: MainModule = await loadMujoco({
        wasmBinary: readFileSync(resolve(packageRoot, 'mujoco.wasm')),
        locateFile(name: string) {
          requireEvidence(name === 'mujoco.wasm', 'ENGINE_RESOURCE');
          return resolve(packageRoot, name);
        },
      });
      receipt.runtimeVersion = M.mj_versionString();
      requireEvidence(receipt.runtimeVersion === fixture.engine.version, 'NATIVE_VERSION');
      measurePositions(M, cases, receipt);
    } catch (error) {
      receipt.error = String(error);
    } finally {
      try {
        const bytes = Buffer.from(JSON.stringify(receipt) + '\n', 'utf8');
        requireEvidence(bytes.length <= fixture.limits.receiptBytes, 'RECEIPT_SIZE');
        writeFileSync(fd, bytes);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
    }
    expect(receipt.error).toBeNull();
    expect(receipt.models).toBe(fixture.limits.models);
    expect(receipt.freed).toBe(receipt.models);
    expect(receipt.dispatches).toBe(fixture.limits.positionCalls);
    expect(receipt.returns).toBe(receipt.dispatches);
    const positions = receipt.records.filter(
      (r): r is { input: PoseInput; assessment: { issues: string[] } } =>
        typeof r === 'object' && r !== null && 'assessment' in r,
    );
    expect(
      positions.map(({ input, assessment }) => ({ name: input.name, issues: assessment.issues })),
    ).toEqual(positions.map(({ input }) => ({ name: input.name, issues: [] })));
  },
  60_000,
);
