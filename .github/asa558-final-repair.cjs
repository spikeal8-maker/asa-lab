const fs=require('node:fs');
const p='tests/portal/classroom-observation.pg.spec.ts';let s=fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n');
function one(a,b){if(s.split(a).length!==2)throw Error('Exact diagnostic anchor '+a);s=s.replace(a,b);}
one('  api = await buildTestApp(testAppPool());',`  const httpPool = testAppPool();
  httpPool.options.statement_timeout = 15_000;
  httpPool.options.application_name = 'asa558_observation_http';
  api = await buildTestApp(httpPool);`);
one("    for (const endpoint of ['projects', 'history']) {",`    for (const endpoint of ['projects', 'history']) {
      mark('HTTP '+endpoint+':start');
      const probe = setTimeout(() => {
        void admin.query(\`SELECT state,wait_event_type,wait_event,left(query,350) query,
          pg_blocking_pids(pid) blockers FROM pg_stat_activity
          WHERE application_name='asa558_observation_http'\`).then((result) => {
          console.info('observation_HTTP_state',endpoint,JSON.stringify(result.rows));
        }).catch(() => console.info('observation_HTTP_state_unavailable'));
      }, 5000);`);
one('      expect(result.statusCode, result.body).toBe(200);\n    }\n    const result = await inject(api, {',"      clearTimeout(probe);\n      mark('HTTP '+endpoint+':complete');\n      expect(result.statusCode, result.body).toBe(200);\n    }\n    const result = await inject(api, {");
fs.writeFileSync(p,s);fs.writeFileSync('/tmp/asa558-changed.json',JSON.stringify([p]));
console.log('Bounded isolated-DB diagnostic identifies the exact stalled HTTP reader without weakening an assertion.');
