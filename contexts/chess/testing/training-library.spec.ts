import { describe, expect, it } from 'vitest';
import { applyLegalMove, parseFen, START_FEN, toFen } from '../domain/chess';
import {
  deserializePrivateChessTrainingRecord,
  deterministicChessTrainingId,
  serializePrivateChessTrainingRecord,
  type ChessTrainingSource,
} from '../application/training-library-model';
import { ChessTrainingLibraryService } from '../application/training-library-service';
import { MemoryChessTrainingLibraryRepository } from '../infrastructure/memory-training-library-repository';

const CREATED_AT = '2026-08-12T00:00:00.000Z';
const ATTEMPT_1_AT = '2026-08-12T00:01:00.000Z';
const ATTEMPT_2_AT = '2026-08-12T00:02:00.000Z';

function fenAfter(uci: string): string {
  const root = parseFen(START_FEN);
  if (!root.ok) throw new Error(root.message);
  const applied = applyLegalMove(root.value, uci);
  if (!applied.ok) throw new Error(applied.message);
  return toFen(applied.value.position);
}

function source(projectVersionId = 'version-1'): ChessTrainingSource {
  return {
    projectId: 'project-1',
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

function createInput(projectVersionId = 'version-1') {
  return {
    tenantId: 'tenant:school-1',
    ownerId: 'user:student-1',
    createdAt: CREATED_AT,
    source: source(projectVersionId),
  } as const;
}

describe('private Chess mistake-training library', () => {
  it('creates deterministic partitioned records with exact immutable provenance', async () => {
    const repository = new MemoryChessTrainingLibraryRepository();
    const service = new ChessTrainingLibraryService(repository);
    const input = createInput();
    const originalSource = structuredClone(input.source);
    const created = await service.create(input);

    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value).toMatchObject({
      schemaVersion: 1,
      kind: 'review-mistake-training',
      visibility: 'private',
      tenantId: input.tenantId,
      ownerId: input.ownerId,
      createdAt: CREATED_AT,
      source: {
        projectId: 'project-1',
        projectVersionId: 'version-1',
        reviewAlgorithm: 'asa-review-v1',
        ply: 1,
        fenBefore: START_FEN,
        playedUci: 'e2e4',
        bestUci: 'd2d4',
      },
      attempts: [],
    });
    expect(created.value.id).toBe(deterministicChessTrainingId(input));
    expect(input.source).toEqual(originalSource);

    const sameOnFreshRepository = await new ChessTrainingLibraryService(
      new MemoryChessTrainingLibraryRepository(),
    ).create(input);
    expect(sameOnFreshRepository.ok && sameOnFreshRepository.value.id).toBe(created.value.id);
    await expect(service.create(input)).resolves.toMatchObject({ ok: false, code: 'conflict' });
  });

  it('isolates list and load by both tenant and owner partitions', async () => {
    const service = new ChessTrainingLibraryService(new MemoryChessTrainingLibraryRepository());
    const created = await service.create(createInput());
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await expect(
      service.list({ tenantId: 'tenant:school-1', ownerId: 'user:student-1' }),
    ).resolves.toMatchObject({ ok: true, value: [{ id: created.value.id }] });
    await expect(
      service.list({ tenantId: 'tenant:school-2', ownerId: 'user:student-1' }),
    ).resolves.toEqual({ ok: true, value: [] });
    await expect(
      service.list({ tenantId: 'tenant:school-1', ownerId: 'user:student-2' }),
    ).resolves.toEqual({ ok: true, value: [] });
    await expect(
      service.load({ tenantId: 'tenant:school-2', ownerId: 'user:student-1' }, created.value.id),
    ).resolves.toMatchObject({ ok: false, code: 'not_found' });
  });

  it('appends immutable attempts, hints and derived outcomes without changing history', async () => {
    const repository = new MemoryChessTrainingLibraryRepository();
    const service = new ChessTrainingLibraryService(repository);
    const created = await service.create(createInput());
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const wrong = await service.recordAttempt({
      tenantId: created.value.tenantId,
      ownerId: created.value.ownerId,
      trainingItemId: created.value.id,
      occurredAt: ATTEMPT_1_AT,
      moveUci: 'g1f3',
      hintsUsed: 2,
    });
    expect(wrong).toMatchObject({
      ok: true,
      value: {
        attempts: [
          {
            sequence: 1,
            outcome: 'incorrect',
            resultFen: START_FEN,
            hints: [{ level: 1 }, { level: 2 }],
          },
        ],
      },
    });
    if (!wrong.ok) return;
    const firstSnapshot = structuredClone(wrong.value.attempts[0]);

    const solved = await service.recordAttempt({
      tenantId: created.value.tenantId,
      ownerId: created.value.ownerId,
      trainingItemId: created.value.id,
      occurredAt: ATTEMPT_2_AT,
      moveUci: 'd2d4',
      hintsUsed: 3,
    });
    expect(solved).toMatchObject({
      ok: true,
      value: {
        attempts: [
          firstSnapshot,
          {
            sequence: 2,
            outcome: 'solved',
            resultFen: created.value.source.bestFenAfter,
            hints: [{ level: 1 }, { level: 2 }, { level: 3 }],
          },
        ],
      },
    });
    expect(created.value.attempts).toEqual([]);
    expect(wrong.value.attempts).toHaveLength(1);
    expect(wrong.value.attempts[0]).toEqual(firstSnapshot);
    expect(Object.isFrozen(wrong.value)).toBe(true);
    expect(Object.isFrozen(wrong.value.attempts)).toBe(true);
    expect(Object.isFrozen(wrong.value.attempts[0]?.hints)).toBe(true);
    expect(() => {
      (wrong.value.attempts[0] as { outcome: string }).outcome = 'solved';
    }).toThrow(TypeError);
    const loaded = await service.load(created.value, created.value.id);
    expect(loaded.ok && loaded.value.attempts[0]?.outcome).toBe('incorrect');
    await expect(
      service.recordAttempt({
        tenantId: created.value.tenantId,
        ownerId: created.value.ownerId,
        trainingItemId: created.value.id,
        occurredAt: '2026-08-12T00:03:00.000Z',
        moveUci: 'd2d4',
        hintsUsed: 0,
      }),
    ).resolves.toMatchObject({ ok: false, code: 'finished' });
  });

  it('rejects invalid, foreign and cross-item attempt updates', async () => {
    const repository = new MemoryChessTrainingLibraryRepository();
    const service = new ChessTrainingLibraryService(repository);
    const first = await service.create(createInput('version-1'));
    const second = await service.create(createInput('version-2'));
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    await expect(
      service.recordAttempt({
        tenantId: first.value.tenantId,
        ownerId: first.value.ownerId,
        trainingItemId: 'chess-training_0000000000000000',
        occurredAt: ATTEMPT_1_AT,
        moveUci: 'g1f3',
        hintsUsed: 0,
      }),
    ).resolves.toMatchObject({ ok: false, code: 'not_found' });
    await expect(
      service.recordAttempt({
        tenantId: 'tenant:school-2',
        ownerId: first.value.ownerId,
        trainingItemId: first.value.id,
        occurredAt: ATTEMPT_1_AT,
        moveUci: 'g1f3',
        hintsUsed: 0,
      }),
    ).resolves.toMatchObject({ ok: false, code: 'not_found' });
    await expect(
      service.recordAttempt({
        tenantId: first.value.tenantId,
        ownerId: first.value.ownerId,
        trainingItemId: first.value.id,
        occurredAt: ATTEMPT_1_AT,
        moveUci: 'e2e5',
        hintsUsed: 0,
      }),
    ).resolves.toMatchObject({ ok: false, code: 'invalid' });

    const firstAttempt = await service.recordAttempt({
      tenantId: first.value.tenantId,
      ownerId: first.value.ownerId,
      trainingItemId: first.value.id,
      occurredAt: ATTEMPT_1_AT,
      moveUci: 'g1f3',
      hintsUsed: 0,
    });
    expect(firstAttempt.ok).toBe(true);
    if (!firstAttempt.ok) return;
    await expect(
      repository.appendAttempt({
        partition: second.value,
        trainingItemId: second.value.id,
        expectedAttemptCount: 0,
        attempt: firstAttempt.value.attempts[0]!,
      }),
    ).resolves.toBe('invalid');
  });

  it('round-trips strict JSON and rejects missing provenance or tampered history', async () => {
    const service = new ChessTrainingLibraryService(new MemoryChessTrainingLibraryRepository());
    const created = await service.create(createInput());
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const serialized = serializePrivateChessTrainingRecord(created.value);
    expect(serialized.ok).toBe(true);
    if (!serialized.ok) return;
    expect(deserializePrivateChessTrainingRecord(serialized.value)).toEqual(created);
    expect(deserializePrivateChessTrainingRecord('{bad json')).toMatchObject({ ok: false });

    const missingVersion = structuredClone(created.value) as unknown as Record<string, unknown>;
    delete (missingVersion['source'] as Record<string, unknown>)['projectVersionId'];
    expect(deserializePrivateChessTrainingRecord(JSON.stringify(missingVersion))).toMatchObject({
      ok: false,
    });
    const extraField = { ...created.value, public: true };
    expect(deserializePrivateChessTrainingRecord(JSON.stringify(extraField))).toMatchObject({
      ok: false,
    });
  });

  it('lists deterministic ids in byte-order regardless of insertion order', async () => {
    const service = new ChessTrainingLibraryService(new MemoryChessTrainingLibraryRepository());
    await service.create(createInput('version-z'));
    await service.create(createInput('version-a'));
    const listed = await service.list(createInput());
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value.map((record) => record.id)).toEqual(
      [...listed.value.map((record) => record.id)].sort(),
    );
  });
});
