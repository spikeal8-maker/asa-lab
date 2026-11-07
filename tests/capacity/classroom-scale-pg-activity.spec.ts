// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { PassThrough, Writable } from 'node:stream';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PG_ACTIVITY_NATIVE_SCRIPTS,
  PG_ACTIVITY_POLICY,
  PG_ACTIVITY_QUERY_SOURCE,
  PG_ACTIVITY_SQL,
  PgActivityChannel,
  PgActivityError,
  PgActivitySession,
  activityCommand,
  assertActivityHello,
  captureActivityIdentity,
  nativePgActivityIo,
  pgActivityError,
  projectActivitySample,
  qualifyPgActivityNative,
  readActivityProgress,
  startPgActivityObserver,
  validateActivityProgress,
} from '../../tools/capacity/classroom-scale-pg-activity.mjs';

// Keep the production module's Node timer interface, with a controllable clock
// for deadline/order tests. These tests do not qualify a native PostgreSQL run.
vi.mock('node:timers', () => ({
  setTimeout: (callback: () => void, milliseconds: number) =>
    globalThis.setTimeout(callback, milliseconds),
  clearTimeout: (timer: ReturnType<typeof setTimeout>) => globalThis.clearTimeout(timer),
  setInterval: (callback: () => void, milliseconds: number) =>
    globalThis.setInterval(callback, milliseconds),
  clearInterval: (timer: ReturnType<typeof setInterval>) => globalThis.clearInterval(timer),
}));
vi.mock('node:perf_hooks', () => ({
  performance: { now: () => globalThis.performance.now() },
}));

const nonce = 'a'.repeat(32);
const releaseSha = PG_ACTIVITY_QUERY_SOURCE.revisions[0];
const apiId = '1'.repeat(64);
const postgresId = '2'.repeat(64);
const networkId = '3'.repeat(64);
const apiEndpoint = '4'.repeat(64);
const pgEndpoint = '5'.repeat(64);
const apiAddress = '172.25.0.2';
const pgAddress = '172.25.0.3';
const backendStartedAt = '2026-11-07T12:00:00.000Z';
const privateText = 'SELECT private_learner_data; password=private-secret';
const directories: string[] = [];

function loggingSettings(): Record<string, string> {
  return {
    log_statement: 'none',
    log_duration: 'off',
    log_min_duration_statement: '-1',
    log_min_duration_sample: '-1',
    log_statement_sample_rate: '1',
    log_transaction_sample_rate: '0',
    log_parameter_max_length: '-1',
    log_parameter_max_length_on_error: '0',
    debug_print_parse: 'off',
    debug_print_rewritten: 'off',
    debug_print_plan: 'off',
    log_statement_stats: 'off',
    log_parser_stats: 'off',
    log_planner_stats: 'off',
    log_executor_stats: 'off',
    shared_preload_libraries: '',
    session_preload_libraries: '',
    local_preload_libraries: '',
  };
}

function hello(id = nonce, sequence = 0) {
  return {
    kind: 'hello',
    nonce: id,
    sequence,
    readOnly: true,
    version: 170007,
    database: 'asalab_test',
    role: 'postgres',
    local: true,
    backendPid: 402,
    backendStart: backendStartedAt,
    trackActivities: 'on',
    trackQueryBytes: 1024,
    logging: loggingSettings(),
  };
}

function row() {
  return {
    backend: '6'.repeat(64),
    state: 'active',
    queryAgeMs: 1250,
    transactionAgeMs: 1300,
    waitType: null as string | null,
    waitEvent: null as string | null,
    queryHash: PG_ACTIVITY_QUERY_SOURCE.queries[0][0] as string,
    queryBytes: PG_ACTIVITY_QUERY_SOURCE.queries[0][1] as number,
  };
}

function sampleFrame(id = nonce, sequence = 0) {
  return {
    kind: 'sample',
    nonce: id,
    sequence,
    readOnly: true,
    serverAt: new Date().toISOString(),
    trackQueryBytes: 1024,
    observedAtLeast: 1,
    rowsTruncated: false,
    rows: [row()],
  };
}

type Frame = Record<string, unknown>;
type RequestRecord = { kind: string; atMs: number; command: string };

class FakePsql extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdin: Writable;
  readonly commands: RequestRecord[] = [];
  busy = false;
  ended = false;
  closed = false;
  backendClosed = false;
  backendNeverCloses = false;
  sampleDelayMs = 1;
  ackDelayMs = 0;
  exitCodeOnEof = 0;
  sampleFrame = sampleFrame;
  transform = (_kind: string, frame: Frame): Frame => frame;
  afterOutput: (kind: string) => void = () => {};
  ackSqlstate = '00000';
  helloSettings = loggingSettings();

  constructor(readonly nonce: string) {
    super();
    this.stdin = new Writable({
      write: (chunk, _encoding, done) => {
        this.receive(chunk.toString());
        done();
      },
    });
    this.stdin.on('finish', () => {
      this.ended = true;
      if (!this.busy) this.close(this.exitCodeOnEof);
    });
    setTimeout(
      () =>
        this.stdout.write(
          JSON.stringify({ kind: 'process', nonce, pid: 401, startTicks: '10001' }) + '\n',
        ),
      0,
    );
  }

  receive(command: string) {
    const kind = command.match(/'kind','([a-z]+)'/)?.[1] || 'error';
    const parameters = command.match(/\\bind '([a-f0-9]{32})' '(\d+)'/);
    const sequence = Number(parameters?.[2] || 0);
    this.commands.push({ kind, command, atMs: performance.now() });
    this.busy = true;
    const delay = kind === 'sleep' ? 3000 : kind === 'sample' ? this.sampleDelayMs : 1;
    setTimeout(() => {
      if (kind === 'error') {
        this.stderr.write('ERROR: ' + privateText + '\n');
        this.busy = false;
        this.close(3);
        return;
      }
      let frame: Frame = { kind, nonce: this.nonce, sequence, readOnly: true };
      if (kind === 'hello') frame = { ...hello(this.nonce, sequence), logging: this.helloSettings };
      if (kind === 'binding') frame.matchingBackends = 10;
      if (kind === 'smoke')
        frame.hash = createHash('sha256').update('asa_pg_activity_smoke').digest('hex');
      if (kind === 'sample') frame = this.sampleFrame(this.nonce, sequence);
      this.stdout.write(JSON.stringify(this.transform(kind, frame)) + '\n');
      const acknowledge = () => {
        this.stdout.write(
          'ASA_PG_ACTIVITY_ROLLBACK ' + this.nonce + ' ' + sequence + ' ' + this.ackSqlstate + '\n',
        );
        this.afterOutput(kind);
        this.busy = false;
        if (this.ended) this.close(this.exitCodeOnEof);
      };
      if (this.ackDelayMs) setTimeout(acknowledge, this.ackDelayMs);
      else acknowledge();
    }, delay);
  }

  close(code: number) {
    if (this.closed) return;
    this.closed = true;
    this.emit('close', code);
    if (!this.backendNeverCloses)
      setTimeout(() => {
        this.backendClosed = true;
      }, 100);
  }
}

function fixture(variant = 'baseline') {
  const root = mkdtempSync(join(tmpdir(), 'asa-pg-activity-'));
  directories.push(root);
  const directory = join(root, 'reports/classroom-official-n30/run', variant, 'level-30');
  mkdirSync(directory, { recursive: true });
  const project = 'asa-scale-42300000000-1-' + variant;
  const configFiles =
    join(root, 'compose.yaml') + ',' + join(root, '.github/compose.classroom-scale.yml');
  const images = {
    api: {
      reference: 'ghcr.io/spikeal8-maker/asa-lab-api@sha256:' + '7'.repeat(64),
      id: 'sha256:' + '8'.repeat(64),
    },
    postgres: { reference: 'postgres@sha256:' + '9'.repeat(64), id: 'sha256:' + 'b'.repeat(64) },
  };
  const expected = { root, project, configFiles, runToken: nonce, images };
  const resourceStop = new AbortController();
  const metadata = (service: 'api' | 'postgres') => ({
    Id: service === 'api' ? apiId : postgresId,
    Image: images[service].id,
    Config: {
      Image: images[service].reference,
      Labels: {
        'com.docker.compose.service': service,
        'com.docker.compose.project': project,
        'com.docker.compose.project.working_dir': root,
        'com.docker.compose.project.config_files': configFiles,
        'io.asalab.scale.run': nonce,
      },
    },
    State: { Running: true, StartedAt: backendStartedAt, Health: { Status: 'healthy' } },
    RestartCount: 0,
    NetworkSettings: {
      Networks: {
        [project + '_database']: {
          NetworkID: networkId,
          EndpointID: service === 'api' ? apiEndpoint : pgEndpoint,
          IPAddress: service === 'api' ? apiAddress : pgAddress,
        },
      },
    },
  });
  const api = metadata('api');
  const postgres = metadata('postgres');
  const network = {
    Id: networkId,
    Name: project + '_database',
    Driver: 'bridge',
    Internal: true,
    EnableIPv6: false,
    Labels: {
      'com.docker.compose.project': project,
      'com.docker.compose.network': 'database',
      'io.asalab.scale.run': nonce,
    },
    Containers: {
      [apiId]: { EndpointID: apiEndpoint, IPv4Address: apiAddress + '/24' },
      [postgresId]: { EndpointID: pgEndpoint, IPv4Address: pgAddress + '/24' },
    },
  };
  const processes: FakePsql[] = [];
  const reports: { path: string; value: Frame; text: string }[] = [];
  const watcher = Object.assign(new EventEmitter(), { close: vi.fn() });
  const state: {
    progress: { phase: string; atMs: number } | null;
    change: () => void;
    customize: (child: FakePsql) => void;
    proof: undefined | (() => Frame);
  } = {
    progress: null,
    change: () => {},
    customize: () => {},
    proof: undefined,
  };
  const io = {
    now: () => Date.now(),
    monotonic: () => performance.now(),
    wait: (milliseconds: number) => new Promise<void>((done) => setTimeout(done, milliseconds)),
    inspect: async (id: string) => structuredClone(id === apiId ? api : postgres),
    network: async () => structuredClone(network),
    readProgress: () => state.progress,
    watch: (_directory: string, change: () => void) => {
      state.change = change;
      return watcher;
    },
    open: (_id: string, id: string) => {
      const child = new FakePsql(id);
      state.customize(child);
      processes.push(child);
      return child;
    },
    processProof: async () => {
      if (state.proof) return state.proof();
      const child = processes.at(-1)!;
      return {
        client: child.closed ? 'absent' : 'matching',
        backend: child.backendClosed ? 'absent' : 'matching',
        backendStartTicks: '10002',
      };
    },
    writeReport: (path: string, value: Frame) => {
      reports.push({ path, value: structuredClone(value), text: JSON.stringify(value) });
    },
  };
  return {
    options: {
      directory,
      startedAtMs: Date.now(),
      releaseSha,
      apiId,
      postgresId,
      expected,
      resourceSignal: resourceStop.signal,
    },
    resourceStop,
    io: io as unknown as ReturnType<typeof nativePgActivityIo>,
    controls: io,
    state,
    api,
    postgres,
    network,
    processes,
    reports,
    watcher,
  };
}

async function settle<T>(promise: Promise<T>, limitMs = 10000): Promise<T> {
  let outcome: { ok: true; value: T } | { ok: false; error: unknown } | undefined;
  void promise.then(
    (value) => {
      outcome = { ok: true, value };
    },
    (error: unknown) => {
      outcome = { ok: false, error };
    },
  );
  for (let elapsed = 0; !outcome && elapsed <= limitMs; elapsed += 10)
    await vi.advanceTimersByTimeAsync(10);
  if (!outcome) throw Error('Test promise exceeded its explicit mock-clock bound');
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}

function driverArrow(name: string, context: Record<string, unknown>) {
  const path = 'tools/capacity/classroom-scale.mjs';
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest);
  let initializer: ts.ArrowFunction | undefined;
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(source) === name &&
      node.initializer &&
      ts.isArrowFunction(node.initializer)
    )
      initializer = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!initializer) throw Error('Missing actual driver arrow: ' + name);
  return runInNewContext('(' + initializer.getText(source) + ')', context) as (
    ...args: unknown[]
  ) => Promise<unknown>;
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['Date', 'performance', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
  });
  vi.setSystemTime(new Date('2026-11-07T13:00:00.000Z'));
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe('PostgreSQL 17 protocol and privacy boundary', () => {
  it.each([undefined, '', 'must-not-load-inherited-service'])(
    'starts psql with PGSERVICE absent when its initial value is %j',
    (service) => {
      const directory = mkdtempSync(join(tmpdir(), 'asa-pg-startup-'));
      directories.push(directory);
      // Execute the real startup script with fixtures for the stat read and client.
      // This checks the child environment, not native /proc or PostgreSQL proof.
      // Even an empty PGSERVICE selects a service in libpq; it must be absent.
      writeFileSync(
        join(directory, 'awk'),
        `#!/bin/sh
set -eu
[ "$#" -eq 2 ] && [ "$1" = '{print $22}' ]
case "$2" in /proc/[0-9]*/stat) ;; *) exit 79 ;; esac
printf '12345\\n'
`,
        { mode: 0o700 },
      );
      writeFileSync(
        join(directory, 'psql'),
        `#!/bin/sh
set -eu
if [ "\${PGSERVICE+x}" = x ]; then exit 78; fi
printf '%s\\n' PGSERVICE_UNSET "$PGAPPNAME" "$PGCONNECT_TIMEOUT" "$PGOPTIONS" "$PGPASSWORD" "$PGPASSFILE" "$PGSERVICEFILE" "$PGCLIENTENCODING"
printf '%s\\n' "$@"
`,
        { mode: 0o700 },
      );
      const env: Record<string, string> = {
        PATH: directory + ':/usr/bin:/bin',
        PGAPPNAME: 'asa-pg-activity-' + nonce,
        PGCONNECT_TIMEOUT: '2',
        PGOPTIONS: '',
        PGPASSWORD: '',
        PGPASSFILE: '/dev/null',
        PGSERVICEFILE: '/dev/null',
        PGCLIENTENCODING: 'UTF8',
      };
      if (service !== undefined) env.PGSERVICE = service;
      const output = execFileSync(
        'sh',
        ['-c', PG_ACTIVITY_NATIVE_SCRIPTS.start, 'asa-pg-activity', nonce],
        {
          env,
          encoding: 'utf8',
          timeout: 2000,
          maxBuffer: 4096,
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      );
      const [processFrame, ...clientOutput] = output.trimEnd().split('\n');
      expect(JSON.parse(processFrame!)).toMatchObject({
        kind: 'process',
        nonce,
        pid: expect.any(Number),
        startTicks: '12345',
      });
      expect(clientOutput).toEqual([
        'PGSERVICE_UNSET',
        'asa-pg-activity-' + nonce,
        '2',
        '',
        '',
        '/dev/null',
        '/dev/null',
        'UTF8',
        '-X',
        '-qAt',
        '-w',
        '-h',
        '/var/run/postgresql',
        '-U',
        'postgres',
        '-d',
        'asalab_test',
        '-v',
        'ON_ERROR_STOP=1',
        '-v',
        'ECHO=none',
        '-v',
        'VERBOSITY=terse',
      ]);
    },
  );

  it('binds only the next single SELECT, surrounds it with read-only/rollback, and never interpolates the address into SQL', () => {
    const command = activityCommand('sample', nonce, 4, apiAddress);
    expect(command).toBe(
      'BEGIN READ ONLY;\n' +
        PG_ACTIVITY_SQL.sample +
        "\n\\bind '" +
        nonce +
        "' '4' '" +
        apiAddress +
        "'\n\\g\nROLLBACK;\n\\echo ASA_PG_ACTIVITY_ROLLBACK " +
        nonce +
        ' 4 :SQLSTATE\n',
    );
    expect(PG_ACTIVITY_SQL.sample).not.toContain(apiAddress);
    expect(PG_ACTIVITY_SQL.sample).not.toContain(';');
    expect(PG_ACTIVITY_SQL.sample).not.toMatch(/'query'\s*,\s*query/);
    expect(PG_ACTIVITY_SQL.sample).toContain('pg_catalog.sha256');
    expect(activityCommand('error', nonce, 5)).toBe('BEGIN READ ONLY;\nSELECT 1 / 0;\n');
    for (const address of ["127.0.0.1'", '127.0.0.1\n\\! id', '`id`', '::1'])
      expect(() => activityCommand('binding', nonce, 1, address)).toThrow('ADDRESS_IDENTITY');
    expect(() => activityCommand('hello', nonce, 1, apiAddress)).toThrow('UNEXPECTED_ADDRESS');
    expect(() => activityCommand('sample', nonce + '\n', 1, apiAddress)).toThrow('QUERY_IDENTITY');
    for (const script of Object.values(PG_ACTIVITY_NATIVE_SCRIPTS))
      expect(() =>
        execFileSync('sh', ['-n'], { input: script, stdio: ['pipe', 'pipe', 'pipe'] }),
      ).not.toThrow();
    expect(PG_ACTIVITY_NATIVE_SCRIPTS.proof).not.toMatch(
      /\bkill\b|pg_terminate_backend|pg_cancel_backend/,
    );
  });

  it('accepts PG17.7 defaults but rejects unsafe/unknown logging before the first address bind', async () => {
    expect(assertActivityHello(hello(), nonce, 0).readOnly).toBe(true);
    const unsafe = [
      ['log_statement', 'all'],
      ['log_duration', 'on'],
      ['log_min_duration_statement', '0'],
      ['log_min_duration_sample', '0'],
      ['log_transaction_sample_rate', '1'],
      ['log_parameter_max_length_on_error', '-1'],
      ['debug_print_parse', 'on'],
      ['log_statement_stats', 'on'],
      ['shared_preload_libraries', 'pgaudit'],
      ['session_preload_libraries', 'auto_explain'],
      ['local_preload_libraries', 'custom'],
    ];
    for (const [name, value] of unsafe) {
      const frame = hello();
      frame.logging[name!] = value!;
      expect(() => assertActivityHello(frame, nonce, 0)).toThrow(PgActivityError);
    }
    const missing = hello();
    delete missing.logging.log_parameter_max_length_on_error;
    expect(() => assertActivityHello(missing, nonce, 0)).toThrow('FRAME_SHAPE');
    const safeNoParameters = hello();
    safeNoParameters.logging.log_statement = 'all';
    safeNoParameters.logging.log_parameter_max_length = '0';
    expect(() => assertActivityHello(safeNoParameters, nonce, 0)).not.toThrow();
    const f = fixture();
    f.state.customize = (child) => {
      child.helloSettings.log_statement = 'all';
    };
    const receipt = await settle(qualifyPgActivityNative(f.options, f.io));
    expect(receipt.status).toBe('FAIL');
    expect(
      f.processes
        .flatMap((child) => child.commands)
        .some((item) => item.command.includes(apiAddress)),
    ).toBe(false);
    expect(f.reports[0]!.text).not.toContain(privateText);
  });

  it('maps only exact release SQL hashes/byte lengths; idle text is last and truncated text stays unknown', () => {
    const value = sampleFrame();
    const context = { nonce, sequence: 0, releaseSha, trackQueryBytes: 1024 };
    expect(projectActivitySample(value, context).rows[0]).toMatchObject({
      sourceQuery: 'learning_origin_work_context_for_project',
      queryMeaning: 'current',
      possiblyTruncated: false,
    });
    value.rows[0]!.state = 'idle';
    value.rows[0]!.queryAgeMs = -1;
    expect(projectActivitySample(value, context).rows[0]).toMatchObject({
      queryMeaning: 'last',
      clockOrderValid: false,
    });
    expect(
      projectActivitySample(value, { ...context, releaseSha: 'c'.repeat(40) }).rows[0]!.sourceQuery,
    ).toBe('unknown');
    value.rows[0]!.queryBytes = 1021;
    expect(projectActivitySample(value, context).rows[0]).toMatchObject({
      sourceQuery: 'unknown',
      possiblyTruncated: true,
    });
    value.rows[0]!.queryBytes = 1024;
    expect(() => projectActivitySample(value, context)).toThrow('QUERY_BYTES');
    const unknown = sampleFrame();
    unknown.rows[0]!.queryHash = 'd'.repeat(64);
    expect(projectActivitySample(unknown, context).rows[0]!.sourceQuery).toBe('unknown');
    expect(PG_ACTIVITY_QUERY_SOURCE.sha256).toBe(
      '09cb927baa28fb5399d9193c30f348cbd3572fa8480841f01d9fca8916b19c70',
    );
    expect(
      Math.max(...PG_ACTIVITY_QUERY_SOURCE.queries.map((query) => Number(query[1]))),
    ).toBeLessThan(128);
  });

  it('retains row truncation explicitly and rejects duplicate backends, raw fields and unknown wait/state data', () => {
    const value = sampleFrame();
    value.observedAtLeast = 65;
    value.rowsTruncated = true;
    value.rows = Array.from({ length: 64 }, (_, index) => ({
      ...row(),
      backend: index.toString(16).padStart(64, '0'),
    }));
    const context = { nonce, sequence: 0, releaseSha, trackQueryBytes: 1024 };
    expect(projectActivitySample(value, context)).toMatchObject({
      observedAtLeast: 65,
      rowsTruncated: true,
    });
    value.rows[1]!.backend = value.rows[0]!.backend;
    expect(() => projectActivitySample(value, context)).toThrow('BACKEND_ROW');
    const raw = sampleFrame();
    Object.assign(raw.rows[0]!, { query: privateText });
    expect(() => projectActivitySample(raw, context)).toThrow('FRAME_SHAPE');
    for (const field of ['state', 'waitType', 'waitEvent'] as const) {
      const invalid = sampleFrame();
      invalid.rows[0]![field] = privateText;
      expect(() => projectActivitySample(invalid, context)).toThrow(PgActivityError);
    }
  });

  it('bounds and redacts malformed, oversized, unexpected-order and stderr streams', async () => {
    for (const [payload, code] of [
      [privateText + '\n', 'FRAME_PARSE'],
      ['x'.repeat(PG_ACTIVITY_POLICY.frameBytes + 1), 'FRAME_BOUND'],
      [Array.from({ length: 5 }, () => '{}\n').join(''), 'FRAME_ORDER'],
    ]) {
      const child = new FakePsql(nonce);
      const channel = new PgActivityChannel(child);
      child.stdout.write(payload);
      await expect(channel.next(100)).rejects.toThrow(code);
      expect(channel.error?.message).not.toContain(privateText);
      expect(channel.inputClosed).toBe(true);
    }
    const child = new FakePsql(nonce);
    const channel = new PgActivityChannel(child);
    child.stderr.write(privateText.repeat(1000));
    await expect(channel.next(100)).rejects.toThrow('STDERR_BOUND');
    expect(JSON.stringify(channel.error)).not.toContain('private-secret');
    expect(pgActivityError(new Error(privateText))).toBe('OBSERVER_FAILURE');
    const partial = new FakePsql(nonce);
    const truncated = new PgActivityChannel(partial);
    partial.stdout.write('{"private":"');
    partial.close(1);
    await expect(truncated.next(100)).rejects.toThrow('FRAME_TRUNCATED');
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects an already queued frame with invalid remaining budget %s',
    async (remaining) => {
      const child = new FakePsql(nonce);
      const channel = new PgActivityChannel(child);
      child.stdout.write('{"kind":"already-delivered"}\n');
      await expect(channel.next(remaining)).rejects.toThrow('REQUEST_DEADLINE');
      expect(channel.inputClosed).toBe(true);
    },
  );

  it('rejects a trailing partial UTF-8 character held inside the decoder after complete frames', async () => {
    const child = new FakePsql(nonce);
    const channel = new PgActivityChannel(child);
    child.stdout.write('{"kind":"complete"}\n');
    expect(await channel.next(100)).toEqual({ kind: 'complete' });
    child.stdout.write(Buffer.from([0xe2, 0x82]));
    child.close(0);
    await expect(channel.next(100)).rejects.toThrow('FRAME_TRUNCATED');
    expect(channel.error?.message).toBe('PG_ACTIVITY_FRAME_TRUNCATED');
  });
});

describe('owned identities and confirmation of transaction/connection closure', () => {
  it('rejects aliases, replaced images, drift and foreign network endpoints before connecting', async () => {
    const changes: ((f: ReturnType<typeof fixture>) => void)[] = [
      (f) => {
        f.api.Id = 'c'.repeat(64);
      },
      (f) => {
        f.api.Image = 'sha256:' + 'c'.repeat(64);
      },
      (f) => {
        f.api.Config.Labels['io.asalab.scale.run'] = 'c'.repeat(32);
      },
      (f) => {
        f.api.Config.Labels['com.docker.compose.project.working_dir'] += '/other';
      },
      (f) => {
        f.api.Config.Labels['com.docker.compose.project.config_files'] += ',other.yaml';
      },
      (f) => {
        f.api.Config.Labels['com.docker.compose.project'] += '-other';
      },
      (f) => {
        f.postgres.State.Running = false;
      },
      (f) => {
        f.network.Internal = false;
      },
      (f) => {
        f.network.Containers[apiId]!.EndpointID = pgEndpoint;
      },
      (f) => {
        f.network.Containers[apiId]!.IPv4Address = pgAddress + '/24';
      },
    ];
    for (const change of changes) {
      const f = fixture();
      change(f);
      await expect(captureActivityIdentity(f.options, f.io)).rejects.toThrow(PgActivityError);
      expect(f.processes).toHaveLength(0);
    }
    for (const property of ['StartedAt', 'RestartCount'] as const) {
      const f = fixture();
      const before = await captureActivityIdentity(f.options, f.io);
      if (property === 'StartedAt') f.api.State.StartedAt = '2026-11-07T12:30:00.000Z';
      else f.api.RestartCount++;
      await expect(captureActivityIdentity(f.options, f.io, before)).rejects.toThrow(
        'IDENTITY_DRIFT',
      );
    }
  });

  it('uses one persistent owned socket session and requires each rollback ACK', async () => {
    const f = fixture();
    const session = new PgActivitySession(
      f.options,
      f.io,
      await captureActivityIdentity(f.options, f.io),
    );
    await settle(session.open());
    await settle(session.binding());
    const response = await settle(session.request('sample', apiAddress));
    expect(response.rollbackConfirmed).toBe(true);
    expect(f.processes).toHaveLength(1);
    expect(f.processes[0]!.commands.map((item) => item.kind)).toEqual([
      'hello',
      'hello',
      'binding',
      'sample',
    ]);
    f.processes[0]!.ackSqlstate = '25P02';
    await expect(settle(session.request('sample', apiAddress))).rejects.toThrow(
      'ROLLBACK_UNCONFIRMED',
    );
    const closure = await settle(session.close());
    expect(closure).toMatchObject({
      status: 'PASS',
      psqlClosed: true,
      backendClosed: true,
      explicitRollbackConfirmed: false,
      transactionEnd: 'connection-closed-without-rollback-ack',
    });
    expect(await session.close()).toBe(closure);
  });

  it.each(['hello', 'binding', 'smoke', 'sample'])(
    'rejects queued %s ACKs once the payload has exhausted the deadline',
    async (kind) => {
      const f = fixture();
      let clock = 0;
      f.controls.monotonic = () => clock;
      const session = new PgActivitySession(
        f.options,
        f.io,
        await captureActivityIdentity(f.options, f.io),
      );
      await settle(session.open());
      f.processes[0]!.transform = (actual, frame) => {
        if (actual === kind) clock += PG_ACTIVITY_POLICY.queryDeadlineMs + 1;
        return frame;
      };
      const operation =
        kind === 'binding'
          ? session.binding()
          : session.request(kind, kind === 'sample' ? apiAddress : undefined);
      await expect(settle<unknown>(operation)).rejects.toThrow('REQUEST_DEADLINE');
      expect(session.lastRollback).toBe(false);
      expect(session.channel.inputClosed).toBe(true);
    },
  );

  it.each(['hello', 'binding', 'smoke', 'sample'])(
    'rechecks the final %s ACK deadline after an event-loop gap',
    async (kind) => {
      const f = fixture();
      let clock = 0;
      f.controls.monotonic = () => clock;
      const session = new PgActivitySession(
        f.options,
        f.io,
        await captureActivityIdentity(f.options, f.io),
      );
      await settle(session.open());
      f.processes[0]!.ackDelayMs = 1;
      f.processes[0]!.afterOutput = (actual) => {
        if (actual === kind)
          queueMicrotask(() => {
            clock += PG_ACTIVITY_POLICY.queryDeadlineMs;
          });
      };
      const waits = vi.spyOn(session.channel, 'next');
      const operation =
        kind === 'binding'
          ? session.binding()
          : session.request(kind, kind === 'sample' ? apiAddress : undefined);
      await expect(settle<unknown>(operation)).rejects.toThrow('REQUEST_DEADLINE');
      // Both frames were available while each read still had budget. The final
      // monotonic check must also reject time lost after obtaining the ACK.
      expect(waits.mock.calls).toHaveLength(2);
      expect(waits.mock.calls.every(([budget]) => budget > 0)).toBe(true);
      expect(session.lastRollback).toBe(false);
    },
  );

  it('does not reset unexpected stderr into the next request baseline', async () => {
    const f = fixture();
    const session = new PgActivitySession(
      f.options,
      f.io,
      await captureActivityIdentity(f.options, f.io),
    );
    await settle(session.open());
    await settle(session.binding());
    const child = f.processes[0]!;
    const requestsBefore = child.commands.length;
    child.stderr.write(privateText);
    await expect(session.request('smoke')).rejects.toThrow('PSQL_STDERR');
    expect(child.commands).toHaveLength(requestsBefore);
    expect(session.channel.inputClosed).toBe(true);
    expect(JSON.stringify(session.channel.error)).not.toContain(privateText);
  });

  it('requires zero exit after successful smoke even when frames, rollback and physical closure are confirmed', async () => {
    const f = fixture();
    f.state.customize = (child) => {
      child.exitCodeOnEof = 7;
    };
    const receipt = await settle(qualifyPgActivityNative(f.options, f.io));
    expect(receipt.status).toBe('FAIL');
    expect(receipt).toMatchObject({ code: 'SMOKE_CLIENT_EXIT' });
    expect(receipt.cases).toMatchObject([
      {
        kind: 'smoke',
        rollbackConfirmed: true,
        closure: { status: 'PASS', psqlClosed: true, backendClosed: true, exitCode: 7 },
      },
    ]);
    expect(f.processes).toHaveLength(1);
  });

  it('rejects changed backend identity and never treats Docker CLI exit alone as closure proof', async () => {
    const changed = fixture();
    changed.state.customize = (child) => {
      child.transform = (kind, frame) =>
        kind === 'hello' && frame.sequence === 1 ? { ...frame, backendPid: 499 } : frame;
    };
    const first = new PgActivitySession(
      changed.options,
      changed.io,
      await captureActivityIdentity(changed.options, changed.io),
    );
    await expect(settle(first.open())).rejects.toThrow('BACKEND_BINDING');
    const f = fixture();
    f.state.customize = (child) => {
      child.backendNeverCloses = true;
    };
    const session = new PgActivitySession(
      f.options,
      f.io,
      await captureActivityIdentity(f.options, f.io),
    );
    await settle(session.open());
    const started = performance.now();
    const closure = await settle(session.close());
    expect(closure).toMatchObject({
      status: 'FAIL',
      code: 'CLOSURE_DEADLINE',
      backendClosed: false,
    });
    expect(performance.now() - started).toBeGreaterThanOrEqual(5000);
    expect(f.processes[0]!.closed).toBe(true);
    expect(f.processes[0]!.backendClosed).toBe(false);
  });

  it('does not infer closure from an unknown/changing process or unsafe replacement during closure', async () => {
    for (const scenario of ['changing', 'replacement']) {
      const f = fixture();
      const session = new PgActivitySession(
        f.options,
        f.io,
        await captureActivityIdentity(f.options, f.io),
      );
      await settle(session.open());
      if (scenario === 'changing')
        f.state.proof = () => ({
          client: 'changing',
          backend: 'changing',
          backendStartTicks: '10002',
        });
      else f.api.RestartCount++;
      const closure = await settle(session.close());
      expect(closure.status).toBe('FAIL');
      expect(closure.backendClosed).toBe(false);
    }
  });

  it('mock-exercises native qualification framing, public SQL error and timeout; disconnect is not a rollback ACK', async () => {
    const f = fixture();
    const receipt = await settle(qualifyPgActivityNative(f.options, f.io));
    expect(receipt.status).toBe('PASS');
    expect(receipt.cases).toMatchObject([
      {
        kind: 'smoke',
        rollbackConfirmed: true,
        closure: { status: 'PASS', explicitRollbackConfirmed: true },
      },
      {
        kind: 'error',
        rollbackConfirmed: false,
        errorCode: 'SESSION_EXITED',
        closure: { status: 'PASS', exitCode: 3 },
      },
      {
        kind: 'sleep',
        rollbackConfirmed: false,
        errorCode: 'REQUEST_DEADLINE',
        closure: { status: 'PASS', explicitRollbackConfirmed: false },
      },
    ]);
    expect(f.processes).toHaveLength(3);
    expect(f.processes.every((child) => child.closed && child.backendClosed)).toBe(true);
    for (const child of f.processes.slice(1))
      expect(child.commands.some((item) => item.command.includes(apiAddress))).toBe(false);
    expect(f.reports[0]!.text).not.toMatch(/private-secret|SELECT private|172\.25\.0\.[23]/);
    expect(f.reports[0]!.value).not.toHaveProperty('stderr');
  });
});

describe('fresh atomic phase signal and bounded observation lifecycle', () => {
  it('reads atomic renames, rejects symlinks/oversize/invalid files and stale or rewinding phases', () => {
    const f = fixture();
    const directory = f.options.directory;
    expect(readActivityProgress(directory)).toBeNull();
    const path = join(directory, 'progress.json');
    const temporary = join(directory, 'progress.tmp');
    const first = { phase: 'portal', atMs: Date.now() };
    writeFileSync(temporary, JSON.stringify(first));
    renameSync(temporary, path);
    expect(readActivityProgress(directory)).toEqual(first);
    const second = { phase: 'electronics-open', atMs: Date.now() + 1 };
    writeFileSync(temporary, JSON.stringify(second));
    renameSync(temporary, path);
    expect(
      validateActivityProgress(readActivityProgress(directory), Date.now(), Date.now(), first),
    ).toEqual(second);
    expect(() =>
      validateActivityProgress({ phase: 'portal', atMs: Date.now() - 1 }, Date.now(), Date.now()),
    ).toThrow('PROGRESS_STALE_OR_INVALID');
    expect(() =>
      validateActivityProgress(
        { phase: 'portal', atMs: Date.now() + 1001 },
        Date.now(),
        Date.now(),
      ),
    ).toThrow('PROGRESS_STALE_OR_INVALID');
    expect(() => validateActivityProgress(first, Date.now(), Date.now(), second)).toThrow(
      'PROGRESS_REWIND',
    );
    expect(() =>
      validateActivityProgress(
        { ...first, phase: 'electronics-open' },
        Date.now(),
        Date.now(),
        first,
      ),
    ).toThrow('PROGRESS_REWIND');
    writeFileSync(path, 'x'.repeat(1025));
    expect(() => readActivityProgress(directory)).toThrow('PROGRESS_FILE');
    writeFileSync(path, '{');
    expect(() => readActivityProgress(directory)).toThrow('PROGRESS_FILE');
    rmSync(path);
    symlinkSync(temporary, path);
    expect(() => readActivityProgress(directory)).toThrow('PROGRESS_FILE');
  });

  it.each(['baseline', 'after'])(
    'prewarms %s, samples only the target phase and preserves the same +1 connection policy',
    async (variant) => {
      const f = fixture(variant);
      const onFailure = vi.fn();
      const observer = await settle(startPgActivityObserver(f.options, onFailure, f.io));
      expect(f.processes[0]!.commands.map((item) => item.kind)).toEqual([
        'hello',
        'hello',
        'binding',
      ]);
      f.state.progress = { phase: 'portal', atMs: Date.now() };
      f.state.change();
      await vi.advanceTimersByTimeAsync(1500);
      expect(f.processes[0]!.commands.filter((item) => item.kind === 'sample')).toHaveLength(0);
      f.state.progress = { phase: 'electronics-open', atMs: Date.now() };
      f.state.change();
      await vi.advanceTimersByTimeAsync(2300);
      f.state.progress = { phase: 'electronics-draft', atMs: Date.now() };
      f.state.change();
      const report = await settle(observer.finish());
      expect(onFailure).not.toHaveBeenCalled();
      expect(report.status).toBe('CAPTURED');
      expect(report.samples).toHaveLength(3);
      expect(report.policy).toEqual(PG_ACTIVITY_POLICY);
      expect(report.policy.extraConnections).toBe(1);
      expect(report.closure.status).toBe('PASS');
      const serialized = f.reports[0]!.text;
      expect(serialized).not.toContain(apiAddress);
      expect(serialized).not.toContain(pgAddress);
      expect(serialized).not.toContain(privateText);
      expect(serialized).toContain(
        'pool membership and individual HTTP request association are not established',
      );
    },
  );

  it('falls back to 1 Hz when rename events are missed and never catches up or overlaps slow samples', async () => {
    const f = fixture();
    f.state.customize = (child) => {
      child.sampleDelayMs = 1600;
    };
    const observer = await settle(startPgActivityObserver(f.options, vi.fn(), f.io));
    f.state.progress = { phase: 'electronics-open', atMs: Date.now() };
    await vi.advanceTimersByTimeAsync(6500);
    f.state.progress = { phase: 'electronics-draft', atMs: Date.now() };
    f.state.change();
    const report = await settle(observer.finish());
    expect(report.samples.length).toBeGreaterThan(1);
    const starts = f.processes[0]!.commands.filter((item) => item.kind === 'sample').map(
      (item) => item.atMs,
    );
    for (let index = 1; index < starts.length; index++)
      expect(starts[index]! - starts[index - 1]!).toBeGreaterThanOrEqual(1600);
    expect(report.phase!.firstSampleLagMs).toBeGreaterThan(0);
    expect(
      report.samples.some(
        (item: { phaseEndedDuringSample: boolean }) => item.phaseEndedDuringSample,
      ),
    ).toBe(true);
  });

  it('caps the observation at sixty samples/seconds and reports a missed phase without claiming capture', async () => {
    const f = fixture();
    const observer = await settle(startPgActivityObserver(f.options, vi.fn(), f.io));
    f.state.progress = { phase: 'electronics-open', atMs: Date.now() };
    f.state.change();
    await vi.advanceTimersByTimeAsync(65000);
    const report = await settle(observer.finish());
    expect(report.samples).toHaveLength(60);
    expect(report.closure.status).toBe('PASS');
    const late = fixture();
    late.options.startedAtMs -= 61000;
    late.state.progress = { phase: 'electronics-open', atMs: Date.now() - 61000 };
    const missed = await settle(startPgActivityObserver(late.options, vi.fn(), late.io));
    const missing = await settle(missed.finish());
    expect(missing.status).toBe('NOT_CAPTURED');
    expect(missing.samples).toHaveLength(0);
    expect(missing.notCapturedReason).toBe('phase_missed_or_window_expired');
  });

  it('keeps the sixty-second monotonic window when wall time moves backwards during slow valid samples', async () => {
    const f = fixture();
    let wallOffsetMs = 0;
    f.controls.now = () => Date.now() + wallOffsetMs;
    f.state.customize = (child) => {
      child.sampleDelayMs = 1600;
    };
    const failure = vi.fn();
    const observer = await settle(startPgActivityObserver(f.options, failure, f.io));
    const phaseStartedAtMs = f.controls.now();
    const phaseStartedMonotonic = performance.now();
    f.state.progress = { phase: 'electronics-open', atMs: phaseStartedAtMs };
    f.state.change();
    await vi.advanceTimersByTimeAsync(30000);
    const beforeClockStep = performance.now();
    wallOffsetMs = -30000;
    expect(performance.now()).toBe(beforeClockStep);
    await vi.advanceTimersByTimeAsync(35000);
    const child = f.processes[0]!;
    const starts = child.commands.filter((item) => item.kind === 'sample').map((item) => item.atMs);
    expect(starts.length).toBeGreaterThan(2);
    expect(starts.length).toBeLessThan(PG_ACTIVITY_POLICY.samples);
    expect(starts.every((at) => at - phaseStartedMonotonic < PG_ACTIVITY_POLICY.windowMs)).toBe(
      true,
    );
    for (let index = 1; index < starts.length; index++)
      expect(starts[index]! - starts[index - 1]!).toBeGreaterThanOrEqual(1600);
    expect(child.closed).toBe(true);
    await vi.advanceTimersByTimeAsync(30000);
    expect(child.commands.filter((item) => item.kind === 'sample')).toHaveLength(starts.length);
    const report = await settle(observer.finish());
    expect(failure).not.toHaveBeenCalled();
    expect(report).toMatchObject({
      status: 'CAPTURED',
      windowLimitReached: true,
      phase: { startedAtMs: phaseStartedAtMs },
      closure: { status: 'PASS' },
    });
    expect(report.samples).toHaveLength(starts.length);
    // Preserve the actual wall timestamps/gaps instead of rewriting evidence
    // to hide the clock step. Only the safety deadline uses monotonic time.
    expect(
      report.samples.some(
        (item: { gapFromPreviousStartMs: number | null }) =>
          item.gapFromPreviousStartMs !== null && item.gapFromPreviousStartMs < 0,
      ),
    ).toBe(true);
  });

  it('does not start SQL when pre-query identity checks exhaust the remaining phase window', async () => {
    const f = fixture();
    f.options.startedAtMs -= 59000;
    const failure = vi.fn();
    const observer = await settle(startPgActivityObserver(f.options, failure, f.io));
    const inspect = f.controls.inspect;
    let delayed = false;
    f.controls.inspect = async (id) => {
      if (id === apiId && !delayed) {
        delayed = true;
        await f.controls.wait(1500);
      }
      return inspect(id);
    };
    f.state.progress = { phase: 'electronics-open', atMs: Date.now() - 59000 };
    f.state.change();
    await vi.advanceTimersByTimeAsync(2500);
    const report = await settle(observer.finish());
    expect(failure).not.toHaveBeenCalled();
    expect(f.processes[0]!.commands.some((item) => item.kind === 'sample')).toBe(false);
    expect(report).toMatchObject({
      status: 'NOT_CAPTURED',
      samples: [],
      windowLimitReached: true,
      notCapturedReason: 'phase_missed_or_window_expired',
      closure: { status: 'PASS' },
    });
  });

  it('signals failure at the 2 s sample deadline before the separate bounded closure, rejecting late ACKs', async () => {
    const f = fixture();
    f.state.customize = (child) => {
      child.sampleDelayMs = 3000;
      child.backendNeverCloses = true;
    };
    const failures: { code: string; at: number }[] = [];
    const observer = await settle(
      startPgActivityObserver(
        f.options,
        (code: string) => failures.push({ code, at: performance.now() }),
        f.io,
      ),
    );
    const started = performance.now();
    f.state.progress = { phase: 'electronics-open', atMs: Date.now() };
    f.state.change();
    await vi.advanceTimersByTimeAsync(1999);
    expect(failures).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(failures).toEqual([{ code: 'REQUEST_DEADLINE', at: started + 2000 }]);
    expect(f.processes[0]!.ended).toBe(true);
    expect(f.processes[0]!.closed).toBe(false);
    const report = await settle(observer.finish());
    expect(report.status).toBe('FAILED');
    expect(report.samples).toHaveLength(0);
    expect(report.closure).toMatchObject({
      status: 'FAIL',
      explicitRollbackConfirmed: false,
      backendClosed: false,
    });
    expect(failures).toHaveLength(1);
    expect(performance.now() - failures[0]!.at).toBeGreaterThanOrEqual(5000);
    expect(performance.now() - failures[0]!.at).toBeLessThan(5020);
  });

  it('includes metadata in the sample deadline and rejects drift between query and final identity', async () => {
    const stalled = fixture();
    const failures = vi.fn();
    const first = await settle(startPgActivityObserver(stalled.options, failures, stalled.io));
    stalled.controls.inspect = () => new Promise(() => {});
    stalled.state.progress = { phase: 'electronics-open', atMs: Date.now() };
    stalled.state.change();
    await vi.advanceTimersByTimeAsync(2000);
    expect(failures).toHaveBeenCalledExactlyOnceWith('REQUEST_DEADLINE');
    expect(stalled.processes[0]!.commands.some((item) => item.kind === 'sample')).toBe(false);
    const failed = await settle(first.finish());
    expect(failed.status).toBe('FAILED');
    const f = fixture();
    f.state.customize = (child) => {
      child.transform = (kind, frame) => {
        if (kind === 'sample') f.api.RestartCount++;
        return frame;
      };
    };
    const onFailure = vi.fn();
    const observer = await settle(startPgActivityObserver(f.options, onFailure, f.io));
    f.state.progress = { phase: 'electronics-open', atMs: Date.now() };
    f.state.change();
    await vi.advanceTimersByTimeAsync(10);
    expect(onFailure).toHaveBeenCalledExactlyOnceWith('IDENTITY_DRIFT');
    const report = await settle(observer.finish());
    expect(report.samples).toHaveLength(0);
  });

  it('rejects unexpected raw data without persisting it or laundering observation failure into product errors', async () => {
    const f = fixture();
    f.state.customize = (child) => {
      child.transform = (kind, frame) =>
        kind === 'sample' ? { ...frame, query: privateText, address: apiAddress } : frame;
    };
    const onFailure = vi.fn();
    const observer = await settle(startPgActivityObserver(f.options, onFailure, f.io));
    f.state.progress = { phase: 'electronics-open', atMs: Date.now() };
    f.state.change();
    await vi.advanceTimersByTimeAsync(10);
    const report = await settle(observer.finish());
    expect(report.status).toBe('FAILED');
    expect(onFailure).toHaveBeenCalledExactlyOnceWith('FRAME_SHAPE');
    expect(f.reports[0]!.text).not.toMatch(/private-secret|SELECT private|172\.25\.0\.[23]/);
    expect(report).not.toHaveProperty('httpErrors');
    const source = readFileSync(
      new URL('../../tools/capacity/classroom-scale.mjs', import.meta.url),
      'utf8',
    );
    expect(source.indexOf('const pgSmoke = await qualifyPgActivityNative')).toBeLessThan(
      source.indexOf('const runBrowserLevel'),
    );
    expect(source).toContain("if (pgSmoke.status !== 'PASS')");
    expect(source.indexOf('activePgObserver = await startPgActivityObserver')).toBeLessThan(
      source.indexOf("driverName = project + '-browser-'"),
    );
    expect(source).toContain("classification: 'observation_error'");
    expect(source).toContain('extraConnectionRetainedInRawAggregates: true');
    expect(source).toContain(
      'baseline.summary.pgActivity?.policyHash === scaleHash(PG_ACTIVITY_POLICY)',
    );
    expect(source).toContain(
      'after.summary.pgActivity?.policyHash === scaleHash(PG_ACTIVITY_POLICY)',
    );
  });

  it('notifies immediately for stderr between samples and for abnormal client exit after a valid last ACK', async () => {
    for (const cause of ['stderr', 'exit']) {
      const f = fixture();
      const failure = vi.fn();
      const observer = await settle(startPgActivityObserver(f.options, failure, f.io));
      f.state.progress = { phase: 'electronics-open', atMs: Date.now() };
      f.state.change();
      await vi.advanceTimersByTimeAsync(10);
      if (cause === 'stderr') f.processes[0]!.stderr.write(privateText);
      else f.processes[0]!.close(7);
      expect(failure).toHaveBeenCalledExactlyOnceWith(
        cause === 'stderr' ? 'PSQL_STDERR' : 'CLIENT_EXIT',
      );
      const report = await settle(observer.finish());
      expect(report.status).toBe('FAILED');
      expect(report.closure.status).toBe('PASS');
      expect(f.reports[0]!.text).not.toContain(privateText);
      expect(report).not.toHaveProperty('httpErrors');
    }
  });

  it.each([
    { cause: 'stderr', code: 'PSQL_STDERR' },
    { cause: 'exit', code: 'CLIENT_EXIT' },
    { cause: 'combined', code: 'PSQL_STDERR' },
  ])(
    'keeps failure sticky when $cause arrives during the second post-ACK identity await',
    async ({ cause, code }) => {
      const f = fixture();
      const failure = vi.fn();
      const observer = await settle(startPgActivityObserver(f.options, failure, f.io));
      const child = f.processes[0]!;
      const inspect = f.controls.inspect;
      let secondAckSent = false;
      let inspectionPaused = false;
      let releaseInspection: (() => void) | undefined;
      const inspectionGate = new Promise<void>((done) => {
        releaseInspection = done;
      });
      child.afterOutput = (kind) => {
        if (
          kind === 'sample' &&
          child.commands.filter((item) => item.kind === 'sample').length === 2
        )
          secondAckSent = true;
      };
      f.controls.inspect = async (id) => {
        if (id === apiId && secondAckSent && !inspectionPaused) {
          inspectionPaused = true;
          await inspectionGate;
        }
        return inspect(id);
      };
      const phaseStartedAtMs = Date.now();
      f.state.progress = { phase: 'electronics-open', atMs: phaseStartedAtMs };
      f.state.change();
      await vi.advanceTimersByTimeAsync(1010);
      expect(inspectionPaused).toBe(true);
      expect(child.commands.filter((item) => item.kind === 'sample')).toHaveLength(2);
      if (cause !== 'exit') child.stderr.write(privateText);
      if (cause !== 'stderr') child.close(7);
      expect(failure).toHaveBeenCalledExactlyOnceWith(code);
      expect(observer.error).toBe(code);
      releaseInspection!();
      await vi.advanceTimersByTimeAsync(4000);
      const report = await settle(observer.finish());
      expect(report).toMatchObject({ status: 'FAILED', code, closure: { status: 'PASS' } });
      expect(report.samples).toHaveLength(1);
      expect(report.samples[0]).toMatchObject({
        requestedAtMs: phaseStartedAtMs,
        rollbackConfirmed: true,
      });
      expect(child.commands.filter((item) => item.kind === 'sample')).toHaveLength(2);
      expect(failure).toHaveBeenCalledExactlyOnceWith(code);
      expect(f.reports[0]!.value).toMatchObject({ status: 'FAILED', code });
      expect(f.reports[0]!.text).not.toContain(privateText);
    },
  );
});

describe('resource-stop cancellation across driver, qualification and observation', () => {
  it.each(['runtime', 'owned resources', 'observer preparation'])(
    'opens no psql when the actual driver declares a stop during its %s attestation await',
    async (point) => {
      const f = fixture();
      const writes: { path: string; value: Frame }[] = [];
      const writeJson = (path: string, value: Frame) => writes.push({ path, value });
      let paused = false;
      let release: (() => void) | undefined;
      const gate = new Promise<void>((done) => {
        release = done;
      });
      const attest = async (actual: string) => {
        if (point === actual && !paused) {
          paused = true;
          await gate;
        }
      };
      const inspect = f.controls.inspect;
      f.controls.inspect = async (id) => {
        if (id === apiId) await attest('observer preparation');
        return inspect(id);
      };
      const browserStart = vi.fn(() => {
        throw Error('Browser must not start after a resource stop');
      });
      const context: Record<string, unknown> = {
        Date,
        resolve,
        mkdirSync,
        writeJson,
        reports: dirname(f.options.directory),
        config: {},
        identity: {},
        allResources: [],
        observationErrors: 0,
        stoppedByResource: undefined,
        pgResourceStop: f.resourceStop,
        containerIds: [
          { service: 'api', id: apiId },
          { service: 'postgres', id: postgresId },
        ],
        head: releaseSha,
        root: f.options.expected.root,
        project: f.options.expected.project,
        env: { ASA_SCALE_RUN_TOKEN: nonce },
        composeFiles: f.options.expected.configFiles.split(','),
        fixtureImages: f.options.expected.images,
        latestApiIdentity: undefined,
        officialScaleBrowserInvocation: () => ({ phase: 'level-30', command: [] }),
        sample: async () => {},
        attestRuntime: () => attest('runtime'),
        attestOwnedResources: () => attest('owned resources'),
        startPgActivityObserver: (options: typeof f.options, onFailure: (code: string) => void) =>
          startPgActivityObserver(options, onFailure, f.io),
        requireResources: async () => {
          throw Error('BLOCKED_BY_RUNNER: memory_floor');
        },
        start: browserStart,
      };
      context.pgObserverOptions = driverArrow('pgObserverOptions', context);
      const runLevel = driverArrow('runBrowserLevel', context);
      // Exercise the real resource declaration too; only host/container reads
      // and the already-established violation are substitutes in this replay.
      const resourceContext: Record<string, unknown> = {
        Date,
        resolve,
        reports: context.reports,
        root: f.options.expected.root,
        pgResourceStop: f.resourceStop,
        previousCpu: { total: 0, idle: 0 },
        cpuTicks: () => ({ total: 100, idle: 0 }),
        readFileSync: () => '',
        readScaleMemInfo: () => ({ memoryAvailableBytes: 1 }),
        statfsSync: () => ({ bavail: 1, bsize: 1 }),
        allResources: [],
        containerIds: [],
        currentPhase: 'level-30',
        currentAbortFile: join(f.options.directory, 'abort.json'),
        activeCommand: undefined,
        driverName: undefined,
        builderCreated: false,
        scaleResourceViolation: () => 'memory_floor',
        writeJson,
      };
      Object.defineProperty(resourceContext, 'stoppedByResource', {
        get: () => context.stoppedByResource,
        set: (value: unknown) => {
          context.stoppedByResource = value;
        },
      });
      const sampleResources = driverArrow('sampleOnce', resourceContext);
      const running = runLevel(30).catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(0);
      expect(paused).toBe(true);
      await sampleResources();
      release!();
      const result = await settle(running);
      const observer = context.activePgObserver as
        Awaited<ReturnType<typeof startPgActivityObserver>> | undefined;
      if (observer) await settle(observer.finish());
      expect(f.processes).toHaveLength(0);
      expect(f.resourceStop.signal.aborted).toBe(true);
      expect(String(result)).toMatch(/BLOCKED_BY_RUNNER|RESOURCE_STOP/);
      expect(browserStart).not.toHaveBeenCalled();
      expect(context.observationErrors).toBe(0);
      expect(writes.filter((item) => item.path.endsWith('/abort.json'))).toMatchObject([
        { value: { reason: 'memory_floor', phase: 'level-30' } },
      ]);
    },
  );

  it.each(['qualification', 'observer'])(
    'opens no psql when resource stop arrives during the initial %s identity await',
    async (entry) => {
      const f = fixture();
      const inspect = f.controls.inspect;
      let paused = false;
      let release: (() => void) | undefined;
      const gate = new Promise<void>((done) => {
        release = done;
      });
      f.controls.inspect = async (id) => {
        if (id === apiId && !paused) {
          paused = true;
          await gate;
        }
        return inspect(id);
      };
      const failure = vi.fn();
      let observer: Awaited<ReturnType<typeof startPgActivityObserver>> | undefined;
      const running =
        entry === 'qualification'
          ? qualifyPgActivityNative(f.options, f.io)
          : startPgActivityObserver(f.options, failure, f.io).then(
              (value) => {
                observer = value;
                return value;
              },
              (error: unknown) => error,
            );
      expect(paused).toBe(true);
      f.resourceStop.abort();
      release!();
      await settle(running);
      if (observer) await settle(observer.finish());
      expect(f.processes).toHaveLength(0);
      expect(f.reports[0]!.value).toMatchObject({
        status: 'BLOCKED_BY_RUNNER',
        code: 'RESOURCE_STOP',
        classification: 'resource_stop',
      });
      if (entry === 'observer') expect(failure).toHaveBeenCalledExactlyOnceWith('RESOURCE_STOP');
    },
  );

  it.each(['qualification', 'observer'])(
    'sends no binding or later SQL when resource stop interrupts %s preparation after the second hello ACK',
    async (entry) => {
      const f = fixture();
      const inspect = f.controls.inspect;
      let secondHelloAck = false;
      let paused = false;
      let release: (() => void) | undefined;
      const gate = new Promise<void>((done) => {
        release = done;
      });
      f.state.customize = (child) => {
        child.afterOutput = (kind) => {
          if (kind === 'hello' && child.commands.length === 2) secondHelloAck = true;
        };
      };
      f.controls.inspect = async (id) => {
        if (id === apiId && secondHelloAck && !paused) {
          paused = true;
          await gate;
        }
        return inspect(id);
      };
      const failure = vi.fn();
      let observer: Awaited<ReturnType<typeof startPgActivityObserver>> | undefined;
      const running =
        entry === 'qualification'
          ? qualifyPgActivityNative(f.options, f.io)
          : startPgActivityObserver(f.options, failure, f.io).then(
              (value) => {
                observer = value;
                return value;
              },
              (error: unknown) => error,
            );
      await vi.advanceTimersByTimeAsync(10);
      expect(paused).toBe(true);
      f.resourceStop.abort();
      await vi.advanceTimersByTimeAsync(0);
      const endedAtStop = f.processes[0]!.ended;
      release!();
      await settle(running);
      if (observer) await settle(observer.finish());
      expect(endedAtStop).toBe(true);
      expect(f.processes).toHaveLength(1);
      expect(f.processes[0]!.commands.map((item) => item.kind)).toEqual(['hello', 'hello']);
      const report = f.reports[0]!.value;
      expect(report).toMatchObject({
        status: 'BLOCKED_BY_RUNNER',
        code: 'RESOURCE_STOP',
        classification: 'resource_stop',
      });
      expect(
        entry === 'qualification' ? report.failedSessionClosure : report.closure,
      ).toMatchObject({
        status: 'PASS',
        psqlClosed: true,
        backendClosed: true,
      });
    },
  );

  it.each(['pending smoke ACK', 'between qualification cases'])(
    'stops qualification at %s without opening another client or accepting cancellation as native PASS',
    async (point) => {
      const f = fixture();
      f.state.customize = (child) => {
        child.transform = (kind, frame) => {
          if (kind === 'smoke' && point === 'pending smoke ACK') {
            child.ackDelayMs = 1000;
            setTimeout(() => f.resourceStop.abort(), 100);
          }
          return frame;
        };
        child.afterOutput = (kind) => {
          if (kind === 'smoke' && point === 'between qualification cases')
            setTimeout(() => f.resourceStop.abort(), 50);
        };
      };
      const receipt = await settle(qualifyPgActivityNative(f.options, f.io));
      expect(receipt).toMatchObject({
        status: 'BLOCKED_BY_RUNNER',
        code: 'RESOURCE_STOP',
        classification: 'resource_stop',
        failedSessionClosure: { status: 'PASS', psqlClosed: true, backendClosed: true },
      });
      expect(f.processes).toHaveLength(1);
      expect(f.processes[0]!.commands.map((item) => item.kind)).toEqual([
        'hello',
        'hello',
        'binding',
        'smoke',
      ]);
      if (point === 'pending smoke ACK')
        expect(receipt).toMatchObject({
          failedSessionClosure: { explicitRollbackConfirmed: false },
        });
      expect(f.reports[0]!.text).not.toContain(privateText);
    },
  );

  it.each(['before query identity', 'post-ACK identity', 'pending query'])(
    'preserves the first valid sample and closes immediately when resource stop arrives during the second %s',
    async (point) => {
      const f = fixture();
      const failure = vi.fn();
      const observer = await settle(startPgActivityObserver(f.options, failure, f.io));
      const child = f.processes[0]!;
      f.state.progress = { phase: 'electronics-open', atMs: Date.now() };
      f.state.change();
      await vi.advanceTimersByTimeAsync(10);
      const inspect = f.controls.inspect;
      let secondAck = false;
      let paused = false;
      let release: (() => void) | undefined;
      const gate = new Promise<void>((done) => {
        release = done;
      });
      child.afterOutput = (kind) => {
        if (
          kind === 'sample' &&
          child.commands.filter((item) => item.kind === 'sample').length === 2
        )
          secondAck = true;
      };
      child.sampleDelayMs = point === 'pending query' ? 1500 : 1;
      f.controls.inspect = async (id) => {
        if (
          id === apiId &&
          !paused &&
          (point === 'before query identity' || (point === 'post-ACK identity' && secondAck))
        ) {
          paused = true;
          await gate;
        }
        return inspect(id);
      };
      await vi.advanceTimersByTimeAsync(1000);
      expect(paused).toBe(point !== 'pending query');
      f.resourceStop.abort();
      await vi.advanceTimersByTimeAsync(0);
      const immediateFailure = failure.mock.calls.map(([code]) => code);
      const endedAtStop = child.ended;
      release!();
      await vi.advanceTimersByTimeAsync(4000);
      const report = await settle(observer.finish());
      expect(immediateFailure).toEqual(['RESOURCE_STOP']);
      expect(endedAtStop).toBe(true);
      expect(report).toMatchObject({
        status: 'BLOCKED_BY_RUNNER',
        code: 'RESOURCE_STOP',
        classification: 'resource_stop',
        closure: { status: 'PASS', psqlClosed: true, backendClosed: true },
      });
      expect(report.samples).toHaveLength(1);
      expect(report.samples[0]!.rollbackConfirmed).toBe(true);
      expect(child.commands.filter((item) => item.kind === 'sample')).toHaveLength(
        point === 'before query identity' ? 1 : 2,
      );
      expect(failure).toHaveBeenCalledExactlyOnceWith('RESOURCE_STOP');
      expect(report).not.toHaveProperty('httpErrors');
      expect(f.reports[0]!.text).not.toContain(privateText);
    },
  );
});
