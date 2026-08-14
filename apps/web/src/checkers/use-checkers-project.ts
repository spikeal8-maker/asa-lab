import * as CheckersDomain from '@asa-lab/checkers';
import type {
  CheckersAnalysisSummary,
  CheckersAssignment,
  CheckersAssignmentKind,
  CheckersBotId,
  CheckersLearningEvidence,
  CheckersLegalMove,
  CheckersProjectDocument,
  CheckersPuzzleAttempt,
} from '@asa-lab/checkers';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type Project, type PublicUser } from '../api';

const {
  CHECKERS_BOTS,
  CHECKERS_CONCEPT_IDS,
  applyCheckersLearningEvidence,
  applyCheckersMove,
  chooseCheckersBotMove,
  createInitialCheckersDocument,
  generateLegalCheckersMoves,
  validateCheckersAssignment,
  validateCheckersProjectDocument,
} = CheckersDomain;

export type CheckersSaveStatus = 'saved' | 'dirty' | 'saving' | 'error';

export interface CheckersSaveQueue {
  run<T>(operation: () => Promise<T>): Promise<T>;
}

export function createCheckersSaveQueue(): CheckersSaveQueue {
  let tail: Promise<void> = Promise.resolve();
  return {
    run<T>(operation: () => Promise<T>): Promise<T> {
      const result = tail.then(operation);
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
}

export interface CreateCheckersAssignmentInput {
  readonly title: string;
  readonly kind: CheckersAssignmentKind;
  readonly targetRef: string;
  readonly dueAt: string | null;
  readonly hintsAllowed: boolean;
  readonly minimumScore: number;
}

function nowIso(): string {
  return new Date().toISOString();
}

function progressionAfterWin(document: CheckersProjectDocument): CheckersProjectDocument {
  if (document.game.result !== '1-0') return document;
  const wins = document.education.winsOnCurrentRung + 1;
  const mayUnlock =
    wins >= 2 && document.education.completedPuzzleIds.length >= document.education.unlockedBotRung;
  const unlockedBotRung = mayUnlock
    ? Math.min(CHECKERS_BOTS.length, document.education.unlockedBotRung + 1)
    : document.education.unlockedBotRung;
  return {
    ...document,
    education: {
      ...document.education,
      unlockedBotRung,
      winsOnCurrentRung: mayUnlock ? 0 : wins,
      lastActivityAt: nowIso(),
    },
  };
}

export function useCheckersProject(projectId: string, user: PublicUser) {
  const [project, setProject] = useState<Project | null>(null);
  const [projectTitle, setProjectTitle] = useState('');
  const [document, setDocument] = useState<CheckersProjectDocument | null>(null);
  const [analysis, setAnalysis] = useState<CheckersAnalysisSummary | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [saveStatus, setSaveStatus] = useState<CheckersSaveStatus>('saved');
  const [notice, setNotice] = useState<string | null>(null);
  const [botThinking, setBotThinking] = useState(false);
  const saveTimer = useRef<number | null>(null);
  const botTask = useRef(0);
  const saveQueue = useRef<CheckersSaveQueue | null>(null);
  saveQueue.current ??= createCheckersSaveQueue();

  const load = useCallback(async () => {
    setLoadState('loading');
    const response = await api.openProject<CheckersProjectDocument, CheckersAnalysisSummary>(
      projectId,
    );
    if (!response.ok) {
      setNotice(response.error.message || 'Не удалось открыть проект по шашкам.');
      setLoadState('error');
      return;
    }
    if (response.data.project.moduleKey !== 'checkers') {
      setNotice('Этот проект не относится к модулю ASA Шашки.');
      setLoadState('error');
      return;
    }
    const parsed = validateCheckersProjectDocument(response.data.draft.document);
    if (!parsed.ok) {
      setNotice(`Документ шашек повреждён: ${parsed.message}`);
      setLoadState('error');
      return;
    }
    const normalized: CheckersProjectDocument = {
      ...parsed.value,
      education: {
        ...parsed.value.education,
        progress: parsed.value.education.progress.map((item) => ({
          ...item,
          studentId: item.studentId === 'project-owner' ? user.id : item.studentId,
        })),
      },
    };
    setProject(response.data.project);
    setProjectTitle(response.data.project.title);
    setDocument(normalized);
    setAnalysis(response.data.result);
    setSaveStatus('saved');
    setLoadState('ready');
  }, [projectId, user.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const persist = useCallback(
    async (next: CheckersProjectDocument, quiet = false): Promise<boolean> => {
      setSaveStatus('saving');
      const response = await saveQueue.current!.run(() =>
        api.saveDraft<CheckersProjectDocument, CheckersAnalysisSummary>(projectId, next),
      );
      if (!response.ok) {
        setSaveStatus('error');
        if (!quiet) setNotice(`Не удалось сохранить: ${response.error.message}`);
        return false;
      }
      const parsed = validateCheckersProjectDocument(response.data.draft.document);
      if (!parsed.ok) {
        setSaveStatus('error');
        setNotice('Сервер вернул некорректный документ шашек.');
        return false;
      }
      setDocument(parsed.value);
      setAnalysis(response.data.result);
      setSaveStatus('saved');
      if (!quiet) setNotice('Проект по шашкам сохранён.');
      return true;
    },
    [projectId],
  );

  const commit = useCallback((next: CheckersProjectDocument, message?: string) => {
    setDocument(next);
    setSaveStatus('dirty');
    if (message) setNotice(message);
  }, []);

  useEffect(() => {
    if (!document || saveStatus !== 'dirty') return;
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void persist(document, true), 700);
    return () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    };
  }, [document, persist, saveStatus]);

  const legalMoves = useMemo(
    () => (document?.game.result === '*' ? generateLegalCheckersMoves(document.game) : []),
    [document],
  );

  const commitGame = useCallback(
    (game: CheckersProjectDocument['game'], message?: string) => {
      if (!document) return;
      let next: CheckersProjectDocument = {
        ...document,
        game,
        education: { ...document.education, lastActivityAt: nowIso() },
      };
      if (document.game.result === '*' && game.result === '1-0') next = progressionAfterWin(next);
      commit(next, message);
    },
    [commit, document],
  );

  function playMove(move: CheckersLegalMove): void {
    if (!document || botThinking) return;
    const applied = applyCheckersMove(document.game, { pieceId: move.pieceId, path: move.path });
    if (!applied.ok) {
      setNotice(applied.message);
      return;
    }
    commitGame(applied.value, `Ход ${move.notation}.`);
  }

  useEffect(() => {
    if (!document || document.game.result !== '*' || document.game.sideToMove !== 'dark') return;
    const selected = CHECKERS_BOTS.find((bot) => bot.id === document.education.selectedBotId);
    if (!selected || selected.rung > document.education.unlockedBotRung) return;
    const taskId = botTask.current + 1;
    botTask.current = taskId;
    setBotThinking(true);
    const timer = window.setTimeout(() => {
      if (botTask.current !== taskId) return;
      const decision = chooseCheckersBotMove(document.game, selected.id, { maxTimeMs: 650 });
      setBotThinking(false);
      if (!decision.ok) {
        setNotice(decision.message);
        return;
      }
      const applied = applyCheckersMove(document.game, {
        pieceId: decision.value.move.pieceId,
        path: decision.value.move.path,
      });
      if (applied.ok)
        commitGame(applied.value, `${selected.displayName}: ${decision.value.move.notation}`);
    }, 320);
    return () => {
      window.clearTimeout(timer);
      if (botTask.current === taskId) {
        botTask.current += 1;
        setBotThinking(false);
      }
    };
  }, [commitGame, document]);

  function startBotGame(botId: CheckersBotId): boolean {
    if (!document) return false;
    const bot = CHECKERS_BOTS.find((item) => item.id === botId);
    if (!bot || bot.rung > document.education.unlockedBotRung) {
      setNotice('Этот соперник пока закрыт. Пройди задачи и победи предыдущего бота.');
      return false;
    }
    commit(
      {
        ...document,
        game: createInitialCheckersDocument('game'),
        education: { ...document.education, selectedBotId: botId, lastActivityAt: nowIso() },
      },
      `Новая партия с ботом «${bot.displayName}». Ты играешь светлыми.`,
    );
    return true;
  }

  function openLesson(game: CheckersProjectDocument['game'], title: string): void {
    if (!document) return;
    commit(
      { ...document, game, education: { ...document.education, lastActivityAt: nowIso() } },
      `Открыта задача «${title}».`,
    );
  }

  function completePuzzle(attempt: CheckersPuzzleAttempt, conceptIds: readonly string[]): void {
    if (!document || document.education.completedPuzzleIds.includes(attempt.puzzleId)) return;
    let progress = [...document.education.progress];
    const evidence: CheckersLearningEvidence[] = [];
    for (const conceptId of CHECKERS_CONCEPT_IDS.filter((id) => conceptIds.includes(id))) {
      const item = progress.find((candidate) => candidate.conceptId === conceptId);
      if (!item) continue;
      const event: CheckersLearningEvidence = {
        id: `evidence-${crypto.randomUUID()}`,
        studentId: item.studentId,
        conceptId,
        kind: 'puzzle-attempt',
        outcome: 'correct',
        sourceId: attempt.puzzleId,
        occurredAt: nowIso(),
        firstAttempt: attempt.incorrectAttempts === 0,
        hintLevel: attempt.hintLevel,
        transferPosition: false,
        score: Math.max(60, 100 - attempt.incorrectAttempts * 10 - attempt.hintLevel * 4),
      };
      const updated = applyCheckersLearningEvidence(item, event);
      if (updated.ok) {
        progress = progress.map((candidate) =>
          candidate.conceptId === conceptId ? updated.value : candidate,
        );
        evidence.push(event);
      }
    }
    commit(
      {
        ...document,
        game: attempt.document,
        education: {
          ...document.education,
          completedPuzzleIds: [...document.education.completedPuzzleIds, attempt.puzzleId],
          progress,
          evidence: [...document.education.evidence, ...evidence],
          lastActivityAt: nowIso(),
        },
      },
      'Задача решена. Доказательство добавлено в учебный прогресс.',
    );
  }

  function createAssignment(input: CreateCheckersAssignmentInput): boolean {
    if (!document || !project?.classroomId) {
      setNotice('Задания класса можно создавать только в проекте, привязанном к классу.');
      return false;
    }
    const assignment: CheckersAssignment = {
      id: `assignment-${crypto.randomUUID()}`,
      classroomId: project.classroomId,
      teacherId: user.id,
      title: input.title.trim(),
      kind: input.kind,
      targetRef: input.targetRef,
      assigneeKind: 'class',
      assigneeIds: [project.classroomId],
      dueAt: input.dueAt,
      attemptLimit: null,
      hintsAllowed: input.hintsAllowed,
      maxHintLevel: input.hintsAllowed ? 3 : 0,
      minimumScore: input.minimumScore,
      requiredCompletions: 1,
      status: 'assigned',
    };
    const validated = validateCheckersAssignment(assignment);
    if (!validated.ok) {
      setNotice(validated.message);
      return false;
    }
    commit(
      {
        ...document,
        education: {
          ...document.education,
          assignments: [...document.education.assignments, validated.value],
          lastActivityAt: nowIso(),
        },
      },
      `Задание «${assignment.title}» опубликовано в проекте класса.`,
    );
    return true;
  }

  function toggleReactions(): void {
    if (!document) return;
    const reactionsEnabled = !document.education.reactionsEnabled;
    commit(
      {
        ...document,
        education: { ...document.education, reactionsEnabled, lastActivityAt: nowIso() },
      },
      reactionsEnabled ? 'Добрые реакции снова доступны.' : 'Реакции скрыты для этой сессии.',
    );
  }

  async function renameProject(title: string): Promise<void> {
    if (!project) return;
    const trimmed = title.trim();
    if (!trimmed || trimmed === project.title) {
      setProjectTitle(project.title);
      return;
    }
    const response = await api.renameProject(project.id, trimmed);
    if (response.ok) {
      setProject(response.data.project);
      setProjectTitle(response.data.project.title);
      setNotice('Название проекта изменено.');
    } else {
      setProjectTitle(project.title);
      setNotice('Не удалось изменить название проекта.');
    }
  }

  return {
    project,
    projectTitle,
    document,
    analysis,
    loadState,
    saveStatus,
    notice,
    botThinking,
    legalMoves,
    setNotice,
    playMove,
    startBotGame,
    openLesson,
    completePuzzle,
    createAssignment,
    toggleReactions,
    renameProject,
    resetGame: () => document && commitGame(createInitialCheckersDocument(document.game.mode)),
    saveNow: () => (document ? persist(document) : Promise.resolve(false)),
    reload: load,
  };
}
