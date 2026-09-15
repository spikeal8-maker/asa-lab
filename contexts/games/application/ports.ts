import type {
  GameMatchId,
  GameMatchParticipantV1,
  GameMatchTeamV1,
  GameMatchV1,
  GamePlayerId,
} from '../domain/model.js';
import type { GamesCommandReceiptV1 } from './command.js';

export interface AuthenticatedGamesSubject {
  readonly sourceKind: 'account' | 'student_seat';
  readonly sourceId: string;
  readonly verifiedAccountId: string | null;
  readonly auditId: string;
}

export interface GamePlayerPublicV1 {
  readonly playerId: GamePlayerId;
  readonly displayAlias: string;
  readonly avatarRef: string | null;
}

export interface ResolvedGamingSubjectV1 {
  readonly gamePlayerId: GamePlayerId;
  readonly publicProfile: GamePlayerPublicV1;
}

export interface GamingSubjectResolverPort {
  resolve(subject: AuthenticatedGamesSubject): Promise<ResolvedGamingSubjectV1>;
}

export interface GamesRequestContextV1 {
  readonly gamePlayerId: GamePlayerId;
  readonly auditId: string;
}

export type GamesWriteResult =
  | { readonly ok: true; readonly replayed: boolean }
  | { readonly ok: false; readonly reason: 'conflict' | 'duplicate' | 'forbidden' };

export interface CreateGameMatchFoundationInput {
  readonly match: GameMatchV1;
  readonly participants: readonly GameMatchParticipantV1[];
  readonly teams: readonly GameMatchTeamV1[];
  readonly receipt: GamesCommandReceiptV1;
}

export interface SaveGameMatchLifecycleInput {
  readonly match: GameMatchV1;
  readonly expectedLifecycleVersion: number;
  readonly receipt: GamesCommandReceiptV1;
}

export interface GamesRepositoryTransactionPort {
  findCommandReceipt(commandId: string): Promise<GamesCommandReceiptV1 | null>;
  getMatch(matchId: GameMatchId): Promise<GameMatchV1 | null>;
  listParticipants(matchId: GameMatchId): Promise<readonly GameMatchParticipantV1[]>;
  listTeams(matchId: GameMatchId): Promise<readonly GameMatchTeamV1[]>;
  createMatchFoundation(input: CreateGameMatchFoundationInput): Promise<GamesWriteResult>;
  saveMatchLifecycle(input: SaveGameMatchLifecycleInput): Promise<GamesWriteResult>;
}

export interface GamesRepositoryPort {
  withRequestContext<T>(
    context: GamesRequestContextV1,
    operation: (transaction: GamesRepositoryTransactionPort) => Promise<T>,
  ): Promise<T>;
}
