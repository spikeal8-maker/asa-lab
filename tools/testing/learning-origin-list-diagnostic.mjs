// Disposable prefix diagnostic. Never a full E1, migration, repair or capacity gate.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import console from 'node:console';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

export const base = '304b969a2d376086e0932ae6f4726eb9affaeb92';
export const branch = 'diagnostic/p0-origin-prefix-20261107';
export const workflow = '.github/workflows/learning-origin-prefix-diagnostic.yml';
export const canonicalWorkflow = '.github/workflows/learning-e1-focused.yml';
export const prefixTitles = [
  'a teacher adds one complete published demo course',
  'named Library exact mixed v1 copy survives source v2 and lost response then delivers owned media and real work',
];
export const allowedPaths = [
  workflow,
  'tools/testing/learning-origin-list-diagnostic.mjs',
  'tools/testing/learning-origin-list-diagnostic.test.mjs',
];
export const definitions = [
  [
    'learning_origin_learner_list',
    '0183_learning_origin_learner_list.sql',
    ['p_seat_id', 'p_account_id'],
  ],
  [
    'learning_origin_work_context_for_project',
    '0197_learning_project_archive.sql',
    ['p_viewer_principal_id', 'p_project_id'],
  ],
  [
    'project_context_for_principal',
    '0188_learning_legacy_classroom_project_access.sql',
    ['p_principal_id', 'p_project_id'],
  ],
  [
    'learning_linked_project_access',
    '0190_learning_origin_list_authorization_plan.sql',
    ['p_actor_principal_id', 'p_project_id'],
  ],
];
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

function requireCondition(condition, code) {
  if (!condition) throw Object.assign(new Error(code), { code });
}

/** Closed to the reviewed GitHub-hosted prefix diagnostic and its local DB. */
export function validateEnvironment(env) {
  requireCondition(
    env.GITHUB_ACTIONS === 'true' &&
      env.RUNNER_OS === 'Linux' &&
      env.RUNNER_ENVIRONMENT === 'github-hosted',
    'DIAGNOSTIC_CI_ONLY',
  );
  requireCondition(
    env.GITHUB_REPOSITORY === 'spikeal8-maker/asa-lab' &&
      env.GITHUB_EVENT_NAME === 'pull_request' &&
      env.GITHUB_HEAD_REF === branch &&
      env.GITHUB_WORKFLOW === 'Learning origin list prefix diagnostic' &&
      env.GITHUB_JOB === 'origin-list-prefix-diagnostic' &&
      /^spikeal8-maker\/asa-lab\/\.github\/workflows\/learning-origin-prefix-diagnostic\.yml@refs\/pull\/[1-9][0-9]*\/merge$/.test(
        env.GITHUB_WORKFLOW_REF ?? '',
      ),
    'DIAGNOSTIC_SOURCE_CONTEXT',
  );
  requireCondition(
    /^[a-f0-9]{40}$/.test(env.ASA_DIAGNOSTIC_SOURCE_SHA ?? '') &&
      /^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID ?? '') &&
      env.GITHUB_RUN_ATTEMPT === '1',
    'DIAGNOSTIC_RUN_IDENTITY',
  );
  requireCondition(
    ['success', 'failure'].includes(env.ASA_DIAGNOSTIC_BROWSER_OUTCOME) &&
      env.ASA_DIAGNOSTIC_BATCH === 'first',
    'DIAGNOSTIC_COMPLETED_PREFIX_REQUIRED',
  );
  const urls = [];
  for (const [name, user] of [
    ['TEST_DATABASE_URL', 'postgres'],
    ['APP_TEST_DATABASE_URL', 'asalab_app'],
  ]) {
    let value;
    try {
      value = new URL(env[name]);
    } catch {
      throw Object.assign(new Error('DIAGNOSTIC_DATABASE_URL'), {
        code: 'DIAGNOSTIC_DATABASE_URL',
      });
    }
    requireCondition(
      value.protocol === 'postgresql:' &&
        value.hostname === '127.0.0.1' &&
        value.port === '5432' &&
        value.pathname === '/asa_learning_e1_test' &&
        value.username === user &&
        value.password.length > 0 &&
        !value.search &&
        !value.hash,
      'DIAGNOSTIC_DATABASE_BOUNDARY',
    );
    urls.push(value.toString());
  }
  return { admin: urls[0], app: urls[1] };
}

export function canonicalPreparation(value) {
  const start = value.indexOf('    # Locked Playwright supports Ubuntu 24.04;');
  const end = value.indexOf(
    '      - name: Real author Account Seat and exact project journeys',
    start,
  );
  requireCondition(start >= 0 && end > start, 'DIAGNOSTIC_CANONICAL_PREPARATION');
  return value.slice(start, end);
}

/** Validate both actual completed cases, not merely a green process exit. */
export function validatePrefixReports(discovery, execution, outcome) {
  requireCondition(
    ['success', 'failure'].includes(outcome),
    'DIAGNOSTIC_COMPLETED_PREFIX_REQUIRED',
  );
  const destination = path.join(root, 'reports/playwright/origin-prefix');
  const inspect = (report, executed) => {
    const config = report.config;
    requireCondition(
      config?.version === '1.55.1' &&
        config.configFile === path.join(root, 'playwright.config.ts') &&
        config.rootDir === path.join(root, 'e2e') &&
        config.workers === 1 &&
        config.fullyParallel === false &&
        config.shard === null &&
        config.maxFailures === 0 &&
        config.globalTimeout === 0 &&
        config.globalSetup === null &&
        config.globalTeardown === null,
      'DIAGNOSTIC_PREFIX_CONFIG',
    );
    assert.deepEqual(config.webServer, {
      command: 'node e2e/server.mjs',
      url: 'http://127.0.0.1:4612/health/live',
      reuseExistingServer: false,
      timeout: 30000,
    });
    requireCondition(config.projects?.length === 1, 'DIAGNOSTIC_PREFIX_PROJECT');
    const project = config.projects[0];
    requireCondition(
      project.id === '' &&
        project.name === '' &&
        project.repeatEach === 1 &&
        project.retries === 0 &&
        project.timeout === 30000 &&
        project.testDir === path.join(root, 'e2e') &&
        project.outputDir === path.join(destination, 'results'),
      'DIAGNOSTIC_PREFIX_PROJECT',
    );
    requireCondition(
      Array.isArray(report.errors) && report.errors.length === 0,
      'DIAGNOSTIC_PREFIX_GLOBAL_ERRORS',
    );
    requireCondition(report.suites?.length === 1, 'DIAGNOSTIC_PREFIX_SUITE');
    const suite = report.suites[0];
    requireCondition(
      suite.file === 'courses-sharing.spec.ts' &&
        (!suite.suites || suite.suites.length === 0) &&
        suite.specs?.length === 2,
      'DIAGNOSTIC_PREFIX_SUITE',
    );
    let previousStart = -Infinity;
    const rows = suite.specs.map((spec, index) => {
      requireCondition(
        spec.file === suite.file &&
          spec.title === prefixTitles[index] &&
          spec.line === [61, 266][index] &&
          spec.column === 5 &&
          typeof spec.id === 'string' &&
          spec.id.length > 0 &&
          spec.tests?.length === 1,
        'DIAGNOSTIC_PREFIX_CASE',
      );
      const test = spec.tests[0];
      requireCondition(
        test.projectId === '' &&
          test.projectName === '' &&
          test.expectedStatus === 'passed' &&
          Array.isArray(test.annotations) &&
          test.annotations.length === 0 &&
          Array.isArray(test.results),
        'DIAGNOSTIC_PREFIX_CASE',
      );
      const identity = {
        id: spec.id,
        file: spec.file,
        title: spec.title,
        line: spec.line,
        column: spec.column,
        projectId: test.projectId,
        projectName: test.projectName,
      };
      if (!executed) {
        requireCondition(test.results.length === 0, 'DIAGNOSTIC_PREFIX_DISCOVERY');
        return identity;
      }
      requireCondition(test.results.length === 1, 'DIAGNOSTIC_PREFIX_EXECUTION');
      const result = test.results[0];
      requireCondition(
        ['passed', 'failed', 'timedOut'].includes(result.status) &&
          result.retry === 0 &&
          Number.isInteger(result.workerIndex) &&
          result.workerIndex >= 0 &&
          result.parallelIndex === 0 &&
          Number.isFinite(result.duration) &&
          result.duration >= 0 &&
          Array.isArray(result.errors),
        'DIAGNOSTIC_PREFIX_EXECUTION',
      );
      requireCondition(
        test.status === (result.status === 'passed' ? 'expected' : 'unexpected'),
        'DIAGNOSTIC_PREFIX_STATUS',
      );
      if (result.status === 'passed')
        requireCondition(
          result.errors.length === 0 && !result.error,
          'DIAGNOSTIC_PREFIX_PASSED_ERRORS',
        );
      const start = Date.parse(result.startTime);
      requireCondition(Number.isFinite(start) && start >= previousStart, 'DIAGNOSTIC_PREFIX_ORDER');
      previousStart = start;
      return {
        ...identity,
        result: result.status,
        startTime: result.startTime,
        durationMs: result.duration,
        workerIndex: result.workerIndex,
      };
    });
    requireCondition(new Set(rows.map((row) => row.id)).size === 2, 'DIAGNOSTIC_PREFIX_DUPLICATE');
    return rows;
  };
  const declared = inspect(discovery, false);
  const actual = inspect(execution, true);
  assert.deepEqual(
    actual.map(({ id, file, title, line, column, projectId, projectName }) => ({
      id,
      file,
      title,
      line,
      column,
      projectId,
      projectName,
    })),
    declared,
  );
  const passed = actual.filter((row) => row.result === 'passed').length;
  assert.deepEqual(
    [
      execution.stats?.expected,
      execution.stats?.skipped,
      execution.stats?.unexpected,
      execution.stats?.flaky,
    ],
    [passed, 0, 2 - passed, 0],
  );
  requireCondition(outcome === (passed === 2 ? 'success' : 'failure'), 'DIAGNOSTIC_PREFIX_OUTCOME');
  return {
    scope: 'origin_list_prefix_diagnostic_only',
    fullE1: 'NOT_RUN',
    originalBrowserOutcome: outcome,
    completedCases: actual,
  };
}

export function sourceBody(source, name) {
  const pattern = new RegExp(
    'CREATE(?: OR REPLACE)? FUNCTION public\\.' +
      name +
      '\\([\\s\\S]*?\\bAS\\s+(\\$[A-Za-z0-9_]*\\$)([\\s\\S]*?)\\1;',
    'i',
  );
  const match = source.match(pattern);
  requireCondition(
    match && /^(?:\s|--[^\n]*\n)*(?:WITH|SELECT)\b/i.test(match[2]),
    'DIAGNOSTIC_FUNCTION_SOURCE',
  );
  return match[2];
}

export function bindBody(body, names) {
  const bound = body.replace(/\bp_[a-z0-9_]+\b/g, (name) => {
    const index = names.indexOf(name);
    requireCondition(index >= 0, 'DIAGNOSTIC_UNKNOWN_PARAMETER');
    return '$' + (index + 1) + '::uuid';
  });
  requireCondition(names.length === 2, 'DIAGNOSTIC_ARGUMENT_COUNT');
  return bound;
}

export function sanitized(value) {
  return JSON.parse(
    JSON.stringify(value).replace(
      /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi,
      'synthetic-uuid',
    ),
  );
}

function failure(error) {
  return {
    code: typeof error.code === 'string' ? error.code : error.name,
    context:
      typeof error.where === 'string'
        ? error.where.split('\n').filter((line) => /^SQL function "/.test(line))
        : [],
  };
}

export function verifyGeneratedChanges(status) {
  if (!status) return;
  const entries = status.split('\0');
  requireCondition(entries.pop() === '', 'DIAGNOSTIC_DIRTY_SOURCE');
  // The unchanged E1 writes tracked and new screenshots before this probe.
  // Only those image outputs and the course editor's two exact measurement outputs
  // are permitted; any executable/source change,
  // staged change, deletion, rename, or other untracked file still refuses.
  requireCondition(
    entries.every(
      (entry) =>
        /^(?: M|\?\?) e2e\/artifacts\/(?:courses|learning)\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.png$/.test(
          entry,
        ) ||
        /^(?: M|\?\?) e2e\/artifacts\/learning\/course-document-editor\/(?:measurements|native-zoom-trace-ownership)\.json$/.test(
          entry,
        ),
    ),
    'DIAGNOSTIC_DIRTY_SOURCE',
  );
}

export function verifySource() {
  const revision = git('rev-parse', 'HEAD');
  requireCondition(revision === process.env.ASA_DIAGNOSTIC_SOURCE_SHA, 'DIAGNOSTIC_HEAD_MISMATCH');
  verifyGeneratedChanges(
    execFileSync(
      'git',
      ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames'],
      { cwd: root, encoding: 'utf8' },
    ),
  );
  git('merge-base', '--is-ancestor', base, revision);
  const changed = git('diff', '--name-only', '--no-renames', base, revision).split('\n');
  requireCondition(
    changed.length === allowedPaths.length && changed.every((name) => allowedPaths.includes(name)),
    'DIAGNOSTIC_PRODUCT_DIFF',
  );
  const original = execFileSync('git', ['show', base + ':' + canonicalWorkflow], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(fs.readFileSync(path.join(root, canonicalWorkflow), 'utf8'), original);
  requireCondition(
    fs.readFileSync(path.join(root, workflow), 'utf8').includes(canonicalPreparation(original)),
    'DIAGNOSTIC_CANONICAL_PREPARATION',
  );
  return revision;
}

const listSql = 'SELECT context,evidence FROM learning_origin_learner_list($1,$2)';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function selectLinkedTarget(targets) {
  requireCondition(Array.isArray(targets) && targets.length === 2, 'DIAGNOSTIC_LINKED_TARGETS');
  const candidates = targets.flatMap((target, index) =>
    target.account_principal_id ? [{ ...target, index }] : [],
  );
  requireCondition(candidates.length === 1, 'DIAGNOSTIC_LINKED_TARGET_UNIQUE');
  const target = candidates[0];
  requireCondition(
    ['seat_id', 'account_id', 'seat_principal_id', 'account_principal_id'].every((key) =>
      uuid.test(target[key] ?? ''),
    ) &&
      target.seat_principal_id !== target.account_principal_id &&
      Array.isArray(target.projects) &&
      target.projects.length === 1 &&
      uuid.test(target.projects[0]),
    'DIAGNOSTIC_LINKED_TARGET_IDENTITY',
  );
  return target;
}

// Inspect only the already-created Account work and its existing Seat path.
// No fixture insert, link repair, helper call, EXPLAIN or planner setting is used.
export const linkedTargetSql = `SELECT seat.id AS seat_id, account.id AS account_id,
  viewer.id AS seat_principal_id, owner.id AS account_principal_id,
  owner.kind AS owner_kind, viewer.kind AS viewer_kind,
  seat.status AS seat_status, account.status AS account_status, learner.state AS learner_state,
  seat_link.status AS seat_link_status, account_link.status AS account_link_status,
  origin.project_id, origin.project_tenant_id, origin.owner_principal_id,
  origin.school_tenant_id, origin.school_id, origin.learner_identity_id,
  origin.participation_id, origin.activity_run_id, origin.learning_activity_version_id,
  origin.source_kind, origin.source_course_run_id, origin.source_course_lesson_id,
  origin.source_course_block_id, run.source_classroom_assignment_id AS assignment_id,
  run.classroom_id, project.module_key,
  (SELECT count(*)::integer FROM public.principals p
    WHERE p.kind='student_seat' AND p.seat_id=seat.id) AS seat_principal_count,
  (SELECT count(*)::integer FROM public.principals p
    WHERE p.kind='account' AND p.account_id=account.id) AS account_principal_count,
  (SELECT count(*)::integer FROM public.learner_identity_links l
    WHERE l.tenant_id=origin.school_tenant_id AND l.school_id=origin.school_id
      AND l.link_kind='student_seat' AND l.seat_id=seat.id AND l.status='active') AS seat_link_count,
  (SELECT count(*)::integer FROM public.learner_identity_links l
    WHERE l.tenant_id=origin.school_tenant_id AND l.school_id=origin.school_id
      AND l.link_kind='account' AND l.account_id=account.id AND l.status='active') AS account_link_count
  FROM public.learning_project_origins origin
  JOIN public.projects project ON project.id=origin.project_id
    AND project.tenant_id=origin.project_tenant_id
    AND project.owner_principal_id=origin.owner_principal_id AND project.project_scope='personal'
  JOIN public.principals owner ON owner.id=origin.owner_principal_id AND owner.kind='account'
  JOIN public.accounts account ON account.id=owner.account_id AND account.status='active'
  JOIN public.activity_participations participation ON participation.id=origin.participation_id
    AND participation.tenant_id=origin.school_tenant_id AND participation.school_id=origin.school_id
    AND participation.learner_identity_id=origin.learner_identity_id
    AND participation.activity_run_id=origin.activity_run_id
  JOIN public.activity_runs run ON run.id=origin.activity_run_id
    AND run.tenant_id=origin.school_tenant_id AND run.school_id=origin.school_id
    AND run.learning_activity_version_id=origin.learning_activity_version_id
    AND run.source_kind=origin.source_kind
    AND run.source_course_run_id IS NOT DISTINCT FROM origin.source_course_run_id
    AND run.source_course_lesson_id IS NOT DISTINCT FROM origin.source_course_lesson_id
    AND run.source_course_block_id IS NOT DISTINCT FROM origin.source_course_block_id
  JOIN public.classroom_student_seats seat ON seat.classroom_id=run.classroom_id
    AND seat.tenant_id=origin.school_tenant_id AND seat.account_id=account.id AND seat.status='active'
  JOIN public.principals viewer ON viewer.kind='student_seat' AND viewer.seat_id=seat.id
  JOIN public.classrooms classroom ON classroom.id=seat.classroom_id
    AND classroom.tenant_id=origin.school_tenant_id AND classroom.school_id=origin.school_id
  JOIN public.tenants tenant ON tenant.id=classroom.tenant_id
  JOIN public.learner_identities learner ON learner.id=origin.learner_identity_id
    AND learner.tenant_id=origin.school_tenant_id AND learner.school_id=origin.school_id
    AND learner.state='active'
  JOIN public.learner_identity_links seat_link ON seat_link.tenant_id=origin.school_tenant_id
    AND seat_link.school_id=origin.school_id AND seat_link.learner_identity_id=origin.learner_identity_id
    AND seat_link.link_kind='student_seat' AND seat_link.seat_id=seat.id AND seat_link.status='active'
  JOIN public.learner_identity_links account_link ON account_link.tenant_id=origin.school_tenant_id
    AND account_link.school_id=origin.school_id AND account_link.learner_identity_id=origin.learner_identity_id
    AND account_link.link_kind='account' AND account_link.account_id=account.id AND account_link.status='active'
  WHERE seat.id=$1 AND account.id=$2 AND viewer.id=$3 AND owner.id=$4 AND origin.project_id=$5
    AND owner.id<>viewer.id AND origin.source_kind='course' AND project.module_key='three-d'
    AND classroom.title LIKE 'Library class %' AND tenant.workspace_slug LIKE 'ws-course-mate-%'`;

export function validateLinkedTarget(rows, target) {
  requireCondition(Array.isArray(rows) && rows.length === 1, 'DIAGNOSTIC_LINKED_LINEAGE_UNIQUE');
  const row = rows[0];
  requireCondition(
    row.seat_id === target.seat_id &&
      row.account_id === target.account_id &&
      row.seat_principal_id === target.seat_principal_id &&
      row.account_principal_id === target.account_principal_id &&
      row.owner_principal_id === target.account_principal_id &&
      row.owner_principal_id !== row.seat_principal_id &&
      row.project_id === target.projects[0] &&
      row.owner_kind === 'account' &&
      row.viewer_kind === 'student_seat' &&
      row.source_kind === 'course' &&
      row.module_key === 'three-d',
    'DIAGNOSTIC_LINKED_LINEAGE_IDENTITY',
  );
  requireCondition(
    [
      'seat_status',
      'account_status',
      'learner_state',
      'seat_link_status',
      'account_link_status',
    ].every((key) => row[key] === 'active') &&
      [
        'seat_principal_count',
        'account_principal_count',
        'seat_link_count',
        'account_link_count',
      ].every((key) => row[key] === 1),
    'DIAGNOSTIC_LINKED_ACTIVE_UNIQUE',
  );
  requireCondition(
    [
      'project_tenant_id',
      'school_tenant_id',
      'school_id',
      'learner_identity_id',
      'participation_id',
      'activity_run_id',
      'learning_activity_version_id',
      'assignment_id',
      'classroom_id',
      'source_course_run_id',
      'source_course_lesson_id',
    ].every((key) => uuid.test(row[key] ?? '')) &&
      typeof row.source_course_block_id === 'string' &&
      row.source_course_block_id.length > 0,
    'DIAGNOSTIC_LINKED_EXACT_ORIGIN',
  );
  return row;
}

export function validateLinkedRead(rows, origin) {
  requireCondition(Array.isArray(rows) && rows.length === 1, 'DIAGNOSTIC_LINKED_RESULT_COUNT');
  const { context, evidence } = rows[0];
  requireCondition(context && evidence, 'DIAGNOSTIC_LINKED_RESULT_SHAPE');
  const expectedContext = {
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
  };
  const expectedEvidence = {
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
  };
  requireCondition(
    Object.entries(expectedContext).every(([key, value]) => context[key] === value) &&
      Object.entries(expectedEvidence).every(([key, value]) => evidence[key] === value),
    'DIAGNOSTIC_LINKED_RESULT_LINEAGE',
  );
  return { context: expectedContext, evidence: expectedEvidence };
}

export function validateStableMeasurements(measurements) {
  requireCondition(
    measurements.length >= 2 &&
      measurements.every(
        (item) =>
          item?.status === 'completed' &&
          item.rowCount === 1 &&
          /^[a-f0-9]{64}$/.test(item.resultSha256 ?? ''),
      ),
    'DIAGNOSTIC_LINKED_MEASUREMENTS_COMPLETE',
  );
  requireCondition(
    measurements.every((item) => item.resultSha256 === measurements[0].resultSha256),
    'DIAGNOSTIC_LINKED_MODE_UNSTABLE',
  );
}

export function validateLinkedTrace(messages, linkedBody) {
  const plans = messages.map((message) => {
    const start = message.indexOf('{');
    requireCondition(
      /^duration: [0-9.]+ ms\s+plan:/.test(message) && start > 0,
      'DIAGNOSTIC_LINKED_TRACE_FORMAT',
    );
    return JSON.parse(message.slice(start));
  });
  const actual = (plan) =>
    plan &&
    Number.isFinite(plan['Actual Total Time']) &&
    Number.isFinite(plan['Actual Startup Time']) &&
    Number.isInteger(plan['Actual Loops']) &&
    plan['Actual Loops'] > 0 &&
    plan['Actual Rows'] === 1;
  const outer = plans.filter((plan) => plan['Query Text'] === listSql);
  requireCondition(
    outer.length === 1 &&
      actual(outer[0].Plan) &&
      outer[0].Plan['Node Type'] === 'Function Scan' &&
      outer[0].Plan['Function Name'] === 'learning_origin_learner_list',
    'DIAGNOSTIC_LINKED_TRACE_CALLER',
  );
  const linked = plans.filter((plan) => plan['Query Text'] === linkedBody);
  const nodes = (plan) => [plan, ...(plan.Plans ?? []).flatMap(nodes)];
  requireCondition(
    linked.length > 0 &&
      linked.every(
        (plan) =>
          actual(plan.Plan) &&
          nodes(plan.Plan).some((node) => node['Node Type'] === 'LockRows' && actual(node)),
      ),
    'DIAGNOSTIC_LINKED_NESTED_WITNESS',
  );
  return {
    querySha256: sha256(listSql),
    linkedBodySha256: sha256(linkedBody),
    linkedCalls: linked.length,
    linkedPlans: linked.map((plan) => ({
      startupMs: plan.Plan['Actual Startup Time'],
      totalMs: plan.Plan['Actual Total Time'],
      rows: plan.Plan['Actual Rows'],
      loops: plan.Plan['Actual Loops'],
      lockRows: nodes(plan.Plan)
        .filter((node) => node['Node Type'] === 'LockRows')
        .map((node) => ({
          rows: node['Actual Rows'],
          loops: node['Actual Loops'],
          totalMs: node['Actual Total Time'],
        })),
    })),
  };
}

async function captureLinkedAccess({ admin, client, urls, targets, events, event }) {
  const target = selectLinkedTarget(targets);
  const origin = validateLinkedTarget(
    (
      await admin.query(linkedTargetSql, [
        target.seat_id,
        target.account_id,
        target.seat_principal_id,
        target.account_principal_id,
        target.projects[0],
      ])
    ).rows,
    target,
  );
  const ownerLabel = 'library_' + target.index + '_account';
  const label = ownerLabel + '_as_seat';
  event({
    stage: 'linked_preconditions',
    label,
    status: 'confirmed',
    origin,
    ownerDiffersFromViewer: true,
    originalOwnerLabel: ownerLabel,
  });

  const read = async (connection, name, values) => {
    const start = performance.now();
    let result;
    try {
      result = await connection.query(listSql, values);
    } catch (error) {
      const item = {
        stage: 'linked_measurement',
        label: name,
        status: 'failed',
        elapsedMs: Math.round((performance.now() - start) * 100) / 100,
        error: failure(error),
      };
      event(item);
      return item;
    }
    const elapsedMs = Math.round((performance.now() - start) * 100) / 100;
    const lineage = validateLinkedRead(result.rows, origin);
    const item = {
      stage: 'linked_measurement',
      label: name,
      status: 'completed',
      elapsedMs,
      rowCount: result.rowCount,
      resultSha256: sha256(JSON.stringify(result.rows)),
      lineageSha256: sha256(JSON.stringify(lineage)),
    };
    event(item);
    return item;
  };
  const runtimeIdentity = async (connection, name) => {
    const identity = (
      await connection.query(`SELECT current_user AS role,
      pg_backend_pid() AS pid, current_setting('statement_timeout') AS statement_timeout`)
    ).rows[0];
    requireCondition(identity.role === 'asalab_app', 'DIAGNOSTIC_LINKED_RUNTIME_ROLE');
    event({ stage: 'linked_runtime_identity', label: name, ...identity });
  };

  // The prior owner first/repeated measurements remain byte-for-byte unchanged.
  // One extra owner read exposes its exact lineage; full hashes are compared only
  // within one viewer mode, never between Account and Seat.
  let ownerReference;
  const owner = await client(urls.app);
  try {
    await runtimeIdentity(owner, ownerLabel);
    ownerReference = await read(owner, ownerLabel + '_lineage_reference', [
      null,
      target.account_id,
    ]);
  } finally {
    await owner.end();
  }
  const seat = await client(urls.app);
  let first, repeated;
  try {
    await runtimeIdentity(seat, label);
    first = await read(seat, label + '_first_new_connection', [target.seat_id, null]);
    repeated = await read(seat, label + '_same_connection', [target.seat_id, null]);
  } finally {
    await seat.end();
  }

  const notices = [];
  let traced;
  const instrumented = await client(urls.admin);
  try {
    await instrumented.query("LOAD 'auto_explain'");
    await instrumented.query(`SET auto_explain.log_min_duration=0;
      SET auto_explain.log_analyze=on; SET auto_explain.log_buffers=on;
      SET auto_explain.log_timing=on; SET auto_explain.log_nested_statements=on;
      SET auto_explain.log_format='json'; SET auto_explain.log_level='notice';
      SET auto_explain.log_parameter_max_length=0; SET ROLE asalab_app`);
    const identity = (
      await instrumented.query(`SELECT current_user AS role,
      session_user AS session_role, current_setting('statement_timeout') AS statement_timeout`)
    ).rows[0];
    requireCondition(
      identity.role === 'asalab_app' && identity.session_role === 'postgres',
      'DIAGNOSTIC_LINKED_INSTRUMENTED_ROLE',
    );
    event({
      stage: 'linked_instrumented_identity',
      label,
      ...identity,
      interpretation: 'One Seat list call; instrumentation overhead is not baseline latency.',
    });
    instrumented.on('notice', (notice) => {
      if (notice.message?.startsWith('duration:')) {
        notices.push(notice.message);
        event({ stage: 'linked_instrumented_plan', label, message: notice.message });
      }
    });
    // This is the only statement after registering the listener. Standalone
    // EXPLAIN or the earlier owner traces cannot satisfy this case's witness.
    traced = await read(instrumented, label + '_instrumented', [target.seat_id, null]);
  } finally {
    await instrumented.end();
  }
  const originalOwner = ['_cold', '_same_connection'].map((suffix) => {
    const matches = events.filter(
      (item) => item.stage === 'measurement' && item.label === ownerLabel + suffix,
    );
    requireCondition(matches.length === 1, 'DIAGNOSTIC_LINKED_OWNER_COMPARATOR');
    return matches[0];
  });
  validateStableMeasurements([...originalOwner, ownerReference]);
  validateStableMeasurements([first, repeated, traced]);
  requireCondition(
    ownerReference.lineageSha256 === first.lineageSha256 &&
      first.lineageSha256 === repeated.lineageSha256 &&
      first.lineageSha256 === traced.lineageSha256,
    'DIAGNOSTIC_LINKED_SHARED_LINEAGE',
  );
  const definition = definitions.find(([name]) => name === 'learning_linked_project_access');
  const linkedBody = sourceBody(
    fs.readFileSync(path.join(root, 'migrations', definition[1]), 'utf8'),
    definition[0],
  );
  const witness = validateLinkedTrace(notices, linkedBody);
  const result = {
    stage: 'linked_access_witness',
    label,
    status: 'confirmed',
    ownerReferenceLabel: ownerReference.label,
    lineageSha256: first.lineageSha256,
    ownerModeStable: true,
    seatModeStable: true,
    ...witness,
  };
  event(result);
  return result;
}

async function main() {
  const urls = validateEnvironment(process.env);
  const revision = verifySource();
  const outcome = process.env.ASA_DIAGNOSTIC_BROWSER_OUTCOME;
  const prefixDirectory = path.join(root, 'reports/playwright/origin-prefix');
  const prefix = validatePrefixReports(
    JSON.parse(fs.readFileSync(path.join(prefixDirectory, 'discovery.json'), 'utf8')),
    JSON.parse(fs.readFileSync(path.join(prefixDirectory, 'execution.json'), 'utf8')),
    outcome,
  );
  const receipt = JSON.parse(
    fs.readFileSync(path.join(prefixDirectory, 'original-outcome.json'), 'utf8'),
  );
  requireCondition(
    receipt.source_sha === revision &&
      receipt.run_id === process.env.GITHUB_RUN_ID &&
      receipt.run_attempt === process.env.GITHUB_RUN_ATTEMPT &&
      receipt.code_data_outcome === 'success' &&
      receipt.original_browser_outcome === outcome &&
      receipt.full_e1 === 'NOT_RUN' &&
      receipt.scope === 'origin_list_prefix_diagnostic_only',
    'DIAGNOSTIC_PREFIX_RECEIPT',
  );
  const directory = path.join(root, 'reports/diagnostics');
  fs.mkdirSync(directory, { recursive: true });
  const output = fs.mkdtempSync(path.join(directory, 'origin-list-'));
  const record = {
    format: 'asa-origin-list-prefix-diagnostic-v2',
    source: revision,
    productBase: base,
    originalBrowserOutcome: outcome,
    prefix,
    fullE1: 'NOT_RUN',
    runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    startedAt: new Date().toISOString(),
    status: 'in_progress',
    events: [],
    interpretation:
      'Prefix diagnostic only; original browser outcome is preserved. Full E1 NOT_RUN; not N30 or release evidence.',
    standaloneBodyInterpretation:
      'Standalone body plans supplement actual nested function plans; GENERIC_PLAN is an estimate, not proof of the cached function plan.',
  };
  const event = (value) => {
    const safe = sanitized(value);
    record.events.push(safe);
    fs.appendFileSync(path.join(output, 'events.jsonl'), JSON.stringify(safe) + '\n', {
      mode: 0o600,
    });
    console.log(
      'ORIGIN_DIAGNOSTIC ' +
        JSON.stringify({
          stage: safe.stage,
          label: safe.label,
          status: safe.status,
          elapsedMs: safe.elapsedMs,
          code: safe.error?.code,
        }),
    );
  };
  let admin;
  try {
    const { default: pg } = await import('pg');
    const { poolSettings } = await import('../../apps/api/dist/app.factory.js');
    const settings = poolSettings();
    record.runtimePoolSettings = settings;
    // Reuse the application's existing timeouts. No limits, JIT, planner settings,
    // roles, functions, tables or production resources are changed by this probe.
    const client = async (url) => {
      const value = new pg.Client({ connectionString: url, ...settings });
      await value.connect();
      return value;
    };
    admin = await client(urls.admin);
    record.database = (
      await admin.query(`SELECT current_database() AS name,
      current_user AS role, version(), current_setting('statement_timeout') AS statement_timeout,
      current_setting('jit') AS jit, current_setting('jit_above_cost') AS jit_above_cost,
      current_setting('join_collapse_limit') AS join_collapse_limit,
      current_setting('geqo_threshold') AS geqo_threshold,
      (SELECT max(version) FROM schema_migrations) AS schema_version`)
    ).rows[0];
    requireCondition(
      record.database.name === 'asa_learning_e1_test' && record.database.role === 'postgres',
      'DIAGNOSTIC_CONNECTED_DATABASE',
    );
    record.statistics = (
      await admin.query(
        `SELECT s.relname, c.reltuples,
      s.n_live_tup, s.n_dead_tup, s.n_mod_since_analyze, s.last_analyze, s.last_autoanalyze
      FROM pg_stat_user_tables s JOIN pg_class c ON c.oid=s.relid
      WHERE s.schemaname='public' AND s.relname=ANY($1::text[]) ORDER BY s.relname`,
        [
          [
            'learning_project_origins',
            'activity_participations',
            'activity_runs',
            'projects',
            'classroom_student_seats',
            'principals',
            'learner_identity_links',
            'learner_identities',
            'accounts',
            'classroom_memberships',
            'legacy_user_account_links',
          ],
        ],
      )
    ).rows;
    const bodies = new Map();
    for (const [name, file, names] of definitions) {
      const expected = sourceBody(
        fs.readFileSync(path.join(root, 'migrations', file), 'utf8'),
        name,
      );
      const actual = (
        await admin.query(
          `SELECT p.prosrc, p.prosecdef, p.provolatile,
        p.proargnames, p.proconfig, l.lanname, pg_get_userbyid(p.proowner) AS owner
        FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
        WHERE p.oid=to_regprocedure($1)`,
          ['public.' + name + '(uuid,uuid)'],
        )
      ).rows[0];
      requireCondition(
        actual?.prosrc === expected &&
          actual.prosecdef &&
          actual.provolatile === 'v' &&
          actual.lanname === 'sql' &&
          actual.owner === 'postgres' &&
          JSON.stringify(actual.proargnames.slice(0, 2)) === JSON.stringify(names) &&
          JSON.stringify(actual.proconfig) === JSON.stringify(['search_path=pg_catalog, pg_temp']),
        'DIAGNOSTIC_FUNCTION_DRIFT_' + name,
      );
      bodies.set(name, bindBody(expected, names));
      event({
        stage: 'function_identity',
        name,
        sourceSha256: sha256(expected),
        status: 'matched',
      });
    }
    // These labels belong to the unchanged courses-sharing synthetic E1 fixture.
    const targets = (
      await admin.query(`SELECT seat.id AS seat_id, seat.account_id,
      seat_principal.id AS seat_principal_id, account_principal.id AS account_principal_id,
      array_agg(origin.project_id ORDER BY origin.project_id) AS projects
      FROM classroom_student_seats seat
      JOIN classrooms classroom ON classroom.id=seat.classroom_id AND classroom.tenant_id=seat.tenant_id
      JOIN tenants tenant ON tenant.id=seat.tenant_id
      JOIN principals seat_principal ON seat_principal.seat_id=seat.id AND seat_principal.kind='student_seat'
      LEFT JOIN principals account_principal ON account_principal.account_id=seat.account_id AND account_principal.kind='account'
      JOIN learner_identity_links link ON link.tenant_id=seat.tenant_id AND link.seat_id=seat.id
        AND link.link_kind='student_seat' AND link.status='active'
      JOIN learning_project_origins origin ON origin.school_tenant_id=seat.tenant_id
        AND origin.school_id=link.school_id AND origin.learner_identity_id=link.learner_identity_id
      JOIN activity_runs run ON run.id=origin.activity_run_id AND run.classroom_id=seat.classroom_id
      WHERE classroom.title LIKE 'Library class %' AND tenant.workspace_slug LIKE 'ws-course-mate-%'
        AND seat.status='active'
      GROUP BY seat.id, seat.account_id, seat_principal.id, account_principal.id
      ORDER BY seat.id LIMIT 2`)
    ).rows;
    requireCondition(targets.length > 0, 'DIAGNOSTIC_LIBRARY_WORK_NOT_CREATED');
    record.targets = targets.map((target, i) => ({
      label: 'library_' + i,
      linkedAccount: Boolean(target.account_principal_id),
      originCount: target.projects.length,
    }));

    const measured = async (connection, label, sql, values) => {
      const start = performance.now();
      try {
        const result = await connection.query(sql, values);
        const item = {
          stage: 'measurement',
          label,
          status: 'completed',
          elapsedMs: Math.round((performance.now() - start) * 100) / 100,
          rowCount: result.rowCount,
          resultSha256: sha256(JSON.stringify(result.rows)),
        };
        if (sql.startsWith('EXPLAIN')) item.plan = result.rows;
        event(item);
      } catch (error) {
        event({
          stage: 'measurement',
          label,
          status: 'failed',
          elapsedMs: Math.round((performance.now() - start) * 100) / 100,
          error: failure(error),
        });
      }
    };

    for (const [index, target] of targets.entries()) {
      // One mode per fixture learner: the original browser test has one Seat
      // and one approved Account, not an additional generated workload.
      const modes = target.account_principal_id
        ? [['account', [null, target.account_id], target.account_principal_id]]
        : [['seat', [target.seat_id, null], target.seat_principal_id]];
      for (const [mode, values, principal] of modes) {
        const label = 'library_' + index + '_' + mode;
        const runtime = await client(urls.app);
        try {
          const identity = (
            await runtime.query(`SELECT current_user AS role,
            pg_backend_pid() AS pid, current_setting('statement_timeout') AS statement_timeout`)
          ).rows[0];
          requireCondition(identity.role === 'asalab_app', 'DIAGNOSTIC_RUNTIME_ROLE');
          event({ stage: 'runtime_identity', label, ...identity });
          await measured(
            runtime,
            label + '_cold',
            'SELECT context,evidence FROM learning_origin_learner_list($1,$2)',
            values,
          );
          await measured(
            runtime,
            label + '_same_connection',
            'SELECT context,evidence FROM learning_origin_learner_list($1,$2)',
            values,
          );
        } finally {
          await runtime.end();
        }

        const instrumented = await client(urls.admin);
        try {
          await instrumented.query("LOAD 'auto_explain'");
          await instrumented.query(`SET auto_explain.log_min_duration=0;
            SET auto_explain.log_analyze=on; SET auto_explain.log_buffers=on;
            SET auto_explain.log_timing=on; SET auto_explain.log_nested_statements=on;
            SET auto_explain.log_format='json'; SET auto_explain.log_level='notice';
            SET auto_explain.log_parameter_max_length=0; SET ROLE asalab_app`);
          const identity = (
            await instrumented.query(`SELECT current_user AS role,
            session_user AS session_role,
            current_setting('statement_timeout') AS statement_timeout`)
          ).rows[0];
          requireCondition(
            identity.role === 'asalab_app' && identity.session_role === 'postgres',
            'DIAGNOSTIC_INSTRUMENTED_ROLE',
          );
          event({
            stage: 'instrumented_identity',
            label,
            ...identity,
            interpretation:
              'Superuser loads instrumentation, then uses the application role; not an ordinary application session.',
          });
          instrumented.on('notice', (notice) => {
            if (notice.message?.startsWith('duration:'))
              event({
                stage: 'instrumented_nested_plan',
                label,
                message: notice.message,
                interpretation: 'Instrumentation overhead; not a baseline latency.',
              });
          });
          await measured(
            instrumented,
            label + '_instrumented',
            'SELECT context,evidence FROM learning_origin_learner_list($1,$2)',
            values,
          );
        } finally {
          await instrumented.end();
        }

        // Explain the exact pinned SQL bodies under their existing SECURITY
        // DEFINER owner and search_path. The read statements may take the existing
        // FOR SHARE locks; each plan is rolled back, never stripped of its locks.
        for (const [name] of definitions) {
          const bodyClient = await client(urls.admin);
          const args =
            name === 'learning_origin_learner_list' ? values : [principal, target.projects[0]];
          try {
            if (index === 0) {
              // Parameter-independent estimate complements the bound-value plan.
              // EXPLAIN GENERIC_PLAN never executes or changes planner settings.
              await bodyClient.query('BEGIN; SET LOCAL search_path=pg_catalog,pg_temp');
              await measured(
                bodyClient,
                name + '_generic_estimated',
                'EXPLAIN (GENERIC_PLAN, VERBOSE, SETTINGS, FORMAT JSON) ' + bodies.get(name),
              );
              await bodyClient.query('ROLLBACK');
            }
            await bodyClient.query('BEGIN; SET LOCAL search_path=pg_catalog,pg_temp');
            await measured(
              bodyClient,
              label + '_' + name + '_estimated',
              'EXPLAIN (VERBOSE, SETTINGS, FORMAT JSON) ' + bodies.get(name),
              args,
            );
            await bodyClient.query('ROLLBACK');
            await bodyClient.query('BEGIN; SET LOCAL search_path=pg_catalog,pg_temp');
            await measured(
              bodyClient,
              label + '_' + name + '_actual',
              'EXPLAIN (ANALYZE, BUFFERS, VERBOSE, SETTINGS, FORMAT JSON) ' + bodies.get(name),
              args,
            );
          } finally {
            try {
              await bodyClient.query('ROLLBACK');
            } finally {
              await bodyClient.end();
            }
          }
        }
      }
    }
    record.linkedAccess = await captureLinkedAccess({
      admin,
      client,
      urls,
      targets,
      events: record.events,
      event,
    });
    record.status = 'diagnostic_complete_original_prefix_' + outcome;
  } catch (error) {
    record.status = 'diagnostic_failed_original_prefix_' + outcome;
    event({ stage: 'probe', status: 'failed', error: failure(error) });
    process.exitCode = 1;
  } finally {
    if (admin) {
      try {
        await admin.end();
      } catch (error) {
        record.status = 'diagnostic_failed_original_prefix_' + outcome;
        event({ stage: 'admin_close', status: 'failed', error: failure(error) });
        process.exitCode = 1;
      }
    }
    record.finishedAt = new Date().toISOString();
    fs.writeFileSync(
      path.join(output, 'diagnostic.json'),
      JSON.stringify(sanitized(record), null, 2) + '\n',
      { flag: 'wx', mode: 0o600 },
    );
    console.log(
      'ORIGIN_DIAGNOSTIC_RESULT ' +
        JSON.stringify({
          status: record.status,
          report: path.relative(root, path.join(output, 'diagnostic.json')),
          originalBrowserOutcome: outcome,
          fullE1: 'NOT_RUN',
        }),
    );
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(JSON.stringify({ status: 'diagnostic_refused', error: failure(error) }));
    process.exitCode = 1;
  });
}
