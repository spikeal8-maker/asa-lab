import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { applyLegalMove, parseFen, START_FEN, toFen } from '../domain/chess';
import {
  deserializePrivateChessTrainingRecord,
  deterministicChessTrainingId,
  serializePrivateChessTrainingRecord,
  type ChessTrainingSource,
  type PrivateChessTrainingRecord,
} from '../application/training-library-model';
import type {
  ChessTrainingLibraryRepositoryPort,
  ChessTrainingPartition,
} from '../application/training-library-repository';
import {
  ChessTrainingLibraryService,
  type AuthenticatedChessTrainingContext,
  type ChessTrainingAuthorizationPort,
  type ChessTrainingLibraryAction,
  type ChessTrainingSourceReference,
  type ChessTrainingSourceResolverPort,
} from '../application/training-library-service';
import { MemoryChessTrainingLibraryRepository } from '../infrastructure/memory-training-library-repository';

const CREATED_AT = '2026-08-12T00:00:00.000Z';
const ATTEMPT_1_AT = '2026-08-12T00:01:00.000Z';
const ATTEMPT_2_AT = '2026-08-12T00:02:00.000Z';
const ATTEMPT_3_AT = '2026-08-12T00:03:00.000Z';
const STUDENT_CONTEXT = { authenticationId: 'session:student-1' } as const;
const OTHER_CONTEXT = { authenticationId: 'session:student-2' } as const;
const DENIED_CONTEXT = { authenticationId: 'session:denied' } as const;
const STUDENT_PARTITION = {
  tenantId: 'tenant:school-1',
  ownerId: 'user:student-1',
} as const;
const OTHER_PARTITION = {
  tenantId: 'tenant:school-1',
  ownerId: 'user:student-2',
} as const;

function fenAfter(uci: string): string {
  const root = parseFen(START_FEN);
  if (!root.ok) throw new Error(root.message);
  const applied = applyLegalMove(root.value, uci);
  if (!applied.ok) throw new Error(applied.message);
  return toFen(applied.value.position);
}

function source(projectVersionId = 'version-1', projectId = 'project-1'): ChessTrainingSource {
  return {
    projectId,
    projectVersionId,
    reviewAlgorithm: 'asa-review-v1',
    ply: 1,
    color: 'white',
    classification: 'mistake',
    fenBefore: START_FEN,
    fenAfter: fenAfter('e2e4'),
    playedUci: 'e2e4',
    bestUci: 'd2d4',
    bestFenAfter: fenAfter('d2d4'),
  };
}

function sourceReference(
  projectVersionId = 'version-1',
  projectId = 'project-1',
): ChessTrainingSourceReference {
  return { projectId, projectVersionId, ply: 1 };
}

function createInput(projectVersionId = 'version-1', projectId = 'project-1') {
  return {
    createdAt: CREATED_AT,
    sourceReference: sourceReference(projectVersionId, projectId),
  } as const;
}

class TestAuthorization implements ChessTrainingAuthorizationPort {
  readonly calls: Array<{
    readonly context: AuthenticatedChessTrainingContext;
    readonly action: ChessTrainingLibraryAction;
  }> = [];

  constructor(
    private readonly partitions = new Map<string, ChessTrainingPartition>([
      [STUDENT_CONTEXT.authenticationId, STUDENT_PARTITION],
      [OTHER_CONTEXT.authenticationId, OTHER_PARTITION],
    ]),
  ) {}

  async authorize(input: {
    readonly context: AuthenticatedChessTrainingContext;
    readonly action: ChessTrainingLibraryAction;
  }) {
    this.calls.push(structuredClone(input));
    const partition = this.partitions.get(input.context.authenticationId);
    return partition
      ? ({ allowed: true, partition: { ...partition } } as const)
      : ({ allowed: false } as const);
  }
}

interface SourceEntry {
  readonly partition: ChessTrainingPartition;
  readonly source: ChessTrainingSource;
}

class TestSourceResolver implements ChessTrainingSourceResolverPort {
  readonly calls: Array<{
    readonly partition: ChessTrainingPartition;
    readonly reference: ChessTrainingSourceReference;
  }> = [];

  constructor(private readonly entries: readonly SourceEntry[]) {}

  async resolve(input: {
    readonly partition: ChessTrainingPartition;
    readonly reference: ChessTrainingSourceReference;
  }): Promise<ChessTrainingSource | null> {
    this.calls.push(structuredClone(input));
    const entry = this.entries.find(
      (candidate) =>
        candidate.partition.tenantId === input.partition.tenantId &&
        candidate.partition.ownerId === input.partition.ownerId &&
        candidate.source.projectId === input.reference.projectId &&
        candidate.source.projectVersionId === input.reference.projectVersionId &&
        candidate.source.ply === input.reference.ply,
    );
    return entry ? structuredClone(entry.source) : null;
  }
}

function fixture(
  entries: readonly SourceEntry[] = [{ partition: STUDENT_PARTITION, source: source() }],
) {
  const repository = new MemoryChessTrainingLibraryRepository();
  const authorization = new TestAuthorization();
  const resolver = new TestSourceResolver(entries);
  const service = new ChessTrainingLibraryService(repository, authorization, resolver);
  return { repository, authorization, resolver, service };
}

async function createRecord(
  service: ChessTrainingLibraryService,
  context: AuthenticatedChessTrainingContext = STUDENT_CONTEXT,
  projectVersionId = 'version-1',
): Promise<PrivateChessTrainingRecord> {
  const created = await service.create(context, createInput(projectVersionId));
  expect(created.ok).toBe(true);
  if (!created.ok) throw new Error(created.message);
  return created.value;
}

function expectedSha256Id(partition: ChessTrainingPartition, value: ChessTrainingSource): string {
  const canonical = JSON.stringify([
    'chess-training-id-v2',
    partition.tenantId,
    partition.ownerId,
    value.projectId,
    value.projectVersionId,
    value.reviewAlgorithm,
    value.ply,
    value.color,
    value.classification,
    value.fenBefore,
    value.fenAfter,
    value.playedUci,
    value.bestUci,
    value.bestFenAfter,
  ]);
  return `chess-training_${createHash('sha256').update(canonical).digest('hex')}`;
}

describe('private Chess mistake-training library', () => {
  it('creates from authoritative provenance with a collision-resistant deterministic id', async () => {
    const { service, resolver } = fixture();
    const authoritativeSource = source();
    const created = await service.create(STUDENT_CONTEXT, createInput());

    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value).toMatchObject({
      schemaVersion: 2,
      kind: 'review-mistake-training',
      visibility: 'private',
      tenantId: STUDENT_PARTITION.tenantId,
      ownerId: STUDENT_PARTITION.ownerId,
      createdAt: CREATED_AT,
      source: authoritativeSource,
      attempts: [],
    });
    expect(created.value.id).toBe(
      deterministicChessTrainingId({ ...STUDENT_PARTITION, source: authoritativeSource }),
    );
    expect(created.value.id).toBe(expectedSha256Id(STUDENT_PARTITION, authoritativeSource));
    expect(created.value.id).toMatch(/^chess-training_[a-f0-9]{64}$/);
    expect(resolver.calls).toEqual([
      { partition: STUDENT_PARTITION, reference: sourceReference() },
    ]);
  });

  it('returns the existing current record for an exact idempotent create retry', async () => {
    const { service } = fixture();
    const created = await createRecord(service);
    const wrong = await service.recordAttempt(STUDENT_CONTEXT, {
      trainingItemId: created.id,
      operationId: 'operation:create-retry-history',
      occurredAt: ATTEMPT_1_AT,
      moveUci: 'g1f3',
      hintsUsed: 0,
    });
    expect(wrong.ok).toBe(true);

    const retried = await service.create(STUDENT_CONTEXT, createInput());
    expect(retried.ok).toBe(true);
    if (!retried.ok) return;
    expect(retried.value.id).toBe(created.id);
    expect(retried.value.attempts).toHaveLength(1);
  });

  it('denies every operation before source resolver or repository I/O', async () => {
    const { repository, resolver, service } = fixture();
    const createSpy = vi.spyOn(repository, 'create');
    const listSpy = vi.spyOn(repository, 'list');
    const loadSpy = vi.spyOn(repository, 'load');
    const appendSpy = vi.spyOn(repository, 'appendAttempt');

    await expect(service.create(DENIED_CONTEXT, createInput())).resolves.toMatchObject({
      ok: false,
      code: 'forbidden',
    });
    await expect(service.list(DENIED_CONTEXT)).resolves.toMatchObject({
      ok: false,
      code: 'forbidden',
    });
    await expect(service.load(DENIED_CONTEXT, 'chess-training_denied')).resolves.toMatchObject({
      ok: false,
      code: 'forbidden',
    });
    await expect(
      service.recordAttempt(DENIED_CONTEXT, {
        trainingItemId: 'chess-training_denied',
        operationId: 'operation:denied',
        occurredAt: ATTEMPT_1_AT,
        moveUci: 'g1f3',
        hintsUsed: 0,
      }),
    ).resolves.toMatchObject({ ok: false, code: 'forbidden' });

    expect(resolver.calls).toHaveLength(0);
    expect(createSpy).not.toHaveBeenCalled();
    expect(listSpy).not.toHaveBeenCalled();
    expect(loadSpy).not.toHaveBeenCalled();
    expect(appendSpy).not.toHaveBeenCalled();
  });

  it('derives private partitions from authorization and isolates owners', async () => {
    const entries = [
      { partition: STUDENT_PARTITION, source: source() },
      { partition: OTHER_PARTITION, source: source() },
    ];
    const { service } = fixture(entries);
    const student = await createRecord(service);
    const other = await createRecord(service, OTHER_CONTEXT);

    await expect(service.list(STUDENT_CONTEXT)).resolves.toMatchObject({
      ok: true,
      value: [{ id: student.id, ownerId: STUDENT_PARTITION.ownerId }],
    });
    await expect(service.list(OTHER_CONTEXT)).resolves.toMatchObject({
      ok: true,
      value: [{ id: other.id, ownerId: OTHER_PARTITION.ownerId }],
    });
    await expect(service.load(STUDENT_CONTEXT, other.id)).resolves.toMatchObject({
      ok: false,
      code: 'not_found',
    });
  });

  it('rejects foreign and forged project versions before repository create', async () => {
    const { repository, resolver, service } = fixture([
      { partition: OTHER_PARTITION, source: source('version-foreign') },
    ]);
    const createSpy = vi.spyOn(repository, 'create');

    await expect(
      service.create(STUDENT_CONTEXT, createInput('version-foreign')),
    ).resolves.toMatchObject({ ok: false, code: 'not_found' });
    await expect(
      service.create(STUDENT_CONTEXT, createInput('version-forged')),
    ).resolves.toMatchObject({ ok: false, code: 'not_found' });
    expect(resolver.calls).toHaveLength(2);
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('rejects a resolver response that does not match the requested immutable version', async () => {
    const repository = new MemoryChessTrainingLibraryRepository();
    const resolver: ChessTrainingSourceResolverPort = {
      async resolve() {
        return source('version-authoritative');
      },
    };
    const service = new ChessTrainingLibraryService(repository, new TestAuthorization(), resolver);
    const createSpy = vi.spyOn(repository, 'create');

    await expect(
      service.create(STUDENT_CONTEXT, createInput('version-forged')),
    ).resolves.toMatchObject({ ok: false, code: 'invalid' });
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('stores an honest wrong-move position separately from the reset root', async () => {
    const { service } = fixture();
    const created = await createRecord(service);
    const wrong = await service.recordAttempt(STUDENT_CONTEXT, {
      trainingItemId: created.id,
      operationId: 'operation:wrong-position',
      occurredAt: ATTEMPT_1_AT,
      moveUci: 'g1f3',
      hintsUsed: 2,
    });

    expect(wrong).toMatchObject({
      ok: true,
      value: {
        attempts: [
          {
            operationId: 'operation:wrong-position',
            sequence: 1,
            outcome: 'incorrect',
            positionAfterMoveFen: fenAfter('g1f3'),
            resetFen: START_FEN,
            hints: [{ level: 1 }, { level: 2 }],
          },
        ],
      },
    });
    if (!wrong.ok) return;
    expect(wrong.value.attempts[0]).not.toHaveProperty('resultFen');
  });

  it('deduplicates sequential retries and rejects operationId reuse with different input', async () => {
    const { service } = fixture();
    const created = await createRecord(service);
    const request = {
      trainingItemId: created.id,
      operationId: 'operation:sequential-retry',
      occurredAt: ATTEMPT_1_AT,
      moveUci: 'g1f3',
      hintsUsed: 1,
    } as const;

    const first = await service.recordAttempt(STUDENT_CONTEXT, request);
    const retry = await service.recordAttempt(STUDENT_CONTEXT, request);
    expect(first.ok && retry.ok).toBe(true);
    if (!first.ok || !retry.ok) return;
    expect(retry.value).toEqual(first.value);
    expect(retry.value.attempts).toHaveLength(1);
    await expect(
      service.recordAttempt(STUDENT_CONTEXT, { ...request, moveUci: 'b1c3' }),
    ).resolves.toMatchObject({ ok: false, code: 'conflict' });
    await expect(service.load(STUDENT_CONTEXT, created.id)).resolves.toMatchObject({
      ok: true,
      value: { attempts: [{ operationId: request.operationId }] },
    });
  });

  it('atomically returns the same result for concurrent retries', async () => {
    const { service } = fixture();
    const created = await createRecord(service);
    const request = {
      trainingItemId: created.id,
      operationId: 'operation:concurrent-retry',
      occurredAt: ATTEMPT_1_AT,
      moveUci: 'g1f3',
      hintsUsed: 0,
    } as const;

    const [left, right] = await Promise.all([
      service.recordAttempt(STUDENT_CONTEXT, request),
      service.recordAttempt(STUDENT_CONTEXT, request),
    ]);
    expect(left.ok && right.ok).toBe(true);
    if (!left.ok || !right.ok) return;
    expect(left.value).toEqual(right.value);
    expect(left.value.attempts).toHaveLength(1);
    const loaded = await service.load(STUDENT_CONTEXT, created.id);
    expect(loaded.ok && loaded.value.attempts).toHaveLength(1);
  });

  it('keeps immutable history and lets an exact solved-operation retry succeed', async () => {
    const { service } = fixture();
    const created = await createRecord(service);
    const wrong = await service.recordAttempt(STUDENT_CONTEXT, {
      trainingItemId: created.id,
      operationId: 'operation:wrong-before-solved',
      occurredAt: ATTEMPT_1_AT,
      moveUci: 'g1f3',
      hintsUsed: 2,
    });
    expect(wrong.ok).toBe(true);
    if (!wrong.ok) return;
    const firstSnapshot = structuredClone(wrong.value.attempts[0]);
    const solveRequest = {
      trainingItemId: created.id,
      operationId: 'operation:solved',
      occurredAt: ATTEMPT_2_AT,
      moveUci: 'd2d4',
      hintsUsed: 3,
    } as const;

    const solved = await service.recordAttempt(STUDENT_CONTEXT, solveRequest);
    expect(solved).toMatchObject({
      ok: true,
      value: {
        attempts: [
          firstSnapshot,
          {
            operationId: 'operation:solved',
            sequence: 2,
            outcome: 'solved',
            positionAfterMoveFen: created.source.bestFenAfter,
            resetFen: null,
          },
        ],
      },
    });
    expect(created.attempts).toEqual([]);
    expect(wrong.value.attempts).toHaveLength(1);
    expect(Object.isFrozen(wrong.value)).toBe(true);
    expect(Object.isFrozen(wrong.value.source)).toBe(true);
    expect(Object.isFrozen(wrong.value.attempts)).toBe(true);
    expect(Object.isFrozen(wrong.value.attempts[0]?.hints)).toBe(true);
    expect(() => {
      (wrong.value.attempts[0] as { outcome: string }).outcome = 'solved';
    }).toThrow(TypeError);
    const retriedSolved = await service.recordAttempt(STUDENT_CONTEXT, solveRequest);
    expect(retriedSolved).toEqual(solved);
    await expect(
      service.recordAttempt(STUDENT_CONTEXT, {
        ...solveRequest,
        operationId: 'operation:after-solved',
        occurredAt: ATTEMPT_3_AT,
      }),
    ).resolves.toMatchObject({ ok: false, code: 'finished' });
  });

  it('rejects timestamps before creation and timestamps that move history backwards', async () => {
    const { service } = fixture();
    const created = await createRecord(service);
    await expect(
      service.recordAttempt(STUDENT_CONTEXT, {
        trainingItemId: created.id,
        operationId: 'operation:before-create',
        occurredAt: '2026-08-11T23:59:59.999Z',
        moveUci: 'g1f3',
        hintsUsed: 0,
      }),
    ).resolves.toMatchObject({ ok: false, code: 'invalid' });

    await service.recordAttempt(STUDENT_CONTEXT, {
      trainingItemId: created.id,
      operationId: 'operation:later-first',
      occurredAt: ATTEMPT_2_AT,
      moveUci: 'g1f3',
      hintsUsed: 0,
    });
    await expect(
      service.recordAttempt(STUDENT_CONTEXT, {
        trainingItemId: created.id,
        operationId: 'operation:earlier-second',
        occurredAt: ATTEMPT_1_AT,
        moveUci: 'b1c3',
        hintsUsed: 0,
      }),
    ).resolves.toMatchObject({ ok: false, code: 'invalid' });
    const loaded = await service.load(STUDENT_CONTEXT, created.id);
    expect(loaded.ok && loaded.value.attempts).toHaveLength(1);
  });

  it('round-trips strict frozen JSON and rejects tampered history chronology', async () => {
    const { service } = fixture();
    const created = await createRecord(service);
    await service.recordAttempt(STUDENT_CONTEXT, {
      trainingItemId: created.id,
      operationId: 'operation:json-first',
      occurredAt: ATTEMPT_1_AT,
      moveUci: 'g1f3',
      hintsUsed: 0,
    });
    await service.recordAttempt(STUDENT_CONTEXT, {
      trainingItemId: created.id,
      operationId: 'operation:json-second',
      occurredAt: ATTEMPT_2_AT,
      moveUci: 'b1c3',
      hintsUsed: 0,
    });
    const loaded = await service.load(STUDENT_CONTEXT, created.id);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const serialized = serializePrivateChessTrainingRecord(loaded.value);
    expect(serialized.ok).toBe(true);
    if (!serialized.ok) return;
    const roundTripped = deserializePrivateChessTrainingRecord(serialized.value);
    expect(roundTripped).toEqual(loaded);
    expect(roundTripped.ok && Object.isFrozen(roundTripped.value.attempts[0])).toBe(true);
    expect(deserializePrivateChessTrainingRecord('{bad json')).toMatchObject({ ok: false });

    const missingVersion = structuredClone(loaded.value) as unknown as Record<string, unknown>;
    delete (missingVersion['source'] as Record<string, unknown>)['projectVersionId'];
    expect(deserializePrivateChessTrainingRecord(JSON.stringify(missingVersion))).toMatchObject({
      ok: false,
    });
    const extraField = { ...loaded.value, public: true };
    expect(deserializePrivateChessTrainingRecord(JSON.stringify(extraField))).toMatchObject({
      ok: false,
    });
    const backwards = structuredClone(loaded.value);
    (backwards.attempts[1] as { occurredAt: string }).occurredAt = '2026-08-12T00:00:30.000Z';
    expect(deserializePrivateChessTrainingRecord(JSON.stringify(backwards))).toMatchObject({
      ok: false,
    });
    const duplicateOperation = structuredClone(loaded.value);
    (duplicateOperation.attempts[1] as { operationId: string }).operationId =
      duplicateOperation.attempts[0]!.operationId;
    expect(deserializePrivateChessTrainingRecord(JSON.stringify(duplicateOperation))).toMatchObject(
      { ok: false },
    );
    const dishonestPosition = structuredClone(loaded.value);
    (dishonestPosition.attempts[0] as { positionAfterMoveFen: string }).positionAfterMoveFen =
      START_FEN;
    expect(deserializePrivateChessTrainingRecord(JSON.stringify(dishonestPosition))).toMatchObject({
      ok: false,
    });
  });

  it('surfaces a deterministic-id collision separately from an idempotent create', async () => {
    const collisionRepository: ChessTrainingLibraryRepositoryPort = {
      async create() {
        return { status: 'id_collision' };
      },
      async list() {
        return [];
      },
      async load() {
        return null;
      },
      async appendAttempt() {
        return { status: 'not_found' };
      },
    };
    const service = new ChessTrainingLibraryService(
      collisionRepository,
      new TestAuthorization(),
      new TestSourceResolver([{ partition: STUDENT_PARTITION, source: source() }]),
    );
    await expect(service.create(STUDENT_CONTEXT, createInput())).resolves.toMatchObject({
      ok: false,
      code: 'id_collision',
    });
  });

  it('lists deterministic ids in byte order regardless of insertion order', async () => {
    const entries = [
      { partition: STUDENT_PARTITION, source: source('version-z') },
      { partition: STUDENT_PARTITION, source: source('version-a') },
    ];
    const { service } = fixture(entries);
    await service.create(STUDENT_CONTEXT, createInput('version-z'));
    await service.create(STUDENT_CONTEXT, createInput('version-a'));
    const listed = await service.list(STUDENT_CONTEXT);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(Object.isFrozen(listed.value)).toBe(true);
    expect(listed.value.map((record) => record.id)).toEqual(
      [...listed.value.map((record) => record.id)].sort(),
    );
  });
});
