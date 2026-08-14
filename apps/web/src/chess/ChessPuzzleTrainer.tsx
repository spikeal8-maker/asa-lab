import {
  ASA_CHESS_LESSONS,
  ASA_CHESS_PUZZLES,
  chessLearningAttempt,
  chessPuzzleSessionFromAttempt,
  generateLegalMoves,
  moveToUci,
  parseFen,
  recommendChessLesson,
  recordChessPuzzleHint,
  recordChessPuzzleMove,
  recordChessPuzzleRetry,
  solvedChessPuzzleCount,
  selectChessLearningPuzzle,
  validateChessDocument,
  type ChessDocument,
  type ChessLesson,
  type ChessMove,
  type ChessPuzzle,
  type ChessPuzzleSession,
  type Square,
} from '@asa-lab/chess';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type PublicUser } from '../api';
import { ChessBoard } from './ChessBoard';
import { ChessSectionHeader } from './ChessSectionHeader';
import { createChessSaveQueue } from './use-chess-project';

interface ChessPuzzleTrainerProps {
  readonly projectId: string;
  readonly user: PublicUser;
  readonly onExit: () => void;
  readonly onBackToProject: () => void;
  readonly initialSection?: 'puzzles' | 'learning';
  readonly onOpenPuzzles?: () => void;
}

type SaveState = 'loading' | 'saved' | 'saving' | 'error';

// Contract markers: recordChessPuzzleMove and recordChessPuzzleHint delegate
// to playChessPuzzleMove and requestChessPuzzleHint in the Chess domain.
// Legacy candidate markers retained without exposing implementation language in the UI:
// ASA Chess · Тренировка; не является копией базы задач Chess.com.

function safePosition(session: ChessPuzzleSession) {
  const parsed = parseFen(session.currentFen);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.value;
}

function operationId(kind: 'move' | 'hint' | 'retry', serial: number): string {
  return `web-${kind}-${Date.now()}-${serial}`;
}

function ProgressDots({
  total,
  cursor,
  status,
}: {
  total: number;
  cursor: number;
  status: string;
}) {
  return (
    <div
      className="asa-puzzle-progress"
      role="progressbar"
      aria-label={`Пройдено ${cursor} из ${total} полуходов`}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={cursor}
    >
      {Array.from({ length: total }, (_, index) => (
        <span
          key={index}
          className={
            index < cursor ? 'complete' : index === cursor && status === 'active' ? 'current' : ''
          }
        />
      ))}
    </div>
  );
}

function LessonPanel({
  lesson,
  user,
  onExit,
  onHome,
  onClose,
}: {
  readonly lesson: ChessLesson;
  readonly user: PublicUser;
  readonly onExit: () => void;
  readonly onHome: () => void;
  readonly onClose: () => void;
}) {
  return (
    <main className="asa-puzzle-shell">
      <ChessSectionHeader
        user={user}
        title={lesson.title}
        status={{
          kind: 'saved',
          label: `${lesson.steps.length} шага`,
          detail: `Оригинальный урок ASA · версия ${lesson.contentVersion}`,
        }}
        onExit={onExit}
        onHome={onHome}
        actions={[{ id: 'back-to-puzzles', label: 'К задачам', onActivate: onClose }]}
      />
      <section className="asa-lesson-card" aria-label={`Урок: ${lesson.title}`}>
        <p className="asa-lesson-summary">{lesson.summary}</p>
        <ol>
          {lesson.steps.map((step) => (
            <li key={step.id}>
              <h2>{step.title}</h2>
              <p>{step.text}</p>
              <small>Поля для проверки: {step.focusSquares.join(', ')}</small>
            </li>
          ))}
        </ol>
        <p className="asa-puzzle-disclaimer">
          Материал создан редакцией ASA Lab · версия {lesson.contentVersion} · лицензия
          ASA-Lab-Original.
        </p>
      </section>
    </main>
  );
}

export function ChessPuzzleTrainer({
  projectId,
  user,
  onExit,
  onBackToProject,
  initialSection = 'puzzles',
  onOpenPuzzles,
}: ChessPuzzleTrainerProps) {
  const [document, setDocument] = useState<ChessDocument | null>(null);
  const [puzzleIndex, setPuzzleIndex] = useState(0);
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  const [notice, setNotice] = useState(
    'Найдите лучший ход за сторону, которой принадлежит очередь.',
  );
  const [hint, setHint] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('loading');
  const [lesson, setLesson] = useState<ChessLesson | null>(null);
  const saveQueue = useRef(createChessSaveQueue());
  const serial = useRef(0);

  const puzzle: ChessPuzzle = ASA_CHESS_PUZZLES[puzzleIndex] ?? ASA_CHESS_PUZZLES[0]!;
  const attempt = document ? chessLearningAttempt(document.learning, puzzle) : null;
  const session = attempt ? chessPuzzleSessionFromAttempt(attempt) : null;
  const position = useMemo(() => (session ? safePosition(session) : null), [session]);
  const legalMoves = useMemo(() => (position ? generateLegalMoves(position) : []), [position]);
  const selectedMoves = useMemo(
    () => legalMoves.filter((move) => move.from === selectedSquare),
    [legalMoves, selectedSquare],
  );
  const recommendedLesson = useMemo(
    () =>
      document
        ? recommendChessLesson(document.learning, ASA_CHESS_PUZZLES, ASA_CHESS_LESSONS)
        : null,
    [document],
  );

  useEffect(() => {
    let cancelled = false;
    void api.openProject<ChessDocument>(projectId).then((response) => {
      if (cancelled) return;
      if (!response.ok) {
        setNotice(`Не удалось открыть прогресс проекта: ${response.error.message}`);
        setSaveState('error');
        return;
      }
      const parsed = validateChessDocument(response.data.draft.document);
      if (!parsed.ok) {
        setNotice(`Повреждён шахматный документ: ${parsed.message}`);
        setSaveState('error');
        return;
      }
      setDocument(parsed.value);
      const selectedIndex = ASA_CHESS_PUZZLES.findIndex(
        (candidate) => candidate.id === parsed.value.learning.activePuzzleId,
      );
      if (selectedIndex >= 0) setPuzzleIndex(selectedIndex);
      if (initialSection === 'learning') {
        setLesson(
          recommendChessLesson(parsed.value.learning, ASA_CHESS_PUZZLES, ASA_CHESS_LESSONS) ??
            ASA_CHESS_LESSONS[0] ??
            null,
        );
      }
      setSaveState('saved');
    });
    return () => {
      cancelled = true;
    };
  }, [initialSection, projectId]);

  async function persist(next: ChessDocument): Promise<void> {
    setDocument(next);
    setSaveState('saving');
    const response = await saveQueue.current.run(() =>
      api.saveDraft<ChessDocument>(projectId, next),
    );
    if (!response.ok) {
      setSaveState('error');
      setNotice(`Прогресс не сохранён: ${response.error.message}`);
      return;
    }
    const parsed = validateChessDocument(response.data.draft.document);
    if (!parsed.ok) {
      setSaveState('error');
      setNotice(`Сервер вернул повреждённый прогресс: ${parsed.message}`);
      return;
    }
    setDocument(parsed.value);
    setSaveState('saved');
  }

  function choosePuzzle(index: number): void {
    const selected = ASA_CHESS_PUZZLES[index];
    if (!selected || !document) return;
    const nextProgress = selectChessLearningPuzzle(
      document.learning,
      selected.id,
      ASA_CHESS_PUZZLES,
    );
    if (!nextProgress.ok) {
      setNotice(nextProgress.message);
      return;
    }
    setPuzzleIndex(index);
    setSelectedSquare(null);
    setHint(null);
    setNotice('Найдите лучший ход за сторону, которой принадлежит очередь.');
    void persist({ ...document, learning: nextProgress.value });
  }

  function play(move: ChessMove): void {
    if (!document) return;
    serial.current += 1;
    const result = recordChessPuzzleMove(
      document.learning,
      puzzle,
      operationId('move', serial.current),
      moveToUci(move),
    );
    setSelectedSquare(null);
    if (!result.ok) {
      setNotice(result.message);
      return;
    }
    const next = { ...document, learning: result.value.progress };
    void persist(next);
    setHint(null);
    if (result.value.outcome === 'solved') {
      setNotice(`Задача решена. ${puzzle.explanation}`);
    } else if (result.value.outcome === 'incorrect') {
      setNotice(
        result.value.attempt.status === 'exhausted'
          ? 'Лимит ошибок исчерпан. Разберите подсказки и начните новую попытку.'
          : 'Этот ход легален, но не решает задачу. Попробуйте ещё раз.',
      );
    } else {
      setNotice(
        result.value.automaticReplies.length
          ? `Верно. Ответ соперника: ${result.value.automaticReplies.join(', ')}.`
          : 'Верно. Найдите следующий ход.',
      );
    }
  }

  function selectSquare(square: Square): void {
    if (!position || session?.status !== 'active') return;
    const piece = position.board[(Number(square[1]) - 1) * 8 + (square.charCodeAt(0) - 97)];
    if (!selectedSquare) {
      if (piece?.color === position.turn) setSelectedSquare(square);
      return;
    }
    const candidates = legalMoves.filter(
      (move) => move.from === selectedSquare && move.to === square,
    );
    if (candidates.length > 0) {
      play(candidates.find((move) => move.promotion === 'queen') ?? candidates[0]!);
      return;
    }
    setSelectedSquare(piece?.color === position.turn ? square : null);
  }

  function dragMove(from: Square, to: Square): void {
    const candidates = legalMoves.filter((move) => move.from === from && move.to === to);
    if (candidates.length > 0)
      play(candidates.find((move) => move.promotion === 'queen') ?? candidates[0]!);
  }

  function requestHint(): void {
    if (!document) return;
    serial.current += 1;
    const result = recordChessPuzzleHint(
      document.learning,
      puzzle,
      operationId('hint', serial.current),
    );
    if (!result.ok) {
      setNotice(result.message);
      return;
    }
    setHint(result.value.message);
    void persist({ ...document, learning: result.value.progress });
  }

  function retryAttempt(): void {
    if (!document) return;
    serial.current += 1;
    const result = recordChessPuzzleRetry(
      document.learning,
      puzzle,
      operationId('retry', serial.current),
    );
    if (!result.ok) {
      setNotice(result.message);
      return;
    }
    setSelectedSquare(null);
    setHint(null);
    setNotice('Новая попытка начата с исходной позиции. Предыдущие ошибки сохранены.');
    void persist({ ...document, learning: result.value.progress });
  }

  if (lesson)
    return (
      <LessonPanel
        lesson={lesson}
        user={user}
        onExit={onExit}
        onHome={onBackToProject}
        onClose={() => {
          setLesson(null);
          onOpenPuzzles?.();
        }}
      />
    );
  if (!document || !session || !position || !attempt) {
    return (
      <main className="asa-puzzle-shell asa-puzzle-loading">
        <ChessSectionHeader
          user={user}
          title="Шахматные задачи"
          status={{
            kind: saveState === 'error' ? 'error' : 'saving',
            label: saveState === 'error' ? 'Ошибка загрузки' : 'Загружаем прогресс',
          }}
          onExit={onExit}
          onHome={onBackToProject}
        />
        <p role="status">{saveState === 'error' ? notice : 'Загрузка прогресса проекта…'}</p>
      </main>
    );
  }

  const solvedCount = solvedChessPuzzleCount(document.learning);
  const totalLineLength = Math.max(...puzzle.solutionLinesUci.map((line) => line.length));
  const canGoNext = puzzleIndex < ASA_CHESS_PUZZLES.length - 1;
  const canGoPrevious = puzzleIndex > 0;

  return (
    <main className="asa-puzzle-shell">
      <ChessSectionHeader
        user={user}
        title={`Задачи · ${puzzle.title}`}
        status={{
          kind: saveState === 'error' ? 'error' : saveState === 'saving' ? 'saving' : 'saved',
          label:
            saveState === 'error'
              ? 'Ошибка сохранения'
              : saveState === 'saving'
                ? 'Сохраняем прогресс'
                : `${puzzleIndex + 1} из ${ASA_CHESS_PUZZLES.length}`,
          detail: `Учебный рейтинг ${document.learning.rating.current}`,
        }}
        onExit={onExit}
        onHome={onBackToProject}
      />

      <div className="asa-puzzle-layout">
        <section className="asa-puzzle-board-card">
          <ChessBoard
            position={position}
            orientation={session.userColor}
            selectedSquare={selectedSquare}
            legalMoves={selectedMoves.length > 0 ? selectedMoves : legalMoves}
            disabled={
              session.status !== 'active' || saveState === 'loading' || saveState === 'saving'
            }
            onSquare={selectSquare}
            onMove={dragMove}
          />
        </section>

        <aside className="asa-puzzle-panel">
          <div className="asa-puzzle-project-progress">
            <strong>
              Прогресс этого проекта: {solvedCount} из {ASA_CHESS_PUZZLES.length}
            </strong>
            <span className={`asa-learning-save is-${saveState}`} role="status" aria-live="polite">
              {saveState === 'saving'
                ? 'Сохранение прогресса…'
                : saveState === 'saved'
                  ? 'Прогресс сохранён'
                  : 'Ошибка сохранения'}
            </span>
          </div>
          <div className="asa-puzzle-meta">
            <span className="asa-puzzle-rating">Уровень {puzzle.rating ?? '—'}</span>
            <div className="asa-puzzle-themes">
              {puzzle.themes.map((theme) => (
                <span key={theme}>{theme}</span>
              ))}
            </div>
          </div>
          <ProgressDots total={totalLineLength} cursor={session.cursor} status={session.status} />
          <section
            className={`asa-puzzle-feedback ${session.status === 'solved' ? 'solved' : ''}`}
            aria-live="polite"
          >
            <strong>
              {session.status === 'solved'
                ? 'Решено'
                : session.status === 'exhausted'
                  ? 'Попытка исчерпана'
                  : 'Ваш ход'}
            </strong>
            <p>{notice}</p>
            {hint && <p className="asa-puzzle-hint">{hint}</p>}
          </section>
          <dl className="asa-puzzle-stats" aria-label="Статистика попытки">
            <div>
              <dt>Попытки</dt>
              <dd>{attempt.attempts}</dd>
            </div>
            <div>
              <dt>Ошибки</dt>
              <dd>{attempt.mistakes}</dd>
            </div>
            <div>
              <dt>Подсказки</dt>
              <dd>{attempt.hintsUsed}</dd>
            </div>
            <div>
              <dt>Учебный рейтинг</dt>
              <dd>{document.learning.rating.current}</dd>
            </div>
          </dl>
          <div className="asa-puzzle-actions">
            <button
              type="button"
              onClick={requestHint}
              disabled={session.status !== 'active' || saveState === 'saving'}
            >
              Подсказка
            </button>
            {session.status === 'exhausted' ? (
              <button type="button" onClick={retryAttempt} disabled={saveState === 'saving'}>
                Новая попытка
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setSelectedSquare(null);
                setHint(null);
                setNotice('Продолжайте с сохранённой позиции.');
              }}
            >
              Снять выбор
            </button>
          </div>
          {recommendedLesson ? (
            <section className="asa-lesson-recommendation" aria-label="Рекомендованный урок">
              <span>Рекомендованный урок</span>
              <strong>{recommendedLesson.title}</strong>
              <p>{recommendedLesson.summary}</p>
              <button type="button" onClick={() => setLesson(recommendedLesson)}>
                Открыть урок
              </button>
            </section>
          ) : null}
          <p className="asa-puzzle-rating-evidence">
            Учебный рейтинг: {document.learning.rating.current}. Формула asa-puzzle-rating-v1:
            базовые 400, за решение +24 с поправкой на уровень, −5 за ошибку и −3 за подсказку.
          </p>
          <div className="asa-puzzle-navigation">
            <button
              type="button"
              disabled={!canGoPrevious}
              onClick={() => choosePuzzle(puzzleIndex - 1)}
            >
              Предыдущая
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={!canGoNext || session.status !== 'solved'}
              onClick={() => choosePuzzle(puzzleIndex + 1)}
            >
              Следующая задача
            </button>
          </div>
          <p className="asa-puzzle-disclaimer">
            Оригинальный каталог ASA Lab · версия {puzzle.contentVersion} · источник{' '}
            {puzzle.provenance.sourceId}. Прогресс сохраняется только в этом проекте.
          </p>
        </aside>
      </div>
    </main>
  );
}
