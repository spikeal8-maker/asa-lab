// Disposable post-failure diagnostic. Never a migration, repair or capacity gate.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import console from 'node:console';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

export const base = '409c6e8e6749d04681947da970a11d9d9fc98644';
export const branch = 'diagnostic/p0-origin-learner-list-20261107';
export const allowedPaths = [
  '.github/workflows/learning-e1-focused.yml',
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

/** Closed to the reviewed GitHub-hosted first E1 partition and its local DB. */
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
      env.GITHUB_HEAD_REF === branch,
    'DIAGNOSTIC_SOURCE_CONTEXT',
  );
  requireCondition(
    /^[a-f0-9]{40}$/.test(env.ASA_DIAGNOSTIC_SOURCE_SHA ?? '') &&
      /^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID ?? '') &&
      /^[1-9][0-9]*$/.test(env.GITHUB_RUN_ATTEMPT ?? ''),
    'DIAGNOSTIC_RUN_IDENTITY',
  );
  requireCondition(
    env.ASA_DIAGNOSTIC_BROWSER_OUTCOME === 'failure' && env.ASA_DIAGNOSTIC_BATCH === 'first',
    'DIAGNOSTIC_ORIGINAL_FAILURE_REQUIRED',
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

export function removeDiagnosticAdditions(value) {
  return value.replace(
    /^ *# P0_ORIGIN_DIAGNOSTIC_BEGIN\n[\s\S]*?^ *# P0_ORIGIN_DIAGNOSTIC_END\n/gm,
    '',
  );
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
  const original = execFileSync('git', ['show', base + ':' + allowedPaths[0]], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(
    removeDiagnosticAdditions(fs.readFileSync(path.join(root, allowedPaths[0]), 'utf8')),
    original,
  );
  return revision;
}

async function main() {
  const urls = validateEnvironment(process.env);
  const revision = verifySource();
  const directory = path.join(root, 'reports/diagnostics');
  fs.mkdirSync(directory, { recursive: true });
  const output = fs.mkdtempSync(path.join(directory, 'origin-list-'));
  const record = {
    format: 'asa-origin-list-post-failure-diagnostic-v1',
    source: revision,
    productBase: base,
    originalBrowserOutcome: 'failure',
    runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    startedAt: new Date().toISOString(),
    status: 'in_progress',
    events: [],
    interpretation: 'Diagnostic only; original E1 remains failed. Not N30 or release evidence.',
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
    record.status = 'diagnostic_complete_original_e1_failed';
  } catch (error) {
    record.status = 'diagnostic_failed_original_e1_failed';
    event({ stage: 'probe', status: 'failed', error: failure(error) });
    process.exitCode = 1;
  } finally {
    if (admin) {
      try {
        await admin.end();
      } catch (error) {
        record.status = 'diagnostic_failed_original_e1_failed';
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
          originalBrowserOutcome: 'failure',
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
