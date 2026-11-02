import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type pg from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { AiImageService, type ImageJobRow } from './ai-image.service.js';
import { ComfyTransportError, type ComfyImageRecovery } from './ai-image-comfyui.js';
import { AiAttachmentStorageError } from './ai-attachments/blob-store.js';
import { AiImageWorkerDiagnostics } from './ai-image-worker-diagnostics.js';
import { ApplicationLogStore } from './application-log-store.js';
import { queryLogs } from './admin-logs.worker.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const THREAD = '22222222-2222-4222-8222-222222222222';
const JOB = '33333333-3333-4333-8333-333333333333';
const PROVIDER = '44444444-4444-4444-8444-444444444444';
const FOREIGN = '55555555-5555-4555-8555-555555555555';
const PRIVATE = 'secret-key school@example.test http://private-provider:8188 private prompt';

function secretError() {
  return Object.assign(new TypeError(PRIVATE), {
    name: PRIVATE,
    code: PRIVATE,
    stack: PRIVATE,
    foreignJobId: FOREIGN,
    payload: { prompt: PRIVATE, workflow: PRIVATE, owner: OWNER, thread: THREAD },
  });
}

function fixture(input: Partial<ImageJobRow> = {}) {
  const job: ImageJobRow = {
    recipe: 'flux2-klein-4b-v1',
    graph_digest: 'a'.repeat(64),
    owner_principal_id: OWNER,
    request_id: JOB,
    thread_id: THREAD,
    provider_id: PROVIDER,
    marker: 'ASA_' + PROVIDER.replaceAll('-', ''),
    seed: 10,
    prompt: PRIVATE,
    size: 768,
    state: 'running',
    created_at: '2026-11-02T00:00:00.000Z',
    cancel_requested: false,
    error_code: null,
    deleted_at: null,
    sha256: 'b'.repeat(64),
    size_bytes: 10,
    put_started: false,
    put_uncertain: false,
    cleanup_required: false,
    ...input,
  };
  const records: Record<string, unknown>[] = [];
  const log = vi.fn((text: string) => {
    records.push(JSON.parse(text));
  });
  let failedQuery = '';
  let queryProblem: unknown = secretError();
  const query = vi.fn(async (sql: string, args: unknown[] = []) => {
    if (failedQuery && sql.includes(failedQuery)) throw queryProblem;
    if (sql.includes('ai_image_claim')) return { rows: [{ value: { ...job } }] };
    if (sql.includes('ai_image_dispatch')) {
      const claimed = job.state === 'admitted';
      if (claimed) job.state = 'submitting';
      return { rows: [{ value: claimed }] };
    }
    if (sql.includes('ai_image_transition')) {
      job.state = args[3] as ImageJobRow['state'];
      return { rows: [{ value: true }] };
    }
    if (sql.includes('ai_image_cleanup_done')) return { rows: [{ value: null }] };
    throw new Error('unexpected fixture SQL');
  });
  const transport = {
    readiness: vi.fn(async () => ({ ready: true, reason: null })),
    dispatch: vi.fn(async () => undefined),
    recover: vi.fn<() => Promise<ComfyImageRecovery>>(async () => ({ state: 'running' })),
    cancelPending: vi.fn(async () => false),
  };
  const blobs = {
    remove: vi.fn(async () => true),
    verify: vi.fn(async () => false),
    read: vi.fn(async () => Buffer.from('fixture')),
    putImmutable: vi.fn(async () => undefined),
  };
  const pool = { query } as unknown as pg.Pool;
  const service = new AiImageService(pool, {
    transport,
    blobs,
    maintenance: false,
    workerLog: log,
  });
  const failQuery = (sql: string, problem: unknown = secretError()) => {
    failedQuery = sql;
    queryProblem = problem;
  };
  const states = () =>
    query.mock.calls
      .filter(([sql]) => sql.includes('ai_image_transition'))
      .map(([, args]) => args?.[3]);
  return { service, pool, job, records, log, query, transport, blobs, failQuery, states };
}

function expectPrivate(records: unknown) {
  const text = JSON.stringify(records);
  for (const forbidden of [
    PRIVATE,
    OWNER,
    THREAD,
    PROVIDER,
    FOREIGN,
    'flux2-klein',
    'graph_digest',
    'payload',
    'foreignJobId',
  ])
    expect(text).not.toContain(forbidden);
}

describe('native worker failure diagnostics preserve job semantics', () => {
  it('logs a claim failure without a job identity and preserves the original rejection', async () => {
    const f = fixture();
    const problem = Object.assign(new Error(PRIVATE), { code: '57014' });
    f.failQuery('ai_image_claim', problem);
    await expect(f.service.sweep()).rejects.toBe(problem);
    expect(f.records).toHaveLength(1);
    expect(f.records[0]).toMatchObject({
      phase: 'claim',
      errorCode: 'ai_image_database_timeout',
      errorClass: 'DatabaseError',
      runtime: { jobId: null },
    });
    expect(f.states()).toEqual([]);
    expectPrivate(f.records);
  });

  for (const phase of [
    'cleanup_remove',
    'cleanup_ack',
    'dispatch_claim',
    'storage_verify',
    'recover',
    'transition',
  ] as const) {
    it(`records ${phase} without publishing the exception or changing recovery decisions`, async () => {
      const f = fixture({
        cleanup_required: phase.startsWith('cleanup'),
        state:
          phase === 'dispatch_claim'
            ? 'admitted'
            : phase === 'storage_verify'
              ? 'storing'
              : 'running',
      });
      if (phase === 'cleanup_remove') f.blobs.remove.mockRejectedValueOnce(secretError());
      if (phase === 'cleanup_ack') f.failQuery('ai_image_cleanup_done');
      if (phase === 'dispatch_claim') f.failQuery('ai_image_dispatch');
      if (phase === 'storage_verify') f.blobs.verify.mockRejectedValueOnce(secretError());
      if (phase === 'recover') f.transport.recover.mockRejectedValueOnce(secretError());
      if (phase === 'transition') f.failQuery('ai_image_transition');
      const before = structuredClone(f.job);
      await expect(f.service.sweep()).resolves.toBeUndefined();
      expect(f.records).toHaveLength(1);
      expect(f.records[0]).toMatchObject({
        kind: 'ai_image_worker_failure',
        phase,
        errorCode: 'ai_image_worker_exception',
        errorClass: 'TypeError',
        runtime: { stage: phase, jobId: JOB, attemptId: expect.any(String) },
      });
      const runtime = f.records[0]!['runtime'] as { attemptId: string };
      expect(runtime.attemptId).not.toBe(f.query.mock.calls[0]![1]![0]);
      expect(f.job).toEqual(before);
      expect(f.transport.dispatch).not.toHaveBeenCalled();
      expect(f.blobs.putImmutable).not.toHaveBeenCalled();
      expectPrivate(f.records);
    });
  }

  it('records provider configuration failure before any network transport can be created', async () => {
    const f = fixture();
    const service = new AiImageService(f.pool, {
      blobs: f.blobs,
      env: {},
      maintenance: false,
      workerLog: f.log,
    });
    f.failQuery('ai_comfyui_runtime');
    await service.sweep();
    expect(f.records[0]).toMatchObject({ phase: 'provider_configuration' });
    expect(f.states()).toEqual([]);
    expectPrivate(f.records);
  });

  it('records missing recovered bytes without turning an uncertain job into a failure', async () => {
    const f = fixture();
    f.transport.recover.mockResolvedValueOnce({ state: 'complete' });
    await f.service.sweep();
    expect(f.records[0]).toMatchObject({
      phase: 'output_validate',
      errorCode: 'ai_image_worker_exception',
    });
    expect(f.job.state).toBe('running');
    expect(f.states()).toEqual([]);
    expect(f.blobs.putImmutable).not.toHaveBeenCalled();
    expectPrivate(f.records);
  });

  it('suppresses repeated failed leases for one job and persists their explicit aggregate', async () => {
    const f = fixture();
    f.transport.recover.mockRejectedValue(secretError());
    await f.service.sweep();
    await f.service.sweep();
    await f.service.sweep();
    expect(f.records).toHaveLength(1);
    await f.service.onModuleDestroy();
    expect(f.records.at(-1)).toMatchObject({
      kind: 'ai_image_worker_health',
      delivery: 'rate_limited',
      counters: { failuresObserved: 3, failureReportAttempts: 1, failuresSuppressed: 2 },
    });
    expect(f.job.state).toBe('running');
    expect(f.states()).toEqual([]);
    expectPrivate(f.records);
  });

  it('logger exceptions cannot retry an uncertain provider submission or release the job', async () => {
    const f = fixture({ state: 'admitted' });
    f.log.mockImplementation(() => {
      throw new Error(PRIVATE);
    });
    f.transport.dispatch.mockRejectedValueOnce(
      new ComfyTransportError('ai_image_dispatch_unknown', true),
    );
    await expect(f.service.sweep()).resolves.toBeUndefined();
    expect(f.job.state).toBe('submitting');
    expect(f.states()).toEqual([]);
    await f.service.sweep();
    expect(f.transport.dispatch).toHaveBeenCalledTimes(1);
    expect(f.states()).toEqual(['running']);
    expect(f.log).toHaveBeenCalledTimes(1);
    await expect(f.service.onModuleDestroy()).resolves.toBeUndefined();
    const health = JSON.parse(f.log.mock.calls[1]![0]);
    expect(health).toMatchObject({
      kind: 'ai_image_worker_health',
      delivery: 'log_write_exceptions',
      counters: {
        failuresObserved: 1,
        failureReportAttempts: 1,
        logWriteExceptions: 1,
        healthReportAttempts: 1,
      },
    });
    expectPrivate(f.log.mock.calls);
  });

  for (const outcome of ['unknown', 'integrity', 'not_written'] as const) {
    it(`records ${outcome} storage outcome without changing the existing terminal/uncertain rule`, async () => {
      const f = fixture();
      f.transport.recover.mockResolvedValueOnce({
        state: 'complete',
        png: Buffer.from('synthetic image'),
      });
      f.blobs.putImmutable.mockRejectedValueOnce(new AiAttachmentStorageError(outcome));
      await f.service.sweep();
      expect(f.states()).toEqual(outcome === 'not_written' ? ['storing', 'failed'] : ['storing']);
      expect(f.job.state).toBe(outcome === 'not_written' ? 'failed' : 'storing');
      expect(f.records[0]).toMatchObject({
        phase: 'storage_put',
        errorClass: 'AiAttachmentStorageError',
        errorCode:
          outcome === 'not_written'
            ? 'ai_image_storage_rejected'
            : outcome === 'integrity'
              ? 'ai_image_storage_integrity'
              : 'ai_image_storage_uncertain',
      });
      expect(f.blobs.putImmutable).toHaveBeenCalledTimes(1);
      expect(f.transport.dispatch).not.toHaveBeenCalled();
      expectPrivate(f.records);
    });
  }

  it('a logger failure cannot cause a second uncertain PUT or release its durable storing state', async () => {
    const f = fixture();
    f.log.mockImplementation(() => {
      throw new Error(PRIVATE);
    });
    f.transport.recover.mockResolvedValueOnce({
      state: 'complete',
      png: Buffer.from('synthetic image'),
    });
    f.blobs.putImmutable.mockRejectedValueOnce(new AiAttachmentStorageError('unknown'));
    await f.service.sweep();
    await f.service.sweep();
    expect(f.blobs.putImmutable).toHaveBeenCalledTimes(1);
    expect(f.transport.dispatch).not.toHaveBeenCalled();
    expect(f.states()).toEqual(['storing', 'storing']);
    expect(f.job.state).toBe('storing');
    expectPrivate(f.log.mock.calls);
  });

  it('attributes a failed storage acknowledgement to transition after temporary cleanup succeeds', async () => {
    const f = fixture();
    const query = f.query.getMockImplementation()!;
    f.query.mockImplementation(async (sql, args = []) => {
      if (sql.includes('ai_image_transition') && args[3] === 'failed') throw secretError();
      return query(sql, args);
    });
    f.transport.recover.mockResolvedValueOnce({
      state: 'complete',
      png: Buffer.from('synthetic image'),
    });
    f.blobs.putImmutable.mockRejectedValueOnce(new AiAttachmentStorageError('not_written'));
    await f.service.sweep();
    expect(f.records.map((record) => record.phase)).toEqual(['storage_put', 'transition']);
    expect(f.job.state).toBe('storing');
    expect(f.blobs.putImmutable).toHaveBeenCalledTimes(1);
    expectPrivate(f.records);
  });

  it('normal owned cancellation suppresses publication without a failure or foreign interruption', async () => {
    const f = fixture({ cancel_requested: true });
    f.transport.recover.mockResolvedValueOnce({
      state: 'complete',
      png: Buffer.from('synthetic image'),
    });
    await f.service.sweep();
    expect(f.states()).toEqual(['cancelled']);
    expect(f.records).toEqual([]);
    expect(f.blobs.putImmutable).not.toHaveBeenCalled();
    expect(f.transport.cancelPending).not.toHaveBeenCalled();
  });
});

describe('bounded worker reporting and persistent native projection', () => {
  it('bounds repeat/unique errors and reports suppression explicitly, then permits a fresh window', () => {
    let now = 0;
    const records: Record<string, unknown>[] = [];
    const diagnostics = new AiImageWorkerDiagnostics(
      (text) => {
        records.push(JSON.parse(text));
      },
      () => now,
    );
    for (let i = 0; i < 40; i++) diagnostics.report('recover', JOB, randomUUID(), secretError());
    for (let i = 0; i < 40; i++)
      diagnostics.report('recover', randomUUID(), randomUUID(), secretError());
    expect(records).toHaveLength(30);
    expect(diagnostics.snapshot()).toMatchObject({
      failuresObserved: 80,
      failureReportAttempts: 30,
      failuresSuppressed: 50,
    });
    diagnostics.health();
    expect(records).toHaveLength(30);
    now = 60_000;
    diagnostics.health();
    expect(records.at(-1)).toMatchObject({
      kind: 'ai_image_worker_health',
      delivery: 'rate_limited',
      counters: { failuresSuppressed: 50, logWriteExceptions: 0 },
    });
    diagnostics.report('recover', JOB, randomUUID(), secretError());
    expect(records).toHaveLength(32);
    expect(diagnostics.snapshot().failureReportAttempts).toBe(31);
    expectPrivate(records);
  });

  it('safe codes/classes and invalid diagnostic identities cannot disclose arbitrary fields', () => {
    const records: Record<string, unknown>[] = [];
    const diagnostics = new AiImageWorkerDiagnostics((text) => {
      records.push(JSON.parse(text));
    });
    diagnostics.report(
      'recover',
      PRIVATE,
      PRIVATE,
      new Proxy(
        {},
        {
          getPrototypeOf() {
            throw new Error(PRIVATE);
          },
        },
      ),
    );
    expect(records[0]).toMatchObject({
      errorCode: 'ai_image_worker_exception',
      errorClass: 'Unknown',
      runtime: { jobId: null, attemptId: null },
    });
    expectPrivate(records);
  });

  it('retains the safe worker fields through actual native store normalization and reopening', async () => {
    const root = await mkdtemp(join(tmpdir(), 'asa-worker-diagnostics-'));
    const store = new ApplicationLogStore(root);
    try {
      const f = fixture();
      const service = new AiImageService(f.pool, {
        transport: f.transport,
        blobs: f.blobs,
        maintenance: false,
        workerLog: (text) => store.enqueue(text),
      });
      f.transport.recover.mockRejectedValueOnce(secretError());
      await service.sweep();
      await service.onModuleDestroy();
      await store.close();
      expect(store.counters).toMatchObject({ accepted: 2, persisted: 2, dropped: 0, failures: 0 });
      const result = await queryLogs(
        root,
        {
          scope: 'application',
          from: '2026-01-01T00:00:00.000Z',
          to: '2099-01-01T00:00:00.000Z',
          source: 'api',
          module: 'portal',
          level: '',
          search: '',
          before: null,
        },
        100,
      );
      expect(result.items.map((row) => row.message)).toHaveLength(2);
      const records = result.items.map((row) => JSON.parse(row.message));
      expect(records.find((record) => record.kind === 'ai_image_worker_failure')).toMatchObject({
        phase: 'recover',
        errorCode: 'ai_image_worker_exception',
        errorClass: 'TypeError',
        runtime: { jobId: JOB, attemptId: expect.any(String), stage: 'recover' },
      });
      expect(records.find((record) => record.kind === 'ai_image_worker_health')).toMatchObject({
        counters: {
          failuresObserved: 1,
          failureReportAttempts: 1,
          failuresSuppressed: 0,
          logWriteExceptions: 0,
        },
      });
      expectPrivate(records);
      expect(store.counters).toMatchObject({ accepted: 2, persisted: 2, dropped: 0, failures: 0 });
    } finally {
      await store.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
