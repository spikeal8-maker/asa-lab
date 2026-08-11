import {
  deserializePrivateChessTrainingRecord,
  serializePrivateChessTrainingRecord,
  validatePrivateChessTrainingRecord,
  type PrivateChessTrainingRecord,
} from '../application/training-library-model.js';
import type {
  ChessTrainingAppendResult,
  ChessTrainingCreateResult,
  ChessTrainingLibraryRepositoryPort,
  ChessTrainingPartition,
} from '../application/training-library-repository.js';

function partitionKey(partition: ChessTrainingPartition): string {
  return JSON.stringify([partition.tenantId, partition.ownerId]);
}

function parseStored(value: string): PrivateChessTrainingRecord {
  const parsed = deserializePrivateChessTrainingRecord(value);
  if (!parsed.ok) throw new Error(`Corrupt in-memory training record: ${parsed.message}`);
  return parsed.value;
}

function hasSameTrainingIdentity(
  left: PrivateChessTrainingRecord,
  right: PrivateChessTrainingRecord,
): boolean {
  return (
    left.id === right.id &&
    left.tenantId === right.tenantId &&
    left.ownerId === right.ownerId &&
    left.source.projectId === right.source.projectId &&
    left.source.projectVersionId === right.source.projectVersionId &&
    left.source.reviewAlgorithm === right.source.reviewAlgorithm &&
    left.source.ply === right.source.ply &&
    left.source.color === right.source.color &&
    left.source.classification === right.source.classification &&
    left.source.fenBefore === right.source.fenBefore &&
    left.source.fenAfter === right.source.fenAfter &&
    left.source.playedUci === right.source.playedUci &&
    left.source.bestUci === right.source.bestUci &&
    left.source.bestFenAfter === right.source.bestFenAfter
  );
}

function isSameAttempt(
  left: PrivateChessTrainingRecord['attempts'][number],
  right: PrivateChessTrainingRecord['attempts'][number],
): boolean {
  return (
    left.id === right.id &&
    left.trainingItemId === right.trainingItemId &&
    left.operationId === right.operationId &&
    left.sequence === right.sequence &&
    left.occurredAt === right.occurredAt &&
    left.moveUci === right.moveUci &&
    left.outcome === right.outcome &&
    left.positionAfterMoveFen === right.positionAfterMoveFen &&
    left.resetFen === right.resetFen &&
    left.hints.length === right.hints.length &&
    left.hints.every((hint, index) => hint.level === right.hints[index]?.level)
  );
}

export class MemoryChessTrainingLibraryRepository implements ChessTrainingLibraryRepositoryPort {
  private readonly partitions = new Map<string, Map<string, string>>();

  async create(record: PrivateChessTrainingRecord): Promise<ChessTrainingCreateResult> {
    const validated = validatePrivateChessTrainingRecord(record);
    if (!validated.ok) throw new Error(validated.message);
    const key = partitionKey(record);
    const partition = this.partitions.get(key) ?? new Map<string, string>();
    const stored = partition.get(record.id);
    if (stored) {
      const existing = parseStored(stored);
      return hasSameTrainingIdentity(existing, validated.value)
        ? { status: 'existing', record: existing }
        : { status: 'id_collision' };
    }
    const serialized = serializePrivateChessTrainingRecord(validated.value);
    if (!serialized.ok) throw new Error(serialized.message);
    partition.set(record.id, serialized.value);
    this.partitions.set(key, partition);
    return { status: 'created', record: parseStored(serialized.value) };
  }

  async list(partition: ChessTrainingPartition): Promise<readonly PrivateChessTrainingRecord[]> {
    return [...(this.partitions.get(partitionKey(partition))?.values() ?? [])]
      .map(parseStored)
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  }

  async load(
    partition: ChessTrainingPartition,
    trainingItemId: string,
  ): Promise<PrivateChessTrainingRecord | null> {
    const value = this.partitions.get(partitionKey(partition))?.get(trainingItemId);
    return value ? parseStored(value) : null;
  }

  async appendAttempt(
    input: Parameters<ChessTrainingLibraryRepositoryPort['appendAttempt']>[0],
  ): Promise<ChessTrainingAppendResult> {
    const partition = this.partitions.get(partitionKey(input.partition));
    const stored = partition?.get(input.trainingItemId);
    if (!partition || !stored) return { status: 'not_found' };
    const record = parseStored(stored);
    const existingAttempt = record.attempts.find(
      (attempt) => attempt.operationId === input.attempt.operationId,
    );
    if (existingAttempt) {
      return isSameAttempt(existingAttempt, input.attempt)
        ? { status: 'existing', record }
        : { status: 'conflict' };
    }
    if (record.attempts.length !== input.expectedAttemptCount) return { status: 'conflict' };
    if (
      input.attempt.trainingItemId !== record.id ||
      input.attempt.sequence !== record.attempts.length + 1
    ) {
      return { status: 'invalid' };
    }
    const next: PrivateChessTrainingRecord = {
      ...record,
      attempts: [...record.attempts, input.attempt],
    };
    const serialized = serializePrivateChessTrainingRecord(next);
    if (!serialized.ok) return { status: 'invalid' };
    partition.set(record.id, serialized.value);
    return { status: 'saved', record: parseStored(serialized.value) };
  }
}
