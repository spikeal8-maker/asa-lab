// @vitest-environment jsdom
import '../../apps/web/src/blocks/preview-env.d.ts';
import { writeFileSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import {
  isAllowedMutationOrigin,
  resolveCanonicalWebOrigin,
  resolveIsolatedTestWebOrigin,
} from '../../apps/api/src/origin-policy';
import { PortalHeader } from '../../apps/web/src/components/PortalHeader';
import { studentSessionPayload } from '../../apps/web/src/creator-portal/student-session';
import {
  SCALE_LEVELS,
  SCALE_ORIGIN,
  SCALE_CRYPTO_CHALLENGE,
  SCALE_PROFILE,
  SCALE_PROFILE_HASH,
  SCALE_PROJECTS_LINK_SELECTOR,
  assertLatencySample,
  assertLatencyScenario,
  assertPriorScaleLevels,
  assertScaleDockerContext,
  assertScaleEnvironment,
  assertScaleImages,
  assertScaleIngressConfig,
  assertScaleApiIngressEnvironment,
  summarizeScaleApiEnvironment,
  SCALE_API_ENV_PROBE_SCRIPT,
  assertScaleDriverNetwork,
  assertScaleSecureContext,
  validateScaleSecureContexts,
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
