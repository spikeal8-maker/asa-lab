import type { CheckersDocumentResult } from './document.js';

export const CHECKERS_REACTION_IDS = [
  'good-luck',
  'good-move',
  'thanks-for-game',
  'applause',
  'thinking',
  'friendly-smile',
] as const;

export type CheckersReactionId = (typeof CHECKERS_REACTION_IDS)[number];

export const CHECKERS_REACTIONS: Readonly<Record<CheckersReactionId, string>> = {
  'good-luck': 'Удачи!',
  'good-move': 'Хороший ход!',
  'thanks-for-game': 'Спасибо за игру!',
  applause: 'Аплодисменты',
  thinking: 'Думаю…',
  'friendly-smile': 'Улыбка',
};

export interface CheckersReactionEvent {
  readonly id: string;
  readonly gameId: string;
  readonly classroomId: string;
  readonly senderId: string;
  readonly reactionId: CheckersReactionId;
  readonly sentAt: string;
  readonly gameState: 'active' | 'finished';
}

export interface CheckersReactionRequest {
  readonly eventId: string;
  readonly gameId: string;
  readonly gameClassroomId: string;
  readonly senderId: string;
  readonly senderClassroomIds: readonly string[];
  readonly participantIds: readonly string[];
  readonly reactionId: CheckersReactionId;
  readonly sentAt: string;
  readonly gameState: 'active' | 'finished';
}

export interface CheckersReactionDecision {
  readonly allowed: boolean;
  readonly code:
    | 'allowed'
    | 'not-class-authorized'
    | 'not-a-participant'
    | 'unknown-reaction'
    | 'invalid-time'
    | 'cooldown'
    | 'rate-limit'
    | 'reaction-closed';
}

const WINDOW_MS = 10_000;
const COOLDOWN_MS = 1_500;
const MAX_EVENTS_PER_WINDOW = 4;
const CLOSING_REACTIONS = new Set<CheckersReactionId>(['thanks-for-game', 'applause']);

export function decideCheckersReaction(
  request: CheckersReactionRequest,
  previousEvents: readonly CheckersReactionEvent[],
): CheckersReactionDecision {
  if (!CHECKERS_REACTION_IDS.includes(request.reactionId)) {
    return { allowed: false, code: 'unknown-reaction' };
  }
  if (!request.senderClassroomIds.includes(request.gameClassroomId)) {
    return { allowed: false, code: 'not-class-authorized' };
  }
  if (!request.participantIds.includes(request.senderId)) {
    return { allowed: false, code: 'not-a-participant' };
  }
  const sentAt = Date.parse(request.sentAt);
  if (!Number.isFinite(sentAt)) return { allowed: false, code: 'invalid-time' };

  const ownGameEvents = previousEvents.filter(
    (event) => event.gameId === request.gameId && event.senderId === request.senderId,
  );
  if (request.gameState === 'finished') {
    if (!CLOSING_REACTIONS.has(request.reactionId)) {
      return { allowed: false, code: 'reaction-closed' };
    }
    if (ownGameEvents.some((event) => event.gameState === 'finished')) {
      return { allowed: false, code: 'reaction-closed' };
    }
  }

  const recent = ownGameEvents
    .map((event) => Date.parse(event.sentAt))
    .filter((timestamp) => Number.isFinite(timestamp) && sentAt - timestamp >= 0);
  if (recent.some((timestamp) => sentAt - timestamp < COOLDOWN_MS)) {
    return { allowed: false, code: 'cooldown' };
  }
  if (
    recent.filter((timestamp) => sentAt - timestamp < WINDOW_MS).length >= MAX_EVENTS_PER_WINDOW
  ) {
    return { allowed: false, code: 'rate-limit' };
  }
  return { allowed: true, code: 'allowed' };
}

export function createCheckersReactionEvent(
  request: CheckersReactionRequest,
  previousEvents: readonly CheckersReactionEvent[],
): CheckersDocumentResult<CheckersReactionEvent> {
  if (previousEvents.some((event) => event.id === request.eventId)) {
    return { ok: false, message: 'reaction event id has already been used' };
  }
  const decision = decideCheckersReaction(request, previousEvents);
  if (!decision.allowed) {
    return { ok: false, message: `reaction rejected: ${decision.code}` };
  }
  return {
    ok: true,
    value: {
      id: request.eventId,
      gameId: request.gameId,
      classroomId: request.gameClassroomId,
      senderId: request.senderId,
      reactionId: request.reactionId,
      sentAt: request.sentAt,
      gameState: request.gameState,
    },
  };
}
