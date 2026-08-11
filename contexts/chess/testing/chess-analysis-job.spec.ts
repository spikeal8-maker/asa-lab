import { describe, expect, it } from 'vitest';
import {
  ChessAnalysisJobService,
  type ChessAnalysisJobMutationCommand,
  type SubmitChessAnalysisJobCommand,
} from '../application/chess-analysis-job-service';
import type { ChessEngineAnalysis, ChessEngineSettings } from '../application/engine-contract';
import { MemoryChessAnalysisJobQueue } from '../infrastructure/memory-chess-analysis-job-queue';
import { MemoryChessAnalysisJobRepository } from '../infrastructure/memory-chess-analysis-job-repository';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const OTHER_FEN = 'rnbqkbnr/pppp1ppp/8/4p3/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 2';

const SETTINGS: ChessEngineSettings = {
  search: { kind: 'depth', depth: 8 },
  multiPv: 1,
  threads: 1,
  hashMb: 32,
  mode: 'reproducible',
};

class DeterministicClock {
  private value = 1_000;
  nowMs(): number {
    const result = this.value;
    this.value += 1;
    return result;
  }
}

class DeterministicIds {
  private value = 0;
  nextId(): string {
    this.value += 1;
    return `job-${this.value}`;
  }
}

function fixture(maxAttempts = 2) {
  const repository = new MemoryChessAnalysisJobRepository();
  const queue = new MemoryChessAnalysisJobQueue();
  const service = new ChessAnalysisJobService(
    repository,
    queue,
    new DeterministicClock(),
    new DeterministicIds(),
    {
      maxDepth: 20,
      maxMoveTimeMs: 5_000,
      maxMultiPv: 3,
      maxThreads: 2,
      maxHashMb: 128,
      maxTimeoutMs: 10_000,
      maxAttempts,
    },
  );
  return { repository, queue, service };
}

function submitCommand(
  overrides: Partial<SubmitChessAnalysisJobCommand> = {},
): SubmitChessAnalysisJobCommand {
  return {
    tenantPartition: 'tenant-a',
    requestedBy: 'user-a',
    idempotencyKey: 'request-1',
    request: {
      fen: START_FEN,
      policy: 'post_game_review',
      settings: SETTINGS,
      timeoutMs: 1_000,
    },
    ...overrides,
  };
}

function mutation(
  jobId: string,
  expectedVersion: number,
  overrides: Partial<ChessAnalysisJobMutationCommand> = {},
): ChessAnalysisJobMutationCommand {
  return {
    tenantPartition: 'tenant-a',
    jobId,
    expectedVersion,
    policy: 'post_game_review',
    ...overrides,
  };
}

function analysis(): ChessEngineAnalysis {
  return {
    schemaVersion: 1,
    fen: START_FEN,
    engine: {
      name: 'Recording Engine',
      version: '1',
      protocol: 'internal',
      binarySha256: null,
      networkSha256: null,
    },
    settings: SETTINGS,
    cacheKey: 'recording-key',
    lines: [
      {
        rank: 1,
        score: { kind: 'centipawn', valueCp: 20, perspective: 'white' },
        movesUci: ['e2e4'],
      },
    ],
    depth: 8,
    nodes: 100,
    durationMs: 5,
  };
}

describe('durable chess analysis job foundation', () => {
  it('checks fair play and static quota before repository or queue access', async () => {
    const denied = fixture();
    const deniedResult = await denied.service.submit(
      submitCommand({
        request: {
          ...submitCommand().request,
          policy: 'protected_live_rated',
        },
      }),
    );
    expect(deniedResult).toMatchObject({ ok: false, code: 'capability_denied' });
    expect(denied.repository.calls).toBe(0);
    expect(denied.queue.calls).toBe(0);

    const overQuota = fixture();
    const quotaResult = await overQuota.service.submit(
      submitCommand({
        request: {
          ...submitCommand().request,
          settings: { ...SETTINGS, search: { kind: 'depth', depth: 21 } },
        },
      }),
    );
    expect(quotaResult).toMatchObject({ ok: false, code: 'validation_error' });
    expect(overQuota.repository.calls).toBe(0);
    expect(overQuota.queue.calls).toBe(0);
  });

  it('atomically collapses a concurrent idempotent submission to one queued job', async () => {
    const { service, queue } = fixture();
    const [left, right] = await Promise.all([
      service.submit(submitCommand()),
      service.submit(submitCommand()),
    ]);
    expect(left.ok && right.ok).toBe(true);
    if (!left.ok || !right.ok) return;
    expect(left.value.id).toBe(right.value.id);
    expect([left.replayed, right.replayed].sort()).toEqual([false, true]);
    expect(queue.list()).toHaveLength(1);
  });

  it('rejects reuse of an idempotency key for different analysis input', async () => {
    const { service, queue } = fixture();
    expect((await service.submit(submitCommand())).ok).toBe(true);
    const conflict = await service.submit(
      submitCommand({ request: { ...submitCommand().request, fen: OTHER_FEN } }),
    );
    expect(conflict).toMatchObject({ ok: false, code: 'idempotency_conflict' });
    expect(queue.list()).toHaveLength(1);
  });

  it('partitions identical idempotency keys and job lookup by tenant', async () => {
    const { service, repository, queue } = fixture();
    const first = await service.submit(submitCommand());
    const second = await service.submit(
      submitCommand({ tenantPartition: 'tenant-b', requestedBy: 'user-b' }),
    );
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value.id).not.toBe(second.value.id);
    expect(queue.list('tenant-a')).toHaveLength(1);
    expect(queue.list('tenant-b')).toHaveLength(1);
    expect(await repository.get('tenant-b', first.value.id)).toBeNull();
  });

  it('moves through queued, running, progress and succeeded with optimistic versions', async () => {
    const { service } = fixture();
    const submitted = await service.submit(submitCommand());
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;
    const started = await service.start(mutation(submitted.value.id, 1));
    expect(started).toMatchObject({ ok: true, value: { status: 'running', version: 2 } });
    const progress = await service.progress(mutation(submitted.value.id, 2), {
      stage: 'analysing',
      completedUnits: 4,
      totalUnits: 10,
      message: 'depth 4',
    });
    expect(progress).toMatchObject({
      ok: true,
      value: { status: 'running', version: 3, progress: { completedUnits: 4 } },
    });
    const completed = await service.complete(mutation(submitted.value.id, 3), analysis());
    expect(completed).toMatchObject({
      ok: true,
      value: { status: 'succeeded', version: 4, result: { schemaVersion: 1 } },
    });
    const lateCancel = await service.cancel(mutation(submitted.value.id, 4), 'user-a', null);
    expect(lateCancel).toMatchObject({ ok: false, code: 'invalid_transition' });
  });

  it('allows only one winner in a cancel-versus-complete race', async () => {
    const { service, repository } = fixture();
    const submitted = await service.submit(submitCommand());
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;
    expect((await service.start(mutation(submitted.value.id, 1))).ok).toBe(true);
    const [cancelled, completed] = await Promise.all([
      service.cancel(mutation(submitted.value.id, 2), 'user-a', 'stop'),
      service.complete(mutation(submitted.value.id, 2), analysis()),
    ]);
    expect([cancelled, completed].filter((result) => result.ok)).toHaveLength(1);
    expect([cancelled, completed].filter((result) => !result.ok)).toHaveLength(1);
    const stored = await repository.get('tenant-a', submitted.value.id);
    expect(['cancelled', 'succeeded']).toContain(stored?.status);
  });

  it('records retryable failure and queues exactly the next attempt', async () => {
    const { service, queue } = fixture(2);
    const submitted = await service.submit(submitCommand());
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;
    expect((await service.start(mutation(submitted.value.id, 1))).ok).toBe(true);
    const failure = await service.fail(mutation(submitted.value.id, 2), {
      code: 'engine_failure',
      message: 'engine stopped',
      retryable: true,
    });
    expect(failure).toMatchObject({
      ok: true,
      value: { status: 'failed', attempt: 1, version: 3 },
    });
    const retried = await service.retry(mutation(submitted.value.id, 3));
    expect(retried).toMatchObject({
      ok: true,
      value: { status: 'queued', attempt: 2, version: 4, failure: null },
    });
    expect(queue.list().map((item) => item.attempt)).toContain(2);

    expect((await service.start(mutation(submitted.value.id, 4))).ok).toBe(true);
    expect(
      (
        await service.fail(mutation(submitted.value.id, 5), {
          code: 'engine_failure',
          message: 'engine stopped again',
          retryable: true,
        })
      ).ok,
    ).toBe(true);
    const exhausted = await service.retry(mutation(submitted.value.id, 6));
    expect(exhausted).toMatchObject({ ok: false, code: 'attempts_exhausted' });
  });

  it('persists queue submission failure as a retryable failed state', async () => {
    const { service, repository, queue } = fixture();
    queue.failNextEnqueue('queue offline');
    const result = await service.submit(submitCommand());
    expect(result).toMatchObject({ ok: false, code: 'queue_failure' });
    const stored = await repository.get('tenant-a', 'job-1');
    expect(stored).toMatchObject({
      status: 'failed',
      version: 2,
      failure: { code: 'queue_failure', retryable: true, message: 'queue offline' },
    });
  });

  it('re-authorizes mutation policy before repository access', async () => {
    const { service, repository } = fixture();
    const before = repository.calls;
    const result = await service.start({
      tenantPartition: 'tenant-a',
      jobId: 'job-1',
      expectedVersion: 1,
      policy: 'protected_live_rated',
    });
    expect(result).toMatchObject({ ok: false, code: 'capability_denied' });
    expect(repository.calls).toBe(before);
  });
});
