#!/usr/bin/env node
// LRN-TEACHER-HOME-PERF-01: post-gate diagnostic, never a business gate or repair.
// Only the disposable CI databases below are eligible. No database writes,
// optimizer changes, persistent configuration, retries or fixture creation.
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';
import process from 'node:process';

/** @type {Readonly<Record<string, number>>} */
export const LIMITS = Object.freeze({
  totalMs: 50_000,
  connectMs: 2_000,
  metadataMs: 4_000,
  queryMs: 30_000,
  closeMs: 250,
  notices: 4_096,
  noticeBytes: 512 * 1024,
  allNoticeBytes: 16 * 1024 * 1024,
  planNodes: 256,
  planDepth: 24,
  samplesPerFunction: 2,
  classes: 64,
  resultRows: 20_000,
  artifactBytes: 768 * 1024,
});
export const OUTER_QUERY =
  'SELECT evidence FROM learning_canonical_evidence_for_teacher_account($1)';
const FUNCTIONS = [
  ['learning_canonical_evidence_for_teacher_account', 'uuid'],
  ['learning_canonical_evidence_internal', 'uuid,uuid,boolean'],
  ['learning_selected_result_internal', 'uuid'],
  ['learning_effective_conditions_internal', 'uuid,uuid'],
];
const SETTINGS = new Set([
  'server_version_num',
  'jit',
  'jit_provider',
  'jit_above_cost',
  'jit_inline_above_cost',
  'jit_optimize_above_cost',
  'jit_expressions',
  'jit_tuple_deforming',
  'work_mem',
  'hash_mem_multiplier',
  'shared_buffers',
  'effective_cache_size',
  'effective_io_concurrency',
  'seq_page_cost',
  'random_page_cost',
  'cpu_tuple_cost',
  'cpu_index_tuple_cost',
  'cpu_operator_cost',
  'parallel_setup_cost',
  'parallel_tuple_cost',
  'plan_cache_mode',
  'default_statistics_target',
  'from_collapse_limit',
  'join_collapse_limit',
  'geqo',
  'geqo_threshold',
  'max_parallel_workers',
  'max_parallel_workers_per_gather',
  'max_worker_processes',
  'min_parallel_table_scan_size',
  'min_parallel_index_scan_size',
  'enable_async_append',
  'enable_bitmapscan',
  'enable_gathermerge',
  'enable_hashagg',
  'enable_hashjoin',
  'enable_incremental_sort',
  'enable_indexonlyscan',
  'enable_indexscan',
  'enable_material',
  'enable_memoize',
  'enable_mergejoin',
  'enable_nestloop',
  'enable_parallel_append',
  'enable_parallel_hash',
  'enable_partition_pruning',
  'enable_partitionwise_aggregate',
  'enable_partitionwise_join',
  'enable_seqscan',
  'enable_sort',
  'enable_tidscan',
  'row_security',
  'search_path',
  'track_io_timing',
  'default_transaction_isolation',
  'default_transaction_read_only',
  'statement_timeout',
  'lock_timeout',
  'idle_in_transaction_session_timeout',
  'transaction_read_only',
  'transaction_isolation',
  'max_connections',
]);
const SETTING_ENUMS = new Set([
  'on',
  'off',
  'auto',
  'force_generic_plan',
  'force_custom_plan',
  'llvmjit',
  'read committed',
  'repeatable read',
  'serializable',
  'read uncommitted',
  '"$user", public',
]);
const NODES = new Set([
  'Result',
  'ProjectSet',
  'ModifyTable',
  'Append',
  'Merge Append',
  'Recursive Union',
  'BitmapAnd',
  'BitmapOr',
  'Nested Loop',
  'Merge Join',
  'Hash Join',
  'Seq Scan',
  'Sample Scan',
  'Gather',
  'Gather Merge',
  'Index Scan',
  'Index Only Scan',
  'Bitmap Index Scan',
  'Bitmap Heap Scan',
  'Tid Scan',
  'Tid Range Scan',
  'Subquery Scan',
  'Function Scan',
  'Table Function Scan',
  'Values Scan',
  'CTE Scan',
  'Named Tuplestore Scan',
  'WorkTable Scan',
  'Foreign Scan',
  'Custom Scan',
  'Materialize',
  'Memoize',
  'Sort',
  'Incremental Sort',
  'Group',
  'Aggregate',
  'WindowAgg',
  'Unique',
  'SetOp',
  'LockRows',
  'Limit',
  'Hash',
]);
const RELATIONS = new Set([
  'classroom_memberships',
  'classroom_assignments',
  'classrooms',
  'classroom_student_seats',
  'principals',
  'learner_identity_links',
  'activity_runs',
  'activity_participations',
  'learning_activity_versions',
  'classroom_assignment_work',
  'learning_attempts',
  'learning_submissions',
  'assessment_results',
  'gradebook_entries',
  'learning_migration_compatibility_activity_versions',
]);
const NUMBERS = [
  'Startup Cost',
  'Total Cost',
  'Plan Rows',
  'Plan Width',
  'Actual Startup Time',
  'Actual Total Time',
  'Actual Rows',
  'Actual Loops',
  'Rows Removed by Filter',
  'Rows Removed by Join Filter',
  'Rows Removed by Index Recheck',
  'Heap Fetches',
  'Shared Hit Blocks',
  'Shared Read Blocks',
  'Shared Dirtied Blocks',
  'Shared Written Blocks',
  'Local Hit Blocks',
  'Local Read Blocks',
  'Local Dirtied Blocks',
  'Local Written Blocks',
  'Temp Read Blocks',
  'Temp Written Blocks',
  'I/O Read Time',
  'I/O Write Time',
  'Shared I/O Read Time',
  'Shared I/O Write Time',
  'Local I/O Read Time',
  'Local I/O Write Time',
  'Temp I/O Read Time',
  'Temp I/O Write Time',
  'Hash Buckets',
  'Original Hash Buckets',
  'Hash Batches',
  'Original Hash Batches',
  'Peak Memory Usage',
  'Sort Space Used',
  'Workers Planned',
  'Workers Launched',
  'Cache Hits',
  'Cache Misses',
  'Cache Evictions',
  'Cache Overflows',
  'Memory Usage',
  'Disk Usage',
  'Planned Partitions',
  'HashAgg Batches',
];
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const statement = (value) => value.replace(/\r\n/g, '\n').trim().replace(/;\s*$/, '');
const number = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const fail = (reason) => {
  const error = new Error(reason);
  error.probeReason = reason;
  throw error;
};
const requireThat = (condition, reason) => {
  if (!condition) fail(reason);
};

// This digest is calculated once in the checked-out host and again in the image.
// The Docker test stage has no embedded git revision. Neither GITHUB_SHA nor an
// image tag alone proves that its actual diagnostic/SQL bytes match the checkout.
export function readSource(root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')) {
  const files = [
    'tools/testing/teacher-home-plan-probe.mjs',
    'package.json',
    'pnpm-lock.yaml',
    'apps/api/src/teacher-home-attention.ts',
    'apps/api/src/learning-canonical-projection.service.ts',
    'tests/courses/learning-direct-project-attempts.pg.spec.ts',
    'tests/portal/helpers.ts',
    ...readdirSync(resolve(root, 'migrations'))
      .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name))
      .sort()
      .map((name) => `migrations/${name}`),
  ];
  const bodies = new Map();
  const migrations = [];
  const manifest = files.map((file) => {
    const content = readFileSync(resolve(root, file), 'utf8');
    const digest = sha256(content);
    if (file.startsWith('migrations/')) {
      migrations.push({ version: file.slice(11, 15), checksum: digest });
      for (const [name, args] of FUNCTIONS) {
        const pattern = new RegExp(
          `CREATE OR REPLACE FUNCTION\\s+(?:public\\.)?${name}\\s*\\([\\s\\S]*?\\bAS\\s+(\\$[a-zA-Z_0-9]*\\$)([\\s\\S]*?)\\1\\s*;`,
          'gi',
        );
        for (const match of content.matchAll(pattern)) {
          bodies.set(name, { name, signature: `public.${name}(${args})`, body: match[2], file });
        }
      }
    }
    return { file, sha256: digest };
  });
  requireThat(
    bodies.size === FUNCTIONS.length && migrations.length > 0,
    'source_definition_missing',
  );
  return {
    digest: sha256(JSON.stringify(manifest)),
    manifest,
    migrations,
    functions: [...bodies.values()],
  };
}

export function readConfiguration(env, sourceDigest) {
  requireThat(
    env.CI === 'true' &&
      env.GITHUB_ACTIONS === 'true' &&
      env.ASA_TEACHER_HOME_PROBE === 'isolated-post-gate',
    'isolated_ci_opt_in_required',
  );
  const lane = env.ASA_TEACHER_HOME_CI_LANE;
  const target =
    lane === 'general'
      ? { host: 'postgres', db: 'asalab_test', admin: 'asalab_admin' }
      : lane === 'learning'
        ? { host: '127.0.0.1', db: 'asa_learning_e1_test', admin: 'postgres' }
        : null;
  requireThat(target !== null, 'unknown_ci_lane');
  requireThat(
    /^[0-9a-f]{40}$/.test(env.ASA_TEACHER_HOME_SOURCE_SHA ?? ''),
    'checkout_sha_required',
  );
  requireThat(
    /^[0-9a-f]{64}$/.test(sourceDigest) && env.ASA_TEACHER_HOME_SOURCE_DIGEST === sourceDigest,
    'source_digest_mismatch',
  );
  const urls = [env.TEST_DATABASE_URL, env.APP_TEST_DATABASE_URL];
  for (const [index, value] of urls.entries()) {
    let url;
    try {
      url = new URL(value);
    } catch {
      fail('invalid_test_target');
    }
    requireThat(
      ['postgres:', 'postgresql:'].includes(url.protocol) &&
        url.hostname === target.host &&
        (url.port || '5432') === '5432' &&
        url.pathname === `/${target.db}` &&
        target.db.endsWith('_test') &&
        decodeURIComponent(url.username) === (index === 0 ? target.admin : 'asalab_app') &&
        url.search === '' &&
        url.hash === '',
      'invalid_test_target',
    );
  }
  return { lane, sourceSha: env.ASA_TEACHER_HOME_SOURCE_SHA, urls };
}

function safeSetting(value) {
  return typeof value === 'string' && (/^-?\d+(?:\.\d+)?$/.test(value) || SETTING_ENUMS.has(value))
    ? value
    : 'redacted';
}
export function compareSettings(runtimeRows, observerRows) {
  const runtime = new Map(runtimeRows.map(({ name, setting }) => [name, setting]));
  const observer = new Map(observerRows.map(({ name, setting }) => [name, setting]));
  // These two intentional session differences cannot be made equivalent by
  // SET ROLE. All other defaults (including role/database settings) must agree.
  const ignored = new Set(['session_authorization', 'role']);
  const mismatches = [...new Set([...runtime.keys(), ...observer.keys()])].filter(
    (name) =>
      !ignored.has(name) &&
      !name.startsWith('auto_explain.') &&
      runtime.get(name) !== observer.get(name),
  );
  const values = Object.fromEntries(
    [...SETTINGS]
      .filter((name) => runtime.has(name))
      .map((name) => [name, safeSetting(runtime.get(name))]),
  );
  return {
    equal: mismatches.length === 0,
    compared: runtime.size - [...ignored].filter((name) => runtime.has(name)).length,
    mismatches: mismatches.filter((name) => SETTINGS.has(name)),
    otherMismatchCount: mismatches.filter((name) => !SETTINGS.has(name)).length,
    runtime: values,
    units: Object.fromEntries(
      runtimeRows
        .filter((row) => SETTINGS.has(row.name) && row.unit !== undefined)
        .map((row) => [
          row.name,
          [null, 'B', 'kB', '8kB', 'MB', 'ms', 's', 'min'].includes(row.unit)
            ? row.unit
            : 'redacted',
        ]),
    ),
    observer: Object.fromEntries(
      [...SETTINGS]
        .filter((name) => observer.has(name))
        .map((name) => [name, safeSetting(observer.get(name))]),
    ),
  };
}

export function verifyFunctions(rows, expected) {
  requireThat(rows.length === expected.length, 'function_definition_mismatch');
  return expected.map((item) => {
    const row = rows.find((candidate) => candidate.name === item.name);
    requireThat(
      row &&
        row.language === 'sql' &&
        row.volatility === 's' &&
        row.definer === true &&
        statement(row.body) === statement(item.body) &&
        Array.isArray(row.config) &&
        row.config.length === 1 &&
        /^search_path=pg_catalog,\s*pg_temp$/.test(row.config[0]),
      'function_definition_mismatch',
    );
    return {
      name: item.name,
      source: item.file,
      bodySha256: sha256(statement(item.body)),
      stable: true,
      securityDefiner: true,
      searchPath: 'pg_catalog, pg_temp',
    };
  });
}

function sanitizeJit(input) {
  if (!input || typeof input !== 'object') return undefined;
  const output = {};
  if (number(input.Functions)) output.Functions = input.Functions;
  if (input.Options) {
    output.Options = Object.fromEntries(
      ['Inlining', 'Optimization', 'Expressions', 'Deforming']
        .filter((key) => typeof input.Options[key] === 'boolean')
        .map((key) => [key, input.Options[key]]),
    );
  }
  if (input.Timing) {
    output.Timing = Object.fromEntries(
      ['Generation', 'Inlining', 'Optimization', 'Emission', 'Total']
        .filter((key) => number(input.Timing[key]))
        .map((key) => [key, input.Timing[key]]),
    );
    // PostgreSQL 17 splits Generation into Deform and Total; 16 uses a number.
    if (input.Timing.Generation && typeof input.Timing.Generation === 'object') {
      output.Timing.Generation = Object.fromEntries(
        ['Deform', 'Total']
          .filter((key) => number(input.Timing.Generation[key]))
          .map((key) => [key, input.Timing.Generation[key]]),
      );
    }
  }
  return output;
}

export function sanitizePlan(input, limits = LIMITS) {
  let nodes = 0;
  let truncated = false;
  function visit(node, depth) {
    if (!node || typeof node !== 'object') {
      truncated = true;
      return null;
    }
    if (++nodes > limits.planNodes || depth > limits.planDepth) {
      truncated = true;
      return null;
    }
    const result = { 'Node Type': NODES.has(node['Node Type']) ? node['Node Type'] : 'Other' };
    for (const key of NUMBERS) if (number(node[key])) result[key] = node[key];
    for (const key of ['Parallel Aware', 'Async Capable', 'Inner Unique']) {
      if (typeof node[key] === 'boolean') result[key] = node[key];
    }
    if (RELATIONS.has(node['Relation Name'])) result['Relation Name'] = node['Relation Name'];
    if (['Inner', 'Left', 'Right', 'Full', 'Semi', 'Anti'].includes(node['Join Type'])) {
      result['Join Type'] = node['Join Type'];
    }
    if (Array.isArray(node.Plans)) {
      result.Plans = [];
      for (const child of node.Plans) {
        const clean = visit(child, depth + 1);
        if (clean) result.Plans.push(clean);
        if (truncated) break;
      }
    }
    return result;
  }
  /** @type {Record<string, unknown>} */
  const output = { Plan: visit(input?.Plan, 0) };
  const jit = sanitizeJit(input?.JIT);
  if (jit) output.JIT = jit;
  for (const key of ['Planning Time', 'Execution Time'])
    if (number(input?.[key])) output[key] = input[key];
  // Never copy Query Text, Query Parameters, Output, Filter, Index/Join Cond,
  // aliases, sort/group keys, arbitrary relation/index names or error context.
  return { output, truncated, nodes: Math.min(nodes, limits.planNodes) };
}

export function createNoticeCollector(functions, abort, limits = LIMITS) {
  const known = new Map([
    [statement(OUTER_QUERY), 'outer_read'],
    ...functions.map((item) => [statement(item.body), item.name]),
  ]);
  const groups = Object.fromEntries(
    ['outer_read', ...FUNCTIONS.map(([name]) => name), 'unclassified'].map((name) => [
      name,
      {
        count: 0,
        inclusiveDurationMs: 0,
        maxDurationMs: 0,
        jitTotalMs: null,
        jitTimedPlans: 0,
        planningTimedPlans: 0,
        samples: /** @type {Array<Record<string, unknown> & {durationMs: number}>} */ ([]),
      },
    ]),
  );
  let count = 0;
  let bytes = 0;
  let ignored = 0;
  let stopped = false;
  let reason = null;
  const stop = (value) => {
    if (!stopped) {
      stopped = true;
      reason = value;
      abort(value);
    }
  };
  return {
    notice(notice) {
      if (stopped) return;
      const message = typeof notice?.message === 'string' ? notice.message : '';
      const size = Buffer.byteLength(message);
      bytes += size;
      if (++count > limits.notices || size > limits.noticeBytes || bytes > limits.allNoticeBytes) {
        stop('notice_cap');
        return;
      }
      const prefix = /^duration: ([0-9]+(?:\.[0-9]+)?) ms {2}plan:\n/.exec(message);
      if (notice?.severity !== 'NOTICE' || !prefix) {
        ignored += 1;
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(message.slice(prefix[0].length));
      } catch {
        stop('invalid_native_plan');
        return;
      }
      if (typeof parsed?.['Query Text'] !== 'string' || !parsed?.Plan) {
        stop('invalid_native_plan');
        return;
      }
      const label = known.get(statement(parsed['Query Text'])) ?? 'unclassified';
      const { output, truncated } = sanitizePlan(parsed, limits);
      const durationMs = Number(prefix[1]);
      if (!number(durationMs)) {
        stop('invalid_native_plan');
        return;
      }
      const group = groups[label];
      group.count += 1;
      group.inclusiveDurationMs += durationMs;
      group.maxDurationMs = Math.max(group.maxDurationMs, durationMs);
      if (number(output.JIT?.Timing?.Total)) {
        group.jitTotalMs = (group.jitTotalMs ?? 0) + output.JIT.Timing.Total;
        group.jitTimedPlans += 1;
      }
      if (number(output['Planning Time'])) group.planningTimedPlans += 1;
      group.samples.push({ durationMs, ...output });
      group.samples.sort((a, b) => b.durationMs - a.durationMs);
      group.samples.length = Math.min(group.samples.length, limits.samplesPerFunction);
      if (truncated) stop('plan_cap');
    },
    finish() {
      stopped = true;
      return {
        notices: count,
        noticeBytes: bytes,
        ignoredNotices: ignored,
        truncated: reason !== null,
        truncationReason: reason,
        groups,
        missingNativePlans: ['outer_read', ...FUNCTIONS.map(([name]) => name)].filter(
          (name) => groups[name].count === 0,
        ),
        durationAccounting: 'inclusive per function; do not add parent and nested durations',
      };
    },
  };
}

// pg 8.13.1 Client.end() can wait indefinitely after a successful idle query.
// A race alone leaks that socket. This owns and destroys only this probe client.
export function ownedConnection(client, closeMs = LIMITS.closeMs) {
  let closing;
  let closed = false;
  const state = { forced: false };
  client.on('error', () => undefined);
  const destroy = () => {
    if (closed) return;
    state.forced = true;
    try {
      client.connection?.stream?.destroy();
    } catch {
      /* Already disconnected. */
    }
  };
  return {
    client,
    state,
    destroy,
    close() {
      if (closing) return closing;
      closing = new Promise((done) => {
        const finish = () => {
          closed = true;
          globalThis.clearTimeout(timer);
          done();
        };
        const force = () => {
          destroy();
          finish();
        };
        const timer = globalThis.setTimeout(force, closeMs);
        try {
          Promise.resolve(client.end()).then(finish, force);
        } catch {
          force();
        }
      });
      return closing;
    },
  };
}

const SETTINGS_QUERY = 'SELECT name, setting, unit FROM pg_catalog.pg_settings ORDER BY name';
const ROLE_QUERY = `SELECT current_user = 'asalab_app' AS app_role,
  session_user = current_user AS same_session_user,
  role.rolsuper AS superuser, role.rolbypassrls AS bypass_rls,
  has_function_privilege(current_user,'public.learning_canonical_evidence_for_teacher_account(uuid)','EXECUTE') AS can_read,
  has_function_privilege(current_user,'public.learning_canonical_evidence_internal(uuid,uuid,boolean)','EXECUTE') AS can_read_internal
  FROM pg_catalog.pg_roles role WHERE role.rolname = current_user`;
const FIXTURE_QUERY = `SELECT link.account_id
  FROM public.tenants tenant JOIN public.users teacher ON teacher.tenant_id=tenant.id
  JOIN public.legacy_user_account_links link ON link.tenant_id=tenant.id AND link.user_id=teacher.id
  JOIN public.accounts account ON account.id=link.account_id
  WHERE tenant.title='Тест learning-vs-002' AND teacher.display_name='Педагог learning-vs-002'
    AND teacher.role='teacher' AND teacher.email=account.email
    AND account.email LIKE 'teacher-learning-vs-002-%@test.local'
  LIMIT 2`;
const CARDINALITY_QUERY = `SELECT
  row_number() OVER (ORDER BY membership.classroom_id)::int AS class_ordinal,
  (SELECT count(*)::int FROM public.classroom_assignments a WHERE a.classroom_id=membership.classroom_id) AS assignments,
  (SELECT count(*)::int FROM public.classroom_student_seats s WHERE s.classroom_id=membership.classroom_id) AS seats,
  (SELECT count(*)::int FROM public.activity_runs r WHERE r.classroom_id=membership.classroom_id) AS runs,
  (SELECT count(*)::int FROM public.activity_participations p JOIN public.activity_runs r ON r.id=p.activity_run_id WHERE r.classroom_id=membership.classroom_id) AS participations,
  (SELECT count(*)::int FROM public.learning_attempts t JOIN public.classroom_assignments a ON a.id=t.classroom_assignment_id WHERE a.classroom_id=membership.classroom_id) AS attempts,
  (SELECT count(*)::int FROM public.assessment_results result JOIN public.learning_attempts t ON t.id=result.attempt_id JOIN public.classroom_assignments a ON a.id=t.classroom_assignment_id WHERE a.classroom_id=membership.classroom_id) AS results
  FROM public.classroom_memberships membership
  WHERE membership.account_id=$1 AND membership.member_role IN ('owner','co_teacher')
  ORDER BY membership.classroom_id LIMIT 65`;

export async function runProbe(env, source, injectedDriver) {
  const report = {
    schema: 'asa-teacher-home-plan-probe/v1',
    status: 'INCOMPLETE',
    stage: 'configuration',
    limits: LIMITS,
    source: null,
    limitations: [
      'Post-gate replay of the surviving fixture, not the historical PID217 snapshot or a business acceptance run.',
      'The gate process has exited; load, caches and fixture phase may differ. A fast replay does not exclude contention.',
      'SET LOCAL ROLE preserves effective app privileges but session_user remains the test admin; it is not a login-equivalent session.',
      'Nested durations are inclusive. log_analyze/log_timing add overhead; these are not original query durations.',
      'auto_explain does not separately time every nested planner invocation; absent JIT/planning timing is unavailable, not zero.',
      'No optimizer GUC, index, cache or product fix is selected by this diagnostic.',
    ],
  };
  const connections = [];
  const cancelAwait = new Set();
  let collector;
  let aborted;
  let totalTimer;
  let finished = false;
  const started = Date.now();
  const abort = (reason) => {
    aborted ??= reason;
    for (const connection of connections) connection.destroy();
    for (const cancel of cancelAwait) cancel();
  };
  const bounded = async (operation, milliseconds, reason) => {
    requireThat(!aborted, aborted ?? 'observer_aborted');
    let timer;
    let cancel;
    try {
      const value = await Promise.race([
        operation(),
        new Promise((_, reject) => {
          cancel = () => {
            const error = new Error(aborted ?? reason);
            error.probeReason = aborted ?? reason;
            reject(error);
          };
          cancelAwait.add(cancel);
          timer = globalThis.setTimeout(() => abort(reason), milliseconds);
        }),
      ]);
      requireThat(!aborted, aborted ?? 'observer_aborted');
      return value;
    } finally {
      globalThis.clearTimeout(timer);
      cancelAwait.delete(cancel);
    }
  };
  try {
    const config = readConfiguration(env, source.digest);
    report.source = {
      sha: config.sourceSha,
      digest: source.digest,
      migrationCount: source.migrations.length,
      lastMigration: source.migrations.at(-1).version,
    };
    report.lane = config.lane;
    const pg = injectedDriver ?? (await import('pg')).default;
    const app = ownedConnection(
      new pg.Client({
        connectionString: config.urls[1],
        application_name: 'asa-teacher-home-plan-probe',
        connectionTimeoutMillis: LIMITS.connectMs,
      }),
    );
    const observer = ownedConnection(
      new pg.Client({
        connectionString: config.urls[0],
        application_name: 'asa-teacher-home-plan-probe',
        connectionTimeoutMillis: LIMITS.connectMs,
      }),
    );
    connections.push(app, observer);
    const query = (connection, text, values) =>
      bounded(() => connection.client.query(text, values), LIMITS.metadataMs, 'metadata_deadline');
    const execute = async () => {
      report.stage = 'connect';
      await bounded(() => app.client.connect(), LIMITS.connectMs, 'connect_deadline');
      await bounded(() => observer.client.connect(), LIMITS.connectMs, 'connect_deadline');
      await query(app, 'BEGIN READ ONLY');
      await query(observer, 'BEGIN READ ONLY');
      report.stage = 'runtime_defaults';
      const runtimeSettings = (await query(app, SETTINGS_QUERY)).rows;
      const runtimeRole = (await query(app, ROLE_QUERY)).rows[0];
      requireThat(
        runtimeRole?.app_role &&
          runtimeRole.same_session_user &&
          !runtimeRole.superuser &&
          !runtimeRole.bypass_rls &&
          runtimeRole.can_read &&
          !runtimeRole.can_read_internal,
        'runtime_role_mismatch',
      );
      await query(observer, 'SET LOCAL ROLE asalab_app');
      const observerSettings = (await query(observer, SETTINGS_QUERY)).rows;
      const observerRole = (await query(observer, ROLE_QUERY)).rows[0];
      const roleValues = (row) =>
        Object.fromEntries(
          [
            'app_role',
            'same_session_user',
            'superuser',
            'bypass_rls',
            'can_read',
            'can_read_internal',
          ].map((key) => [key, row?.[key] === true]),
        );
      report.roles = { runtime: roleValues(runtimeRole), observer: roleValues(observerRole) };
      requireThat(
        observerRole?.app_role &&
          !observerRole.same_session_user &&
          !observerRole.superuser &&
          !observerRole.bypass_rls &&
          observerRole.can_read &&
          !observerRole.can_read_internal,
        'observer_role_mismatch',
      );
      report.settings = compareSettings(runtimeSettings, observerSettings);
      requireThat(report.settings.equal, 'default_settings_mismatch');
      requireThat(
        /^\d+$/.test(report.settings.runtime.server_version_num ?? '') &&
          Number(report.settings.runtime.server_version_num) >= 160000 &&
          Number(report.settings.runtime.server_version_num) < 180000,
        'unsupported_postgres_version',
      );
      report.serverVersionNum = Number(report.settings.runtime.server_version_num);
      await app.close();
      await query(observer, 'RESET ROLE');
      await query(observer, "SET LOCAL statement_timeout='4s'");
      report.stage = 'source_and_fixture';
      const ledger = (
        await query(
          observer,
          'SELECT version, checksum FROM public.schema_migrations ORDER BY version LIMIT 1001',
        )
      ).rows;
      requireThat(
        JSON.stringify(ledger) === JSON.stringify(source.migrations),
        'migration_ledger_mismatch',
      );
      report.migrationLedgerMatches = true;
      const definitions = (
        await query(
          observer,
          `SELECT p.proname AS name, p.prosrc AS body,
        p.provolatile AS volatility, p.prosecdef AS definer, p.proconfig AS config, l.lanname AS language
        FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang
        WHERE p.oid=ANY($1::regprocedure[])`,
          [source.functions.map((item) => item.signature)],
        )
      ).rows;
      report.functions = verifyFunctions(definitions, source.functions);
      const fixtures = (await query(observer, FIXTURE_QUERY)).rows;
      report.fixtureMatches = fixtures.length;
      requireThat(fixtures.length === 1, 'fixture_not_unique');
      const accountId = fixtures[0].account_id;
      requireThat(
        typeof accountId === 'string' &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(accountId),
        'fixture_identity_invalid',
      );
      const counts = (await query(observer, CARDINALITY_QUERY, [accountId])).rows;
      requireThat(
        counts.length > 0 && counts.length <= LIMITS.classes,
        'class_cardinality_unavailable',
      );
      report.cardinality = counts.map((row) =>
        Object.fromEntries(
          [
            'class_ordinal',
            'assignments',
            'seats',
            'runs',
            'participations',
            'attempts',
            'results',
          ].map((key) => {
            requireThat(Number.isSafeInteger(row[key]) && row[key] >= 0, 'cardinality_invalid');
            return [key, row[key]];
          }),
        ),
      );
      report.stage = 'load_native_observer';
      await query(observer, "LOAD 'auto_explain'");
      // Logging settings only, local to this read-only transaction. NOTICE goes
      // to the private client sanitizer; server logging excludes it and params.
      // Timing must be on: PG REL_17_7 ExplainPrintJIT gates Timing on analyze && timing.
      // https://github.com/postgres/postgres/blob/REL_17_7/src/backend/commands/explain.c
      await query(
        observer,
        `SET LOCAL log_min_messages='warning';
        SET LOCAL log_min_error_statement='panic'; SET LOCAL log_error_verbosity='terse';
        SET LOCAL log_parameter_max_length=0; SET LOCAL log_parameter_max_length_on_error=0;
        SET LOCAL client_min_messages='notice'; SET LOCAL auto_explain.log_min_duration=0;
        SET LOCAL auto_explain.log_analyze=on; SET LOCAL auto_explain.log_buffers=on;
        SET LOCAL auto_explain.log_timing=on; SET LOCAL auto_explain.log_nested_statements=on;
        SET LOCAL auto_explain.log_format='json'; SET LOCAL auto_explain.log_level='notice';
        SET LOCAL auto_explain.log_settings=on; SET LOCAL auto_explain.log_parameter_max_length=0;
        SET LOCAL statement_timeout='30s'; SET LOCAL idle_in_transaction_session_timeout='35s';
        SET LOCAL ROLE asalab_app`,
      );
      collector = createNoticeCollector(source.functions, abort);
      observer.client.on('notice', collector.notice);
      report.stage = 'canonical_native_read';
      const readStarted = Date.now();
      report.rows = 0;
      await bounded(
        () =>
          new Promise((done, reject) => {
            // No callback/query_timeout: pg 8.13.1 otherwise accumulates all rows.
            // The owned deadline destroys the socket; events consume evidence privately.
            const read = new pg.Query({ text: OUTER_QUERY, values: [accountId] });
            read.on('row', () => {
              if (finished || aborted) return;
              if (++report.rows > LIMITS.resultRows) abort('result_row_cap');
            });
            read.on('end', done);
            read.on('error', reject);
            observer.client.query(read);
          }),
        LIMITS.queryMs,
        'canonical_query_deadline',
      );
      report.instrumentedQueryMs = Date.now() - readStarted;
      observer.client.removeListener('notice', collector.notice);
      report.native = collector.finish();
      requireThat(
        !report.native.truncated && report.native.missingNativePlans.length === 0,
        'nested_plans_incomplete',
      );
      report.status = 'NATIVE_PLANS_CAPTURED';
      report.stage = 'completed';
      // Closing the dedicated connection rolls back its read-only transaction.
    };
    await Promise.race([
      execute(),
      new Promise((_, reject) => {
        totalTimer = globalThis.setTimeout(() => {
          abort('total_deadline');
          const error = new Error('total_deadline');
          error.probeReason = 'total_deadline';
          reject(error);
        }, LIMITS.totalMs);
      }),
    ]);
  } catch (error) {
    report.status = report.source === null ? 'REFUSED' : 'INCOMPLETE';
    report.reason = aborted ?? error?.probeReason ?? 'observer_error';
    // Never serialize message, stack, detail, hint, where, query or parameters.
    if (typeof error?.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code))
      report.sqlState = error.code;
  } finally {
    finished = true;
    globalThis.clearTimeout(totalTimer);
    if (collector && !report.native) report.native = collector.finish();
    await Promise.all(connections.map((connection) => connection.close()));
    report.forcedSocketCloses = connections.filter((connection) => connection.state.forced).length;
    report.elapsedMs = Date.now() - started;
  }
  return report;
}

export function serializeReport(report, limit = LIMITS.artifactBytes) {
  let serialized = JSON.stringify(report, null, 2);
  if (Buffer.byteLength(serialized) > limit) {
    // No unbounded artifact: retain identity and honest failure, not a cropped JSON file.
    serialized = JSON.stringify(
      {
        schema: report.schema,
        source: report.source,
        status: 'INCOMPLETE',
        reason: 'artifact_cap',
        stage: report.stage,
        limitations: [
          'Native evidence exceeded the artifact bound; no complete plan capture is claimed.',
        ],
      },
      null,
      2,
    );
  }
  return `${serialized}\n`;
}

async function main() {
  try {
    const source = readSource();
    if (process.argv.length === 3 && process.argv[2] === '--source-digest') {
      process.stdout.write(`${source.digest}\n`);
      return;
    }
    requireThat(process.argv.length === 2, 'unknown_argument');
    const report = await runProbe(process.env, source);
    const json = serializeReport(report);
    process.stdout.write(json);
    process.exitCode = JSON.parse(json).status === 'NATIVE_PLANS_CAPTURED' ? 0 : 2;
  } catch {
    process.stdout.write(
      '{"schema":"asa-teacher-home-plan-probe/v1","status":"REFUSED","reason":"source_or_configuration_invalid"}\n',
    );
    process.exitCode = 2;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await main();
