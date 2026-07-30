import type {
  LiveChessEvent,
  LiveChessParticipantView,
  LiveTimeControl,
} from './model.js';

export const CHESS_LIVE_PROTOCOL_VERSION = 'asa-chess-live-v1' as const;

export type ChessLiveClientMessage =
  | {
      readonly type: 'client.hello';
      readonly protocol: typeof CHESS_LIVE_PROTOCOL_VERSION;
      readonly gameId: string;
      readonly lastSequence: number;
      readonly clientInstanceId: string;
    }
  | {
      readonly type: 'game.move';
      readonly gameId: string;
      readonly commandId: string;
      readonly expectedVersion: number;
      readonly uci: string;
    }
  | {
      readonly type: 'game.offer_draw' | 'game.accept_draw' | 'game.decline_draw' | 'game.resign' | 'game.claim_timeout';
      readonly gameId: string;
      readonly commandId: string;
      readonly expectedVersion: number;
    }
  | {
      readonly type: 'client.ping';
      readonly sentAtMs: number;
    };

export type ChessLiveServerMessage =
  | {
      readonly type: 'server.hello';
      readonly protocol: typeof CHESS_LIVE_PROTOCOL_VERSION;
      readonly connectionId: string;
      readonly serverTimeMs: number;
      readonly heartbeatMs: number;
    }
  | {
      readonly type: 'game.snapshot';
      readonly snapshot: LiveChessParticipantView;
      readonly events: readonly LiveChessEvent[];
      readonly nextSequence: number;
    }
  | {
      readonly type: 'game.event';
      readonly event: LiveChessEvent;
    }
  | {
      readonly type: 'game.command_ack';
      readonly commandId: string;
      readonly gameId: string;
      readonly version: number;
      readonly sequence: number;
      readonly replayed: boolean;
    }
  | {
      readonly type: 'game.error';
      readonly commandId: string | null;
      readonly code: string;
      readonly message: string;
      readonly currentVersion: number | null;
    }
  | {
      readonly type: 'server.pong';
      readonly sentAtMs: number;
      readonly serverTimeMs: number;
    };

export interface ChallengeTransportView {
  readonly publicCode: string;
  readonly status: 'open' | 'accepted' | 'cancelled' | 'expired';
  readonly colorPreference: 'white' | 'black' | 'random';
  readonly timeControl: LiveTimeControl;
  readonly rated: boolean;
  readonly expiresAtMs: number;
  readonly gameId: string | null;
}

export interface ChessLiveTransportError {
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
}

export function isChessLiveClientMessage(value: unknown): value is ChessLiveClientMessage {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const message = value as Record<string, unknown>;
  if (typeof message['type'] !== 'string') return false;
  if (message['type'] === 'client.ping') {
    return Number.isSafeInteger(message['sentAtMs']) && Number(message['sentAtMs']) >= 0;
  }
  if (message['type'] === 'client.hello') {
    return (
      message['protocol'] === CHESS_LIVE_PROTOCOL_VERSION &&
      typeof message['gameId'] === 'string' &&
      Number.isSafeInteger(message['lastSequence']) &&
      Number(message['lastSequence']) >= 0 &&
      typeof message['clientInstanceId'] === 'string'
    );
  }
  const commandTypes = new Set([
    'game.move',
    'game.offer_draw',
    'game.accept_draw',
    'game.decline_draw',
    'game.resign',
    'game.claim_timeout',
  ]);
  if (!commandTypes.has(message['type'])) return false;
  if (
    typeof message['gameId'] !== 'string' ||
    typeof message['commandId'] !== 'string' ||
    !Number.isSafeInteger(message['expectedVersion']) ||
    Number(message['expectedVersion']) < 1
  ) {
    return false;
  }
  if (message['type'] === 'game.move') {
    return typeof message['uci'] === 'string' && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(message['uci']);
  }
  return !('uci' in message);
}
