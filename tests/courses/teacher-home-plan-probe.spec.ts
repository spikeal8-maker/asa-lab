import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LIMITS,
  OUTER_QUERY,
  compareSettings,
  createNoticeCollector,
  ownedConnection,
  readConfiguration,
  readSource,
  runProbe,
  sanitizePlan,
  serializeReport,
  verifyFunctions,
} from '../../tools/testing/teacher-home-plan-probe.mjs';

// Pure protocol fixtures. These tests never import test database helpers or
// connect to PostgreSQL. Native plan capture itself is NOT_RUN until isolated CI.
const source = readSource();
const accountId = 'a0e7a72f-0f33-4de6-9c1e-d8a49c19f008';
const privateText = `private-payload-${accountId}`;
const environment = () => ({
  CI: 'true',
  GITHUB_ACTIONS: 'true',
  ASA_TEACHER_HOME_PROBE: 'isolated-post-gate',
  ASA_TEACHER_HOME_CI_LANE: 'general',
  ASA_TEACHER_HOME_SOURCE_SHA: 'a'.repeat(40),
  ASA_TEACHER_HOME_SOURCE_DIGEST: source.digest,
  TEST_DATABASE_URL: 'postgres://asalab_admin:synthetic@postgres:5432/asalab_test',
  APP_TEST_DATABASE_URL: 'postgres://asalab_app:synthetic@postgres:5432/asalab_test',
});
const definitions = () =>
  source.functions.map((item) => ({
    name: item.name,
    body: item.body,
    language: 'sql',
    volatility: 's',
    definer: true,
    config: ['search_path=pg_catalog, pg_temp'],
  }));
const settings = (admin = false) => [
  { name: 'server_version_num', setting: '170007' },
  { name: 'jit', setting: 'on' },
  { name: 'jit_above_cost', setting: '100000' },
  { name: 'work_mem', setting: '4096' },
  { name: 'search_path', setting: '"$user", public' },
  { name: 'row_security', setting: 'on' },
  { name: 'transaction_read_only', setting: 'on' },
  { name: 'transaction_isolation', setting: 'read committed' },
  { name: 'role', setting: admin ? 'asalab_app' : 'none' },
  { name: 'session_authorization', setting: admin ? 'asalab_admin' : 'asalab_app' },
];
const nativePlan = (query: string, overrides: Record<string, unknown> = {}) => ({
  'Query Text': query,
  'Query Parameters': privateText,
  Plan: {
    'Node Type': 'Nested Loop',
    'Plan Rows': 1000,
    'Actual Rows': 12,
    'Actual Loops': 4,
    'Actual Total Time': 105,
    'Shared Hit Blocks': 55,
    Filter: privateText,
    Output: [privateText],
    'Join Filter': privateText,
    Plans: [
      {
        'Node Type': 'Seq Scan',
        'Relation Name': 'learning_attempts',
        'Actual Rows': 12,
        'Actual Loops': 1,
        'Index Cond': privateText,
        Alias: privateText,
        'Sort Key': [privateText],
      },
    ],
  },
  Settings: { application_name: privateText, jit: 'on' },
  JIT: {
    Functions: 47,
    Options: { Inlining: true, Optimization: true, Expressions: true, Deforming: true },
    Timing: {
      Generation: { Deform: 1.2, Total: 5.5 },
      Inlining: 10,
      Optimization: 35,
      Emission: 65,
      Total: 115.5,
    },
  },
  ...overrides,
});
const notice = (plan: object, duration = 120) => ({
  severity: 'NOTICE',
  code: '00000',
  message: `duration: ${duration.toFixed(3)} ms  plan:\n${JSON.stringify(plan)}`,
  where: privateText,
  detail: privateText,
  hint: privateText,
});

interface FakeOptions {
  fixtureCount?: number;
  ledgerMismatch?: boolean;
  definitionMismatch?: boolean;
  settingMismatch?: boolean;
  invalidRole?: boolean;
  missingNested?: boolean;
  loadError?: boolean;
  connectHang?: boolean;
  metadataHang?: boolean;
  readHang?: boolean;
  closeHang?: boolean;
  rowOverflow?: boolean;
  metadataDelay?: number;
}
function driver(options: FakeOptions = {}) {
  const clients: FakeClient[] = [];
  class FakeQuery extends EventEmitter {
    text: string;
    values: unknown[];
    constructor(input: { text: string; values: unknown[] }) {
      super();
      this.text = input.text;
      this.values = input.values;
    }
  }
  class FakeClient extends EventEmitter {
    admin: boolean;
    calls: { text: string; values?: unknown[] }[] = [];
    end = vi.fn(() => (options.closeHang ? new Promise<void>(() => undefined) : Promise.resolve()));
    connection = { stream: { destroy: vi.fn() } };
    constructor(config: { connectionString: string }) {
      super();
      this.admin = !config.connectionString.includes('//asalab_app:');
      clients.push(this);
    }
    connect() {
      return options.connectHang ? new Promise<void>(() => undefined) : Promise.resolve();
    }
    query(text: string | FakeQuery, values?: unknown[]) {
      if (text instanceof FakeQuery) {
        this.calls.push({ text: text.text, values: text.values });
        if (!options.readHang)
          void Promise.resolve().then(() => {
            if (!options.missingNested)
              for (const fn of source.functions) this.emit('notice', notice(nativePlan(fn.body)));
            this.emit(
              'notice',
              notice(
                nativePlan(OUTER_QUERY, {
                  Plan: {
                    'Node Type': 'Function Scan',
                    'Actual Rows': 3,
                    'Actual Loops': 1,
                    'Actual Total Time': 122,
                  },
                }),
              ),
            );
            const rows = options.rowOverflow ? LIMITS.resultRows + 1 : 3;
            for (let i = 0; i < rows; i++) text.emit('row', { evidence: { privateText } });
            text.emit('end', { rowCount: rows });
          });
        return text;
      }
      this.calls.push({ text, ...(values ? { values } : {}) });
      if (options.metadataHang) return new Promise(() => undefined);
      let rows: unknown[] = [];
      if (text.includes('pg_catalog.pg_settings')) {
        rows = settings(this.admin).map((row) =>
          options.settingMismatch && this.admin && row.name === 'jit'
            ? { ...row, setting: 'off' }
            : row,
        );
      } else if (text.includes('pg_catalog.pg_roles')) {
        rows = [
          {
            app_role: true,
            same_session_user: !this.admin,
            superuser: options.invalidRole ?? false,
            bypass_rls: false,
            can_read: true,
            can_read_internal: false,
          },
        ];
      } else if (text.includes('public.schema_migrations')) {
        rows = options.ledgerMismatch ? source.migrations.slice(1) : source.migrations;
      } else if (text.includes('pg_catalog.pg_proc')) {
        rows = definitions().map((row, index) =>
          options.definitionMismatch && index === 0 ? { ...row, body: 'SELECT 0' } : row,
        );
      } else if (text.includes('FROM public.tenants tenant')) {
        rows = Array.from({ length: options.fixtureCount ?? 1 }, () => ({ account_id: accountId }));
      } else if (text.includes('class_ordinal')) {
        rows = [
          {
            class_ordinal: 1,
            assignments: 3,
            seats: 2,
            runs: 3,
            participations: 6,
            attempts: 5,
            results: 3,
          },
        ];
      } else if (text === "LOAD 'auto_explain'" && options.loadError) {
        return Promise.reject(
          Object.assign(new Error(privateText), { code: '42501', where: privateText }),
        );
      }
      return options.metadataDelay
        ? new Promise((resolve) => setTimeout(() => resolve({ rows }), options.metadataDelay))
        : Promise.resolve({ rows });
    }
  }
  return { pg: { Client: FakeClient, Query: FakeQuery }, clients };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('Teacher Home post-gate probe admission and source identity', () => {
  it('binds the complete source migration set and exact four latest SQL bodies without connecting', () => {
    expect(source.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(source.migrations.map((item) => item.version)).toEqual(
      source.manifest
        .filter((item) => item.file.startsWith('migrations/'))
        .map((item) => item.file.slice(11, 15)),
    );
    expect(source.functions.map((item) => [item.name, item.file])).toEqual(
      expect.arrayContaining([
        [
          'learning_canonical_evidence_for_teacher_account',
          'migrations/0089_learning_canonical_read_projection.sql',
        ],
        [
          'learning_canonical_evidence_internal',
          'migrations/0161_learning_revision_in_progress_projection.sql',
        ],
        [
          'learning_selected_result_internal',
          'migrations/0133_learning_attempt_lifecycle_convergence.sql',
        ],
        [
          'learning_effective_conditions_internal',
          'migrations/0117_learning_operational_conditions.sql',
        ],
      ]),
    );
    expect(verifyFunctions(definitions(), source.functions)).toHaveLength(4);
    expect(readConfiguration(environment(), source.digest)).toMatchObject({
      lane: 'general',
      sourceSha: 'a'.repeat(40),
    });
  });
  it('admits only the separate exact Learning service target as the other lane', () => {
    expect(
      readConfiguration(
        {
          ...environment(),
          ASA_TEACHER_HOME_CI_LANE: 'learning',
          TEST_DATABASE_URL: 'postgres://postgres:synthetic@127.0.0.1:5432/asa_learning_e1_test',
          APP_TEST_DATABASE_URL:
            'postgres://asalab_app:synthetic@127.0.0.1:5432/asa_learning_e1_test',
        },
        source.digest,
      ),
    ).toMatchObject({ lane: 'learning' });
  });
  it.each([
    ['CI', 'false'],
    ['GITHUB_ACTIONS', 'false'],
    ['ASA_TEACHER_HOME_PROBE', ''],
    ['ASA_TEACHER_HOME_CI_LANE', 'production'],
    ['ASA_TEACHER_HOME_SOURCE_SHA', ''],
    ['ASA_TEACHER_HOME_SOURCE_DIGEST', 'b'.repeat(64)],
    ['TEST_DATABASE_URL', 'postgres://asalab_admin:synthetic@postgres:5432/asalab'],
    ['APP_TEST_DATABASE_URL', 'postgres://asalab_app:synthetic@remote.example:5432/asalab_test'],
    ['APP_TEST_DATABASE_URL', 'postgres://asalab_admin:synthetic@postgres:5432/asalab_test'],
    ['APP_TEST_DATABASE_URL', 'postgres://asalab_app:synthetic@postgres:5433/asalab_test'],
    ['APP_TEST_DATABASE_URL', 'postgres://asalab_app:synthetic@postgres:5432/other_test'],
    [
      'APP_TEST_DATABASE_URL',
      'postgres://asalab_app:synthetic@postgres:5432/asalab_test?options=-cjit=off',
    ],
    ['APP_TEST_DATABASE_URL', 'not a URL'],
  ])('refuses unsafe %s configuration before any client exists', async (key, value) => {
    const fake = driver();
    const report = await runProbe({ ...environment(), [key]: value }, source, fake.pg);
    expect(report.status).toBe('REFUSED');
    expect(fake.clients).toHaveLength(0);
    expect(JSON.stringify(report)).not.toContain(value.includes('postgres:') ? value : 'synthetic');
  });
  it.each(['body', 'language', 'volatility', 'definer', 'config'])(
    'rejects drift in function %s',
    (key) => {
      const rows = definitions();
      const changed = {
        ...rows[0],
        [key]: key === 'definer' ? false : key === 'config' ? ['jit=off'] : 'changed',
      };
      expect(() => verifyFunctions([changed, ...rows.slice(1)], source.functions)).toThrow(
        'function_definition_mismatch',
      );
    },
  );
  it('compares all actual defaults, including unknown role defaults, without printing arbitrary values', () => {
    expect(compareSettings(settings(), settings(true)).equal).toBe(true);
    const changed = [...settings(true), { name: 'custom_private_setting', setting: privateText }];
    const result = compareSettings(settings(), changed);
    expect(result).toMatchObject({ equal: false, mismatches: [], otherMismatchCount: 1 });
    expect(JSON.stringify(result)).not.toContain(privateText);
  });
});

describe('Native NOTICE sanitization and bounded evidence', () => {
  it('retains rows, loops, buffers and PG17 JIT timing while removing all payload channels', () => {
    const output = sanitizePlan(nativePlan(`SELECT '${privateText}'`)).output;
    expect(output.Plan).toMatchObject({
      'Node Type': 'Nested Loop',
      'Plan Rows': 1000,
      'Actual Rows': 12,
      'Actual Loops': 4,
      'Shared Hit Blocks': 55,
    });
    expect(output.JIT).toMatchObject({
      Functions: 47,
      Timing: { Generation: { Deform: 1.2, Total: 5.5 }, Total: 115.5 },
    });
    const serialized = JSON.stringify(output);
    expect(serialized).not.toContain(accountId);
    expect(serialized).not.toContain('Query Text');
    expect(serialized).not.toContain('Filter');
    expect(serialized).not.toContain('Query Parameters');
    expect(serialized).not.toContain('application_name');
  });
  it('preserves PG16 numeric Generation and excludes unsafe relation names and nonfinite values', () => {
    const output = sanitizePlan(
      nativePlan('SELECT 1', {
        JIT: { Functions: 1, Timing: { Generation: 2, Total: 7 } },
        Plan: {
          'Node Type': 'Seq Scan',
          'Relation Name': privateText,
          'Actual Rows': Infinity,
          'Actual Loops': 1,
          'Total Cost': -1,
          'Actual Total Time': 4,
        },
      }),
    ).output;
    expect(output.JIT).toMatchObject({ Timing: { Generation: 2, Total: 7 } });
    expect(output.Plan).toEqual({
      'Node Type': 'Seq Scan',
      'Actual Loops': 1,
      'Actual Total Time': 4,
    });
  });
  it('requires native inner bodies, not merely a successful outer Function Scan', () => {
    const stop = vi.fn();
    const collector = createNoticeCollector(source.functions, stop);
    collector.notice(notice(nativePlan(OUTER_QUERY, { JIT: null })));
    const result = collector.finish();
    expect(result.groups.outer_read.count).toBe(1);
    expect(result.groups.outer_read.jitTotalMs).toBeNull();
    expect(result.groups.outer_read.jitTimedPlans).toBe(0);
    expect(result.missingNativePlans).toHaveLength(4);
    expect(stop).not.toHaveBeenCalled();
  });
  it('counts inclusive invocations and retains only two slowest sanitized samples per function', () => {
    const collector = createNoticeCollector(source.functions, vi.fn());
    for (const ms of [5, 9, 1, 8])
      collector.notice(notice(nativePlan(source.functions[0].body), ms));
    const result = collector.finish();
    const group = result.groups[source.functions[0].name];
    expect(group).toMatchObject({ count: 4, inclusiveDurationMs: 23, maxDurationMs: 9 });
    expect(group.samples.map((sample) => sample.durationMs)).toEqual([9, 8]);
    expect(JSON.stringify(result)).not.toContain(privateText);
  });
  it.each<Record<string, number>>([
    { notices: 1 },
    { noticeBytes: 10 },
    { allNoticeBytes: 10 },
    { planNodes: 1 },
    { planDepth: 0 },
  ])('aborts and labels incomplete evidence at cap %j', (limit) => {
    const stop = vi.fn();
    const collector = createNoticeCollector(source.functions, stop, { ...LIMITS, ...limit });
    for (let index = 0; index < 3; index++) collector.notice(notice(nativePlan(OUTER_QUERY)));
    const result = collector.finish();
    expect(result.truncated).toBe(true);
    expect(stop).toHaveBeenCalledTimes(1);
  });
  it('reports malformed native JSON without copying it or a NOTICE error context', () => {
    const stop = vi.fn();
    const collector = createNoticeCollector(source.functions, stop);
    collector.notice({
      severity: 'NOTICE',
      message: `duration: 5.000 ms  plan:\n${privateText}`,
      where: privateText,
    });
    expect(stop).toHaveBeenCalledWith('invalid_native_plan');
    expect(JSON.stringify(collector.finish())).not.toContain(privateText);
  });
  it('replaces oversized artifacts with valid explicit incomplete metadata, never cropped JSON', () => {
    const result = serializeReport(
      {
        schema: 'asa-teacher-home-plan-probe/v1',
        source: null,
        status: 'NATIVE_PLANS_CAPTURED',
        stage: 'completed',
        native: 'x'.repeat(2000),
      },
      600,
    );
    expect(Buffer.byteLength(result)).toBeLessThan(600);
    expect(JSON.parse(result)).toMatchObject({ status: 'INCOMPLETE', reason: 'artifact_cap' });
  });
});

describe('Post-gate protocol and owned observer lifecycle', () => {
  it('uses the exact canonical read as effective app in a read-only transaction, with separate diagnostic status', async () => {
    const fake = driver();
    const report = await runProbe(environment(), source, fake.pg);
    expect(report).toMatchObject({
      status: 'NATIVE_PLANS_CAPTURED',
      serverVersionNum: 170007,
      fixtureMatches: 1,
      rows: 3,
      migrationLedgerMatches: true,
      forcedSocketCloses: 0,
    });
    const app = fake.clients[0];
    const observer = fake.clients[1];
    expect(app.calls[0]?.text).toBe('BEGIN READ ONLY');
    expect(observer.calls[0]?.text).toBe('BEGIN READ ONLY');
    expect(observer.calls.at(-1)).toEqual({ text: OUTER_QUERY, values: [accountId] });
    const commands = observer.calls.map((call) => call.text).join('\n');
    expect(commands).toContain('SET LOCAL ROLE asalab_app');
    expect(commands).toContain('SET LOCAL auto_explain.log_timing=on');
    expect(commands).not.toMatch(/ALTER (ROLE|SYSTEM)|SET (?:LOCAL )?jit\s*=|INSERT|UPDATE|DELETE/);
    expect(JSON.stringify(report)).not.toContain(accountId);
    expect(JSON.stringify(report)).not.toContain(privateText);
    expect(JSON.stringify(report)).not.toContain(OUTER_QUERY);
    expect(app.end).toHaveBeenCalledTimes(1);
    expect(observer.end).toHaveBeenCalledTimes(1);
  });
  it.each([
    [{ fixtureCount: 0 }, 'fixture_not_unique'],
    [{ fixtureCount: 2 }, 'fixture_not_unique'],
    [{ ledgerMismatch: true }, 'migration_ledger_mismatch'],
    [{ definitionMismatch: true }, 'function_definition_mismatch'],
    [{ settingMismatch: true }, 'default_settings_mismatch'],
    [{ invalidRole: true }, 'runtime_role_mismatch'],
    [{ loadError: true }, 'observer_error'],
  ] as const)('fails closed before the canonical read for %j', async (options, reason) => {
    const fake = driver(options);
    const report = await runProbe(environment(), source, fake.pg);
    expect(report).toMatchObject({ status: 'INCOMPLETE', reason });
    expect(
      fake.clients.flatMap((client) => client.calls).some((call) => call.text === OUTER_QUERY),
    ).toBe(false);
    expect(JSON.stringify(report)).not.toContain(privateText);
  });
  it('does not claim complete evidence after only an outer plan or a row cap', async () => {
    for (const [options, reason] of [
      [{ missingNested: true }, 'nested_plans_incomplete'],
      [{ rowOverflow: true }, 'result_row_cap'],
    ] as const) {
      const report = await runProbe(environment(), source, driver(options).pg);
      expect(report).toMatchObject({ status: 'INCOMPLETE', reason });
    }
  });
  it('force-destroys only the owned idle socket at its deadline and shares one teardown promise', async () => {
    vi.useFakeTimers();
    const fake = driver({ closeHang: true });
    const client = new fake.pg.Client({ connectionString: environment().TEST_DATABASE_URL });
    const owned = ownedConnection(client);
    const first = owned.close();
    expect(owned.close()).toBe(first);
    await vi.advanceTimersByTimeAsync(LIMITS.closeMs - 1);
    expect(client.connection.stream.destroy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await first;
    expect(client.connection.stream.destroy).toHaveBeenCalledTimes(1);
    expect(client.end).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('removes the close timer on normal completion and does not destroy an already closed socket', async () => {
    vi.useFakeTimers();
    const fake = driver();
    const client = new fake.pg.Client({ connectionString: environment().TEST_DATABASE_URL });
    const owned = ownedConnection(client);
    await owned.close();
    owned.destroy();
    await vi.advanceTimersByTimeAsync(LIMITS.closeMs + 1);
    expect(client.connection.stream.destroy).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([
    [{ connectHang: true }, LIMITS.connectMs, 'connect_deadline'],
    [{ metadataHang: true }, LIMITS.metadataMs, 'metadata_deadline'],
    [{ readHang: true }, LIMITS.queryMs, 'canonical_query_deadline'],
  ] as const)(
    'bounds a hanging %j independently of pg graceful close',
    async (options, ms, reason) => {
      vi.useFakeTimers();
      const fake = driver({ ...options, closeHang: true });
      const pending = runProbe(environment(), source, fake.pg);
      await vi.advanceTimersByTimeAsync(ms + LIMITS.closeMs * 3);
      expect(await pending).toMatchObject({ status: 'INCOMPLETE', reason });
      expect(
        fake.clients.some((client) => client.connection.stream.destroy.mock.calls.length > 0),
      ).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    },
  );
  it('applies the total deadline across individually timely metadata calls and cancels their timers', async () => {
    vi.useFakeTimers();
    const fake = driver({ metadataDelay: 3900 });
    const pending = runProbe(environment(), source, fake.pg);
    await vi.advanceTimersByTimeAsync(LIMITS.totalMs + LIMITS.closeMs);
    expect(await pending).toMatchObject({ status: 'INCOMPLETE', reason: 'total_deadline' });
    // The fake peer's independent response can arrive late; no further SQL is sent.
    const calls = fake.clients.flatMap((client) => client.calls).length;
    await vi.advanceTimersByTimeAsync(4000);
    expect(fake.clients.flatMap((client) => client.calls)).toHaveLength(calls);
    expect(vi.getTimerCount()).toBe(0);
  });
});
