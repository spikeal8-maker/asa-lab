import * as CheckersDomain from '@asa-lab/checkers';
import type {
  CheckersAnalysisSummary,
  CheckersAssignment,
  CheckersAssignmentKind,
  CheckersBotId,
  CheckersConceptProgress,
  CheckersDocument,
  CheckersLearningEvidence,
  CheckersLegalMove,
  CheckersProjectDocument,
  CheckersPuzzleAttempt,
} from '@asa-lab/checkers';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  api,
  type CheckersClassPlay,
  type CheckersSafetySignal,
  type CheckersTeacherFeedback,
  type CheckersTeacherFeedbackId,
  type Project,
  type PublicUser,
} from '../api';
import { newClientId } from '../client-id';
import {
  clearLocalProjectDraft,
  readLocalProjectDraft,
  writeLocalProjectDraft,
} from '../modules/project-local-draft';

const {
  CHECKERS_BOTS,
  CHECKERS_CONCEPT_IDS,
  applyCheckersLearningEvidence,
  applyCheckersGameMove,
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
  readonly assigneeKind: 'class' | 'student' | 'group';
  readonly assigneeIds: readonly string[];
  readonly attemptLimit: number | null;
  readonly requiredCompletions: number;
}

export interface CheckersClassroomStudentProgress {
  readonly id: string;
  readonly displayName: string;
  readonly email: string;
  readonly lastActivityAt: string | null;
  readonly progress: readonly CheckersConceptProgress[];
  readonly evidence: readonly CheckersLearningEvidence[];
  readonly completedPuzzleIds: readonly string[];
  readonly lastMove: {
    readonly ply: number;
    readonly path: readonly string[];
    readonly capturedIds: readonly string[];
  } | null;
  readonly revision: number;
  readonly updatedAt: string | null;
}

export interface CheckersClassroomOverview {
  readonly assignments: readonly CheckersAssignment[];
  readonly students: readonly CheckersClassroomStudentProgress[];
  readonly safetySignals: readonly CheckersSafetySignal[];
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
  const progressItem = document.education.progress.find(
    (item) => item.conceptId === 'full-game-planning',
  );
  const evidence: CheckersLearningEvidence | null = progressItem
    ? {
        id: `evidence-${newClientId()}`,
        studentId: progressItem.studentId,
        conceptId: 'full-game-planning',
        kind: 'game-demonstration',
        outcome: 'demonstrated',
        sourceId: `bot:${document.education.selectedBotId}`,
        occurredAt: nowIso(),
        firstAttempt: true,
        hintLevel: 0,
        transferPosition: true,
        score: 100,
      }
    : null;
  const updatedProgress =
    evidence && progressItem ? applyCheckersLearningEvidence(progressItem, evidence) : null;
  return {
    ...document,
    education: {
      ...document.education,
      unlockedBotRung,
      winsOnCurrentRung: mayUnlock ? 0 : wins,
      progress: updatedProgress?.ok
        ? document.education.progress.map((item) =>
            item.conceptId === progressItem?.conceptId ? updatedProgress.value : item,
          )
        : document.education.progress,
      evidence:
        evidence && updatedProgress?.ok
          ? [...document.education.evidence, evidence]
          : document.education.evidence,
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
  const [canManageClassroom, setCanManageClassroom] = useState(false);
  const [classroomOverview, setClassroomOverview] = useState<CheckersClassroomOverview | null>(
    null,
  );
  const [classPlay, setClassPlay] = useState<CheckersClassPlay<CheckersDocument> | null>(null);
  const [teacherFeedback, setTeacherFeedback] = useState<readonly CheckersTeacherFeedback[]>([]);
  const [saveStatus, setSaveStatus] = useState<CheckersSaveStatus>('saved');
  const saveStatusRef = useRef<CheckersSaveStatus>('saved');
  saveStatusRef.current = saveStatus;
  const [notice, setNotice] = useState<string | null>(null);
  const [botThinking, setBotThinking] = useState(false);
  const [botPlayerSide, setBotPlayerSide] = useState<'light' | 'dark'>('light');
  const saveTimer = useRef<number | null>(null);
  const botTask = useRef(0);
  const documentVersion = useRef(0);
  const saveQueue = useRef<CheckersSaveQueue | null>(null);
  saveQueue.current ??= createCheckersSaveQueue();
  const serverRevision = useRef<number | null>(null);
  const documentRef = useRef<CheckersProjectDocument | null>(null);

  const load = useCallback(async () => {
    setLoadState('loading');
    const [response, sessionResponse] = await Promise.all([
      api.openProject<CheckersProjectDocument, CheckersAnalysisSummary>(projectId),
      api.me(),
    ]);
    const canManage =
      sessionResponse.ok &&
      sessionResponse.data.authenticated &&
      sessionResponse.data.navigation.classroomManagement;
    setCanManageClassroom(canManage);
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
    let sourceDocument: unknown = response.data.draft.document;
    let loadedTeacherFeedback: readonly CheckersTeacherFeedback[] = [];
    if (response.data.project.scope === 'classroom' && !canManage) {
      const studentState = await api.loadCheckersStudentState<CheckersProjectDocument>(projectId);
      if (!studentState.ok) {
        setNotice(studentState.error.message || 'Не удалось загрузить прогресс ученика.');
        setLoadState('error');
        return;
      }
      sourceDocument = studentState.data.document;
      loadedTeacherFeedback = studentState.data.teacherFeedback;
    }
    const parsed = validateCheckersProjectDocument(sourceDocument);
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
    const usesProjectDraft = response.data.project.scope !== 'classroom' || canManage;
    const local = usesProjectDraft
      ? readLocalProjectDraft(window.localStorage, projectId, 'checkers')
      : null;
    const parsedLocal = local ? validateCheckersProjectDocument(local.document) : null;
    const restoredDocument = parsedLocal?.ok ? parsedLocal.value : normalized;
    const restored = parsedLocal?.ok === true;
    const revisionConflict = restored && local?.baseRevision !== response.data.draft.revision;
    documentVersion.current += 1;
    setProject(response.data.project);
    serverRevision.current =
      revisionConflict && local ? local.baseRevision : response.data.draft.revision;
    setProjectTitle(response.data.project.title);
    documentRef.current = restoredDocument;
    setDocument(restoredDocument);
    setAnalysis(response.data.result);
    setTeacherFeedback(loadedTeacherFeedback);
    if (response.data.project.scope === 'classroom' && canManage) {
      const overview = await api.checkersClassroom<
        CheckersAssignment,
        CheckersConceptProgress,
        CheckersLearningEvidence
      >(projectId);
      setClassroomOverview(
        overview.ok ? overview.data : { assignments: [], students: [], safetySignals: [] },
      );
    } else {
      setClassroomOverview(null);
    }
    if (response.data.project.scope === 'classroom') {
      const play = await api.loadCheckersClassPlay<CheckersDocument>(projectId);
      setClassPlay(
        play.ok
          ? play.data
          : { role: canManage ? 'owner' : 'student', muted: false, classmates: [], games: [] },
      );
    } else {
      setClassPlay(null);
    }
    setSaveStatus(revisionConflict ? 'error' : restored ? 'dirty' : 'saved');
    if (usesProjectDraft && !restored) clearLocalProjectDraft(window.localStorage, projectId);
    if (revisionConflict) {
      setNotice('На сервере есть более новая версия. Локальная партия сохранена в браузере.');
    } else if (restored) {
      setNotice('Восстановлены несохранённые изменения из этого браузера.');
    }
    setLoadState('ready');
  }, [projectId, user.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const persist = useCallback(
    async (next: CheckersProjectDocument, quiet = false): Promise<boolean> => {
      const versionAtStart = documentVersion.current;
      setSaveStatus('saving');
      const studentState = project?.scope === 'classroom' && !canManageClassroom;
      let savedDocument: unknown;
      let savedAnalysis = analysis;
      if (studentState) {
        const response = await saveQueue.current!.run(() =>
          api.saveCheckersStudentState<CheckersProjectDocument>(projectId, next),
        );
        if (!response.ok) {
          setSaveStatus('error');
          if (!quiet) setNotice(`Не удалось сохранить: ${response.error.message}`);
          return false;
        }
        savedDocument = response.data.document;
      } else {
        const response = await saveQueue.current!.run(() => {
          // A save ahead of this one may have advanced the revision while this
          // operation waited. Resolve the base only when the request can run.
          const baseRevision = serverRevision.current;
          return baseRevision === null
            ? Promise.resolve(null)
            : api.saveDraft<CheckersProjectDocument, CheckersAnalysisSummary>(
                projectId,
                next,
                baseRevision,
              );
        });
        if (response === null) {
          setSaveStatus('error');
          if (!quiet) setNotice('Не удалось определить сохранённую версию проекта.');
          return false;
        }
        if (!response.ok) {
          setSaveStatus('error');
          if (!quiet) setNotice(`Не удалось сохранить: ${response.error.message}`);
          return false;
        }
        savedDocument = response.data.draft.document;
        serverRevision.current = response.data.draft.revision;
        savedAnalysis = response.data.result;
      }
      const parsed = validateCheckersProjectDocument(savedDocument);
      if (!parsed.ok) {
        setSaveStatus('error');
        setNotice('Сервер вернул некорректный документ шашек.');
        return false;
      }
      if (documentVersion.current !== versionAtStart) {
        if (!studentState && documentRef.current && serverRevision.current !== null) {
          writeLocalProjectDraft(window.localStorage, {
            projectId,
            moduleKey: 'checkers',
            baseRevision: serverRevision.current,
            document: documentRef.current,
          });
        }
        setSaveStatus('dirty');
        return true;
      }
      documentRef.current = parsed.value;
      setDocument(parsed.value);
      if (!studentState) clearLocalProjectDraft(window.localStorage, projectId);
      setAnalysis(savedAnalysis);
      setSaveStatus('saved');
      if (!quiet) setNotice('Проект по шашкам сохранён.');
      return true;
    },
    [analysis, canManageClassroom, project?.scope, projectId],
  );

  const refreshClassroomOverview = useCallback(async (): Promise<boolean> => {
    const response = await api.checkersClassroom<
      CheckersAssignment,
      CheckersConceptProgress,
      CheckersLearningEvidence
    >(projectId);
    if (!response.ok) {
      setNotice(`Не удалось обновить класс: ${response.error.message}`);
      return false;
    }
    setClassroomOverview(response.data);
    return true;
  }, [projectId]);

  const refreshClassPlay = useCallback(async (): Promise<boolean> => {
    const response = await api.loadCheckersClassPlay<CheckersDocument>(projectId);
    if (!response.ok) {
      setNotice(`Не удалось обновить игры класса: ${response.error.message}`);
      return false;
    }
    setClassPlay(response.data);
    return true;
  }, [projectId]);

  const commit = useCallback(
    (next: CheckersProjectDocument, message?: string) => {
      documentVersion.current += 1;
      documentRef.current = next;
      const studentState = project?.scope === 'classroom' && !canManageClassroom;
      const baseRevision = serverRevision.current;
      if (!studentState && baseRevision !== null) {
        writeLocalProjectDraft(window.localStorage, {
          projectId,
          moduleKey: 'checkers',
          baseRevision,
          document: next,
        });
      }
      setDocument(next);
      setSaveStatus('dirty');
      if (message) setNotice(message);
    },
    [canManageClassroom, project?.scope, projectId],
  );

  useEffect(() => {
    if (!document || saveStatus !== 'dirty') return;
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void persist(document, true), 700);
    return () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    };
  }, [document, persist, saveStatus]);

  useEffect(() => {
    const flush = (): void => {
      const current = documentRef.current;
      if (current && saveStatusRef.current === 'dirty') void persist(current, true);
    };
    const onVisibility = (): void => {
      if (globalThis.document.visibilityState === 'hidden') flush();
    };
    globalThis.document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    return () => {
      globalThis.document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
    };
  }, [persist]);

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
    const applied = applyCheckersGameMove(document.game, {
      pieceId: move.pieceId,
      path: move.path,
    });
    if (!applied.ok) {
      setNotice(applied.message);
      return;
    }
    commitGame(applied.value, `Ход ${move.notation}.`);
  }

  useEffect(() => {
    if (
      !document ||
      document.game.mode !== 'game' ||
      document.game.result !== '*' ||
      document.game.sideToMove === botPlayerSide
    )
      return;
    const selected = CHECKERS_BOTS.find((bot) => bot.id === document.education.selectedBotId);
    if (!selected || selected.rung > document.education.unlockedBotRung) return;
    const taskId = botTask.current + 1;
    botTask.current = taskId;
    setBotThinking(true);
    let timer: number | null = null;
    let worker: Worker | null = null;
    const applyDecision = (decision: ReturnType<typeof chooseCheckersBotMove>): void => {
      if (botTask.current !== taskId) return;
      setBotThinking(false);
      if (!decision.ok) {
        setNotice(decision.message);
        return;
      }
      const applied = applyCheckersGameMove(document.game, {
        pieceId: decision.value.move.pieceId,
        path: decision.value.move.path,
      });
      if (applied.ok)
        commitGame(applied.value, `${selected.displayName}: ${decision.value.move.notation}`);
    };
    if (typeof Worker === 'function') {
      worker = new Worker(new URL('./checkers-bot.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<ReturnType<typeof chooseCheckersBotMove>>) =>
        applyDecision(event.data);
      worker.onerror = () => {
        worker?.terminate();
        worker = null;
        timer = window.setTimeout(
          () =>
            applyDecision(chooseCheckersBotMove(document.game, selected.id, { maxTimeMs: 650 })),
          0,
        );
      };
      worker.postMessage({ document: document.game, botId: selected.id, maxTimeMs: 650 });
    } else {
      timer = window.setTimeout(
        () => applyDecision(chooseCheckersBotMove(document.game, selected.id, { maxTimeMs: 650 })),
        0,
      );
    }
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      worker?.terminate();
      if (botTask.current === taskId) {
        botTask.current += 1;
        setBotThinking(false);
      }
    };
  }, [botPlayerSide, commitGame, document]);

  function startBotGame(
    botId: CheckersBotId,
    teacherOverride = false,
    playerSide: 'light' | 'dark' = 'light',
  ): boolean {
    if (!document) return false;
    const bot = CHECKERS_BOTS.find((item) => item.id === botId);
    if (!bot || (!teacherOverride && bot.rung > document.education.unlockedBotRung)) {
      setNotice('Этот соперник пока закрыт. Пройди задачи и победи предыдущего бота.');
      return false;
    }
    setBotPlayerSide(playerSide);
    commit(
      {
        ...document,
        game: createInitialCheckersDocument('game'),
        education: {
          ...document.education,
          selectedBotId: botId,
          unlockedBotRung: teacherOverride
            ? Math.max(document.education.unlockedBotRung, bot.rung)
            : document.education.unlockedBotRung,
          lastActivityAt: nowIso(),
        },
      },
      `Новая партия с ботом «${bot.displayName}». Ты играешь ${
        playerSide === 'light' ? 'светлыми' : 'тёмными'
      }.`,
    );
    return true;
  }

  function resignBotGame(): void {
    if (!document || document.game.mode !== 'game' || document.game.result !== '*') return;
    botTask.current += 1;
    setBotThinking(false);
    commitGame(
      { ...document.game, result: botPlayerSide === 'light' ? '0-1' : '1-0' },
      'Партия завершена. Можно открыть разбор или начать новую.',
    );
  }

  function openLesson(game: CheckersProjectDocument['game'], title: string): void {
    if (!document) return;
    commit(
      { ...document, game, education: { ...document.education, lastActivityAt: nowIso() } },
      `Открыта задача «${title}».`,
    );
  }

  function completePuzzle(
    attempt: CheckersPuzzleAttempt,
    conceptIds: readonly string[],
    transferPosition = false,
  ): void {
    if (!document) return;
    let progress = [...document.education.progress];
    const evidence: CheckersLearningEvidence[] = [];
    for (const conceptId of CHECKERS_CONCEPT_IDS.filter((id) => conceptIds.includes(id))) {
      const item = progress.find((candidate) => candidate.conceptId === conceptId);
      if (!item) continue;
      const event: CheckersLearningEvidence = {
        id: `evidence-${newClientId()}`,
        studentId: item.studentId,
        conceptId,
        kind: 'puzzle-attempt',
        outcome: 'correct',
        sourceId: attempt.puzzleId,
        occurredAt: nowIso(),
        firstAttempt: attempt.incorrectAttempts === 0,
        hintLevel: attempt.hintLevel,
        transferPosition,
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
          completedPuzzleIds: document.education.completedPuzzleIds.includes(attempt.puzzleId)
            ? document.education.completedPuzzleIds
            : [...document.education.completedPuzzleIds, attempt.puzzleId],
          progress,
          evidence: [...document.education.evidence, ...evidence],
          lastActivityAt: nowIso(),
        },
      },
      'Задача решена. Доказательство добавлено в учебный прогресс.',
    );
  }

  function recordPuzzleFailure(
    attempt: CheckersPuzzleAttempt,
    conceptIds: readonly string[],
    transferPosition = false,
  ): void {
    if (!document) return;
    let progress = [...document.education.progress];
    const evidence: CheckersLearningEvidence[] = [];
    for (const conceptId of CHECKERS_CONCEPT_IDS.filter((id) => conceptIds.includes(id))) {
      const item = progress.find((candidate) => candidate.conceptId === conceptId);
      if (!item) continue;
      const event: CheckersLearningEvidence = {
        id: `evidence-${newClientId()}`,
        studentId: item.studentId,
        conceptId,
        kind: 'puzzle-attempt',
        outcome: 'incorrect',
        sourceId: attempt.puzzleId,
        occurredAt: nowIso(),
        firstAttempt: attempt.incorrectAttempts === 1,
        hintLevel: attempt.hintLevel,
        transferPosition,
        score: 0,
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
        education: {
          ...document.education,
          progress,
          evidence: [...document.education.evidence, ...evidence],
          lastActivityAt: nowIso(),
        },
      },
      'Попытка сохранена. Ошибка станет темой короткого повторения, а не оценкой ученика.',
    );
  }

  async function createAssignment(input: CreateCheckersAssignmentInput): Promise<boolean> {
    if (!document || !project?.classroomId) {
      setNotice('Задания класса можно создавать только в проекте, привязанном к классу.');
      return false;
    }
    const assignment: CheckersAssignment = {
      id: `assignment-${newClientId()}`,
      classroomId: project.classroomId,
      teacherId: user.id,
      title: input.title.trim(),
      kind: input.kind,
      targetRef: input.targetRef,
      assigneeKind: input.assigneeKind,
      assigneeIds: input.assigneeIds,
      dueAt: input.dueAt,
      attemptLimit: input.attemptLimit,
      hintsAllowed: input.hintsAllowed,
      maxHintLevel: input.hintsAllowed ? 3 : 0,
      minimumScore: input.minimumScore,
      requiredCompletions: input.requiredCompletions,
      status: 'assigned',
    };
    const validated = validateCheckersAssignment(assignment);
    if (!validated.ok) {
      setNotice(validated.message);
      return false;
    }
    const next: CheckersProjectDocument = {
      ...document,
      education: {
        ...document.education,
        assignments: [...document.education.assignments, validated.value],
        lastActivityAt: nowIso(),
      },
    };
    const saved = await persist(next, true);
    if (saved) setNotice(`Задание «${assignment.title}» опубликовано в проекте класса.`);
    else setNotice('Задание не опубликовано: сервер не подтвердил сохранение. Попробуйте ещё раз.');
    return saved;
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

  async function enrolStudent(email: string): Promise<boolean> {
    const response = await api.enrolCheckersStudent(projectId, email);
    if (!response.ok) {
      setNotice(`Не удалось добавить ученика: ${response.error.message}`);
      return false;
    }
    await refreshClassroomOverview();
    setNotice(`Ученик ${response.data.student.display_name} добавлен в шашечный класс.`);
    return true;
  }

  async function createClassChallenge(
    opponentId: string,
    mode: 'friendly' | 'team' = 'friendly',
  ): Promise<boolean> {
    const response = await api.createCheckersChallenge(projectId, opponentId, mode);
    if (!response.ok) {
      setNotice(`Не удалось отправить вызов: ${response.error.message}`);
      return false;
    }
    await refreshClassPlay();
    setNotice('Вызов отправлен однокласснику. Свободного чата в игре нет.');
    return true;
  }

  async function createTeacherEvent(lightPlayerId: string, darkPlayerId: string): Promise<boolean> {
    const response = await api.createCheckersTeacherEvent(projectId, lightPlayerId, darkPlayerId);
    if (!response.ok) {
      setNotice(`Не удалось создать матч педагога: ${response.error.message}`);
      return false;
    }
    await refreshClassPlay();
    setNotice('Матч педагога создан. Оба ученика сразу увидят его в играх класса.');
    return true;
  }

  async function acceptClassChallenge(gameId: string): Promise<boolean> {
    const response = await api.acceptCheckersChallenge(projectId, gameId);
    if (!response.ok) {
      setNotice(`Не удалось принять вызов: ${response.error.message}`);
      return false;
    }
    await refreshClassPlay();
    setNotice('Вызов принят. Светлые ходят первыми.');
    return true;
  }

  async function playClassMove(
    gameId: string,
    expectedVersion: number,
    move: CheckersLegalMove,
  ): Promise<boolean> {
    const response = await api.playCheckersClassMove(projectId, gameId, {
      expectedVersion,
      pieceId: move.pieceId,
      path: move.path,
    });
    if (!response.ok) {
      setNotice(`Ход не принят: ${response.error.message}`);
      await refreshClassPlay();
      return false;
    }
    await refreshClassPlay();
    setNotice(`Ход ${move.notation} сохранён в партии класса.`);
    return true;
  }

  async function sendClassReaction(gameId: string, reactionId: string): Promise<boolean> {
    const response = await api.sendCheckersReaction(projectId, gameId, reactionId);
    if (!response.ok) {
      setNotice(`Реакция не отправлена: ${response.error.message}`);
      return false;
    }
    await refreshClassPlay();
    setNotice('Добрая реакция отправлена и записана в журнале класса.');
    return true;
  }

  async function setClassReactionsMuted(muted: boolean): Promise<boolean> {
    const response = await api.muteCheckersReactions(projectId, muted);
    if (!response.ok) {
      setNotice(`Не удалось изменить реакции: ${response.error.message}`);
      return false;
    }
    await refreshClassPlay();
    setNotice(muted ? 'Реакции скрыты у вас.' : 'Добрые реакции снова видны.');
    return true;
  }

  async function reportClassReaction(gameId: string, reactionEventId: string): Promise<boolean> {
    const response = await api.reportCheckersReaction(projectId, gameId, reactionEventId);
    if (!response.ok) {
      setNotice(`Не удалось передать сигнал педагогу: ${response.error.message}`);
      return false;
    }
    setNotice('Сигнал передан педагогу без свободного текста.');
    return true;
  }

  async function sendTeacherFeedback(
    studentId: string,
    feedbackId: CheckersTeacherFeedbackId,
  ): Promise<boolean> {
    const response = await api.sendCheckersTeacherFeedback(projectId, studentId, feedbackId);
    if (!response.ok) {
      setNotice(`Не удалось сохранить рекомендацию: ${response.error.message}`);
      return false;
    }
    setNotice('Учебная рекомендация отправлена ученику и сохранена в журнале класса.');
    return true;
  }

  return {
    project,
    projectTitle,
    document,
    analysis,
    canManageClassroom,
    classroomOverview,
    classPlay,
    teacherFeedback,
    loadState,
    saveStatus,
    notice,
    botThinking,
    botPlayerSide,
    legalMoves,
    setNotice,
    playMove,
    startBotGame,
    resignBotGame,
    openLesson,
    completePuzzle,
    recordPuzzleFailure,
    createAssignment,
    toggleReactions,
    renameProject,
    enrolStudent,
    refreshClassroomOverview,
    refreshClassPlay,
    createClassChallenge,
    createTeacherEvent,
    acceptClassChallenge,
    playClassMove,
    sendClassReaction,
    setClassReactionsMuted,
    reportClassReaction,
    sendTeacherFeedback,
    resetGame: () => document && commitGame(createInitialCheckersDocument(document.game.mode)),
    saveNow: () => (document ? persist(document) : Promise.resolve(false)),
    reload: load,
  };
}
