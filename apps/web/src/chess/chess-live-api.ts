export type LiveColor = 'white' | 'black';
export type LiveColorPreference = LiveColor | 'random';
export type LiveRatingPool = 'bullet' | 'blitz' | 'rapid' | 'classical' | 'daily';

export interface LiveChallengeView {
  id: string;
  publicCode: string;
  creatorId: string;
  colorPreference: LiveColorPreference;
  timeControl: { initialMs: number; incrementMs: number };
  rated: boolean;
  status: 'open' | 'accepted' | 'cancelled' | 'expired';
  expiresAtMs: number;
  gameId: string | null;
  version: number;
}

export interface LiveMoveView {
  ply: number;
  playerId: string;
  color: LiveColor;
  uci: string;
  san: string;
  fenBefore: string;
  fenAfter: string;
  serverReceivedAtMs: number;
  elapsedMs: number;
  whiteRemainingMs: number;
  blackRemainingMs: number;
}

export interface LiveGameView {
  gameId: string;
  whitePlayerId: string;
  blackPlayerId: string;
  viewerColor: LiveColor | null;
  rated: boolean;
  status: 'active' | 'finished';
  currentFen: string;
  moves: LiveMoveView[];
  drawOffer: { offeredBy: string; offeredAtMs: number } | null;
  result: '1-0' | '0-1' | '1/2-1/2' | '*';
  termination: string;
  winnerId: string | null;
  version: number;
  sequence: number;
  serverNowMs: number;
  whiteRemainingMs: number;
  blackRemainingMs: number;
  activeColor: LiveColor;
  spectatorDelayMs: number;
}

export interface MatchmakingTicketView {
  id: string;
  playerId: string;
  timeControl: { initialMs: number; incrementMs: number };
  pool: LiveRatingPool;
  rated: boolean;
  colorPreference: LiveColorPreference;
  rating: number;
  status: 'queued' | 'paired' | 'cancelled' | 'expired';
  expiresAtMs: number;
  pairedGameId: string | null;
  version: number;
}

export interface LiveRatingView {
  tenantId: string;
  playerId: string;
  pool: LiveRatingPool;
  rating: number;
  games: number;
  provisional: boolean;
  updatedAtMs: number;
  algorithm: 'asa-elo-v1';
}

export interface LiveRatingLedgerView {
  id: string;
  gameId: string;
  result: string;
  ratingBefore: number;
  ratingAfter: number;
  delta: number;
  createdAtMs: number;
}

interface LiveApiError {
  code: string;
  message: string;
}

export type LiveApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: LiveApiError };

async function call<T>(path: string, init?: RequestInit): Promise<LiveApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: 'same-origin',
      ...init,
      headers: {
        ...(init?.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...((init?.headers as Record<string, string> | undefined) ?? {}),
      },
    });
  } catch {
    return {
      ok: false,
      status: 0,
      error: { code: 'network', message: 'Сервер онлайн-шахмат недоступен.' },
    };
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (response.ok) return { ok: true, status: response.status, data: body as T };
  return {
    ok: false,
    status: response.status,
    error:
      (body as { error?: LiveApiError } | null)?.error ??
      { code: 'server_error', message: 'Неизвестная ошибка онлайн-шахмат.' },
  };
}

function commandHeaders(commandId: string): Record<string, string> {
  return { 'idempotency-key': commandId };
}

export const chessLiveApi = {
  createChallenge: (input: {
    commandId: string;
    colorPreference: LiveColorPreference;
    initialMs: number;
    incrementMs: number;
    rated: boolean;
    expiresInMs: number;
  }) =>
    call<{ challenge: LiveChallengeView; replayed: boolean }>('/api/chess/live/challenges', {
      method: 'POST',
      headers: commandHeaders(input.commandId),
      body: JSON.stringify({
        colorPreference: input.colorPreference,
        initialMs: input.initialMs,
        incrementMs: input.incrementMs,
        rated: input.rated,
        expiresInMs: input.expiresInMs,
      }),
    }),
  getChallenge: (publicCode: string) =>
    call<{ challenge: LiveChallengeView }>(
      `/api/chess/live/challenges/${encodeURIComponent(publicCode)}`,
    ),
  acceptChallenge: (publicCode: string, commandId: string) =>
    call<{ challenge: LiveChallengeView; game: LiveGameView; replayed: boolean }>(
      `/api/chess/live/challenges/${encodeURIComponent(publicCode)}/accept`,
      {
        method: 'POST',
        headers: commandHeaders(commandId),
        body: JSON.stringify({}),
      },
    ),
  cancelChallenge: (challengeId: string, commandId: string) =>
    call<{ challenge: LiveChallengeView; replayed: boolean }>(
      `/api/chess/live/challenges/${encodeURIComponent(challengeId)}/cancel`,
      {
        method: 'POST',
        headers: commandHeaders(commandId),
        body: JSON.stringify({}),
      },
    ),
  getGame: (gameId: string) =>
    call<{ game: LiveGameView }>(`/api/chess/live/games/${encodeURIComponent(gameId)}`),
  reconnect: (gameId: string, afterSequence: number) =>
    call<{ snapshot: LiveGameView; events: unknown[]; nextSequence: number }>(
      `/api/chess/live/games/${encodeURIComponent(gameId)}/reconnect?after=${afterSequence}`,
    ),
  submitMove: (gameId: string, expectedVersion: number, uci: string, commandId: string) =>
    call<{ game: LiveGameView; replayed: boolean; event: unknown | null }>(
      `/api/chess/live/games/${encodeURIComponent(gameId)}/moves`,
      {
        method: 'POST',
        headers: commandHeaders(commandId),
        body: JSON.stringify({ expectedVersion, uci }),
      },
    ),
  gameControl: (
    gameId: string,
    action: 'draw-offer' | 'draw-accept' | 'draw-decline' | 'resign' | 'claim-timeout',
    expectedVersion: number,
    commandId: string,
  ) =>
    call<{ game: LiveGameView; replayed: boolean; event: unknown | null }>(
      `/api/chess/live/games/${encodeURIComponent(gameId)}/${action}`,
      {
        method: 'POST',
        headers: commandHeaders(commandId),
        body: JSON.stringify({ expectedVersion }),
      },
    ),
  joinMatchmaking: (input: {
    commandId: string;
    initialMs: number;
    incrementMs: number;
    rated: boolean;
    colorPreference: LiveColorPreference;
    expiresInMs: number;
  }) =>
    call<{ ticket: MatchmakingTicketView; game: LiveGameView | null; replayed: boolean }>(
      '/api/chess/live/matchmaking',
      {
        method: 'POST',
        headers: commandHeaders(input.commandId),
        body: JSON.stringify({
          initialMs: input.initialMs,
          incrementMs: input.incrementMs,
          rated: input.rated,
          colorPreference: input.colorPreference,
          expiresInMs: input.expiresInMs,
        }),
      },
    ),
  cancelMatchmaking: (ticketId: string, expectedVersion: number, commandId: string) =>
    call<{ ticket: MatchmakingTicketView; replayed: boolean }>(
      `/api/chess/live/matchmaking/${encodeURIComponent(ticketId)}/cancel`,
      {
        method: 'POST',
        headers: commandHeaders(commandId),
        body: JSON.stringify({ expectedVersion }),
      },
    ),
  getRating: (pool: LiveRatingPool) =>
    call<{ rating: LiveRatingView; ledger: LiveRatingLedgerView[] }>(
      `/api/chess/live/ratings/${pool}`,
    ),
};
