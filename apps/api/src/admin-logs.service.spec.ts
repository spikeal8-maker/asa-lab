import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import databaseContract from './database-diagnostic-contract.json';
import { ApplicationLogStore } from './application-log-store.js';
import { readLogCatalog, verifyNativeLogIntegrity, type LogCatalog } from './admin-logs.worker.js';
import {
  combineRequiredCoverage,
  hostRequiredCoverage,
  readRequiredSources,
} from './required-log-coverage.js';
const { workers, inputs } = vi.hoisted(() => ({
  workers: [] as EventEmitter[],
  inputs: [] as { filter: unknown }[],
}));
vi.mock('node:worker_threads', () => ({
  parentPort: null,
  workerData: null,
  Worker: class extends EventEmitter {
    constructor(_file: string, options: { workerData: { filter: unknown } }) {
      super();
      inputs.push(options.workerData);
      workers.push(this);
    }
    terminate() {
      return Promise.resolve(0);
    }
  },
}));
import { AdminLogsService } from './admin-logs.service.js';
const filter = {
  from: '2026-10-01T00:00:00.000Z',
  to: '2026-10-07T23:59:59.999Z',
  source: '',
  module: '',
  level: '',
  search: '',
  before: null,
};
function emitWorker(offset: number, message: unknown): void {
  const worker = workers.at(offset);
  if (!worker) throw new Error('Fixture worker absent');
  worker.emit('message', message);
}
afterEach(() => {
  inputs.length = 0;
  for (const worker of workers.splice(0)) worker.emit('message', { ok: false });
});
describe('bounded archive jobs', () => {
  it('marks fresh partial source failures as errors without treating protected channels as collector failures', async () => {
    const root = await mkdtemp(join(tmpdir(), 'asa-source-health-'));
    try {
      const catalog = {
        version: 1,
        collectedAt: new Date().toISOString(),
        segments: [],
        bytes: 0,
        sources: [{ source: 'windows:Security', state: 'unavailable' }],
      };
      await writeFile(
        join(root, 'collector-health.json'),
        JSON.stringify({ version: 1, checkedAt: new Date().toISOString(), state: 'ok' }),
      );
      await writeFile(join(root, 'catalog.json'), JSON.stringify(catalog));
      expect(await new AdminLogsService(root, root).status()).toMatchObject({
        state: 'ok',
        sourceFailures: [],
      });
      catalog.sources.push({ source: 'metrics', state: 'error' });
      await writeFile(join(root, 'catalog.json'), JSON.stringify(catalog));
      expect(await new AdminLogsService(root, root).status()).toMatchObject({
        state: 'error',
        sourceFailures: [{ source: 'metrics' }],
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it('freezes effective default dates across continuation requests', async () => {
    const service = new AdminLogsService('fixture', 'fixture');
    const first = service.query(filter, 'owner', '', { from: true, to: true });
    emitWorker(-1, {
      ok: true,
      result: {
        items: [],
        next: null,
        partial: true,
        scanned: 200000,
        scanState: {
          catalog: { version: 1, sources: [], segments: [] },
          offset: 1,
          matches: [],
          scanned: 200000,
        },
      },
    });
    const page = (await first) as { scanCursor: string };
    const resumed = service.query(
      { ...filter, from: '2026-10-02T00:00:01.000Z', to: '2026-10-08T00:00:01.000Z' },
      'owner',
      page.scanCursor,
      { from: true, to: true },
    );
    emitWorker(-1, {
      ok: true,
      result: { items: [], next: null, partial: false, scanned: 200001 },
    });
    expect(inputs.at(-1)?.filter).toEqual(filter);
    expect(await resumed).toMatchObject({ partial: false, scanCursor: null });
  });
  it('resumes searches only for the same owner/filter, reserves capacity, and hides private snapshots', async () => {
    const service = new AdminLogsService('fixture', 'fixture');
    const first = service.query(filter, 'owner');
    const second = service.query(filter, 'owner');
    await expect(service.query(filter, 'owner')).rejects.toThrow('LOG_BUSY');
    const state = {
      catalog: { version: 1, segments: [], sources: [] },
      offset: 1,
      matches: [],
      scanned: 200000,
    };
    emitWorker(-2, {
      ok: true,
      result: { items: [], next: null, partial: true, scanned: 200000, scanState: state },
    });
    emitWorker(-1, { ok: true, result: { items: [], next: null, partial: false, scanned: 0 } });
    const page = (await first) as { scanCursor: string; scanState?: unknown };
    await second;
    expect(page.scanCursor).toMatch(/^[a-f0-9-]{36}$/);
    expect(page.scanState).toBeUndefined();
    await expect(service.query(filter, 'other', page.scanCursor)).rejects.toThrow('LOG_NOT_FOUND');
    await expect(
      service.query({ ...filter, search: 'changed' }, 'owner', page.scanCursor),
    ).rejects.toThrow('LOG_NOT_FOUND');
    const continuation = service.query(filter, 'owner', page.scanCursor);
    await expect(service.query(filter, 'owner', page.scanCursor)).rejects.toThrow('LOG_BUSY');
    emitWorker(-1, {
      ok: true,
      result: { items: [], next: null, partial: false, scanned: 200001 },
    });
    expect(await continuation).toMatchObject({ partial: false, scanCursor: null });
    await expect(service.query(filter, 'owner', page.scanCursor)).rejects.toThrow('LOG_NOT_FOUND');
  });
  it('shows a collector failure even when the catalog is fresh', async () => {
    const root = await mkdtemp(join(tmpdir(), 'asa-log-health-'));
    try {
      await writeFile(
        join(root, 'catalog.json'),
        JSON.stringify({
          version: 1,
          collectedAt: new Date().toISOString(),
          sources: [],
          segments: [],
          bytes: 0,
        }),
      );
      await writeFile(
        join(root, 'collector-health.json'),
        JSON.stringify({
          version: 1,
          state: 'error',
          checkedAt: new Date().toISOString(),
          detail: 'fixture interruption',
        }),
      );
      expect(await new AdminLogsService(root, root).status()).toMatchObject({
        state: 'error',
        collectorHealth: { state: 'error' },
      });
      await rm(join(root, 'catalog.json'));
      expect(await new AdminLogsService(root, root).status()).toMatchObject({
        state: 'unavailable',
        collectorHealth: { state: 'error' },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it('exposes audit progress and rejects overdue integrity coverage with a fresh health timestamp', async () => {
    const root = await mkdtemp(join(tmpdir(), 'asa-audit-health-'));
    try {
      await writeFile(
        join(root, 'catalog.json'),
        JSON.stringify({
          version: 1,
          collectedAt: new Date().toISOString(),
          sources: [],
          segments: [],
          bytes: 0,
        }),
      );
      const audit = {
        state: 'running',
        generation: 'fixture',
        checked: 2,
        total: 8,
        deadline: Date.now() / 1000 - 1,
        lastCompletedAt: null,
      };
      await writeFile(
        join(root, 'collector-health.json'),
        JSON.stringify({
          version: 1,
          state: 'ok',
          checkedAt: new Date().toISOString(),
          historyAudit: audit,
        }),
      );
      expect(await new AdminLogsService(root, root).status()).toMatchObject({
        state: 'error',
        collectorHealth: {
          state: 'error',
          historyAudit: {
            state: 'overdue',
            generation: 'fixture',
            checked: 2,
            total: 8,
          },
        },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it.each([
    ['LOG_EXPORT_TOO_LARGE', 'Архив превышает допустимый объём. Выберите меньший период.'],
    ['LOG_SEGMENT_INVALID', 'Обнаружен повреждённый файл журнала. Требуется проверка сборщика.'],
    ['LOG_SNAPSHOT_CHANGED', 'Журналы обновились во время сборки. Повторите сбор архива.'],
    ['password=private-value', 'Не удалось собрать архив. Повторите позже.'],
  ])('reports a safe actionable export failure for %s', async (code, message) => {
    const root = await mkdtemp(join(tmpdir(), 'asa-log-job-'));
    try {
      const service = new AdminLogsService(root, root);
      const job = await service.createExport('owner', filter);
      emitWorker(-1, { ok: false, error: code });
      await vi.waitFor(async () =>
        expect((await service.exportStatus('owner', job.id)).error).toBe(message),
      );
      await expect(service.download('owner', job.id)).rejects.toThrow('LOG_NOT_FOUND');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it('reserves concurrent exports atomically and denies another owner access', async () => {
    const root = await mkdtemp(join(tmpdir(), 'asa-log-job-'));
    try {
      const service = new AdminLogsService(root, root);
      const results = await Promise.allSettled([
        service.createExport('owner', filter),
        service.createExport('owner', filter),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
      const job = (
        results.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<{ id: string }>
      ).value;
      await expect(service.exportStatus('other', job.id)).rejects.toThrow('LOG_NOT_FOUND');
      await expect(service.download('other', job.id)).rejects.toThrow('LOG_NOT_FOUND');
      emitWorker(-1, { ok: true, result: { count: 3, bytes: 200 } });
      await vi.waitFor(async () =>
        expect((await service.exportStatus('owner', job.id)).state).toBe('ready'),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it('cleans restart orphans but preserves unrelated files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'asa-log-job-'));
    try {
      await writeFile(join(root, '10000000-0000-4000-8000-000000000001.zip'), 'orphan');
      await writeFile(join(root, 'owner-backup.zip'), 'preserved');
      const service = new AdminLogsService(root, root);
      await service.status();
      expect(await readdir(root)).toEqual(['owner-backup.zip']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function fixture() {
  const now = new Date().toISOString();
  const ids = [
    'docker',
    'database-events',
    'metrics',
    'docker-lifecycle',
    'operations:updates',
    'operations:backup',
    ...['api', 'web', 'scratch', 'postgres', 'minio'].map((id) => `${id}:recent`),
    ...Object.keys(databaseContract.sources).map((id) => `database-events:${id}`),
    'linux:journal',
    'windows',
    'windows:System',
    'windows:Application',
    'windows:Security',
  ];
  const rules = ids.map((source) => ({
    source,
    applicable: !source.startsWith('windows'),
    maxAgeSeconds: 300,
    requireThrough:
      source.endsWith(':recent') ||
      source.startsWith('database-events:') ||
      source === 'linux:journal',
    ...(source.startsWith('windows') ? { reason: 'other-platform' as const } : {}),
  }));
  return {
    version: 1,
    collectedAt: now,
    retentionDays: 30,
    maxBytes: 1024 ** 3,
    bytes: 0,
    trimmed: false,
    requiredSources: {
      version: 1 as const,
      policy: 'asa-connected-v1' as const,
      platform: 'linux' as const,
      auditMaxAgeSeconds: 900,
      sources: rules,
    },
    historyAudit: {
      state: 'complete',
      generation: 'fixture-audit',
      checked: 0,
      total: 0,
      deadline: Date.now() / 1000 + 900,
      completedAt: now,
      lastCompletedAt: now,
      incomplete: false,
    },
    sources: rules.map((rule) => ({
      source: rule.source,
      state: rule.applicable ? 'ok' : 'unavailable',
      checkedAt: now,
      lastCollectedAt: now,
      collectedThrough: rule.requireThrough ? now : null,
      applicable: rule.applicable,
      detail: 'fixture',
      stale: false,
      possibleCoverageGap: false,
    })),
    segments: [] as LogCatalog['segments'],
  };
}
function host(catalog: ReturnType<typeof fixture>) {
  return hostRequiredCoverage(catalog, { state: 'ok', checkedAt: new Date().toISOString() });
}
const healthyNative = { state: 'ok' as const, reason: 'fixture_verified' };

describe('finite required connected-source coverage', () => {
  it.each(['unconfigured', 'fresh', 'stale', 'invalid'])(
    'reads the real Python publisher contract with %s backup evidence',
    async (mode) => {
      const root = await mkdtemp(join(tmpdir(), 'asa-publisher-contract-'));
      try {
        // Core adapters are represented by controlled healthy source observations.
        // Operational receipt parsing, source states, declaration and catalog
        // publication use their real Python implementation. Only the privileged
        // external-file read is replaced, so this runs on Windows without root.
        const script = `
import datetime as dt
import json
import os
from pathlib import Path
import sys
from unittest.mock import patch
sys.path.insert(0, str(Path.cwd() / 'tools'))
from collect_logs import Collector, DATABASE_DIAGNOSTICS, normalize, now
from deployment import operational as op
root, mode = Path(sys.argv[1]), sys.argv[2]
settings = {} if mode == 'unconfigured' else {'backupSuccessReceipt': str(root / 'receipt.json')}
config = {'operationalSources': settings}
c = Collector(root, config)
try:
    op.append_operation(root, {'version': 1, 'operation': 'updates', 'status': 'succeeded',
        'producer': 'manager', 'trigger': 'manual', 'at': now()})
    op.operational_events(c, normalize, settings)
    if mode != 'unconfigured':
        completed = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=2 if mode == 'stale' else 0)
        receipt = {'format': 'asa-backup-success-v1', 'status': 'succeeded',
            'completedAt': completed.isoformat(), 'archiveSha256': 'a' * 64,
            'archiveBytes': 123, 'trigger': 'manual'}
        if mode == 'invalid': receipt['archiveSha256'] = 'invalid'
        with patch.object(op, 'private_file', return_value=json.dumps(receipt).encode()):
            op.backup_event(c, normalize, settings)
    policy = op.required_sources(config, DATABASE_DIAGNOSTICS['sources'], 'windows' if os.name == 'nt' else 'linux')
    for rule in policy['sources']:
        if not rule['source'].startswith('operations:'):
            c.status(rule['source'], 'ok' if rule['applicable'] else 'unavailable',
                'Controlled core adapter observation', now() if rule['requireThrough'] else None)
    c.publish()
finally:
    c.db.close()
`;
        execFileSync(
          process.platform === 'win32' ? 'python' : 'python3',
          ['-c', script, root, mode],
          {
            timeout: 15000,
            stdio: 'pipe',
          },
        );
        const catalog = (await readLogCatalog(join(root, '.asa', 'diagnostics', 'store')))!;
        const coverage = hostRequiredCoverage(catalog, {
          state: 'ok',
          checkedAt: new Date().toISOString(),
        });
        expect(
          catalog.requiredSources?.sources.find((row) => row.source === 'operations:backup'),
        ).toMatchObject({ applicable: true, requireThrough: false });
        const backup = coverage.sources.find((row) => row.source === 'operations:backup');
        expect(
          coverage.sources.some((row) => row.reason === 'required_policy_source_missing'),
        ).toBe(false);
        expect(catalog.sources.find((row) => row.source === 'operations:backup')?.state).toBe(
          mode === 'fresh' ? 'ok' : mode === 'invalid' ? 'error' : 'pending',
        );
        expect(backup).toMatchObject({
          state: mode === 'fresh' ? 'ok' : 'incomplete',
          reason:
            mode === 'fresh' ? 'verified' : mode === 'invalid' ? 'source_error' : 'source_pending',
        });
        expect(combineRequiredCoverage(coverage, healthyNative).state).toBe(
          mode === 'fresh' ? 'ok' : 'incomplete',
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
    20000,
  );
  it('requires the complete configured set and native proof while keeping global-history limitations', () => {
    const coverage = host(fixture());
    expect(coverage.state).toBe('ok');
    expect(coverage.requiredSourceIds).toContain('scratch:recent');
    expect(coverage.excludedSourceIds).toContain('windows:Security');
    expect(
      combineRequiredCoverage(coverage, { state: 'unknown', reason: 'writer_absent' }).state,
    ).toBe('unknown');
    expect(combineRequiredCoverage(coverage, healthyNative)).toMatchObject({
      state: 'ok',
      limitations: expect.any(Array),
    });
    expect(coverage.limitations.join(' ')).toContain('global retained history is not complete');
  });
  it('never infers coverage from a fresh catalog, empty declarations or API-only policy', () => {
    const catalog = fixture();
    expect(readRequiredSources({ ...catalog.requiredSources, sources: [] })).toBeUndefined();
    expect(readRequiredSources({ ...catalog.requiredSources, version: 2 })).toBeUndefined();
    expect(
      readRequiredSources({ ...catalog.requiredSources, platform: { toString: null } }),
    ).toBeUndefined();
    catalog.requiredSources.sources = catalog.requiredSources.sources.filter(
      (rule) => rule.source === 'api:recent',
    );
    expect(host(catalog).state).toBe('incomplete');
    const partial = fixture();
    delete (partial as Partial<typeof partial>).maxBytes;
    expect(host(partial).state).toBe('unknown');
  });
  it.each(['pending', 'error', 'unavailable', 'unknown'])(
    'does not green a required source with state %s',
    (state) => {
      const catalog = fixture();
      catalog.sources.find((row) => row.source === 'scratch:recent')!.state = state;
      expect(combineRequiredCoverage(host(catalog), healthyNative).state).toBe(
        state === 'unknown' ? 'unknown' : 'incomplete',
      );
    },
  );
  it.each([
    'checked',
    'through',
    'future',
    'gap',
    'missing',
    'undeclared_live',
    'missing_os_policy',
  ])('rejects %s coverage', (failure) => {
    const catalog = fixture();
    const source = catalog.sources.find((row) => row.source === 'scratch:recent')!;
    if (failure === 'checked') source.checkedAt = new Date(Date.now() - 301000).toISOString();
    if (failure === 'through')
      source.collectedThrough = new Date(Date.now() - 301000).toISOString();
    if (failure === 'future') source.checkedAt = new Date(Date.now() + 60000).toISOString();
    if (failure === 'gap') source.possibleCoverageGap = true;
    if (failure === 'missing') catalog.sources = catalog.sources.filter((row) => row !== source);
    if (failure === 'undeclared_live') catalog.sources.push({ ...source, source: 'search:recent' });
    if (failure === 'missing_os_policy')
      catalog.requiredSources.sources = catalog.requiredSources.sources.filter(
        (rule) => rule.source !== 'windows:Security',
      );
    expect(host(catalog).state).not.toBe('ok');
  });
  it('excludes unavailable OS sources only through explicit opposite-platform policy', () => {
    const catalog = fixture();
    expect(host(catalog).state).toBe('ok');
    const channel = 'windows:Microsoft-Windows-Windows Defender/Operational';
    catalog.requiredSources.sources.push({
      source: channel,
      applicable: false,
      maxAgeSeconds: 300,
      requireThrough: true,
      reason: 'other-platform',
    });
    expect(readRequiredSources(catalog.requiredSources)).toBeDefined();
    const rule = catalog.requiredSources.sources.find((row) => row.source === 'windows:Security')!;
    rule.applicable = true;
    expect(readRequiredSources(catalog.requiredSources)).toBeUndefined();
    rule.applicable = false;
    rule.source = 'provider:ollama';
    expect(readRequiredSources(catalog.requiredSources)).toBeUndefined();
  });
  it.each(['overdue', 'error', 'gap', 'partial', 'stale', 'missing'])(
    'requires actual retained integrity evidence: %s',
    (failure) => {
      const catalog = fixture();
      if (failure === 'overdue' || failure === 'error') catalog.historyAudit.state = failure;
      if (failure === 'gap') catalog.historyAudit.incomplete = true;
      if (failure === 'partial') catalog.historyAudit.total = 1;
      if (failure === 'stale')
        catalog.historyAudit.completedAt = new Date(Date.now() - 901000).toISOString();
      if (failure === 'missing') delete (catalog as Partial<typeof catalog>).historyAudit;
      expect(host(catalog).state).not.toBe('ok');
    },
  );
  it('allows bounded ongoing audit only after a recent completed sweep, never an unproved first sweep', () => {
    const catalog = fixture();
    catalog.historyAudit.state = 'running';
    catalog.historyAudit.total = 10;
    expect(host(catalog).state).toBe('ok');
    catalog.historyAudit.lastCompletedAt = '';
    expect(host(catalog).state).toBe('incomplete');
  });
});

describe('native writer and bounded immutable integrity proofs', () => {
  it('reports real native storage failure and queued writes without a false healthy result', async () => {
    const base = await mkdtemp(join(tmpdir(), 'asa-native-failure-'));
    const hostRoot = join(base, 'host');
    await mkdir(hostRoot);
    await writeFile(join(hostRoot, 'catalog.json'), JSON.stringify(fixture()));
    await writeFile(
      join(hostRoot, 'collector-health.json'),
      JSON.stringify({ version: 1, state: 'ok', checkedAt: new Date().toISOString() }),
    );
    const brokenRoot = join(base, 'not-a-directory');
    await writeFile(brokenRoot, 'fixture');
    const broken = new ApplicationLogStore(brokenRoot);
    const queued = new ApplicationLogStore(join(base, 'native'));
    try {
      broken.enqueue(JSON.stringify({ kind: 'http', path: '/fixture/write-failure' }));
      expect(
        await new AdminLogsService(hostRoot, join(base, 'exports'), () => broken).status(),
      ).toMatchObject({
        requiredCoverage: { state: 'incomplete', native: { state: 'incomplete' } },
      });
      queued.enqueue(JSON.stringify({ kind: 'http', path: '/fixture/initial' }));
      await queued.flush();
      const flush = queued.flush.bind(queued);
      const spy = vi.spyOn(queued, 'flush').mockImplementation(async () => {
        await flush();
        queued.enqueue(JSON.stringify({ kind: 'http', path: '/fixture/pending' }));
      });
      expect(
        await new AdminLogsService(hostRoot, join(base, 'exports'), () => queued).status(),
      ).toMatchObject({
        requiredCoverage: {
          state: 'incomplete',
          native: { state: 'incomplete', counters: { pending: 1 } },
        },
      });
      spy.mockRestore();
    } finally {
      vi.restoreAllMocks();
      await broken.close();
      await queued.close();
      await rm(base, { recursive: true, force: true });
    }
  });
  it('combines real native persistence with host declarations; dropped writes cannot green', async () => {
    const base = await mkdtemp(join(tmpdir(), 'asa-required-status-'));
    const writer = new ApplicationLogStore(join(base, 'native'), 128 * 1024 * 1024, 1);
    try {
      const root = join(base, 'host');
      await mkdir(root);
      await writeFile(join(root, 'catalog.json'), JSON.stringify(fixture()));
      await writeFile(
        join(root, 'collector-health.json'),
        JSON.stringify({ version: 1, state: 'ok', checkedAt: new Date().toISOString() }),
      );
      writer.enqueue(
        JSON.stringify({
          kind: 'http',
          time: new Date().toISOString(),
          path: '/api/scratch/fixture',
        }),
      );
      const service = new AdminLogsService(root, join(base, 'exports'), () => writer);
      expect(await service.status()).toMatchObject({
        coverageComplete: false,
        requiredCoverage: {
          state: 'ok',
          native: { state: 'ok', counters: { dropped: 0, pending: 0 } },
        },
      });
      writer.enqueue(JSON.stringify({ kind: 'http', path: '/fixture/one' }));
      writer.enqueue(JSON.stringify({ kind: 'http', path: '/fixture/two' }));
      expect(await service.status()).toMatchObject({
        coverageComplete: false,
        requiredCoverage: { state: 'incomplete', native: { state: 'incomplete' } },
      });
    } finally {
      await writer.close();
      await rm(base, { recursive: true, force: true });
    }
  });
  it('bounds/cache-checks proofs, never calls a partial audit healthy, and rechecks expired content', async () => {
    const root = await mkdtemp(join(tmpdir(), 'asa-native-proof-'));
    const writer = new ApplicationLogStore(root);
    try {
      writer.enqueue(JSON.stringify({ kind: 'http', path: '/fixture/one' }));
      await writer.flush();
      let catalog = (await readLogCatalog(root))!;
      const proofs = new Map<string, number>();
      expect(await verifyNativeLogIntegrity(root, catalog, proofs, 0)).toBe('partial');
      expect(proofs.size).toBe(0);
      expect(await verifyNativeLogIntegrity(root, catalog, proofs)).toBe('ok');
      const previous = new Map(proofs);
      writer.enqueue(JSON.stringify({ kind: 'http', path: '/fixture/two' }));
      await writer.flush();
      catalog = (await readLogCatalog(root))!;
      expect(await verifyNativeLogIntegrity(root, catalog, proofs)).toBe('ok');
      expect(proofs.size).toBe(2);
      for (const [key, value] of previous) expect(proofs.get(key)).toBe(value);
      const file = join(root, catalog.segments[0]!.file);
      const bytes = await readFile(file);
      bytes[0] = 0;
      await writeFile(file, bytes);
      const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 300001);
      expect(await verifyNativeLogIntegrity(root, catalog, proofs)).toBe('invalid');
      clock.mockRestore();
      expect(await verifyNativeLogIntegrity(root, catalog, new Map())).toBe('invalid');
    } finally {
      vi.restoreAllMocks();
      await writer.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
