import {
  CHECKERS_BOTS,
  checkersOutcomeForSide,
  getCheckersSessionStatus,
  type CheckersBotGameMode,
  type CheckersDocument,
  type CheckersGameSession,
  type CheckersProjectDocument,
  type CheckersResult,
  type CheckersSessionMode,
  type CheckersSide,
} from '@asa-lab/checkers';

export type CheckersUnifiedMatchMode =
  'bot' | 'local' | 'classroom' | 'friend' | 'quick' | 'rated' | 'lesson';

export type CheckersUnifiedMatchStatus = 'waiting' | 'active' | 'finished' | 'abandoned';

export interface CheckersMatchSessionView {
  readonly id: string;
  readonly mode: CheckersUnifiedMatchMode;
  readonly status: CheckersUnifiedMatchStatus;
  readonly source: 'legacy-personal-project' | 'classroom-server' | 'session-service';
  readonly document: CheckersDocument;
  readonly version: number;
  readonly viewerSide: CheckersSide | null;
  readonly modeLabel: string;
  readonly opponentLabel: string;
  readonly readOnly: boolean;
  readonly orientation: CheckersSide;
  readonly autoFlipBoard: boolean;
  readonly canRestart: boolean;
  readonly canResign: boolean;
  readonly canDraw: boolean;
  readonly botId: string | null;
  readonly botMode: CheckersBotGameMode | null;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
}

export interface CheckersMatchResultView {
  readonly tone: 'win' | 'loss' | 'draw';
  readonly title: string;
  readonly detail: string;
}

export interface CheckersMatchResumeView {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
}

export interface CheckersMatchHistoryEntry {
  readonly id: string;
  readonly mode: CheckersUnifiedMatchMode;
  readonly result: Exclude<CheckersResult, '*'>;
  readonly opponentLabel: string;
  readonly moveCount: number;
  readonly finishedAt: string | null;
}

interface ClassroomMatchInput {
  readonly id: string;
  readonly mode: 'friendly' | 'team' | 'teacher-event';
  readonly status: 'pending' | 'active' | 'declined' | 'finished';
  readonly version: number;
  readonly side: CheckersSide | null;
  readonly lightPlayer: { readonly id: string; readonly displayName: string };
  readonly darkPlayer: { readonly id: string; readonly displayName: string };
  readonly document: CheckersDocument;
  readonly createdAt: string;
  readonly updatedAt: string;
}

function sessionMode(mode: CheckersSessionMode): CheckersUnifiedMatchMode {
  return mode === 'class' ? 'classroom' : mode;
}

function sessionModeLabel(mode: CheckersUnifiedMatchMode): string {
  if (mode === 'bot') return 'Игра с ботом';
  if (mode === 'local') return 'Игра вдвоём · одно устройство';
  if (mode === 'classroom') return 'Игра класса';
  if (mode === 'friend') return 'Игра с другом';
  if (mode === 'quick') return 'Быстрая игра';
  if (mode === 'rated') return 'Рейтинговая игра';
  return 'Учебная сессия';
}

function classroomStatus(status: ClassroomMatchInput['status']): CheckersUnifiedMatchStatus {
  if (status === 'pending') return 'waiting';
  if (status === 'active') return 'active';
  if (status === 'finished') return 'finished';
  return 'abandoned';
}

export function projectCheckersMatchSession(input: {
  readonly project: CheckersProjectDocument;
  readonly botPlayerSide: CheckersSide;
  readonly botPlayerSideKnown: boolean;
  readonly botThinking?: boolean;
}): CheckersMatchSessionView | null {
  const { project, botPlayerSide, botPlayerSideKnown, botThinking = false } = input;
  if (project.game.mode !== 'game') return null;
  const status = getCheckersSessionStatus(project.game);
  const common = {
    id: `legacy-personal:${project.activeMatch.mode}`,
    status,
    source: 'legacy-personal-project' as const,
    document: project.game,
    version: project.game.moveHistory.length,
    createdAt: project.education.lastActivityAt,
    updatedAt: project.education.lastActivityAt,
  };

  if (project.activeMatch.mode === 'local') {
    return {
      ...common,
      mode: 'local',
      viewerSide: null,
      modeLabel: 'Игра вдвоём · одно устройство',
      opponentLabel: 'Игрок 1 — светлые · Игрок 2 — тёмные',
      readOnly: status !== 'active',
      orientation: project.activeMatch.localAutoFlip ? project.game.sideToMove : 'light',
      autoFlipBoard: project.activeMatch.localAutoFlip,
      canRestart: true,
      canResign: status === 'active',
      canDraw: status === 'active',
      botId: null,
      botMode: null,
    };
  }

  const bot = CHECKERS_BOTS.find((item) => item.id === project.education.selectedBotId);
  const botName = bot?.displayName ?? 'Бот ASA';
  const viewerSide = botPlayerSideKnown ? botPlayerSide : null;
  return {
    ...common,
    mode: 'bot',
    viewerSide,
    modeLabel: `${
      project.education.activeBotMode === 'campaign' ? 'Лестница ASA Bot' : 'Свободная игра'
    } · ${botName}`,
    opponentLabel: botThinking ? `${botName} думает…` : botName,
    readOnly:
      status !== 'active' ||
      viewerSide === null ||
      botThinking ||
      project.game.sideToMove !== viewerSide,
    orientation: viewerSide ?? 'light',
    autoFlipBoard: false,
    canRestart: true,
    canResign: status === 'active' && viewerSide !== null,
    canDraw: false,
    botId: project.education.selectedBotId,
    botMode: project.education.activeBotMode,
  };
}

export function classroomCheckersMatchSession(game: ClassroomMatchInput): CheckersMatchSessionView {
  const status = classroomStatus(game.status);
  const opponent =
    game.side === 'light'
      ? game.darkPlayer.displayName
      : game.side === 'dark'
        ? game.lightPlayer.displayName
        : `${game.lightPlayer.displayName} — ${game.darkPlayer.displayName}`;
  const classModeLabel =
    game.mode === 'team'
      ? 'Командная цель'
      : game.mode === 'teacher-event'
        ? 'Матч педагога'
        : 'Игра класса';
  const statusLabel =
    status === 'finished'
      ? 'завершена'
      : status === 'active'
        ? 'в процессе'
        : status === 'abandoned'
          ? 'отклонена'
          : 'ожидание';
  return {
    id: game.id,
    mode: 'classroom',
    status,
    source: 'classroom-server',
    document: game.document,
    version: game.version,
    viewerSide: game.side,
    modeLabel: `${classModeLabel} · ${statusLabel}`,
    opponentLabel: opponent,
    readOnly: status !== 'active' || game.side === null || game.side !== game.document.sideToMove,
    orientation: game.side ?? 'light',
    autoFlipBoard: false,
    canRestart: false,
    canResign: false,
    canDraw: false,
    botId: null,
    botMode: null,
    createdAt: game.createdAt,
    updatedAt: game.updatedAt,
  };
}

export function serviceCheckersMatchSession(
  session: CheckersGameSession,
  viewerId: string,
  displayNames: Readonly<Record<string, string>> = {},
): CheckersMatchSessionView {
  const mode = sessionMode(session.mode);
  const viewer = session.players.find(
    (player) => player.kind === 'student' && player.participantId === viewerId,
  );
  const opponent = session.players.find((player) => player.participantId !== viewerId);
  const bot =
    opponent?.kind === 'bot' ? CHECKERS_BOTS.find((item) => item.id === opponent.botId) : null;
  const opponentLabel = opponent
    ? (bot?.displayName ?? displayNames[opponent.participantId] ?? 'Соперник')
    : 'Соперник';
  return {
    id: session.id,
    mode,
    status: session.status,
    source: 'session-service',
    document: session.document,
    version: session.version,
    viewerSide: viewer?.side ?? null,
    modeLabel: sessionModeLabel(mode),
    opponentLabel,
    readOnly:
      session.status !== 'active' ||
      viewer === undefined ||
      viewer.side !== session.document.sideToMove,
    orientation: viewer?.side ?? 'light',
    autoFlipBoard: false,
    canRestart: false,
    canResign: session.status === 'active' && viewer !== undefined && mode !== 'lesson',
    canDraw: false,
    botId: opponent?.kind === 'bot' ? opponent.botId : null,
    botMode: null,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

export function checkersMatchResultView(
  session: CheckersMatchSessionView | null,
): CheckersMatchResultView | null {
  if (!session || session.document.result === '*') return null;
  if (session.document.result === '1/2-1/2') {
    return { tone: 'draw', title: 'Ничья', detail: session.modeLabel };
  }
  if (session.mode === 'local' || session.viewerSide === null) {
    return {
      tone: 'win',
      title: session.document.result === '1-0' ? 'Победили светлые' : 'Победили тёмные',
      detail: session.modeLabel,
    };
  }
  const outcome = checkersOutcomeForSide(session.document.result, session.viewerSide);
  return {
    tone: outcome === 'win' ? 'win' : outcome === 'loss' ? 'loss' : 'draw',
    title:
      outcome === 'win'
        ? `Вы победили: ${session.opponentLabel}`
        : outcome === 'loss'
          ? `Победил: ${session.opponentLabel}`
          : 'Ничья',
    detail: `${session.modeLabel} · вы играли ${
      session.viewerSide === 'light' ? 'светлыми' : 'тёмными'
    }.`,
  };
}

export function checkersMatchResumeView(
  session: CheckersMatchSessionView | null,
): CheckersMatchResumeView | null {
  if (!session || session.status !== 'active' || session.updatedAt === null) return null;
  if (session.mode === 'local') {
    return {
      id: `resume:${session.id}`,
      title: 'Локальная партия',
      detail: `Игра вдвоём · ход ${
        session.document.sideToMove === 'light' ? 'светлых' : 'тёмных'
      } · ${session.autoFlipBoard ? 'автоповорот включён' : 'доска не поворачивается'}`,
    };
  }
  if (session.viewerSide === null) return null;
  return {
    id: `resume:${session.id}`,
    title: `Партия с ${session.opponentLabel}`,
    detail: `${session.modeLabel} · вы играете ${
      session.viewerSide === 'light' ? 'светлыми' : 'тёмными'
    } · ${session.document.sideToMove === session.viewerSide ? 'ваш ход' : 'ход соперника'}`,
  };
}

export function checkersMatchHistoryEntry(
  session: CheckersMatchSessionView | null,
): CheckersMatchHistoryEntry | null {
  if (!session || session.status !== 'finished' || session.document.result === '*') return null;
  return {
    id: session.id,
    mode: session.mode,
    result: session.document.result,
    opponentLabel: session.opponentLabel,
    moveCount: session.document.moveHistory.length,
    finishedAt: session.updatedAt,
  };
}
