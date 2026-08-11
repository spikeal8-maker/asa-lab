import { describe, expect, it } from 'vitest';
import {
  ChessAnalysisJobService,
  type ChessAnalysisJobMutationCommand,
  type ChessAnalysisJobQuota,
  type SubmitChessAnalysisJobCommand,
} from '../application/chess-analysis-job-service';
import type { ChessAnalysisJob } from '../application/chess-analysis-job';
import type {
  ChessAnalysisJobQueueDispatch,
  ChessAnalysisJobRepositoryPort,
} from '../application/chess-analysis-job-ports';
import {
  buildChessEngineCacheKey,
  type ChessEngineAnalysis,
  type ChessEngineSettings,
} from '../application/engine-contract';
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

const ENGINE: ChessEngineAnalysis['engine'] = {
  name: 'Recording Engine',
  version: '1',
  protocol: 'internal',
  binarySha256: null,
  networkSha256: null,
};

const QUOTA: ChessAnalysisJobQuota = {
  maxDepth: 20,
  maxMoveTimeMs: 5_000,
  maxMultiPv: 3,
  maxThreads: 2,
  maxHashMb: 128,
  maxTimeoutMs: 10_000,
  maxAttempts: 2,
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

class ConstantIds {
  nextId(): string {
    return 'job-collision';
  }
}

class DeferredQueue extends MemoryChessAnalysisJobQueue {
  private readonly enteredDispatch: Promise<void>;
  private enter!: () => void;
  private readonly dispatchGate: Promise<void>;
  private releaseDispatch!: () => void;

  constructor() {
    super();
    this.enteredDispatch = new Promise((resolve) => {
      this.enter = resolve;
    });
    this.dispatchGate = new Promise((resolve) => {
      this.releaseDispatch = resolve;
    });
  }

  waitUntilDispatchStarts(): Promise<void> {
    return this.enteredDispatch;
  }

  release(): void {
    this.releaseDispatch();
  }

  override async enqueue(item: ChessAnalysisJobQueueDispatch): Promise<void> {
    this.enter();
    await this.dispatchGate;
    return super.enqueue(item);
  }
}

class QueueCompensationConflictRepository extends MemoryChessAnalysisJobRepository {
  override async save(
    job: ChessAnalysisJob,
    expectedVersion: number,
  ): ReturnType<MemoryChessAnalysisJobRepository['save']> {
    if (job.status === 'failed' && job.failure?.code === 'queue_failure') return 'conflict';
    return super.save(job, expectedVersion);
  }
}

function fixture(
  options: {
    readonly maxAttempts?: number;
    readonly repository?: MemoryChessAnalysisJobRepository;
    readonly queue?: MemoryChessAnalysisJobQueue;
    readonly ids?: { nextId(): string };
  } = {},
) {
  const repository = options.repository ?? new MemoryChessAnalysisJobRepository();
  const queue = options.queue ?? new MemoryChessAnalysisJobQueue();
  const service = new ChessAnalysisJobService(
    repository,
    queue,
    queue,
    new DeterministicClock(),
    options.ids ?? new DeterministicIds(),
    { ...QUOTA, maxAttempts: options.maxAttempts ?? QUOTA.maxAttempts },
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

function requesterMutation(
  jobId: string,
  expectedVersion: number,
  actorId = 'user-a',
  overrides: Partial<ChessAnalysisJobMutationCommand> = {},
): ChessAnalysisJobMutationCommand {
  return {
    tenantPartition: 'tenant-a',
    jobId,
    expectedVersion,
    policy: 'post_game_review',
    principal: { kind: 'requester', actorId },
    ...overrides,
  };
}

function workerMutation(
  queue: MemoryChessAnalysisJobQueue,
  job: ChessAnalysisJob,
  expectedVersion = job.version,
  overrides: Partial<ChessAnalysisJobMutationCommand> = {},
): ChessAnalysisJobMutationCommand {
  const claim = queue
    .list(job.tenantPartition)
    .find((item) => item.jobId === job.id && item.attempt === job.attempt);
  if (!claim) throw new Error('Expected queue claim was not found.');
  return {
    tenantPartition: job.tenantPartition,
    jobId: job.id,
    expectedVersion,
    policy: job.request.policy,
    principal: {
      kind: 'worker',
      workerId: 'worker-a',
      claimToken: claim.claimToken,
    },
    ...overrides,
  };
}

function analysis(overrides: Partial<ChessEngineAnalysis> = {}): ChessEngineAnalysis {
  const fen = overrides.fen ?? START_FEN;
  const settings = overrides.settings ?? SETTINGS;
  const engine = overrides.engine ?? ENGINE;
  return {
    schemaVersion: 1,
    fen,
    engine,
    settings,
    cacheKey: buildChessEngineCacheKey({ fen, engine, settings }),
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
    ...overrides,
  };
}

describe('durable chess analysis job foundation', () => {
  it('checks fair play and static quota before repository, queue or authorization access', async () => {
    const denied = fixture();
    const deniedResult = await denied.service.submit(
      submitCommand({
        request: { ...submitCommand().request, policy: 'protected_live_rated' },
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

  it('does not report queued replay before enqueue and safely resumes pending dispatch', async () => {
    const queue = new DeferredQueue();
    const { service } = fixture({ queue });
    const firstPromise = service.submit(submitCommand());
    await queue.waitUntilDispatchStarts();
    let replaySettled = false;
    const concurrentPromise = service.submit(submitCommand()).then((result) => {
      replaySettled = true;
      return result;
    });
    await Promise.resolve();
    expect(replaySettled).toBe(false);
    queue.release();
    const [first, concurrent] = await Promise.all([firstPromise, concurrentPromise]);
    expect(first.ok && concurrent.ok).toBe(true);
    if (!first.ok || !concurrent.ok) return;
    expect([first.replayed, concurrent.replayed].sort()).toEqual([false, true]);
    expect(first.value.status).toBe('queued');
    expect(concurrent.value.status).toBe('queued');
    const replay = await service.submit(submitCommand());
    expect(replay).toMatchObject({ ok: true, replayed: true, value: { status: 'queued' } });
    expect(queue.list()).toHaveLength(1);
  });

  it('scopes idempotency by tenant and requester', async () => {
    const { service, queue } = fixture();
    const first = await service.submit(submitCommand());
    const second = await service.submit(
      submitCommand({ requestedBy: 'user-b', request: { ...submitCommand().request } }),
    );
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value.id).not.toBe(second.value.id);
    expect(queue.list('tenant-a')).toHaveLength(2);
  });

  it('rejects an owner-mismatched idempotency replay from a repository adapter', async () => {
    const original = fixture();
    const first = await original.service.submit(submitCommand());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const poisonedRepository: ChessAnalysisJobRepositoryPort = {
      create: async () => ({ kind: 'existing', job: first.value }),
      get: (tenant, id) => original.repository.get(tenant, id),
      save: (job, version) => original.repository.save(job, version),
    };
    const service = new ChessAnalysisJobService(
      poisonedRepository,
      original.queue,
      original.queue,
      new DeterministicClock(),
      new DeterministicIds(),
      QUOTA,
    );
    const result = await service.submit(submitCommand({ requestedBy: 'user-b' }));
    expect(result).toMatchObject({ ok: false, code: 'authorization_denied' });
  });

  it('rejects reuse of an owner-scoped idempotency key for different input', async () => {
    const { service, queue } = fixture();
    expect((await service.submit(submitCommand())).ok).toBe(true);
    const conflict = await service.submit(
      submitCommand({ request: { ...submitCommand().request, fen: OTHER_FEN } }),
    );
    expect(conflict).toMatchObject({ ok: false, code: 'idempotency_conflict' });
    expect(queue.list()).toHaveLength(1);
  });

  it('partitions job lookup and claims by tenant', async () => {
    const { service, repository, queue } = fixture();
    const first = await service.submit(submitCommand());
    const second = await service.submit(
      submitCommand({ tenantPartition: 'tenant-b', requestedBy: 'user-b' }),
    );
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(await repository.get('tenant-b', first.value.id)).toBeNull();
    const foreignClaim = queue.list('tenant-b')[0];
    expect(foreignClaim).toBeDefined();
    const denied = await service.start({
      ...workerMutation(queue, first.value),
      principal: {
        kind: 'worker',
        workerId: 'worker-b',
        claimToken: foreignClaim!.claimToken,
      },
    });
    expect(denied).toMatchObject({ ok: false, code: 'authorization_denied' });
  });

  it('requires requester ownership or the exact worker claim before mutation', async () => {
    const { service, repository, queue } = fixture();
    const submitted = await service.submit(submitCommand());
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;

    const beforeRequesterAttempt = repository.calls;
    const requesterStart = await service.start(
      requesterMutation(submitted.value.id, submitted.value.version),
    );
    expect(requesterStart).toMatchObject({ ok: false, code: 'authorization_denied' });
    expect(repository.calls).toBe(beforeRequesterAttempt);

    const badClaim = await service.start({
      ...workerMutation(queue, submitted.value),
      principal: { kind: 'worker', workerId: 'worker-a', claimToken: 'wrong-claim' },
    });
    expect(badClaim).toMatchObject({ ok: false, code: 'authorization_denied' });
    expect((await repository.get('tenant-a', submitted.value.id))?.status).toBe('queued');

    const foreignCancel = await service.cancel(
      requesterMutation(submitted.value.id, submitted.value.version, 'user-b'),
      null,
    );
    expect(foreignCancel).toMatchObject({ ok: false, code: 'authorization_denied' });
  });

  it('moves through queued, running, monotonic progress and completed', async () => {
    const { service, queue } = fixture();
    const submitted = await service.submit(submitCommand());
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;
    expect(submitted.value).toMatchObject({ status: 'queued', version: 2 });
    const started = await service.start(workerMutation(queue, submitted.value));
    expect(started).toMatchObject({ ok: true, value: { status: 'running', version: 3 } });
    if (!started.ok) return;
    const progress = await service.progress(workerMutation(queue, started.value), {
      stage: 'analysing',
      completedUnits: 4,
      totalUnits: 10,
      message: 'depth 4',
    });
    expect(progress).toMatchObject({
      ok: true,
      value: { status: 'running', version: 4, progress: { completedUnits: 4 } },
    });
    if (!progress.ok) return;
    const regression = await service.progress(workerMutation(queue, progress.value), {
      stage: 'starting',
      completedUnits: 0,
      totalUnits: 1,
      message: null,
    });
    expect(regression).toMatchObject({ ok: false, code: 'validation_error' });
    const completed = await service.complete(workerMutation(queue, progress.value), analysis());
    expect(completed).toMatchObject({
      ok: true,
      value: {
        status: 'succeeded',
        version: 5,
        progress: { stage: 'completed' },
        result: { schemaVersion: 1 },
      },
    });
  });

  it('allows only one authorized winner in a cancel-versus-complete race', async () => {
    const { service, repository, queue } = fixture();
    const submitted = await service.submit(submitCommand());
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;
    const started = await service.start(workerMutation(queue, submitted.value));
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const [cancelled, completed] = await Promise.all([
      service.cancel(requesterMutation(started.value.id, started.value.version), 'stop'),
      service.complete(workerMutation(queue, started.value), analysis()),
    ]);
    expect([cancelled, completed].filter((result) => result.ok)).toHaveLength(1);
    expect([cancelled, completed].filter((result) => !result.ok)).toHaveLength(1);
    const stored = await repository.get('tenant-a', submitted.value.id);
    expect(['cancelled', 'succeeded']).toContain(stored?.status);
  });

  it('records retryable failure, dispatches exactly the next attempt and enforces exhaustion', async () => {
    const { service, queue } = fixture({ maxAttempts: 2 });
    const submitted = await service.submit(submitCommand());
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;
    const started = await service.start(workerMutation(queue, submitted.value));
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const failure = await service.fail(workerMutation(queue, started.value), {
      code: 'engine_failure',
      message: 'engine stopped',
      retryable: true,
    });
    expect(failure).toMatchObject({
      ok: true,
      value: { status: 'failed', attempt: 1, version: 4 },
    });
    if (!failure.ok) return;
    const retried = await service.retry(requesterMutation(failure.value.id, failure.value.version));
    expect(retried).toMatchObject({
      ok: true,
      value: { status: 'queued', attempt: 2, version: 6, failure: null },
    });
    if (!retried.ok) return;
    expect(queue.list().map((item) => item.attempt)).toContain(2);

    const restarted = await service.start(workerMutation(queue, retried.value));
    expect(restarted.ok).toBe(true);
    if (!restarted.ok) return;
    const failedAgain = await service.fail(workerMutation(queue, restarted.value), {
      code: 'engine_failure',
      message: 'engine stopped again',
      retryable: true,
    });
    expect(failedAgain.ok).toBe(true);
    if (!failedAgain.ok) return;
    const exhausted = await service.retry(
      requesterMutation(failedAgain.value.id, failedAgain.value.version),
    );
    expect(exhausted).toMatchObject({ ok: false, code: 'attempts_exhausted' });
  });

  it('persists queue submission failure and reports compensation CAS conflicts', async () => {
    const ordinary = fixture();
    ordinary.queue.failNextEnqueue('queue offline');
    const result = await ordinary.service.submit(submitCommand());
    expect(result).toMatchObject({ ok: false, code: 'queue_failure' });
    expect(await ordinary.repository.get('tenant-a', 'job-1')).toMatchObject({
      status: 'failed',
      version: 2,
      failure: { code: 'queue_failure', retryable: true, message: 'queue offline' },
    });

    const conflicting = fixture({ repository: new QueueCompensationConflictRepository() });
    conflicting.queue.failNextEnqueue('queue offline');
    const conflict = await conflicting.service.submit(submitCommand());
    expect(conflict).toMatchObject({ ok: false, code: 'conflict' });
    expect(await conflicting.repository.get('tenant-a', 'job-1')).toMatchObject({
      status: 'dispatching',
      version: 1,
    });
  });

  it('checks retry queue-failure compensation and leaves a truthful failed state', async () => {
    const { service, repository, queue } = fixture();
    const submitted = await service.submit(submitCommand());
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;
    const started = await service.start(workerMutation(queue, submitted.value));
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const engineFailure = await service.fail(workerMutation(queue, started.value), {
      code: 'engine_failure',
      message: 'engine stopped',
      retryable: true,
    });
    expect(engineFailure.ok).toBe(true);
    if (!engineFailure.ok) return;
    queue.failNextEnqueue('retry queue offline');
    const retried = await service.retry(
      requesterMutation(engineFailure.value.id, engineFailure.value.version),
    );
    expect(retried).toMatchObject({ ok: false, code: 'queue_failure' });
    expect(await repository.get('tenant-a', engineFailure.value.id)).toMatchObject({
      status: 'failed',
      attempt: 2,
      version: 6,
      failure: { code: 'queue_failure', message: 'retry queue offline' },
    });
  });

  it('returns a typed queue error if claim removal fails after durable cancellation', async () => {
    const { service, repository, queue } = fixture();
    const submitted = await service.submit(submitCommand());
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;
    queue.failNextCancel('queue unavailable');
    const result = await service.cancel(
      requesterMutation(submitted.value.id, submitted.value.version),
      'stop',
    );
    expect(result).toMatchObject({ ok: false, code: 'queue_failure' });
    expect(await repository.get('tenant-a', submitted.value.id)).toMatchObject({
      status: 'cancelled',
      cancellation: { requestedBy: 'user-a', reason: 'stop' },
    });
  });

  it('removes only the stale attempt when a dispatch rollback races a newer retry', async () => {
    const queue = new MemoryChessAnalysisJobQueue();
    await queue.enqueue({
      tenantPartition: 'tenant-a',
      jobId: 'job-a',
      attempt: 1,
      jobVersion: 2,
    });
    await queue.enqueue({
      tenantPartition: 'tenant-a',
      jobId: 'job-a',
      attempt: 2,
      jobVersion: 6,
    });
    await queue.cancel('tenant-a', 'job-a', 1);
    expect(queue.list().map((item) => item.attempt)).toEqual([2]);
  });

  it('persists invalid_output for mismatched FEN and illegal principal variation', async () => {
    const wrongFen = fixture();
    const submitted = await wrongFen.service.submit(submitCommand());
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;
    const started = await wrongFen.service.start(workerMutation(wrongFen.queue, submitted.value));
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const mismatched = await wrongFen.service.complete(
      workerMutation(wrongFen.queue, started.value),
      analysis({ fen: OTHER_FEN }),
    );
    expect(mismatched).toMatchObject({ ok: false, code: 'invalid_output' });
    expect(await wrongFen.repository.get('tenant-a', submitted.value.id)).toMatchObject({
      status: 'failed',
      failure: { code: 'invalid_output', retryable: false },
    });

    const illegalPv = fixture();
    const second = await illegalPv.service.submit(submitCommand());
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const secondStarted = await illegalPv.service.start(
      workerMutation(illegalPv.queue, second.value),
    );
    expect(secondStarted.ok).toBe(true);
    if (!secondStarted.ok) return;
    const illegal = await illegalPv.service.complete(
      workerMutation(illegalPv.queue, secondStarted.value),
      analysis({
        lines: [
          {
            rank: 1,
            score: { kind: 'centipawn', valueCp: 20, perspective: 'white' },
            movesUci: ['e2e5'],
          },
        ],
      }),
    );
    expect(illegal).toMatchObject({ ok: false, code: 'invalid_output' });
  });

  it('rejects mismatched settings, cache identity and non-finite output structure', async () => {
    const invalidOutputs = [
      analysis({ settings: { ...SETTINGS, hashMb: 64 } }),
      analysis({ cacheKey: 'untrusted-cache-key' }),
      analysis({ durationMs: Number.NaN }),
    ];
    for (const [index, invalidOutput] of invalidOutputs.entries()) {
      const current = fixture();
      const submitted = await current.service.submit(
        submitCommand({ idempotencyKey: `invalid-output-${index}` }),
      );
      expect(submitted.ok).toBe(true);
      if (!submitted.ok) continue;
      const started = await current.service.start(workerMutation(current.queue, submitted.value));
      expect(started.ok).toBe(true);
      if (!started.ok) continue;
      const result = await current.service.complete(
        workerMutation(current.queue, started.value),
        invalidOutput,
      );
      expect(result).toMatchObject({ ok: false, code: 'invalid_output' });
      expect(await current.repository.get('tenant-a', submitted.value.id)).toMatchObject({
        status: 'failed',
        failure: { code: 'invalid_output' },
      });
    }
  });

  it('deep-clones and freezes request and result boundaries', async () => {
    const { service, repository, queue } = fixture();
    const mutableSettings = structuredClone(SETTINGS) as {
      search: { kind: 'depth'; depth: number };
      multiPv: number;
      threads: number;
      hashMb: number;
      mode: 'reproducible';
    };
    const submitted = await service.submit(
      submitCommand({ request: { ...submitCommand().request, settings: mutableSettings } }),
    );
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;
    mutableSettings.hashMb = 64;
    expect(submitted.value.request.settings.hashMb).toBe(32);
    expect(Object.isFrozen(submitted.value)).toBe(true);
    expect(Object.isFrozen(submitted.value.request.settings)).toBe(true);

    const started = await service.start(workerMutation(queue, submitted.value));
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const mutableAnalysis = structuredClone(analysis());
    const completed = await service.complete(workerMutation(queue, started.value), mutableAnalysis);
    expect(completed.ok).toBe(true);
    if (!completed.ok) return;
    mutableAnalysis.lines[0]!.movesUci[0] = 'd2d4';
    expect(completed.value.result?.lines[0]?.movesUci[0]).toBe('e2e4');
    expect(Object.isFrozen(completed.value.result?.lines[0]?.movesUci)).toBe(true);
    expect(
      (await repository.get('tenant-a', submitted.value.id))?.result?.lines[0]?.movesUci[0],
    ).toBe('e2e4');
  });

  it('rejects a generated job ID collision without overwriting the first job', async () => {
    const { service, repository, queue } = fixture({ ids: new ConstantIds() });
    const first = await service.submit(submitCommand());
    expect(first.ok).toBe(true);
    const collision = await service.submit(
      submitCommand({ requestedBy: 'user-b', idempotencyKey: 'request-2' }),
    );
    expect(collision).toMatchObject({ ok: false, code: 'conflict' });
    expect(await repository.get('tenant-a', 'job-collision')).toMatchObject({
      requestedBy: 'user-a',
      status: 'queued',
    });
    expect(queue.list()).toHaveLength(1);
  });

  it('re-authorizes mutation policy before repository access', async () => {
    const { service, repository } = fixture();
    const before = repository.calls;
    const result = await service.start({
      tenantPartition: 'tenant-a',
      jobId: 'job-1',
      expectedVersion: 1,
      policy: 'protected_live_rated',
      principal: { kind: 'worker', workerId: 'worker-a', claimToken: 'claim-a' },
    });
    expect(result).toMatchObject({ ok: false, code: 'capability_denied' });
    expect(repository.calls).toBe(before);
  });
});
