import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
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
export async function probeLearnerOrigins(source, databaseUrl, directory) {
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
    subjects = (
      await admin.query(`SELECT seat.id AS seat_id,seat.account_id,
      count(DISTINCT origin.project_id)::int AS origins
      FROM classroom_student_seats seat
      JOIN learner_identity_links link ON link.seat_id=seat.id AND link.link_kind='student_seat'
      JOIN learning_project_origins origin ON origin.learner_identity_id=link.learner_identity_id
      AND origin.school_tenant_id=link.tenant_id AND origin.school_id=link.school_id
      WHERE seat.status='active' AND link.status='active'
      GROUP BY seat.id,seat.account_id ORDER BY origins DESC,seat.id LIMIT 2`)
    ).rows;
    const emptyAccount = (
      await admin.query(`SELECT id FROM accounts account
      WHERE status='active' AND NOT EXISTS(SELECT 1 FROM classroom_student_seats seat
      WHERE seat.account_id=account.id) ORDER BY id LIMIT 1`)
    ).rows[0];
    if (emptyAccount) subjects.push({ seat_id: null, account_id: emptyAccount.id, origins: 0 });
  } finally {
    await admin.end();
  }
  const report = {
    purpose: 'SQL mechanism probe; not a browser gate or product acceptance',
    settings,
    subjects,
    probes: [],
  };
  for (const subject of subjects) {
    const identities = [];
    if (subject.seat_id) identities.push({ kind: 'seat', id: subject.seat_id });
    if (subject.account_id) identities.push({ kind: 'account', id: subject.account_id });
    for (const identity of identities) {
      for (const jit of ['on', 'off']) {
        const client = new Client({
          connectionString: databaseUrl,
          application_name: `learning1252_probe_${jit}`,
          connectionTimeoutMillis: 5000,
        });
        const entry = { identity, jit, expectedOrigins: subject.origins };
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
            const result = await client.query(
              'SELECT context,evidence FROM learning_origin_learner_list($1,$2)',
              identity.kind === 'seat' ? [identity.id, null] : [null, identity.id],
            );
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
            path.join(directory, 'learner-origin-jit-probe.json'),
            JSON.stringify(report, null, 2) + '\n',
          );
        }
      }
    }
  }
  return report;
}
