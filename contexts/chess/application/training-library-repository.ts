import type { ChessTrainingAttempt, PrivateChessTrainingRecord } from './training-library-model.js';

export interface ChessTrainingPartition {
  readonly tenantId: string;
  readonly ownerId: string;
}

export type ChessTrainingCreateResult =
  | {
      readonly status: 'created' | 'existing';
      readonly record: PrivateChessTrainingRecord;
    }
  | { readonly status: 'id_collision' };

export type ChessTrainingAppendResult =
  | { readonly status: 'saved'; readonly record: PrivateChessTrainingRecord }
  | { readonly status: 'existing'; readonly record: PrivateChessTrainingRecord }
  | { readonly status: 'not_found' }
  | { readonly status: 'conflict' }
  | { readonly status: 'invalid' };

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
