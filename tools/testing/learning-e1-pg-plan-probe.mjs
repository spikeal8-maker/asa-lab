// TEMPORARY DIAGNOSTIC BRANCH ONLY. Never merge this probe into main.
// Runs after the unchanged General Data gate, against its surviving synthetic
// fixtures. No fixtures, migrations, function definitions or global settings change.
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';
import { pathToFileURL, URL } from 'node:url';
import pg from 'pg';

class ProbeError extends Error {
  constructor(code) {
    super(code);
    this.probeCode = code;
  }
}

function requireCondition(condition, code) {
  if (!condition) throw new ProbeError(code);
}

export function isolatedConfig(env) {
  requireCondition(
    env.CI === 'true' &&
      env.GITHUB_ACTIONS === 'true' &&
      env.ASA_E1_PG_PLAN_PROBE === 'full-context-read-only',
    'diagnostic_ci_flag_required',
  );
  let admin;
  let runtime;
  try {
    admin = new URL(env.TEST_DATABASE_URL);
    runtime = new URL(env.APP_TEST_DATABASE_URL);
  } catch {
    throw new ProbeError('isolated_urls_required');
  }
  requireCondition(
    [admin, runtime].every(
      (url) =>
        ['postgres:', 'postgresql:'].includes(url.protocol) &&
        url.hostname === 'postgres' &&
        (url.port || '5432') === '5432' &&
        /^\/[a-z][a-z0-9_]*_test$/.test(url.pathname) &&
        !url.search &&
        !url.hash,
    ) &&
      admin.pathname === runtime.pathname &&
      admin.username === 'asalab_admin' &&
      runtime.username === 'asalab_app',
    'isolated_urls_required',
  );
  return {
    adminUrl: admin.href,
    runtimeUrl: runtime.href,
    database: admin.pathname.slice(1),
  };
}

export function verifyConnection(row, database, runtime) {
  requireCondition(
    row?.database === database &&
      database.endsWith('_test') &&
      row.sessionRole === (runtime ? 'asalab_app' : 'asalab_admin') &&
      row.currentRole === row.sessionRole &&
      row.readOnly === true &&
      row.repeatableRead === true,
    'connection_identity_rejected',
  );
  if (runtime) {
    requireCondition(
      row.privileged === false && row.ownerMember === false,
      'restricted_runtime_role_required',
    );
  }
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}

export function resultDigest(rows) {
  // SQL row order is not promised by the teacher wrapper. Preserve JSON array
  // order (roster ranking, activity chronology), but compare the SQL row multiset.
  return createHash('sha256')
    .update(JSON.stringify(rows.map((row) => JSON.stringify(canonical(row))).sort()))
    .digest('hex');
}

const planFields = {
  'Startup Cost': 'startupCost',
  'Total Cost': 'totalCost',
  'Plan Rows': 'estimatedRows',
  'Plan Width': 'estimatedWidth',
  'Actual Rows': 'actualRows',
  'Actual Loops': 'actualLoops',
  'Shared Hit Blocks': 'sharedHitBlocks',
  'Shared Read Blocks': 'sharedReadBlocks',
  'Shared Dirtied Blocks': 'sharedDirtiedBlocks',
  'Shared Written Blocks': 'sharedWrittenBlocks',
  'Temp Read Blocks': 'tempReadBlocks',
  'Temp Written Blocks': 'tempWrittenBlocks',
  'Rows Removed by Filter': 'rowsRemovedByFilter',
};

function numbers(source, fields) {
  return Object.fromEntries(
    Object.entries(fields)
      .filter(([key]) => typeof source?.[key] === 'number' && Number.isFinite(source[key]))
      .map(([key, label]) => [label, source[key]]),
  );
}

export function explainMetadata(document) {
  const root = document?.[0];
  requireCondition(root?.Plan && typeof root.Plan === 'object', 'explain_shape_rejected');
  const nodes = [];
  function visit(node, parent, depth) {
    requireCondition(nodes.length < 128 && depth < 32, 'explain_size_rejected');
    const index = nodes.length;
    nodes.push({ index, parent, depth, ...numbers(node, planFields) });
    for (const child of node.Plans ?? []) visit(child, index, depth + 1);
  }
  visit(root.Plan, -1, 0);
  return {
    ...numbers(root, { 'Planning Time': 'planningMs', 'Execution Time': 'executionMs' }),
    nodes,
    jitMetadataPresent: root.JIT ? 1 : 0,
    ...numbers(root.JIT, { Functions: 'jitFunctions' }),
    ...numbers(root.JIT?.Timing, {
      Generation: 'jitGenerationMs',
      Inlining: 'jitInliningMs',
      Optimization: 'jitOptimizationMs',
      Emission: 'jitEmissionMs',
      Total: 'jitTotalMs',
    }),
    // SECURITY DEFINER SQL bodies can hide nested plans/JIT from outer EXPLAIN.
    // Missing outer JIT metadata is not evidence that nested JIT did not run.
    nestedStatementsInstrumented: 0,
  };
}

function emit(event, details = {}) {
  process.stdout.write(`[E1 PG plan probe] ${JSON.stringify({ event, ...details })}\n`);
}

function safeError(error) {
  return {
    reason: error instanceof ProbeError ? error.probeCode : 'database_or_probe_error',
    // Do not print messages, stacks, SQL, arguments, rows, URLs or credentials.
    sqlState: /^[0-9A-Z]{5}$/.test(error?.code ?? '') ? error.code : null,
  };
}

const connectionIdentity = `
  SELECT current_database() AS database, session_user AS "sessionRole",
         current_user AS "currentRole",
         current_setting('transaction_read_only') = 'on' AS "readOnly",
         current_setting('transaction_isolation') = 'repeatable read' AS "repeatableRead",
         EXISTS (SELECT 1 FROM pg_roles r
                  WHERE (r.rolsuper OR r.rolbypassrls OR r.rolcreatedb
                         OR r.rolcreaterole OR r.rolreplication)
                    AND pg_has_role(r.oid, 'MEMBER')) AS privileged,
         pg_has_role(d.datdba, 'MEMBER') AS "ownerMember"
    FROM pg_database d WHERE d.datname = current_database()`;

const portalFixtures = `
  SELECT c.id AS "classId", link.principal_id AS "teacherActor",
         seat.id AS "seatId", seat_principal.id AS "seatActor",
         CASE WHEN seat.display_label = 'Анна' THEN 'roster' ELSE 'profile' END AS label
    FROM tenants t
    JOIN classrooms c ON c.tenant_id = t.id AND c.status <> 'deleted'
    JOIN legacy_user_account_links link ON link.tenant_id = t.id AND link.user_id = c.created_by
    JOIN accounts account ON account.id = link.account_id AND account.status = 'active'
    JOIN classroom_memberships membership ON membership.classroom_id = c.id
         AND membership.tenant_id = t.id AND membership.account_id = account.id
         AND membership.member_role = 'owner'
    JOIN classroom_student_seats seat ON seat.classroom_id = c.id AND seat.status = 'active'
    JOIN principals seat_principal ON seat_principal.seat_id = seat.id
         AND seat_principal.kind = 'student_seat'
   WHERE t.workspace_slug LIKE 'ws-participants-%' AND t.title LIKE 'Тест participants-%'
     AND account.email LIKE 'teacher-participants-%@test.local' AND c.title = 'Участники'
     AND ((seat.display_label = 'Анна' AND EXISTS (
            SELECT 1 FROM classroom_student_seats peer
             WHERE peer.classroom_id = c.id AND peer.display_label = 'Борис'))
       OR (seat.display_label = 'Аватар' AND EXISTS (
            SELECT 1 FROM classroom_custom_merits merit
             WHERE merit.classroom_id = c.id AND merit.title = 'Мастер')))
   ORDER BY c.id, seat.id`;

const teacherFixture = `
  SELECT link.account_id AS "accountId",
         array_agg(membership.classroom_id ORDER BY membership.classroom_id) AS "classIds"
    FROM tenants t
    JOIN legacy_user_account_links link ON link.tenant_id = t.id
    JOIN accounts account ON account.id = link.account_id AND account.status = 'active'
    JOIN classroom_memberships membership ON membership.account_id = account.id
         AND membership.member_role IN ('owner', 'co_teacher')
   WHERE t.workspace_slug LIKE 'ws-learning-vs-002-%' AND t.title = 'Тест learning-vs-002'
     AND account.email LIKE 'teacher-learning-vs-002-%@test.local'
   GROUP BY link.account_id`;

const snapshotIdentity = `SELECT pg_current_snapshot()::text AS snapshot,
                                transaction_timestamp()::text AS time`;

async function runProbe(config) {
  const clients = [];
  const deadline = setTimeout(() => {
    emit('failure', { reason: 'probe_deadline', sqlState: null });
    // Closing the process disconnects these read-only transactions. The workflow
    // still runs its always-cleanup stage; no original test deadline is changed.
    process.exit(1);
  }, 240_000);
  deadline.unref();
  async function connect(connectionString, runtime) {
    const client = new pg.Client({
      connectionString,
      connectionTimeoutMillis: 5_000,
      application_name: 'asa-e1-pg-plan-probe',
      options:
        '-c default_transaction_read_only=on -c statement_timeout=30000 -c lock_timeout=3000 -c idle_in_transaction_session_timeout=60000',
    });
    // Never allow pg's asynchronous error event to print connection information.
    client.on('error', () => {});
    clients.push(client);
    await client.connect();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    verifyConnection((await client.query(connectionIdentity)).rows[0], config.database, runtime);
    return client;
  }
  try {
    const admin = await connect(config.adminUrl, false);
    const portals = (await admin.query(portalFixtures)).rows;
    const roster = portals.filter((row) => row.label === 'roster');
    const profile = portals.filter((row) => row.label === 'profile');
    const teachers = (await admin.query(teacherFixture)).rows;
    requireCondition(
      roster.length === 1 && profile.length === 1 && teachers.length === 1,
      'synthetic_fixtures_missing_or_ambiguous',
    );
    const teacher = teachers[0];
    requireCondition(teacher.classIds.length >= 12, 'full_teacher_class_context_required');
    const population = (
      await admin.query(`SELECT
        (SELECT count(*)::int FROM classrooms) AS classrooms,
        (SELECT count(*)::int FROM classroom_student_seats) AS seats,
        (SELECT count(*)::int FROM classroom_assignments) AS assignments,
        (SELECT count(*)::int FROM activity_participations) AS participations,
        (SELECT count(*)::int FROM learning_attempts) AS attempts`)
    ).rows[0];
    // This connection only discovers existing synthetic fixtures and counts.
    await admin.query('ROLLBACK');
    await admin.end();
    clients.splice(clients.indexOf(admin), 1);

    const runtime = await connect(config.runtimeUrl, true);
    const identity = (await runtime.query(snapshotIdentity)).rows[0];
    const settings = (
      await runtime.query(`SELECT
        current_setting('server_version_num')::int AS "serverVersionNum",
        (current_setting('jit') = 'on')::int AS "baselineJitOn",
        pg_jit_available()::int AS "jitAvailable",
        current_setting('jit_above_cost')::float8 AS "jitAboveCost",
        current_setting('jit_inline_above_cost')::float8 AS "jitInlineAboveCost",
        current_setting('jit_optimize_above_cost')::float8 AS "jitOptimizeAboveCost"`)
    ).rows[0];
    const classCount = (
      await runtime.query('SELECT count(*)::int AS count FROM classroom_list_for_account($1)', [
        teacher.accountId,
      ])
    ).rows[0].count;
    requireCondition(classCount >= 12, 'full_teacher_visible_context_required');
    emit('context', {
      ...numbers(population, {
        classrooms: 'classrooms',
        seats: 'seats',
        assignments: 'assignments',
        participations: 'participations',
        attempts: 'attempts',
      }),
      ...numbers(settings, {
        serverVersionNum: 'serverVersionNum',
        baselineJitOn: 'baselineJitOn',
        jitAvailable: 'jitAvailable',
        jitAboveCost: 'jitAboveCost',
        jitInlineAboveCost: 'jitInlineAboveCost',
        jitOptimizeAboveCost: 'jitOptimizeAboveCost',
      }),
      teacherMembershipClassCount: teacher.classIds.length,
      teacherVisibleClassCount: classCount,
      readOnly: true,
      repeatableRead: true,
    });
    const cases = [
      {
        label: 'roster',
        sql: 'SELECT classroom_participant_roster($1,$2) AS data',
        args: [roster[0].teacherActor, roster[0].classId],
        valid: (rows) => rows.length === 1 && rows[0].data?.items?.length === 2,
        items: (rows) => rows[0].data.items.length,
      },
      {
        label: 'profile',
        sql: 'SELECT classroom_participant_profile($1,$2,$3) AS data',
        args: [profile[0].seatActor, profile[0].classId, profile[0].seatId],
        valid: (rows) =>
          rows.length === 1 &&
          rows[0].data?.student?.id === profile[0].seatId &&
          rows[0].data?.metrics?.seatId === profile[0].seatId,
        items: () => 1,
      },
      {
        label: 'teacher',
        sql: 'SELECT * FROM learning_canonical_evidence_for_teacher_account($1)',
        args: [teacher.accountId],
        valid: (rows) =>
          rows.length > 0 &&
          rows.every((row) => teacher.classIds.includes(row.evidence?.classroomId)),
        items: (rows) => rows.length,
      },
    ];
    const hashes = new Map();
    for (const [round, jit] of ['on', 'off', 'on', 'off'].entries()) {
      await runtime.query(jit === 'on' ? 'SET LOCAL jit = on' : 'SET LOCAL jit = off');
      for (const probe of cases) {
        const started = performance.now();
        const result = await runtime.query(probe.sql, probe.args);
        const durationMs = Math.round((performance.now() - started) * 100) / 100;
        requireCondition(probe.valid(result.rows), 'authorized_nonempty_result_required');
        const hash = resultDigest(result.rows);
        if (!hashes.has(probe.label)) hashes.set(probe.label, hash);
        const equal = hashes.get(probe.label) === hash;
        emit('sample', {
          label: probe.label,
          round: round + 1,
          jit,
          durationMs,
          rowCount: result.rows.length,
          itemCount: probe.items(result.rows),
          hash,
          equal,
        });
        requireCondition(equal, 'result_mismatch');
      }
    }
    for (const jit of ['on', 'off']) {
      await runtime.query(jit === 'on' ? 'SET LOCAL jit = on' : 'SET LOCAL jit = off');
      for (const probe of cases) {
        const started = performance.now();
        const result = await runtime.query(
          `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON, TIMING OFF) ${probe.sql}`,
          probe.args,
        );
        emit('explain', {
          label: probe.label,
          jit,
          durationMs: Math.round((performance.now() - started) * 100) / 100,
          plan: explainMetadata(result.rows[0]['QUERY PLAN']),
        });
      }
    }
    const finalIdentity = (await runtime.query(snapshotIdentity)).rows[0];
    requireCondition(
      finalIdentity.snapshot === identity.snapshot && finalIdentity.time === identity.time,
      'transaction_context_changed',
    );
    verifyConnection((await runtime.query(connectionIdentity)).rows[0], config.database, true);
    await runtime.query('ROLLBACK');
    emit('complete', {
      samples: 12,
      explains: 6,
      equalResults: true,
      stableSnapshot: true,
      stableTransactionTime: true,
    });
  } finally {
    await Promise.allSettled(clients.map((client) => client.end()));
    clearTimeout(deadline);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await runProbe(isolatedConfig(process.env));
  } catch (error) {
    emit('failure', safeError(error));
    process.exitCode = 1;
  }
}
