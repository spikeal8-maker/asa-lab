import type { ChessTrainingAttempt, PrivateChessTrainingRecord } from './training-library-model.js';

export interface ChessTrainingPartition {
  readonly tenantId: string;
  readonly ownerId: string;
}

export type ChessTrainingCreateResult = 'created' | 'exists';
export type ChessTrainingAppendResult = 'saved' | 'not_found' | 'conflict' | 'invalid';

export interface ChessTrainingLibraryRepositoryPort {
  create(record: PrivateChessTrainingRecord): Promise<ChessTrainingCreateResult>;
  list(partition: ChessTrainingPartition): Promise<readonly PrivateChessTrainingRecord[]>;
  load(
    partition: ChessTrainingPartition,
    trainingItemId: string,
  ): Promise<PrivateChessTrainingRecord | null>;
  appendAttempt(input: {
    readonly partition: ChessTrainingPartition;
    readonly trainingItemId: string;
    readonly expectedAttemptCount: number;
    readonly attempt: ChessTrainingAttempt;
  }): Promise<ChessTrainingAppendResult>;
}
