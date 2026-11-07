import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  base,
  branch,
  definitions,
  validateEnvironment,
  sourceBody,
  bindBody,
  sanitized,
  canonicalPreparation,
  canonicalWorkflow,
  workflow,
  prefixTitles,
  validatePrefixReports,
  verifyGeneratedChanges,
  selectLinkedTarget,
  linkedTargetSql,
  validateLinkedTarget,
  validateLinkedRead,
  validateStableMeasurements,
  validateLinkedTrace,
} from './learning-origin-list-diagnostic.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const valid = () => ({
  GITHUB_ACTIONS: 'true',
  RUNNER_OS: 'Linux',
  RUNNER_ENVIRONMENT: 'github-hosted',
  GITHUB_REPOSITORY: 'spikeal8-maker/asa-lab',
  GITHUB_EVENT_NAME: 'pull_request',
  GITHUB_HEAD_REF: branch,
  GITHUB_WORKFLOW: 'Learning origin list prefix diagnostic',
  GITHUB_JOB: 'origin-list-prefix-diagnostic',
  GITHUB_WORKFLOW_REF:
    'spikeal8-maker/asa-lab/.github/workflows/learning-origin-prefix-diagnostic.yml@refs/pull/1015/merge',
  ASA_DIAGNOSTIC_SOURCE_SHA: base,
  GITHUB_RUN_ID: '42187703384',
  GITHUB_RUN_ATTEMPT: '1',
  ASA_DIAGNOSTIC_BROWSER_OUTCOME: 'failure',
  ASA_DIAGNOSTIC_BATCH: 'first',
  TEST_DATABASE_URL:
    'postgresql://postgres:synthetic-ci-password@127.0.0.1:5432/asa_learning_e1_test',
  APP_TEST_DATABASE_URL:
    'postgresql://asalab_app:synthetic-ci-password@127.0.0.1:5432/asa_learning_e1_test',
});

test('accepts only the explicit disposable CI role pair', () => {
  const env = valid();
  assert.deepEqual(validateEnvironment(env), {
    admin: env.TEST_DATABASE_URL,
    app: env.APP_TEST_DATABASE_URL,
  });
});

test('accepts a completed successful prefix without claiming full E1', () => {
  const env = { ...valid(), ASA_DIAGNOSTIC_BROWSER_OUTCOME: 'success' };
  assert.equal(validateEnvironment(env).app, env.APP_TEST_DATABASE_URL);
});

for (const [key, value] of [
  ['GITHUB_ACTIONS', 'false'],
  ['RUNNER_OS', 'Windows'],
  ['RUNNER_ENVIRONMENT', 'self-hosted'],
  ['GITHUB_REPOSITORY', 'another/asa-lab'],
  ['GITHUB_EVENT_NAME', 'push'],
  ['GITHUB_HEAD_REF', 'main'],
  ['GITHUB_WORKFLOW', 'Learning E1 Convergence'],
  ['GITHUB_JOB', 'learning-e1-batch'],
  [
    'GITHUB_WORKFLOW_REF',
    'spikeal8-maker/asa-lab/.github/workflows/learning-e1-focused.yml@refs/pull/1015/merge',
  ],
  ['ASA_DIAGNOSTIC_SOURCE_SHA', 'main'],
  ['GITHUB_RUN_ID', '0'],
  ['GITHUB_RUN_ATTEMPT', '0'],
  ['GITHUB_RUN_ATTEMPT', '2'],
  ['ASA_DIAGNOSTIC_BROWSER_OUTCOME', 'skipped'],
  ['ASA_DIAGNOSTIC_BROWSER_OUTCOME', 'cancelled'],
  ['ASA_DIAGNOSTIC_BROWSER_OUTCOME', 'in_progress'],
  ['ASA_DIAGNOSTIC_BATCH', 'second'],
]) {
  test('refuses altered execution context: ' + key, () => {
    assert.throws(() => validateEnvironment({ ...valid(), [key]: value }));
  });
}

for (const address of [
  'postgresql://postgres:synthetic-ci-password@asa-lab.ru:5432/asa_learning_e1_test',
  'postgresql://postgres:synthetic-ci-password@127.0.0.1:5432/asalab',
  'postgresql://postgres:synthetic-ci-password@127.0.0.1:5432/another_test',
  'postgresql://postgres:synthetic-ci-password@127.0.0.1:5433/asa_learning_e1_test',
  'postgresql://asalab_app:synthetic-ci-password@127.0.0.1:5432/asa_learning_e1_test',
  'postgresql://postgres@127.0.0.1:5432/asa_learning_e1_test',
  'postgresql://postgres:synthetic-ci-password@127.0.0.1:5432/asa_learning_e1_test?options=-c%20jit=off',
  'postgresql://postgres:synthetic-ci-password@127.0.0.1:5432/asa_learning_e1_test#other',
  'invalid connection string',
]) {
  test('refuses database boundary drift: ' + address.split('@').at(-1), () => {
    assert.throws(() => validateEnvironment({ ...valid(), TEST_DATABASE_URL: address }));
  });
}

test('refuses an administrative application connection', () => {
  const env = valid();
  assert.throws(() =>
    validateEnvironment({ ...env, APP_TEST_DATABASE_URL: env.TEST_DATABASE_URL }),
  );
});

test('canonical workload, limits, matrix and assertions remain byte-identical', () => {
  const filename = canonicalWorkflow;
  const original = execFileSync('git', ['show', base + ':' + filename], {
    cwd: root,
    encoding: 'utf8',
  });
  const current = fs.readFileSync(path.join(root, filename), 'utf8');
  assert.equal(current, original);
  const diagnostic = fs.readFileSync(path.join(root, workflow), 'utf8');
  assert.ok(diagnostic.includes(canonicalPreparation(original)));
  assert.ok(
    diagnostic.includes(
      "always() && !cancelled() && (steps.browser.outcome == 'success' || steps.browser.outcome == 'failure')",
    ),
  );
  assert.ok(
    diagnostic.includes(
      'run: pnpm exec playwright test e2e/courses-sharing.spec.ts --workers=1 --reporter=list,json --output reports/playwright/origin-prefix/results',
    ),
  );
  assert.ok(diagnostic.includes('test ! -e reports/playwright/origin-prefix'));
  assert.equal((diagnostic.match(/pnpm exec playwright test/g) ?? []).length, 2);
  assert.doesNotMatch(
    diagnostic,
    /continue-on-error|node tools\/testing\/learning-e1-browser\.mjs/,
  );
  assert.ok(diagnostic.includes("full_e1='NOT_RUN'"));
});

test('reviewed SQL, runtime settings, role checks, locks and rollbacks are unchanged', () => {
  const source = fs.readFileSync(
    path.join(root, 'tools/testing/learning-origin-list-diagnostic.mjs'),
    'utf8',
  );
  const start = source.indexOf("    const { default: pg } = await import('pg');");
  const end = source.indexOf('    record.linkedAccess = await captureLinkedAccess(', start);
  assert.ok(start >= 0 && end > start);
  assert.equal(
    createHash('sha256').update(source.slice(start, end)).digest('hex'),
    '10933cab7c3a98147c09ccd09f8bb16e8745ad90f78725c92bb18e333a15990f',
  );
});

test('linked diagnostic changes only the depth needed to retain the pinned ancestor', () => {
  const previous = execFileSync(
    'git',
    ['show', '1fd0cc2c0ac3aead713cf51231419990ae8927cb:' + workflow],
    { cwd: root, encoding: 'utf8' },
  );
  const fetch = 'git fetch --no-tags --depth=2 origin "$ASA_DIAGNOSTIC_SOURCE_SHA"';
  assert.equal(previous.split(fetch).length, 2);
  assert.equal(
    fs.readFileSync(path.join(root, workflow), 'utf8'),
    previous.replace(fetch, fetch.replace('--depth=2', '--depth=3')),
  );
});

const syntheticId = (n) => '10000000-0000-4000-8000-' + n.toString(16).padStart(12, '0');
function linkedFixture() {
  const target = {
    seat_id: syntheticId(1),
    account_id: syntheticId(2),
    seat_principal_id: syntheticId(3),
    account_principal_id: syntheticId(4),
    projects: [syntheticId(5)],
  };
  const other = {
    seat_id: syntheticId(21),
    account_id: null,
    seat_principal_id: syntheticId(23),
    account_principal_id: null,
    projects: [syntheticId(25)],
  };
  const origin = {
    ...target,
    project_id: target.projects[0],
    owner_principal_id: target.account_principal_id,
    project_tenant_id: syntheticId(6),
    school_tenant_id: syntheticId(7),
    school_id: syntheticId(8),
    learner_identity_id: syntheticId(9),
    participation_id: syntheticId(10),
    activity_run_id: syntheticId(11),
    learning_activity_version_id: syntheticId(12),
    assignment_id: syntheticId(13),
    classroom_id: syntheticId(14),
    source_course_run_id: syntheticId(15),
    source_course_lesson_id: syntheticId(16),
    source_course_block_id: 'library-activity-fixture',
    source_kind: 'course',
    module_key: 'three-d',
    owner_kind: 'account',
    viewer_kind: 'student_seat',
    seat_status: 'active',
    account_status: 'active',
    learner_state: 'active',
    seat_link_status: 'active',
    account_link_status: 'active',
    seat_principal_count: 1,
    account_principal_count: 1,
    seat_link_count: 1,
    account_link_count: 1,
  };
  const rows = [
    {
      context: {
        projectId: origin.project_id,
        seatId: origin.seat_id,
        classroomAssignmentId: origin.assignment_id,
        activityRunId: origin.activity_run_id,
        participationId: origin.participation_id,
        learningActivityVersionId: origin.learning_activity_version_id,
        courseRunId: origin.source_course_run_id,
        courseLessonId: origin.source_course_lesson_id,
        courseBlockId: origin.source_course_block_id,
        sourceKind: 'course',
        moduleKey: 'three-d',
      },
      evidence: {
        tenantId: origin.school_tenant_id,
        schoolId: origin.school_id,
        classroomId: origin.classroom_id,
        classroomAssignmentId: origin.assignment_id,
        activityRunId: origin.activity_run_id,
        seatId: origin.seat_id,
        accountId: origin.account_id,
        principalId: origin.seat_principal_id,
        learnerId: origin.learner_identity_id,
        identityResolution: 'learner_identity',
        kind: 'course_project',
      },
    },
  ];
  return { target, other, origin, rows };
}

test('selects the existing Account work independently of UUID ordering', () => {
  const { target, other } = linkedFixture();
  assert.deepEqual(selectLinkedTarget([other, target]), { ...target, index: 1 });
  assert.deepEqual(selectLinkedTarget([target, other]), { ...target, index: 0 });
});

test('refuses absent, duplicate, same-owner or multi-origin linked candidates', () => {
  const { target, other } = linkedFixture();
  for (const targets of [
    [],
    [target],
    [other, other],
    [target, target],
    [other, { ...target, seat_principal_id: target.account_principal_id }],
    [other, { ...target, projects: [] }],
    [other, { ...target, projects: [syntheticId(5), syntheticId(6)] }],
  ]) {
    assert.throws(() => selectLinkedTarget(targets));
  }
});

test('requires exactly one confirmed active cross-viewer origin', () => {
  const { target, origin } = linkedFixture();
  assert.equal(validateLinkedTarget([origin], target), origin);
  assert.throws(() => validateLinkedTarget([], target));
  assert.throws(() => validateLinkedTarget([origin, origin], target));
});

for (const [key, value] of [
  ['seat_id', syntheticId(90)],
  ['account_id', syntheticId(90)],
  ['seat_principal_id', syntheticId(90)],
  ['account_principal_id', syntheticId(90)],
  ['project_id', syntheticId(90)],
  ['owner_principal_id', syntheticId(3)],
  ['owner_kind', 'student_seat'],
  ['viewer_kind', 'account'],
  ['seat_status', 'ended'],
  ['account_status', 'disabled'],
  ['learner_state', 'inactive'],
  ['seat_link_status', 'revoked'],
  ['account_link_status', 'revoked'],
  ['seat_principal_count', 2],
  ['account_principal_count', 2],
  ['seat_link_count', 0],
  ['account_link_count', 2],
  ['source_kind', 'direct'],
  ['module_key', 'electronics'],
  ['school_id', null],
]) {
  test('refuses unconfirmed linked target: ' + key, () => {
    const { target, origin } = linkedFixture();
    assert.throws(() => validateLinkedTarget([{ ...origin, [key]: value }], target));
  });
}

test('precondition SQL inspects existing lineage without executing a product helper', () => {
  assert.match(linkedTargetSql, /^SELECT /);
  assert.doesNotMatch(
    linkedTargetSql,
    /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|EXPLAIN|SET)\b/i,
  );
  assert.doesNotMatch(
    linkedTargetSql,
    /learning_linked_project_access|learning_origin_learner_list/,
  );
  assert.ok(linkedTargetSql.includes('owner.id<>viewer.id'));
  assert.ok(linkedTargetSql.includes('origin.project_id=$5'));
});

test('compares exact lineage but permits viewer-specific JSON outside that contract', () => {
  const { origin, rows } = linkedFixture();
  const account = structuredClone(rows),
    seat = structuredClone(rows);
  account[0].context.viewerAnnotation = 'account';
  seat[0].context.viewerAnnotation = 'seat';
  assert.deepEqual(validateLinkedRead(account, origin), validateLinkedRead(seat, origin));
  const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const m = (value) => ({ status: 'completed', rowCount: 1, resultSha256: hash(value) });
  assert.notEqual(m(account).resultSha256, m(seat).resultSha256);
  validateStableMeasurements([m(account), m(account)]);
  validateStableMeasurements([m(seat), m(seat)]);
});

for (const [part, key] of [
  ['context', 'projectId'],
  ['context', 'seatId'],
  ['context', 'participationId'],
  ['context', 'activityRunId'],
  ['context', 'courseBlockId'],
  ['evidence', 'tenantId'],
  ['evidence', 'schoolId'],
  ['evidence', 'learnerId'],
  ['evidence', 'principalId'],
  ['evidence', 'accountId'],
]) {
  test('refuses a returned foreign lineage: ' + part + '.' + key, () => {
    const { origin, rows } = linkedFixture();
    rows[0][part][key] = syntheticId(99);
    assert.throws(() => validateLinkedRead(rows, origin));
  });
}

test('failed, incomplete or unstable calls cannot satisfy linked measurements', () => {
  const ok = { status: 'completed', rowCount: 1, resultSha256: 'a'.repeat(64) };
  for (const values of [
    [],
    [ok],
    [ok, { ...ok, status: 'failed' }],
    [ok, { ...ok, rowCount: 0 }],
    [ok, { ...ok, resultSha256: 'b'.repeat(64) }],
  ]) {
    assert.throws(() => validateStableMeasurements(values));
  }
});

const linkedBody = sourceBody(
  fs.readFileSync(
    path.join(root, 'migrations/0190_learning_origin_list_authorization_plan.sql'),
    'utf8',
  ),
  'learning_linked_project_access',
);
function traceFixture() {
  const actual = {
    'Actual Startup Time': 0.1,
    'Actual Total Time': 0.2,
    'Actual Loops': 1,
    'Actual Rows': 1,
  };
  return [
    {
      'Query Text': linkedBody,
      Plan: { 'Node Type': 'Result', ...actual, Plans: [{ 'Node Type': 'LockRows', ...actual }] },
    },
    {
      'Query Text': 'SELECT context,evidence FROM learning_origin_learner_list($1,$2)',
      Plan: {
        'Node Type': 'Function Scan',
        'Function Name': 'learning_origin_learner_list',
        ...actual,
      },
    },
  ];
}
const notices = (plans) => plans.map((plan) => 'duration: 0.2 ms  plan:\n' + JSON.stringify(plan));

test('requires actual nested linked-access execution inside the captured list call', () => {
  const result = validateLinkedTrace(notices(traceFixture()), linkedBody);
  assert.equal(result.linkedCalls, 1);
  assert.equal(result.linkedPlans[0].lockRows[0].rows, 1);
});

for (const [label, mutate] of [
  ['no helper notice', (plans) => plans.shift()],
  [
    'owner-only link flag',
    (plans) => {
      plans.shift();
      plans[0].linked = true;
    },
  ],
  ['no caller', (plans) => plans.pop()],
  [
    'standalone EXPLAIN',
    (plans) => {
      plans[1]['Query Text'] = 'EXPLAIN ANALYZE SELECT true';
    },
  ],
  [
    'different function body',
    (plans) => {
      plans[0]['Query Text'] = 'SELECT true';
    },
  ],
  [
    'estimated helper',
    (plans) => {
      delete plans[0].Plan['Actual Total Time'];
    },
  ],
  [
    'unexecuted helper',
    (plans) => {
      plans[0].Plan['Actual Loops'] = 0;
    },
  ],
  [
    'no admitted lock row',
    (plans) => {
      plans[0].Plan.Plans[0]['Actual Rows'] = 0;
    },
  ],
  [
    'unexecuted lock',
    (plans) => {
      plans[0].Plan.Plans[0]['Actual Loops'] = 0;
    },
  ],
  [
    'duplicate outer calls',
    (plans) => {
      plans.push(structuredClone(plans[1]));
    },
  ],
]) {
  test('rejects an insufficient linked-access witness: ' + label, () => {
    const plans = traceFixture();
    mutate(plans);
    assert.throws(() => validateLinkedTrace(notices(plans), linkedBody));
  });
}

function prefixFixture() {
  const discovery = {
    config: {
      version: '1.55.1',
      configFile: path.join(root, 'playwright.config.ts'),
      rootDir: path.join(root, 'e2e'),
      workers: 1,
      fullyParallel: false,
      shard: null,
      maxFailures: 0,
      globalTimeout: 0,
      globalSetup: null,
      globalTeardown: null,
      webServer: {
        command: 'node e2e/server.mjs',
        url: 'http://127.0.0.1:4612/health/live',
        reuseExistingServer: false,
        timeout: 30000,
      },
      projects: [
        {
          id: '',
          name: '',
          repeatEach: 1,
          retries: 0,
          timeout: 30000,
          testDir: path.join(root, 'e2e'),
          outputDir: path.join(root, 'reports/playwright/origin-prefix/results'),
        },
      ],
    },
    errors: [],
    suites: [
      {
        file: 'courses-sharing.spec.ts',
        specs: prefixTitles.map((title, index) => ({
          id: 'case-' + index,
          file: 'courses-sharing.spec.ts',
          title,
          line: [61, 266][index],
          column: 5,
          tests: [
            {
              projectId: '',
              projectName: '',
              expectedStatus: 'passed',
              annotations: [],
              results: [],
            },
          ],
        })),
      },
    ],
  };
  const execution = JSON.parse(JSON.stringify(discovery));
  execution.stats = { expected: 2, skipped: 0, unexpected: 0, flaky: 0 };
  for (const [index, spec] of execution.suites[0].specs.entries()) {
    Object.assign(spec.tests[0], {
      status: 'expected',
      timeout: index ? 300000 : 30000,
      results: [
        {
          status: 'passed',
          retry: 0,
          errors: [],
          workerIndex: 0,
          parallelIndex: 0,
          startTime: '2026-11-07T09:00:0' + index + '.000Z',
          duration: 100,
        },
      ],
    });
  }
  return { discovery, execution };
}

test('validates the two completed original cases while retaining full E1 NOT_RUN', () => {
  const { discovery, execution } = prefixFixture();
  const record = validatePrefixReports(discovery, execution, 'success');
  assert.equal(record.completedCases.length, 2);
  assert.equal(record.originalBrowserOutcome, 'success');
  assert.equal(record.fullE1, 'NOT_RUN');
});

for (const status of ['failed', 'timedOut']) {
  test('retains a completed original ' + status + ' without masking it as success', () => {
    const { discovery, execution } = prefixFixture();
    const testCase = execution.suites[0].specs[1].tests[0];
    testCase.status = 'unexpected';
    Object.assign(testCase.results[0], {
      status,
      workerIndex: 1,
      errors: [{ message: 'Synthetic failure' }],
    });
    execution.stats = { expected: 1, skipped: 0, unexpected: 1, flaky: 0 };
    assert.equal(
      validatePrefixReports(discovery, execution, 'failure').originalBrowserOutcome,
      'failure',
    );
    assert.throws(() => validatePrefixReports(discovery, execution, 'success'));
  });
}

for (const [label, mutate] of [
  ['missing case', (r) => r.suites[0].specs.pop()],
  ['extra case', (r) => r.suites[0].specs.push(r.suites[0].specs[0])],
  ['reordered cases', (r) => r.suites[0].specs.reverse()],
  [
    'different identity',
    (r) => {
      r.suites[0].specs[0].id = 'replacement';
    },
  ],
  [
    'different title',
    (r) => {
      r.suites[0].specs[0].title = 'different';
    },
  ],
  [
    'missing result',
    (r) => {
      r.suites[0].specs[0].tests[0].results = [];
    },
  ],
  [
    'skipped',
    (r) => {
      r.suites[0].specs[0].tests[0].results[0].status = 'skipped';
    },
  ],
  [
    'interrupted',
    (r) => {
      r.suites[0].specs[0].tests[0].results[0].status = 'interrupted';
    },
  ],
  [
    'retry',
    (r) => {
      r.suites[0].specs[0].tests[0].results[0].retry = 1;
    },
  ],
  [
    'incomplete duration',
    (r) => {
      delete r.suites[0].specs[0].tests[0].results[0].duration;
    },
  ],
  [
    'reversed actual starts',
    (r) => {
      r.suites[0].specs[1].tests[0].results[0].startTime = '2026-11-07T08:00:00.000Z';
    },
  ],
  [
    'wrong stats',
    (r) => {
      r.stats.expected = 1;
    },
  ],
  [
    'extra workers',
    (r) => {
      r.config.workers = 2;
    },
  ],
  [
    'reused server',
    (r) => {
      r.config.webServer.reuseExistingServer = true;
    },
  ],
  [
    'changed timeout',
    (r) => {
      r.config.projects[0].timeout = 60000;
    },
  ],
  [
    'global error',
    (r) => {
      r.errors.push({ message: 'Synthetic global error' });
    },
  ],
]) {
  test('refuses incomplete or changed prefix evidence: ' + label, () => {
    const { discovery, execution } = prefixFixture();
    mutate(execution);
    assert.throws(() => validatePrefixReports(discovery, execution, 'success'));
  });
}

test('allows only the unchanged E1 generated screenshot outputs after failure', () => {
  verifyGeneratedChanges('');
  verifyGeneratedChanges(
    ' M e2e/artifacts/courses/demo-course-published-desktop.png\0' +
      '?? e2e/artifacts/learning/course-01/account-course-three-d-completed.png\0',
  );
  verifyGeneratedChanges('?? e2e/artifacts/learning/course-document-editor/measurements.json\0');
  verifyGeneratedChanges(
    '?? e2e/artifacts/learning/course-document-editor/native-zoom-trace-ownership.json\0',
  );
});

for (const status of [
  ' M apps/api/src/learning-origin-list.ts\0',
  '?? e2e/artifacts/courses/injected.mjs\0',
  '?? e2e/artifacts/learning/course-document-editor/other.json\0',
  '?? e2e/artifacts/other/image.png\0',
  ' D e2e/artifacts/courses/demo-course-published-desktop.png\0',
  'M  e2e/artifacts/courses/demo-course-published-desktop.png\0',
  'R  e2e/artifacts/courses/renamed.png\0e2e/artifacts/courses/old.png\0',
  '?? e2e/artifacts/courses/image.png',
]) {
  test('refuses source drift or noncanonical generated status: ' + JSON.stringify(status), () => {
    assert.throws(() => verifyGeneratedChanges(status));
  });
}

test('extracts the four exact existing SQL bodies with their locks intact', () => {
  for (const [name, filename, names] of definitions) {
    const body = sourceBody(fs.readFileSync(path.join(root, 'migrations', filename), 'utf8'), name);
    const bound = bindBody(body, names);
    assert.ok(bound.includes('$1::uuid'));
    assert.ok(bound.includes('$2::uuid'));
    assert.doesNotMatch(bound, /\bp_[a-z0-9_]+\b/);
    if (name === 'learning_linked_project_access') {
      assert.ok(bound.includes('FOR SHARE OF learner, seat, account, seat_link, account_link'));
    }
  }
});

test('unknown SQL function or argument never becomes an arbitrary probe', () => {
  assert.throws(() => sourceBody('SELECT 1;', 'unknown'));
  assert.throws(() => bindBody('SELECT p_unreviewed;', ['p_seat_id', 'p_account_id']));
});

test('artifact sanitizer removes only synthetic UUID values, preserving plan metrics', () => {
  const result = sanitized({
    Plan: {
      'Actual Loops': 121,
      'Total Cost': 5000,
      Filter: "(id = '4f8169ad-08e6-4adb-9ecb-d27e6c5c50c2'::uuid)",
    },
  });
  assert.equal(result.Plan['Actual Loops'], 121);
  assert.equal(result.Plan['Total Cost'], 5000);
  assert.equal(result.Plan.Filter, "(id = 'synthetic-uuid'::uuid)");
});
