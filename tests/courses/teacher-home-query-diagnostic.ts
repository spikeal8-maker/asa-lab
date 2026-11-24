import { createHash } from 'node:crypto';
import pg from 'pg';

const MEASUREMENT_MS = 52_000;
const WATCHDOG_MS = 55_000;
const CLEANUP_MS = 3_000;
const CONTROL_MS = 2_000;
const READ_MS = 15_000;
const EVIDENCE_SQL = 'SELECT evidence FROM learning_canonical_evidence_for_teacher_account($1)';

interface Lease {
  client: pg.PoolClient;
  released: boolean;
}

interface Trial {
  mode: 'default' | 'off' | 'restored';
  jit: string;
  limit_ms: number;
  duration_ms: number;
  outcome: 'complete' | 'server_cancelled_57014';
  row_count: number | null;
  result_sha256: string | null;
  snapshot_sha256: string;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
      .join(',')}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error('Non-JSON diagnostic result');
  return encoded;
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sqlstate(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null;
  return typeof error.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code) ? error.code : null;
}

function emit(event: string, fields: Record<string, unknown>) {
  console.info(`[Teacher Home query diagnostic] ${JSON.stringify({ event, ...fields })}`);
}

const SETTINGS_SQL = `SELECT current_user::text AS current_role, session_user::text AS session_role,
  pg_backend_pid() AS backend_pid, current_setting('server_version') AS server_version,
  current_setting('server_version_num') AS server_version_num,
  current_setting('jit') AS jit, current_setting('jit_above_cost') AS jit_above_cost,
  current_setting('jit_inline_above_cost') AS jit_inline_above_cost,
  current_setting('jit_optimize_above_cost') AS jit_optimize_above_cost,
  current_setting('plan_cache_mode') AS plan_cache_mode,
  current_setting('row_security') AS row_security,
  current_setting('transaction_isolation') AS transaction_isolation,
  current_setting('transaction_read_only') AS transaction_read_only,
  current_setting('statement_timeout') AS statement_timeout,
  current_setting('app.tenant_id',true) AS tenant_context`;

const COUNTS_SQL = `WITH owned AS (
  SELECT DISTINCT classroom_id FROM public.classroom_memberships
   WHERE account_id=$1 AND member_role IN ('owner','co_teacher')
)
SELECT jsonb_build_object(
  'teacher_memberships',(SELECT count(*) FROM public.classroom_memberships WHERE account_id=$1 AND member_role IN ('owner','co_teacher')),
  'owned_classes',(SELECT count(*) FROM owned),
  'owned_seats',(SELECT count(*) FROM public.classroom_student_seats seat JOIN owned ON owned.classroom_id=seat.classroom_id),
  'owned_assignments',(SELECT count(*) FROM public.classroom_assignments assignment JOIN owned ON owned.classroom_id=assignment.classroom_id),
  'owned_attempts',(SELECT count(*) FROM public.learning_attempts attempt JOIN public.classroom_assignments assignment ON assignment.id=attempt.classroom_assignment_id JOIN owned ON owned.classroom_id=assignment.classroom_id),
  'relation_estimates',(SELECT jsonb_agg(jsonb_build_object(
    'relation',relation.relname,'estimated_rows',relation.reltuples,
    'estimated_live_rows',stats.n_live_tup,'last_analyze',stats.last_analyze,
    'last_autoanalyze',stats.last_autoanalyze) ORDER BY relation.relname)
    FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
    LEFT JOIN pg_stat_user_tables stats ON stats.relid=relation.oid
    WHERE namespace.nspname='public' AND relation.relname IN (
      'classroom_memberships','classrooms','classroom_student_seats','classroom_assignments',
      'learning_attempts','assessment_results','learning_submissions','activity_runs',
      'activity_participations','learner_identity_links','principals','gradebook_entries'))
) AS counts`;

/** Diagnostic branch only: fresh sessions and the fixture immediately BEFORE Teacher Home.
 * No fixture writes, product substitutions, or production-performance acceptance.
 */
export async function diagnoseTeacherHomeQuery(
  sourceAdmin: pg.Pool,
  sourceApp: pg.Pool,
  accountId: string,
) {
  const started = performance.now();
  const deadline = started + MEASUREMENT_MS;
  let failed = false;
  const pools = [sourceAdmin, sourceApp].map(
    (source) =>
      new pg.Pool({
        ...source.options,
        // pg-pool stores a separately supplied password as a non-enumerable option.
        password: source.options.password,
        max: 1,
        connectionTimeoutMillis: CONTROL_MS,
        statement_timeout: CONTROL_MS,
      }),
  );
  pools.forEach((pool) =>
    pool.on('error', () => {
      failed = true;
      emit('pool_error', {});
    }),
  );
  const leases: Lease[] = [];
  const release = (lease: Lease, destroy = false) => {
    if (lease.released) return;
    lease.released = true;
    lease.client.release(destroy);
  };
  let stopped = false;
  const watchdog = setTimeout(() => {
    stopped = true;
    leases.forEach((lease) => release(lease, true));
    emit('watchdog', { total_ms: Math.round(performance.now() - started) });
  }, WATCHDOG_MS);
  const query = async <Row extends pg.QueryResultRow = pg.QueryResultRow>(
    lease: Lease,
    text: string,
    values: unknown[] = [],
    end = deadline,
    limit = CONTROL_MS,
  ): Promise<pg.QueryResult<Row>> => {
    const remaining = Math.floor(end - performance.now());
    if (stopped || lease.released || remaining <= 0) throw new Error('Diagnostic budget exhausted');
    // pg 8.13.1 supports a per-query timeout; its installed @types only declares the pool option.
    const config: pg.QueryConfig & { query_timeout: number } = {
      text,
      values,
      query_timeout: Math.min(limit, remaining),
    };
    return lease.client.query<Row>(config);
  };
  const trials: Trial[] = [];
  let runtime: Lease | undefined;
  let baseline: pg.QueryResultRow | undefined;
  let sessionRestored = false;
  let poolsEnded: boolean;
  let readOnlySnapshot = false;
  emit('start', {
    fixture: 'pre_teacher_home_without_its_new_class_seat_attempt',
    session: 'fresh_diagnostic_backend_not_original_cached_plan_history',
    bounds_ms: { measurement: MEASUREMENT_MS, watchdog: WATCHDOG_MS, cleanup: CLEANUP_MS },
  });
  try {
    const observer = { client: await pools[0].connect(), released: false };
    leases.push(observer);
    await query(observer, 'BEGIN READ ONLY');
    const counts = await query(observer, COUNTS_SQL, [accountId]);
    emit('counts', {
      counts: counts.rows[0].counts,
      owned_counts_exact: true,
      global_relation_counts_are_estimates: true,
    });
    await query(observer, 'ROLLBACK');
    release(observer);

    runtime = { client: await pools[1].connect(), released: false };
    leases.push(runtime);
    const initialSettings = (await query(runtime, SETTINGS_SQL)).rows[0];
    if (!initialSettings) throw new Error('Missing diagnostic session settings');
    baseline = initialSettings;
    const { tenant_context: tenantContext, ...safeSettings } = initialSettings;
    emit('baseline_settings', { ...safeSettings, tenant_context_present: Boolean(tenantContext) });
    if (
      initialSettings.current_role !== 'asalab_app' ||
      initialSettings.session_role !== 'asalab_app' ||
      initialSettings.row_security !== 'on'
    ) {
      throw new Error('Unexpected diagnostic runtime role');
    }
    await query(runtime, 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const snapshot = (
      await query(
        runtime,
        `SELECT pg_current_snapshot()::text AS snapshot,
        current_setting('transaction_isolation') AS isolation,
        current_setting('transaction_read_only') AS read_only`,
      )
    ).rows[0];
    readOnlySnapshot = snapshot.isolation === 'repeatable read' && snapshot.read_only === 'on';
    if (!readOnlySnapshot) throw new Error('Unexpected diagnostic transaction');
    const planResult = await query(runtime, `EXPLAIN (FORMAT JSON, SETTINGS) ${EVIDENCE_SQL}`, [
      accountId,
    ]);
    const plan = planResult.rows[0]['QUERY PLAN'][0].Plan;
    emit('outer_wrapper_plan_only', {
      node_type: plan['Node Type'],
      startup_cost: plan['Startup Cost'],
      total_cost: plan['Total Cost'],
      estimated_rows: plan['Plan Rows'],
      width: plan['Plan Width'],
      analyzed: false,
      nested_plan_or_jit_cost_observed: false,
    });

    for (const mode of ['default', 'off', 'restored'] as const) {
      const limit = Math.min(READ_MS, Math.floor(deadline - performance.now() - CONTROL_MS));
      if (limit <= 0) throw new Error('Diagnostic measurement budget exhausted');
      const jit = mode === 'off' ? 'off' : String(initialSettings.jit);
      await query(runtime, 'SAVEPOINT diagnostic_mode');
      const applied = (
        await query(
          runtime,
          `SELECT set_config('jit',$1,true) AS jit,
            set_config('statement_timeout',$2,true) AS statement_timeout,
            pg_current_snapshot()::text AS snapshot`,
          [jit, String(limit)],
        )
      ).rows[0];
      if (applied.jit !== jit || applied.snapshot !== snapshot.snapshot) {
        throw new Error('Diagnostic session or snapshot changed');
      }
      const trial: Trial = {
        mode,
        jit,
        limit_ms: limit,
        duration_ms: 0,
        outcome: 'server_cancelled_57014',
        row_count: null,
        result_sha256: null,
        snapshot_sha256: digest(applied.snapshot),
      };
      const readStarted = performance.now();
      emit('read_started', { mode, jit, limit_ms: limit, snapshot_sha256: trial.snapshot_sha256 });
      try {
        const rows = await query<{ evidence: unknown }>(
          runtime,
          EVIDENCE_SQL,
          [accountId],
          deadline,
          limit + 500,
        );
        trial.duration_ms = Math.round(performance.now() - readStarted);
        trial.row_count = rows.rows.length;
        // Sort only object keys and the complete row multiset. Keep duplicates and nested array order.
        trial.result_sha256 = digest(
          JSON.stringify(rows.rows.map((row) => canonicalJson(row.evidence)).sort()),
        );
        trial.outcome = 'complete';
      } catch (error) {
        trial.duration_ms = Math.round(performance.now() - readStarted);
        if (sqlstate(error) !== '57014') throw error;
      }
      trials.push(trial);
      emit('read', { ...trial });
      // This also restores the mode-local jit/statement_timeout after a server-side cancellation.
      await query(runtime, 'ROLLBACK TO SAVEPOINT diagnostic_mode');
      await query(runtime, 'RELEASE SAVEPOINT diagnostic_mode');
    }
  } catch (error) {
    failed = true;
    emit('inconclusive', {
      sqlstate: sqlstate(error),
      total_ms: Math.round(performance.now() - started),
    });
    // Non-57014 query/client/connection failures never continue on a possibly broken session.
    leases.forEach((lease) => release(lease, true));
  } finally {
    const cleanupDeadline = Math.min(started + WATCHDOG_MS, performance.now() + CLEANUP_MS);
    try {
      if (runtime && !runtime.released && baseline) {
        await query(runtime, 'ROLLBACK', [], cleanupDeadline);
        const after = (await query(runtime, SETTINGS_SQL, [], cleanupDeadline)).rows[0];
        sessionRestored = canonicalJson(after) === canonicalJson(baseline);
      }
    } catch (error) {
      failed = true;
      emit('cleanup_inconclusive', { sqlstate: sqlstate(error) });
    }
    leases.forEach((lease) => release(lease, !sessionRestored));
    let endTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const endings = Promise.allSettled(pools.map((pool) => pool.end()));
      poolsEnded = await Promise.race([
        endings.then((results) => results.every((result) => result.status === 'fulfilled')),
        new Promise<false>((resolve) => {
          endTimer = setTimeout(
            () => resolve(false),
            Math.max(0, cleanupDeadline - performance.now()),
          );
        }),
      ]);
    } finally {
      clearTimeout(endTimer);
      clearTimeout(watchdog);
    }
  }
  const complete =
    !failed &&
    !stopped &&
    readOnlySnapshot &&
    sessionRestored &&
    poolsEnded &&
    trials.length === 3 &&
    trials.every((trial) => trial.outcome === 'complete');
  const sameResults =
    complete &&
    trials.every(
      (trial) =>
        trial.row_count === trials[0].row_count && trial.result_sha256 === trials[0].result_sha256,
    );
  const result = {
    status: complete ? 'complete' : 'INCONCLUSIVE',
    same_results: sameResults,
    session_restored: sessionRestored,
    pools_ended: poolsEnded,
    jit_setting_contrast_available: baseline?.jit === 'on',
    total_ms: Math.round(performance.now() - started),
  };
  emit('finished', result);
  return result;
}
