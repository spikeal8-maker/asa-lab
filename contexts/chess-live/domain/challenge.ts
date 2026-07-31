import type {
  ColorPreference,
  LiveChessChallenge,
  LiveChessResult,
  LiveTimeControl,
} from './model.js';

export interface CreateChallengeInput {
  readonly id: string;
  readonly publicCode: string;
  readonly tenantId: string;
  readonly creatorId: string;
  readonly colorPreference: ColorPreference;
  readonly timeControl: LiveTimeControl;
  readonly rated: boolean;
  readonly nowMs: number;
  readonly expiresAtMs: number;
  readonly commandId: string;
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const PUBLIC_CODE = /^[A-Z0-9]{8,16}$/;
const MIN_INITIAL_MS = 60_000;
const MAX_INITIAL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_INCREMENT_MS = 60 * 60 * 1000;
const MIN_CHALLENGE_LIFETIME_MS = 60_000;
const MAX_CHALLENGE_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

export function isSafeLiveId(value: string): boolean {
  return SAFE_ID.test(value);
}

export function validateLiveTimeControl(value: LiveTimeControl): LiveChessResult<LiveTimeControl> {
  if (
    !Number.isSafeInteger(value.initialMs) ||
    value.initialMs < MIN_INITIAL_MS ||
    value.initialMs > MAX_INITIAL_MS
  ) {
    return {
      ok: false,
      code: 'validation_error',
      message: `initialMs must be an integer from ${MIN_INITIAL_MS} to ${MAX_INITIAL_MS}`,
    };
  }
  if (
    !Number.isSafeInteger(value.incrementMs) ||
    value.incrementMs < 0 ||
    value.incrementMs > MAX_INCREMENT_MS
  ) {
    return {
      ok: false,
      code: 'validation_error',
      message: `incrementMs must be an integer from 0 to ${MAX_INCREMENT_MS}`,
    };
  }
  return { ok: true, value };
}

export function createLiveChessChallenge(
  input: CreateChallengeInput,
): LiveChessResult<LiveChessChallenge> {
  for (const [field, value] of [
    ['id', input.id],
    ['tenantId', input.tenantId],
    ['creatorId', input.creatorId],
    ['commandId', input.commandId],
  ] as const) {
    if (!isSafeLiveId(value)) {
      return { ok: false, code: 'validation_error', message: `${field} must be a safe ID` };
    }
  }
  if (!PUBLIC_CODE.test(input.publicCode)) {
    return {
      ok: false,
      code: 'validation_error',
      message: 'publicCode must contain 8–16 uppercase letters or digits',
    };
  }
  if (
    input.colorPreference !== 'white' &&
    input.colorPreference !== 'black' &&
    input.colorPreference !== 'random'
  ) {
    return { ok: false, code: 'validation_error', message: 'invalid color preference' };
  }
  if (!Number.isSafeInteger(input.nowMs) || input.nowMs < 0) {
    return { ok: false, code: 'validation_error', message: 'nowMs must be a non-negative integer' };
  }
  if (
    !Number.isSafeInteger(input.expiresAtMs) ||
    input.expiresAtMs - input.nowMs < MIN_CHALLENGE_LIFETIME_MS ||
    input.expiresAtMs - input.nowMs > MAX_CHALLENGE_LIFETIME_MS
  ) {
    return {
      ok: false,
      code: 'validation_error',
      message: `challenge lifetime must be from ${MIN_CHALLENGE_LIFETIME_MS} to ${MAX_CHALLENGE_LIFETIME_MS} ms`,
    };
  }
  const timeControl = validateLiveTimeControl(input.timeControl);
  if (!timeControl.ok) return timeControl;
  return {
    ok: true,
    value: {
      id: input.id,
      publicCode: input.publicCode,
      tenantId: input.tenantId,
      creatorId: input.creatorId,
      colorPreference: input.colorPreference,
      timeControl: timeControl.value,
      rated: input.rated,
      status: 'open',
      createdAtMs: input.nowMs,
      expiresAtMs: input.expiresAtMs,
      acceptedById: null,
      acceptedAtMs: null,
      gameId: null,
      version: 1,
      createCommandId: input.commandId,
    },
  };
}

export function effectiveChallengeStatus(
  challenge: LiveChessChallenge,
  nowMs: number,
): LiveChessChallenge['status'] {
  if (challenge.status === 'open' && nowMs >= challenge.expiresAtMs) return 'expired';
  return challenge.status;
}

export function expireLiveChessChallenge(
  challenge: LiveChessChallenge,
  nowMs: number,
): LiveChessChallenge {
  if (effectiveChallengeStatus(challenge, nowMs) !== 'expired' || challenge.status !== 'open') {
    return challenge;
  }
  return { ...challenge, status: 'expired', version: challenge.version + 1 };
}

export function acceptLiveChessChallenge(
  challenge: LiveChessChallenge,
  accepterId: string,
  gameId: string,
  nowMs: number,
): LiveChessResult<LiveChessChallenge> {
  if (!isSafeLiveId(accepterId) || !isSafeLiveId(gameId)) {
    return {
      ok: false,
      code: 'validation_error',
      message: 'accepterId and gameId must be safe IDs',
    };
  }
  const status = effectiveChallengeStatus(challenge, nowMs);
  if (status === 'expired') {
    return { ok: false, code: 'expired', message: 'challenge has expired' };
  }
  if (status !== 'open') {
    return { ok: false, code: 'conflict', message: `challenge is ${status}` };
  }
  if (challenge.creatorId === accepterId) {
    return {
      ok: false,
      code: 'forbidden',
      message: 'challenge creator cannot accept own challenge',
    };
  }
  return {
    ok: true,
    value: {
      ...challenge,
      status: 'accepted',
      acceptedById: accepterId,
      acceptedAtMs: nowMs,
      gameId,
      version: challenge.version + 1,
    },
  };
}

export function cancelLiveChessChallenge(
  challenge: LiveChessChallenge,
  actorId: string,
  nowMs: number,
): LiveChessResult<LiveChessChallenge> {
  if (challenge.creatorId !== actorId) {
    return { ok: false, code: 'forbidden', message: 'only the creator can cancel the challenge' };
  }
  const status = effectiveChallengeStatus(challenge, nowMs);
  if (status === 'expired') return { ok: false, code: 'expired', message: 'challenge has expired' };
  if (status !== 'open') {
    return { ok: false, code: 'conflict', message: `challenge is ${status}` };
  }
  return {
    ok: true,
    value: { ...challenge, status: 'cancelled', version: challenge.version + 1 },
  };
}
