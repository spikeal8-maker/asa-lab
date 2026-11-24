import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { URL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';

const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function isolatedDatabase(raw) {
  const url = new URL(raw);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['127.0.0.1', 'localhost'].includes(url.hostname) ||
    !/^\/asa_lrn_1252_[a-z]+_test$/.test(url.pathname)
  ) {
    throw new Error('Diagnostic database must be a named loopback *_test database');
  }
  return url;
}

function driver(source) {
  return createRequire(path.join(source, 'package.json'))('pg');
}

export async function startPostgresMonitor(source, databaseUrl, directory) {
  isolatedDatabase(databaseUrl);
  const { Pool } = driver(source);
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    application_name: 'learning1252_monitor',
    connectionTimeoutMillis: 2000,
    statement_timeout: 1000,
    query_timeout: 1500,
  });
  const file = fs.createWriteStream(path.join(directory, 'postgres-activity.jsonl'));
  let stopped = false;
  let count = 0;
  const running = (async () => {
    while (!stopped) {
      const time = new Date().toISOString();
      try {
        const result = await pool.query(`SELECT pid, backend_start, application_name, state,
          wait_event_type,wait_event,pg_blocking_pids(pid) AS blocked_by,
          round(extract(epoch FROM clock_timestamp()-query_start)::numeric*1000,1) AS query_ms,
          round(extract(epoch FROM clock_timestamp()-xact_start)::numeric*1000,1) AS xact_ms,
          md5(query) AS query_hash,
          substring(query from '(?:FROM|from|SELECT|select) +([a-zA-Z_][a-zA-Z_0-9.]*)') AS operation
          FROM pg_stat_activity WHERE datname=current_database()
          AND pid<>pg_backend_pid() ORDER BY pid`);
        file.write(JSON.stringify({ time, sample: count++, sessions: result.rows }) + '\n');
      } catch (error) {
        file.write(JSON.stringify({ time, monitorError: error.code ?? error.name }) + '\n');
      }
      await delay(250);
    }
  })();
  return async () => {
    stopped = true;
    await running;
    await pool.end();
    await new Promise((resolve) => file.end(resolve));
    return count;
  };
}

/** Diagnostic intervention only: each JIT setting is transaction-local and rolled back.
 * No function, role, timeout, pool size or source file is changed by these probes. */
export async function probeLearnerOrigins(source, databaseUrl, directory, options = {}) {
  isolatedDatabase(databaseUrl);
  const { Client } = driver(source);
  const admin = new Client({
    connectionString: databaseUrl,
    application_name: 'learning1252_probe_discovery',
    connectionTimeoutMillis: 5000,
  });
  await admin.connect();
  let subjects;
  let settings;
  try {
    settings = (
      await admin.query(`SELECT name,setting FROM pg_settings
      WHERE name IN ('server_version','jit','jit_above_cost','jit_inline_above_cost',
      'jit_optimize_above_cost','max_connections','shared_buffers') ORDER BY name`)
    ).rows;
    subjects = options.identities
      ? []
      : (
          await admin.query(`SELECT seat.id AS seat_id,seat.account_id,
      count(DISTINCT origin.project_id)::int AS origins
      FROM classroom_student_seats seat
      JOIN learner_identity_links link ON link.seat_id=seat.id AND link.link_kind='student_seat'
      JOIN learning_project_origins origin ON origin.learner_identity_id=link.learner_identity_id
      AND origin.school_tenant_id=link.tenant_id AND origin.school_id=link.school_id
      JOIN activity_runs run ON run.id=origin.activity_run_id AND run.classroom_id=seat.classroom_id
      WHERE seat.status='active' AND link.status='active'
      GROUP BY seat.id,seat.account_id ORDER BY origins DESC,seat.id LIMIT 2`)
        ).rows;
    const emptyAccount = options.identities
      ? null
      : (
          await admin.query(`SELECT id FROM accounts account
      WHERE status='active' AND NOT EXISTS(SELECT 1 FROM classroom_student_seats seat
      WHERE seat.account_id=account.id) ORDER BY id LIMIT 1`)
        ).rows[0];
    if (emptyAccount) subjects.push({ seat_id: null, account_id: emptyAccount.id, origins: 0 });
    if (options.identities) {
      for (const identity of options.identities) {
        if (!['seat', 'account'].includes(identity.kind) || !/^[a-f0-9-]{36}$/.test(identity.id))
          throw new Error('Invalid browser identity');
        const verified = await admin.query(
          identity.kind === 'seat'
            ? 'SELECT id FROM classroom_student_seats WHERE id=$1'
            : 'SELECT id FROM accounts WHERE id=$1',
          [identity.id],
        );
        if (verified.rowCount !== 1)
          throw new Error('Browser identity is absent from this fixture');
        const origins = await admin.query(
          `SELECT count(DISTINCT origin.project_id)::int AS count
          FROM classroom_student_seats seat
          JOIN learner_identity_links link ON link.seat_id=seat.id AND link.link_kind='student_seat'
          JOIN learning_project_origins origin ON origin.learner_identity_id=link.learner_identity_id
            AND origin.school_tenant_id=link.tenant_id AND origin.school_id=link.school_id
          JOIN activity_runs run ON run.id=origin.activity_run_id AND run.classroom_id=seat.classroom_id
          WHERE (($1::uuid IS NOT NULL AND seat.id=$1) OR ($2::uuid IS NOT NULL AND seat.account_id=$2))`,
          identity.kind === 'seat' ? [identity.id, null] : [null, identity.id],
        );
        subjects.push({
          seat_id: identity.kind === 'seat' ? identity.id : null,
          account_id: identity.kind === 'account' ? identity.id : null,
          origins: origins.rows[0].count,
          verifiedInCurrentDatabase: true,
        });
      }
    }
  } finally {
    await admin.end();
  }
  const report = {
    purpose: 'SQL mechanism probe; not a browser gate or product acceptance',
    label: options.label ?? 'post-browser',
    settings,
    subjects,
    probes: [],
  };
  const seen = new Set();
  for (const subject of subjects) {
    const identities = [];
    if (subject.seat_id) identities.push({ kind: 'seat', id: subject.seat_id });
    if (subject.account_id) identities.push({ kind: 'account', id: subject.account_id });
    for (const identity of identities) {
      const key = `${identity.kind}:${identity.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (seen.size > 32)
        throw new Error('Unexpectedly broad identity set; bounded design needs review');
      for (const jit of ['on', 'off']) {
        const client = new Client({
          connectionString: databaseUrl,
          application_name: `learning1252_probe_${jit}`,
          connectionTimeoutMillis: 5000,
        });
        const parameters = identity.kind === 'seat' ? [identity.id, null] : [null, identity.id];
        const sql = 'SELECT context,evidence FROM learning_origin_learner_list($1,$2)';
        const entry = {
          identity,
          jit,
          expectedOrigins: subject.origins,
          queryMd5: createHash('md5').update(sql).digest('hex'),
          parameters,
          verifiedInCurrentDatabase: subject.verifiedInCurrentDatabase ?? true,
        };
        await client.connect();
        try {
          entry.backendPid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
          await client.query("LOAD 'auto_explain'");
          await client.query("SET auto_explain.log_min_duration='0ms'");
          await client.query('SET auto_explain.log_nested_statements=on');
          await client.query('SET auto_explain.log_analyze=on');
          await client.query('SET auto_explain.log_timing=off');
          await client.query("SET auto_explain.log_format='json'");
          await client.query('BEGIN');
          await client.query('SET LOCAL ROLE asalab_app');
          await client.query(`SET LOCAL jit=${jit}`);
          // The application's original 15s server statement guard is retained.
          await client.query("SET LOCAL statement_timeout='15s'");
          entry.startedAt = new Date().toISOString();
          const started = performance.now();
          try {
            const result = await client.query(sql, parameters);
            entry.durationMs = Math.round((performance.now() - started) * 10) / 10;
            entry.rows = result.rowCount;
            entry.resultSha256 = digest(result.rows.map((row) => JSON.stringify(row)).sort());
            entry.result = 'returned';
          } catch (error) {
            entry.durationMs = Math.round((performance.now() - started) * 10) / 10;
            entry.result = 'error';
            entry.sqlstate = /^[A-Z0-9]{5}$/.test(error.code ?? '') ? error.code : null;
            entry.errorClass = error.name;
          }
        } finally {
          await client.query('ROLLBACK').catch(() => undefined);
          await client.end();
          report.probes.push(entry);
          fs.writeFileSync(
            path.join(
              directory,
              `${options.label ?? 'post-browser'}-learner-origin-jit-probe.json`,
            ),
            JSON.stringify(report, null, 2) + '\n',
          );
        }
      }
    }
  }
  return report;
}

export async function statisticsSnapshot(source, databaseUrl, directory, label) {
  isolatedDatabase(databaseUrl);
  const { Client } = driver(source);
  const client = new Client({
    connectionString: databaseUrl,
    application_name: 'learning1252_statistics',
    connectionTimeoutMillis: 5000,
  });
  await client.connect();
  try {
    const report = {
      time: new Date().toISOString(),
      label,
      settings: (
        await client.query(`SELECT name,setting FROM pg_settings WHERE name IN
        ('server_version','jit','jit_above_cost','jit_inline_above_cost','jit_optimize_above_cost',
        'geqo','geqo_threshold','geqo_effort','geqo_seed','join_collapse_limit','from_collapse_limit',
        'default_statistics_target','plan_cache_mode','random_page_cost','effective_cache_size',
        'autovacuum','autovacuum_analyze_scale_factor','autovacuum_analyze_threshold',
        'autovacuum_naptime','max_parallel_workers_per_gather') ORDER BY name`)
      ).rows,
      relations: (
        await client.query(`SELECT relation.relname,relation.relpages,relation.reltuples,
        relation.relallvisible,stats.n_live_tup,stats.n_dead_tup,stats.n_mod_since_analyze,
        stats.n_ins_since_vacuum,stats.last_analyze,stats.last_autoanalyze,
        stats.analyze_count,stats.autoanalyze_count
        FROM pg_class relation JOIN pg_namespace schema ON schema.oid=relation.relnamespace
        LEFT JOIN pg_stat_all_tables stats ON stats.relid=relation.oid
        WHERE schema.nspname='public' AND relation.relkind='r' ORDER BY relation.relname`)
      ).rows,
      columns: (
        await client.query(`SELECT schemaname,tablename,attname,inherited,null_frac,
        avg_width,n_distinct,most_common_freqs,correlation,
        md5(most_common_vals::text) AS common_values_md5,
        md5(histogram_bounds::text) AS histogram_bounds_md5
        FROM pg_stats WHERE schemaname='public' ORDER BY tablename,attname,inherited`)
      ).rows,
      roles: (
        await client.query(`SELECT rolname,rolsuper,rolcreatedb,rolcreaterole,rolinherit,
        rolcanlogin,rolreplication,rolbypassrls,
        (SELECT count(*)::int FROM pg_auth_members WHERE member=role.oid) AS memberships
        FROM pg_roles role WHERE rolname IN ('postgres','asalab_app') ORDER BY rolname`)
      ).rows,
      functions: (
        await client.query(`SELECT oid::regprocedure::text AS signature,proconfig,
        proowner::regrole::text AS owner,proacl::text AS privileges,prosecdef,
        md5(prosrc) AS body_md5,provolatile,proparallel,procost,prorows FROM pg_proc WHERE proname IN
        ('learning_origin_learner_list','learning_origin_work_context_for_project',
        'project_context_for_principal','learning_linked_project_access') ORDER BY proname`)
      ).rows,
    };
    const app = report.roles.find((role) => role.rolname === 'asalab_app');
    if (
      !app?.rolcanlogin ||
      app.rolsuper ||
      app.rolcreatedb ||
      app.rolcreaterole ||
      app.rolinherit ||
      app.rolreplication ||
      app.rolbypassrls ||
      app.memberships !== 0
    )
      throw new Error('Restored runtime role differs from migration 0002 security boundary');
    fs.writeFileSync(
      path.join(directory, `${label}-statistics.json`),
      JSON.stringify(report, null, 2) + '\n',
    );
    return report;
  } finally {
    await client.end();
  }
}

/** The intervention changes planner statistics only, in the attested disposable clone. */
export async function preparePlannerStatistics(source, databaseUrl, directory) {
  const target = path.join(directory, 'planner-intervention');
  fs.mkdirSync(target, { recursive: true });
  const stopMonitor = await startPostgresMonitor(source, databaseUrl, target);
  try {
    const beforeStatistics = await statisticsSnapshot(
      source,
      databaseUrl,
      target,
      'before-analyze',
    );
    const before = await probeLearnerOrigins(source, databaseUrl, target, {
      label: 'before-analyze',
    });
    const { Client } = driver(source);
    const client = new Client({
      connectionString: databaseUrl,
      application_name: 'learning1252_controlled_analyze',
      connectionTimeoutMillis: 5000,
    });
    await client.connect();
    const intervention = { sql: 'ANALYZE', startedAt: new Date().toISOString() };
    try {
      await client.query('ANALYZE');
    } finally {
      await client.end();
    }
    intervention.completedAt = new Date().toISOString();
    const afterStatistics = await statisticsSnapshot(source, databaseUrl, target, 'after-analyze');
    if (
      JSON.stringify(beforeStatistics.functions) !== JSON.stringify(afterStatistics.functions) ||
      JSON.stringify(beforeStatistics.roles) !== JSON.stringify(afterStatistics.roles)
    )
      throw new Error('ANALYZE must not change function bodies, owners, grants or role attributes');
    const identities = [
      ...new Map(
        before.probes.map(({ identity }) => [`${identity.kind}:${identity.id}`, identity]),
      ).values(),
    ];
    const after = await probeLearnerOrigins(source, databaseUrl, target, {
      label: 'after-analyze',
      identities,
    });
    return { intervention, before, after };
  } finally {
    await stopMonitor();
  }
}

/** Read synthetic actor IDs from this run's successful identity responses, never cookies. */
export function readBrowserIdentities(directory) {
  const script = String.raw`
import json,pathlib,sys,zipfile,urllib.parse
root=pathlib.Path(sys.argv[1]); report=json.loads((root/'playwright.json').read_text())
identities={}; requests={}
targets={'/api/class-join/me/course-runs','/api/class-join/me/assignments',
 '/api/class-join/account/assignments','/api/capabilities/content-author/self-attest',
 '/api/learning/notifications/preferences'}
for suite in report['suites']:
 for spec in suite.get('specs',[]):
  for test in spec['tests']:
   for result in test['results']:
    for attachment in result.get('attachments',[]):
     if attachment['name']!='trace': continue
     trace=root/'results'/pathlib.Path(attachment['path']).parent.name/'trace.zip'
     with zipfile.ZipFile(trace) as archive:
      for name in archive.namelist():
       if not name.endswith('.network'): continue
       rows=[json.loads(line).get('snapshot',{}) for line in archive.read(name).decode().splitlines()]
       actors={}
       for row in rows:
        route=urllib.parse.urlsplit(row.get('request',{}).get('url','')).path
        response=row.get('response',{}); resource=response.get('content',{}).get('_sha1')
        if route not in ['/api/auth/me','/api/class-join/me'] or response.get('status')!=200 or not resource: continue
        body=json.loads(archive.read('resources/'+resource))
        if not body.get('authenticated'): continue
        kind='account' if route=='/api/auth/me' else 'seat'
        actor=body.get('account',{}).get('id') if kind=='account' else body.get('student',{}).get('seatId')
        if actor: actors[kind+':'+actor]={'kind':kind,'id':actor}
       for key,identity in actors.items(): identities[key]=identity
       for row in rows:
        request=row.get('request',{}); route=urllib.parse.urlsplit(request.get('url','')).path
        if route not in targets: continue
        response=row.get('response',{})
        kind='seat' if route.startswith('/api/class-join/me/') else 'account'
        candidates=[actor for actor in actors.values() if actor['kind']==kind]
        request_id=next((h['value'] for h in response.get('headers',[]) if h['name'].lower()=='x-request-id'),None)
        observation={'spec':spec['file'],'line':spec['line'],'scenario':spec['title'],
         'traceNetwork':name,'method':request.get('method'),'path':route,
         'startedAt':row.get('startedDateTime'),'status':response.get('status'),
         'requestId':request_id,'identityCandidates':candidates,'unambiguousIdentity':len(candidates)==1}
        key=request_id or str((spec['file'],spec['line'],name,row.get('startedDateTime'),request.get('method'),route))
        if key not in requests or (observation['unambiguousIdentity'] and not requests[key]['unambiguousIdentity']):
         requests[key]=observation
print(json.dumps({'identities':list(identities.values()),'requests':list(requests.values())}))
`;
  const result = spawnSync('python3', ['-c', script, directory], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0)
    throw new Error(`Synthetic trace identity extraction failed: ${result.stderr}`);
  const evidence = JSON.parse(result.stdout);
  fs.writeFileSync(
    path.join(directory, 'browser-identities.json'),
    JSON.stringify(evidence, null, 2) + '\n',
  );
  return evidence;
}
