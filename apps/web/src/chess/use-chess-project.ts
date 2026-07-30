import {
  agreeDrawChessDocument,
  chessDocumentPositionKeys,
  chooseChessBotMove,
  createChessGameDocument,
  evaluateChessPosition,
  exportChessPgn,
  flagChessTimeout,
  generateLegalMoves,
  getChessStatus,
  importChessPgn,
  moveToUci,
  opposite,
  parseFen,
  playChessDocumentMove,
  resetChessDocument,
  resignChessDocument,
  undoChessDocumentMove,
  validateChessDocument,
  type ChessAnalysisSummary,
  type ChessDocument,
  type ChessMove,
  type ChessPosition,
  type ChessStatus,
  type Color,
  type NewChessGameOptions,
  type Square,
} from '@asa-lab/chess';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type Project, type ProjectVersion } from '../api';

export type ChessSaveStatus = 'saved' | 'dirty' | 'saving' | 'error';

export interface PromotionRequest {
  readonly from: Square;
  readonly to: Square;
  readonly moves: readonly ChessMove[];
}

function parsePosition(fen: string): ChessPosition | null {
  const parsed = parseFen(fen);
  return parsed.ok ? parsed.value : null;
}

export function useChessProject(projectId: string) {
  const [project, setProject] = useState<Project | null>(null);
  const [document, setDocument] = useState<ChessDocument | null>(null);
  const [analysis, setAnalysis] = useState<ChessAnalysisSummary | null>(null);
  const [versions, setVersions] = useState<ProjectVersion[]>([]);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [saveStatus, setSaveStatus] = useState<ChessSaveStatus>('saved');
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  const [promotion, setPromotion] = useState<PromotionRequest | null>(null);
  const [botThinking, setBotThinking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [projectTitle, setProjectTitle] = useState('');
  const [clockTick, setClockTick] = useState(0);

  const autosaveTimerRef = useRef<number | null>(null);
  const turnStartedAtRef = useRef(Date.now());
  const timeoutCommittedRef = useRef(false);
  const botTaskRef = useRef(0);

  const position = useMemo(
    () => (document ? parsePosition(document.currentFen) : null),
    [document],
  );
  const legalMoves = useMemo(
    () => (position ? generateLegalMoves(position) : []),
    [position],
  );
  const chessStatus: ChessStatus | null = useMemo(
    () =>
      position && document
        ? getChessStatus(position, chessDocumentPositionKeys(document))
        : null,
    [document, position],
  );
  const evaluationCp = useMemo(
    () => (position ? evaluateChessPosition(position) : 0),
    [position],
  );
  const selectedMoves = useMemo(
    () => legalMoves.filter((move) => move.from === selectedSquare),
    [legalMoves, selectedSquare],
  );

  const load = useCallback(async () => {
    setLoadState('loading');
    const response = await api.openProject<ChessDocument, ChessAnalysisSummary>(projectId);
    if (!response.ok) {
      setNotice(response.error.message || 'Не удалось открыть шахматный проект.');
      setLoadState('error');
      return;
    }
    if (response.data.project.moduleKey !== 'chess') {
      setNotice('Проект не относится к модулю ASA Chess.');
      setLoadState('error');
      return;
    }
    const parsed = validateChessDocument(response.data.draft.document);
    if (!parsed.ok) {
      setNotice(`Повреждён шахматный документ: ${parsed.message}`);
      setLoadState('error');
      return;
    }
    setProject(response.data.project);
    setProjectTitle(response.data.project.title);
    setDocument(parsed.value);
    setAnalysis(response.data.result);
    setVersions(response.data.versions);
    setSaveStatus('saved');
    setSelectedSquare(null);
    setPromotion(null);
    setLoadState('ready');
    turnStartedAtRef.current = Date.now();
    timeoutCommittedRef.current = false;
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const persist = useCallback(
    async (next: ChessDocument, quiet = false): Promise<boolean> => {
      setSaveStatus('saving');
      const response = await api.saveDraft<ChessDocument, ChessAnalysisSummary>(projectId, next);
      if (!response.ok) {
        setSaveStatus('error');
        if (!quiet) setNotice(`Не удалось сохранить: ${response.error.message}`);
        return false;
      }
      setDocument(response.data.draft.document);
      setAnalysis(response.data.result);
      setSaveStatus('saved');
      if (!quiet) setNotice('Шахматный проект сохранён.');
      return true;
    },
    [projectId],
  );

  const commit = useCallback((next: ChessDocument, message?: string) => {
    setDocument(next);
    setSaveStatus('dirty');
    setSelectedSquare(null);
    setPromotion(null);
    if (message) setNotice(message);
    turnStartedAtRef.current = Date.now();
    timeoutCommittedRef.current = false;
  }, []);

  useEffect(() => {
    if (!document || saveStatus !== 'dirty') return;
    if (autosaveTimerRef.current !== null) window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = window.setTimeout(() => {
      void persist(document, true);
    }, 1000);
    return () => {
      if (autosaveTimerRef.current !== null) window.clearTimeout(autosaveTimerRef.current);
    };
  }, [document, persist, saveStatus]);

  useEffect(() => {
    if (!document?.clock || document.result !== '*' || !position) return;
    const timer = window.setInterval(() => {
      setClockTick((value) => value + 1);
      const elapsed = Date.now() - turnStartedAtRef.current;
      const remaining =
        position.turn === 'white'
          ? document.clock!.whiteMs - elapsed
          : document.clock!.blackMs - elapsed;
      if (remaining <= 0 && !timeoutCommittedRef.current) {
        timeoutCommittedRef.current = true;
        commit(flagChessTimeout(document, position.turn), 'Время истекло.');
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, [commit, document, position]);

  useEffect(() => {
    if (
      !document ||
      !position ||
      document.mode !== 'computer' ||
      document.result !== '*' ||
      document.bot?.color !== position.turn
    ) {
      return;
    }

    const taskId = botTaskRef.current + 1;
    botTaskRef.current = taskId;
    setBotThinking(true);
    const timer = window.setTimeout(() => {
      if (botTaskRef.current !== taskId) return;
      const choice = chooseChessBotMove(position, document.bot?.level ?? 2);
      if (!choice) {
        setBotThinking(false);
        return;
      }
      const next = playChessDocumentMove(document, choice.uci, 0);
      setBotThinking(false);
      if (next.ok) {
        commit(next.value, `ASA Bot: ${next.value.moves.at(-1)?.san ?? choice.uci}`);
      } else {
        setNotice(`ASA Bot не смог сделать ход: ${next.message}`);
      }
    }, 300);

    return () => {
      window.clearTimeout(timer);
      if (botTaskRef.current === taskId) {
        botTaskRef.current += 1;
        setBotThinking(false);
      }
    };
  }, [commit, document, position]);

  function displayClock(color: Color): number | null {
    void clockTick;
    if (!document?.clock) return null;
    const base = color === 'white' ? document.clock.whiteMs : document.clock.blackMs;
    if (!position || document.result !== '*' || position.turn !== color) return base;
    return Math.max(0, base - (Date.now() - turnStartedAtRef.current));
  }

  function canHumanMove(): boolean {
    if (!document || !position || document.result !== '*' || botThinking) return false;
    return document.mode !== 'computer' || document.bot?.color !== position.turn;
  }

  function executeMove(move: ChessMove): void {
    if (!document || !position || !canHumanMove()) return;
    const elapsed = document.clock ? Date.now() - turnStartedAtRef.current : 0;
    const next = playChessDocumentMove(document, moveToUci(move), elapsed);
    if (!next.ok) {
      setNotice(next.message);
      return;
    }
    commit(next.value, `Ход ${next.value.moves.at(-1)?.san ?? moveToUci(move)}.`);
  }

  function selectBoardSquare(square: Square): void {
    if (!document || !position || !canHumanMove()) return;
    const clickedPiece = position.board[
      (Number(square[1]) - 1) * 8 + (square.charCodeAt(0) - 97)
    ];
    if (!selectedSquare) {
      if (clickedPiece?.color === position.turn) setSelectedSquare(square);
      return;
    }
    const candidates = legalMoves.filter(
      (move) => move.from === selectedSquare && move.to === square,
    );
    if (candidates.length === 1) {
      executeMove(candidates[0]!);
      return;
    }
    if (candidates.length > 1) {
      setPromotion({ from: selectedSquare, to: square, moves: candidates });
      return;
    }
    setSelectedSquare(clickedPiece?.color === position.turn ? square : null);
  }

  function moveFromTo(from: Square, to: Square): void {
    const candidates = legalMoves.filter((move) => move.from === from && move.to === to);
    if (candidates.length === 1) executeMove(candidates[0]!);
    else if (candidates.length > 1) setPromotion({ from, to, moves: candidates });
    else setSelectedSquare(from);
  }

  function choosePromotion(move: ChessMove): void {
    executeMove(move);
  }

  function startGame(options: NewChessGameOptions): void {
    const next = createChessGameDocument(options);
    commit(
      next,
      options.mode === 'analysis'
        ? 'Открыта доска анализа.'
        : `Начата новая партия ${Math.round((options.initialMs ?? 600000) / 60000)}+${Math.round((options.incrementMs ?? 5000) / 1000)}.`,
    );
  }

  function undo(): void {
    if (!document || document.moves.length === 0) return;
    let next = undoChessDocumentMove(document);
    if (document.mode === 'computer' && next.moves.length > 0) {
      next = undoChessDocumentMove(next);
    }
    commit(next, 'Последний ход отменён.');
  }

  function reset(): void {
    if (!document) return;
    commit(resetChessDocument(document), 'Позиция возвращена к началу.');
  }

  function flip(): void {
    if (!document) return;
    commit(
      { ...document, orientation: document.orientation === 'white' ? 'black' : 'white' },
      'Доска перевёрнута.',
    );
  }

  function resign(): void {
    if (!document || !position) return;
    const loser =
      document.mode === 'computer' && document.bot
        ? opposite(document.bot.color)
        : position.turn;
    const next = resignChessDocument(document, loser);
    if (next.ok) commit(next.value, 'Партия завершена сдачей.');
  }

  function agreeDraw(): void {
    if (!document) return;
    const next = agreeDrawChessDocument(document);
    if (next.ok) commit(next.value, 'Зафиксирована ничья по соглашению.');
  }

  async function saveNow(): Promise<void> {
    if (!document || busy) return;
    setBusy(true);
    await persist(document);
    setBusy(false);
  }

  async function checkpoint(): Promise<void> {
    if (!document || busy) return;
    setBusy(true);
    const saved = await persist(document, true);
    const response = saved
      ? await api.createCheckpoint(
          projectId,
          `Позиция после ${document.moves.length} полуходов`,
        )
      : null;
    setBusy(false);
    if (response?.ok) {
      setVersions((current) => [response.data.version, ...current]);
      setNotice(`Создана неизменяемая версия №${response.data.version.versionNo}.`);
    } else {
      setNotice('Не удалось создать версию партии.');
    }
  }

  async function renameProject(): Promise<void> {
    if (!project) return;
    const trimmed = projectTitle.trim();
    if (!trimmed || trimmed === project.title) {
      setProjectTitle(project.title);
      return;
    }
    const response = await api.renameProject(project.id, trimmed);
    if (response.ok) {
      setProject(response.data.project);
      setProjectTitle(response.data.project.title);
      setNotice('Название шахматного проекта изменено.');
    } else {
      setProjectTitle(project.title);
      setNotice('Не удалось изменить название проекта.');
    }
  }

  function importPgn(pgn: string): boolean {
    const parsed = importChessPgn(pgn);
    if (!parsed.ok) {
      setNotice(`PGN не импортирован: ${parsed.message}`);
      return false;
    }
    commit(parsed.value, 'PGN импортирован в доску анализа.');
    return true;
  }

  function importFen(fen: string): boolean {
    const parsed = parseFen(fen);
    if (!parsed.ok) {
      setNotice(`FEN не импортирован: ${parsed.message}`);
      return false;
    }
    const next = createChessGameDocument({ mode: 'analysis' });
    commit(
      {
        ...next,
        initialFen: fen.trim(),
        currentFen: fen.trim(),
        headers: { ...next.headers, SetUp: '1', FEN: fen.trim() },
      },
      'FEN импортирован в доску анализа.',
    );
    return true;
  }

  return {
    project,
    projectTitle,
    setProjectTitle,
    document,
    position,
    analysis,
    evaluationCp,
    chessStatus,
    legalMoves,
    selectedSquare,
    selectedMoves,
    promotion,
    botThinking,
    versions,
    loadState,
    saveStatus,
    notice,
    busy,
    canHumanMove: canHumanMove(),
    displayClock,
    selectBoardSquare,
    moveFromTo,
    choosePromotion,
    cancelPromotion: () => setPromotion(null),
    startGame,
    undo,
    reset,
    flip,
    resign,
    agreeDraw,
    saveNow,
    checkpoint,
    renameProject,
    importPgn,
    importFen,
    exportPgn: () => (document ? exportChessPgn(document) : ''),
    clearNotice: () => setNotice(null),
  };
}
