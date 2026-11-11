// Offline safety/protocol checks only. No PostgreSQL, containers or servers start.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';
import { parse } from 'yaml';
import { FixtureError, probeCases } from './ci1093-pg-latency-fixtures.mjs';
import {
  caseLabels,
  diagnosticBranch,
  explainMetadata,
  isolatedConfig,
  measureCases,
  postgresImage,
  resultDigest,
  safeError,
  safeFunctionConfig,
  serviceMetadata,
  verifyConnection,
} from './learning-e1-pg-plan-probe.mjs';

const env = {
  CI: 'true',
  GITHUB_ACTIONS: 'true',
  ASA_E1_PG_PLAN_PROBE: 'ci1093-isolated-read-only',
  GITHUB_EVENT_NAME: 'push',
  GITHUB_REF: `refs/heads/${diagnosticBranch}`,
  GITHUB_REPOSITORY: 'spikeal8-maker/asa-lab',
  GITHUB_JOB: 'pg-jit-probe',
  GITHUB_WORKFLOW_REF: `spikeal8-maker/asa-lab/.github/workflows/ci1093-pg-jit-probe.yml@refs/heads/${diagnosticBranch}`,
  GITHUB_SHA: 'a'.repeat(40),
  GITHUB_RUN_ID: '123',
  GITHUB_RUN_ATTEMPT: '1',
  TEST_DATABASE_URL: 'postgres://asalab_admin:synthetic-test-only@127.0.0.1:5432/asa_ci1093_test',
  APP_TEST_DATABASE_URL: 'postgres://asalab_app:synthetic-test-only@127.0.0.1:5432/asa_ci1093_test',
  ASA_CI1093_EVIDENCE_DIR: '/tmp/ci1093-offline-test',
  ASA_CI1093_PG_CONTAINER_ID: 'b'.repeat(64),
};

test('requires exact diagnostic CI/event/repository/branch/job/source identity before clients exist', () => {
  for (const key of [
    'CI',
    'GITHUB_ACTIONS',
    'ASA_E1_PG_PLAN_PROBE',
    'GITHUB_EVENT_NAME',
    'GITHUB_REF',
    'GITHUB_REPOSITORY',
    'GITHUB_JOB',
    'GITHUB_WORKFLOW_REF',
    'GITHUB_SHA',
    'GITHUB_RUN_ID',
    'GITHUB_RUN_ATTEMPT',
  ])
    assert.throws(() => isolatedConfig({ ...env, [key]: '' }), /diagnostic_ci_flag_required/);
  assert.throws(() => isolatedConfig({ ...env, GITHUB_EVENT_NAME: 'pull_request' }));
  assert.throws(() => isolatedConfig({ ...env, GITHUB_REF: 'refs/heads/main' }));
  assert.throws(() => isolatedConfig({ ...env, ASA_CI1093_EVIDENCE_DIR: 'relative' }));
  assert.throws(() => isolatedConfig({ ...env, ASA_CI1093_PG_CONTAINER_ID: 'wrong' }));
});

test('allows only exact disposable loopback URLs with dedicated admin/runtime roles', () => {
  assert.equal(isolatedConfig(env).database, 'asa_ci1093_test');
  for (const url of [
    'postgres://asalab_app:secret-value@127.0.0.1:5432/asalab',
    'postgres://asalab_app:secret-value@remote.invalid:5432/asa_ci1093_test',
    'postgres://asalab_app:secret-value@127.0.0.1:5432/another_test',
    'postgres://asalab_admin:secret-value@127.0.0.1:5432/asa_ci1093_test',
    'postgres://asalab_app:secret-value@127.0.0.1:5432/asa_ci1093_test?options=unsafe',
    'postgres://asalab_app:secret-value@127.0.0.1:5432/%61sa_ci1093_test',
    'postgres://asalab_app:secret-value@127.0.0.1:5433/asa_ci1093_test',
    'postgres://asalab_app@127.0.0.1:5432/asa_ci1093_test',
    'invalid-secret-url',
  ])
    assert.throws(
      () => isolatedConfig({ ...env, APP_TEST_DATABASE_URL: url }),
      /isolated_urls_required/,
    );
  assert.throws(() => isolatedConfig({ ...env, TEST_DATABASE_URL: env.APP_TEST_DATABASE_URL }));
});

test('measured runtime rejects role switching, owner/privileged membership, writable or changing isolation', () => {
  const actual = {
    database: 'asa_ci1093_test',
    sessionRole: 'asalab_app',
    currentRole: 'asalab_app',
    readOnly: true,
    repeatableRead: true,
    privileged: false,
    ownerMember: false,
  };
  verifyConnection(actual, 'asa_ci1093_test', true);
  for (const change of [
    { database: 'asalab' },
    { sessionRole: 'asalab_admin' },
    { currentRole: 'asalab_admin' },
    { readOnly: false },
    { repeatableRead: false },
    { privileged: true },
    { ownerMember: true },
  ])
    assert.throws(() => verifyConnection({ ...actual, ...change }, 'asa_ci1093_test', true));
  verifyConnection(
    { ...actual, readOnly: false, repeatableRead: false },
    'asa_ci1093_test',
    true,
    false,
  );
});

test('hash compares SQL row multisets while preserving JSON array order, duplicates and null', () => {
  const first = [{ data: { a: 1, b: [2, 3] } }, { data: { a: 2 } }];
  assert.equal(
    resultDigest(first),
    resultDigest([{ data: { a: 2 } }, { data: { b: [2, 3], a: 1 } }]),
  );
  assert.notEqual(resultDigest(first), resultDigest([{ data: { a: 1, b: [3, 2] } }, first[1]]));
  assert.notEqual(resultDigest(first), resultDigest([...first, first[0]]));
  assert.notEqual(resultDigest([{ data: null }]), resultDigest([]));
});

test('EXPLAIN preserves only finite numeric plan/JIT fields and states nested visibility limitation', () => {
  const sentinel = 'secret-sql-id-row-password';
  const result = explainMetadata([
    {
      'Planning Time': 4.1,
      'Execution Time': 8.2,
      Plan: {
        'Node Type': sentinel,
        'Total Cost': 100,
        'Plan Rows': sentinel,
        'Actual Rows': 2,
        'Shared Read Blocks': Infinity,
        Filter: sentinel,
        Output: [sentinel],
        Plans: [{ 'Total Cost': 7, 'Actual Rows': 1, 'Relation Name': sentinel }],
      },
      Settings: { role: sentinel },
      JIT: { Functions: 3, Timing: { Generation: 1, Total: 2, Secret: sentinel } },
      Query: sentinel,
    },
  ]);
  assert.equal(JSON.stringify(result).includes(sentinel), false);
  assert.deepEqual(result, {
    planningMs: 4.1,
    executionMs: 8.2,
    nodes: [
      { index: 0, parent: -1, depth: 0, totalCost: 100, actualRows: 2 },
      { index: 1, parent: 0, depth: 1, totalCost: 7, actualRows: 1 },
    ],
    jitMetadataPresent: 1,
    jitFunctions: 3,
    jitGenerationMs: 1,
    jitTotalMs: 2,
    nestedStatementsInstrumented: 0,
  });
  assert.equal(explainMetadata([{ Plan: {} }]).jitMetadataPresent, 0);
  assert.throws(
    () => explainMetadata([{ Plan: { Plans: Array(128).fill({}) } }]),
    /explain_size_rejected/,
  );
  assert.throws(() => explainMetadata([{ Query: sentinel }]), /explain_shape_rejected/);
});

test('function overrides and errors never serialize unapproved settings or database messages', () => {
  assert.deepEqual(safeFunctionConfig(null), null);
  assert.deepEqual(
    safeFunctionConfig([
      'jit=off',
      'jit_above_cost=100000',
      'search_path=pg_catalog, pg_temp',
      'TimeZone=UTC',
      'app.secret=password',
      'search_path=private_secret',
    ]),
    [
      'jit=off',
      'jit_above_cost=100000',
      'search_path=pg_catalog, pg_temp',
      'TimeZone=UTC',
      '[redacted setting]',
      '[redacted setting]',
    ],
  );
  assert.deepEqual(
    safeError(
      Object.assign(new Error('postgres://secret:password@host'), {
        code: '42501',
        detail: 'secret row',
      }),
    ),
    { reason: 'database_or_probe_error', sqlState: '42501' },
  );
  assert.deepEqual(safeError(new FixtureError('fixture_quiz_key_leak')), {
    reason: 'fixture_quiz_key_leak',
    sqlState: null,
  });
});

test('service attestation requires the owned full ID, live pinned image and exact loopback binding without exporting env', () => {
  const config = isolatedConfig(env);
  const binding = { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '5432' }] };
  const inspected = {
    Id: config.containerId,
    State: { Running: true },
    Image: `sha256:${'c'.repeat(64)}`,
    Config: {
      Image: postgresImage,
      Env: ['POSTGRES_PASSWORD=do-not-export-this-value'],
      Labels: {
        'org.asalab.ci1093.purpose': 'pg-jit-probe',
        'org.asalab.ci1093.source': config.sha,
        'org.asalab.ci1093.run': config.runId,
        'org.asalab.ci1093.attempt': config.attempt,
      },
    },
    HostConfig: {
      PortBindings: binding,
      NanoCpus: 0,
      CpuQuota: 0,
      CpuPeriod: 0,
      Memory: 0,
      CpuShares: 0,
      CpusetCpus: '',
    },
    NetworkSettings: { Ports: binding },
  };
  const recorded = serviceMetadata(inspected, config);
  assert.equal(JSON.stringify(recorded).includes('do-not-export-this-value'), false);
  assert.deepEqual(recorded.port_binding, binding);
  for (const bad of [
    { ...inspected, Id: 'd'.repeat(64) },
    { ...inspected, State: { Running: false } },
    { ...inspected, Config: { ...inspected.Config, Image: 'postgres:latest' } },
    { ...inspected, Config: { ...inspected.Config, Labels: {} } },
    {
      ...inspected,
      HostConfig: {
        ...inspected.HostConfig,
        PortBindings: { '5432/tcp': [{ HostIp: '0.0.0.0', HostPort: '5432' }] },
      },
    },
    {
      ...inspected,
      NetworkSettings: { Ports: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '15432' }] } },
    },
  ])
    assert.throws(
      () => serviceMetadata(bad, config),
      /postgres_service_image_or_ownership_rejected/,
    );
  assert.throws(() => isolatedConfig({ ...env, ASA_CI1093_PG_CONTAINER_ID: 'b'.repeat(12) }));
});

function fakeProtocol({
  drift = false,
  changedPayload = false,
  jitAvailable = true,
  ignoreJit = false,
} = {}) {
  const calls = [];
  const samples = [];
  const plans = [];
  const cases = caseLabels.map((label, index) => ({
    label,
    role: index === 0 ? 'admin' : 'runtime',
    sql: `SELECT reader_${index}`,
    args: Object.freeze([index]),
    validate: (rows) => assert.equal(rows.length, 1),
    itemCount: (rows) => rows.length,
  }));
  function client(role) {
    let jit = 'on';
    let snapshotReads = 0;
    let samplesRead = 0;
    return {
      async query(sql, args) {
        calls.push({ role, sql, args });
        if (sql.startsWith('SET LOCAL jit')) {
          if (!ignoreJit) jit = sql.endsWith('on') ? 'on' : 'off';
          return { rows: [] };
        }
        if (sql.includes('AS server_version_num'))
          return {
            rows: [
              {
                server_version_num: 170007,
                server_version: '17.7',
                jit,
                jit_available: jitAvailable,
                jit_above_cost: 100000,
                jit_inline_above_cost: 500000,
                jit_optimize_above_cost: 500000,
              },
            ],
          };
        if (sql.includes('pg_current_snapshot'))
          return {
            rows: [
              {
                snapshot: drift && ++snapshotReads > 2 ? 'changed' : 'snapshot',
                time: 'same-time',
                pid: role === 'admin' ? 1 : 2,
              },
            ],
          };
        if (sql.startsWith('EXPLAIN'))
          return {
            rows: [{ 'QUERY PLAN': [{ Plan: { 'Actual Rows': 1 }, 'Execution Time': 1 }] }],
          };
        samplesRead++;
        return {
          rows: [{ data: changedPayload && jit === 'off' ? `changed-${samplesRead}` : args[0] }],
        };
      },
    };
  }
  const inputs = {
    clients: { admin: client('admin'), runtime: client('runtime') },
    cases,
    onSample: (sample) => samples.push(sample),
    onPlan: (plan) => plans.push(plan),
    onContext: () => {},
  };
  return { inputs, calls, samples, plans };
}

test('protocol performs exactly 28 unchanged-payload reads plus 14 plans using fixed clients/args', async () => {
  const f = fakeProtocol();
  const result = await measureCases(f.inputs);
  assert.deepEqual(result, {
    stable_snapshot: true,
    stable_transaction_time: true,
    stable_connection: true,
    jit_available: true,
  });
  assert.equal(f.samples.length, 28);
  assert.equal(f.plans.length, 14);
  for (const entry of f.inputs.cases) {
    assert.deepEqual(
      f.samples.filter((sample) => sample.label === entry.label).map((sample) => sample.jit),
      ['on', 'off', 'on', 'off'],
    );
    const reads = f.calls.filter(
      (call) => call.sql === entry.sql || call.sql.endsWith(` ${entry.sql}`),
    );
    assert.equal(reads.length, 6);
    assert(reads.every((call) => call.role === entry.role && call.args === entry.args));
  }
  assert(
    f.samples.every(
      (sample) =>
        sample.equal && /^[a-f0-9]{64}$/.test(sample.payload_sha256) && sample.client_wall_ms >= 0,
    ),
  );
});

test('protocol fails on payload drift, snapshot change, ignored jit or unavailable JIT', async () => {
  for (const [options, reason] of [
    [{ changedPayload: true }, /result_mismatch/],
    [{ drift: true }, /transaction_context_changed/],
    [{ ignoreJit: true }, /jit_settings_changed_unexpectedly/],
    [{ jitAvailable: false }, /jit_unavailable/],
  ])
    await assert.rejects(measureCases(fakeProtocol(options).inputs), reason);
  const f = fakeProtocol();
  await assert.rejects(
    measureCases({ ...f.inputs, cases: f.inputs.cases.slice(1) }),
    /seven_reader_protocol_required/,
  );
});

function fixturesForValidation() {
  const base = {
    classId: 'class',
    seatId: 'seat',
    principalId: 'principal',
    learnerId: 'learner',
    accountId: 'account',
    teacherAccountId: 'teacher',
    assignmentId: 'assignment',
    runId: 'run',
    attemptId: 'attempt',
  };
  const fixtures = {
    ai: { ...base },
    quiz: { ...base },
    file: { ...base, reworkAttemptId: 'rework-attempt' },
  };
  const evidence = {
    kind: 'quiz',
    classroomId: 'class',
    seatId: 'seat',
    principalId: 'principal',
    learnerId: 'learner',
    accountId: 'account',
    classroomAssignmentId: 'assignment',
    activityRunId: 'run',
    identityResolution: 'learner_identity',
    assignmentStatus: 'open',
    attempt: { id: 'attempt', submittedAt: '2026-11-12T00:00:00Z' },
    selectedRevision: {
      id: 'revision',
      attemptId: 'attempt',
      rawPoints: null,
      maxPoints: null,
      percentageBasisPoints: null,
      outcome: null,
      completionValue: null,
    },
  };
  return { cases: probeCases(fixtures), evidence };
}

test('real fixture validators reject empty/foreign results, null AI rating, leaked Quiz feedback and replacement File draft', () => {
  const { cases, evidence } = fixturesForValidation();
  assert.deepEqual(
    cases.map((entry) => entry.label),
    caseLabels,
  );
  for (const entry of cases) {
    assert.throws(() => entry.validate([]));
    assert(Object.isFrozen(entry.args));
  }
  const aiMetrics = [
    {
      item: {
        seatId: 'seat',
        score: 0,
        rank: 1,
        totalWorks: 0,
        sources: { projects: 0, logins: 0, days: 0, time: 0, grades: 0 },
      },
    },
  ];
  cases[0].validate(aiMetrics);
  assert.throws(() => cases[0].validate([{ item: { ...aiMetrics[0].item, score: null } }]));
  cases[1].validate([{ value: { canGenerate: true, reason: null, rating: 0, minimumRating: 0 } }]);
  assert.throws(() =>
    cases[1].validate([
      { value: { canGenerate: true, reason: null, rating: null, minimumRating: 0 } },
    ]),
  );
  for (const entry of cases.slice(2, 4)) {
    entry.validate([{ evidence }]);
    assert.throws(() =>
      entry.validate([{ evidence: { ...evidence, accountId: 'other-account' } }]),
    );
    assert.throws(() => entry.validate([{ evidence: { ...evidence, answerKey: 'b' } }]));
    assert.throws(() =>
      entry.validate([
        {
          evidence: {
            ...evidence,
            selectedRevision: { ...evidence.selectedRevision, rawPoints: 1 },
          },
        },
      ]),
    );
  }
  const teacher = {
    ...evidence,
    selectedRevision: {
      ...evidence.selectedRevision,
      rawPoints: 1,
      maxPoints: 1,
      percentageBasisPoints: 10000,
      completionValue: true,
    },
  };
  cases[4].validate([{ evidence: teacher }]);
  assert.throws(() => cases[4].validate([{ evidence }]));
  const history = {
    ...evidence,
    kind: 'file',
    assignmentStatus: 'closed',
    attempt: { ...evidence.attempt, state: 'closed', reviewDecision: 'changes_requested' },
  };
  for (const entry of cases.slice(5)) {
    entry.validate([{ evidence: history }]);
    assert.throws(() =>
      entry.validate([
        { evidence: { ...history, attempt: { ...history.attempt, id: 'rework-attempt' } } },
      ]),
    );
    assert.throws(() =>
      entry.validate([{ evidence: { ...history, pendingDraft: 'rework-attempt' } }]),
    );
  }
});

test('temporary workflow uses only its branch, exact source, frozen dependencies and current General PG pin', () => {
  const workflow = parse(
    readFileSync(
      new URL('../../.github/workflows/ci1093-pg-jit-probe.yml', import.meta.url),
      'utf8',
    ),
  );
  const general = JSON.parse(
    readFileSync(
      new URL(
        '../../docs/product/projects/evidence/ci-node-transport-429-receipt.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  assert.deepEqual(workflow.on, { push: { branches: [diagnosticBranch] } });
  assert.deepEqual(Object.keys(workflow.jobs), ['pg-jit-probe']);
  assert.equal(workflow.jobs['pg-jit-probe'].env.ASA_CI1093_PG_IMAGE, postgresImage);
  assert.equal(general.images.postgres.reference, postgresImage);
  const steps = workflow.jobs['pg-jit-probe'].steps;
  assert.equal(steps[0].with.ref, '${{ github.sha }}');
  assert.equal(steps[0].with['persist-credentials'], false);
  assert(steps.some((step) => step.run === 'corepack pnpm install --frozen-lockfile'));
  const upload = steps.find((step) => step.uses === 'actions/upload-artifact@v4');
  assert.equal(upload.if, 'always()');
  assert.equal(upload.with.name, 'ci1093-pg-jit-${{ github.sha }}-${{ github.run_attempt }}');
  assert.equal(upload.with.path.trim().split('\n').length, 5);
});

test('job-level env context availability rejects runner before a runner is assigned', () => {
  // GitHub's Context availability table, not YAML syntax, defines these scopes:
  // https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#context-availability
  const jobEnvContexts = new Set([
    'github',
    'needs',
    'strategy',
    'matrix',
    'vars',
    'secrets',
    'inputs',
  ]);
  const stepContexts = new Set([...jobEnvContexts, 'job', 'runner', 'env', 'steps']);
  const knownContexts = new Set([...stepContexts, 'jobs']);
  function unavailableContexts(values, allowed) {
    const unavailable = new Set();
    for (const value of Object.values(values)) {
      for (const expression of String(value).matchAll(/\$\{\{([\s\S]*?)\}\}/g)) {
        // Single-quoted expression literals are not context references. A root
        // after a dot is a property, whereas bare roots and index syntax count.
        const source = expression[1].replace(/'(?:[^']|'')*'/g, "''");
        for (const reference of source.matchAll(/(?<![.\w-])([A-Za-z_][\w-]*)(?![\w-])/g)) {
          if (knownContexts.has(reference[1]) && !allowed.has(reference[1]))
            unavailable.add(reference[1]);
        }
      }
    }
    return [...unavailable].sort();
  }
  assert.deepEqual(
    unavailableContexts({ DIRECTORY: '${{ runner.temp }}/ci1093-pg-jit' }, jobEnvContexts),
    ['runner'],
  );
  assert.deepEqual(
    unavailableContexts(
      { DIRECTORY: "${{ runner['temp'] }}", SNAPSHOT: '${{ toJSON(runner) }}' },
      jobEnvContexts,
    ),
    ['runner'],
  );
  assert.deepEqual(
    unavailableContexts(
      {
        SOURCE: '${{ github.sha }}',
        INPUT: '${{ needs.prepare.outputs.directory }}',
        LITERAL: "${{ format('runner.temp', github.sha) }}",
      },
      jobEnvContexts,
    ),
    [],
  );
  assert.deepEqual(
    unavailableContexts({ DIRECTORY: '${{ runner.temp }}/ci1093-pg-jit' }, stepContexts),
    [],
  );

  const workflow = parse(
    readFileSync(
      new URL('../../.github/workflows/ci1093-pg-jit-probe.yml', import.meta.url),
      'utf8',
    ),
  );
  for (const [id, job] of Object.entries(workflow.jobs)) {
    assert.deepEqual(
      unavailableContexts(job.env ?? {}, jobEnvContexts),
      [],
      `Unavailable context in jobs.${id}.env`,
    );
    for (const step of job.steps) {
      assert.deepEqual(unavailableContexts(step.env ?? {}, stepContexts), []);
      assert.deepEqual(unavailableContexts(step.with ?? {}, stepContexts), []);
    }
  }
});
