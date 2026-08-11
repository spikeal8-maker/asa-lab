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
  ChessAnalysisJobQueueEnqueueResult,
  ChessAnalysisJobRepositoryPort,
  ChessAnalysisJobRequesterAuthorizationPort,
  ChessAnalysisJobWorkerClaim,
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
const TERMINAL_FEN = '7k/5Q2/7K/8/8/8/8/8 b - - 0 1';

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
  maxPvPly: 64,
  maxResultBytes: 16_384,
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

class TestRequesterAuthorization implements ChessAnalysisJobRequesterAuthorizationPort {
  calls = 0;
  denied = false;

  async authorize(
    input: Parameters<ChessAnalysisJobRequesterAuthorizationPort['authorize']>[0],
  ): ReturnType<ChessAnalysisJobRequesterAuthorizationPort['authorize']> {
    this.calls += 1;
    if (this.denied) return { allowed: false };
    const access =
      input.context.authenticationId === 'session-a'
        ? { tenantPartition: 'tenant-a', actorId: 'user-a' }
        : input.context.authenticationId === 'session-b'
          ? { tenantPartition: 'tenant-a', actorId: 'user-b' }
          : input.context.authenticationId === 'session-foreign'
            ? { tenantPartition: 'tenant-b', actorId: 'user-b' }
            : null;
    return access ? { allowed: true, access } : { allowed: false };
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

  override async enqueue(
    item: ChessAnalysisJobQueueDispatch,
  ): Promise<ChessAnalysisJobQueueEnqueueResult> {
    this.enter();
    await this.dispatchGate;
    return super.enqueue(item);
  }
}

function fixture(
  options: {
    readonly repository?: ChessAnalysisJobRepositoryPort;
    readonly queue?: MemoryChessAnalysisJobQueue;
    readonly requesterAuthorization?: TestRequesterAuthorization;
    readonly quota?: ChessAnalysisJobQuota;
  } = {},
) {
  const repository = options.repository ?? new MemoryChessAnalysisJobRepository();
  const queue = options.queue ?? new MemoryChessAnalysisJobQueue();
  const requesterAuthorization = options.requesterAuthorization ?? new TestRequesterAuthorization();
  const service = new ChessAnalysisJobService(
    repository,
    queue,
    requesterAuthorization,
    queue,
    new DeterministicClock(),
    new DeterministicIds(),
    options.quota ?? QUOTA,
  );
  return { repository, queue, requesterAuthorization, service };
}

function submitCommand(
  overrides: Partial<SubmitChessAnalysisJobCommand> = {},
): SubmitChessAnalysisJobCommand {
  return {
    context: { authenticationId: 'session-a' },
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
  authenticationId = 'session-a',
  overrides: Partial<ChessAnalysisJobMutationCommand> = {},
): ChessAnalysisJobMutationCommand {
  return {
    jobId,
    expectedVersion,
    policy: 'post_game_review',
    principal: { kind: 'requester', context: { authenticationId } },
    ...overrides,
  };
}

async function claim(
  queue: MemoryChessAnalysisJobQueue,
  job: ChessAnalysisJob,
  workerId = 'worker-a',
): Promise<ChessAnalysisJobWorkerClaim> {
  const result = await queue.claim({
    tenantPartition: job.tenantPartition,
    jobId: job.id,
    attempt: job.attempt,
    workerId,
    leaseDurationMs: 60_000,
  });
  if (result.kind !== 'claimed' && result.kind !== 'existing_same') {
    throw new Error(`Expected queue claim, received ${result.kind}.`);
  }
  return result.claim;
}

async function workerMutation(
  queue: MemoryChessAnalysisJobQueue,
  job: ChessAnalysisJob,
  expectedVersion = job.version,
  overrides: Partial<ChessAnalysisJobMutationCommand> = {},
): Promise<ChessAnalysisJobMutationCommand> {
  const workerClaim = await claim(queue, job);
  return {
    jobId: job.id,
    expectedVersion,
    policy: job.request.policy,
    principal: {
      kind: 'worker',
      tenantPartition: workerClaim.tenantPartition,
      workerId: workerClaim.workerId,
      claimToken: workerClaim.claimToken,
      leaseId: workerClaim.leaseId,
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

describe('durable chess analysis job hardening', () => {
  it('denies fair-play, quota and requester access before repository or queue I/O', async () => {
    const fairPlay = fixture();
    const deniedFairPlay = await fairPlay.service.submit(
      submitCommand({ request: { ...submitCommand().request, policy: 'protected_live_rated' } }),
    );
    expect(deniedFairPlay).toMatchObject({ ok: false, code: 'capability_denied' });
    expect(fairPlay.requesterAuthorization.calls).toBe(0);
    expect((fairPlay.repository as MemoryChessAnalysisJobRepository).calls).toBe(0);
    expect(fairPlay.queue.calls).toBe(0);

    const quota = fixture();
    const deniedQuota = await quota.service.submit(
      submitCommand({
        request: {
          ...submitCommand().request,
          settings: { ...SETTINGS, search: { kind: 'depth', depth: 21 } },
        },
      }),
    );
    expect(deniedQuota).toMatchObject({ ok: false, code: 'validation_error' });
    expect(quota.requesterAuthorization.calls).toBe(0);

    const requesterAuthorization = new TestRequesterAuthorization();
    requesterAuthorization.denied = true;
    const unauthorized = fixture({ requesterAuthorization });
    const deniedRequester = await unauthorized.service.submit(submitCommand());
    expect(deniedRequester).toMatchObject({ ok: false, code: 'authorization_denied' });
    expect((unauthorized.repository as MemoryChessAnalysisJobRepository).calls).toBe(0);
    expect(unauthorized.queue.calls).toBe(0);
  });

  it('derives tenant and owner from opaque requester context and scopes idempotency', async () => {
    const { service, queue } = fixture();
    const first = await service.submit(submitCommand());
    const replay = await service.submit(submitCommand());
    const secondOwner = await service.submit(
      submitCommand({
        context: { authenticationId: 'session-b' },
        idempotencyKey: 'request-1',
      }),
    );
    const foreignTenant = await service.submit(
      submitCommand({
        context: { authenticationId: 'session-foreign' },
        idempotencyKey: 'request-1',
      }),
    );
    expect(first).toMatchObject({
      ok: true,
      value: { tenantPartition: 'tenant-a', requestedBy: 'user-a' },
    });
    expect(replay).toMatchObject({ ok: true, replayed: true, value: { id: 'job-1' } });
    expect(secondOwner).toMatchObject({ ok: true, value: { requestedBy: 'user-b' } });
    expect(foreignTenant).toMatchObject({ ok: true, value: { tenantPartition: 'tenant-b' } });
    expect(queue.list()).toHaveLength(3);
  });

  it('uses explicit enqueue idempotency outcomes without duplicating attempts', async () => {
    const queue = new MemoryChessAnalysisJobQueue();
    const dispatch = { tenantPartition: 'tenant-a', jobId: 'job-a', attempt: 1, jobVersion: 2 };
    await expect(queue.enqueue(dispatch)).resolves.toEqual({ kind: 'created' });
    await expect(queue.enqueue(dispatch)).resolves.toEqual({ kind: 'existing_same' });
    await expect(queue.enqueue({ ...dispatch, jobVersion: 3 })).resolves.toEqual({
      kind: 'conflict',
    });
    expect(queue.list()).toHaveLength(1);
  });

  it('claims atomically, binds worker/attempt/lease and never exposes the bearer in monitoring', async () => {
    let now = 10_000;
    const queue = new MemoryChessAnalysisJobQueue(() => now);
    const { service } = fixture({ queue });
    const submitted = await service.submit(submitCommand());
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;

    const first = await queue.claim({
      tenantPartition: 'tenant-a',
      jobId: submitted.value.id,
      attempt: 1,
      workerId: 'worker-a',
      leaseDurationMs: 100,
    });
    expect(first.kind).toBe('claimed');
    const same = await queue.claim({
      tenantPartition: 'tenant-a',
      jobId: submitted.value.id,
      attempt: 1,
      workerId: 'worker-a',
      leaseDurationMs: 100,
    });
    expect(same).toMatchObject({ kind: 'existing_same' });
    const other = await queue.claim({
      tenantPartition: 'tenant-a',
      jobId: submitted.value.id,
      attempt: 1,
      workerId: 'worker-b',
      leaseDurationMs: 100,
    });
    expect(other).toEqual({ kind: 'leased' });
    expect(queue.list()[0]).not.toHaveProperty('claimToken');
    expect(JSON.stringify(queue.list())).not.toContain('analysis-claim-');
    if (first.kind !== 'claimed') return;

    const forged = await service.start({
      jobId: submitted.value.id,
      expectedVersion: submitted.value.version,
      policy: submitted.value.request.policy,
      principal: {
        kind: 'worker',
        tenantPartition: 'tenant-a',
        workerId: 'worker-b',
        claimToken: first.claim.claimToken,
        leaseId: first.claim.leaseId,
      },
    });
    expect(forged).toMatchObject({ ok: false, code: 'authorization_denied' });

    now = first.claim.leaseExpiresAtMs;
    const reclaimed = await queue.claim({
      tenantPartition: 'tenant-a',
      jobId: submitted.value.id,
      attempt: 1,
      workerId: 'worker-b',
      leaseDurationMs: 100,
    });
    expect(reclaimed).toMatchObject({ kind: 'claimed' });
    const stale = await service.start({
      jobId: submitted.value.id,
      expectedVersion: submitted.value.version,
      policy: submitted.value.request.policy,
      principal: {
        kind: 'worker',
        tenantPartition: 'tenant-a',
        workerId: first.claim.workerId,
        claimToken: first.claim.claimToken,
        leaseId: first.claim.leaseId,
      },
    });
    expect(stale).toMatchObject({ ok: false, code: 'authorization_denied' });
  });

  it('supports the authorized lifecycle and rejects a forged requester owner', async () => {
    const { service, queue } = fixture();
    const submitted = await service.submit(submitCommand());
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;
    const forgedCancel = await service.cancel(
      requesterMutation(submitted.value.id, submitted.value.version, 'session-b'),
      null,
    );
    expect(forgedCancel).toMatchObject({ ok: false, code: 'authorization_denied' });

    const started = await service.start(await workerMutation(queue, submitted.value));
    expect(started).toMatchObject({ ok: true, value: { status: 'running', version: 3 } });
    if (!started.ok) return;
    const progress = await service.progress(await workerMutation(queue, started.value), {
      stage: 'analysing',
      completedUnits: 4,
      totalUnits: 10,
      message: 'depth 4',
    });
    expect(progress).toMatchObject({ ok: true, value: { progress: { completedUnits: 4 } } });
    if (!progress.ok) return;
    const completed = await service.complete(
      await workerMutation(queue, progress.value),
      analysis(),
    );
    expect(completed).toMatchObject({
      ok: true,
      value: { status: 'succeeded', result: { lines: [{ movesUci: ['e2e4'] }] } },
    });
  });

  it('cleans up a delayed enqueue that races durable cancellation', async () => {
    const queue = new DeferredQueue();
    const { service, repository } = fixture({ queue });
    const submission = service.submit(submitCommand());
    await queue.waitUntilDispatchStarts();
    const cancelled = await service.cancel(requesterMutation('job-1', 1), 'stop');
    expect(cancelled).toMatchObject({ ok: true, value: { status: 'cancelled' } });
    queue.release();
    const submitted = await submission;
    expect(submitted).toMatchObject({ ok: true, replayed: true, value: { status: 'cancelled' } });
    expect(queue.list()).toHaveLength(0);
    await expect(repository.get('tenant-a', 'job-1')).resolves.toMatchObject({
      status: 'cancelled',
    });
  });

  it('retries cancellation cleanup idempotently after the durable state is already cancelled', async () => {
    const { service, repository, queue } = fixture();
    const submitted = await service.submit(submitCommand());
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;
    const command = requesterMutation(submitted.value.id, submitted.value.version);
    queue.failNextCancel('queue unavailable');
    const first = await service.cancel(command, 'stop');
    expect(first).toMatchObject({ ok: false, code: 'queue_failure' });
    await expect(repository.get('tenant-a', submitted.value.id)).resolves.toMatchObject({
      status: 'cancelled',
      cancellation: { requestedBy: 'user-a', reason: 'stop' },
    });
    const retry = await service.cancel(command, 'stop');
    expect(retry).toMatchObject({ ok: true, replayed: true, value: { status: 'cancelled' } });
    expect(queue.list()).toHaveLength(0);
  });

  it('allows only one winner in a cancel-versus-complete CAS race', async () => {
    const { service, repository, queue } = fixture();
    const submitted = await service.submit(submitCommand());
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;
    const started = await service.start(await workerMutation(queue, submitted.value));
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const worker = await workerMutation(queue, started.value);
    const [cancelled, completed] = await Promise.all([
      service.cancel(requesterMutation(started.value.id, started.value.version), 'stop'),
      service.complete(worker, analysis()),
    ]);
    expect([cancelled, completed].filter((result) => result.ok)).toHaveLength(1);
    expect((await repository.get('tenant-a', submitted.value.id))?.status).toMatch(
      /cancelled|succeeded/,
    );
  });

  it('retries only retryable failures and dispatches a distinct attempt', async () => {
    const { service, queue } = fixture();
    const submitted = await service.submit(submitCommand());
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;
    const started = await service.start(await workerMutation(queue, submitted.value));
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const failed = await service.fail(await workerMutation(queue, started.value), {
      code: 'engine_failure',
      message: 'engine stopped',
      retryable: true,
    });
    expect(failed).toMatchObject({ ok: true, value: { status: 'failed', attempt: 1 } });
    if (!failed.ok) return;
    const retried = await service.retry(requesterMutation(failed.value.id, failed.value.version));
    expect(retried).toMatchObject({ ok: true, value: { status: 'queued', attempt: 2 } });
    expect(queue.list().map((item) => item.attempt)).toEqual([1, 2]);
  });

  it('rejects poisoned repository identity and partition values before mutation persistence', async () => {
    const baseline = fixture();
    const submitted = await baseline.service.submit(submitCommand());
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;
    let saves = 0;
    const poisoned: ChessAnalysisJobRepositoryPort = {
      create: async (job) => ({ kind: 'created', job }),
      get: async () => ({ ...submitted.value, tenantPartition: 'tenant-foreign' }),
      save: async () => {
        saves += 1;
        return 'saved';
      },
    };
    const current = fixture({ repository: poisoned });
    const result = await current.service.cancel(
      requesterMutation(submitted.value.id, submitted.value.version),
      null,
    );
    expect(result).toMatchObject({ ok: false, code: 'validation_error' });
    expect(saves).toBe(0);
  });

  it('rejects a poisoned idempotent create response with another owner or key', async () => {
    const baseline = fixture();
    const submitted = await baseline.service.submit(submitCommand());
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;
    const poisoned: ChessAnalysisJobRepositoryPort = {
      create: async () => ({
        kind: 'existing',
        job: { ...submitted.value, requestedBy: 'user-b', idempotencyKey: 'foreign-key' },
      }),
      get: async () => null,
      save: async () => 'conflict',
    };
    const result = await fixture({ repository: poisoned }).service.submit(submitCommand());
    expect(result).toMatchObject({ ok: false, code: 'idempotency_conflict' });
  });

  it('persists only exact, bounded, legal canonical engine results', async () => {
    const invalidOutputs: ChessEngineAnalysis[] = [
      analysis({ fen: OTHER_FEN }),
      analysis({
        lines: [
          {
            rank: 1,
            score: { kind: 'centipawn', valueCp: 1, perspective: 'white' },
            movesUci: ['e2e5'],
          },
        ],
      }),
      { ...analysis(), unexpected: true } as ChessEngineAnalysis,
    ];
    for (const [index, output] of invalidOutputs.entries()) {
      const current = fixture();
      const submitted = await current.service.submit(
        submitCommand({ idempotencyKey: `invalid-${index}` }),
      );
      expect(submitted.ok).toBe(true);
      if (!submitted.ok) continue;
      const started = await current.service.start(
        await workerMutation(current.queue, submitted.value),
      );
      expect(started.ok).toBe(true);
      if (!started.ok) continue;
      const completed = await current.service.complete(
        await workerMutation(current.queue, started.value),
        output,
      );
      expect(completed).toMatchObject({ ok: false, code: 'invalid_output' });
      await expect(current.repository.get('tenant-a', submitted.value.id)).resolves.toMatchObject({
        status: 'failed',
        failure: { code: 'invalid_output' },
      });
    }

    const bounded = fixture({ quota: { ...QUOTA, maxPvPly: 1 } });
    const submitted = await bounded.service.submit(submitCommand());
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;
    const started = await bounded.service.start(
      await workerMutation(bounded.queue, submitted.value),
    );
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const tooLong = analysis({
      lines: [
        {
          rank: 1,
          score: { kind: 'centipawn', valueCp: 1, perspective: 'white' },
          movesUci: ['e2e4', 'e7e5'],
        },
      ],
    });
    expect(
      await bounded.service.complete(await workerMutation(bounded.queue, started.value), tooLong),
    ).toMatchObject({
      ok: false,
      code: 'invalid_output',
    });

    const byteBounded = fixture({ quota: { ...QUOTA, maxResultBytes: 100 } });
    const byteSubmitted = await byteBounded.service.submit(
      submitCommand({ idempotencyKey: 'byte-bound' }),
    );
    expect(byteSubmitted.ok).toBe(true);
    if (!byteSubmitted.ok) return;
    const byteStarted = await byteBounded.service.start(
      await workerMutation(byteBounded.queue, byteSubmitted.value),
    );
    expect(byteStarted.ok).toBe(true);
    if (!byteStarted.ok) return;
    expect(
      await byteBounded.service.complete(
        await workerMutation(byteBounded.queue, byteStarted.value),
        analysis(),
      ),
    ).toMatchObject({ ok: false, code: 'invalid_output' });
  });

  it('accepts terminal zero-line output and preserves mate as a distinct score type', async () => {
    const settings = { ...SETTINGS, multiPv: 1 };
    const current = fixture();
    const submitted = await current.service.submit(
      submitCommand({ request: { ...submitCommand().request, fen: TERMINAL_FEN, settings } }),
    );
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;
    const started = await current.service.start(
      await workerMutation(current.queue, submitted.value),
    );
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const terminal = analysis({
      fen: TERMINAL_FEN,
      settings,
      cacheKey: buildChessEngineCacheKey({ fen: TERMINAL_FEN, engine: ENGINE, settings }),
      lines: [],
      depth: 0,
    });
    expect(
      await current.service.complete(await workerMutation(current.queue, started.value), terminal),
    ).toMatchObject({
      ok: true,
      value: { result: { lines: [] } },
    });

    const mateFixture = fixture();
    const mateSubmitted = await mateFixture.service.submit(
      submitCommand({ idempotencyKey: 'mate-output' }),
    );
    expect(mateSubmitted.ok).toBe(true);
    if (!mateSubmitted.ok) return;
    const mateStarted = await mateFixture.service.start(
      await workerMutation(mateFixture.queue, mateSubmitted.value),
    );
    expect(mateStarted.ok).toBe(true);
    if (!mateStarted.ok) return;
    const mate = analysis({
      lines: [
        {
          rank: 1,
          score: { kind: 'mate', winner: 'white', distancePly: null },
          movesUci: ['e2e4'],
        },
      ],
    });
    expect(
      await mateFixture.service.complete(
        await workerMutation(mateFixture.queue, mateStarted.value),
        mate,
      ),
    ).toMatchObject({
      ok: true,
      value: {
        result: {
          lines: [{ score: { kind: 'mate', winner: 'white', distancePly: null } }],
        },
      },
    });
  });

  it('deep-clones/freezes whitelisted result fields and re-authorizes before lookup', async () => {
    const { service, repository, queue, requesterAuthorization } = fixture();
    const submitted = await service.submit(submitCommand());
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;
    const started = await service.start(await workerMutation(queue, submitted.value));
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const mutable = structuredClone(analysis());
    const completed = await service.complete(await workerMutation(queue, started.value), mutable);
    expect(completed.ok).toBe(true);
    if (!completed.ok) return;
    mutable.lines[0]!.movesUci[0] = 'd2d4';
    expect(completed.value.result?.lines[0]?.movesUci[0]).toBe('e2e4');
    expect(Object.isFrozen(completed.value.result?.lines[0]?.movesUci)).toBe(true);

    requesterAuthorization.denied = true;
    const before = (repository as MemoryChessAnalysisJobRepository).calls;
    const denied = await service.cancel(
      requesterMutation(completed.value.id, completed.value.version),
      null,
    );
    expect(denied).toMatchObject({ ok: false, code: 'authorization_denied' });
    expect((repository as MemoryChessAnalysisJobRepository).calls).toBe(before);
  });
});
