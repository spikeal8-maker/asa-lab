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

export class MemoryChessTrainingLibraryRepository implements ChessTrainingLibraryRepositoryPort {
  private readonly partitions = new Map<string, Map<string, string>>();

  async create(record: PrivateChessTrainingRecord): Promise<ChessTrainingCreateResult> {
    const validated = validatePrivateChessTrainingRecord(record);
    if (!validated.ok) throw new Error(validated.message);
    const key = partitionKey(record);
    const partition = this.partitions.get(key) ?? new Map<string, string>();
    if (partition.has(record.id)) return 'exists';
    const serialized = serializePrivateChessTrainingRecord(validated.value);
    if (!serialized.ok) throw new Error(serialized.message);
    partition.set(record.id, serialized.value);
    this.partitions.set(key, partition);
    return 'created';
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
    if (!partition || !stored) return 'not_found';
    const record = parseStored(stored);
    if (record.attempts.length !== input.expectedAttemptCount) return 'conflict';
    if (
      input.attempt.trainingItemId !== record.id ||
      input.attempt.sequence !== record.attempts.length + 1
    ) {
      return 'invalid';
    }
    const next: PrivateChessTrainingRecord = {
      ...record,
      attempts: [...record.attempts, input.attempt],
    };
    const serialized = serializePrivateChessTrainingRecord(next);
    if (!serialized.ok) return 'invalid';
    partition.set(record.id, serialized.value);
    return 'saved';
  }
}
