// TEMPORARY #1093 SCREENING BRANCH ONLY. Never merge this diagnostic into main.
// Safety/digest/EXPLAIN core adapted from b9300284b0735b078a333889ca9d934bdc50d563.
// Ordinary samples are direct-client wall time, not full-test or pure server time.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import { isAbsolute, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';
import { pathToFileURL, URL } from 'node:url';
import pg from 'pg';
import { FixtureError, probeCases, seedFixtures } from './ci1093-pg-latency-fixtures.mjs';

export const diagnosticBranch = 'work/ci1093-pg-jit-probe-20261112';
export const postgresImage =
  'mirror.gcr.io/library/postgres@sha256:e9243ab06e47223dedeb3c129fa9ece8d37f506bdc6ee943afb9335f98bb4854';
export const caseLabels = Object.freeze([
  'ai_metrics',
  'ai_access',
  'quiz_seat',
  'quiz_account',
  'quiz_teacher',
  'file_seat',
  'file_account',
]);
const functionNames = Object.freeze([
  'classroom_participant_metrics',
  'ai_access_status',
  'ai_student_access',
  'ai_student_rule_allowed',
  'ai_chat_owner_valid',
  'learning_canonical_evidence_internal',
  'learning_canonical_evidence_for_seat',
  'learning_canonical_evidence_for_account',
  'learning_canonical_evidence_for_teacher',
]);

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
  const ref = `refs/heads/${diagnosticBranch}`;
  requireCondition(
    env.CI === 'true' &&
      env.GITHUB_ACTIONS === 'true' &&
      env.ASA_E1_PG_PLAN_PROBE === 'ci1093-isolated-read-only' &&
      env.GITHUB_EVENT_NAME === 'push' &&
      env.GITHUB_REF === ref &&
      env.GITHUB_REPOSITORY === 'spikeal8-maker/asa-lab' &&
      env.GITHUB_JOB === 'pg-jit-probe' &&
      env.GITHUB_WORKFLOW_REF ===
        `${env.GITHUB_REPOSITORY}/.github/workflows/ci1093-pg-jit-probe.yml@${ref}` &&
      /^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '') &&
      /^\d+$/.test(env.GITHUB_RUN_ID ?? '') &&
      /^[1-9]\d*$/.test(env.GITHUB_RUN_ATTEMPT ?? ''),
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
        url.hostname === '127.0.0.1' &&
        (url.port || '5432') === '5432' &&
        url.pathname === '/asa_ci1093_test' &&
        url.password.length >= 12 &&
        !url.search &&
        !url.hash,
    ) &&
      admin.username === 'asalab_admin' &&
      runtime.username === 'asalab_app',
    'isolated_urls_required',
  );
  requireCondition(
    isAbsolute(env.ASA_CI1093_EVIDENCE_DIR ?? '') &&
      /^[a-f0-9]{64}$/.test(env.ASA_CI1093_PG_CONTAINER_ID ?? ''),
    'diagnostic_evidence_target_required',
  );
  return {
    adminUrl: admin.href,
    runtimeUrl: runtime.href,
    database: 'asa_ci1093_test',
    evidenceDir: env.ASA_CI1093_EVIDENCE_DIR,
    containerId: env.ASA_CI1093_PG_CONTAINER_ID,
    sha: env.GITHUB_SHA,
    runId: env.GITHUB_RUN_ID,
    attempt: env.GITHUB_RUN_ATTEMPT,
  };
}

export function verifyConnection(row, database, runtime, readOnly = true) {
  requireCondition(
    row?.database === database &&
      database === 'asa_ci1093_test' &&
      row.sessionRole === (runtime ? 'asalab_app' : 'asalab_admin') &&
      row.currentRole === row.sessionRole &&
      (readOnly ? row.readOnly === true && row.repeatableRead === true : row.readOnly === false),
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
function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}
export function resultDigest(rows) {
  // Preserve JSON array order/duplicates; compare the unordered SQL row multiset.
  return digest(JSON.stringify(rows.map((row) => JSON.stringify(canonical(row))).sort()));
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
    // Outer function EXPLAIN can hide nested plans/JIT. Absence is not disproof.
    nestedStatementsInstrumented: 0,
  };
}

export function safeError(error) {
  return {
    reason:
      error instanceof ProbeError || error instanceof FixtureError
        ? error.probeCode
        : 'database_or_probe_error',
    // Never print messages, stacks, SQL, arguments, rows, URLs or credentials.
    sqlState: /^[0-9A-Z]{5}$/.test(error?.code ?? '') ? error.code : null,
  };
}
export function safeFunctionConfig(config) {
  if (config === null) return null;
  requireCondition(Array.isArray(config), 'function_config_shape_rejected');
  return config.map((entry) => {
    if (
      /^(jit|row_security)=(on|off)$/.test(entry) ||
      /^jit_(above_cost|inline_above_cost|optimize_above_cost)=-?\d+(\.\d+)?$/.test(entry) ||
      /^search_path=(pg_catalog|pg_temp|public)(,\s*(pg_catalog|pg_temp|public))*$/.test(entry) ||
      /^TimeZone=UTC$/i.test(entry) ||
      /^(statement_timeout|lock_timeout|idle_in_transaction_session_timeout)=\d+(ms|s|min)?$/.test(
        entry,
      )
    ) {
      return entry;
    }
    return '[redacted setting]';
  });
}

const connectionIdentity = `
  SELECT current_database() AS database, session_user AS "sessionRole", current_user AS "currentRole",
         current_setting('transaction_read_only') = 'on' AS "readOnly",
         current_setting('transaction_isolation') = 'repeatable read' AS "repeatableRead",
         EXISTS (SELECT 1 FROM pg_roles r
                  WHERE (r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication)
                    AND pg_has_role(r.oid, 'MEMBER')) AS privileged,
         pg_has_role(d.datdba, 'MEMBER') AS "ownerMember"
    FROM pg_database d WHERE d.datname = current_database()`;
const snapshotIdentity = `SELECT pg_current_snapshot()::text AS snapshot,
  transaction_timestamp()::text AS time, pg_backend_pid() AS pid`;
const jitSettings = `SELECT current_setting('server_version_num')::int AS server_version_num,
  current_setting('server_version') AS server_version,
  current_setting('jit') AS jit, pg_jit_available() AS jit_available,
  current_setting('jit_above_cost')::float8 AS jit_above_cost,
  current_setting('jit_inline_above_cost')::float8 AS jit_inline_above_cost,
  current_setting('jit_optimize_above_cost')::float8 AS jit_optimize_above_cost`;

function readFact(path, pattern) {
  try {
    const value = readFileSync(path, 'utf8').trim();
    return pattern.test(value) ? value : null;
  } catch {
    return null;
  }
}
function resourceFacts() {
  let cgroup = null;
  try {
    const membership = /^0::(\/[A-Za-z0-9._/:-]*)$/m.exec(
      readFileSync('/proc/self/cgroup', 'utf8'),
    )?.[1];
    if (membership && !membership.split('/').includes('..'))
      cgroup = join('/sys/fs/cgroup', membership);
  } catch {
    /* Non-Linux/unavailable process cgroup facts remain null. */
  }
  return {
    node: process.version,
    libuv: process.versions.uv,
    pg: createRequire(import.meta.url)('pg/package.json').version,
    platform: process.platform,
    architecture: process.arch,
    available_parallelism: os.availableParallelism(),
    visible_logical_cpus: os.cpus().length,
    visible_total_memory_bytes: os.totalmem(),
    node_cgroup_v2: {
      process_membership_resolved: cgroup !== null,
      cpu_max: cgroup ? readFact(join(cgroup, 'cpu.max'), /^(max|\d+) \d+$/) : null,
      cpuset_cpus_effective: cgroup
        ? readFact(join(cgroup, 'cpuset.cpus.effective'), /^[\d,-]*$/)
        : null,
      memory_max: cgroup ? readFact(join(cgroup, 'memory.max'), /^(max|\d+)$/) : null,
    },
    resource_scope:
      'Node process visibility and its local cgroup-v2 files; unavailable facts remain null, inherited parent limits are unobserved',
  };
}
function serviceFacts(config) {
  const inspected = JSON.parse(
    execFileSync('docker', ['inspect', config.containerId], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  )[0];
  return serviceMetadata(inspected, config);
}
export function serviceMetadata(inspected, config) {
  const labels = inspected?.Config?.Labels;
  const expectedPort = { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '5432' }] };
  requireCondition(
    /^[a-f0-9]{64}$/.test(config.containerId ?? '') &&
      inspected?.Id === config.containerId &&
      inspected?.State?.Running === true &&
      JSON.stringify(canonical(inspected?.HostConfig?.PortBindings)) ===
        JSON.stringify(canonical(expectedPort)) &&
      JSON.stringify(canonical(inspected?.NetworkSettings?.Ports)) ===
        JSON.stringify(canonical(expectedPort)) &&
      inspected?.Config?.Image === postgresImage &&
      /^sha256:[a-f0-9]{64}$/.test(inspected.Image ?? '') &&
      labels?.['org.asalab.ci1093.purpose'] === 'pg-jit-probe' &&
      labels?.['org.asalab.ci1093.source'] === config.sha &&
      labels?.['org.asalab.ci1093.run'] === config.runId &&
      labels?.['org.asalab.ci1093.attempt'] === config.attempt,
    'postgres_service_image_or_ownership_rejected',
  );
  return {
    image_reference: postgresImage,
    image_id: inspected.Image,
    port_binding: expectedPort,
    configured_container_limits: {
      ...numbers(inspected.HostConfig, {
        NanoCpus: 'nano_cpus',
        CpuQuota: 'cpu_quota',
        CpuPeriod: 'cpu_period',
        Memory: 'memory_bytes',
        MemorySwap: 'memory_swap_bytes',
        CpuShares: 'cpu_shares',
      }),
      cpuset_cpus: /^[\d,-]*$/.test(inspected.HostConfig.CpusetCpus ?? '')
        ? inspected.HostConfig.CpusetCpus
        : null,
    },
    effective_pg_cgroup_budget: null,
    limitation:
      'Docker configuration is observed; zero or empty does not establish host capacity or an effective cgroup budget',
  };
}

function sourceFacts(sha) {
  const git = (...args) =>
    execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  requireCondition(
    git('rev-parse', 'HEAD') === sha && git('status', '--porcelain=v1') === '',
    'exact_clean_source_required',
  );
  return { sha, tree: git('rev-parse', 'HEAD^{tree}'), ref: `refs/heads/${diagnosticBranch}` };
}
function roundMs(ms) {
  return Math.round(ms * 1000) / 1000;
}
async function timedQuery(client, sql, args) {
  const cpu = process.cpuUsage();
  const started = performance.now();
  const result = await client.query(sql, args);
  const wall = performance.now() - started;
  const used = process.cpuUsage(cpu);
  return {
    result,
    timing: {
      client_wall_ms: roundMs(wall),
      node_cpu_user_ms: used.user / 1000,
      node_cpu_system_ms: used.system / 1000,
    },
  };
}

export async function measureCases({ clients, cases, onSample, onPlan, onContext }) {
  requireCondition(
    cases.length === 7 &&
      cases.every(
        (entry, i) =>
          entry.label === caseLabels[i] && entry.role === (i === 0 ? 'admin' : 'runtime'),
      ),
    'seven_reader_protocol_required',
  );
  const snapshots = {};
  const baseline = {};
  for (const role of ['admin', 'runtime']) {
    snapshots[role] = (await clients[role].query(snapshotIdentity)).rows[0];
    baseline[role] = (await clients[role].query(jitSettings)).rows[0];
    onContext(role, {
      ...baseline[role],
      backend_pid: snapshots[role].pid,
      snapshot_sha256: digest(snapshots[role].snapshot),
      transaction_time_sha256: digest(snapshots[role].time),
      read_only: true,
      repeatable_read: true,
    });
  }
  requireCondition(
    baseline.admin.jit_available === true && baseline.runtime.jit_available === true,
    'jit_unavailable',
  );
  async function setJit(jit) {
    for (const role of ['admin', 'runtime']) {
      const client = clients[role];
      await client.query(jit === 'on' ? 'SET LOCAL jit = on' : 'SET LOCAL jit = off');
      const settings = (await client.query(jitSettings)).rows[0];
      requireCondition(
        settings.jit === jit &&
          [
            'jit_available',
            'jit_above_cost',
            'jit_inline_above_cost',
            'jit_optimize_above_cost',
          ].every((key) => settings[key] === baseline[role][key]),
        'jit_settings_changed_unexpectedly',
      );
      const current = (await client.query(snapshotIdentity)).rows[0];
      requireCondition(
        ['snapshot', 'time', 'pid'].every((key) => current[key] === snapshots[role][key]),
        'transaction_context_changed',
      );
    }
  }
  const hashes = new Map();
  for (const [round, jit] of ['on', 'off', 'on', 'off'].entries()) {
    await setJit(jit);
    for (const probe of cases) {
      const { result, timing } = await timedQuery(clients[probe.role], probe.sql, probe.args);
      probe.validate(result.rows);
      const hash = resultDigest(result.rows);
      if (!hashes.has(probe.label)) hashes.set(probe.label, hash);
      const equal = hashes.get(probe.label) === hash;
      onSample({
        label: probe.label,
        role: probe.role,
        round: round + 1,
        jit,
        ...timing,
        row_count: result.rows.length,
        item_count: probe.itemCount(result.rows),
        payload_sha256: hash,
        equal,
      });
      requireCondition(equal, 'result_mismatch');
    }
  }
  for (const jit of ['on', 'off']) {
    await setJit(jit);
    for (const probe of cases) {
      const { result, timing } = await timedQuery(
        clients[probe.role],
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON, TIMING OFF) ${probe.sql}`,
        probe.args,
      );
      onPlan({
        label: probe.label,
        role: probe.role,
        jit,
        ...timing,
        plan: explainMetadata(result.rows[0]['QUERY PLAN']),
      });
    }
  }
  for (const role of ['admin', 'runtime']) {
    const current = (await clients[role].query(snapshotIdentity)).rows[0];
    requireCondition(
      ['snapshot', 'time', 'pid'].every((key) => current[key] === snapshots[role][key]),
      'transaction_context_changed',
    );
  }
  return {
    stable_snapshot: true,
    stable_transaction_time: true,
    stable_connection: true,
    jit_available: baseline.admin.jit_available && baseline.runtime.jit_available,
  };
}

async function runProbe(config) {
  mkdirSync(config.evidenceDir, { recursive: true, mode: 0o700 });
  const writeJson = (name, value) =>
    writeFileSync(join(config.evidenceDir, name), `${JSON.stringify(value, null, 2)}\n`, {
      mode: 0o600,
    });
  const appendJson = (name, value) =>
    appendFileSync(join(config.evidenceDir, name), `${JSON.stringify(value)}\n`, { mode: 0o600 });
  const samples = [];
  const plans = [];
  const clients = new Set();
  const receipt = { schema_version: 1, status: 'started', source: null, connections: {} };
  const summary = {
    schema_version: 1,
    status: 'running',
    stage: 'source_preflight',
    samples: 0,
    plans: 0,
    expected_samples: 28,
    expected_plans: 14,
    payloads_equal: false,
    fixture_semantics_verified: false,
    cleanup_complete: false,
    error: null,
    integration_gate: 'NOT_RUN',
    historical_timeout_cause: 'NOT_ESTABLISHED',
  };
  function flush() {
    writeJson('receipt.json', receipt);
    writeJson('plans.json', plans);
    writeJson('summary.json', summary);
  }
  async function phase(fixture, name, work) {
    requireCondition(
      /^[a-z0-9_]+$/.test(fixture) && /^[a-z0-9_]+$/.test(name),
      'fixture_phase_label_rejected',
    );
    const started = performance.now();
    let ok = false;
    try {
      const result = await work();
      ok = true;
      return result;
    } finally {
      appendJson('fixture-timings.jsonl', {
        fixture,
        phase: name,
        client_wall_ms: roundMs(performance.now() - started),
        ok,
      });
    }
  }
  async function connect(url, runtime, readOnly) {
    const client = new pg.Client({
      connectionString: url,
      connectionTimeoutMillis: 5_000,
      application_name: 'asa-ci1093-pg-jit-probe',
      options: `-c default_transaction_read_only=${readOnly ? 'on' : 'off'} -c statement_timeout=30000 -c lock_timeout=3000 -c idle_in_transaction_session_timeout=120000`,
    });
    client.on('error', () => {});
    clients.add(client);
    await client.connect();
    if (readOnly) await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    verifyConnection(
      (await client.query(connectionIdentity)).rows[0],
      config.database,
      runtime,
      readOnly,
    );
    return client;
  }
  const deadline = setTimeout(() => {
    summary.status = 'failed';
    summary.error = { reason: 'probe_deadline', sqlState: null };
    flush();
    process.stdout.write(`[CI1093 PG probe] ${JSON.stringify(summary)}\n`);
    // Disconnects read-only transactions; workflow always cleans its own service.
    process.exit(1);
  }, 240_000);
  deadline.unref();
  try {
    writeFileSync(join(config.evidenceDir, 'samples.jsonl'), '', { mode: 0o600 });
    writeFileSync(join(config.evidenceDir, 'fixture-timings.jsonl'), '', { mode: 0o600 });
    receipt.source = sourceFacts(config.sha);
    receipt.node_resources = resourceFacts();
    receipt.postgres_service = serviceFacts(config);
    receipt.target = {
      database: config.database,
      host_kind: 'isolated_ci_loopback',
      roles: ['asalab_admin', 'asalab_app'],
    };
    flush();
    summary.stage = 'seed';
    const seedAdmin = await connect(config.adminUrl, false, false);
    const seedRuntime = await connect(config.runtimeUrl, true, false);
    const fixtures = await seedFixtures({ admin: seedAdmin, runtime: seedRuntime, phase });
    receipt.fixture_counts = fixtures.counts;
    receipt.fixture_semantic_checks = fixtures.semanticChecks;
    summary.fixture_semantics_verified = true;
    await seedAdmin.end();
    clients.delete(seedAdmin);
    await seedRuntime.end();
    clients.delete(seedRuntime);
    // No fixture writes after this point. Fresh read-only connections avoid any
    // setup transaction/pool state carrying into the measured physical sessions.
    summary.stage = 'measure';
    const admin = await connect(config.adminUrl, false, true);
    const runtime = await connect(config.runtimeUrl, true, true);
    const functions = (
      await admin.query(
        `SELECT p.proname AS name,
      oidvectortypes(p.proargtypes) AS argument_types, p.prosecdef AS security_definer,
      p.provolatile AS volatility, p.proconfig
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname=ANY($1::text[]) ORDER BY p.proname,p.oid`,
        [functionNames],
      )
    ).rows;
    requireCondition(
      functionNames.every((name) => functions.some((row) => row.name === name)),
      'required_function_metadata_missing',
    );
    receipt.functions = functions.map((row) => ({
      ...row,
      proconfig: safeFunctionConfig(row.proconfig),
    }));
    const stable = await measureCases({
      clients: { admin, runtime },
      cases: probeCases(fixtures),
      onContext: (role, context) => {
        receipt.connections[role] = context;
        flush();
      },
      onSample: (sample) => {
        samples.push(sample);
        summary.samples = samples.length;
        appendJson('samples.jsonl', sample);
        flush();
      },
      onPlan: (plan) => {
        plans.push(plan);
        summary.plans = plans.length;
        flush();
      },
    });
    verifyConnection((await admin.query(connectionIdentity)).rows[0], config.database, false);
    verifyConnection((await runtime.query(connectionIdentity)).rows[0], config.database, true);
    await admin.query('ROLLBACK');
    await runtime.query('ROLLBACK');
    requireCondition(samples.length === 28 && plans.length === 14, 'measurement_count_mismatch');
    Object.assign(summary, stable, {
      status: 'complete',
      stage: 'complete',
      payloads_equal: samples.every((row) => row.equal),
      readers: caseLabels.map((label) => ({
        label,
        on_client_wall_ms: samples
          .filter((row) => row.label === label && row.jit === 'on')
          .map((row) => row.client_wall_ms),
        off_client_wall_ms: samples
          .filter((row) => row.label === label && row.jit === 'off')
          .map((row) => row.client_wall_ms),
      })),
    });
    receipt.status = 'complete';
  } catch (error) {
    summary.status = 'failed';
    summary.error = safeError(error);
    receipt.status = 'failed';
    process.exitCode = 1;
  } finally {
    const closed = await Promise.allSettled([...clients].map((client) => client.end()));
    summary.cleanup_complete = closed.every((result) => result.status === 'fulfilled');
    if (!summary.cleanup_complete) {
      summary.status = 'failed';
      receipt.status = 'failed';
      summary.error ??= { reason: 'connection_cleanup_failed', sqlState: null };
      process.exitCode = 1;
    }
    clearTimeout(deadline);
    flush();
    process.stdout.write(`[CI1093 PG probe] ${JSON.stringify(summary)}\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await runProbe(isolatedConfig(process.env));
  } catch (error) {
    process.stdout.write(
      `[CI1093 PG probe] ${JSON.stringify({ status: 'failed', ...safeError(error) })}\n`,
    );
    process.exitCode = 1;
  }
}
