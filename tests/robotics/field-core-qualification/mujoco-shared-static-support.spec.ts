import type { MainModule, MjModel } from '@mujoco/mujoco';
import { createHash } from 'node:crypto';
import { closeSync, openSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import {
  canonicalEqual,
  captureGeometry,
  dot,
  frameError,
  quaternionMatrix,
  rotate,
} from '../../../tools/robotics-field-core/mujoco-contact-observer.mjs';
import { decodeRetainedGeometryInput } from '../../../tools/robotics-field-core/mujoco-cylinder.mjs';
import {
  readFixture,
  verifyEngineArtifacts,
} from '../../../tools/robotics-field-core/mujoco-phy01.mjs';
import fixture from './mujoco-shared-static-support.fixture.json';

const fixtureUrl = new URL('./mujoco-shared-static-support.fixture.json', import.meta.url);
const fixtureSha = '4a31a2c3a02cde84d2e3970b7e2a518f5a8a239c25379d64e59a393f2dd16548';
const archives = process.env['ASA_ROBOTICS_STATIC_SUPPORT_ARCHIVES'];
const output = process.env['ASA_ROBOTICS_STATIC_SUPPORT_OUTPUT'];
const sourcePin = process.env['ASA_ROBOTICS_STATIC_SUPPORT_SOURCE_SHA256'];
type Point = [number, number];
type Geometry = ReturnType<typeof captureGeometry>;
const variants = ['box', 'plane'] as const;
type Variant = (typeof variants)[number];

function sha(bytes: string | Buffer) {
  return createHash('sha256').update(bytes).digest('hex');
}

function demand(value: unknown, error: string): asserts value {
  if (!value) throw new Error(error);
}

function pinnedFile(root: string, pin: (typeof fixture.archives)[keyof typeof fixture.archives]) {
  const path = resolve(root, pin.path);
  demand(statSync(path).size === pin.bytes, 'ARCHIVE_BYTE_COUNT');
  const bytes = readFileSync(path);
  demand(bytes.length === pin.bytes && sha(bytes) === pin.sha256, 'ARCHIVE_SHA256');
  return bytes;
}

// Read only the fixed archived frames. The enclosing journal SHA pins both the
// length prefixes and the canonical tagged data before any decoding.
function archivedFrame(journal: Buffer, expectedIndex: number): unknown {
  let cursor = 0;
  for (let i = 0; i < expectedIndex; i += 1) cursor += 4 + journal.readUInt32LE(cursor);
  const end = cursor + 4 + journal.readUInt32LE(cursor);
  cursor += 4;
  function decode(): unknown {
    const tag = journal.readUInt8(cursor++);
    if (tag === 0) return null;
    if (tag === 1) return false;
    if (tag === 2) return true;
    if (tag === 3) {
      const value = journal.readDoubleLE(cursor);
      cursor += 8;
      return value;
    }
    const count = journal.readUInt32LE(cursor);
    cursor += 4;
    demand(cursor + count <= end, 'ARCHIVE_TAG_LENGTH');
    if (tag === 4 || tag === 7) {
      const data = journal.subarray(cursor, cursor + count);
      cursor += count;
      return tag === 4 ? data.toString('utf8') : data;
    }
    if (tag === 5) return Array.from({ length: count }, decode);
    demand(tag === 6, 'ARCHIVE_TAG');
    return Object.fromEntries(Array.from({ length: count }, () => [decode(), decode()]));
  }
  const result = decode();
  demand(cursor === end, 'ARCHIVE_FRAME_BOUNDARY');
  return result;
}

interface RampContact {
  geom: number[];
  pos: number[];
  frame: number[];
  dist: number;
  efc_address: number;
  friction: number[];
}

function readInputs(root: string) {
  demand(isAbsolute(root), 'ABSOLUTE_ARCHIVE_ROOT');
  pinnedFile(root, fixture.archives.cylinderJournal);
  const cylinderPre = pinnedFile(root, fixture.archives.cylinderPre);
  const cylinder = decodeRetainedGeometryInput(cylinderPre, {
    inputBytes: fixture.archives.cylinderPre.bytes,
    inputSha256: fixture.archives.cylinderPre.sha256,
    inputSchema: 'CYLINDER_RETAINED_PRE_INPUTS_V1',
    world: 'tilt-normal-500-r1',
    firstTick: 291100,
    lastTick: 291500,
    poseCount: 401,
  });
  const rawCan = JSON.parse(cylinderPre.toString('utf8')).raw;
  demand(rawCan.sha256 === fixture.archives.cylinderJournal.sha256, 'CAN_PRE_JOURNAL_BINDING');
  const rampJournal = pinnedFile(root, fixture.archives.rollingJournal);
  const invocation = archivedFrame(rampJournal, 1) as { kind: string; fixtureSha256: string };
  demand(
    invocation.kind === 'invocation' && invocation.fixtureSha256 === fixture.rolling.fixtureSha256,
    'RAMP_FIXTURE_BINDING',
  );
  const init = archivedFrame(rampJournal, fixture.rolling.initializationFrame) as {
    kind: string;
    world: string;
    xml: string;
  };
  demand(
    init.kind === 'world-initialization' &&
      init.world === fixture.rolling.world &&
      sha(init.xml) === fixture.rolling.xmlSha256,
    'RAMP_XML_BINDING',
  );
  const samples = fixture.poses.map((entry) => {
    const can = cylinder.poses.find((pose: { tick: number }) => pose.tick === entry.canTick);
    demand(can?.sourceRecordSha256 === entry.canRecordSha256, 'CAN_PRE_RECORD_SHA256');
    const frame = archivedFrame(rampJournal, entry.rampFrame) as {
      world: string;
      tick: number;
      record: {
        tick: number;
        parity: { pre: { qpos: number[]; time: number }; contacts: RampContact[] };
      };
    };
    const ramp = frame.record.parity;
    demand(
      frame.world === fixture.rolling.world &&
        frame.tick === entry.rampTick &&
        frame.record.tick === entry.rampTick &&
        ramp.pre.qpos.length === 11 &&
        ramp.contacts.length === entry.rampContacts,
      'RAMP_PRE_BINDING',
    );
    return { entry, ramp, can: canInDeckFrame(can.qpos), canTime: can.time };
  });
  return { xml: init.xml, samples };
}

function canInDeckFrame(qpos: number[]) {
  const [theta, x, y, z, w, qx, qy, qz] = qpos;
  const c = Math.cos(theta / 2),
    s = Math.sin(theta / 2);
  const inverse = quaternionMatrix([c, 0, -s, 0]);
  const center: number[] = rotate(inverse, [x, y, z]);
  const rotation = [c * w + s * qy, c * qx - s * qz, c * qy - s * w, c * qz + s * qx];
  const axis: number[] = rotate(quaternionMatrix(rotation), [0, 0, 1]);
  const base = center.map((value, i) => value - fixture.can.halfHeightM * axis[i]);
  const gravityIntercept: Point = [center[0] + center[2] * Math.tan(theta), center[1]];
  const [dx, dy] = gravityIntercept.map((value, i) => value - base[i]);
  const dz = -(axis[0] * dx + axis[1] * dy) / axis[2];
  const diskMargin = fixture.can.radiusM - Math.hypot(dx, dy, dz);
  const axialReach = fixture.can.halfHeightM * Math.abs(axis[2]);
  const radialReach = fixture.can.radiusM * Math.hypot(axis[0], axis[1]);
  const clearance = center[2] - axialReach - radialReach;
  // Pinned mjc_PlaneCylinder tests the closest point, opposite cap, then two
  // symmetric near-cap rim points at ±120°. At these poses only the first is active.
  const farCapClearance = center[2] + axialReach - radialReach;
  const otherRimClearance = center[2] - axialReach + radialReach / 2;
  const expectedPlaneContacts =
    clearance <= 0 ? 1 + Number(farCapClearance <= 0) + 2 * Number(otherRimClearance <= 0) : 0;
  return {
    theta,
    center,
    rotation,
    axis,
    base,
    gravityIntercept,
    diskMargin,
    clearance,
    farCapClearance,
    otherRimClearance,
    expectedPlaneContacts,
  };
}

function sharedXml(rampXml: string) {
  const support = variants
    .map((name) => {
      const y = fixture.support[name === 'box' ? 'boxY' : 'planeY'];
      const z = name === 'box' ? -fixture.support.deckHalfSizeM[2] : 0;
      return (
        `<geom name="support_${name}" type="${name}" size="${fixture.support.deckHalfSizeM.join(' ')}" pos="0 ${y} ${z}" contype="0" conaffinity="0"/>` +
        `<body name="can_${name}" pos="0 ${y} ${fixture.can.halfHeightM}"><freejoint name="free_${name}"/><inertial pos="0 0 0" mass="${fixture.can.massKg}" diaginertia="${fixture.can.inertiaKgM2.join(' ')}"/><geom name="cylinder_${name}" type="cylinder" size="${fixture.can.radiusM} ${fixture.can.halfHeightM}" contype="0" conaffinity="0"/></body>`
      );
    })
    .join('\n');
  const pairs = variants
    .map(
      (name) =>
        `<pair geom1="support_${name}" geom2="cylinder_${name}" condim="3" margin="0" gap="0" friction="${fixture.support.mu} ${fixture.support.mu} 0 0 0" solref="0.004 1" solreffriction="0 0" solimp="0.99 0.99 0.001 0.5 2"/>`,
    )
    .join('\n');
  const seam = '</worldbody><contact>';
  demand(
    rampXml.split(seam).length === 2 && rampXml.split('</contact>').length === 2,
    'SHARED_XML_SEAM',
  );
  return rampXml.replace(seam, support + seam).replace('</contact>', pairs + '</contact>');
}

function polygonMargin(points: Point[], test: Point): number | null {
  const cross = (a: Point, b: Point, c: Point) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const unique = sorted.filter(
    (p, i) => i === 0 || p[0] !== sorted[i - 1][0] || p[1] !== sorted[i - 1][1],
  );
  const chain = (sequence: Point[]) => {
    const hull: Point[] = [];
    for (const p of sequence) {
      while (hull.length >= 2 && cross(hull.at(-2)!, hull.at(-1)!, p) <= 0) hull.pop();
      hull.push(p);
    }
    return hull.slice(0, -1);
  };
  const hull = [...chain(unique), ...chain(unique.toReversed())];
  if (hull.length < 3) return null;
  return Math.min(
    ...hull.map((p, i) => {
      const q = hull[(i + 1) % hull.length];
      return cross(p, q, test) / Math.hypot(q[0] - p[0], q[1] - p[1]);
    }),
  );
}

function supportGeometry(
  contacts: Geometry['contacts'],
  supportId: number,
  y: number,
  can: ReturnType<typeof canInDeckFrame>,
) {
  const tolerance = fixture.support.surfaceToleranceM;
  const points: Point[] = [];
  const issues = [];
  const [hx, hy] = fixture.support.deckHalfSizeM;
  for (const contact of contacts) {
    const sign = contact.geom[0] === supportId ? 1 : -1;
    const normal = contact.frame.slice(0, 3).map((value: number) => value * sign);
    const mid = contact.pos.map((value: number, i: number) => value - (i === 1 ? y : 0));
    const support = mid.map((value: number, i: number) => value - (contact.dist * normal[i]) / 2);
    const cylinder = mid.map((value: number, i: number) => value + (contact.dist * normal[i]) / 2);
    const offset = cylinder.map((value: number, i: number) => value - can.base[i]);
    if (
      Math.abs(dot(offset, can.axis)) > tolerance ||
      Math.hypot(...offset) > fixture.can.radiusM + tolerance ||
      Math.abs(support[2]) > tolerance ||
      Math.abs(support[0]) > hx - fixture.support.interiorMarginM ||
      Math.abs(support[1]) > hy - fixture.support.interiorMarginM ||
      !canonicalEqual(contact.friction.slice(0, 2), [fixture.support.mu, fixture.support.mu])
    )
      issues.push('CAN_SURFACE_WITNESS');
    if (Math.abs(normal[2] - 1) > fixture.support.frameTolerance) issues.push('CAN_DECK_NORMAL');
    if (
      !(contact.dist < 0) ||
      contact.includemargin !== 0 ||
      contact.adhesion !== 0 ||
      !canonicalEqual(contact.solref, [0.004, 1]) ||
      !canonicalEqual(contact.solreffriction, [0, 0]) ||
      !canonicalEqual(contact.solimp, [0.99, 0.99, 0.001, 0.5, 2]) ||
      !canonicalEqual(contact.surfacevel, [0, 0, 0])
    )
      issues.push('CAN_CONTACT_MATERIAL_OR_DISTANCE');
    points.push([support[0], support[1]]);
  }
  if (
    contacts.length === 0 ||
    Math.abs(Math.min(...contacts.map((c: { dist: number }) => c.dist)) - can.clearance) > tolerance
  )
    issues.push('CAN_ANALYTIC_CLEARANCE');
  return {
    count: contacts.length,
    points,
    marginM: polygonMargin(points, can.gravityIntercept),
    issues,
  };
}

function names(model: MjModel, addresses: ArrayLike<number>) {
  const bytes = Buffer.from(model.names);
  return Array.from(addresses, (offset) =>
    bytes.subarray(offset, bytes.indexOf(0, offset)).toString('utf8'),
  );
}

function sameRamp(geometry: Geometry, expected: RampContact[], geomNames: string[]) {
  const oldNames = [
    'flat',
    'ramp',
    'chassis_geom',
    ...Array.from({ length: 4 }, (_, i) => `wheel_geom_${i}`),
  ];
  const fields = (c: RampContact, label: string[]) => [
    c.geom.map((id) => label[id]),
    c.pos,
    c.frame,
    c.dist,
    c.friction,
  ];
  const observed = geometry.contacts.filter((c: RampContact) =>
    c.geom.every((id) => oldNames.includes(geomNames[id])),
  );
  return canonicalEqual(
    observed.map((c: RampContact) => fields(c, geomNames)),
    expected.map((c) => fields(c, oldNames)),
  );
}

function observe(
  M: MainModule,
  input: ReturnType<typeof readInputs>,
  receipt: { dispatches: number; returns: number; freed: boolean; records: unknown[] },
) {
  const xml = sharedXml(input.xml);
  const model = M.MjModel.from_xml_string(xml);
  let data: InstanceType<MainModule['MjData']> | undefined;
  try {
    const geomNames = names(model, model.name_geomadr);
    const find = (name: string) => {
      const id = geomNames.indexOf(name);
      demand(id >= 0, 'MISSING_NATIVE_GEOM');
      return id;
    };
    const canPairs = variants.map((name) => [find(`support_${name}`), find(`cylinder_${name}`)]);
    const pairs = Array.from(model.pair_geom1, (id, i) => [
      Number(id),
      Number(model.pair_geom2[i]),
    ]);
    const readback = {
      xmlSha256: sha(xml),
      geomNames,
      canPairs,
      pairs,
      types: Array.from(model.geom_type),
      jointPositions: Array.from(model.jnt_qposadr),
      dimensions: [model.nq, model.nv, model.npair, model.ngeom, model.nbody],
      disableFlags: model.opt.disableflags,
      enableFlags: model.opt.enableflags,
      masses: Array.from(model.body_mass),
      inertias: Array.from(model.body_inertia),
      masks: canPairs.flat().map((id) => [model.geom_contype[id], model.geom_conaffinity[id]]),
    };
    receipt.records.push({ readback });
    demand(
      canonicalEqual(readback.dimensions, [25, 22, 10, 11, 8]) &&
        canonicalEqual(readback.jointPositions, [0, 7, 8, 9, 10, 11, 18]) &&
        readback.disableFlags === fixture.engine.disableFlags &&
        readback.enableFlags === fixture.engine.enableFlags,
      'MODEL_LAYOUT_OR_PROFILE',
    );
    demand(
      canonicalEqual(
        canPairs.map(([support, body]) => [readback.types[support], readback.types[body]]),
        [
          [6, 5],
          [0, 5],
        ],
      ) &&
        readback.masks.every(([a, b]) => a === 0 && b === 0) &&
        canPairs.every((pair) =>
          pairs.some((registered) => pair.every((id) => registered.includes(id))),
        ),
      'EXPLICIT_ISOLATED_GEOMS',
    );
    demand(
      canonicalEqual(readback.masses.slice(-2), [fixture.can.massKg, fixture.can.massKg]) &&
        canonicalEqual(readback.inertias.slice(-6), [
          ...fixture.can.inertiaKgM2,
          ...fixture.can.inertiaKgM2,
        ]),
      'CAN_INERTIAL_READBACK',
    );
    const cap = model.npair * fixture.limits.contactsPerPair;
    const limits = {
      nbody: model.nbody,
      ngeom: model.ngeom,
      maxContacts: cap,
      maxConstraintRows: 3 * cap,
      maxIslands: model.ntree,
      pairCaps: pairs.map((geom) => ({ geom, maxContacts: fixture.limits.contactsPerPair })),
      warningCount: 7,
      maxWarningObservations: fixture.limits.positionCalls,
      maxWarningGets: 7 * fixture.limits.positionCalls,
      maxContactVectors: fixture.limits.positionCalls,
      maxContactGets: cap * fixture.limits.positionCalls,
    };
    const resources = { temporaryCreated: 0, temporaryDeleted: 0 };
    data = new M.MjData(model);
    let ok = true;
    for (const sample of input.samples) {
      const { can } = sample;
      const canQpos = (offset: number) => [
        can.center[0],
        can.center[1] + offset,
        can.center[2],
        ...can.rotation,
      ];
      const requested = [
        ...sample.ramp.pre.qpos,
        ...canQpos(fixture.support.boxY),
        ...canQpos(fixture.support.planeY),
      ];
      data.qpos.set(requested);
      data.time = sample.ramp.pre.time;
      const snapshot = () => ({
        qpos: Array.from(data!.qpos),
        qvel: Array.from(data!.qvel),
        time: data!.time,
      });
      const before = snapshot();
      demand(
        canonicalEqual(before.qpos, requested) &&
          Object.is(before.time, sample.ramp.pre.time) &&
          before.qvel.every((v) => v === 0) &&
          receipt.dispatches < fixture.limits.positionCalls,
        'PRE_RESTORE_OR_CALL_BOUND',
      );
      receipt.records.push({ phase: 'position-dispatch', sample, before });
      receipt.dispatches += 1;
      M.mj_fwdPosition(model, data);
      receipt.returns += 1;
      const after = snapshot();
      const geometry = captureGeometry(data, resources, limits);
      const settlements = canPairs.map((pair, i) =>
        supportGeometry(
          geometry.contacts.filter((c: RampContact) => c.geom.every((id) => pair.includes(id))),
          pair[0],
          i === 0 ? fixture.support.boxY : fixture.support.planeY,
          can,
        ),
      );
      const globalValid =
        canonicalEqual(before, after) &&
        resources.temporaryCreated === resources.temporaryDeleted &&
        geometry.warnings.every((warning: number[]) => warning.every((v) => v === 0)) &&
        geometry.nefc === 3 * geometry.ncon &&
        geometry.contacts.every(
          (c: { exclude: number; frame: number[]; efc_address: number; index: number }) =>
            c.exclude === 0 &&
            c.efc_address >= 0 &&
            geometry.efcId.slice(c.efc_address, c.efc_address + 3).length === 3 &&
            geometry.efcId
              .slice(c.efc_address, c.efc_address + 3)
              .every((id: number) => id === c.index) &&
            frameError(c.frame) <= fixture.support.frameTolerance,
        );
      const rollingUnchanged = sameRamp(geometry, sample.ramp.contacts, geomNames);
      const plane = settlements[1];
      const primitiveMatches =
        plane.count === can.expectedPlaneContacts && plane.issues.length === 0;
      const candidate = primitiveMatches && plane.marginM !== null && plane.marginM > 0;
      ok &&= globalValid && rollingUnchanged && candidate;
      receipt.records.push({
        sample,
        before,
        after,
        geometry,
        resources: { ...resources },
        settlements,
        globalValid,
        rollingUnchanged,
        primitiveMatches,
        candidate,
      });
    }
    return ok;
  } finally {
    try {
      data?.delete();
    } finally {
      model.delete();
      receipt.freed = true;
    }
  }
}

function openReceipt(path: string) {
  demand(isAbsolute(path) && resolve(path) === path, 'CANONICAL_OUTPUT_PATH');
  const directory = realpathSync(dirname(path));
  const under = (root: string) => {
    const difference = relative(root, directory);
    return difference !== '..' && !difference.startsWith(`..${sep}`) && !isAbsolute(difference);
  };
  demand(
    directory === dirname(path) &&
      under(realpathSync(tmpdir())) &&
      !under(realpathSync(fileURLToPath(new URL('../../../', import.meta.url)))),
    'EXTERNAL_TEMP_OUTPUT',
  );
  return openSync(path, 'wx');
}

it('pins the fixture and checks the support margin oracle', () => {
  expect(sha(readFileSync(fixtureUrl))).toBe(fixtureSha);
  expect(fixture.poses).toHaveLength(fixture.limits.positionCalls);
  expect(fixture.limits.positionCalls).toBeLessThanOrEqual(8);
  expect(fixture.limits.models).toBe(1);
  const square: Point[] = [
    [1, 1],
    [1, -1],
    [-1, -1],
    [-1, 1],
  ];
  expect(polygonMargin(square, [0, 0])).toBe(1);
  expect(polygonMargin(square, [2, 0])).toBe(-1);
  expect(polygonMargin(square.slice(0, 2), [0, 0])).toBeNull();
  expect(canInDeckFrame([0, 0, 0, fixture.can.halfHeightM, 1, 0, 0, 0]).clearance).toBe(0);
});

it.runIf(Boolean(archives))('binds the sealed archives and admits static interior poses', () => {
  const input = readInputs(archives!);
  const authored = sharedXml(input.xml);
  expect(authored).toContain('nativeccd="enable" multiccd="enable"');
  expect(authored).toContain('<geom name="ramp" type="mesh" mesh="ramp_mesh"/>');
  for (const { can } of input.samples) {
    expect(can.clearance).toBeLessThan(0);
    expect(can.farCapClearance).toBeGreaterThan(0);
    expect(can.otherRimClearance).toBeGreaterThan(0);
    expect(can.expectedPlaneContacts).toBe(1);
    expect(can.diskMargin).toBeGreaterThan(0);
    expect(Math.tan(can.theta)).toBeLessThan(fixture.support.mu);
    for (let i = 0; i < 2; i += 1)
      expect(Math.abs(can.center[i]) + fixture.can.radiusM + fixture.can.halfHeightM).toBeLessThan(
        fixture.support.deckHalfSizeM[i] - fixture.support.interiorMarginM,
      );
  }
});

it.runIf(Boolean(output))(
  'observes one shared native-CCD model at four immutable archived poses',
  async () => {
    const sourceSha256 = sha(readFileSync(new URL(import.meta.url)));
    demand(
      sourcePin?.toLowerCase() === sourceSha256 &&
        sha(readFileSync(fixtureUrl)) === fixtureSha &&
        archives,
      'OPT_IN_SOURCE_ADMISSION',
    );
    const input = readInputs(archives);
    const fd = openReceipt(output!);
    const receipt = {
      sourceSha256,
      fixtureSha256: fixtureSha,
      fixtures: fixture,
      dispatches: 0,
      returns: 0,
      freed: false,
      records: [] as unknown[],
      runtime: '',
      error: null as string | null,
      accepted: false,
    };
    try {
      const { packageRoot, ...verified } = verifyEngineArtifacts(readFixture().fixture);
      demand(verified.wasmSha256 === fixture.engine.wasmSha256, 'PINNED_WASM');
      const { default: init } = await import(pathToFileURL(resolve(packageRoot, 'mujoco.js')).href);
      const M: MainModule = await init({
        wasmBinary: readFileSync(resolve(packageRoot, 'mujoco.wasm')),
        locateFile: (name: string) => {
          demand(name === 'mujoco.wasm', 'ENGINE_RESOURCE');
          return resolve(packageRoot, name);
        },
      });
      receipt.runtime = M.mj_versionString();
      demand(receipt.runtime === fixture.engine.version, 'PINNED_RUNTIME');
      receipt.accepted = observe(M, input, receipt);
    } catch (error) {
      receipt.error = String(error);
    } finally {
      try {
        const bytes = Buffer.from(
          JSON.stringify(receipt, (_key, value) =>
            typeof value === 'number' && (!Number.isFinite(value) || Object.is(value, -0))
              ? Object.is(value, -0)
                ? '-0'
                : String(value)
              : value,
          ) + '\n',
        );
        demand(bytes.length <= fixture.limits.maxReceiptBytes, 'RECEIPT_LIMIT');
        writeFileSync(fd, bytes);
      } finally {
        closeSync(fd);
      }
    }
    expect(receipt.error).toBeNull();
    expect(receipt.dispatches).toBe(fixture.limits.positionCalls);
    expect(receipt.returns).toBe(receipt.dispatches);
    expect(receipt.freed).toBe(true);
    expect(receipt.accepted).toBe(true);
  },
  60_000,
);
