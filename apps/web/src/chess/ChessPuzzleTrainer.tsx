import {
  createChessPuzzleSession,
  generateLegalMoves,
  moveToUci,
  parseFen,
  playChessPuzzleMove,
  requestChessPuzzleHint,
  resetChessPuzzleSession,
  type ChessMove,
  type ChessPuzzle,
  type ChessPuzzleSession,
  type Square,
} from '@asa-lab/chess';
import { useMemo, useState } from 'react';
import { ChessBoard } from './ChessBoard';
import { ASA_STARTER_PUZZLES } from './chess-puzzles';

interface ChessPuzzleTrainerProps {
  onBackToProject(): void;
}

function safePosition(session: ChessPuzzleSession) {
  const parsed = parseFen(session.currentFen);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.value;
}

function ProgressDots({
  total,
  cursor,
  status,
}: {
  total: number;
  cursor: number;
  status: ChessPuzzleSession['status'];
}) {
  return (
    <div className="asa-puzzle-progress" aria-label={`Пройдено ${cursor} из ${total} полуходов`}>
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

export function ChessPuzzleTrainer({ onBackToProject }: ChessPuzzleTrainerProps) {
  const [puzzleIndex, setPuzzleIndex] = useState(0);
  const puzzle: ChessPuzzle = ASA_STARTER_PUZZLES[puzzleIndex] ?? ASA_STARTER_PUZZLES[0]!;
  const [session, setSession] = useState(() => createChessPuzzleSession(puzzle));
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  const [notice, setNotice] = useState(
    'Найдите лучший ход за сторону, которой принадлежит очередь.',
  );
  const [hint, setHint] = useState<string | null>(null);

  const position = useMemo(() => safePosition(session), [session]);
  const legalMoves = useMemo(() => generateLegalMoves(position), [position]);
  const selectedMoves = useMemo(
    () => legalMoves.filter((move) => move.from === selectedSquare),
    [legalMoves, selectedSquare],
  );

  function setPuzzle(index: number): void {
    const nextPuzzle = ASA_STARTER_PUZZLES[index] ?? ASA_STARTER_PUZZLES[0]!;
    setPuzzleIndex(index);
    setSession(createChessPuzzleSession(nextPuzzle));
    setSelectedSquare(null);
    setHint(null);
    setNotice('Найдите лучший ход за сторону, которой принадлежит очередь.');
  }

  function play(move: ChessMove): void {
    const result = playChessPuzzleMove(puzzle, session, moveToUci(move));
    setSelectedSquare(null);
    if (!result.ok) {
      setSession(result.session);
      setNotice(result.message);
      return;
    }
    setSession(result.session);
    setHint(null);
    if (result.outcome === 'solved') {
      setNotice(`Задача решена. ${puzzle.explanation}`);
    } else {
      setNotice(
        result.automaticReplies.length > 0
          ? `Верно. Ответ соперника: ${result.automaticReplies.join(', ')}. Найдите продолжение.`
          : 'Верно. Найдите следующий ход.',
      );
    }
  }

  function selectSquare(square: Square): void {
    if (session.status === 'solved') return;
    const piece = position.board[(Number(square[1]) - 1) * 8 + (square.charCodeAt(0) - 97)];
    if (!selectedSquare) {
      if (piece?.color === position.turn) setSelectedSquare(square);
      return;
    }
    const candidates = legalMoves.filter(
      (move) => move.from === selectedSquare && move.to === square,
    );
    if (candidates.length === 1) {
      play(candidates[0]!);
      return;
    }
    if (candidates.length > 1) {
      const queen = candidates.find((move) => move.promotion === 'queen') ?? candidates[0];
      if (queen) play(queen);
      return;
    }
    setSelectedSquare(piece?.color === position.turn ? square : null);
  }

  function dragMove(from: Square, to: Square): void {
    const candidates = legalMoves.filter((move) => move.from === from && move.to === to);
    if (candidates.length === 1) play(candidates[0]!);
    else if (candidates.length > 1) {
      const queen = candidates.find((move) => move.promotion === 'queen') ?? candidates[0];
      if (queen) play(queen);
    }
  }

  function requestHint(): void {
    const result = requestChessPuzzleHint(puzzle, session);
    if (!result.ok) {
      setNotice(result.message);
      return;
    }
    setSession(result.value.session);
    setHint(result.value.message);
  }

  function reset(): void {
    setSession(resetChessPuzzleSession(puzzle));
    setSelectedSquare(null);
    setHint(null);
    setNotice('Задача сброшена. Найдите лучший ход.');
  }

  const canGoNext = puzzleIndex < ASA_STARTER_PUZZLES.length - 1;
  const canGoPrevious = puzzleIndex > 0;

  return (
    <main className="asa-puzzle-shell">
      <header className="asa-puzzle-header">
        <button type="button" className="asa-chess-back" onClick={onBackToProject}>
          <span aria-hidden="true">←</span> К шахматному проекту
        </button>
        <div>
          <span className="eyebrow">ASA Chess · Тренировка</span>
          <h1>{puzzle.title}</h1>
        </div>
        <span className="asa-puzzle-counter">
          {puzzleIndex + 1} / {ASA_STARTER_PUZZLES.length}
        </span>
      </header>

      <div className="asa-puzzle-layout">
        <section className="asa-puzzle-board-card">
          <ChessBoard
            position={position}
            orientation={session.userColor}
            selectedSquare={selectedSquare}
            legalMoves={selectedMoves.length > 0 ? selectedMoves : legalMoves}
            disabled={session.status === 'solved'}
            onSquare={selectSquare}
            onMove={dragMove}
          />
        </section>

        <aside className="asa-puzzle-panel">
          <div className="asa-puzzle-meta">
            <span className="asa-puzzle-rating">Уровень {puzzle.rating ?? '—'}</span>
            <div className="asa-puzzle-themes">
              {puzzle.themes.map((theme) => (
                <span key={theme}>{theme}</span>
              ))}
            </div>
          </div>
          <ProgressDots
            total={puzzle.solutionUci.length}
            cursor={session.cursor}
            status={session.status}
          />
          <section
            className={`asa-puzzle-feedback ${session.status === 'solved' ? 'solved' : ''}`}
            aria-live="polite"
          >
            <strong>{session.status === 'solved' ? 'Решено' : 'Ваш ход'}</strong>
            <p>{notice}</p>
            {hint && <p className="asa-puzzle-hint">{hint}</p>}
          </section>
          <dl className="asa-puzzle-stats">
            <div>
              <dt>Попытки</dt>
              <dd>{session.attempts}</dd>
            </div>
            <div>
              <dt>Ошибки</dt>
              <dd>{session.mistakes}</dd>
            </div>
            <div>
              <dt>Подсказки</dt>
              <dd>{session.hintsUsed}</dd>
            </div>
          </dl>
          <div className="asa-puzzle-actions">
            <button type="button" onClick={requestHint} disabled={session.status === 'solved'}>
              Подсказка
            </button>
            <button type="button" onClick={reset}>
              Сбросить
            </button>
          </div>
          <div className="asa-puzzle-navigation">
            <button
              type="button"
              disabled={!canGoPrevious}
              onClick={() => setPuzzle(puzzleIndex - 1)}
            >
              Предыдущая
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={!canGoNext || session.status !== 'solved'}
              onClick={() => setPuzzle(puzzleIndex + 1)}
            >
              Следующая задача
            </button>
          </div>
          <p className="asa-puzzle-disclaimer">
            Это небольшой оригинальный набор для проверки механики. Он не является копией базы задач
            Chess.com.
          </p>
        </aside>
      </div>
    </main>
  );
}
