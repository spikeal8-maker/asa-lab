import type { ChessResult, ChessTermination, Color } from '@asa-lab/chess';

export type ChallengeStatus = 'open' | 'accepted' | 'cancelled' | 'expired';
export type ColorPreference = Color | 'random';
export type LiveGameStatus = 'active' | 'finished';
export type DrawOfferState = { readonly offeredBy: string; readonly offeredAtMs: number } | null;
export type LiveChessErrorCode =
  | 'validation_error'
  | 'not_found'
  | 'forbidden'
  | 'conflict'
  | 'expired'
  | 'illegal_move'
  | 'game_finished'
  | 'not_your_turn'
  | 'clock_expired'
  | 'idempotency_conflict';

export type LiveChessResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: LiveChessErrorCode; readonly message: string };

export interface LiveTimeControl {
  readonly initialMs: number;
  readonly incrementMs: number;
}

export interface LiveChessChallenge {
  readonly id: string;
  readonly publicCode: string;
  readonly tenantId: string;
  readonly creatorId: string;
  readonly colorPreference: ColorPreference;
  readonly timeControl: LiveTimeControl;
  readonly rated: boolean;
  readonly status: ChallengeStatus;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
  readonly acceptedById: string | null;
  readonly acceptedAtMs: number | null;
  readonly gameId: string | null;
  readonly version: number;
  readonly createCommandId: string;
}

export interface LiveChessClock {
  readonly whiteRemainingMs: number;
  readonly blackRemainingMs: number;
  readonly activeColor: Color;
  readonly turnStartedAtMs: number;
  readonly lastServerNowMs: number;
}

export interface LiveChessMoveRecord {
  readonly ply: number;
  readonly playerId: string;
  readonly color: Color;
  readonly uci: string;
  readonly san: string;
  readonly fenBefore: string;
  readonly fenAfter: string;
  readonly serverReceivedAtMs: number;
  readonly elapsedMs: number;
  readonly whiteRemainingMs: number;
  readonly blackRemainingMs: number;
}

export interface ProcessedLiveCommand {
  readonly commandId: string;
  readonly kind: LiveChessCommandKind;
  readonly actorId: string;
  readonly appliedVersion: number;
  readonly appliedSequence: number;
}

export interface LiveChessGame {
  readonly id: string;
  readonly tenantId: string;
  readonly challengeId: string | null;
  readonly whitePlayerId: string;
  readonly blackPlayerId: string;
  readonly timeControl: LiveTimeControl;
  readonly rated: boolean;
  readonly status: LiveGameStatus;
  readonly currentFen: string;
  readonly positionKeys: readonly string[];
  readonly moves: readonly LiveChessMoveRecord[];
  readonly clock: LiveChessClock;
  readonly drawOffer: DrawOfferState;
  readonly result: ChessResult;
  readonly termination: ChessTermination | 'resignation' | 'timeout' | 'draw_agreement';
  readonly winnerId: string | null;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
  readonly finishedAtMs: number | null;
  readonly version: number;
  readonly sequence: number;
  readonly processedCommands: readonly ProcessedLiveCommand[];
}

export type LiveChessCommandKind =
  | 'accept_challenge'
  | 'cancel_challenge'
  | 'submit_move'
  | 'offer_draw'
  | 'accept_draw'
  | 'decline_draw'
  | 'resign'
  | 'claim_timeout';

export type LiveChessEventType =
  | 'challenge_created'
  | 'challenge_cancelled'
  | 'challenge_expired'
  | 'challenge_accepted'
  | 'game_started'
  | 'move_played'
  | 'draw_offered'
  | 'draw_declined'
  | 'game_finished';

export interface LiveChessEvent<TPayload = Readonly<Record<string, unknown>>> {
  readonly id: string;
  readonly tenantId: string;
  readonly gameId: string | null;
  readonly challengeId: string | null;
  readonly sequence: number;
  readonly type: LiveChessEventType;
  readonly actorId: string | null;
  readonly createdAtMs: number;
  readonly payload: TPayload;
}

export interface LiveChessParticipantView {
  readonly gameId: string;
  readonly tenantId: string;
  readonly whitePlayerId: string;
  readonly blackPlayerId: string;
  readonly viewerColor: Color | null;
  readonly rated: boolean;
  readonly status: LiveGameStatus;
  readonly currentFen: string;
  readonly moves: readonly LiveChessMoveRecord[];
  readonly drawOffer: DrawOfferState;
  readonly result: ChessResult;
  readonly termination: LiveChessGame['termination'];
  readonly winnerId: string | null;
  readonly version: number;
  readonly sequence: number;
  readonly serverNowMs: number;
  readonly whiteRemainingMs: number;
  readonly blackRemainingMs: number;
  readonly activeColor: Color;
  readonly spectatorDelayMs: number;
}

export interface LiveChessReconnectEnvelope {
  readonly snapshot: LiveChessParticipantView;
  readonly events: readonly LiveChessEvent[];
  readonly nextSequence: number;
}

export interface LiveChessCommandReceipt {
  readonly game: LiveChessParticipantView;
  readonly replayed: boolean;
  readonly event: LiveChessEvent | null;
}

export function participantColor(game: LiveChessGame, userId: string): Color | null {
  if (game.whitePlayerId === userId) return 'white';
  if (game.blackPlayerId === userId) return 'black';
  return null;
}

export function opponentId(game: LiveChessGame, userId: string): string | null {
  if (game.whitePlayerId === userId) return game.blackPlayerId;
  if (game.blackPlayerId === userId) return game.whitePlayerId;
  return null;
}
