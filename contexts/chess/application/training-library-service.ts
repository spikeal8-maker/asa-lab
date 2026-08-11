import { findLegalMoveByUci, parseFen } from '../domain/chess.js';
import {
  deterministicChessTrainingAttemptId,
  deterministicChessTrainingId,
  isCanonicalTrainingTimestamp,
  isSafeTrainingPartitionId,
  validatePrivateChessTrainingRecord,
  type ChessTrainingAttempt,
  type ChessTrainingHintLevel,
  type ChessTrainingSource,
  type PrivateChessTrainingRecord,
} from './training-library-model.js';
import type {
  ChessTrainingLibraryRepositoryPort,
  ChessTrainingPartition,
} from './training-library-repository.js';

export type ChessTrainingLibraryErrorCode = 'invalid' | 'not_found' | 'conflict' | 'finished';

export type ChessTrainingLibraryResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly code: ChessTrainingLibraryErrorCode;
      readonly message: string;
    };

export interface CreateChessTrainingInput extends ChessTrainingPartition {
  readonly createdAt: string;
  readonly source: ChessTrainingSource;
}

export interface RecordChessTrainingAttemptInput extends ChessTrainingPartition {
  readonly trainingItemId: string;
  readonly occurredAt: string;
  readonly moveUci: string;
  readonly hintsUsed: 0 | 1 | 2 | 3;
}

function invalid(message: string): ChessTrainingLibraryResult<never> {
  return { ok: false, code: 'invalid', message };
}

function validatePartition(partition: ChessTrainingPartition): ChessTrainingLibraryResult<true> {
  if (
    !isSafeTrainingPartitionId(partition.tenantId) ||
    !isSafeTrainingPartitionId(partition.ownerId)
  ) {
    return invalid('Training tenantId and ownerId must be safe and non-empty.');
  }
  return { ok: true, value: true };
}

function hints(count: 0 | 1 | 2 | 3): readonly { readonly level: ChessTrainingHintLevel }[] {
  return Array.from({ length: count }, (_, index) => ({
    level: (index + 1) as ChessTrainingHintLevel,
  }));
}

export class ChessTrainingLibraryService {
  constructor(private readonly repository: ChessTrainingLibraryRepositoryPort) {}

  async create(
    input: CreateChessTrainingInput,
  ): Promise<ChessTrainingLibraryResult<PrivateChessTrainingRecord>> {
    const partition = validatePartition(input);
    if (!partition.ok) return partition;
    const record: PrivateChessTrainingRecord = {
      schemaVersion: 1,
      kind: 'review-mistake-training',
      visibility: 'private',
      id: deterministicChessTrainingId(input),
      tenantId: input.tenantId,
      ownerId: input.ownerId,
      createdAt: input.createdAt,
      source: input.source,
      attempts: [],
    };
    const validated = validatePrivateChessTrainingRecord(record);
    if (!validated.ok) return invalid(validated.message);
    const created = await this.repository.create(validated.value);
    if (created === 'exists') {
      return {
        ok: false,
        code: 'conflict',
        message: 'A private training item already exists for this reviewed position.',
      };
    }
    return { ok: true, value: validated.value };
  }

  async list(
    partition: ChessTrainingPartition,
  ): Promise<ChessTrainingLibraryResult<readonly PrivateChessTrainingRecord[]>> {
    const checked = validatePartition(partition);
    if (!checked.ok) return checked;
    return { ok: true, value: await this.repository.list(partition) };
  }

  async load(
    partition: ChessTrainingPartition,
    trainingItemId: string,
  ): Promise<ChessTrainingLibraryResult<PrivateChessTrainingRecord>> {
    const checked = validatePartition(partition);
    if (!checked.ok) return checked;
    if (!isSafeTrainingPartitionId(trainingItemId)) return invalid('Training item id is invalid.');
    const record = await this.repository.load(partition, trainingItemId);
    return record
      ? { ok: true, value: record }
      : { ok: false, code: 'not_found', message: 'Private training item was not found.' };
  }

  async recordAttempt(
    input: RecordChessTrainingAttemptInput,
  ): Promise<ChessTrainingLibraryResult<PrivateChessTrainingRecord>> {
    const loaded = await this.load(input, input.trainingItemId);
    if (!loaded.ok) return loaded;
    if (!isCanonicalTrainingTimestamp(input.occurredAt)) {
      return invalid('Training attempt occurredAt is invalid.');
    }
    if (loaded.value.attempts.some((attempt) => attempt.outcome === 'solved')) {
      return {
        ok: false,
        code: 'finished',
        message: 'The private training item is already solved.',
      };
    }
    const root = parseFen(loaded.value.source.fenBefore);
    if (!root.ok) return invalid(root.message);
    const move = findLegalMoveByUci(root.value, input.moveUci);
    if (!move) return invalid('Training attempt move must be legal at the reviewed root.');
    const sequence = loaded.value.attempts.length + 1;
    const outcome = input.moveUci === loaded.value.source.bestUci ? 'solved' : 'incorrect';
    const attempt: ChessTrainingAttempt = {
      id: deterministicChessTrainingAttemptId(loaded.value.id, sequence),
      trainingItemId: loaded.value.id,
      sequence,
      occurredAt: input.occurredAt,
      moveUci: input.moveUci,
      outcome,
      resultFen:
        outcome === 'solved' ? loaded.value.source.bestFenAfter : loaded.value.source.fenBefore,
      hints: hints(input.hintsUsed),
    };
    const next: PrivateChessTrainingRecord = {
      ...loaded.value,
      attempts: [...loaded.value.attempts, attempt],
    };
    const validated = validatePrivateChessTrainingRecord(next);
    if (!validated.ok) return invalid(validated.message);
    const saved = await this.repository.appendAttempt({
      partition: input,
      trainingItemId: input.trainingItemId,
      expectedAttemptCount: loaded.value.attempts.length,
      attempt,
    });
    if (saved === 'not_found') {
      return { ok: false, code: 'not_found', message: 'Private training item was not found.' };
    }
    if (saved === 'conflict') {
      return { ok: false, code: 'conflict', message: 'Training attempt history changed.' };
    }
    if (saved === 'invalid') return invalid('Training attempt was rejected by the repository.');
    return { ok: true, value: validated.value };
  }
}
