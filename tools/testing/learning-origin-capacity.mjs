// Read-only diagnostic queries against the disposable Learning E1 CI database.
// This never accepts a deployment URL or invokes application mutation functions.
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { execFileSync } from 'node:child_process';

const stage = process.argv[2];
const url = new URL(process.env.TEST_DATABASE_URL ?? 'invalid:');
if (process.env.GITHUB_ACTIONS !== 'true' || process.env.ASA_LEARNING_CAPACITY_DIAGNOSTICS !== '1'
    || !['before-browser', 'after-browser'].includes(stage)
    || !['127.0.0.1', 'localhost'].includes(url.hostname)
    || url.pathname !== '/asa_learning_e1_test' || url.username !== 'postgres') {
  throw new Error('Disposable Learning E1 CI database and explicit diagnostic flag required');
}
const options = { connectionString: url.toString(), connectionTimeoutMillis: 3000,
  statement_timeout: 15000, application_name: 'learning-capacity-diagnostic' };
const client = new pg.Client(options);
const observer = new pg.Client({ ...options, statement_timeout: 3000 });
const report = { stage, checkoutRevision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  githubEventSha: process.env.GITHUB_SHA, measurements: [], cardinality: {}, locks: [] };
try {
  await client.connect(); await observer.connect();
  report.server = (await client.query(`SELECT version(),current_setting('jit') AS jit,
    current_setting('jit_above_cost') AS "jitAboveCost",current_setting('statement_timeout') AS timeout`)).rows[0];
  for (const table of ['classroom_student_seats','principals','learner_identities','learner_identity_links',
    'learning_project_origins','activity_participations','activity_runs','projects']) {
    report.cardinality[table] = (await client.query(`SELECT count(*)::int AS n FROM public.${table}`)).rows[0].n;
  }
  const candidates = (await client.query(`SELECT seat.id AS "seatId", seat.account_id AS "accountId",
      actor.id AS "principalId", origin.project_id AS "projectId"
    FROM public.learning_project_origins origin
    JOIN public.principals actor ON actor.id=origin.owner_principal_id
    JOIN public.classroom_student_seats seat ON seat.id=actor.seat_id
    WHERE seat.status='active' ORDER BY origin.created_at DESC LIMIT 1`)).rows;
  if (!candidates.length) { report.state='NO_ORIGIN_CANDIDATE'; }
  for (const candidate of candidates) {
    const cases = [
      ['seat-list', 'SELECT context,evidence FROM public.learning_origin_learner_list($1,NULL)', [candidate.seatId], true],
      ['account-list', 'SELECT context,evidence FROM public.learning_origin_learner_list(NULL,$1)', [candidate.accountId], true],
    ];
    // The first observed browser failure is a new learner with no own origin:
    // measure that empty list too, rather than only an already-started project.
    const newest=(await client.query(`SELECT id FROM public.classroom_student_seats
      WHERE status='active' ORDER BY created_at DESC LIMIT 1`)).rows[0];
    if (newest) cases.push(['newest-seat-list','SELECT context,evidence FROM public.learning_origin_learner_list($1,NULL)',[newest.id],true]);
    for (const name of ['learning_linked_project_access','learning_origin_work_context_for_project']) {
      const body = (await client.query(`SELECT prosrc,proargnames FROM pg_proc
        WHERE oid=('public.' || $1 || '(uuid,uuid)')::regprocedure`, [name])).rows[0];
      let sql=body.prosrc.trim().replace(/;\s*$/, '');
      for (const [index, arg] of body.proargnames.slice(0,2).entries()) sql=sql.replace(new RegExp('\\b'+arg+'\\b','g'),'$'+(index+1));
      cases.push([name+'-body',sql,[candidate.principalId,candidate.projectId],false]);
    }
    for (const [name, sql, args, restricted] of cases) {
      const item={name, elapsedMs:null, waits:{}, explain:null};
      await client.query('BEGIN');
      let timer;
      try {
        if (restricted) await client.query('SET LOCAL ROLE asalab_app');
        const pid=(await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        timer=setInterval(async()=>{
          try {
            const result=(await observer.query('SELECT wait_event_type,wait_event FROM pg_stat_activity WHERE pid=$1',[pid])).rows[0];
            if (result?.wait_event_type) { const key=result.wait_event_type+':'+result.wait_event; item.waits[key]=(item.waits[key]??0)+1; }
          } catch { item.observerUnavailable=true; }
        },250);
        const started=performance.now();
        try {
          item.explain=(await client.query('EXPLAIN (ANALYZE,BUFFERS,SETTINGS,FORMAT JSON) '+sql,args)).rows[0]['QUERY PLAN'];
          item.state='COMPLETE';
        } catch(error) { item.state='FAILED'; item.sqlstate=error.code ?? 'unknown'; }
        item.elapsedMs=Math.round(performance.now()-started);
      } finally { clearInterval(timer); await client.query('ROLLBACK'); }
      report.measurements.push(item);
    }
    report.state='MEASURED';
  }
} finally {
  await client.end().catch(()=>{}); await observer.end().catch(()=>{});
  const destination=path.resolve('reports/learning-origin-capacity');
  fs.mkdirSync(destination,{recursive:true});
  fs.writeFileSync(path.join(destination,stage+'.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({kind:'learning_origin_capacity',...report,
    measurements:report.measurements.map(({explain,...rest})=>({...rest,planningMs:explain?.[0]?.['Planning Time'],
      executionMs:explain?.[0]?.['Execution Time'],jit:explain?.[0]?.JIT}))}));
}
