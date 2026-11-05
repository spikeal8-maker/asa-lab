import { describe, expect, it } from 'vitest';
import { resolveIsolatedTestWebOrigin } from '../../apps/api/src/origin-policy';
import {
  SCALE_LEVELS,
  SCALE_PROFILE,
  SCALE_PROFILE_HASH,
  assertLatencySample,
  assertLatencyScenario,
  assertPriorScaleLevels,
  assertScaleDockerContext,
  assertScaleEnvironment,
  assertScaleImages,
  createScaleLedger,
  evaluateScaleLevel,
  evaluateScaleCalibration,
  readScaleMemInfo,
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
    ASA_E2E_BASE_URL: 'http://web:8080',
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
    networkFailures: [],
    accountControl: { status: 'VERIFIED' },
    observerRequests: [],
    games: { chessInvitations: 1, checkersInvitations: 1, chessMatches: 1, checkersMatches: 1 },
    browserSamples: [{ chromiumProcesses: users + 5, chromiumRssBytes: 1024 * 1024 }],
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
      { error: 'net::ERR_TIMED_OUT', phase: 'portal', method: 'GET', navigationWindow: false },
      { error: 'net::ERR_ABORTED', phase: 'portal', method: 'PUT', navigationWindow: true },
    ]) {
      expect(
        evaluateScaleLevel(
          { ...base, networkFailures: [{ ...failure, expected: true }] },
          identity,
          [resource()],
        ).status,
      ).toBe('INVALID');
      expect(
        evaluateScaleLevel(
          { ...base, networkFailures: [{ ...failure, expected: false }] },
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
