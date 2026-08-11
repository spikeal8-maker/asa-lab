import {
  CHECKERS_BOT_IDS,
  chooseCheckersBotMove,
  type CheckersBotDecision,
  type CheckersBotId,
  type CheckersBotSearchOptions,
} from '../domain/bot.js';
import {
  validateCheckersDocument,
  type CheckersDocument,
  type CheckersDocumentResult,
  type CheckersSide,
  type CheckersSquare,
} from '../domain/document.js';
import {
  advanceCheckersDrawTracker,
  createCheckersDrawTracker,
  getCheckersAutomaticDrawReason,
  type CheckersDrawTracker,
} from '../domain/draw.js';
import { applyCheckersMove } from '../domain/rules.js';

export type CheckersSessionMode = 'bot' | 'class' | 'local' | 'lesson';

export type CheckersSessionPlayer =
  | {
      readonly kind: 'student';
      readonly participantId: string;
      readonly side: CheckersSide;
    }
  | {
      readonly kind: 'bot';
      readonly participantId: string;
      readonly side: CheckersSide;
      readonly botId: CheckersBotId;
    };

export interface CheckersGameSession {
  readonly id: string;
  readonly projectId: string;
  readonly classroomId: string | null;
  readonly mode: CheckersSessionMode;
  readonly players: readonly CheckersSessionPlayer[];
  readonly document: CheckersDocument;
  readonly drawTracker: CheckersDrawTracker;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateCheckersSessionCommand {
  readonly id: string;
  readonly projectId: string;
  readonly classroomId: string | null;
  readonly mode: CheckersSessionMode;
  readonly players: readonly CheckersSessionPlayer[];
  readonly document: CheckersDocument;
  readonly occurredAt: string;
}

export interface PlayCheckersMoveCommand {
  readonly sessionId: string;
  readonly actorId: string;
  readonly expectedVersion: number;
  readonly pieceId: string;
  readonly path: readonly CheckersSquare[];
  readonly occurredAt: string;
}

export interface PlayCheckersBotMoveCommand {
  readonly sessionId: string;
  readonly expectedVersion: number;
  readonly botId: CheckersBotId;
  readonly occurredAt: string;
  readonly search?: CheckersBotSearchOptions;
}

export interface CheckersBotTurn {
  readonly session: CheckersGameSession;
  readonly decision: CheckersBotDecision;
}

export interface CheckersGameRepository {
  findById(id: string): Promise<CheckersGameSession | null>;
  create(session: CheckersGameSession): Promise<CheckersDocumentResult<CheckersGameSession>>;
  save(
    session: CheckersGameSession,
    expectedVersion: number,
  ): Promise<CheckersDocumentResult<CheckersGameSession>>;
}

function validId(value: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,127}$/.test(value);
}

function validTime(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function validatePlayers(
  mode: CheckersSessionMode,
  classroomId: string | null,
  players: readonly CheckersSessionPlayer[],
): CheckersDocumentResult<readonly CheckersSessionPlayer[]> {
  if (players.length !== 2 || new Set(players.map((player) => player.participantId)).size !== 2) {
    return { ok: false, message: 'a Checkers session must have two unique players' };
  }
  if (new Set(players.map((player) => player.side)).size !== 2) {
    return { ok: false, message: 'a Checkers session must assign light and dark exactly once' };
  }
  if (players.some((player) => !validId(player.participantId))) {
    return { ok: false, message: 'session participant ids are invalid' };
  }
  const bots = players.filter((player) => player.kind === 'bot');
  if (mode === 'bot' && bots.length !== 1) {
    return { ok: false, message: 'bot mode must contain exactly one bot player' };
  }
  if (mode !== 'bot' && bots.length > 0) {
    return { ok: false, message: 'bot players are only allowed in bot mode' };
  }
  if (mode === 'class' && classroomId === null) {
    return { ok: false, message: 'class mode requires a classroom id' };
  }
  if (players.some((player) => player.kind === 'bot' && !CHECKERS_BOT_IDS.includes(player.botId))) {
    return { ok: false, message: 'session bot id is invalid' };
  }
  return { ok: true, value: players };
}

function nextSession(
  session: CheckersGameSession,
  document: CheckersDocument,
  occurredAt: string,
): CheckersGameSession {
  const drawTracker = advanceCheckersDrawTracker(session.drawTracker, session.document, document);
  const drawReason =
    document.result === '*' ? getCheckersAutomaticDrawReason(drawTracker, document) : null;
  return {
    ...session,
    document: drawReason ? { ...document, result: '1/2-1/2' } : document,
    drawTracker,
    version: session.version + 1,
    updatedAt: occurredAt,
  };
}

export class CheckersGameService {
  constructor(private readonly repository: CheckersGameRepository) {}

  async getSession(id: string): Promise<CheckersDocumentResult<CheckersGameSession>> {
    const session = await this.repository.findById(id);
    return session
      ? { ok: true, value: session }
      : { ok: false, message: 'Checkers session not found' };
  }

  async createSession(
    command: CreateCheckersSessionCommand,
  ): Promise<CheckersDocumentResult<CheckersGameSession>> {
    if (!validId(command.id) || !validId(command.projectId)) {
      return { ok: false, message: 'session and project ids are invalid' };
    }
    if (command.classroomId !== null && !validId(command.classroomId)) {
      return { ok: false, message: 'classroom id is invalid' };
    }
    if (!validTime(command.occurredAt)) {
      return { ok: false, message: 'session occurredAt must be an ISO timestamp' };
    }
    const document = validateCheckersDocument(command.document);
    if (!document.ok) return document;
    const players = validatePlayers(command.mode, command.classroomId, command.players);
    if (!players.ok) return players;

    return this.repository.create({
      id: command.id,
      projectId: command.projectId,
      classroomId: command.classroomId,
      mode: command.mode,
      players: command.players,
      document: document.value,
      drawTracker: createCheckersDrawTracker(document.value),
      version: 1,
      createdAt: command.occurredAt,
      updatedAt: command.occurredAt,
    });
  }

  async playMove(
    command: PlayCheckersMoveCommand,
  ): Promise<CheckersDocumentResult<CheckersGameSession>> {
    if (!validTime(command.occurredAt)) {
      return { ok: false, message: 'move occurredAt must be an ISO timestamp' };
    }
    const found = await this.getSession(command.sessionId);
    if (!found.ok) return found;
    const session = found.value;
    if (session.version !== command.expectedVersion) {
      return {
        ok: false,
        message: `session version conflict: current version is ${session.version}`,
      };
    }
    const player = session.players.find((candidate) => candidate.participantId === command.actorId);
    if (!player || player.kind !== 'student') {
      return { ok: false, message: 'only an assigned student player can make this move' };
    }
    if (player.side !== session.document.sideToMove) {
      return { ok: false, message: 'it is not this player’s turn' };
    }

    const applied = applyCheckersMove(session.document, {
      pieceId: command.pieceId,
      path: command.path,
    });
    if (!applied.ok) return applied;
    return this.repository.save(
      nextSession(session, applied.value, command.occurredAt),
      command.expectedVersion,
    );
  }

  async playBotMove(
    command: PlayCheckersBotMoveCommand,
  ): Promise<CheckersDocumentResult<CheckersBotTurn>> {
    if (!validTime(command.occurredAt)) {
      return { ok: false, message: 'bot move occurredAt must be an ISO timestamp' };
    }
    const found = await this.getSession(command.sessionId);
    if (!found.ok) return found;
    const session = found.value;
    if (session.version !== command.expectedVersion) {
      return {
        ok: false,
        message: `session version conflict: current version is ${session.version}`,
      };
    }
    const bot = session.players.find(
      (player) =>
        player.kind === 'bot' &&
        player.side === session.document.sideToMove &&
        player.botId === command.botId,
    );
    if (!bot) {
      return { ok: false, message: 'the requested bot is not assigned to the side to move' };
    }

    const decision = chooseCheckersBotMove(session.document, command.botId, command.search);
    if (!decision.ok) return decision;
    const applied = applyCheckersMove(session.document, {
      pieceId: decision.value.move.pieceId,
      path: decision.value.move.path,
    });
    if (!applied.ok) return applied;
    const saved = await this.repository.save(
      nextSession(session, applied.value, command.occurredAt),
      command.expectedVersion,
    );
    return saved.ok
      ? { ok: true, value: { session: saved.value, decision: decision.value } }
      : saved;
  }
}
