import { spawn, execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  openSync,
  readSync,
  realpathSync,
  renameSync,
  watch,
  writeFileSync,
} from 'node:fs';
import { request } from 'node:http';
import { isIP } from 'node:net';
import { resolve, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import { StringDecoder } from 'node:string_decoder';
import { setTimeout, clearTimeout, setInterval, clearInterval } from 'node:timers';
import { promisify } from 'node:util';
import { Buffer } from 'node:buffer';
import { assertOfficialScaleOwnedContainer } from './classroom-scale-contracts.mjs';

/**
 * Diagnostic only. No API query text/parameters or addresses leave PostgreSQL.
 * Public, fixed probe SQL may appear in the owned server's log during its
 * deliberate error smoke; that is not permission to retain arbitrary stderr,
 * observed SQL or bind values. Core/preload logging compatibility is checked
 * before the first address bind. No SET, backend termination or signal to the
 * psql/PostgreSQL processes is used. A sample deadline is not a claim of
 * server-side cancellation. A timed-out read-only process-proof transport may
 * terminate its own Docker CLI; that never proves psql/backend closure.
 * The driver's shared resource signal forbids new clients/SQL after a stop.
 * Cancellation sends EOF immediately; physical closure is still verified with
 * its own bounded read-only checks, without treating cancellation as success.
 */
export const PG_ACTIVITY_POLICY = Object.freeze({
  version: 1,
  phase: 'electronics-open',
  intervalMs: 1000,
  windowMs: 60000,
  samples: 60,
  rows: 64,
  frameBytes: 64 * 1024,
  totalBytes: 4 * 1024 * 1024,
  stderrBytes: 16 * 1024,
  queryDeadlineMs: 2000,
  closureDeadlineMs: 5000,
  progressBytes: 1024,
  extraConnections: 1,
});

export class PgActivityError extends Error {
  constructor(code) {
    super('PG_ACTIVITY_' + code);
    this.name = 'PgActivityError';
    this.code = code;
  }
}

export function pgActivityError(error) {
  return error instanceof PgActivityError && /^[A-Z_]{3,64}$/.test(error.code)
    ? error.code
    : 'OBSERVER_FAILURE';
}

const fail = (code) => {
  throw new PgActivityError(code);
};
const requireValue = (condition, code) => {
  if (!condition) fail(code);
};
const assertResourceActive = (options) => {
  requireValue(options.resourceSignal instanceof globalThis.AbortSignal, 'RESOURCE_SIGNAL');
  requireValue(!options.resourceSignal.aborted, 'RESOURCE_STOP');
};
const hash = (value) => createHash('sha256').update(value).digest('hex');
const integer = (value) => Number.isSafeInteger(value);
const hex = (value, length) =>
  typeof value === 'string' && new RegExp('^[a-f0-9]{' + length + '}$').test(value);
const exactKeys = (value, keys) => {
  requireValue(value && typeof value === 'object' && !Array.isArray(value), 'FRAME_SHAPE');
  requireValue(
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)),
    'FRAME_SHAPE',
  );
};
const date = (value) =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
  Number.isFinite(Date.parse(value));
const wait = (ms) => new Promise((done) => setTimeout(done, ms));

export async function activityDeadline(
  action,
  timeoutMs,
  code,
  onTimeout = () => {},
  monotonic = () => performance.now(),
) {
  let expired = false;
  let timer;
  const end = monotonic() + timeoutMs;
  const expire = () => {
    if (expired) return;
    expired = true;
    try {
      onTimeout();
    } catch {
      /* A callback cannot turn a timeout into success. */
    }
  };
  const check = () => {
    if (monotonic() >= end) expire();
    requireValue(!expired, code);
  };
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      expire();
      reject(new PgActivityError(code));
    }, timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve().then(() => action(check)), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// Exact StringLiteral/NoSubstitutionTemplateLiteral values from the two release
// blobs, not from the harness checkout. Unknown releases/queries remain unknown.
export const PG_ACTIVITY_QUERY_SOURCE = Object.freeze({
  revisions: Object.freeze([
    '98d7fbb42ae9e53113cb45ada4b4301334de9c27',
    '8358997da3919f431e1f41456f7eabcbef685e0b',
  ]),
  path: 'apps/api/src/learning-work-context.ts',
  sha256: '09cb927baa28fb5399d9193c30f348cbd3572fa8480841f01d9fca8916b19c70',
  queries: Object.freeze(
    [
      [
        '1b68fe86fcede96c6d21abd44e0d7923fc7d5b275a0e0eea5df0f4439aa5c1f0',
        77,
        'learning_origin_work_context_for_project',
      ],
      [
        '0f10d3e2b660f98e4c5665833843df657caef6846f5f97db98695f3d7c831b00',
        65,
        'learning_immutable_project_origin_exists',
      ],
      [
        '3d63a8c0b922df898e85a7e4a13bfb6013265ebe4f053572828d88e8d35ccf11',
        61,
        'learning_work_context_for_project',
      ],
      [
        '2360cd0fec5a7a8ad11dd29ca7e9dbc4bd6391aa59a4fcbdfe65a74d0c27684b',
        62,
        'learning_course_modern_provenance',
      ],
      [
        '76b915b096123581ca8c2157404519bb4d478ec0ff21884dccb02b088e8bd1bf',
        74,
        'learning_direct_modern_project_readable',
      ],
      [
        'c33528e730a4aa6f0b152894d52ed2979fcc95c38acf9814852c220e5cd708f4',
        62,
        'learning_legacy_direct_provenance',
      ],
      [
        '77fca91a409ab2a4b4c01e84ce0f63e54684cac823348002c6a1d8ef4ab64616',
        60,
        'learning_work_project_origin_exists',
      ],
      [
        '8a7c286d8efcf0965770d41b0190ae035ed6a11f5debcf859a64d2ae34b04ea9',
        83,
        'learning_course_activity_sample_url_for_viewer',
      ],
      [
        '2db6e4e6713284394cf087c5e4810a08a9e27d50bb08f82ff7b28ad0a0f685e8',
        55,
        'learning_project_archive_bucket',
      ],
    ].map((query) => Object.freeze(query)),
  ),
});

const settingNames = [
  'log_statement',
  'log_duration',
  'log_min_duration_statement',
  'log_min_duration_sample',
  'log_statement_sample_rate',
  'log_transaction_sample_rate',
  'log_parameter_max_length',
  'log_parameter_max_length_on_error',
  'debug_print_parse',
  'debug_print_rewritten',
  'debug_print_plan',
  'log_statement_stats',
  'log_parser_stats',
  'log_planner_stats',
  'log_executor_stats',
  'shared_preload_libraries',
  'session_preload_libraries',
  'local_preload_libraries',
];
const identitySql = (kind) =>
  `'kind','${kind}','nonce',$1::text,'sequence',$2::int,` +
  "'readOnly',pg_catalog.current_setting('transaction_read_only')='on'";

export const PG_ACTIVITY_SQL = Object.freeze({
  hello: `SELECT pg_catalog.json_build_object(${identitySql('hello')},
    'version',pg_catalog.current_setting('server_version_num')::int,
    'database',pg_catalog.current_database(),'role',current_user,
    'local',pg_catalog.inet_client_addr() IS NULL,
    'backendPid',pg_catalog.pg_backend_pid(),
    'backendStart',(SELECT backend_start FROM pg_catalog.pg_stat_activity WHERE pid=pg_catalog.pg_backend_pid()),
    'trackActivities',pg_catalog.current_setting('track_activities'),
    'trackQueryBytes',pg_catalog.pg_size_bytes(pg_catalog.current_setting('track_activity_query_size')),
    'logging',pg_catalog.json_build_object(${settingNames.map((name) => `'${name}',pg_catalog.current_setting('${name}')`).join(',')}))`,
  binding: `SELECT pg_catalog.json_build_object(${identitySql('binding')},
    'matchingBackends',(SELECT count(*) FROM pg_catalog.pg_stat_activity
      WHERE datname=pg_catalog.current_database() AND usename='asalab_app'
        AND backend_type='client backend' AND client_addr=$3::inet))`,
  smoke: `SELECT pg_catalog.json_build_object(${identitySql('smoke')},
    'hash',pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('asa_pg_activity_smoke','UTF8')),'hex'))`,
  sleep: `SELECT pg_catalog.json_build_object(${identitySql('sleep')}) FROM pg_catalog.pg_sleep(3)`,
  error: 'SELECT 1 / 0',
  sample: `WITH activity AS MATERIALIZED (
      SELECT pid,backend_start,state,query_start,xact_start,wait_event_type,wait_event,query
      FROM pg_catalog.pg_stat_activity
      WHERE datname=pg_catalog.current_database() AND usename='asalab_app'
        AND backend_type='client backend' AND client_addr=$3::inet
      ORDER BY backend_start,pid LIMIT 65
    ), stamp AS MATERIALIZED (
      SELECT pg_catalog.clock_timestamp() AS observed_at,count(*) AS observed_count FROM activity
    )
    SELECT pg_catalog.json_build_object(${identitySql('sample')},
      'serverAt',stamp.observed_at,'observedAtLeast',stamp.observed_count,
      'rowsTruncated',stamp.observed_count>64,
      'trackQueryBytes',pg_catalog.pg_size_bytes(pg_catalog.current_setting('track_activity_query_size')),
      'rows',coalesce((SELECT pg_catalog.json_agg(pg_catalog.json_build_object(
        'backend',pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to($1::text || ':' || pid::text || ':' || backend_start::text,'UTF8')),'hex'),
        'state',state,
        'queryAgeMs',extract(epoch FROM (stamp.observed_at-query_start))*1000,
        'transactionAgeMs',extract(epoch FROM (stamp.observed_at-xact_start))*1000,
        'waitType',wait_event_type,'waitEvent',wait_event,
        'queryHash',CASE WHEN query IS NULL OR query='' THEN NULL ELSE pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(query,'UTF8')),'hex') END,
        'queryBytes',coalesce(pg_catalog.octet_length(query),0)
      ) ORDER BY backend_start,pid) FROM (SELECT * FROM activity ORDER BY backend_start,pid LIMIT 64) visible),'[]'::json)
    ) FROM stamp`,
});

/** Only a strict alphabet of already typed, non-arbitrary bind values is accepted. */
export function activityCommand(kind, nonce, sequence, address) {
  requireValue(Object.hasOwn(PG_ACTIVITY_SQL, kind), 'QUERY_KIND');
  requireValue(
    hex(nonce, 32) && integer(sequence) && sequence >= 0 && sequence <= 200,
    'QUERY_IDENTITY',
  );
  if (kind === 'error') return 'BEGIN READ ONLY;\nSELECT 1 / 0;\n';
  const parameters = [nonce, String(sequence)];
  if (kind === 'sample' || kind === 'binding') {
    requireValue(isIP(address) === 4, 'ADDRESS_IDENTITY');
    parameters.push(address);
  } else requireValue(address === undefined, 'UNEXPECTED_ADDRESS');
  requireValue(
    parameters.every((value) => /^[a-zA-Z0-9_.:-]+$/.test(value)),
    'BIND_ALPHABET',
  );
  return (
    'BEGIN READ ONLY;\n' +
    PG_ACTIVITY_SQL[kind] +
    '\n\\bind ' +
    parameters.map((value) => "'" + value + "'").join(' ') +
    '\n\\g\nROLLBACK;\n\\echo ASA_PG_ACTIVITY_ROLLBACK ' +
    nonce +
    ' ' +
    sequence +
    ' :SQLSTATE\n'
  );
}

export function assertActivityHello(value, nonce, sequence) {
  exactKeys(value, [
    'kind',
    'nonce',
    'sequence',
    'readOnly',
    'version',
    'database',
    'role',
    'local',
    'backendPid',
    'backendStart',
    'trackActivities',
    'trackQueryBytes',
    'logging',
  ]);
  requireValue(
    value.kind === 'hello' && value.nonce === nonce && value.sequence === sequence,
    'FRAME_IDENTITY',
  );
  requireValue(
    value.readOnly === true &&
      value.version === 170007 &&
      value.database === 'asalab_test' &&
      value.role === 'postgres' &&
      value.local === true,
    'DATABASE_IDENTITY',
  );
  requireValue(
    integer(value.backendPid) && value.backendPid > 1 && date(value.backendStart),
    'BACKEND_IDENTITY',
  );
  requireValue(
    value.trackActivities === 'on' &&
      integer(value.trackQueryBytes) &&
      value.trackQueryBytes >= 128 &&
      value.trackQueryBytes <= 1024 * 1024,
    'ACTIVITY_SETTINGS',
  );
  exactKeys(value.logging, settingNames);
  const settings = value.logging;
  requireValue(
    settingNames.every(
      (name) => typeof settings[name] === 'string' && settings[name].length <= 1024,
    ),
    'LOGGING_SETTINGS',
  );
  for (const name of settingNames.filter(
    (name) => name.startsWith('debug_') || name.endsWith('_stats'),
  ))
    requireValue(settings[name] === 'off', 'UNSAFE_LOGGING');
  for (const name of settingNames.filter((name) => name.endsWith('_preload_libraries')))
    requireValue(settings[name] === '', 'UNKNOWN_LOGGING_EXTENSION');
  requireValue(settings.log_parameter_max_length_on_error === '0', 'UNSAFE_ERROR_BIND_LOGGING');
  const ordinaryLogsOff =
    settings.log_statement === 'none' &&
    settings.log_duration === 'off' &&
    settings.log_min_duration_statement === '-1' &&
    (settings.log_min_duration_sample === '-1' || settings.log_statement_sample_rate === '0') &&
    settings.log_transaction_sample_rate === '0';
  requireValue(ordinaryLogsOff || settings.log_parameter_max_length === '0', 'UNSAFE_BIND_LOGGING');
  return value;
}

const states = new Set([
  'active',
  'idle',
  'idle in transaction',
  'idle in transaction (aborted)',
  'fastpath function call',
  'disabled',
]);
const waits = new Set([
  'Activity',
  'BufferPin',
  'Client',
  'Extension',
  'IO',
  'IPC',
  'Lock',
  'LWLock',
  'Timeout',
]);

export function projectActivitySample(value, { nonce, sequence, releaseSha, trackQueryBytes }) {
  exactKeys(value, [
    'kind',
    'nonce',
    'sequence',
    'readOnly',
    'serverAt',
    'observedAtLeast',
    'rowsTruncated',
    'trackQueryBytes',
    'rows',
  ]);
  requireValue(
    value.kind === 'sample' &&
      value.nonce === nonce &&
      value.sequence === sequence &&
      value.readOnly === true,
    'FRAME_IDENTITY',
  );
  requireValue(
    date(value.serverAt) && value.trackQueryBytes === trackQueryBytes,
    'SAMPLE_SETTINGS',
  );
  requireValue(
    integer(value.observedAtLeast) &&
      value.observedAtLeast >= 0 &&
      value.observedAtLeast <= 65 &&
      value.rowsTruncated === value.observedAtLeast > 64,
    'ROW_BOUND',
  );
  requireValue(
    Array.isArray(value.rows) && value.rows.length === Math.min(value.observedAtLeast, 64),
    'ROW_BOUND',
  );
  const knownRelease = PG_ACTIVITY_QUERY_SOURCE.revisions.includes(releaseSha);
  const backends = new Set();
  const rows = value.rows.map((row) => {
    exactKeys(row, [
      'backend',
      'state',
      'queryAgeMs',
      'transactionAgeMs',
      'waitType',
      'waitEvent',
      'queryHash',
      'queryBytes',
    ]);
    requireValue(hex(row.backend, 64) && !backends.has(row.backend), 'BACKEND_ROW');
    backends.add(row.backend);
    requireValue(states.has(row.state), 'BACKEND_STATE');
    for (const age of [row.queryAgeMs, row.transactionAgeMs])
      requireValue(
        age === null ||
          (typeof age === 'number' &&
            Number.isFinite(age) &&
            Math.abs(age) <= Number.MAX_SAFE_INTEGER),
        'BACKEND_AGE',
      );
    requireValue(row.waitType === null || waits.has(row.waitType), 'WAIT_EVENT');
    requireValue(
      row.waitEvent === null ||
        (typeof row.waitEvent === 'string' && /^[a-zA-Z][a-zA-Z0-9_]{0,79}$/.test(row.waitEvent)),
      'WAIT_EVENT',
    );
    requireValue((row.waitType === null) === (row.waitEvent === null), 'WAIT_EVENT');
    requireValue(
      integer(row.queryBytes) && row.queryBytes >= 0 && row.queryBytes < trackQueryBytes,
      'QUERY_BYTES',
    );
    requireValue(
      row.queryHash === null ? row.queryBytes === 0 : hex(row.queryHash, 64) && row.queryBytes > 0,
      'QUERY_HASH',
    );
    // A UTF-8 character can be cut at the byte boundary. Conservatively treat
    // the final four bytes as potentially truncated, never as an exact match.
    const possiblyTruncated = row.queryBytes >= trackQueryBytes - 4;
    const known =
      knownRelease && !possiblyTruncated
        ? PG_ACTIVITY_QUERY_SOURCE.queries.find(
            ([digest, bytes]) => digest === row.queryHash && bytes === row.queryBytes,
          )
        : undefined;
    return {
      backend: row.backend,
      state: row.state,
      queryMeaning:
        row.state === 'active' ? 'current' : row.state === 'disabled' ? 'unavailable' : 'last',
      queryAgeMs: row.queryAgeMs,
      transactionAgeMs: row.transactionAgeMs,
      clockOrderValid: [row.queryAgeMs, row.transactionAgeMs].every(
        (age) => age === null || age >= 0,
      ),
      waitType: row.waitType,
      waitEvent: row.waitEvent,
      queryHash: row.queryHash,
      queryBytes: row.queryBytes,
      possiblyTruncated,
      sourceQuery: known ? known[2] : 'unknown',
    };
  });
  return {
    serverAt: value.serverAt,
    observedAtLeast: value.observedAtLeast,
    rowsTruncated: value.rowsTruncated,
    trackQueryBytes,
    rows,
    attribution:
      'API backends; pool membership and individual HTTP request association are not established',
  };
}

const runningIdentity = (metadata, service, options) => {
  try {
    assertOfficialScaleOwnedContainer(metadata, options.expected);
  } catch {
    fail('CONTAINER_OWNERSHIP');
  }
  requireValue(
    metadata.Config.Labels['com.docker.compose.service'] === service,
    'CONTAINER_SERVICE',
  );
  requireValue(
    metadata.Id === options[service === 'api' ? 'apiId' : 'postgresId'],
    'CONTAINER_REPLACED',
  );
  requireValue(/^sha256:[a-f0-9]{64}$/.test(metadata.Image || ''), 'IMAGE_IDENTITY');
  requireValue(
    metadata.State?.Running === true &&
      metadata.State.Health?.Status === 'healthy' &&
      date(metadata.State.StartedAt) &&
      integer(metadata.RestartCount) &&
      metadata.RestartCount >= 0,
    'CONTAINER_STATE',
  );
  return {
    id: metadata.Id,
    image: metadata.Image,
    startedAt: metadata.State.StartedAt,
    restartCount: metadata.RestartCount,
  };
};

/** Raw addresses and Docker metadata remain inside this non-serializable control path. */
export async function captureActivityIdentity(options, io, previous, check = () => {}) {
  check();
  requireValue(hex(options.apiId, 64) && hex(options.postgresId, 64), 'CONTAINER_ID');
  const [api, postgres] = await Promise.all([
    io.inspect(options.apiId),
    io.inspect(options.postgresId),
  ]);
  check();
  const identity = {
    api: runningIdentity(api, 'api', options),
    postgres: runningIdentity(postgres, 'postgres', options),
  };
  const name = options.expected.project + '_database';
  const apiEndpoint = api.NetworkSettings?.Networks?.[name];
  const pgEndpoint = postgres.NetworkSettings?.Networks?.[name];
  requireValue(
    apiEndpoint &&
      pgEndpoint &&
      hex(apiEndpoint.NetworkID, 64) &&
      apiEndpoint.NetworkID === pgEndpoint.NetworkID,
    'DATABASE_NETWORK',
  );
  const network = await io.network(apiEndpoint.NetworkID);
  check();
  requireValue(
    network.Id === apiEndpoint.NetworkID &&
      network.Name === name &&
      network.Driver === 'bridge' &&
      network.Internal === true &&
      network.EnableIPv6 === false &&
      network.Labels?.['com.docker.compose.project'] === options.expected.project &&
      network.Labels?.['com.docker.compose.network'] === 'database' &&
      network.Labels?.['io.asalab.scale.run'] === options.expected.runToken,
    'DATABASE_NETWORK',
  );
  for (const [metadata, endpoint] of [
    [api, apiEndpoint],
    [postgres, pgEndpoint],
  ]) {
    const member = network.Containers?.[metadata.Id];
    requireValue(
      isIP(endpoint.IPAddress) === 4 &&
        member?.EndpointID === endpoint.EndpointID &&
        member.IPv4Address?.split('/')[0] === endpoint.IPAddress &&
        hex(endpoint.EndpointID, 64),
      'NETWORK_ADDRESS',
    );
  }
  requireValue(apiEndpoint.IPAddress !== pgEndpoint.IPAddress, 'NETWORK_ADDRESS');
  identity.network = {
    id: network.Id,
    apiEndpoint: apiEndpoint.EndpointID,
    postgresEndpoint: pgEndpoint.EndpointID,
    apiAddress: apiEndpoint.IPAddress,
    postgresAddress: pgEndpoint.IPAddress,
  };
  if (previous)
    requireValue(JSON.stringify(identity) === JSON.stringify(previous), 'IDENTITY_DRIFT');
  return identity;
}

export function readActivityProgress(directory) {
  const path = resolve(directory, 'progress.json');
  let fd;
  try {
    requireValue(realpathSync(directory) === directory, 'PROGRESS_DIRECTORY');
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const metadata = fstatSync(fd);
    requireValue(
      metadata.isFile() && metadata.size > 0 && metadata.size <= PG_ACTIVITY_POLICY.progressBytes,
      'PROGRESS_FILE',
    );
    const bytes = Buffer.alloc(PG_ACTIVITY_POLICY.progressBytes + 1);
    const read = readSync(fd, bytes, 0, bytes.length, 0);
    requireValue(
      read === metadata.size && read <= PG_ACTIVITY_POLICY.progressBytes,
      'PROGRESS_FILE',
    );
    return JSON.parse(bytes.subarray(0, read).toString('utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    if (error instanceof PgActivityError) throw error;
    fail('PROGRESS_FILE');
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export function validateActivityProgress(value, startedAtMs, now, previous) {
  exactKeys(value, ['phase', 'atMs']);
  requireValue(
    typeof value.phase === 'string' &&
      /^[a-z][a-z0-9-]{0,63}$/.test(value.phase) &&
      integer(value.atMs) &&
      value.atMs >= startedAtMs &&
      value.atMs <= now + 1000,
    'PROGRESS_STALE_OR_INVALID',
  );
  if (previous)
    requireValue(
      value.atMs >= previous.atMs &&
        (value.atMs !== previous.atMs || value.phase === previous.phase),
      'PROGRESS_REWIND',
    );
  return { phase: value.phase, atMs: value.atMs };
}

const exec = promisify(execFile);
const processScript = `set -eu
nonce="$1"
ticks=$(awk '{print $22}' /proc/$$/stat)
printf '{"kind":"process","nonce":"%s","pid":%s,"startTicks":"%s"}\\n' "$nonce" "$$" "$ticks"
exec psql -X -qAt -w -h /var/run/postgresql -U postgres -d asalab_test -v ON_ERROR_STOP=1 -v ECHO=none -v VERBOSITY=terse
`;

// Read-only /proc proof in the already attested PostgreSQL namespace. No kill,
// shell search over other processes, or extra database connection is involved.
const processProofScript = `set -eu
client="$1"; client_start="$2"; nonce="$3"; backend="$4"; backend_start="$5"
state=absent
if [ -d "/proc/$client" ]; then
  state=changing
  if stat=$(cat "/proc/$client/stat" 2>/dev/null); then
    ticks=$(printf '%s\\n' "$stat" | awk '{print $22}')
    phase=$(printf '%s\\n' "$stat" | awk '{print $3}')
    if [ "$ticks" != "$client_start" ]; then state=retired; elif [ "$phase" != Z ]; then
      if exe=$(readlink "/proc/$client/exe" 2>/dev/null) && app=$(tr '\\000' '\\n' 2>/dev/null < "/proc/$client/environ" | sed -n 's/^PGAPPNAME=//p'); then
        if [ "\${exe##*/}" != psql ] || [ "$app" != "asa-pg-activity-$nonce" ]; then exit 66; fi
        state=matching
      fi
    fi
  fi
fi
server=absent; server_ticks=0
if [ -d "/proc/$backend" ]; then
  server=changing
  if stat=$(cat "/proc/$backend/stat" 2>/dev/null); then
    server_ticks=$(printf '%s\\n' "$stat" | awk '{print $22}')
    phase=$(printf '%s\\n' "$stat" | awk '{print $3}')
    if [ "$backend_start" != 0 ] && [ "$server_ticks" != "$backend_start" ]; then server=retired; elif [ "$phase" != Z ]; then
      if exe=$(readlink "/proc/$backend/exe" 2>/dev/null); then
        if [ "\${exe##*/}" != postgres ]; then exit 66; fi
        server=matching
      fi
    fi
  fi
fi
printf '{"client":"%s","backend":"%s","backendStartTicks":"%s"}\\n' "$state" "$server" "$server_ticks"
`;

export const PG_ACTIVITY_NATIVE_SCRIPTS = Object.freeze({
  start: processScript,
  proof: processProofScript,
});

function dockerJson(path) {
  return new Promise((done, reject) => {
    const failTransport = () => reject(new PgActivityError('DOCKER_TRANSPORT'));
    const outgoing = request(
      { socketPath: '/var/run/docker.sock', path, timeout: PG_ACTIVITY_POLICY.queryDeadlineMs },
      (response) => {
        const chunks = [];
        let bytes = 0;
        response.on('data', (chunk) => {
          bytes += chunk.length;
          if (bytes > 2 * 1024 * 1024) outgoing.destroy();
          else chunks.push(chunk);
        });
        response.on('error', failTransport);
        response.on('end', () => {
          try {
            requireValue(
              response.statusCode === 200 && bytes <= 2 * 1024 * 1024,
              'DOCKER_TRANSPORT',
            );
            done(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch {
            failTransport();
          }
        });
      },
    );
    outgoing.on('error', failTransport);
    outgoing.on('timeout', () => outgoing.destroy());
    outgoing.end();
  });
}

export function nativePgActivityIo() {
  return {
    now: () => Date.now(),
    monotonic: () => performance.now(),
    wait,
    inspect: (id) => dockerJson('/containers/' + id + '/json'),
    network: (id) => dockerJson('/networks/' + id),
    readProgress: readActivityProgress,
    watch: (directory, changed) => watch(directory, changed),
    open: (pgId, nonce) =>
      spawn(
        'docker',
        [
          'exec',
          '-i',
          '--user',
          'postgres',
          '--env',
          'PGAPPNAME=asa-pg-activity-' + nonce,
          '--env',
          'PGCONNECT_TIMEOUT=2',
          '--env',
          'PGOPTIONS=',
          '--env',
          'PGPASSWORD=',
          '--env',
          'PGPASSFILE=/dev/null',
          '--env',
          'PGSERVICE=',
          '--env',
          'PGSERVICEFILE=/dev/null',
          '--env',
          'PGCLIENTENCODING=UTF8',
          pgId,
          'sh',
          '-c',
          processScript,
          'asa-pg-activity',
          nonce,
        ],
        { stdio: ['pipe', 'pipe', 'pipe'] },
      ),
    processProof: async (pgId, process, backend, timeoutMs) => {
      try {
        const result = await exec(
          'docker',
          [
            'exec',
            '--user',
            'postgres',
            pgId,
            'sh',
            '-c',
            processProofScript,
            'asa-pg-activity-proof',
            String(process.pid),
            process.startTicks,
            process.nonce,
            String(backend.pid),
            backend.startTicks || '0',
          ],
          { timeout: timeoutMs, maxBuffer: 4096, encoding: 'utf8', killSignal: 'SIGKILL' },
        );
        requireValue(!result.stderr, 'PROCESS_PROOF_TRANSPORT');
        return JSON.parse(result.stdout);
      } catch {
        fail('PROCESS_PROOF_TRANSPORT');
      }
    },
    writeReport: (path, value, nonce) => {
      requireValue(!existsSync(path), 'EVIDENCE_EXISTS');
      const temporary = path + '.' + nonce + '.tmp';
      const serialized = JSON.stringify(value) + '\n';
      requireValue(Buffer.byteLength(serialized) <= PG_ACTIVITY_POLICY.totalBytes, 'REPORT_BOUND');
      writeFileSync(temporary, serialized, { flag: 'wx', mode: 0o600 });
      renameSync(temporary, path);
    },
  };
}

/** Bounded protocol channel. No raw line, stderr, child error or cause is exported. */
export class PgActivityChannel {
  constructor(child, onFailure = () => {}) {
    this.child = child;
    this.queue = [];
    this.waiter = null;
    this.buffer = '';
    this.bytes = 0;
    this.stderrBytes = 0;
    this.closed = false;
    this.inputClosed = false;
    this.error = null;
    this.exitCode = null;
    this.onFailure = onFailure;
    this.allowPublicErrorStderr = false;
    const decoder = new StringDecoder('utf8');
    this.done = new Promise((done) => {
      child.once('error', () => {
        this.abandon('TRANSPORT_START');
      });
      child.once('close', (code) => {
        this.closed = true;
        this.exitCode = integer(code) ? code : null;
        this.buffer += decoder.end();
        if (this.buffer) this.abandon('FRAME_TRUNCATED');
        if (code !== 0 && !(this.allowPublicErrorStderr && code === 3)) this.abandon('CLIENT_EXIT');
        if (this.waiter) this.waiter.reject(new PgActivityError('SESSION_EXITED'));
        this.waiter = null;
        done();
      });
    });
    child.stdin.on('error', () => {
      if (!this.inputClosed) this.abandon('TRANSPORT_INPUT');
    });
    child.stdout.on('error', () => this.abandon('TRANSPORT_OUTPUT'));
    child.stderr.on('error', () => this.abandon('TRANSPORT_OUTPUT'));
    child.stderr.on('data', (chunk) => {
      this.stderrBytes += chunk.length;
      if (this.stderrBytes > PG_ACTIVITY_POLICY.stderrBytes) this.abandon('STDERR_BOUND');
      else if (chunk.length && !this.allowPublicErrorStderr) this.abandon('PSQL_STDERR');
    });
    child.stdout.on('data', (chunk) => {
      this.bytes += chunk.length;
      if (this.bytes > PG_ACTIVITY_POLICY.totalBytes) return this.abandon('OUTPUT_BOUND');
      if (this.error) return;
      this.buffer += decoder.write(chunk);
      if (
        Buffer.byteLength(this.buffer) > PG_ACTIVITY_POLICY.frameBytes &&
        !this.buffer.includes('\n')
      )
        return this.abandon('FRAME_BOUND');
      let at;
      while ((at = this.buffer.indexOf('\n')) >= 0 && !this.error) {
        const line = this.buffer.slice(0, at).replace(/\r$/, '');
        this.buffer = this.buffer.slice(at + 1);
        if (!line || Buffer.byteLength(line) > PG_ACTIVITY_POLICY.frameBytes)
          return this.abandon('FRAME_BOUND');
        try {
          const ack = line.match(
            /^ASA_PG_ACTIVITY_ROLLBACK ([a-f0-9]{32}) (\d{1,3}) ([A-Z0-9]{5})$/,
          );
          const frame = ack
            ? { kind: 'rollback', nonce: ack[1], sequence: Number(ack[2]), sqlstate: ack[3] }
            : JSON.parse(line);
          if (this.waiter) {
            const waiter = this.waiter;
            this.waiter = null;
            waiter.resolve(frame);
          } else {
            this.queue.push(frame);
            if (this.queue.length > 4) this.abandon('FRAME_ORDER');
          }
        } catch {
          this.abandon('FRAME_PARSE');
        }
      }
    });
  }

  endInput() {
    if (this.inputClosed) return;
    this.inputClosed = true;
    try {
      this.child.stdin.end();
    } catch {
      this.abandon('TRANSPORT_INPUT');
    }
  }

  abandon(code) {
    const firstFailure = !this.error;
    this.error ||= new PgActivityError(code);
    this.buffer = '';
    this.queue = [];
    if (this.waiter) this.waiter.reject(this.error);
    this.waiter = null;
    this.endInput();
    if (firstFailure) {
      try {
        this.onFailure(this.error);
      } catch {
        /* Transport failure remains sticky. */
      }
    }
  }

  async next(timeoutMs) {
    if (this.error) throw this.error;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      this.abandon('REQUEST_DEADLINE');
      throw this.error;
    }
    requireValue(!this.waiter, 'FRAME_ORDER');
    if (this.queue.length) return this.queue.shift();
    requireValue(!this.closed, 'SESSION_EXITED');
    return new Promise((done, reject) => {
      const timer = setTimeout(() => this.abandon('REQUEST_DEADLINE'), timeoutMs);
      this.waiter = {
        resolve: (value) => {
          clearTimeout(timer);
          done(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      };
    });
  }
}

const assertProcessProof = (value) => {
  exactKeys(value, ['client', 'backend', 'backendStartTicks']);
  requireValue(
    ['matching', 'changing', 'absent', 'retired'].includes(value.client) &&
      ['matching', 'changing', 'absent', 'retired'].includes(value.backend) &&
      /^\d{1,20}$/.test(value.backendStartTicks),
    'PROCESS_PROOF',
  );
  return value;
};
const retired = (status) => status === 'absent' || status === 'retired';

export class PgActivitySession {
  constructor(options, io, identity, onFailure = () => {}) {
    assertResourceActive(options);
    this.options = options;
    this.io = io;
    this.identity = identity;
    this.nonce = randomBytes(16).toString('hex');
    this.sequence = 0;
    this.busy = false;
    this.lastRollback = false;
    this.channel = new PgActivityChannel(io.open(options.postgresId, this.nonce), onFailure);
    this.resourceStopped = () => {
      // EOF is immediate even while identity transport or a query is pending.
      // Closure proof remains independent of cancellation and may still fail.
      this.channel.abandon('RESOURCE_STOP');
      void this.close();
    };
    options.resourceSignal.addEventListener('abort', this.resourceStopped, { once: true });
    if (options.resourceSignal.aborted) this.resourceStopped();
  }

  checkActive() {
    if (this.channel.error) throw this.channel.error;
    assertResourceActive(this.options);
  }

  async request(kind, address) {
    this.checkActive();
    requireValue(!this.busy && !this.channel.closed && !this.channel.inputClosed, 'SESSION_STATE');
    this.busy = true;
    this.lastRollback = false;
    const sequence = this.sequence++;
    const deadline = this.io.monotonic() + PG_ACTIVITY_POLICY.queryDeadlineMs;
    const remaining = () => deadline - this.io.monotonic();
    let value;
    try {
      requireValue(this.channel.stderrBytes === 0, 'PSQL_STDERR');
      // Only this fixed public division-by-zero smoke permits error stderr.
      // The bytes are discarded and cannot carry forward into another request.
      this.channel.allowPublicErrorStderr = kind === 'error';
      this.checkActive();
      this.channel.child.stdin.write(activityCommand(kind, this.nonce, sequence, address));
      value = await this.channel.next(remaining());
      this.checkActive();
      requireValue(
        value?.kind === kind &&
          value.nonce === this.nonce &&
          value.sequence === sequence &&
          value.readOnly === true,
        'FRAME_IDENTITY',
      );
      const ack = await this.channel.next(remaining());
      this.checkActive();
      exactKeys(ack, ['kind', 'nonce', 'sequence', 'sqlstate']);
      requireValue(
        ack.kind === 'rollback' &&
          ack.nonce === this.nonce &&
          ack.sequence === sequence &&
          ack.sqlstate === '00000',
        'ROLLBACK_UNCONFIRMED',
      );
      requireValue(this.channel.stderrBytes === 0, 'PSQL_STDERR');
      requireValue(remaining() > 0, 'REQUEST_DEADLINE');
      this.checkActive();
      this.lastRollback = true;
      return { value, sequence, rollbackConfirmed: true };
    } catch (error) {
      this.channel.abandon(pgActivityError(error));
      throw new PgActivityError(pgActivityError(error));
    } finally {
      this.busy = false;
      this.channel.allowPublicErrorStderr = false;
    }
  }

  async open() {
    this.checkActive();
    const process = await this.channel.next(PG_ACTIVITY_POLICY.queryDeadlineMs);
    this.checkActive();
    exactKeys(process, ['kind', 'nonce', 'pid', 'startTicks']);
    requireValue(
      process.kind === 'process' &&
        process.nonce === this.nonce &&
        integer(process.pid) &&
        process.pid > 1 &&
        /^[1-9]\d{0,19}$/.test(process.startTicks),
      'PROCESS_IDENTITY',
    );
    this.process = process;
    const first = await this.request('hello');
    this.hello = assertActivityHello(first.value, this.nonce, first.sequence);
    this.backend = {
      pid: this.hello.backendPid,
      startedAt: this.hello.backendStart,
      startTicks: '0',
    };
    await captureActivityIdentity(this.options, this.io, this.identity, () => this.checkActive());
    const proof = assertProcessProof(
      await this.io.processProof(
        this.options.postgresId,
        this.process,
        this.backend,
        PG_ACTIVITY_POLICY.queryDeadlineMs,
      ),
    );
    this.checkActive();
    requireValue(
      proof.client === 'matching' &&
        proof.backend === 'matching' &&
        /^[1-9]\d{0,19}$/.test(proof.backendStartTicks),
      'PROCESS_BINDING',
    );
    this.backend.startTicks = proof.backendStartTicks;
    const second = await this.request('hello');
    const confirmed = assertActivityHello(second.value, this.nonce, second.sequence);
    requireValue(
      confirmed.backendPid === this.backend.pid &&
        confirmed.backendStart === this.backend.startedAt &&
        confirmed.trackQueryBytes === this.hello.trackQueryBytes &&
        JSON.stringify(confirmed.logging) === JSON.stringify(this.hello.logging),
      'BACKEND_BINDING',
    );
    await captureActivityIdentity(this.options, this.io, this.identity, () => this.checkActive());
    this.checkActive();
    return this;
  }

  async binding() {
    // The hello/logging checks necessarily precede the first address bind.
    this.checkActive();
    requireValue(this.hello && this.backend?.startTicks !== '0', 'BINDING_NOT_READY');
    const result = await this.request('binding', this.identity.network.apiAddress);
    exactKeys(result.value, ['kind', 'nonce', 'sequence', 'readOnly', 'matchingBackends']);
    requireValue(
      integer(result.value.matchingBackends) && result.value.matchingBackends > 0,
      'API_BACKEND_NOT_OBSERVED',
    );
    return { observed: true, attribution: 'API backends, not a specific Node.js pool' };
  }

  async close() {
    if (this.closure) return this.closure;
    this.closure = activityDeadline(
      async (check) => {
        this.channel.endInput();
        const deadline = this.io.monotonic() + PG_ACTIVITY_POLICY.closureDeadlineMs;
        if (!this.process || !this.backend || this.backend.startTicks === '0')
          return {
            status: 'FAIL',
            code: 'CLOSURE_IDENTITY_UNCONFIRMED',
            psqlClosed: false,
            backendClosed: false,
            explicitRollbackConfirmed: this.lastRollback,
          };
        try {
          let proof;
          while (this.io.monotonic() < deadline) {
            check();
            if (!this.channel.closed) {
              await this.io.wait(Math.min(100, Math.max(0, deadline - this.io.monotonic())));
              continue;
            }
            await captureActivityIdentity(this.options, this.io, this.identity, check);
            const remaining = deadline - this.io.monotonic();
            requireValue(remaining > 0, 'CLOSURE_DEADLINE');
            proof = assertProcessProof(
              await this.io.processProof(
                this.options.postgresId,
                this.process,
                this.backend,
                Math.min(remaining, PG_ACTIVITY_POLICY.queryDeadlineMs),
              ),
            );
            check();
            if (retired(proof.client) && retired(proof.backend) && this.channel.closed) {
              await captureActivityIdentity(this.options, this.io, this.identity, check);
              check();
              return {
                status: 'PASS',
                psqlClosed: true,
                backendClosed: true,
                explicitRollbackConfirmed: this.lastRollback,
                transactionEnd: this.lastRollback
                  ? 'acknowledged-rollback-then-disconnect'
                  : 'connection-closed-without-rollback-ack',
                exitCode: this.channel.exitCode,
              };
            }
            await this.io.wait(Math.min(100, Math.max(0, deadline - this.io.monotonic())));
          }
          return {
            status: 'FAIL',
            code: 'CLOSURE_DEADLINE',
            psqlClosed: retired(proof?.client) && this.channel.closed,
            backendClosed: retired(proof?.backend),
            explicitRollbackConfirmed: this.lastRollback,
          };
        } catch (error) {
          return {
            status: 'FAIL',
            code: pgActivityError(error),
            psqlClosed: false,
            backendClosed: false,
            explicitRollbackConfirmed: this.lastRollback,
          };
        }
      },
      PG_ACTIVITY_POLICY.closureDeadlineMs,
      'CLOSURE_DEADLINE',
      () => {},
      this.io.monotonic,
    )
      .catch((error) => ({
        status: 'FAIL',
        code: pgActivityError(error),
        psqlClosed: false,
        backendClosed: false,
        explicitRollbackConfirmed: this.lastRollback,
      }))
      .finally(() =>
        this.options.resourceSignal.removeEventListener('abort', this.resourceStopped),
      );
    return this.closure;
  }
}

function validateOptions(options) {
  try {
    requireValue(hex(options.releaseSha, 40) && integer(options.startedAtMs), 'OPTIONS');
    requireValue(options.resourceSignal instanceof globalThis.AbortSignal, 'RESOURCE_SIGNAL');
    const root = options.expected?.root;
    requireValue(typeof root === 'string' && realpathSync(root) === root, 'EVIDENCE_DIRECTORY');
    requireValue(
      typeof options.directory === 'string' &&
        resolve(options.directory) === options.directory &&
        realpathSync(options.directory) === options.directory &&
        options.directory.startsWith(resolve(root, 'reports/classroom-official-n30') + sep),
      'EVIDENCE_DIRECTORY',
    );
  } catch (error) {
    if (error instanceof PgActivityError) throw error;
    fail('EVIDENCE_DIRECTORY');
  }
}

const publicIdentity = (options, identity) => ({
  releaseSha: options.releaseSha,
  project: options.expected.project,
  api: identity.api,
  postgres: identity.postgres,
  networkId: identity.network.id,
  binding: 'API container address retained only in memory; API pools are not distinguished',
});

/** The caller must require actual PASS before running any browser workload. */
export async function qualifyPgActivityNative(options, io = nativePgActivityIo()) {
  validateOptions(options);
  const nonce = randomBytes(16).toString('hex');
  const path = resolve(options.directory, 'pg-activity-smoke.json');
  requireValue(!existsSync(path), 'EVIDENCE_EXISTS');
  const receipt = {
    version: 1,
    status: 'FAIL',
    policy: PG_ACTIVITY_POLICY,
    startedAtMs: io.now(),
    cases: [],
  };
  let session;
  try {
    const checkActive = () => assertResourceActive(options);
    const identity = await captureActivityIdentity(options, io, undefined, checkActive);
    receipt.identity = publicIdentity(options, identity);
    for (const kind of ['smoke', 'error', 'sleep']) {
      checkActive();
      session = new PgActivitySession(options, io, identity);
      await session.open();
      checkActive();
      if (kind === 'smoke') await session.binding();
      checkActive();
      let result;
      let errorCode;
      const started = io.monotonic();
      try {
        result = await session.request(kind);
      } catch (error) {
        errorCode = pgActivityError(error);
      }
      const durationMs = io.monotonic() - started;
      const closure = await session.close();
      const code = session.channel.exitCode;
      receipt.cases.push({
        kind,
        durationMs,
        rollbackConfirmed: result?.rollbackConfirmed === true,
        errorCode: errorCode || null,
        closure,
      });
      requireValue(closure.status === 'PASS', closure.code || 'CLOSURE_UNCONFIRMED');
      checkActive();
      if (kind === 'smoke') {
        requireValue(
          code === 0 && !session.channel.error && session.channel.stderrBytes === 0,
          'SMOKE_CLIENT_EXIT',
        );
        exactKeys(result?.value, ['kind', 'nonce', 'sequence', 'readOnly', 'hash']);
        requireValue(
          !errorCode &&
            result.rollbackConfirmed &&
            result.value.hash === hash('asa_pg_activity_smoke'),
          'SMOKE_FRAME',
        );
      } else if (kind === 'error') {
        requireValue(
          errorCode === 'SESSION_EXITED' && code === 3 && !closure.explicitRollbackConfirmed,
          'SMOKE_ERROR_EXIT',
        );
      } else {
        requireValue(
          errorCode === 'REQUEST_DEADLINE' &&
            durationMs >= PG_ACTIVITY_POLICY.queryDeadlineMs &&
            !closure.explicitRollbackConfirmed,
          'SMOKE_TIMEOUT',
        );
      }
      session = undefined;
    }
    checkActive();
    receipt.status = 'PASS';
  } catch (error) {
    receipt.code = pgActivityError(error);
    if (receipt.code === 'RESOURCE_STOP') {
      receipt.status = 'BLOCKED_BY_RUNNER';
      receipt.classification = 'resource_stop';
    }
    if (session) receipt.failedSessionClosure = await session.close();
  } finally {
    receipt.finishedAtMs = io.now();
    io.writeReport(path, receipt, nonce);
  }
  return receipt;
}

export async function startPgActivityObserver(options, onFailure, io = nativePgActivityIo()) {
  validateOptions(options);
  requireValue(typeof onFailure === 'function', 'FAILURE_CALLBACK');
  const nonce = randomBytes(16).toString('hex');
  const path = resolve(options.directory, 'pg-activity.json');
  requireValue(!existsSync(path), 'EVIDENCE_EXISTS');
  const report = {
    version: 1,
    status: 'NOT_CAPTURED',
    policy: PG_ACTIVITY_POLICY,
    startedAtMs: io.now(),
    samples: [],
    phase: null,
    queryCatalog: {
      knownRelease: PG_ACTIVITY_QUERY_SOURCE.revisions.includes(options.releaseSha),
      source: PG_ACTIVITY_QUERY_SOURCE.path,
      sha256: PG_ACTIVITY_QUERY_SOURCE.revisions.includes(options.releaseSha)
        ? PG_ACTIVITY_QUERY_SOURCE.sha256
        : null,
    },
  };
  let session;
  let identity;
  let lastSignal;
  let closed = false;
  let phaseEnded = false;
  let pending;
  let interval;
  let sampleTimer;
  let watcher;
  let lastSampleMonotonic = -Infinity;
  let phaseDeadlineMonotonic;
  let closure;
  let finished;
  let errorCode;
  const beginClosure = () => {
    if (session && !closure) closure = session.close();
  };
  const stopWatching = () => {
    clearInterval(interval);
    clearTimeout(sampleTimer);
    try {
      watcher?.close();
      return true;
    } catch {
      report.watcherCloseFailed = true;
      return false;
    }
  };
  const recordFailure = (error) => {
    if (errorCode) return;
    errorCode = pgActivityError(error);
    report.status = errorCode === 'RESOURCE_STOP' ? 'BLOCKED_BY_RUNNER' : 'FAILED';
    if (errorCode === 'RESOURCE_STOP') report.classification = 'resource_stop';
    report.code = errorCode;
    report.failedAtMs = io.now();
    stopWatching();
    // Notify immediately at the request deadline, before up to five seconds of
    // closure verification. The caller aborts only its own browser/next level.
    try {
      onFailure(errorCode);
    } catch {
      report.callbackFailed = true;
    }
    session?.channel.abandon(errorCode);
    beginClosure();
  };
  const checkActive = () => {
    if (errorCode) fail(errorCode);
    assertResourceActive(options);
    if (session) session.checkActive();
  };
  const resourceStopped = () => recordFailure(new PgActivityError('RESOURCE_STOP'));
  const readSignal = () => {
    const value = io.readProgress(options.directory);
    if (value === null) {
      requireValue(!lastSignal, 'PROGRESS_DISAPPEARED');
      return;
    }
    const observedAtMs = io.now();
    lastSignal = validateActivityProgress(value, options.startedAtMs, observedAtMs, lastSignal);
    if (lastSignal.phase === PG_ACTIVITY_POLICY.phase && !report.phase) {
      // Anchor the remaining window once. Wall timestamps still validate and
      // describe the phase, but a later wall-clock step cannot extend capture.
      const elapsedMs = Math.max(0, observedAtMs - lastSignal.atMs);
      phaseDeadlineMonotonic =
        io.monotonic() + Math.max(0, PG_ACTIVITY_POLICY.windowMs - elapsedMs);
      report.phase = {
        startedAtMs: lastSignal.atMs,
        firstObservedAtMs: observedAtMs,
        firstSampleLagMs: null,
        endedAtMs: null,
      };
    }
    if (report.phase && lastSignal.phase !== PG_ACTIVITY_POLICY.phase) {
      report.phase.endedAtMs = lastSignal.atMs;
      phaseEnded = true;
    }
    if (
      report.phase &&
      (observedAtMs - report.phase.startedAtMs >= PG_ACTIVITY_POLICY.windowMs ||
        io.monotonic() >= phaseDeadlineMonotonic)
    ) {
      report.windowLimitReached = true;
      phaseEnded = true;
    }
  };
  const sample = () =>
    activityDeadline(
      async (check) => {
        const checkSample = () => {
          checkActive();
          check();
        };
        const requestedAtMs = io.now();
        lastSampleMonotonic = io.monotonic();
        await captureActivityIdentity(options, io, identity, checkSample);
        checkSample();
        // Identity transport may consume the last part of the phase window.
        // Do not issue another SQL statement after that window has ended.
        readSignal();
        checkSample();
        if (phaseEnded) return;
        const result = await session.request('sample', identity.network.apiAddress);
        checkSample();
        const receivedAtMs = io.now();
        const projected = projectActivitySample(result.value, {
          nonce: session.nonce,
          sequence: result.sequence,
          releaseSha: options.releaseSha,
          trackQueryBytes: session.hello.trackQueryBytes,
        });
        await captureActivityIdentity(options, io, identity, checkSample);
        checkSample();
        readSignal();
        const previous = report.samples.at(-1);
        const item = {
          requestedAtMs,
          receivedAtMs,
          verifiedAtMs: io.now(),
          gapFromPreviousStartMs: previous ? requestedAtMs - previous.requestedAtMs : null,
          rollbackConfirmed: result.rollbackConfirmed,
          phaseEndedDuringSample:
            report.phase.endedAtMs !== null && receivedAtMs >= report.phase.endedAtMs,
          ...projected,
        };
        requireValue(
          Buffer.byteLength(JSON.stringify(item)) <= PG_ACTIVITY_POLICY.frameBytes,
          'SAMPLE_BOUND',
        );
        const candidate = { ...report, samples: [...report.samples, item] };
        requireValue(
          Buffer.byteLength(JSON.stringify(candidate)) <= PG_ACTIVITY_POLICY.totalBytes - 4096,
          'REPORT_BOUND',
        );
        checkSample();
        report.samples.push(item);
        report.phase.firstSampleLagMs ??= requestedAtMs - report.phase.startedAtMs;
        report.status = 'CAPTURED';
      },
      PG_ACTIVITY_POLICY.queryDeadlineMs,
      'REQUEST_DEADLINE',
      () => recordFailure(new PgActivityError('REQUEST_DEADLINE')),
      io.monotonic,
    );
  const tick = () => {
    if (closed || errorCode || phaseEnded) return;
    try {
      readSignal();
    } catch (error) {
      recordFailure(error);
      return;
    }
    if (!report.phase) return;
    if (phaseEnded || report.samples.length >= PG_ACTIVITY_POLICY.samples) {
      phaseEnded = true;
      report.sampleLimitReached = report.samples.length >= PG_ACTIVITY_POLICY.samples;
      stopWatching();
      if (!pending) beginClosure();
      return;
    }
    if (pending) return;
    const remaining = PG_ACTIVITY_POLICY.intervalMs - (io.monotonic() - lastSampleMonotonic);
    if (remaining > 0) {
      clearTimeout(sampleTimer);
      sampleTimer = setTimeout(tick, remaining);
      return;
    }
    pending = sample()
      .catch(recordFailure)
      .finally(() => {
        pending = undefined;
        if (closed || phaseEnded || errorCode) {
          stopWatching();
          beginClosure();
        } else {
          clearTimeout(sampleTimer);
          sampleTimer = setTimeout(
            tick,
            Math.max(0, PG_ACTIVITY_POLICY.intervalMs - (io.monotonic() - lastSampleMonotonic)),
          );
        }
      });
  };
  try {
    options.resourceSignal.addEventListener('abort', resourceStopped, { once: true });
    if (options.resourceSignal.aborted) resourceStopped();
    identity = await captureActivityIdentity(options, io, undefined, checkActive);
    report.identity = publicIdentity(options, identity);
    checkActive();
    session = new PgActivitySession(options, io, identity, recordFailure);
    await session.open();
    checkActive();
    report.backendBinding = await session.binding();
    await captureActivityIdentity(options, io, identity, checkActive);
    checkActive();
    watcher = io.watch(options.directory, tick);
    watcher.on('error', () => recordFailure(new PgActivityError('PROGRESS_WATCH')));
    interval = setInterval(tick, PG_ACTIVITY_POLICY.intervalMs);
    tick();
    if (errorCode) throw new PgActivityError(errorCode);
  } catch (error) {
    recordFailure(error);
    report.closure = session ? await session.close() : { status: 'NOT_OPENED' };
    options.resourceSignal.removeEventListener('abort', resourceStopped);
    report.finishedAtMs = io.now();
    io.writeReport(path, report, nonce);
    throw new PgActivityError(errorCode);
  }
  return {
    get error() {
      return errorCode;
    },
    async finish() {
      if (finished) return finished;
      finished = (async () => {
        closed = true;
        if (!stopWatching()) recordFailure(new PgActivityError('WATCHER_CLOSURE'));
        await pending;
        beginClosure();
        report.closure = await closure;
        if (report.closure.status !== 'PASS')
          recordFailure(new PgActivityError(report.closure.code || 'CLOSURE_UNCONFIRMED'));
        options.resourceSignal.removeEventListener('abort', resourceStopped);
        report.finishedAtMs = io.now();
        if (!report.phase) report.notCapturedReason = 'phase_not_observed';
        else if (!report.samples.length)
          report.notCapturedReason = 'phase_missed_or_window_expired';
        io.writeReport(path, report, nonce);
        return report;
      })();
      return finished;
    },
  };
}
