// @vitest-environment jsdom
import { createHash, webcrypto } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, expect, it, vi } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import {
  BASELINE,
  EDITED,
  SOURCE_FIXTURE,
  configuration,
  parameters,
  buildRampScene,
  rampRiseForAngle,
  RADIANS_PER_DEGREE,
  rawByteCost,
  decodeFrame,
  admitNextCensus,
  GenerationBudget,
  admissionText,
  verifyAdmission,
  compiledRampWitness,
  replayHistory,
  replayPair,
  groundScreenPoint,
  PreparationGate,
  guardedPreparation,
  disposePreparation,
  disposeGeneration,
  StartupFailures,
  verifyEndpointDigest,
  retainSupportWindow,
  onTop,
  endpointPacket,
  checkEndpointEnergy,
  checkEndpointReadback,
  FullEnergyWitness,
  ENERGY_MODEL,
  type EndpointEnergy,
  type AdmissionPermit,
  type HistoryRecord,
} from './scene';
vi.stubGlobal('crypto', webcrypto);
afterAll(() => vi.unstubAllGlobals());
const uiRenderer = vi.hoisted(() => ({ disposed: vi.fn(), terminated: vi.fn() }));
vi.mock('three', async (original) => ({
  ...(await original<typeof import('three')>()),
  WebGLRenderer: class {
    domElement = document.createElement('canvas');
    shadowMap = { enabled: false, type: 0 };
    setPixelRatio() {}
    setSize() {}
    render(_scene: unknown, camera: { updateMatrixWorld: (force: boolean) => void }) {
      camera.updateMatrixWorld(true);
    }
    dispose = uiRenderer.disposed;
    forceContextLoss() {}
  },
}));
const here = join(process.cwd(), 'apps/web/src/robotics/testing/editable-ramp-live');
const sha = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
it('preserves baseline XML exactly and freezes the edited XML and unchanged rover/program/material fields', () => {
  const baseline = buildRampScene(SOURCE_FIXTURE, BASELINE),
    edited = buildRampScene(SOURCE_FIXTURE, EDITED);
  expect(sha(baseline.xml)).toBe(configuration.history.xmlSha256);
  expect(edited.xml).toBe(configuration.editedXml.join('\n') + '\n');
  expect(sha(edited.xml)).toBe(configuration.editedXmlSha256);
  expect(edited.fixture.programs).toEqual(SOURCE_FIXTURE.programs);
  expect(edited.fixture.engine).toEqual(SOURCE_FIXTURE.engine);
  expect(edited.fixture.motor).toEqual(SOURCE_FIXTURE.motor);
  expect(edited.fixture.expected).toEqual(SOURCE_FIXTURE.expected);
  expect(edited.fixture.physical.limits).toEqual(SOURCE_FIXTURE.physical.limits);
  const changed = edited.fixture.xml
    .map((v, i) => (v === SOURCE_FIXTURE.xml[i] ? null : i))
    .filter((v) => v !== null);
  expect(changed).toEqual([6, 8, 10, 32]);
  expect(edited.expected.canOrigin).toEqual([1.37, 0, 0.14168338821254117]);
  expect(sha(baseline.xml)).toBe(configuration.baselineFixture.xmlSha256);
});
it('keeps fixedL angle/height inverse, finite closed face geometry, shared seams and initial support without moving the rover', () => {
  for (const p of [
    BASELINE,
    EDITED,
    { widthMeters: 0.4, heightMeters: 0, originXMeters: -0.05, originYMeters: 0.05 },
    { widthMeters: 1.2, heightMeters: 0.2, originXMeters: 0.1, originYMeters: -0.05 },
  ]) {
    const built = buildRampScene(SOURCE_FIXTURE, p),
      g = built.geometry;
    expect(rampRiseForAngle(0.8, g.angleRadians)).toBeCloseTo(p.heightMeters, 15);
    expect(g.faces).toHaveLength(12);
    expect(g.vertices).toHaveLength(8);
    expect(g.vertices[4]![2]).toBe(0);
    expect(g.vertices[5]![2]).toBe(p.heightMeters);
    expect(built.fixture.xml.find((v) => v.startsWith('<body name="rover"'))).toBe(
      SOURCE_FIXTURE.xml.find((v) => v.startsWith('<body name="rover"')),
    );
    expect(built.fixture.physical.terrain.upper[0]).toBeCloseTo(p.originXMeters + 0.8, 15);
  }
  expect(rampRiseForAngle(0.8, 6 * RADIANS_PER_DEGREE)).toBe(EDITED.heightMeters);
});
it('rejects malformed or unsupported parameters and never hides an independent angle or fake render-only edit', () => {
  for (const bad of [
    null,
    {},
    { ...BASELINE, widthMeters: NaN },
    { ...BASELINE, heightMeters: -0.01 },
    { ...BASELINE, widthMeters: 2 },
    { ...BASELINE, originXMeters: 0.11 },
    { ...BASELINE, originYMeters: 0.051 },
    { ...BASELINE, headingRadians: 1 },
    { ...BASELINE, lengthMeters: 2 },
  ])
    expect(() => parameters(bad)).toThrow();
  const bad = structuredClone(SOURCE_FIXTURE);
  bad.xml[8] = 'fake';
  expect(() => buildRampScene(bad, EDITED)).toThrow('RAMP_IMMUTABLE_SOURCE_XML');
});
it('proves native compiled F32 transforms and real finite faces, rejects original matcher/fake meshes/tampered transforms', () => {
  const built = buildRampScene(SOURCE_FIXTURE, EDITED);
  const local = built.geometry.vertices.map((v) => [
    Math.fround(v[0]),
    Math.fround(v[1]),
    Math.fround(v[2]),
  ]);
  const actual = {
    localF32: local.flat(),
    faces: built.geometry.faces.flat(),
    position: [0, 0, 0],
    matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  };
  expect(compiledRampWitness(actual, built.expected).vertices).toHaveLength(8);
  expect(() =>
    compiledRampWitness(actual, buildRampScene(SOURCE_FIXTURE, BASELINE).expected),
  ).toThrow('COMPILED_WORLD_HULL');
  expect(() => compiledRampWitness({ ...actual, position: [0.01, 0, 0] }, built.expected)).toThrow(
    'COMPILED_WORLD_HULL',
  );
  expect(() =>
    compiledRampWitness({ ...actual, matrix: [2, 0, 0, 0, 1, 0, 0, 0, 1] }, built.expected),
  ).toThrow('COMPILED_ORTHONORMAL');
  const faces = [...actual.faces];
  faces[0] = 99;
  expect(() => compiledRampWitness({ ...actual, faces }, built.expected)).toThrow(
    'COMPILED_FACE_INDEX',
  );
});
it('charges actual all-contact census before STEP2 and retains exact F64 framing including signed zero', () => {
  expect(rawByteCost(132, 132)).toBe(8 * (210 + 132 + 24 * 132));
  expect(8 * (210 * 44000 + 25 * 900000) + 9437184).toBe(263357184);
  expect(263357184).toBeLessThan(256 * 1024 ** 2);
  expect(() => admitNextCensus(449900, 0, 132, 0)).toThrow('PRE_STEP2_FULL_CENSUS_CAP');
  const frame = new Float64Array(210);
  frame[0] = 209;
  frame[2] = 500;
  frame[3] = -0;
  expect(Object.is(decodeFrame(frame).values[3], -0)).toBe(true);
  const mutated = frame.slice();
  mutated[0] = 208;
  expect(() => decodeFrame(mutated)).toThrow('RAW_WIDTH');
  mutated[0] = 209;
  mutated[208] = 133;
  expect(() => decodeFrame(mutated)).toThrow('RAW_CENSUS');
});
it('keeps a global-generation ledger contract bounded and rejects stale or reused attempts', () => {
  const b = new GenerationBudget();
  for (let n = 1; n <= 8; n++) b.reserve(n);
  expect(b.count()).toBe(8);
  expect(b.current(8)).toBe(true);
  expect(b.current(7)).toBe(false);
  expect(() => b.reserve(8)).toThrow();
  expect(() => b.reserve(9)).toThrow();
});
it('cancels the actual shared asynchronous assets/circuit pipeline before disposed ACK and prevents any late allocation or ready', async () => {
  const deferred = <T>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  };
  for (const stage of ['assets', 'circuit']) {
    const gate = new PreparationGate(),
      ticket = gate.invalidate(),
      assets = deferred<number>(),
      circuit = deferred<number>();
    const events: string[] = [];
    const pending = guardedPreparation(
      gate,
      ticket,
      assets.promise,
      async (value) => {
        events.push('derive');
        return (await circuit.promise) + value;
      },
      () => {
        events.push('allocate');
        events.push('ready');
      },
    );
    if (stage === 'circuit') {
      assets.resolve(1);
      await Promise.resolve();
      expect(events).toEqual(['derive']);
    }
    gate.stop();
    gate.cleanup(() => events.push('release'));
    events.push('disposed-ACK');
    assets.resolve(1);
    circuit.resolve(2);
    await pending;
    expect(events).toEqual(
      stage === 'assets' ? ['release', 'disposed-ACK'] : ['derive', 'release', 'disposed-ACK'],
    );
    expect(() => gate.healthy()).toThrow('WORKER_DISPOSED_TERMINALLY');
    expect(
      await guardedPreparation(
        gate,
        gate.capture(),
        Promise.resolve(1),
        async () => 2,
        () => events.push('late'),
      ),
    ).toBeUndefined();
  }
  const source = readFileSync(join(here, 'ramp.worker.ts'), 'utf8');
  const dispose = source.slice(source.indexOf("  if (kind === 'dispose') {"));
  expect(
    /await disposeGeneration\(\s*generation,\s*latestGeneration,\s*preparationGate/.test(dispose),
  ).toBe(true);
  expect(/return guardedPreparation\(\s*preparationGate/.test(source)).toBe(true);
});
it('uses the actual shared disposed path to wait out an entered module promise before one ACK and never acknowledges a cleanup failure', async () => {
  const gate = new PreparationGate(),
    events: string[] = [];
  let finish!: () => void;
  const entered = new Promise<void>((r) => {
    finish = r;
  });
  const disposed = disposePreparation(
    gate,
    entered,
    () => events.push('release'),
    () => events.push('ACK'),
  );
  expect(gate.current(gate.capture())).toBe(false);
  expect(events).toEqual([]);
  finish();
  await disposed;
  expect(events).toEqual(['release', 'ACK']);
  const broken = new PreparationGate(),
    ack = vi.fn();
  await expect(
    disposePreparation(
      broken,
      undefined,
      () => {
        throw new Error('delete-failed');
      },
      ack,
    ),
  ).rejects.toThrow('delete-failed');
  expect(ack).not.toHaveBeenCalled();
  expect(() => broken.healthy()).toThrow('delete-failed');
});
it('dispatches Dispose only for the accepted generation: stale/future commands cannot affect live or deferred gen2, while idle0 teardown cancels later authorization', async () => {
  const gate = new PreparationGate(),
    ticket = gate.capture(),
    close = vi.fn(),
    acknowledge = vi.fn();
  let releaseAssets!: (value: number) => void;
  const assets = new Promise<number>((resolve) => {
    releaseAssets = resolve;
  });
  const allocate = vi.fn();
  const preparing = guardedPreparation(gate, ticket, assets, async (value) => value, allocate);
  for (const generation of [0, 1, 3, 999]) {
    expect(await disposeGeneration(generation, 2, gate, assets, close, acknowledge)).toBe(false);
    expect(gate.capture()).toBe(ticket);
    expect(gate.current(ticket)).toBe(true);
  }
  expect(close).not.toHaveBeenCalled();
  expect(acknowledge).not.toHaveBeenCalled();
  releaseAssets(1);
  await preparing;
  expect(allocate).toHaveBeenCalledTimes(1);
  expect(await disposeGeneration(2, 2, gate, assets, close, acknowledge)).toBe(true);
  expect(close).toHaveBeenCalledTimes(1);
  expect(acknowledge).toHaveBeenCalledTimes(1);
  const pending = new PreparationGate(),
    pendingTicket = pending.capture(),
    lateAllocate = vi.fn();
  let authorize!: () => void;
  const signed = new Promise<void>((resolve) => {
    authorize = resolve;
  });
  const late = guardedPreparation(pending, pendingTicket, signed, async () => 1, lateAllocate);
  expect(
    await disposeGeneration(
      0,
      0,
      pending,
      undefined,
      () => undefined,
      () => undefined,
    ),
  ).toBe(true);
  authorize();
  await late;
  expect(lateAllocate).not.toHaveBeenCalled();
  const matched = new PreparationGate(),
    matchedTicket = matched.capture(),
    ready = vi.fn();
  let done!: (value: number) => void;
  const waiting = new Promise<number>((resolve) => {
    done = resolve;
  });
  const work = guardedPreparation(matched, matchedTicket, waiting, async (value) => value, ready);
  const stopped = disposeGeneration(
    2,
    2,
    matched,
    waiting,
    () => undefined,
    () => undefined,
  );
  done(1);
  await Promise.all([work, stopped]);
  expect(ready).not.toHaveBeenCalled();
});
it('publishes the first startup cause before failing destructors, keeps both auditable and prevents outer-catch replacement or later reuse', () => {
  const events: { kind: string; error: string }[] = [];
  const failures = new StartupFailures((_generation, _runCase, error) =>
    events.push({ kind: 'startup-error', error }),
  );
  const gate = new PreparationGate(),
    original = new Error('construction-first'),
    destructor = new Error('destructor-second');
  expect(failures.report(2, 'powered', original)).toBe(String(original));
  expect(() =>
    gate.cleanup(() => {
      events.push({ kind: 'cleanup', error: String(destructor) });
      throw destructor;
    }),
  ).toThrow(destructor);
  expect(failures.report(2, 'powered', destructor)).toBe(String(original));
  expect(events).toEqual([
    { kind: 'startup-error', error: String(original) },
    { kind: 'cleanup', error: String(destructor) },
  ]);
  expect(() => gate.healthy()).toThrow(destructor);
  const source = readFileSync(join(here, 'ramp.worker.ts'), 'utf8');
  const cleanup = source.slice(
    source.indexOf('      } catch (error) {', source.indexOf('candidate.ready(display)')),
  );
  expect(cleanup.indexOf('startupFailures.report')).toBeGreaterThanOrEqual(0);
  expect(cleanup.indexOf('startupFailures.report')).toBeLessThan(
    cleanup.indexOf('session?.dispose'),
  );
});
it('latches the first cleanup fault and refuses replacement without attempting new allocation', async () => {
  const gate = new PreparationGate(),
    first = new Error('owned-delete-failed');
  const allocated = vi.fn();
  expect(() =>
    gate.cleanup(() => {
      throw first;
    }),
  ).toThrow(first);
  expect(() => gate.healthy()).toThrow(first);
  expect(() => gate.cleanup(() => allocated())).toThrow(first);
  await guardedPreparation(gate, gate.invalidate(), Promise.resolve(1), async () => 2, allocated);
  expect(allocated).not.toHaveBeenCalled();
});
it('requires one actual consecutive100ms upper-support window, preserves first achievement and never sums interrupted support', () => {
  let state = { span: null, firstWindow: null, longestUs: 0 } as Parameters<
    typeof retainSupportWindow
  >[0];
  for (let i = 0; i < 199; i++)
    state = retainSupportWindow(state, i * 500, (i + 1) * 500, true, 100000);
  expect(state.firstWindow).toBeNull();
  expect(state.longestUs).toBe(99500);
  state = retainSupportWindow(state, 99500, 100000, false, 100000);
  for (let i = 0; i < 199; i++)
    state = retainSupportWindow(state, 100000 + i * 500, 100500 + i * 500, true, 100000);
  expect(state.firstWindow).toBeNull();
  state = retainSupportWindow(state, 199500, 200000, true, 100000);
  expect(state.firstWindow).toEqual({ from: 100000, to: 200000 });
  state = retainSupportWindow(state, 200000, 200500, false, 100000);
  expect(state.firstWindow).toEqual({ from: 100000, to: 200000 });
});
it('uses only the admitted compiled2e-7 XY domain budget for edited6 finite edges; real outside or distant-plane contacts remain invalid', () => {
  const built = buildRampScene(SOURCE_FIXTURE, EDITED),
    H = EDITED.heightMeters;
  const point = [0.82, Math.fround(0.4), H] as const;
  expect(onTop(1, point, built.fixture)).toBe(false);
  expect(onTop(1, point, built.fixture, 2e-7)).toBe(true);
  expect(onTop(1, [0.82, 0.4 + 3e-7, H], built.fixture, 2e-7)).toBe(false);
  expect(onTop(1, [0.8200003, 0, H], built.fixture, 2e-7)).toBe(false);
  expect(onTop(2, [0.82, 0, H + 0.001001], built.fixture, 2e-7)).toBe(false);
});
const energyFixture = (): EndpointEnergy => ({
  state: { time: 0, qpos: Array(17).fill(0), qvel: Array(15).fill(0) },
  poses: Array.from({ length: 6 }, () => ({ p: [0, 0, 0] as const, q: [1, 0, 0, 0] as const })),
  potentialJ: 0,
  kineticJ: 0,
  massTimesVelocity: Array(15).fill(0),
  bodies: Array.from({ length: 5 }, (_, i) => ({
    id: i + 1,
    com: [0, 0, 0] as const,
    omega: [0, 0, 0] as const,
    velocity: [0, 0, 0] as const,
    inertialToWorld: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    mass: 1,
    moments: [1, 2, 3] as const,
  })),
  gravity: [0, 0, -9.81],
  reflectedInertia: ENERGY_MODEL.reflectedInertia,
});
it('independently recomputes native endpoints from five principal-inertia bodies plus exactly one axle armature and validates lossless packets', () => {
  const endpoint = energyFixture();
  endpoint.state.qvel[0] = -0;
  endpoint.f64leHex = endpointPacket(endpoint);
  expect(checkEndpointEnergy(endpoint).kinetic).toBe(0);
  const lost = JSON.parse(JSON.stringify(endpoint));
  expect(() => checkEndpointEnergy(lost)).toThrow('ENDPOINT_F64_PACKET_BITS');
  const spinning = energyFixture();
  spinning.state.qvel[6] = 1;
  spinning.bodies[1]!.omega = [0, 1, 0];
  spinning.massTimesVelocity[6] = 2 + ENERGY_MODEL.reflectedInertia;
  spinning.kineticJ = 1 + 0.5 * ENERGY_MODEL.reflectedInertia;
  expect(checkEndpointEnergy(spinning).kinetic).toBe(spinning.kineticJ);
  spinning.kineticJ += 0.5 * ENERGY_MODEL.reflectedInertia;
  expect(() => checkEndpointEnergy(spinning)).toThrow('FULL_MASS_ENERGY_WITH_ARMATURE');
  const model = {
    masses: [0, 1, 1, 1, 1, 1],
    bodyInertia: [0, 0, 0, ...Array(5).fill([1, 2, 3]).flat()],
    inertialOffsets: Array(6).fill([0, 0, 0] as const),
    inertialQuaternions: Array(6).fill([1, 0, 0, 0] as const),
  };
  checkEndpointReadback(endpoint, model);
  expect(() => checkEndpointReadback(endpoint, { ...model, masses: [0, 2, 1, 1, 1, 1] })).toThrow(
    'ENDPOINT_MODEL_MASS_INERTIA',
  );
});
it('revalidates the actual shared durable endpoint packet digest and source-time-zero bits, rejecting digest/time tampering', async () => {
  const endpoint = energyFixture();
  endpoint.state.qvel[0] = -0;
  endpoint.f64leHex = endpointPacket(endpoint);
  const bytes = Buffer.from(endpoint.f64leHex, 'hex');
  const record = { bytes: bytes.length, sha256: sha(bytes), atNativeSeconds: 0 };
  expect(await verifyEndpointDigest(endpoint, record)).toBe(record.sha256);
  await expect(
    verifyEndpointDigest(endpoint, { ...record, sha256: '00'.repeat(32) }),
  ).rejects.toThrow('ENDPOINT_RAW_DIGEST');
  await expect(verifyEndpointDigest(endpoint, { ...record, atNativeSeconds: -0 })).rejects.toThrow(
    'ENDPOINT_RAW_DIGEST',
  );
});
it('replays the full signed endpoint residual without negative transmission offsetting dissipation or erasing the causal GAP', () => {
  const initial = energyFixture(),
    end = energyFixture();
  end.state.time = 0.0005;
  const body = end.bodies[0]!;
  body.com = [0, 0, 0.001 / 9.81];
  end.potentialJ = 0.001;
  const e = {
    windV: 0,
    current: 0,
    maxKcl: 0,
    kcl: 1e-9,
    powerIn: 0,
    powerCircuit: 0,
    viscousW: 0,
  };
  const frame = {
    from: 0,
    to: 500,
    pre: initial.state,
    post: end.state,
    circuit: e,
    effort: 0,
    contacts: [],
  } as unknown as Parameters<FullEnergyWitness['observe']>[0];
  const witness = new FullEnergyWitness(initial);
  witness.observe(frame);
  const failed = witness.finish(end);
  expect(failed.limitJ).toBe(0.0001);
  expect(failed.residualJ).toBe(0.001);
  expect(failed.pass).toBe(false);
  expect(failed.causal).toBe('GAP_CAUSAL_ALT');
  const negative = energyFixture();
  negative.state.time = 0.0005;
  negative.state.qpos[7] = 0.001;
  const winding = { ...e, windV: -1, current: -1 / (4 + 0.00035 / 0.0005) };
  const loss = new FullEnergyWitness(energyFixture());
  loss.observe({ ...frame, post: negative.state, circuit: winding } as typeof frame);
  const measured = loss.finish(negative);
  expect(measured.signedTransmission).toBeLessThan(0);
  expect(measured.transmission).toBe(0);
  expect(measured.negativeTransmissionIntervals).toBe(1);
  expect(measured.electricalEuler).toBeGreaterThan(0);
});

it('requires a real controller signature bound to Worker nonce, generation, runCase and exact parameters', async () => {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  const publicKey = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const payload = {
    nonce: '01'.repeat(32),
    generation: 1,
    runCase: 'powered' as const,
    parameters: parameters(BASELINE),
  };
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    pair.privateKey,
    new TextEncoder().encode(admissionText(payload)),
  );
  const permit: AdmissionPermit = {
    ...payload,
    signature: Buffer.from(signature).toString('base64'),
  };
  expect(await verifyAdmission(publicKey, payload.nonce, permit)).toBe(true);
  for (const bad of [
    { ...permit, generation: 2 },
    { ...permit, runCase: 'control' as const },
    { ...permit, parameters: parameters(EDITED) },
    { ...permit, signature: 'AQ==' },
  ])
    expect(await verifyAdmission(publicKey, payload.nonce, bad)).toBe(false);
  expect(await verifyAdmission(publicKey, '02'.repeat(32), permit)).toBe(false);
});
it('keeps native asset startup behind explicit signed admission and source/build options mutually exclusive', () => {
  const source = readFileSync(join(here, 'ramp.worker.ts'), 'utf8');
  const handler = source.slice(source.indexOf('scope.onmessage ='));
  expect(handler.indexOf('verifyAdmission')).toBeLessThan(handler.indexOf('assets ??= loadAssets'));
  expect(handler).not.toContain('mj_step');
  const stand = readFileSync(join(here, 'stand.ts'), 'utf8');
  expect(stand).toContain('__asaRampReserve');
  expect(stand.trim().endsWith('}')).toBe(true);
  expect(stand).not.toContain("send({ kind: 'reset', generation, runCase });");
});
it.runIf(process.env.ASA_EDITABLE_RAMP_HISTORY_DIR !== undefined)(
  'replays retained full R5 pair without engine import or legacy harness execution',
  async () => {
    const dir = process.env.ASA_EDITABLE_RAMP_HISTORY_DIR!;
    const binary = readFileSync(join(dir, 'qualification.bin')),
      metadata = readFileSync(join(dir, 'qualification.jsonl'));
    expect(binary.length).toBe(configuration.history.binary.bytes);
    expect(sha(binary)).toBe(configuration.history.binary.sha256);
    expect(metadata.length).toBe(configuration.history.metadata.bytes);
    expect(sha(metadata)).toBe(configuration.history.metadata.sha256);
    const records = metadata
      .toString('utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line)) as HistoryRecord[];
    const result = await replayHistory(records, binary);
    expect(result.intervals).toBe(40180);
    expect(result.worlds.map((w) => w.physical)).toEqual(['PASS', 'PASS']);
    console.log(
      'ASA_RAMP_HISTORY_REPLAY ' +
        JSON.stringify({
          ...result,
          source: configuration.history.source,
          binary: sha(binary),
          metadata: sha(metadata),
        }),
    );
  },
  60000,
);

it.runIf(process.env.ASA_RAMP_PAIR_META !== undefined)(
  'replays current paired receipt from actual raw through shared runtime physical/electrical observer',
  async () => {
    const metadata = readFileSync(process.env.ASA_RAMP_PAIR_META!),
      binary = readFileSync(process.env.ASA_RAMP_PAIR_BIN!);
    expect(sha(metadata)).toBe(process.env.ASA_RAMP_PAIR_META_SHA);
    expect(sha(binary)).toBe(process.env.ASA_RAMP_PAIR_BIN_SHA);
    const records = metadata
      .toString()
      .trim()
      .split('\n')
      .map((l) =>
        JSON.parse(l, (_k, v) => {
          if (v && typeof v === 'object' && '$asaF64' in v) {
            expect(Object.keys(v)).toEqual(['$asaF64']);
            expect(v.$asaF64).toBe('-0');
            return -0;
          }
          return v;
        }),
      ) as HistoryRecord[];
    const result = await replayPair(records, binary, {
      source: process.env.ASA_RAMP_PAIR_SOURCE!,
      parameters: parameters(JSON.parse(process.env.ASA_RAMP_PAIR_PARAMETERS!)),
      historical: false,
    });
    console.log(
      'ASA_RAMP_CURRENT_REPLAY ' +
        JSON.stringify({ ...result, binary: sha(binary), metadata: sha(metadata) }),
    );
  },
  60000,
);

it('executes the actual shared Node controller cap/nonce logic and verifies its real ECDSA permit in the Worker verifier', async () => {
  const output = execFileSync(process.execPath, [join(here, 'stand.browser.mjs'), '--self-test'], {
    encoding: 'utf8',
    maxBuffer: 1048576,
  });
  const match = /PURE_RUNNER_GUARDS_PASS (\{[^\n]+\})/.exec(output);
  expect(match).not.toBeNull();
  const result = JSON.parse(match![1]!) as {
    publicJwk: JsonWebKey;
    permit: AdmissionPermit;
    nativeInitializations: number;
    attempts: number;
  };
  expect(result.nativeInitializations).toBe(0);
  expect(result.attempts).toBe(8);
  expect(await verifyAdmission(result.publicJwk, result.permit.nonce, result.permit)).toBe(true);
  expect(await verifyAdmission(result.publicJwk, '02'.repeat(32), result.permit)).toBe(false);
});

it('refuses legacy and ambiguous controller opt-ins before any asset admission or native import', () => {
  for (const env of [
    { ASA_R5_NATIVE: 'old-consumed' },
    { ASA_EDITABLE_RAMP_NATIVE: 'one-four-world-programme-1071' },
  ]) {
    expect(() =>
      execFileSync(process.execPath, [join(here, 'stand.browser.mjs'), '--self-test'], {
        env: { ...process.env, ...env },
        encoding: 'utf8',
        stdio: 'pipe',
      }),
    ).toThrow(/OLD_NATIVE_ADMISSIONS_FORBIDDEN|CONTROLLER_TOKEN_ONLY_IN_QUALIFY/);
  }
});

it('maps source XY to the genuine renderer projection without a pose or fake canvas path', () => {
  const camera = new PerspectiveCamera(38, 800 / 600, 0.01, 200);
  camera.position.set(1, 4, 2);
  camera.lookAt(1, 0, 0);
  camera.updateMatrixWorld(true);
  const native = { x: 0.02, y: 0.01 };
  const expected = new Vector3(native.x, 0, -native.y).project(camera);
  const actual = groundScreenPoint(
    camera.projectionMatrix.toArray(),
    camera.matrixWorldInverse.toArray(),
    800,
    600,
    native.x,
    native.y,
  );
  expect(actual.x).toBeCloseTo((expected.x + 1) * 400, 12);
  expect(actual.y).toBeCloseTo((1 - expected.y) * 300, 12);
  expect(() => groundScreenPoint([], [], 0, 0, 0, 0)).toThrow('RENDER_PROJECTION');
});

it('executes actual passive stand/sidebar/parameter/drop lifecycle without a native factory, and keeps one snapped candidate', async () => {
  const html = readFileSync(join(here, 'index.html'), 'utf8');
  document.body.innerHTML = html;
  const queue = new Map<number, FrameRequestCallback>();
  let frame = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    queue.set(++frame, callback);
    return frame;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => queue.delete(id));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(900);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    right: 900,
    bottom: 600,
    width: 900,
    height: 600,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  const messages: unknown[] = [];
  vi.stubGlobal(
    'Worker',
    class {
      listeners: ((event: MessageEvent) => void)[] = [];
      constructor() {
        queueMicrotask(() => this.emit({ kind: 'hello', nonce: '01'.repeat(32) }));
      }
      emit(data: unknown) {
        for (const callback of this.listeners) callback(new MessageEvent('message', { data }));
      }
      addEventListener(type: string, callback: (event: MessageEvent) => void) {
        if (type === 'message') this.listeners.push(callback);
      }
      postMessage(command: { kind: string; generation: number }) {
        messages.push(command);
        if (command.kind === 'dispose')
          this.emit({
            kind: 'phase',
            phase: 'disposed',
            generation: command.generation,
            tickId: 0,
            atMicroseconds: 0,
          });
      }
      terminate = uiRenderer.terminated;
    },
  );
  const flush = () => {
    const callbacks = [...queue.values()];
    queue.clear();
    for (const callback of callbacks) callback(0);
  };
  try {
    await import('./stand');
    await Promise.resolve();
    flush();
    const app = document.getElementById('r5-app')!,
      viewport = document.getElementById('r5-viewport')!;
    expect(app.dataset.sceneAuthority).toBe('preview');
    expect((document.getElementById('r5-play') as HTMLButtonElement).disabled).toBe(true);
    expect((document.getElementById('r5-reset') as HTMLButtonElement).disabled).toBe(true);
    expect(messages).toEqual([]);
    const height = document.getElementById('ramp-height') as HTMLInputElement,
      angle = document.getElementById('ramp-angle') as HTMLInputElement;
    angle.value = '6';
    angle.dispatchEvent(new Event('change'));
    flush();
    expect(height.valueAsNumber).toBe(EDITED.heightMeters);
    const width = document.getElementById('ramp-width') as HTMLInputElement;
    width.value = '.8';
    width.dispatchEvent(new Event('change'));
    flush();
    document.getElementById('r5-view-top')!.click();
    flush();
    const projection = JSON.parse(viewport.dataset.rampProjection!);
    const point = groundScreenPoint(
      projection.projection,
      projection.inverseWorld,
      900,
      600,
      0.02,
      0,
    );
    const transfer = { setData: vi.fn(), setDragImage: vi.fn() };
    const drag = (target: HTMLElement, type: string) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.assign(event, {
        dataTransfer: transfer,
        clientX: point.x,
        clientY: point.y,
        relatedTarget: null,
      });
      target.dispatchEvent(event);
    };
    const card = document.getElementById('ramp-item')!;
    drag(card, 'dragstart');
    expect(viewport.dataset.placement).toBe('true');
    expect(transfer.setDragImage).toHaveBeenCalledTimes(1);
    const feedback = transfer.setDragImage.mock.calls[0]![0] as HTMLCanvasElement;
    expect([feedback.width, feedback.height]).toEqual([1, 1]);
    expect(feedback.isConnected).toBe(true);
    drag(viewport, 'dragover');
    flush();
    expect(viewport.dataset.invalid).toBeUndefined();
    drag(viewport, 'drop');
    flush();
    expect((document.getElementById('ramp-x') as HTMLInputElement).valueAsNumber).toBe(0.02);
    expect((document.getElementById('ramp-y') as HTMLInputElement).valueAsNumber).toBe(0);
    expect(feedback.isConnected).toBe(false);
    expect(viewport.dataset.placement).toBeUndefined();
    expect(JSON.parse(app.dataset.parameters!)).toEqual(parameters(EDITED));
    expect(messages).toEqual([]);
    window.dispatchEvent(new Event('pagehide'));
    expect(messages).toEqual([{ kind: 'dispose', generation: 0 }]);
    expect(uiRenderer.disposed).toHaveBeenCalledTimes(1);
    expect(uiRenderer.terminated).toHaveBeenCalledTimes(1);
  } finally {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  }
});
