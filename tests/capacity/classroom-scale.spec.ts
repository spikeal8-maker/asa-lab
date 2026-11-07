// @vitest-environment jsdom
import '../../apps/web/src/blocks/preview-env.d.ts';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import process from 'node:process';
import { runInNewContext } from 'node:vm';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { parse as parseYaml } from 'yaml';
import {
  isAllowedMutationOrigin,
  resolveCanonicalWebOrigin,
  resolveIsolatedTestWebOrigin,
} from '../../apps/api/src/origin-policy';
import { recordServerFailure } from '../../apps/api/src/server-diagnostics';
import {
  runSessionContextQuery,
  runSessionDatabaseScope,
} from '../../apps/api/src/session-database-diagnostics';
import { PortalHeader } from '../../apps/web/src/components/PortalHeader';
import { studentSessionPayload } from '../../apps/web/src/creator-portal/student-session';
import {
  OFFICIAL_SCALE_SCENARIO,
  OFFICIAL_SCALE_BASELINE,
  OFFICIAL_SCALE_AFTER,
  OFFICIAL_SCALE_POSTGRES,
  assertOfficialScaleDispatch,
  officialScaleAfterSelector,
  assertOfficialScaleReleaseProof,
  assertOfficialScaleImage,
  assertOfficialScaleRunner,
  assertOfficialScaleCompose,
  assertOfficialScaleOwnedContainer,
  assertOfficialScaleRuntime,
  runOfficialScaleN30,
  SCALE_LEVELS,
  SCALE_ORIGIN,
  SCALE_CRYPTO_CHALLENGE,
  SCALE_PROFILE,
  SCALE_PROFILE_HASH,
  SCALE_FAILURE_DIAGNOSTIC_LIMITS,
  SCALE_PROJECTS_LINK_SELECTOR,
  assertLatencySample,
  assertLatencyScenario,
  assertPriorScaleLevels,
  assertScaleDockerContext,
  assertScaleEnvironment,
  assertScaleImages,
  assertScaleFailureContainer,
  captureScaleFailureDiagnostics,
  projectScaleFailureLogs,
  scaleFailureDiagnosticError,
  assertScaleIngressConfig,
  assertScaleApiIngressEnvironment,
  summarizeScaleApiEnvironment,
  SCALE_API_ENV_PROBE_SCRIPT,
  assertScaleDriverNetwork,
  assertScaleSecureContext,
  validateScaleSecureContexts,
  SCALE_SERVICE_WORKER_MARKER,
  SCALE_SERVICE_WORKER_PROBE_PATH,
  installScaleServiceWorkerBlocker,
  assertScaleServiceWorkerProof,
  validateScaleServiceWorkers,
  classifyScaleNetworkFailure,
  summarizeScaleNetworkEvidence,
  createScaleLedger,
  createScaleObserverJournal,
  evaluateScaleLevel,
  evaluateScaleCalibration,
  readScaleMemInfo,
  readScaleChromiumResources,
  runScaleLadder,
  scaleHash,
  scaleLadderSummary,
  scaleNeedsReadback,
  scaleQuantiles,
  scaleResourceViolation,
  summarizeScaleRequests,
  summarizeLatencyTimings,
  scaleCohortPlan,
} from '../../tools/capacity/classroom-scale-contracts.mjs';

vi.mock('../../apps/web/src/components/PresentationPreferences', () => ({
  usePresentation: () => ({ draft: { sidebar: 'expanded' }, loaded: true, busy: false }),
}));
vi.mock('../../apps/web/src/creator-portal/QuickProjectCreation', () => ({
  QuickCreateMenu: () => null,
}));

describe('native full-editor fixture navigation', () => {
  it('clicks the real Seat personal-project link, distinct from the public gallery', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const navigate = vi.fn();
    try {
      await act(async () => {
        root.render(
          createElement(PortalHeader, {
            session: studentSessionPayload({
              authenticated: true,
              student: {
                seatId: 'scale-seat',
                displayName: 'Ученик',
                safeMode: true,
                avatarKey: null,
              },
              classroom: { id: 'scale-class', title: 'Класс', teacherDisplayName: 'Учитель' },
              expiresAt: '2099-01-01T00:00:00.000Z',
            }),
            canTeach: false,
            seatLearner: true,
            active: 'home',
            onNavigate: navigate,
            onSessionChanged: vi.fn(),
            onLoggedOut: vi.fn(),
          }),
        );
      });
      const projects = container.querySelectorAll<HTMLAnchorElement>(SCALE_PROJECTS_LINK_SELECTOR);
      expect(projects).toHaveLength(1);
      expect(projects[0]!.tagName).toBe('A');
      expect(projects[0]!.getAttribute('href')).toBe('/#/projects');
      expect(
        container.querySelector('.portal-global-nav a[aria-label="Проекты"]')?.getAttribute('href'),
      ).toBe('/#/explore');
      await act(async () => projects[0]!.click());
      expect(navigate).toHaveBeenCalledExactlyOnceWith('projects');
    } finally {
      await act(async () => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  });
});

describe('bounded observer failure evidence', () => {
  it('preserves the actual subprocess cause while excluding arbitrary secret-bearing data', () => {
    const journal = createScaleObserverJournal();
    const error = Object.assign(new Error('postgres://private:secret@postgres/private'), {
      code: 'ENOENT',
      syscall: 'spawn ps',
      path: 'ps',
      errno: -2,
      spawnargs: ['private-query'],
      sql: 'private-query',
    });
    journal.record('browser-process-sample', 'portal', error, 1000);
    expect(journal.state).toMatchObject({
      count: 1,
      dropped: 0,
      details: [
        { atMs: 1000, stage: 'browser-process-sample', code: 'ENOENT', syscall: 'spawn ps' },
      ],
    });
    expect(JSON.stringify(journal.state)).not.toMatch(/secret|private|postgres:\/\//);
  });

  it('keeps all failure counts after the diagnostic bound and records database timeouts separately', () => {
    const journal = createScaleObserverJournal();
    journal.record('postgres-sample', 'portal', new Error('Query read timeout'), 1000);
    for (let index = 1; index < 40; index++)
      journal.record(
        'browser-resource-sample',
        'portal',
        new TypeError('arbitrary detail'),
        1000 + index,
      );
    expect(journal.state.count).toBe(40);
    expect(journal.state.details).toHaveLength(32);
    expect(journal.state.dropped).toBe(8);
    expect(journal.state.details[0]).toMatchObject({
      stage: 'postgres-sample',
      messageCategory: 'query_read_timeout',
    });
  });
});

describe('native Linux process observation without a procps dependency', () => {
  async function snapshot(run: (directory: string) => Promise<void>) {
    const directory = await mkdtemp(join(tmpdir(), 'asa-scale-proc-'));
    try {
      await mkdir(join(directory, 'self'));
      const auxv = Buffer.alloc(32);
      auxv.writeBigUInt64LE(17n, 0);
      auxv.writeBigUInt64LE(100n, 8);
      await writeFile(join(directory, 'self/auxv'), auxv);
      await writeFile(join(directory, 'uptime'), '600.00 0.00\n');
      for (const row of [
        {
          pid: 10,
          parent: 1,
          name: 'node (worker)',
          cpu: 10,
          started: 40000,
          rss: 700,
          state: 'S',
        },
        {
          pid: 20,
          parent: 10,
          name: 'headless_shell',
          cpu: 300,
          started: 50000,
          rss: 1000,
          state: 'S',
        },
        {
          pid: 21,
          parent: 20,
          name: 'chrome-renderer',
          cpu: 1000,
          started: 55000,
          rss: 500,
          state: 'R',
        },
        { pid: 25, parent: 10, name: 'chromium', cpu: 0, started: 50000, rss: 0, state: 'Z' },
        { pid: 40, parent: 20, name: 'node', cpu: 9000, started: 50000, rss: 8000, state: 'S' },
        { pid: 99, parent: 1, name: 'chrome', cpu: 9000, started: 50000, rss: 9000, state: 'S' },
      ]) {
        const fields = Array<string>(50).fill('0');
        fields[0] = row.state;
        fields[1] = String(row.parent);
        fields[11] = String(row.cpu);
        fields[12] = '0';
        fields[19] = String(row.started);
        await mkdir(join(directory, String(row.pid)));
        await writeFile(
          join(directory, String(row.pid), 'stat'),
          `${row.pid} (${row.name}) ${fields.join(' ')}\n`,
        );
        await writeFile(
          join(directory, String(row.pid), 'status'),
          `Name:\t${row.name}\nState:\t${row.state}\nPid:\t${row.pid}\nPPid:\t${row.parent}\nVmRSS:\t${row.rss} kB\n`,
        );
      }
      // A vanished process is a normal enumeration race, not an invented sample.
      await mkdir(join(directory, '777'));
      await run(directory);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  it('measures only live owned Chromium descendants, preserving RSS and lifetime CPU semantics', async () => {
    await snapshot(async (directory) => {
      const sample = await readScaleChromiumResources(10, true, directory);
      expect(sample).toMatchObject({
        source: 'linux-procfs',
        scope: 'workload-process-descendants',
        processes: 2,
        rssSumBytes: 1500 * 1024,
        ticksPerSecond: 100,
      });
      expect(sample.lifetimeCpuPercentSum).toBeCloseTo(23);
    });
  });

  it('uses the measured kernel clock frequency instead of assuming100Hz', async () => {
    await snapshot(async (directory) => {
      const auxv = Buffer.alloc(32);
      auxv.writeBigUInt64LE(17n, 0);
      auxv.writeBigUInt64LE(1000n, 8);
      await writeFile(join(directory, 'self/auxv'), auxv);
      const sample = await readScaleChromiumResources(10, true, directory);
      expect(sample.ticksPerSecond).toBe(1000);
      expect(sample.lifetimeCpuPercentSum).toBeCloseTo(100 * (0.3 / 550 + 1 / 545));
    });
  });

  it.each([
    ['invalid-clock', 'invalid_proc_clock'],
    ['invalid-stat', 'invalid_proc_stat'],
    ['invalid-rss', 'invalid_proc_status'],
    ['missing-owner', 'missing_proc_owner'],
    ['missing-browser', 'missing_owned_chromium'],
  ])('rejects %s rather than reporting successful zero samples', async (kind, code) => {
    await snapshot(async (directory) => {
      if (kind === 'invalid-clock') await writeFile(join(directory, 'self/auxv'), Buffer.alloc(32));
      if (kind === 'invalid-stat') await writeFile(join(directory, '20/stat'), 'invalid stat');
      if (kind === 'invalid-rss')
        await writeFile(join(directory, '20/status'), 'Pid:\t20\nVmRSS:\tunknown kB\n');
      if (kind === 'missing-owner') await rm(join(directory, '10/stat'));
      if (kind === 'missing-browser') await rm(join(directory, '20/stat'));
      await expect(readScaleChromiumResources(10, true, directory)).rejects.toMatchObject({ code });
    });
  });
});

const sourceSha = 'a'.repeat(40);
const hash = 'b'.repeat(64);
const identity = {
  schemaVersion: 1,
  sourceSha,
  runId: '12345',
  attempt: 1,
  runToken: 'a'.repeat(32),
  profileHash: SCALE_PROFILE_HASH,
  environmentHash: 'c'.repeat(64),
  imageManifestHash: 'd'.repeat(64),
};

function environment() {
  return {
    GITHUB_ACTIONS: 'true',
    GITHUB_REPOSITORY: 'spikeal8-maker/asa-lab',
    RUNNER_ENVIRONMENT: 'github-hosted',
    GITHUB_RUN_ID: identity.runId,
    GITHUB_RUN_ATTEMPT: '1',
    ASA_SCALE_SHA: sourceSha,
    ASA_SCALE_RUN_TOKEN: identity.runToken,
    ASA_SCALE_PROFILE_HASH: SCALE_PROFILE_HASH,
    ASA_SCALE_USERS: '30',
    ASA_SCALE_MODE: 'capacity',
    ASA_E2E_EXTERNAL: 'true',
    ASA_E2E_BASE_URL: SCALE_ORIGIN,
    TEST_DATABASE_URL: 'postgresql://postgres:synthetic@postgres:5432/asalab_test',
    APP_TEST_DATABASE_URL: 'postgresql://asalab_app:synthetic@postgres:5432/asalab_test',
  };
}

function resource(atMs = 1000) {
  return {
    atMs,
    totalBytes: 16 * 1024 ** 3,
    availableBytes: 8 * 1024 ** 3,
    diskFreeBytes: 30 * 1024 ** 3,
    containers: [
      {
        service: 'test-runner',
        memoryBytes: 2 * 1024 ** 3,
        memoryLimitBytes: 8 * 1024 ** 3,
        oomKills: 0,
        restarts: 0,
      },
    ],
  };
}

function completeRaw(users = 30, calibration = false) {
  const operations = createScaleLedger(users, calibration).map(
    (operation: { id: string; name: string; client: number }, index: number) => ({
      ...operation,
      status: 'VERIFIED',
      attempts: 1,
      startedAtMs: 1000 + index * 10,
      endedAtMs: 1100 + index * 10,
      durationMs: 100,
      ...(scaleNeedsReadback(operation.name)
        ? {
            verification: {
              kind: 'independent-authenticated-api-readback',
              httpStatus: 200,
              identityMatched: true,
              expectedContentHash: hash,
              actualContentHash: hash,
              documentHash: hash,
              revisionBefore: 1,
              revisionAfter: 2,
              changeObserved: true,
            },
          }
        : {}),
    }),
  );
  return {
    ...identity,
    users,
    operations,
    mode: calibration ? 'calibration' : 'capacity',
    elapsedMs: 20000,
    workloadComplete: true,
    classCount: scaleCohortPlan(users, calibration).length,
    cohorts: scaleCohortPlan(users, calibration).map((cohort) => ({
      ...cohort,
      provisioned: cohort.planned,
      classroomHash: String(cohort.cohort + 1).repeat(64),
    })),
    observerErrors: 0,
    droppedObservations: 0,
    integrityFailures: [],
    javascriptErrors: [],
    networkFailures: [] as Array<Record<string, unknown>>,
    playwrightNetworkFailures: [] as Array<Record<string, unknown>>,
    navigationWindows: [] as Array<Record<string, unknown>>,
    offlineWindows: [] as Array<Record<string, unknown>>,
    accountControl: { status: 'VERIFIED' },
    observerRequests: [],
    games: { chessInvitations: 1, checkersInvitations: 1, chessMatches: 1, checkersMatches: 1 },
    browserSamples: [{ chromiumProcesses: users + 5, chromiumRssBytes: 1024 * 1024 }],
    secureContexts: [
      secureProof(-1, 'top', 'setup'),
      ...Array.from({ length: users }, (_, client) => [
        secureProof(client, 'top', 'seat-entry'),
        secureProof(client, 'scratch', 'scratch-open'),
      ]).flat(),
    ],
    serviceWorkers: serviceWorkerEvidence(users),
    provenance: {
      sourceSha,
      imageManifestHash: identity.imageManifestHash,
      assets: ['web', 'scratch'].map((service) => ({
        service,
        path: '/main.js',
        expectedHash: hash,
        actualHash: hash,
        bytes: 100,
        executed: true,
      })),
    },
    requests: [
      {
        client: 0,
        phase: 'portal',
        route: '/api/projects',
        method: 'GET',
        status: 200,
        startedAtMs: 1000,
        durationMs: 20,
        injected: false,
        completed: true,
      },
    ],
  };
}

function secureProof(client: number, context: 'top' | 'scratch', stage: string) {
  return {
    client,
    context,
    stage,
    atMs: 1000,
    origin: SCALE_ORIGIN,
    isSecureContext: true,
    topLevel: context === 'top',
    hasSubtle: true,
    sha256: scaleHash(SCALE_CRYPTO_CHALLENGE),
    error: null,
  };
}

function serviceWorkerEvidence(users: number) {
  return Array.from({ length: users + 2 }, (_, index) => {
    const client = index - 2;
    const contextId = '00000000-0000-4000-8000-' + String(index).padStart(12, '0');
    const stages =
      client === -1
        ? [['top', 'setup']]
        : client === -2
          ? [
              ['top', 'account-entry'],
              ['top', 'account-reload'],
            ]
          : [
              ['top', 'seat-entry'],
              ['scratch', 'scratch-open'],
            ];
    return {
      client,
      contextId,
      preparedAtMs: 1000,
      finalizedAtMs: 2000,
      installedBeforePages: true,
      initialWorkers: 0,
      finalWorkers: 0,
      workerEvents: 0,
      observedWorkerRequests: 0,
      probeRequests: 0,
      proofs: stages.map(([context, stage]) => ({
        client,
        contextId,
        context,
        stage,
        atMs: 1500,
        origin: SCALE_ORIGIN,
        topLevel: context === 'top',
        version: 1,
        state: 'blocked',
        instanceBlocked: true,
        prototypeBlocked: true,
        interceptedCalls: 2,
        blockedRegistrations: 2,
        fulfilledUndefined: true,
        registrationCount: 0,
        hasController: false,
      })),
    };
  });
}

const opaqueServiceWorkerMessage =
  "Failed to read the 'serviceWorker' property from 'Navigator': Service worker is disabled because the context is sandboxed and lacks the 'allow-same-origin' flag.";

function serviceWorkerRealm(
  options: {
    failure?: unknown;
    opaque?: boolean;
    top?: boolean;
    unavailable?: boolean;
    locked?: boolean;
  } = {},
) {
  const nativeRegister = vi.fn(async () => 'native-registration');
  class NativeServiceWorkerContainer {
    register = nativeRegister;
  }
  // Native methods are on the prototype; use the actual serialized initializer
  // in a fresh VM realm, with only the browser API boundary supplied by this test.
  Object.defineProperty(NativeServiceWorkerContainer.prototype, 'register', {
    value: nativeRegister,
    writable: !options.locked,
    configurable: !options.locked,
  });
  const container = Object.create(NativeServiceWorkerContainer.prototype) as {
    register: (url: string) => Promise<unknown>;
  };
  const navigator = Object.defineProperty({}, 'serviceWorker', {
    get: () => {
      if (options.failure) throw options.failure;
      return options.unavailable ? undefined : container;
    },
  });
  const realm: Record<string, unknown> = {
    DOMException,
    navigator,
    ServiceWorkerContainer: NativeServiceWorkerContainer,
    origin: options.opaque ? 'null' : SCALE_ORIGIN,
  };
  const contextId = '00000000-0000-4000-8000-000000000001';
  runInNewContext(
    'globalThis.top = ' +
      (options.top === false ? '{};' : 'globalThis;') +
      '(' +
      installScaleServiceWorkerBlocker.toString() +
      ')(' +
      JSON.stringify(contextId) +
      ');',
    realm,
  );
  return {
    realm,
    container,
    nativeRegister,
    prototype: NativeServiceWorkerContainer.prototype,
    snapshot: () => (realm[SCALE_SERVICE_WORKER_MARKER] as () => Record<string, unknown>)(),
  };
}

describe('fixture-only service worker boundary', () => {
  it('blocks actual instance and prototype calls before returning, without calling native register', async () => {
    const fixture = serviceWorkerRealm();
    expect(fixture.snapshot()).toMatchObject({
      version: 1,
      contextId: '00000000-0000-4000-8000-000000000001',
      state: 'blocked',
      blockedRegistrations: 0,
      instanceBlocked: true,
      prototypeBlocked: true,
    });
    const first = fixture.container.register(SCALE_ORIGIN + SCALE_SERVICE_WORKER_PROBE_PATH);
    const second = fixture.prototype.register.call(fixture.container);
    expect(fixture.snapshot()['blockedRegistrations']).toBe(2);
    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBeUndefined();
    await fixture.container.register('/another-script.js');
    expect(fixture.snapshot()['blockedRegistrations']).toBe(3);
    expect(fixture.nativeRegister).not.toHaveBeenCalled();
    for (const target of [fixture.container, fixture.prototype])
      expect(Object.getOwnPropertyDescriptor(target, 'register')).toMatchObject({
        writable: false,
        configurable: false,
      });
    expect(
      Object.getOwnPropertyDescriptor(fixture.realm, SCALE_SERVICE_WORKER_MARKER),
    ).toMatchObject({
      writable: false,
      configurable: false,
    });
  });

  it('handles only the native opaque nested-document denial, retaining its native prohibition', () => {
    const fixture = serviceWorkerRealm({
      failure: new DOMException(opaqueServiceWorkerMessage, 'SecurityError'),
      opaque: true,
      top: false,
    });
    expect(fixture.snapshot()).toMatchObject({ state: 'opaque-denied', blockedRegistrations: 0 });
    expect(fixture.nativeRegister).not.toHaveBeenCalled();
    expect(() => (fixture.realm['navigator'] as Navigator).serviceWorker).toThrow();
  });

  it.each([
    {
      failure: Object.assign(new Error(opaqueServiceWorkerMessage), { name: 'SecurityError' }),
      opaque: true,
      top: false,
    },
    {
      failure: new DOMException('unrelated security failure', 'SecurityError'),
      opaque: true,
      top: false,
    },
    {
      failure: new DOMException(opaqueServiceWorkerMessage, 'InvalidStateError'),
      opaque: true,
      top: false,
    },
    {
      failure: new DOMException(opaqueServiceWorkerMessage, 'SecurityError'),
      opaque: false,
      top: false,
    },
    {
      failure: new DOMException(opaqueServiceWorkerMessage, 'SecurityError'),
      opaque: true,
      top: true,
    },
    { failure: new TypeError('unexpected navigator getter failure'), opaque: true, top: false },
  ])('rethrows unexpected getter errors, including lookalikes: %j', (options) => {
    expect(() => serviceWorkerRealm(options)).toThrow(options.failure);
  });

  it('does not swallow descriptor errors or attest an unavailable early document', () => {
    expect(() => serviceWorkerRealm({ locked: true })).toThrow();
    const fixture = serviceWorkerRealm({ unavailable: true });
    expect(fixture.snapshot()['state']).toBe('unavailable');
    expect(() => assertScaleServiceWorkerProof(fixture.snapshot())).toThrow();
  });

  it('requires native proof for setup, account and every distinct pupil context', () => {
    expect(() => validateScaleServiceWorkers(serviceWorkerEvidence(2), 2)).not.toThrow();
    for (const client of [-2, -1, 0, 1]) {
      const incomplete = serviceWorkerEvidence(2).filter((context) => context.client !== client);
      expect(() => validateScaleServiceWorkers(incomplete, 2)).toThrow();
    }
    const reused = serviceWorkerEvidence(2);
    reused[1]!.contextId = reused[0]!.contextId;
    expect(() => validateScaleServiceWorkers(reused, 2)).toThrow();
  });

  it.each([
    { installedBeforePages: false },
    { initialWorkers: 1 },
    { finalWorkers: 1 },
    { finalWorkers: undefined },
    { finalWorkers: '0' },
    { workerEvents: 1 },
    { observedWorkerRequests: 1 },
    { probeRequests: 1 },
    { finalizedAtMs: undefined },
    { finalizedAtMs: 999 },
    { proofs: [] },
    { contextId: 'missing-context-identity' },
  ])('rejects incomplete or escaped lifetime evidence: %j', (change) => {
    const evidence = serviceWorkerEvidence(2);
    Object.assign(evidence[2]!, change);
    expect(() => validateScaleServiceWorkers(evidence, 2)).toThrow();
  });

  it.each([
    { state: 'unavailable' },
    { state: 'opaque-denied' },
    { version: undefined },
    { instanceBlocked: false },
    { prototypeBlocked: false },
    { interceptedCalls: 1 },
    { fulfilledUndefined: false },
    { registrationCount: 1 },
    { hasController: true },
    { contextId: '00000000-0000-4000-8000-000000000099' },
    { client: 1 },
    { atMs: 999 },
    { atMs: 2001 },
    { stage: 'wrong-document-stage' },
  ])('requires fresh successful register interception in each actual document: %j', (change) => {
    const evidence = serviceWorkerEvidence(2);
    Object.assign(evidence[2]!.proofs[0]!, change);
    expect(() => validateScaleServiceWorkers(evidence, 2)).toThrow();
  });

  it('keeps both level and calibration invalid after any worker event or unexpected JavaScript error', () => {
    for (const calibration of [false, true]) {
      const users = calibration ? 2 : 30;
      const evaluate = calibration ? evaluateScaleCalibration : evaluateScaleLevel;
      const expected = calibration ? 'INVALID_FIXTURE' : 'INVALID';
      const raw = completeRaw(users, calibration);
      raw.serviceWorkers[2]!.workerEvents++;
      expect(evaluate(raw, identity, [resource()]).status).toBe(expected);
      expect(
        evaluate({ ...completeRaw(users, calibration), serviceWorkers: undefined }, identity, [
          resource(),
        ]).status,
      ).toBe(expected);
      expect(
        evaluate(
          { ...completeRaw(users, calibration), javascriptErrors: [{ name: 'SecurityError' }] },
          identity,
          [resource()],
        ).status,
      ).toBe(calibration ? 'INVALID_FIXTURE' : 'FAIL');
    }
  });
});

function ingressConfig() {
  return {
    services: {
      api: {
        environment: {
          NODE_ENV: 'test',
          ASA_WEB_PORT: '8080',
          ASA_WEB_ORIGIN: SCALE_ORIGIN,
          ASA_BLOCKS_RUNTIME_ORIGIN: SCALE_ORIGIN,
        },
      },
      web: {
        build: { args: { ASA_BLOCKS_RUNTIME_ORIGIN: SCALE_ORIGIN } },
        environment: { ASA_BLOCKS_RUNTIME_ORIGIN: SCALE_ORIGIN },
        networks: { application: {}, 'scratch-runtime': {}, database: {} },
      },
      scratch: {
        build: { args: { ASA_BLOCKS_PARENT_ORIGIN: SCALE_ORIGIN } },
        environment: { ASA_BLOCKS_PARENT_ORIGIN: SCALE_ORIGIN },
      },
      'test-runner': {
        environment: { ASA_E2E_BASE_URL: SCALE_ORIGIN },
        network_mode: 'service:web',
      },
    },
  };
}

function changedIngressConfig(path: string, value: unknown) {
  const config = ingressConfig();
  const parts = path.split('.');
  const key = parts.pop()!;
  const parent = parts.reduce(
    (entry, part) => entry[part] as Record<string, unknown>,
    config as Record<string, unknown>,
  );
  parent[key] = value;
  return config;
}

function apiIngressMetadata() {
  return {
    Id: 'a'.repeat(64),
    State: { Running: true, StartedAt: '2026-11-05T18:00:00.000Z' },
    RestartCount: 0,
    HostConfig: { Init: true },
    Config: {
      Labels: {
        'com.docker.compose.service': 'api',
        'com.docker.compose.project': 'asa-scale-synthetic',
        'io.asalab.scale.run': 'a'.repeat(32),
        'com.docker.compose.project.working_dir': '/workspace/synthetic',
      },
      Env: [
        'NODE_ENV=test',
        'ASA_WEB_PORT=8080',
        'ASA_WEB_ORIGIN=' + SCALE_ORIGIN,
        'ASA_BLOCKS_RUNTIME_ORIGIN=' + SCALE_ORIGIN,
        'APP_DATABASE_URL=postgres://private:secret@postgres/asalab_test',
      ],
    },
  };
}

function apiIngressProof(metadata: object = apiIngressMetadata()) {
  const startupEnvironment = summarizeScaleApiEnvironment(apiIngressMetadata().Config.Env);
  return {
    nonce: 'b'.repeat(32),
    requestedAtMs: 1000,
    completedAtMs: 1002,
    after: structuredClone(metadata),
    transport: 'completed',
    result: {
      schemaVersion: 1,
      status: 'ok',
      containerId: 'a'.repeat(64),
      nonce: 'b'.repeat(32),
      observedAtMs: 1001,
      pid1: { pid: 1, executable: 'docker-init', startTimeTicks: '1234', startupEnvironment },
      api: {
        pid: 7,
        startTimeTicks: '1235',
        directChild: true,
        identityStable: true,
        startupEnvironment,
      },
      exec: { pid: 9, targetOwn: false, targetType: 'undefined', environment: startupEnvironment },
    },
  };
}

describe('durable, nonsecret ingress preflight evidence', () => {
  it.each([
    ['services.api.environment.NODE_ENV', 'production'],
    ['services.api.environment.ASA_WEB_PORT', '4612'],
    ['services.api.environment.ASA_WEB_ORIGIN', 'http://web:8080'],
    ['services.api.environment.ASA_ISOLATED_TEST_WEB_ORIGIN', 'http://web:8080'],
    ['services.api.environment.ASA_BLOCKS_RUNTIME_ORIGIN', 'http://web:8080'],
    ['services.web.build.args.ASA_BLOCKS_RUNTIME_ORIGIN', 'http://web:8080'],
    ['services.web.environment.ASA_BLOCKS_RUNTIME_ORIGIN', 'http://web:8080'],
    ['services.scratch.build.args.ASA_BLOCKS_PARENT_ORIGIN', 'http://web:8080'],
    ['services.scratch.environment.ASA_BLOCKS_PARENT_ORIGIN', 'http://web:8080'],
    ['services.test-runner.environment.ASA_E2E_BASE_URL', 'http://web:8080'],
    ['services.test-runner.network_mode', 'host'],
    ['services.test-runner.networks', { database: {} }],
    ['services.web.networks', { application: {} }],
  ] as const)('names the failed field %s without changing its rejection', (path, value) => {
    const record = vi.fn();
    expect(() => assertScaleIngressConfig(changedIngressConfig(path, value), record)).toThrow(path);
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0]![0]).toMatchObject({ valid: false, mismatches: [path] });
    expect(record.mock.calls[0]![0].fields).toHaveLength(13);
  });

  it('persists the exact inherited-origin mismatch before throwing, even before plan creation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'scale-ingress-evidence-'));
    const report = join(directory, 'preflight-ingress.json');
    const field = 'services.api.environment.ASA_ISOLATED_TEST_WEB_ORIGIN';
    try {
      expect(() =>
        assertScaleIngressConfig(changedIngressConfig(field, 'http://web:8080'), (evidence) =>
          writeFileSync(
            report,
            JSON.stringify({ stage: 'resolved-compose-ingress', ingress: evidence }),
          ),
        ),
      ).toThrow(field);
      const saved = JSON.parse(await readFile(report, 'utf8'));
      expect(saved.ingress).toMatchObject({ valid: false, mismatches: [field] });
      expect(saved.ingress.fields).toContainEqual({
        path: field,
        expected: 'absent-or-null',
        present: true,
        type: 'string',
        matches: false,
        value: 'http://web:8080',
      });
      expect(() =>
        assertScaleIngressConfig(changedIngressConfig(field, 'http://web:8080'), (evidence) =>
          Object.assign(evidence, { valid: true, mismatches: [] }),
        ),
      ).toThrow(field);
      expect(() =>
        assertScaleIngressConfig(ingressConfig(), () => {
          throw Error('sink unavailable');
        }),
      ).toThrow('sink unavailable');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('redacts arbitrary field values and network names while preserving type and mismatch', () => {
    const record = vi.fn();
    const config = changedIngressConfig(
      'services.api.environment.ASA_WEB_ORIGIN',
      'http://private:secret@host/',
    );
    Object.assign(config.services.web.networks, { 'private-network-secret': {} });
    Object.assign(config.services.api.environment, {
      APP_DATABASE_URL: 'postgres://private:secret@host/',
    });
    expect(() => assertScaleIngressConfig(config, record)).toThrow(
      'services.api.environment.ASA_WEB_ORIGIN',
    );
    const evidence = record.mock.calls[0]![0];
    expect(JSON.stringify(evidence)).not.toMatch(/private|secret|postgres:/);
    expect(evidence.fields).toContainEqual({
      path: 'services.api.environment.ASA_WEB_ORIGIN',
      expected: SCALE_ORIGIN,
      present: true,
      type: 'string',
      matches: false,
      redacted: true,
    });
    expect(evidence.fields).toContainEqual(
      expect.objectContaining({
        path: 'services.web.networks',
        knownNames: ['application', 'scratch-runtime', 'database'],
        entryCount: 4,
        otherNameCount: 1,
      }),
    );
  });

  it('accepts only absent or exact null in the model, never a present undefined or any string', () => {
    const field = 'services.api.environment.ASA_ISOLATED_TEST_WEB_ORIGIN';
    expect(assertScaleIngressConfig(ingressConfig()).valid).toBe(true);
    expect(assertScaleIngressConfig(changedIngressConfig(field, null)).valid).toBe(true);
    for (const value of [undefined, '', ' ', '\t', 'http://web:8080', SCALE_ORIGIN])
      expect(() => assertScaleIngressConfig(changedIngressConfig(field, value))).toThrow(field);
    // The unchanged product resolver disables the exception only for actual
    // runtime absence. Compose null is deliberately not passed to this API.
    expect(
      resolveIsolatedTestWebOrigin(undefined, 'test', environment().TEST_DATABASE_URL),
    ).toBeNull();
    for (const value of ['', ' ', '\t'])
      expect(() =>
        resolveIsolatedTestWebOrigin(value, 'test', environment().TEST_DATABASE_URL),
      ).toThrow();
  });
});

describe('actual owned API ingress environment before calibration', () => {
  it('requires native absence even for absent metadata, and never records other environment values', () => {
    const evidence = assertScaleApiIngressEnvironment(apiIngressMetadata(), apiIngressProof());
    expect(evidence).toMatchObject({
      valid: true,
      isolatedKeyCount: 0,
      containerId: 'a'.repeat(64),
    });
    expect(JSON.stringify(evidence)).not.toMatch(/APP_DATABASE_URL|private|secret|postgres:/);
    for (const entry of [
      'ASA_ISOLATED_TEST_WEB_ORIGIN=',
      'ASA_ISOLATED_TEST_WEB_ORIGIN=null',
      'ASA_ISOLATED_TEST_WEB_ORIGIN= ',
      'ASA_ISOLATED_TEST_WEB_ORIGIN=http://web:8080',
    ]) {
      const metadata = apiIngressMetadata();
      metadata.Config.Env.push(entry);
      const record = vi.fn();
      expect(() =>
        assertScaleApiIngressEnvironment(metadata, apiIngressProof(metadata), record),
      ).toThrow('Config.Env.ASA_ISOLATED_TEST_WEB_ORIGIN');
      expect(record.mock.calls[0]![0]).toMatchObject({ valid: false, isolatedKeyCount: 1 });
      expect(() =>
        assertScaleApiIngressEnvironment(metadata, apiIngressProof(metadata), (evidence) =>
          Object.assign(evidence, { valid: true, mismatches: [] }),
        ),
      ).toThrow('Config.Env.ASA_ISOLATED_TEST_WEB_ORIGIN');
    }
  });

  it('fails closed on absent, duplicate or wrong canonical values and missing API identity/environment', () => {
    for (const key of ['NODE_ENV', 'ASA_WEB_PORT', 'ASA_WEB_ORIGIN', 'ASA_BLOCKS_RUNTIME_ORIGIN']) {
      for (const replacement of [[], [key + '=wrong'], [key + '=wrong', key + '=wrong']]) {
        const metadata = apiIngressMetadata();
        metadata.Config.Env = metadata.Config.Env.filter(
          (entry) => !entry.startsWith(key + '='),
        ).concat(replacement);
        expect(() => assertScaleApiIngressEnvironment(metadata, apiIngressProof(metadata))).toThrow(
          'Config.Env.' + key,
        );
      }
    }
    for (const metadata of [
      {},
      { ...apiIngressMetadata(), Id: 'not-an-id' },
      { ...apiIngressMetadata(), Config: { ...apiIngressMetadata().Config, Env: null } },
      { ...apiIngressMetadata(), Config: { ...apiIngressMetadata().Config, Env: [null] } },
      {
        ...apiIngressMetadata(),
        Config: { ...apiIngressMetadata().Config, Labels: { 'com.docker.compose.service': 'web' } },
      },
    ])
      expect(() => assertScaleApiIngressEnvironment(metadata, apiIngressProof(metadata))).toThrow();
  });
});

describe('metadata unset markers require fresh native proof', () => {
  it('permits one bare marker only with independent process absence, rejecting assignments and duplicates', () => {
    const metadata = apiIngressMetadata();
    metadata.Config.Env.push('ASA_ISOLATED_TEST_WEB_ORIGIN');
    expect(assertScaleApiIngressEnvironment(metadata, apiIngressProof(metadata))).toMatchObject({
      valid: true,
      targetForms: {
        count: 1,
        bare: 1,
        assignedEmpty: 0,
        assignedNonempty: 0,
        absent: false,
        duplicate: false,
      },
    });
    for (const source of [metadata, apiIngressMetadata()])
      expect(() => assertScaleApiIngressEnvironment(source)).toThrow('probe.');
    for (const entries of [
      ['ASA_ISOLATED_TEST_WEB_ORIGIN', 'ASA_ISOLATED_TEST_WEB_ORIGIN'],
      ['ASA_ISOLATED_TEST_WEB_ORIGIN', 'ASA_ISOLATED_TEST_WEB_ORIGIN='],
      ['ASA_ISOLATED_TEST_WEB_ORIGIN=', 'ASA_ISOLATED_TEST_WEB_ORIGIN=private-secret'],
    ]) {
      const invalid = apiIngressMetadata();
      invalid.Config.Env.push(...entries);
      const record = vi.fn();
      expect(() =>
        assertScaleApiIngressEnvironment(invalid, apiIngressProof(invalid), record),
      ).toThrow('Config.Env.ASA_ISOLATED_TEST_WEB_ORIGIN');
      expect(record.mock.calls[0]![0].targetForms).toMatchObject({ count: 2, duplicate: true });
      expect(JSON.stringify(record.mock.calls)).not.toContain('private-secret');
    }
  });

  it.each([
    ['nonce', 'c'.repeat(32)],
    ['result.nonce', 'c'.repeat(32)],
    ['result.containerId', 'c'.repeat(64)],
    ['result.observedAtMs', 999],
    ['result.observedAtMs', 1003],
    ['requestedAtMs', -1],
    ['completedAtMs', 7000],
    ['transport', 'exec_failed'],
    ['result', null],
    ['result.status', 'error'],
    ['result.schemaVersion', 0],
    ['result.pid1.pid', 2],
    ['result.pid1.executable', 'node'],
    ['result.api.directChild', false],
    ['result.api.identityStable', false],
    ['result.api.startTimeTicks', ''],
    ['result.pid1.startTimeTicks', 1234],
    ['result.api.startTimeTicks', ['1235']],
    ['result.pid1.startTimeTicks', '1'.repeat(21)],
    ['result.exec.pid', 7],
    ['result.exec.targetOwn', true],
    ['result.exec.targetType', 'string'],
    ['after.Id', 'c'.repeat(64)],
    ['after.State.Running', false],
    ['after.State.StartedAt', '2026-11-05T18:01:00.000Z'],
    ['after.RestartCount', 1],
    ['after.HostConfig.Init', false],
  ])('rejects incomplete, stale or mismatched native evidence: %s=%s', (path, value) => {
    const proof = apiIngressProof();
    const parts = (path as string).split('.');
    const key = parts.pop()!;
    const parent = parts.reduce(
      (entry, part) => entry[part] as Record<string, unknown>,
      proof as Record<string, unknown>,
    );
    parent[key] = value;
    expect(() => assertScaleApiIngressEnvironment(apiIngressMetadata(), proof)).toThrow('probe.');
  });

  it('requires PID1 startup, actual API startup and exec-current absence independently', () => {
    for (const location of ['pid1', 'api', 'exec'] as const) {
      const proof = apiIngressProof();
      const contaminated = summarizeScaleApiEnvironment([
        ...apiIngressMetadata().Config.Env,
        'ASA_ISOLATED_TEST_WEB_ORIGIN=private-secret',
      ]);
      if (location === 'exec') proof.result.exec.environment = contaminated;
      else proof.result[location].startupEnvironment = contaminated;
      const record = vi.fn();
      expect(() => assertScaleApiIngressEnvironment(apiIngressMetadata(), proof, record)).toThrow(
        'probe.',
      );
      expect(JSON.stringify(record.mock.calls)).not.toContain('private-secret');
    }
    const proof = apiIngressProof();
    const after = apiIngressMetadata();
    after.Config.Labels['io.asalab.scale.run'] = 'c'.repeat(32);
    proof.after = after;
    expect(() => assertScaleApiIngressEnvironment(apiIngressMetadata(), proof)).toThrow(
      'probe.container',
    );
  });
});

// Execute the exact builtin program against a controlled procfs reader. This is
// a unit fixture for bounds/parser/identity, never a claim of native Docker proof.
function executeApiProbeFixture(changed: Record<string, string> = {}, deniedPath?: string) {
  const metadata = apiIngressMetadata();
  const stat = (pid: number) =>
    pid + ' (controlled) ' + ['S', ...Array(18).fill('0'), '1234'].join(' ');
  const files: Record<string, string> = {
    '/proc/1/stat': stat(1),
    '/proc/7/stat': stat(7),
    '/proc/1/task/1/children': '7',
    '/proc/7/cmdline': 'node\0dist/main.js\0',
    '/proc/1/environ': metadata.Config.Env.join('\0') + '\0',
    '/proc/7/environ': metadata.Config.Env.join('\0') + '\0',
    ...changed,
  };
  const links: Record<string, string> = {
    '/proc/1/exe': '/sbin/docker-init',
    '/proc/7/exe': '/usr/local/bin/node',
    '/proc/7/cwd': '/app',
  };
  let nextFd = 1;
  const handles = new Map<number, { bytes: Buffer; position: number }>();
  const reader = {
    realpathSync: (path: string) => path,
    readlinkSync: (path: string) => {
      if (!(path in links)) throw Object.assign(new Error('unavailable'), { code: 'ENOENT' });
      return links[path];
    },
    openSync: (path: string) => {
      if (path === deniedPath) throw Object.assign(new Error('private-secret'), { code: 'EACCES' });
      if (!(path in files)) throw Object.assign(new Error('unavailable'), { code: 'ENOENT' });
      const fd = nextFd++;
      handles.set(fd, { bytes: Buffer.from(files[path]!), position: 0 });
      return fd;
    },
    readSync: (fd: number, buffer: Buffer, offset: number, length: number) => {
      const handle = handles.get(fd)!;
      const count = Math.min(31, length, handle.bytes.length - handle.position);
      handle.bytes.copy(buffer, offset, handle.position, handle.position + count);
      handle.position += count;
      return count;
    },
    closeSync: (fd: number) => handles.delete(fd),
  };
  let output = '';
  const child = {
    argv: ['/usr/local/bin/node', metadata.Id, 'b'.repeat(32)],
    execPath: '/usr/local/bin/node',
    pid: 9,
    exitCode: 0,
    env: Object.fromEntries(
      metadata.Config.Env.map((entry) => [
        entry.slice(0, entry.indexOf('=')),
        entry.slice(entry.indexOf('=') + 1),
      ]),
    ),
    stdout: {
      write: (text: string) => {
        output += text;
      },
    },
  };
  runInNewContext(
    SCALE_API_ENV_PROBE_SCRIPT,
    {
      require: (name: string) => {
        if (name === 'node:fs') return reader;
        if (name === 'node:path') return { basename };
        throw Error('Unexpected module ' + name);
      },
      process: child,
      Buffer,
      Date: { now: () => 1001 },
    },
    { timeout: 1000 },
  );
  expect(handles.size).toBe(0);
  expect(output).not.toContain('private-secret');
  return { exitCode: child.exitCode, result: JSON.parse(output) };
}

describe('fixed builtin API probe program', () => {
  it('reads init and the unique API child separately, including partial procfs reads', () => {
    const execution = executeApiProbeFixture();
    expect(execution.exitCode).toBe(0);
    expect(execution.result).toMatchObject({
      status: 'ok',
      pid1: { pid: 1 },
      api: { pid: 7, directChild: true },
      exec: { pid: 9, targetOwn: false, targetType: 'undefined' },
    });
    expect(
      assertScaleApiIngressEnvironment(apiIngressMetadata(), {
        ...apiIngressProof(),
        result: execution.result,
      }).valid,
    ).toBe(true);
  });

  it.each([
    [{ '/proc/1/environ': 'A=' + 'x'.repeat(65536) + '\0' }, undefined, 'startup-environments'],
    [{ '/proc/7/cmdline': 'node\0other.js\0' }, undefined, 'api-identity'],
    [{ '/proc/1/task/1/children': '7 '.repeat(17) }, undefined, 'api-identity'],
    [{}, '/proc/7/environ', 'startup-environments'],
  ] as const)('fails closed on a bounded native observation error', (changed, denied, stage) => {
    const execution = executeApiProbeFixture(changed, denied);
    expect(execution.exitCode).toBe(1);
    expect(execution.result).toMatchObject({ status: 'error', stage });
    expect(() =>
      assertScaleApiIngressEnvironment(apiIngressMetadata(), {
        ...apiIngressProof(),
        result: execution.result,
      }),
    ).toThrow('probe.');
  });

  it('checks the complete last startup record even when procfs omits a trailing NUL', () => {
    const environment = apiIngressMetadata().Config.Env.join('\0');
    const complete = executeApiProbeFixture({
      '/proc/1/environ': environment,
      '/proc/7/environ': environment,
    });
    expect(complete.exitCode).toBe(0);
    expect(
      assertScaleApiIngressEnvironment(apiIngressMetadata(), {
        ...apiIngressProof(),
        result: complete.result,
      }).valid,
    ).toBe(true);
    for (const tail of [
      'ASA_ISOLATED_TEST_WEB_ORIGIN',
      'ASA_ISOLATED_TEST_WEB_ORIGIN=',
      'ASA_ISOLATED_TEST_WEB_ORIGIN=private-secret',
    ]) {
      const present = executeApiProbeFixture({ '/proc/7/environ': environment + '\0' + tail });
      expect(present.exitCode).toBe(0);
      expect(() =>
        assertScaleApiIngressEnvironment(apiIngressMetadata(), {
          ...apiIngressProof(),
          result: present.result,
        }),
      ).toThrow('probe.apiStartup');
    }
  });
});

describe('real loopback browser prerequisites', () => {
  it('changes only the invalid ingress origin in the frozen workload profile', () => {
    expect(SCALE_ORIGIN).toBe('http://127.0.0.1:8080');
    expect(
      scaleHash({
        ...SCALE_PROFILE,
        ingress: { ...SCALE_PROFILE.ingress, origin: 'http://web:8080' },
      }),
    ).toBe('f09621f095efaff7548f76be2035eb1984254f966c50ff21b6a97aa3d6edca68');
    expect(SCALE_PROFILE_HASH).not.toBe(
      'f09621f095efaff7548f76be2035eb1984254f966c50ff21b6a97aa3d6edca68',
    );
  });

  it('uses the unchanged canonical-origin guard, without broadening isolated test trust', () => {
    const allowedWebOrigin = resolveCanonicalWebOrigin('8080', SCALE_ORIGIN);
    expect(allowedWebOrigin).toBe(SCALE_ORIGIN);
    const policy = { allowedWebOrigin, allowedLocalApiOrigin: 'http://127.0.0.1:4611' };
    expect(isAllowedMutationOrigin({ ...policy, origin: SCALE_ORIGIN })).toBe(true);
    for (const origin of ['http://web:8080', 'http://127.0.0.1:8081', undefined])
      expect(isAllowedMutationOrigin({ ...policy, origin })).toBe(false);
    expect(
      isAllowedMutationOrigin({ ...policy, origin: SCALE_ORIGIN, secFetchSite: 'cross-site' }),
    ).toBe(false);
    expect(() =>
      resolveIsolatedTestWebOrigin(SCALE_ORIGIN, 'test', environment().TEST_DATABASE_URL),
    ).toThrow();
  });

  it('rejects mismatched origins, independent namespaces and missing private observer access', () => {
    expect(() => assertScaleIngressConfig(ingressConfig())).not.toThrow();
    const changes = [
      { 'test-runner': { ...ingressConfig().services['test-runner'], network_mode: 'host' } },
      { 'test-runner': { ...ingressConfig().services['test-runner'], networks: { database: {} } } },
      { web: { ...ingressConfig().services.web, networks: { application: {} } } },
      {
        scratch: {
          ...ingressConfig().services.scratch,
          environment: { ASA_BLOCKS_PARENT_ORIGIN: 'http://web:8080' },
        },
      },
      {
        api: {
          environment: {
            ...ingressConfig().services.api.environment,
            ASA_ISOLATED_TEST_WEB_ORIGIN: 'http://web:8080',
          },
        },
      },
    ];
    for (const changed of changes)
      expect(() =>
        assertScaleIngressConfig({ services: { ...ingressConfig().services, ...changed } }),
      ).toThrow();
    const web = { Id: 'a'.repeat(64) };
    const driver = {
      Id: 'b'.repeat(64),
      HostConfig: { NetworkMode: 'container:' + web.Id },
      NetworkSettings: { Networks: {} },
    };
    expect(assertScaleDriverNetwork(driver, web).webId).toBe(web.Id);
    for (const mode of ['host', 'default', 'container:' + 'c'.repeat(64)])
      expect(() =>
        assertScaleDriverNetwork({ ...driver, HostConfig: { NetworkMode: mode } }, web),
      ).toThrow();
  });

  it('requires actual browser crypto in every top page and actual Scratch frame', () => {
    const proof = secureProof(0, 'scratch', 'scratch-open');
    expect(() => assertScaleSecureContext(proof)).not.toThrow();
    for (const changed of [
      { origin: 'http://web:8080' },
      { isSecureContext: false },
      { hasSubtle: false },
      { sha256: '0'.repeat(64) },
      { error: 'digest_failed' },
      { topLevel: true },
    ])
      expect(() => assertScaleSecureContext({ ...proof, ...changed })).toThrow();
    const raw = completeRaw(2, true);
    expect(() => validateScaleSecureContexts(raw.secureContexts, 2)).not.toThrow();
    raw.secureContexts.pop();
    expect(evaluateScaleCalibration(raw, identity, [resource()]).status).toBe('INVALID_FIXTURE');
    expect(
      evaluateScaleLevel({ ...completeRaw(), secureContexts: [] }, identity, [resource()]).status,
    ).toBe('INVALID');
  });
});

describe('capacity test-target and immutable pre-run thresholds', () => {
  it('accepts only the official exact-source hosted fixture and its private test database', () => {
    expect(assertScaleEnvironment(environment(), true).sourceSha).toBe(sourceSha);
    expect(
      resolveIsolatedTestWebOrigin('http://web:8080', 'test', environment().APP_TEST_DATABASE_URL),
    ).toBe('http://web:8080');
    expect(() =>
      resolveIsolatedTestWebOrigin(
        'http://web:8080',
        'production',
        environment().APP_TEST_DATABASE_URL,
      ),
    ).toThrow();
    for (const changed of [
      { GITHUB_ACTIONS: 'false' },
      { RUNNER_ENVIRONMENT: 'self-hosted' },
      { GITHUB_REPOSITORY: 'other/repo' },
      { ASA_SCALE_SHA: 'main' },
      { ASA_SCALE_PROFILE_HASH: '0'.repeat(64) },
      { ASA_SCALE_USERS: '300' },
      { ASA_E2E_BASE_URL: 'https://asa-lab.ru' },
      { DOCKER_HOST: 'ssh://production' },
      { TEST_DATABASE_URL: 'postgresql://postgres:synthetic@postgres:5432/asalab' },
      {
        APP_TEST_DATABASE_URL: 'postgresql://asalab_app:synthetic@public.example:5432/asalab_test',
      },
      {
        APP_TEST_DATABASE_URL:
          'postgresql://asalab_app:synthetic@postgres:5432/asalab_test?host=production',
      },
    ])
      expect(() => assertScaleEnvironment({ ...environment(), ...changed }, true)).toThrow();
  });

  it('rejects a remote Docker context even with valid GitHub-looking environment', () => {
    expect(() =>
      assertScaleDockerContext([
        { Name: 'default', Endpoints: { docker: { Host: 'unix:///var/run/docker.sock' } } },
      ]),
    ).not.toThrow();
    for (const host of ['ssh://production', 'tcp://192.0.2.1:2375', 'unix:///another.sock'])
      expect(() =>
        assertScaleDockerContext([{ Name: 'default', Endpoints: { docker: { Host: host } } }]),
      ).toThrow();
  });

  it('pins the full profile and rejects mixed production image identities', () => {
    expect(SCALE_PROFILE.slo.portalP95Ms).toBe(2000);
    expect(Object.isFrozen(SCALE_PROFILE.slo)).toBe(true);
    expect(SCALE_PROFILE_HASH).toBe(scaleHash(SCALE_PROFILE));
    const images = ['api', 'web', 'scratch'].map((service) => ({
      service,
      id: 'sha256:' + hash,
      revision: sourceSha,
    }));
    expect(assertScaleImages(images, sourceSha)).toMatch(/^[a-f0-9]{64}$/);
    expect(() => assertScaleImages(images.slice(0, 2), sourceSha)).toThrow();
    expect(() =>
      assertScaleImages(
        images.map((image) =>
          image.service === 'web' ? { ...image, revision: 'e'.repeat(40) } : image,
        ),
        sourceSha,
      ),
    ).toThrow();
  });
});

describe('operation denominators and content-preservation evidence', () => {
  it('represents60 learners as two independent30-seat classrooms and keeps the higher-level remainders', () => {
    expect(scaleCohortPlan(60).map((group) => group.planned)).toEqual([30, 30]);
    expect(scaleCohortPlan(100).map((group) => group.planned)).toEqual([30, 30, 30, 10]);
    expect(scaleCohortPlan(200).map((group) => group.planned)).toEqual([
      30, 30, 30, 30, 30, 30, 20,
    ]);
    expect(evaluateScaleLevel(completeRaw(60), identity, [resource()])).toMatchObject({
      status: 'PASS',
      classCount: 2,
      cohortDistribution: [30, 30],
    });
    const sameClass = completeRaw(60);
    sameClass.cohorts[1]!.classroomHash = sameClass.cohorts[0]!.classroomHash;
    expect(evaluateScaleLevel(sameClass, identity, [resource()]).status).toBe('INVALID');
    const wrongMembership = completeRaw(60);
    wrongMembership.cohorts[1]!.clients[0] = 0;
    expect(evaluateScaleLevel(wrongMembership, identity, [resource()]).status).toBe('INVALID');
  });
  it('confirms a complete level only with all independent readbacks and actual browser bytes', () => {
    const receipt = evaluateScaleLevel(completeRaw(), identity, [resource(), resource(2000)]);
    expect(receipt.status).toBe('PASS');
    expect(receipt.operations.login).toMatchObject({
      planned: 30,
      started: 30,
      verified: 30,
      successRatio: 1,
    });
    expect(receipt.operations['scratch-save'].latencyMs.count).toBe(30);
  });

  it('keeps failed and never-started learners in the success denominator', () => {
    const raw = completeRaw();
    const operation = raw.operations.find((item) => item.name === 'login')!;
    operation.status = 'FAILED';
    const receipt = evaluateScaleLevel(raw, identity, [resource()]);
    expect(receipt.status).toBe('FAIL');
    expect(receipt.operations.login.successRatio).toBe(29 / 30);
    operation.status = 'NOT_STARTED';
    operation.attempts = 0;
    expect(evaluateScaleLevel(raw, identity, [resource()]).operations.login).toMatchObject({
      planned: 30,
      started: 29,
      verified: 29,
    });
  });

  it('cannot remove a failed learner or duplicate a successful learner to manufacture 100%', () => {
    const raw = completeRaw();
    raw.operations.pop();
    expect(evaluateScaleLevel(raw, identity, [resource()]).status).toBe('INVALID');
    const duplicate = completeRaw();
    duplicate.operations[1] = { ...duplicate.operations[0]! };
    expect(evaluateScaleLevel(duplicate, identity, [resource()]).status).toBe('INVALID');
  });

  it.each(['identityMatched', 'actualContentHash', 'revisionAfter', 'changeObserved'])(
    'rejects save evidence with broken %s instead of accepting HTTP200',
    (key) => {
      const raw = completeRaw();
      const proof = raw.operations.find((item) => item.name === 'scratch-save')!.verification!;
      Object.assign(proof, {
        [key]: key === 'actualContentHash' ? 'e'.repeat(64) : key === 'revisionAfter' ? 1 : false,
      });
      expect(evaluateScaleLevel(raw, identity, [resource()]).status).toBe('INVALID');
    },
  );

  it('does not treat an ACK as a durable readback', () => {
    const raw = completeRaw();
    raw.operations.find((item) => item.name === 'electronics-save')!.status = 'ACKNOWLEDGED';
    expect(evaluateScaleLevel(raw, identity, [resource()]).status).toBe('FAIL');
  });

  it('does not convert a final driver failure into PASS after the per-operation checks', () => {
    for (const evidence of [
      { workloadComplete: false },
      { failure: { phase: 'final-readback', kind: 'integrity' } },
    ]) {
      expect(
        evaluateScaleLevel({ ...completeRaw(), ...evidence }, identity, [resource()]).status,
      ).toBe('FAIL');
      expect(
        evaluateScaleCalibration({ ...completeRaw(2, true), ...evidence }, identity, [resource()])
          .status,
      ).toBe('INVALID_FIXTURE');
    }
  });

  it('rejects another served JS bundle even if its revision label is correct', () => {
    const raw = completeRaw();
    raw.provenance.assets[0]!.actualHash = 'e'.repeat(64);
    expect(evaluateScaleLevel(raw, identity, [resource()]).status).toBe('INVALID');
  });

  it('enforces the fixed portal SLO while retaining slower values as evidence', () => {
    const raw = completeRaw();
    for (const operation of raw.operations.filter((item) => item.name === 'portal')) {
      operation.durationMs = 2001;
      operation.endedAtMs = operation.startedAtMs + 2001;
    }
    const receipt = evaluateScaleLevel(raw, identity, [resource()]);
    expect(receipt.status).toBe('FAIL');
    expect(receipt.operations.portal.latencyMs.p95).toBe(2001);
    expect(receipt.reasons).toContain('portal_p95_exceeds_2000ms');
  });
});

describe('unplanned HTTP failures, sampler failures and runner limits', () => {
  it('reports verification traffic separately but cannot exempt its real5xx', () => {
    const raw = completeRaw();
    const receipt = evaluateScaleLevel(
      { ...raw, observerRequests: [{ ...raw.requests[0]!, status: 503 }] },
      identity,
      [resource()],
    );
    expect(receipt.http.unexpected5xx).toBe(0);
    expect(receipt.verificationHttp.unexpected5xx).toBe(1);
    expect(receipt.status).toBe('FAIL');
  });

  it('only attributes the exact telemetry503 fault to injection', () => {
    const raw = completeRaw();
    raw.requests[0] = {
      ...raw.requests[0]!,
      phase: 'electronics-telemetry-outage',
      route: '/api/diagnostics/client',
      status: 503,
      injected: true,
    };
    expect(evaluateScaleLevel(raw, identity, [resource()]).http.injected503).toBe(1);
    raw.requests[0]!.route = '/api/projects';
    expect(evaluateScaleLevel(raw, identity, [resource()]).status).toBe('INVALID');
  });

  it.each([429, 500, 502, 503, 504])(
    'fails a real HTTP%s even when every save eventually succeeds',
    (status) => {
      const raw = completeRaw();
      raw.requests[0]!.status = status;
      expect(evaluateScaleLevel(raw, identity, [resource()]).status).toBe('FAIL');
    },
  );

  it('does not accept missing, zero-process or dropped browser samples', () => {
    for (const changed of [
      { browserSamples: [] },
      { observerErrors: 1 },
      { droppedObservations: 1 },
      { browserSamples: [{ chromiumProcesses: 0, chromiumRssBytes: 100 }] },
    ])
      expect(
        evaluateScaleLevel({ ...completeRaw(), ...changed }, identity, [resource()]).status,
      ).toBe('INVALID');
  });

  it('records genuine resource exhaustion as BLOCKED_BY_RUNNER, not a product capacity claim', () => {
    const low = { ...resource(), availableBytes: 1024 ** 3 };
    expect(evaluateScaleLevel(completeRaw(), identity, [low])).toMatchObject({
      status: 'BLOCKED_BY_RUNNER',
      reasons: ['runner_memory_floor'],
    });
    expect(
      evaluateScaleLevel({ ...completeRaw(), runnerBlocked: true }, identity, [resource()]).status,
    ).toBe('INVALID');
  });

  it('never masks data-integrity failure behind a runner-memory blocker', () => {
    const raw = { ...completeRaw(), integrityFailures: ['independent_document_readback_mismatch'] };
    expect(evaluateScaleLevel(raw, identity, [{ ...resource(), availableBytes: 1 }]).status).toBe(
      'FAIL',
    );
  });

  it('uses MemAvailable and cgroup limits, not summed browser RSS, for the safety decision', () => {
    expect(
      readScaleMemInfo('MemTotal: 16777216 kB\nMemFree: 1 kB\nMemAvailable: 8388608 kB\n'),
    ).toEqual({ totalBytes: 16 * 1024 ** 3, availableBytes: 8 * 1024 ** 3 });
    expect(scaleResourceViolation(resource())).toBeNull();
    const full = resource();
    full.containers[0]!.memoryBytes = 7 * 1024 ** 3;
    expect(scaleResourceViolation(full)).toBe('owned_container_memory_floor');
    expect(() => readScaleMemInfo('MemTotal: 1 kB\nMemAvailable: 2 kB')).toThrow();
    expect(() => scaleResourceViolation({ ...resource(), availableBytes: NaN })).toThrow();
    expect(evaluateScaleLevel(completeRaw(), identity, [resource(), resource(15000)]).status).toBe(
      'INVALID',
    );
  });

  it('keeps healthy product and whole non-injected latency distinct', () => {
    const basic = completeRaw().requests[0]!;
    const stats = summarizeScaleRequests(
      [
        basic,
        { ...basic, phase: 'electronics-recovery', durationMs: 8000 },
        { ...basic, route: '/api/analytics/v2/events', durationMs: 4000 },
      ],
      10000,
      30,
    );
    expect(stats.healthyProductLatencyMs).toEqual({ count: 1, p50: 20, p95: 20, p99: 20 });
    expect(stats.wholeNonInjectedLatencyMs.p99).toBe(8000);
    expect(scaleQuantiles([]).p95).toBeNull();
    expect(() => scaleQuantiles([NaN])).toThrow();
  });
});

function reloadWindow() {
  return {
    id: 0,
    client: 0,
    pageId: 0,
    action: 'native-reload-electronics',
    startedAtMs: 1000,
    endedAtMs: 1500,
    completed: true,
    frameId: 'main-frame',
    previousLoaderId: 'old-loader',
    committedLoaderId: 'new-loader',
    committedAtMs: 1150,
    commits: 1,
  };
}

function protocolFailure() {
  return {
    client: 0,
    pageId: 0,
    phase: 'electronics-reload',
    route: '/api/analytics/v2/module-session',
    method: 'POST',
    requestId: '123.45',
    frameId: 'main-frame',
    loaderId: 'old-loader',
    startedAtMs: 1100,
    failedAtMs: 1200,
    canceled: true,
    redirected: false,
    error: 'net::ERR_ABORTED',
    expected: false,
    reason: 'unexpected_network_failure',
    boundaryId: null,
  };
}

describe('passive network witnesses and actual browser-action boundaries', () => {
  it('counts only the three proven telemetry endpoints with exact old-document reload evidence', () => {
    const raw = completeRaw();
    raw.navigationWindows = [reloadWindow()];
    for (const [index, route] of [
      '/api/analytics/v2/module-session',
      '/api/analytics/v2/quality',
      '/api/diagnostics/quality',
    ].entries()) {
      const failure = { ...protocolFailure(), requestId: '123.' + index, route };
      // Its loadingFailed callback can follow the new document's commit. The
      // actual request/old loader, not the surviving Frame object, is the witness.
      const expected = classifyScaleNetworkFailure(failure, raw.navigationWindows, []);
      expect(expected).toEqual({
        expected: true,
        reason: 'explicit_native_reload_telemetry',
        boundaryId: 0,
      });
      raw.networkFailures.push({ ...failure, ...expected });
      raw.playwrightNetworkFailures.push(failure);
    }
    expect(evaluateScaleLevel(raw, identity, [resource()])).toMatchObject({
      status: 'PASS',
      network: {
        expectedReloadTelemetryAborts: 3,
        expectedOfflineFailures: 0,
        unexpectedFailures: 0,
      },
    });
  });

  it.each([
    { startedAtMs: 999 },
    { failedAtMs: 1501 },
    { pageId: 1 },
    { client: 1 },
    { loaderId: 'new-loader' },
    { loaderId: '' },
    { frameId: 'foreign-frame' },
    { requestId: '' },
    { canceled: false },
    { redirected: true },
    { route: '/api/diagnostics/client' },
    { route: '/api/auth/login' },
    { route: '/api/projects', method: 'POST' },
    { route: '/api/projects/:id/draft', method: 'PUT' },
    { route: '/api/projects/:id', method: 'PATCH' },
    { error: 'net::ERR_TIMED_OUT' },
  ])('never exempts an unrelated, unproven or business failure: %j', (changed) => {
    const failure = { ...protocolFailure(), ...changed };
    expect(classifyScaleNetworkFailure(failure, [reloadWindow()], []).expected).toBe(false);
    const raw = {
      ...completeRaw(),
      networkFailures: [failure],
      playwrightNetworkFailures: [failure],
      navigationWindows: [reloadWindow()],
    };
    expect(['FAIL', 'INVALID']).toContain(evaluateScaleLevel(raw, identity, [resource()]).status);
    expect(
      evaluateScaleLevel({ ...raw, networkFailures: [{ ...failure, expected: true }] }, identity, [
        resource(),
      ]).status,
    ).toBe('INVALID');
  });

  it.each([
    { completed: false },
    { committedLoaderId: '' },
    { committedLoaderId: 'old-loader' },
    { commits: 2 },
    { committedAtMs: 999 },
    { committedAtMs: 1501 },
    { action: 'native-projects-navigation' },
  ])(
    'requires one completed native reload with its own real document replacement: %j',
    (changed) => {
      expect(
        classifyScaleNetworkFailure(protocolFailure(), [{ ...reloadWindow(), ...changed }], [])
          .expected,
      ).toBe(false);
      expect(
        classifyScaleNetworkFailure(protocolFailure(), [reloadWindow(), reloadWindow()], [])
          .expected,
      ).toBe(false);
    },
  );

  it('fails closed on missing CDP, cross-page count substitutions and duplicate protocol IDs', () => {
    const raw = completeRaw();
    const failure = protocolFailure();
    raw.playwrightNetworkFailures = [failure];
    expect(() => summarizeScaleNetworkEvidence(raw)).toThrow(/disagree/);
    raw.networkFailures = [{ ...failure, pageId: 1 }];
    expect(() => summarizeScaleNetworkEvidence(raw)).toThrow(/disagree/);
    raw.networkFailures = [failure, failure];
    raw.playwrightNetworkFailures = [failure, failure];
    expect(() => summarizeScaleNetworkEvidence(raw)).toThrow(/ambiguous/);
    expect(
      evaluateScaleLevel({ ...completeRaw(), observerErrors: 1 }, identity, [resource()]).status,
    ).toBe('INVALID');
  });

  it('uses the context offline-to-online ACK interval, including requests while recovery is pending', () => {
    const window = {
      id: 0,
      client: 0,
      pageId: 0,
      startedAtMs: 1000,
      appliedAtMs: 1001,
      onlineRequestedAtMs: 2000,
      endedAtMs: 2020,
      completed: true,
      offlineApplied: true,
      onlineAcknowledged: true,
    };
    const failure = {
      ...protocolFailure(),
      phase: 'electronics-recovery',
      route: '/api/diagnostics/client',
      error: 'net::ERR_INTERNET_DISCONNECTED',
      canceled: false,
      startedAtMs: 2000.3,
      failedAtMs: 2000.4,
    };
    const expected = classifyScaleNetworkFailure(failure, [], [window]);
    expect(expected).toEqual({
      expected: true,
      reason: 'deliberate_context_offline',
      boundaryId: 0,
    });
    const raw = {
      ...completeRaw(),
      networkFailures: [{ ...failure, ...expected }],
      playwrightNetworkFailures: [failure],
      offlineWindows: [window],
    };
    expect(evaluateScaleLevel(raw, identity, [resource()])).toMatchObject({
      status: 'PASS',
      network: { expectedOfflineFailures: 1 },
    });
    for (const changed of [
      { startedAtMs: 2021, failedAtMs: 2022 },
      { client: 1 },
      { pageId: 1 },
      { error: 'net::ERR_TIMED_OUT' },
      { error: 'net::ERR_ABORTED' },
    ])
      expect(classifyScaleNetworkFailure({ ...failure, ...changed }, [], [window]).expected).toBe(
        false,
      );
    for (const changed of [
      { completed: false },
      { onlineAcknowledged: false },
      { offlineApplied: false },
    ])
      expect(classifyScaleNetworkFailure(failure, [], [{ ...window, ...changed }]).expected).toBe(
        false,
      );
    expect(classifyScaleNetworkFailure(failure, [], [window, window]).expected).toBe(false);
  });
});

describe('sequential scale orchestration', () => {
  const receipt = (users: number, status = 'PASS') => ({ ...identity, users, status });

  it('qualifies a two-person real-UI calibration without counting it as capacity', () => {
    expect(() => createScaleLedger(2)).toThrow();
    expect(() =>
      assertScaleEnvironment({ ...environment(), ASA_SCALE_USERS: '2' }, true),
    ).toThrow();
    expect(() =>
      assertScaleEnvironment(
        { ...environment(), ASA_SCALE_USERS: '2', ASA_SCALE_MODE: 'calibration' },
        true,
      ),
    ).not.toThrow();
    const raw = completeRaw(2, true);
    const result = evaluateScaleCalibration(raw, identity, [resource()]);
    expect(result).toMatchObject({
      status: 'VALID_FIXTURE',
      capacityEvidence: false,
      confirmedUsers: null,
      users: 2,
    });
    expect(evaluateScaleLevel(raw, identity, [resource()]).status).toBe('INVALID');
    raw.operations[0]!.status = 'FAILED';
    expect(evaluateScaleCalibration(raw, identity, [resource()]).status).toBe('INVALID_FIXTURE');
  });

  it('does not exempt a healthy timeout or an aborted write as navigation', () => {
    const base = completeRaw();
    for (const failure of [
      { ...protocolFailure(), error: 'net::ERR_TIMED_OUT', phase: 'portal', method: 'GET' },
      { ...protocolFailure(), error: 'net::ERR_ABORTED', phase: 'portal', method: 'PUT' },
    ]) {
      expect(
        evaluateScaleLevel(
          {
            ...base,
            networkFailures: [{ ...failure, expected: true }],
            playwrightNetworkFailures: [failure],
          },
          identity,
          [resource()],
        ).status,
      ).toBe('INVALID');
      expect(
        evaluateScaleLevel(
          {
            ...base,
            networkFailures: [{ ...failure, expected: false }],
            playwrightNetworkFailures: [failure],
          },
          identity,
          [resource()],
        ).status,
      ).toBe('FAIL');
    }
  });

  it.each(['FAIL', 'BLOCKED_BY_RUNNER', 'INVALID'])(
    'never starts100 after60 is %s',
    async (status) => {
      const invoked: number[] = [];
      const persisted: number[] = [];
      const summary = await runScaleLadder(
        identity,
        async (users: number) => {
          invoked.push(users);
          expect(persisted).toEqual(invoked.slice(0, -1));
          return receipt(users, users === 60 ? status : 'PASS');
        },
        async (value: { users: number }) => {
          persisted.push(value.users);
        },
      );
      expect(invoked).toEqual([30, 60]);
      expect(summary.maximumConfirmedUsers).toBe(30);
      expect(summary.levels.slice(2).map((value: { status: string }) => value.status)).toEqual([
        'NOT_RUN',
        'NOT_RUN',
        'NOT_RUN',
      ]);
      expect(summary.absoluteCapacityEstablished).toBe(false);
    },
  );

  it('runs all five levels in order only after sealed complete receipts', async () => {
    const invoked: number[] = [];
    const summary = await runScaleLadder(
      identity,
      async (users: number) => {
        invoked.push(users);
        return receipt(users);
      },
      async () => undefined,
    );
    expect(invoked).toEqual(SCALE_LEVELS);
    expect(summary.maximumConfirmedUsers).toBe(200);
    expect(summary.absoluteCapacityEstablished).toBe(false);
  });

  it('rejects skipped levels, stale results, mixed images and a late success after failure', () => {
    expect(() => assertPriorScaleLevels([], 60, identity)).toThrow();
    expect(() => assertPriorScaleLevels([receipt(30, 'FAIL')], 60, identity)).toThrow();
    for (const changed of [
      { sourceSha: 'e'.repeat(40) },
      { imageManifestHash: 'e'.repeat(64) },
      { runToken: 'e'.repeat(32) },
    ])
      expect(() =>
        assertPriorScaleLevels([{ ...receipt(30), ...changed }], 60, identity),
      ).toThrow();
    expect(() => scaleLadderSummary([receipt(30, 'FAIL'), receipt(60)], identity)).toThrow();
  });

  it('only accepts explicit old/full or focused counterbalanced latency modes', () => {
    expect(assertLatencyScenario(undefined)).toBe('full');
    expect(assertLatencyScenario('latency')).toBe('latency');
    expect(() => assertLatencyScenario('all-levels-ignore-errors')).toThrow();
    expect(assertLatencySample('ba-a')).toBe('ba-a');
    expect(() => assertLatencySample('../overwrite')).toThrow();
  });
});

describe('counterbalanced diagnostic timing boundaries', () => {
  function observed() {
    const operations = ['login', 'healthy-save', 'telemetry-outage-save'].map((name, index) => ({
      id: '0:' + index,
      client: 0,
      name,
      startedAtMs: 1000,
      apiCompletedAtMs: 1120,
      completedAtMs: 1200,
      status: 'VERIFIED',
    }));
    const fetches = operations.flatMap((operation, index) => [
      {
        id: '0:' + index * 2,
        operationId: operation.id,
        method: index ? 'PUT' : 'POST',
        nativeFetchAtMs: 1010,
        headersAtMs: 1100,
        jsonStartedAtMs: 1102,
        jsonCompletedAtMs: 1110,
        status: 200,
      },
      ...(index
        ? [
            {
              id: '0:' + (index * 2 + 1),
              operationId: operation.id,
              method: 'GET',
              nativeFetchAtMs: 1121,
              headersAtMs: 1180,
              jsonStartedAtMs: 1181,
              jsonCompletedAtMs: 1190,
              status: 200,
            },
          ]
        : []),
    ]);
    const records = fetches
      .filter((fetch) => fetch.method !== 'GET')
      .map((fetch) => ({
        client: 0,
        operationId: fetch.operationId,
        requestId: fetch.id,
        completed: true,
        injected: false,
        status: 200,
        // Deliberately another clock origin; never subtract Node from browser clocks.
        proxyReceivedAtMs: 5000,
        upstreamDispatchedAtMs: 5002,
        upstreamHeadersAtMs: 5072,
        proxyFinishedAtMs: 5080,
      }));
    return { clients: [{ operations, fetches, dropped: 0 }], records };
  }

  it('separates browser before-send/body/post-response from proxy processing without comparing clock origins', () => {
    const { clients, records } = observed();
    const result = summarizeLatencyTimings(clients, records, 1);
    expect(result.login.metrics.beforeNativeFetchMs.p95).toBe(10);
    expect(result.login.metrics.nativeFetchToHeadersMs.p95).toBe(90);
    expect(result.login.metrics.bodyAndJsonMs.p95).toBe(8);
    expect(result.login.metrics.jsonToApiResultMs.p95).toBe(10);
    expect(result.login.metrics.proxyDispatchToHeadersMs.p95).toBe(70);
    expect(result['healthy-save'].metrics.afterApiResultMs.p95).toBe(80);
  });

  it('rejects missing JSON/readback, dropped observations and unjoinable request IDs', () => {
    const missingJson = observed();
    missingJson.clients[0]!.fetches[0]!.jsonCompletedAtMs = Number.NaN;
    expect(() => summarizeLatencyTimings(missingJson.clients, missingJson.records, 1)).toThrow();
    const missingReadback = observed();
    missingReadback.clients[0]!.fetches = missingReadback.clients[0]!.fetches.filter(
      (fetch) => fetch.method !== 'GET',
    );
    expect(() =>
      summarizeLatencyTimings(missingReadback.clients, missingReadback.records, 1),
    ).toThrow();
    const duplicate = observed();
    duplicate.records.push({ ...duplicate.records[0]! });
    expect(() => summarizeLatencyTimings(duplicate.clients, duplicate.records, 1)).toThrow();
    const dropped = observed();
    dropped.clients[0]!.dropped = 1;
    expect(() => summarizeLatencyTimings(dropped.clients, dropped.records, 1)).toThrow();
  });
});

describe('bounded failure-only API diagnostic retention', () => {
  const sourceSha = 'c'.repeat(40);
  const start = Date.parse('2026-11-06T10:00:00.000Z');
  const time = new Date(start + 1000).toISOString();
  const requestId = (index = 1) =>
    '00000000-0000-4000-8000-' + index.toString(16).padStart(12, '0');
  const window = { sourceSha, startedAtMs: start, endedAtMs: start + 5000, expectedApi5xx: 1 };
  const secret = 'private-cookie-and-sql-value';
  const container = {
    id: 'a'.repeat(64),
    image: 'sha256:' + 'b'.repeat(64),
    sourceSha,
    project: 'asa-scale-42-1',
    runToken: 'd'.repeat(32),
    root: '/tmp/owned-scale',
    startedAt: new Date(start - 10000).toISOString(),
    restartCount: 0,
  };
  const context = { ...window, phase: 'level-30', container };
  const sessionDatabase = {
    operation: 'identity.session.resolve',
    calls: 1,
    failures: 1,
    poolAcquireMs: 5000.4,
    queryRoundTripMs: 0,
    lastFailurePhase: 'acquire',
    lastErrorCode: 'pool_acquire_timeout',
  };
  function failure(overrides: Record<string, unknown> = {}) {
    return {
      kind: 'server_error',
      time,
      revision: sourceSha,
      requestId: requestId(),
      method: 'GET',
      status: 500,
      errorCode: 'database_connection_timeout',
      errorClass: 'Error',
      frames: ['at acquire (/app/node_modules/pg-pool/index.js:45:11)'],
      sessionDatabase,
      runtime: {
        rssBytes: 1000000,
        heapUsedBytes: 500000,
        cpuMicros: { user: 300000, system: 100000 },
        pool: { total: 10, idle: 0, waiting: 30 },
      },
      ...overrides,
    };
  }
  const line = (record: Record<string, unknown>, stamp = time) =>
    stamp + ' ' + JSON.stringify(record) + '\n';
  const streams = (stdout = line(failure()), stderr = '') => ({
    stdout,
    stderr,
    transport: 'completed',
  });
  function metadata() {
    return {
      Id: container.id,
      Image: container.image,
      RestartCount: 0,
      State: { StartedAt: container.startedAt, Running: true, OOMKilled: false },
      Config: {
        Env: ['DATABASE_URL=postgresql://private:password@private/database'],
        Labels: {
          'com.docker.compose.project': container.project,
          'com.docker.compose.service': 'api',
          'com.docker.compose.project.working_dir': container.root,
          'io.asalab.scale.run': container.runToken,
          'org.opencontainers.image.revision': sourceSha,
        },
      },
    };
  }
  const io = () => ({
    now: () => start + 8000,
    inspect: vi.fn(async () => metadata()),
    logs: vi.fn(async () => streams()),
  });

  it('retains the actual API producer and session acquire failure without exception text or parameters', async () => {
    const exception = new Error('timeout exceeded when trying to connect; password=' + secret);
    exception.stack =
      exception.message +
      '\n    at acquire (/app/node_modules/.pnpm/pg-pool@3.10.1/node_modules/pg-pool/index.js:45:11)' +
      '\n    at processTicksAndRejections (node:internal/process/task_queues:95:5)';
    const request = {
      id: requestId(),
      method: 'GET',
      raw: { url: '/api/projects/' + requestId() },
      headers: { cookie: secret, authorization: 'Bearer ' + secret },
    } as Parameters<typeof recordServerFailure>[1];
    const pool = {
      connect: (callback: (error: Error) => void) => callback(exception),
      totalCount: 10,
      idleCount: 0,
      waitingCount: 30,
    } as unknown as Parameters<typeof runSessionContextQuery>[0];
    let query: ReturnType<typeof runSessionContextQuery> | undefined;
    runSessionDatabaseScope(request, () => {
      query = runSessionContextQuery(pool, 'SELECT $1::text AS private_value', [secret]);
    });
    await expect(query).rejects.toBe(exception);
    const output: string[] = [];
    const writer = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });
    try {
      recordServerFailure(exception, request, 500, sourceSha, pool);
      recordServerFailure(exception, request, 500, sourceSha, pool);
    } finally {
      writer.mockRestore();
    }
    expect(output).toHaveLength(1);
    const produced = JSON.parse(output[0]!);
    const at = Date.parse(produced.time);
    const receipt = projectScaleFailureLogs(
      streams(line(produced, produced.time)),
      {
        sourceSha,
        startedAtMs: at - 1,
        endedAtMs: at + 1,
        expectedApi5xx: 1,
      },
      [secret],
    );
    expect(receipt.status).toBe('CAPTURED');
    expect(receipt.serverErrors[0]).toMatchObject({
      errorCode: 'database_connection_timeout',
      sessionDatabase: {
        calls: 1,
        failures: 1,
        lastFailurePhase: 'acquire',
        lastErrorCode: 'pool_acquire_timeout',
      },
      runtime: { pool: { total: 10, idle: 0, waiting: 30 } },
      frames: [
        '/app/node_modules/.pnpm/pg-pool@3.10.1/node_modules/pg-pool/index.js:45:11',
        'node:internal/process/task_queues:95:5',
      ],
    });
    expect(JSON.stringify(receipt)).not.toMatch(
      /private-cookie|private_value|authorization|password|cookie/,
    );
  });

  it('joins only failed request IDs from both streams, with explicit lifetime event-loop and pool context', () => {
    const common = { time, revision: sourceSha, requestId: requestId(), method: 'GET' };
    const receipt = projectScaleFailureLogs(
      streams(
        line({ ...common, kind: 'http_request_started', headers: { cookie: secret } }) +
          line({
            ...common,
            kind: 'http_response',
            status: 500,
            durationMs: 5002,
            sessionDatabase,
            eventLoopDelaySinceStartMs: { p50: 10, p99: 23, max: 49 },
          }) +
          line(
            failure({ path: '/api/private/' + secret, message: secret, sql: secret, env: secret }),
          ) +
          line({ ...common, kind: 'http_request_ended', requestId: requestId(2), durationMs: 14 }),
        line({
          kind: 'database_pool_error',
          time,
          role: 'main',
          count: 3,
          errorCode: '53300',
          errorClass: 'Error',
          connection: secret,
        }),
      ),
      window,
    );
    expect(receipt.status).toBe('CAPTURED');
    expect(receipt.serverErrors).toHaveLength(1);
    expect(receipt.requestEvents).toHaveLength(2);
    expect(receipt.requestEvents[1]).toMatchObject({
      eventLoopDelaySinceStartMs: { p50: 10, p99: 23, max: 49 },
    });
    expect(receipt.poolErrors[0]).toMatchObject({ stream: 'stderr', errorCode: '53300', count: 3 });
    expect(receipt.correlation).toContain('independent join');
    expect(JSON.stringify(receipt)).not.toContain(secret);
    expect(JSON.stringify(receipt)).not.toMatch(
      /"headers"|"connection"|"sql"|"message"|"path"|"env"/,
    );
  });

  it('reports missing evidence, invalid streams and unknown expected counts separately from zero errors', () => {
    const missing = projectScaleFailureLogs(streams(''), window);
    expect(missing).toMatchObject({ status: 'INCOMPLETE', missingByCount: 1 });
    const unknown = projectScaleFailureLogs(streams(), { ...window, expectedApi5xx: null });
    expect(unknown).toMatchObject({
      status: 'INCOMPLETE',
      expectedApi5xx: null,
      missingByCount: null,
    });
    const invalid = projectScaleFailureLogs({ ...streams(), stderr: undefined }, window);
    expect(invalid).toMatchObject({ status: 'INCOMPLETE', counts: { invalidStreams: 1 } });
    expect(projectScaleFailureLogs(streams(''), { ...window, expectedApi5xx: 0 })).toMatchObject({
      status: 'CAPTURED',
      expectedApi5xx: 0,
      missingByCount: 0,
    });
  });

  it('rejects foreign source, out-of-window records and sensitive or malformed records without persisting them', () => {
    const receipt = projectScaleFailureLogs(
      streams(
        line(failure({ revision: 'e'.repeat(40) })) +
          line(failure({ time: new Date(start - 1).toISOString() })) +
          line(failure(), new Date(start - 1).toISOString()) +
          line(failure({ message: secret })) +
          line(failure({ frames: ['at secret (/app/dist/main.js?token=' + secret + ':1:1)'] })) +
          time +
          ' {not-json}\n',
      ),
      window,
      [secret],
    );
    expect(receipt).toMatchObject({
      status: 'INCOMPLETE',
      missingByCount: 1,
      counts: { foreignRevision: 1, outsideWindow: 2, redactedRecords: 2, invalidRecords: 1 },
    });
    expect(receipt.serverErrors).toEqual([]);
    expect(JSON.stringify(receipt)).not.toMatch(/not-json|token|private-cookie/);
    const malformed = projectScaleFailureLogs(
      streams(
        line(
          failure({
            frames: ['at handler (/app/dist/main.js?private=unretained:1:1)'],
          }),
        ),
      ),
      window,
    );
    expect(malformed).toMatchObject({ status: 'INCOMPLETE', counts: { invalidRecords: 1 } });
  });

  it('projects closed classifications, preserves unknown pool state and rejects impossible counters', () => {
    const receipt = projectScaleFailureLogs(
      streams(
        line(
          failure({
            errorCode: secret,
            errorClass: secret,
            runtime: { ...failure().runtime, pool: null },
          }),
        ),
      ),
      window,
    );
    expect(receipt.serverErrors[0]).toMatchObject({
      errorCode: 'unclassified_error',
      errorClass: 'unknown',
      runtime: { pool: null },
    });
    expect(JSON.stringify(receipt)).not.toContain(secret);
    for (const invalid of [
      { runtime: { ...failure().runtime, pool: { total: 10, idle: 11, waiting: 0 } } },
      { runtime: { ...failure().runtime, rssBytes: -1 } },
      { sessionDatabase: { ...sessionDatabase, failures: 2 } },
      { sessionDatabase: { ...sessionDatabase, lastFailurePhase: secret } },
    ])
      expect(projectScaleFailureLogs(streams(line(failure(invalid))), window)).toMatchObject({
        status: 'INCOMPLETE',
        counts: { invalidRecords: 1 },
        serverErrors: [],
      });
  });

  it('makes byte, line, record and incomplete-tail bounds observable', () => {
    const limits = SCALE_FAILURE_DIAGNOSTIC_LIMITS;
    expect(
      projectScaleFailureLogs(streams('x'.repeat(limits.streamBytes + 1)), window),
    ).toMatchObject({
      status: 'INCOMPLETE',
      counts: { truncatedStreams: 1, unterminatedLines: 1 },
    });
    expect(projectScaleFailureLogs(streams('x\n'.repeat(limits.lines + 1)), window)).toMatchObject({
      status: 'INCOMPLETE',
      counts: { lines: limits.lines, lineLimitHit: true },
    });
    expect(
      projectScaleFailureLogs(streams('x'.repeat(limits.lineBytes + 1) + '\n'), window),
    ).toMatchObject({
      status: 'INCOMPLETE',
      counts: { invalidRecords: 1 },
    });
    expect(projectScaleFailureLogs(streams(line(failure()).trimEnd()), window)).toMatchObject({
      status: 'INCOMPLETE',
      counts: { unterminatedLines: 1 },
    });
    const capped = projectScaleFailureLogs(
      streams(
        Array.from({ length: limits.serverErrors + 1 }, (_, i) =>
          line(failure({ requestId: requestId(i + 1) })),
        ).join(''),
      ),
      window,
    );
    expect(capped.serverErrors).toHaveLength(limits.serverErrors);
    expect(capped).toMatchObject({
      status: 'INCOMPLETE',
      counts: { droppedRecords: 1, serverErrors: limits.serverErrors + 1 },
    });
    expect(
      projectScaleFailureLogs(streams(line(failure()) + line(failure())), window),
    ).toMatchObject({
      status: 'INCOMPLETE',
      counts: { duplicateServerErrorIds: 1 },
    });
  });

  it.each(['failed', 'timeout', 'truncated'])(
    'retains safe partial output while %s transport cannot claim complete capture',
    (transport) => {
      const receipt = projectScaleFailureLogs(
        {
          ...streams(),
          transport,
          error: { code: 1, signal: 'SIGKILL', message: secret, stderr: secret, command: secret },
        },
        window,
      );
      expect(receipt).toMatchObject({
        status: 'INCOMPLETE',
        transport,
        transportError: { code: 'diagnostic_transport_failed', exitCode: 1, signal: 'SIGKILL' },
      });
      expect(receipt.serverErrors).toHaveLength(1);
      expect(JSON.stringify(receipt)).not.toContain(secret);
    },
  );

  it('requires exact phase container identity before logs and verifies it again afterward', async () => {
    const transport = io();
    const receipt = await captureScaleFailureDiagnostics(context, transport, [secret]);
    expect(receipt).toMatchObject({
      status: 'CAPTURED',
      phase: 'level-30',
      sourceSha,
      container: {
        before: { id: container.id, restartCount: 0 },
        after: { id: container.id, restartCount: 0 },
      },
    });
    expect(transport.inspect).toHaveBeenCalledTimes(2);
    expect(transport.inspect).toHaveBeenNthCalledWith(1, container.id, 5000);
    expect(transport.logs).toHaveBeenCalledWith(container.id, context, 5000);
    expect(transport.inspect.mock.invocationCallOrder[0]).toBeLessThan(
      transport.logs.mock.invocationCallOrder[0]!,
    );
    expect(transport.inspect.mock.invocationCallOrder[1]).toBeGreaterThan(
      transport.logs.mock.invocationCallOrder[0]!,
    );
    expect(JSON.stringify(receipt)).not.toMatch(
      /DATABASE_URL|postgresql|private:password|"Config"|"Labels"/,
    );
  });

  const ownershipChanges: Array<[string, (value: ReturnType<typeof metadata>) => void]> = [
    [
      'container',
      (value) => {
        value.Id = 'e'.repeat(64);
      },
    ],
    [
      'image',
      (value) => {
        value.Image = 'sha256:' + 'e'.repeat(64);
      },
    ],
    [
      'source',
      (value) => {
        value.Config.Labels['org.opencontainers.image.revision'] = 'e'.repeat(40);
      },
    ],
    [
      'project',
      (value) => {
        value.Config.Labels['com.docker.compose.project'] = 'asa-scale-43-1';
      },
    ],
    [
      'service',
      (value) => {
        value.Config.Labels['com.docker.compose.service'] = 'web';
      },
    ],
    [
      'root',
      (value) => {
        value.Config.Labels['com.docker.compose.project.working_dir'] = '/tmp/foreign';
      },
    ],
    [
      'run',
      (value) => {
        value.Config.Labels['io.asalab.scale.run'] = 'e'.repeat(32);
      },
    ],
    [
      'start',
      (value) => {
        value.State.StartedAt = time;
      },
    ],
    [
      'restart',
      (value) => {
        value.RestartCount = 1;
      },
    ],
  ];
  it.each(ownershipChanges)(
    'refuses changed %s identity before reading any logs',
    async (_name, change) => {
      const changed = metadata();
      change(changed);
      expect(() => assertScaleFailureContainer(changed, container)).toThrow(
        'diagnostic_identity_mismatch',
      );
      const transport = io();
      transport.inspect.mockResolvedValue(changed);
      expect(await captureScaleFailureDiagnostics(context, transport)).toMatchObject({
        status: 'UNAVAILABLE',
        stage: 'pre-inspect',
        error: { code: 'diagnostic_identity_mismatch' },
        serverErrors: [],
      });
      expect(transport.logs).not.toHaveBeenCalled();
    },
  );

  it('discards buffered evidence after a restart during collection, but retains a crashed original process', async () => {
    const changed = metadata();
    changed.RestartCount = 1;
    const transport = io();
    transport.inspect.mockResolvedValueOnce(metadata()).mockResolvedValueOnce(changed);
    expect(await captureScaleFailureDiagnostics(context, transport)).toMatchObject({
      status: 'UNAVAILABLE',
      stage: 'post-inspect',
      serverErrors: [],
    });
    const crashed = metadata();
    crashed.State.Running = false;
    crashed.State.OOMKilled = true;
    const crashTransport = io();
    crashTransport.inspect.mockResolvedValueOnce(metadata()).mockResolvedValueOnce(crashed);
    expect(await captureScaleFailureDiagnostics(context, crashTransport)).toMatchObject({
      status: 'CAPTURED',
      container: { after: { running: false, oomKilled: true } },
    });
  });

  it('bounds total collection time and records missing-container errors without arbitrary messages', async () => {
    const transport = io();
    let now = start + 8000;
    transport.now = () => now;
    transport.inspect.mockImplementation(async () => {
      now += SCALE_FAILURE_DIAGNOSTIC_LIMITS.totalTimeoutMs + 1;
      return metadata();
    });
    expect(await captureScaleFailureDiagnostics(context, transport)).toMatchObject({
      status: 'UNAVAILABLE',
      stage: 'logs',
      error: { code: 'diagnostic_deadline' },
    });
    expect(transport.logs).not.toHaveBeenCalled();
    const missing = io();
    missing.inspect.mockRejectedValue({ code: 1, message: secret, stderr: secret, stdout: secret });
    const receipt = await captureScaleFailureDiagnostics(context, missing);
    expect(receipt).toMatchObject({
      status: 'UNAVAILABLE',
      stage: 'pre-inspect',
      error: { code: 'diagnostic_transport_failed', exitCode: 1 },
    });
    expect(JSON.stringify(receipt)).not.toContain(secret);
    expect(scaleFailureDiagnosticError({ code: secret, signal: secret, message: secret })).toEqual({
      code: 'diagnostic_transport_failed',
      exitCode: null,
      signal: null,
    });
  });

  it('rejects unexpected phases and unbounded time windows before any Docker IO', async () => {
    for (const invalid of [
      { ...context, phase: '../foreign' },
      { ...context, startedAtMs: start - SCALE_PROFILE.levelTimeoutMs - 30000 },
      { ...context, endedAtMs: start + 9000 },
    ]) {
      const transport = io();
      expect(await captureScaleFailureDiagnostics(invalid, transport)).toMatchObject({
        status: 'UNAVAILABLE',
        stage: 'context',
        error: { code: 'invalid_diagnostic_context' },
      });
      expect(transport.inspect).not.toHaveBeenCalled();
      expect(transport.logs).not.toHaveBeenCalled();
    }
  });
});

const officialHarnessSha = 'a'.repeat(40);
const officialRunToken = 'b'.repeat(32);
const officialEnvironment = (overrides: Record<string, string | undefined> = {}) => ({
  GITHUB_ACTIONS: 'true',
  GITHUB_REPOSITORY: 'spikeal8-maker/asa-lab',
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_REF: 'refs/heads/main',
  GITHUB_SHA: officialHarnessSha,
  GITHUB_WORKFLOW_SHA: officialHarnessSha,
  GITHUB_WORKFLOW_REF:
    'spikeal8-maker/asa-lab/.github/workflows/classroom-official-n30.yml@refs/heads/main',
  GITHUB_RUN_ID: '123',
  GITHUB_RUN_ATTEMPT: '1',
  RUNNER_ENVIRONMENT: 'github-hosted',
  RUNNER_OS: 'Linux',
  ASA_SCALE_HARNESS_SHA: officialHarnessSha,
  ASA_SCALE_RUN_TOKEN: officialRunToken,
  ASA_SCALE_PROFILE_HASH: SCALE_PROFILE_HASH,
  ASA_SCALE_AFTER_DEPLOYMENT_DIGEST: OFFICIAL_SCALE_AFTER.deploymentDigest,
  ASA_SCALE_AFTER_REVISION: OFFICIAL_SCALE_AFTER.revision,
  ASA_SCALE_AFTER_SCHEMA: String(OFFICIAL_SCALE_AFTER.schema),
  ...overrides,
});
const officialTestServices = ['api', 'web', 'scratch', 'minio', 'search'];
const officialRecord = (
  selector: {
    deploymentDigest: string;
    revision: string;
    schema: number;
  } = OFFICIAL_SCALE_BASELINE,
) => {
  const images = officialTestServices.map((service, index) => ({
    service,
    reference:
      'ghcr.io/spikeal8-maker/asa-lab/' + service + '@sha256:' + String(index + 1).repeat(64),
    id: 'sha256:' + String(index + 1).repeat(64),
    platform: 'linux/amd64',
    revision: service === 'minio' ? '' : selector.revision,
  }));
  return {
    deploymentDigest: selector.deploymentDigest,
    ci: 'PASS',
    manifest: {
      format: 'asa-deployment-v2',
      repository: 'spikeal8-maker/asa-lab',
      revision: selector.revision,
      schema: selector.schema,
      platform: 'linux/amd64',
      publicationRunId: 1234,
      images: Object.fromEntries(images.map((image) => [image.service, image.reference])),
    },
    images,
  };
};
const officialProof = () => ({
  format: 'asa-official-n30-releases-v1',
  ...assertOfficialScaleDispatch(officialEnvironment()),
  runToken: officialRunToken,
  harnessGeneralCi: 'PASS',
  scenarioSha256: OFFICIAL_SCALE_SCENARIO.e2eSha256,
  postgres: {
    reference: OFFICIAL_SCALE_POSTGRES,
    id: 'sha256:' + '9'.repeat(64),
    platform: 'linux/amd64',
  },
  baseline: officialRecord(),
  after: officialRecord(OFFICIAL_SCALE_AFTER),
});

describe('official full N30 adapter boundary and provenance', () => {
  it('pins the byte-identical original UI scenario and all 420 operations/SLO settings', async () => {
    expect(scaleHash(await readFile('e2e/classroom-scale.spec.ts', 'utf8'))).toBe(
      OFFICIAL_SCALE_SCENARIO.e2eSha256,
    );
    expect(SCALE_PROFILE_HASH).toBe(OFFICIAL_SCALE_SCENARIO.profileHash);
    expect(createScaleLedger(30)).toHaveLength(OFFICIAL_SCALE_SCENARIO.operations);
    expect(OFFICIAL_SCALE_SCENARIO.sourceSha).toBe('30a7c78e4c774a944d4b30e369ef51ff701a364d');
    expect(OFFICIAL_SCALE_BASELINE.deploymentDigest).toBe(
      'sha256:598604051f862c65e5b7d2198c4fb4c21f10229a5f6bb1c2311a6b868d1fe035',
    );
  });

  it.each([
    { GITHUB_EVENT_NAME: 'pull_request' },
    { GITHUB_EVENT_NAME: 'push' },
    { GITHUB_EVENT_NAME: 'pull_request_target' },
    { GITHUB_EVENT_NAME: 'workflow_run' },
    { GITHUB_REF: 'refs/heads/feature' },
    { GITHUB_REPOSITORY: 'elsewhere/asa-lab' },
    { GITHUB_ACTIONS: '' },
    { RUNNER_ENVIRONMENT: 'self-hosted' },
    { RUNNER_OS: 'Windows' },
    { GITHUB_SHA: OFFICIAL_SCALE_BASELINE.revision },
    { GITHUB_WORKFLOW_SHA: OFFICIAL_SCALE_BASELINE.revision },
    { GITHUB_WORKFLOW_REF: 'spikeal8-maker/asa-lab/.github/workflows/other.yml@refs/heads/main' },
    { DOCKER_HOST: 'tcp://production:2375' },
    { DOCKER_CONTEXT: 'production' },
    { GITHUB_RUN_ATTEMPT: '0' },
  ])('rejects unauthorized native context %j before any Docker operation', (override) => {
    expect(() => assertOfficialScaleDispatch(officialEnvironment(override))).toThrow(
      /canonical main dispatch/,
    );
  });

  it('keeps real GitHub/harness SHA separate from the old browser release expectation', () => {
    const env = officialEnvironment({
      ASA_SCALE_OFFICIAL: 'true',
      ASA_SCALE_VARIANT: 'baseline',
      ASA_SCALE_SHA: OFFICIAL_SCALE_BASELINE.revision,
      ASA_SCALE_RELEASE_SHA: OFFICIAL_SCALE_BASELINE.revision,
      ASA_SCALE_DEPLOYMENT_DIGEST: OFFICIAL_SCALE_BASELINE.deploymentDigest,
      ASA_SCALE_MODE: 'capacity',
      ASA_SCALE_USERS: '30',
      ASA_E2E_EXTERNAL: 'true',
      ASA_E2E_BASE_URL: SCALE_ORIGIN,
      TEST_DATABASE_URL: 'postgres://postgres:synthetic@postgres:5432/asalab_test',
      APP_TEST_DATABASE_URL: 'postgres://asalab_app:synthetic@postgres:5432/asalab_test',
    });
    expect(assertScaleEnvironment(env, true)).toMatchObject({
      harnessSha: officialHarnessSha,
      sourceSha: OFFICIAL_SCALE_BASELINE.revision,
      releaseSha: OFFICIAL_SCALE_BASELINE.revision,
      variant: 'baseline',
    });
    expect(env.GITHUB_SHA).toBe(officialHarnessSha);
    expect(() => assertScaleEnvironment({ ...env, ASA_SCALE_USERS: '60' }, true)).toThrow(
      /only N30/,
    );
    expect(() =>
      assertScaleEnvironment({ ...env, ASA_SCALE_RELEASE_SHA: officialHarnessSha }, true),
    ).toThrow();
  });

  it.each([
    { ASA_SCALE_AFTER_DEPLOYMENT_DIGEST: 'stable' },
    { ASA_SCALE_AFTER_DEPLOYMENT_DIGEST: OFFICIAL_SCALE_BASELINE.deploymentDigest },
    { ASA_SCALE_AFTER_REVISION: '8358997d' },
    { ASA_SCALE_AFTER_REVISION: OFFICIAL_SCALE_BASELINE.revision },
    { ASA_SCALE_AFTER_SCHEMA: '307' },
    { ASA_SCALE_AFTER_SCHEMA: '0' },
    { ASA_SCALE_AFTER_SCHEMA: '304.0' },
  ])('rejects mutable, mixed or ambiguous release selection %j', (override) => {
    expect(() => officialScaleAfterSelector(officialEnvironment(override))).toThrow();
  });

  it('binds both full official CI receipts to this exact dispatch and forbids mixed images', () => {
    expect(
      assertOfficialScaleReleaseProof(officialProof(), officialEnvironment()).baseline.manifest
        .schema,
    ).toBe(304);
    for (const mutate of [
      (proof: ReturnType<typeof officialProof>) => {
        proof.harnessSha = OFFICIAL_SCALE_AFTER.revision;
      },
      (proof: ReturnType<typeof officialProof>) => {
        proof.runToken = 'c'.repeat(32);
      },
      (proof: ReturnType<typeof officialProof>) => {
        proof.harnessGeneralCi = 'FAIL';
      },
      (proof: ReturnType<typeof officialProof>) => {
        proof.after.ci = 'FAIL';
      },
      (proof: ReturnType<typeof officialProof>) => {
        proof.after.manifest.schema = 307;
      },
      (proof: ReturnType<typeof officialProof>) => {
        proof.baseline.images[0]!.revision = officialHarnessSha;
      },
      (proof: ReturnType<typeof officialProof>) => {
        proof.after.images[1]!.reference += ':latest';
      },
      (proof: ReturnType<typeof officialProof>) => {
        proof.after.images[0]!.platform = 'linux/arm64';
      },
      (proof: ReturnType<typeof officialProof>) => {
        proof.after.images.pop();
      },
      (proof: ReturnType<typeof officialProof>) => {
        proof.postgres.reference = 'postgres:latest';
      },
    ]) {
      const proof = officialProof();
      mutate(proof);
      expect(() => assertOfficialScaleReleaseProof(proof, officialEnvironment())).toThrow();
    }
  });

  it('attests real image digests/platform/labels, not a caller-supplied runtime SHA', () => {
    const expected = officialRecord().images[0]!;
    const image = {
      Id: expected.id,
      Os: 'linux',
      Architecture: 'amd64',
      RepoDigests: [expected.reference],
      Config: { Labels: { 'org.opencontainers.image.revision': expected.revision } },
    };
    expect(() => assertOfficialScaleImage(image, expected)).not.toThrow();
    for (const changed of [
      { ...image, Id: 'sha256:' + 'f'.repeat(64) },
      { ...image, RepoDigests: [] },
      { ...image, Architecture: 'arm64' },
      { ...image, Config: { Labels: { 'org.opencontainers.image.revision': officialHarnessSha } } },
    ])
      expect(() => assertOfficialScaleImage(changed, expected)).toThrow();
    const reference = 'asa-lab-test:asa-scale-123-1-harness';
    const runner = {
      ...image,
      RepoTags: [reference],
      Config: {
        Labels: {
          'io.asalab.scale.harness': officialHarnessSha,
          'io.asalab.scale.scenario': OFFICIAL_SCALE_SCENARIO.e2eSha256,
        },
      },
    };
    expect(assertOfficialScaleRunner(runner, reference, officialHarnessSha)).toBe(image.Id);
    expect(() =>
      assertOfficialScaleRunner(runner, reference, officialHarnessSha, 'sha256:' + 'e'.repeat(64)),
    ).toThrow();
    expect(() =>
      assertOfficialScaleRunner(runner, reference, OFFICIAL_SCALE_AFTER.revision),
    ).toThrow();
  });

  it('checks actual Web/API/Scratch revision and real schema before and after the workload', () => {
    const manifest = officialRecord().manifest;
    const ready = {
      status: 'ready',
      deployment: {
        revision: manifest.revision,
        schemaVersion: 304,
        expectedSchemaVersion: 304,
        synchronized: true,
      },
    };
    const web = { revision: manifest.revision };
    expect(assertOfficialScaleRuntime(ready, web, manifest.revision, manifest).schema).toBe(304);
    expect(() =>
      assertOfficialScaleRuntime(
        ready,
        { revision: officialHarnessSha },
        manifest.revision,
        manifest,
      ),
    ).toThrow();
    expect(() => assertOfficialScaleRuntime(ready, web, officialHarnessSha, manifest)).toThrow();
    expect(() =>
      assertOfficialScaleRuntime(
        { ...ready, deployment: { ...ready.deployment, schemaVersion: 307 } },
        web,
        manifest.revision,
        manifest,
      ),
    ).toThrow();
    expect(() =>
      assertOfficialScaleRuntime(
        { ...ready, deployment: { ...ready.deployment, synchronized: false } },
        web,
        manifest.revision,
        manifest,
      ),
    ).toThrow();
  });

  it('requires absent official build definitions while preserving runtime origin and network guards', () => {
    const source = ingressConfig();
    const config = {
      ...source,
      services: {
        ...source.services,
        web: { ...source.services.web, build: null },
        scratch: { ...source.services.scratch, build: null },
      },
    };
    expect(() => assertScaleIngressConfig(config, undefined, true)).not.toThrow();
    expect(() => assertScaleIngressConfig(source, undefined, true)).toThrow(/build/);
    config.services.web.environment.ASA_BLOCKS_RUNTIME_ORIGIN = 'http://wrong:8080';
    expect(() => assertScaleIngressConfig(config, undefined, true)).toThrow(
      /ASA_BLOCKS_RUNTIME_ORIGIN/,
    );
    config.services.web.environment.ASA_BLOCKS_RUNTIME_ORIGIN = SCALE_ORIGIN;
    config.services['test-runner'].network_mode = 'host';
    expect(() => assertScaleIngressConfig(config, undefined, true)).toThrow(/network_mode/);
  });

  it('runs calibration2 then exactly full30, retaining FAIL and stopping on invalid calibration', async () => {
    const identity = {
      sourceSha: OFFICIAL_SCALE_BASELINE.revision,
      harnessSha: officialHarnessSha,
      profileHash: SCALE_PROFILE_HASH,
    };
    const run = vi.fn(async (users: number) => ({
      ...identity,
      users,
      status: users === 2 ? 'VALID_FIXTURE' : 'FAIL',
    }));
    const saved = vi.fn();
    const summary = await runOfficialScaleN30(identity, run, saved);
    expect(run.mock.calls.map((args) => args[0])).toEqual([2, 30]);
    expect(summary.levels).toHaveLength(1);
    expect(summary.levels[0]!.status).toBe('FAIL');
    expect(summary.maximumConfirmedUsers).toBe(0);
    expect(summary.absoluteCapacityEstablished).toBe(false);
    const invalid = vi.fn(async (users: number) => ({
      ...identity,
      users,
      status: 'INVALID_FIXTURE',
    }));
    expect((await runOfficialScaleN30(identity, invalid, saved)).levels[0]!.status).toBe('NOT_RUN');
    expect(invalid).toHaveBeenCalledTimes(1);
    await expect(
      runOfficialScaleN30(
        identity,
        async () => ({ ...identity, users: 60, status: 'PASS' }),
        saved,
      ),
    ).rejects.toThrow(/unexpected/);
  });

  it('keeps the new workflow contracts-only for PR/push and native only on canonical explicit main dispatch', async () => {
    const workflow = parseYaml(
      await readFile('.github/workflows/classroom-official-n30.yml', 'utf8'),
    );
    expect(Object.keys(workflow.on).sort()).toEqual(['pull_request', 'push', 'workflow_dispatch']);
    expect(workflow.on.pull_request.paths).toHaveLength(7);
    expect(workflow.on.push.paths).toEqual(workflow.on.pull_request.paths);
    expect(workflow.jobs.native['runs-on']).toBe('ubuntu-latest');
    expect(workflow.jobs.native.if).toBe(
      "github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && github.repository == 'spikeal8-maker/asa-lab'",
    );
    expect(workflow.concurrency['cancel-in-progress']).toBe(false);
    expect(workflow.permissions).toEqual({ contents: 'read', actions: 'read', packages: 'read' });
    const contracts = workflow.jobs.contracts.steps
      .map((step: { run?: string }) => step.run || '')
      .join('\n');
    expect(contracts).toContain('node tools/capacity/classroom-scale.mjs check');
    expect(contracts).not.toMatch(/docker|classroom-scale\.mjs run/);
    expect(Object.keys(workflow.jobs.native.env)).not.toContain('GITHUB_SHA');
    const overlay = await readFile('.github/compose.classroom-scale.yml', 'utf8');
    expect(overlay).not.toMatch(/GH_TOKEN|GITHUB_TOKEN|docker\.sock/);
    expect(overlay).toContain('GITHUB_SHA: ${GITHUB_SHA}');
    const controller = await readFile('tools/capacity/classroom-scale.mjs', 'utf8');
    expect(controller).not.toMatch(
      /latencyProfile|runScaleLadder|DROP DATABASE|'volume',\s*'prune'|down',\s*'-(?:v|-volumes)'/,
    );
    expect(controller).not.toMatch(/(?:env\.)?GITHUB_SHA\s*[:=]/);
    expect(controller).toContain("await compose(['down'])");
    expect(controller).toContain("variant === 'baseline'");
  });

  it('strictly binds migration/API and init/MinIO and isolates reports, volumes and namespaces', () => {
    const release = officialRecord();
    const context = {
      project: 'asa-scale-123-1-baseline',
      runToken: officialRunToken,
      root: '/workspace/asa',
      reports: '/workspace/asa/reports/classroom-official-n30/123-1/baseline',
      runnerReference: 'asa-lab-test:asa-scale-123-1-harness',
    };
    const images = {
      ...release.manifest.images,
      migration: release.manifest.images.api,
      'minio-init': release.manifest.images.minio,
      postgres: OFFICIAL_SCALE_POSTGRES,
      'test-runner': context.runnerReference,
    };
    const configuration = () => ({
      name: context.project,
      services: Object.fromEntries(
        Object.entries(images).map(([name, image]) => [
          name,
          {
            image,
            labels: { 'io.asalab.scale.run': officialRunToken },
            environment:
              name === 'api' ? { ASA_EXPECTED_SCHEMA_VERSION: '304' } : { ASA_SEED_DEV: 'false' },
            volumes:
              name === 'test-runner'
                ? [
                    {
                      type: 'bind',
                      source: context.reports,
                      target: '/workspace/reports/classroom-scale',
                    },
                    {
                      type: 'bind',
                      source: context.reports + '/artifacts',
                      target: '/workspace/e2e/artifacts',
                    },
                  ]
                : name === 'postgres'
                  ? [
                      {
                        type: 'volume',
                        source: 'scale-postgres-data',
                        target: '/var/lib/postgresql/data',
                      },
                    ]
                  : [],
          },
        ]),
      ),
      volumes: {
        'scale-postgres-data': {
          name: context.project + '_scale-postgres-data',
          labels: { 'io.asalab.scale.run': officialRunToken },
        },
      },
      networks: {
        application: {
          name: context.project + '_application',
          labels: { 'io.asalab.scale.run': officialRunToken },
        },
      },
    });
    expect(() => assertOfficialScaleCompose(configuration(), release, context)).not.toThrow();
    for (const service of ['migration', 'minio-init', 'api', 'web', 'scratch']) {
      const config = configuration();
      config.services[service]!.image = context.runnerReference;
      expect(() => assertOfficialScaleCompose(config, release, context)).toThrow();
    }
    expect(() =>
      assertOfficialScaleCompose(configuration(), release, { ...context, project: 'asa-lab-dev' }),
    ).toThrow();
    const foreignVolume = configuration();
    foreignVolume.volumes['scale-postgres-data'].name = 'asa-lab-dev_postgres-data';
    expect(() => assertOfficialScaleCompose(foreignVolume, release, context)).toThrow();
    const sharedReport = configuration();
    sharedReport.services['test-runner']!.volumes[0]!.source = context.reports.replace(
      '/baseline',
      '/after',
    );
    expect(() => assertOfficialScaleCompose(sharedReport, release, context)).toThrow();
    const buildable = configuration();
    Object.assign(buildable.services.api!, { build: { context: '.' } });
    expect(() => assertOfficialScaleCompose(buildable, release, context)).toThrow();
    const foreignNonce = configuration();
    foreignNonce.networks.application.labels['io.asalab.scale.run'] = 'c'.repeat(32);
    expect(() => assertOfficialScaleCompose(foreignNonce, release, context)).toThrow();
  });

  it('preserves ownership and lifetime guards before observing or cleaning a container', () => {
    const image = officialRecord().images[0]!;
    const expected = {
      project: 'asa-scale-123-1-after',
      runToken: officialRunToken,
      root: '/workspace/asa',
      configFiles: '/workspace/asa/compose.yaml,/workspace/asa/.github/compose.classroom-scale.yml',
      images: { api: image },
    };
    const metadata = {
      Id: 'c'.repeat(64),
      Image: image.id,
      Config: {
        Image: image.reference,
        Labels: {
          'com.docker.compose.project': expected.project,
          'com.docker.compose.service': 'api',
          'com.docker.compose.project.working_dir': expected.root,
          'com.docker.compose.project.config_files': expected.configFiles,
          'io.asalab.scale.run': officialRunToken,
        },
      },
    };
    expect(assertOfficialScaleOwnedContainer(metadata, expected).Id).toBe(metadata.Id);
    for (const [key, value] of [
      ['com.docker.compose.project', 'asa-lab-dev'],
      ['com.docker.compose.service', 'unknown'],
      ['com.docker.compose.project.working_dir', '/production'],
      ['com.docker.compose.project.config_files', '/production/compose.yaml'],
      ['io.asalab.scale.run', 'd'.repeat(32)],
    ]) {
      const changed = {
        ...metadata,
        Config: { ...metadata.Config, Labels: { ...metadata.Config.Labels, [key!]: value } },
      };
      expect(() => assertOfficialScaleOwnedContainer(changed, expected)).toThrow();
    }
    expect(() =>
      assertOfficialScaleOwnedContainer(
        { ...metadata, Image: 'sha256:' + 'd'.repeat(64) },
        expected,
      ),
    ).toThrow();
  });

  it('uses canonical CI/discovery/pulls and never produces a proof after failed CI', () => {
    const script = String.raw`
import copy, importlib.util, json, pathlib, sys, tempfile
from unittest.mock import patch
spec = importlib.util.spec_from_file_location('n30_release', 'tools/capacity/classroom-scale-release.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
env = json.load(sys.stdin)
env['GH_TOKEN'] = 'synthetic-contract-value'
assert m.dispatch_identity(env)['harnessSha'] == env['GITHUB_SHA']
assert m.after_selector(env) == m.AFTER
for key, value in [('GITHUB_EVENT_NAME','pull_request'), ('RUNNER_ENVIRONMENT','self-hosted'), ('GH_TOKEN',''), ('GITHUB_SHA',m.BASELINE['revision'])]:
    bad = dict(env, **{key:value})
    try: m.dispatch_identity(bad)
    except m.Blocked: pass
    else: raise AssertionError('native event boundary accepted')
def manifest(selected):
    return dict(format='asa-deployment-v2', repository='spikeal8-maker/asa-lab', revision=selected['revision'],
                schema=selected['schema'], platform='linux/amd64', publicationRunId=1234,
                images={s:f'ghcr.io/spikeal8-maker/asa-lab/{s}@sha256:'+'1'*64 for s in m.SERVICES})
for fail_at in (None, 'harness-ci', 'baseline-ci', 'after-ci'):
    calls=[]
    def mark(stage):
        calls.append(stage)
        if stage == fail_at: raise m.Blocked('CI_BLOCKED','synthetic failure','stop')
    def general(revision):
        assert revision == env['GITHUB_SHA']
        mark('harness-ci')
    def discover(digest):
        selected = m.BASELINE if digest == m.BASELINE['deploymentDigest'] else m.AFTER
        assert digest == selected['deploymentDigest']
        mark('baseline-discover' if selected == m.BASELINE else 'after-discover')
        return manifest(selected)
    def ci(release): mark('baseline-ci' if release['revision'] == m.BASELINE['revision'] else 'after-ci')
    def fetch(release):
        assert 'baseline-ci' in calls and 'after-ci' in calls
        mark('fetch-'+release['revision'])
    def run(args, **kwargs):
        if args[:3] == ['git','rev-parse','HEAD']: return env['GITHUB_SHA']
        if args[:2] == ['git','status']: return ''
        if args[:3] == ['docker','context','inspect']:
            return json.dumps([dict(Name='default', Endpoints=dict(docker=dict(Host='unix:///var/run/docker.sock')))])
        assert args == ['docker','pull','--platform','linux/amd64',m.POSTGRES]
        mark('postgres-pull')
    def attest(service, reference, revision=None):
        return dict(service=service, reference=reference, id='sha256:'+'1'*64, platform='linux/amd64', revision=revision or '')
    with tempfile.TemporaryDirectory(prefix='asa-n30-contract-') as tmp:
        root=pathlib.Path(tmp)
        (root/'e2e').mkdir()
        (root/'e2e/classroom-scale.spec.ts').write_bytes((m.ROOT/'e2e/classroom-scale.spec.ts').read_bytes())
        with patch.object(m,'run',run), patch.object(m,'assert_general_ci',general), patch.object(m,'discover_release',discover), patch.object(m,'assert_ci',ci), patch.object(m,'fetch_images',fetch), patch.object(m,'attest_image',attest), patch.object(m.platform,'system',lambda:'Linux'), patch.object(m.platform,'node',lambda:'hosted-contract'):
            try: result=m.prepare(env,root)
            except m.Blocked:
                assert fail_at is not None
                assert not any(c.startswith('fetch-') for c in calls)
                assert not list(root.rglob('releases.json'))
            else:
                assert fail_at is None
                assert calls[:5] == ['harness-ci','baseline-discover','baseline-ci','after-discover','after-ci']
                assert result['baseline']['manifest']['schema'] == result['after']['manifest']['schema'] == 304
                assert result['harnessSha'] == env['GITHUB_SHA'] != result['baseline']['manifest']['revision']
image={'Id':'sha256:'+'2'*64,'Os':'linux','Architecture':'amd64','RepoDigests':[m.POSTGRES],'Config':{'Labels':{}}}
with patch.object(m,'run',lambda *a,**kw:json.dumps([image])):
    assert m.attest_image('postgres',m.POSTGRES)['id'] == image['Id']
    for key,value in [('RepoDigests',[]),('Architecture','arm64'),('Id','tag')]:
        bad=copy.deepcopy(image);bad[key]=value
        with patch.object(m,'run',lambda *a,**kw:json.dumps([bad])):
            try: m.attest_image('postgres',m.POSTGRES)
            except m.Blocked: pass
            else: raise AssertionError('false image proof accepted')
print(json.dumps({'baseline':m.BASELINE,'after':m.AFTER,'scenario':m.SCENARIO_SHA256,'status':'PASS'}))
`;
    const output = execFileSync('python3', ['-B', '-c', script], {
      encoding: 'utf8',
      input: JSON.stringify(officialEnvironment()),
      timeout: 15000,
    });
    const result = JSON.parse(output.trim().split('\n').at(-1)!);
    expect(result).toEqual({
      baseline: OFFICIAL_SCALE_BASELINE,
      after: OFFICIAL_SCALE_AFTER,
      scenario: OFFICIAL_SCALE_SCENARIO.e2eSha256,
      status: 'PASS',
    });
  });
});
