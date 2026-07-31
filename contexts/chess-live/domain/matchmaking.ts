import type { Color } from '@asa-lab/chess';
import { isSafeLiveId, validateLiveTimeControl } from './challenge.js';
import type { ColorPreference, LiveChessResult, LiveTimeControl } from './model.js';
import { ratingPoolForTimeControl, type ChessRatingPool } from './rating.js';

export type MatchmakingTicketStatus = 'queued' | 'paired' | 'cancelled' | 'expired';

export interface MatchmakingTicket {
  readonly id: string;
  readonly tenantId: string;
  readonly playerId: string;
  readonly timeControl: LiveTimeControl;
  readonly pool: ChessRatingPool;
  readonly rated: boolean;
  readonly colorPreference: ColorPreference;
  readonly rating: number;
  readonly status: MatchmakingTicketStatus;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
  readonly pairedGameId: string | null;
  readonly version: number;
  readonly commandId: string;
}

export interface MatchmakingPair {
  readonly white: MatchmakingTicket;
  readonly black: MatchmakingTicket;
  readonly pool: ChessRatingPool;
  readonly timeControl: LiveTimeControl;
  readonly rated: boolean;
  readonly ratingDifference: number;
}

export interface CreateMatchmakingTicketInput {
  readonly id: string;
  readonly tenantId: string;
  readonly playerId: string;
  readonly timeControl: LiveTimeControl;
  readonly rated: boolean;
  readonly colorPreference: ColorPreference;
  readonly rating: number;
  readonly nowMs: number;
  readonly expiresAtMs: number;
  readonly commandId: string;
}

const MIN_TICKET_LIFETIME_MS = 30_000;
const MAX_TICKET_LIFETIME_MS = 30 * 60 * 1000;

export function createMatchmakingTicket(
  input: CreateMatchmakingTicketInput,
): LiveChessResult<MatchmakingTicket> {
  for (const [field, value] of [
    ['id', input.id],
    ['tenantId', input.tenantId],
    ['playerId', input.playerId],
    ['commandId', input.commandId],
  ] as const) {
    if (!isSafeLiveId(value)) {
      return { ok: false, code: 'validation_error', message: `${field} must be a safe ID` };
    }
  }
  const timeControl = validateLiveTimeControl(input.timeControl);
  if (!timeControl.ok) return timeControl;
  if (
    input.colorPreference !== 'white' &&
    input.colorPreference !== 'black' &&
    input.colorPreference !== 'random'
  ) {
    return { ok: false, code: 'validation_error', message: 'invalid color preference' };
  }
  if (!Number.isInteger(input.rating) || input.rating < 100 || input.rating > 4000) {
    return {
      ok: false,
      code: 'validation_error',
      message: 'rating must be an integer from 100 to 4000',
    };
  }
  if (!Number.isSafeInteger(input.nowMs) || input.nowMs < 0) {
    return { ok: false, code: 'validation_error', message: 'nowMs must be a non-negative integer' };
  }
  const lifetime = input.expiresAtMs - input.nowMs;
  if (
    !Number.isSafeInteger(input.expiresAtMs) ||
    lifetime < MIN_TICKET_LIFETIME_MS ||
    lifetime > MAX_TICKET_LIFETIME_MS
  ) {
    return {
      ok: false,
      code: 'validation_error',
      message: `ticket lifetime must be from ${MIN_TICKET_LIFETIME_MS} to ${MAX_TICKET_LIFETIME_MS} ms`,
    };
  }
  return {
    ok: true,
    value: {
      id: input.id,
      tenantId: input.tenantId,
      playerId: input.playerId,
      timeControl: timeControl.value,
      pool: ratingPoolForTimeControl(timeControl.value.initialMs, timeControl.value.incrementMs),
      rated: input.rated,
      colorPreference: input.colorPreference,
      rating: input.rating,
      status: 'queued',
      createdAtMs: input.nowMs,
      expiresAtMs: input.expiresAtMs,
      pairedGameId: null,
      version: 1,
      commandId: input.commandId,
    },
  };
}

export function effectiveTicketStatus(
  ticket: MatchmakingTicket,
  nowMs: number,
): MatchmakingTicketStatus {
  if (ticket.status === 'queued' && nowMs >= ticket.expiresAtMs) return 'expired';
  return ticket.status;
}

export function matchmakingRatingWindow(ticket: MatchmakingTicket, nowMs: number): number {
  const waitedMs = Math.max(0, nowMs - ticket.createdAtMs);
  return Math.min(600, 100 + Math.floor(waitedMs / 30_000) * 50);
}

function colorsCompatible(left: ColorPreference, right: ColorPreference): boolean {
  return !((left === 'white' && right === 'white') || (left === 'black' && right === 'black'));
}

function assignColors(
  left: MatchmakingTicket,
  right: MatchmakingTicket,
): readonly [white: MatchmakingTicket, black: MatchmakingTicket] {
  if (left.colorPreference === 'white' || right.colorPreference === 'black') return [left, right];
  if (left.colorPreference === 'black' || right.colorPreference === 'white') return [right, left];
  return left.id.localeCompare(right.id) <= 0 ? [left, right] : [right, left];
}

export function areMatchmakingTicketsCompatible(
  left: MatchmakingTicket,
  right: MatchmakingTicket,
  nowMs: number,
): boolean {
  if (left.id === right.id || left.playerId === right.playerId) return false;
  if (
    effectiveTicketStatus(left, nowMs) !== 'queued' ||
    effectiveTicketStatus(right, nowMs) !== 'queued'
  ) {
    return false;
  }
  if (
    left.tenantId !== right.tenantId ||
    left.pool !== right.pool ||
    left.rated !== right.rated ||
    left.timeControl.initialMs !== right.timeControl.initialMs ||
    left.timeControl.incrementMs !== right.timeControl.incrementMs ||
    !colorsCompatible(left.colorPreference, right.colorPreference)
  ) {
    return false;
  }
  const allowedDifference = Math.max(
    matchmakingRatingWindow(left, nowMs),
    matchmakingRatingWindow(right, nowMs),
  );
  return Math.abs(left.rating - right.rating) <= allowedDifference;
}

export function findMatchmakingPair(
  tickets: readonly MatchmakingTicket[],
  nowMs: number,
): MatchmakingPair | null {
  const queued = tickets
    .filter((ticket) => effectiveTicketStatus(ticket, nowMs) === 'queued')
    .sort((left, right) => left.createdAtMs - right.createdAtMs || left.id.localeCompare(right.id));
  for (let leftIndex = 0; leftIndex < queued.length; leftIndex += 1) {
    const left = queued[leftIndex]!;
    const candidates = queued
      .slice(leftIndex + 1)
      .filter((right) => areMatchmakingTicketsCompatible(left, right, nowMs))
      .sort(
        (a, b) =>
          Math.abs(left.rating - a.rating) - Math.abs(left.rating - b.rating) ||
          a.createdAtMs - b.createdAtMs ||
          a.id.localeCompare(b.id),
      );
    const right = candidates[0];
    if (!right) continue;
    const [white, black] = assignColors(left, right);
    return {
      white,
      black,
      pool: left.pool,
      timeControl: left.timeControl,
      rated: left.rated,
      ratingDifference: Math.abs(left.rating - right.rating),
    };
  }
  return null;
}

export function markMatchmakingTicketPaired(
  ticket: MatchmakingTicket,
  gameId: string,
): MatchmakingTicket {
  return {
    ...ticket,
    status: 'paired',
    pairedGameId: gameId,
    version: ticket.version + 1,
  };
}

export function cancelMatchmakingTicket(
  ticket: MatchmakingTicket,
  actorId: string,
  nowMs: number,
): LiveChessResult<MatchmakingTicket> {
  if (ticket.playerId !== actorId) {
    return {
      ok: false,
      code: 'forbidden',
      message: 'only the ticket owner can cancel matchmaking',
    };
  }
  const status = effectiveTicketStatus(ticket, nowMs);
  if (status === 'expired') return { ok: false, code: 'expired', message: 'ticket has expired' };
  if (status !== 'queued') {
    return { ok: false, code: 'conflict', message: `ticket is ${status}` };
  }
  return {
    ok: true,
    value: { ...ticket, status: 'cancelled', version: ticket.version + 1 },
  };
}

export function preferredColorForPair(pair: MatchmakingPair, playerId: string): Color | null {
  if (pair.white.playerId === playerId) return 'white';
  if (pair.black.playerId === playerId) return 'black';
  return null;
}
