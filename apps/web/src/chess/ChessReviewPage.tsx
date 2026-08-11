import {
  canCreateReviewRetry,
  createChessReviewRetrySession,
  createPrivateReviewTrainingItem,
  generateLegalMoves,
  moveToUci,
  parseFen,
  pieceAt,
  playChessReviewRetryMove,
  requestChessReviewRetryHint,
  resetChessReviewRetrySession,
  reviewChessDocument,
  validateChessDocument,
  type AsaMoveClassification,
  type AsaMoveReview,
  type ChessAnalysisSummary,
  type ChessDocument,
  type ChessMove,
  type ChessReviewRetrySession,
  type PrivateChessReviewTrainingItem,
  type Square,
} from '@asa-lab/chess';
import { useEffect, useMemo, useState } from 'react';
import { api, type Project } from '../api';
import { ChessBoard } from './ChessBoard';
import { ChessReviewTimeline } from './ChessReviewTimeline';
import { chessReviewDisplayFen } from './chess-review-ui';
import { evaluationLabel } from './chess-ui';

interface ChessReviewPageProps {
  projectId: string;
  onBackToProject(): void;
}

const CLASSIFICATION_LABEL: Readonly<Record<AsaMoveClassification, string>> = {
  best: 'Лучший',
  excellent: 'Отличный',
  good: 'Хороший',
  inaccuracy: 'Неточность',
  mistake: 'Ошибка',
  blunder: 'Грубая ошибка',
};

export function ChessReviewPage({ projectId, onBackToProject }: ChessReviewPageProps): JSX.Element {
  const [project, setProject] = useState<Project | null>(null);
  const [document, setDocument] = useState<ChessDocument | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [selectedPly, setSelectedPly] = useState<number | null>(null);
  const [trainingItem, setTrainingItem] = useState<PrivateChessReviewTrainingItem | null>(null);
  const [retrySession, setRetrySession] = useState<ChessReviewRetrySession | null>(null);
  const [retrySelectedSquare, setRetrySelectedSquare] = useState<Square | null>(null);
  const [retryFeedback, setRetryFeedback] = useState('');
  const [retryHint, setRetryHint] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void api.openProject<ChessDocument, ChessAnalysisSummary>(projectId).then((response) => {
      if (!active) return;
      if (!response.ok) {
        setMessage(response.error.message || 'Не удалось открыть шахматный проект.');
        setState('error');
        return;
      }
      const parsed = validateChessDocument(response.data.draft.document);
      if (!parsed.ok) {
        setMessage(parsed.message);
        setState('error');
        return;
      }
      setProject(response.data.project);
      setDocument(parsed.value);
      setSelectedPly(parsed.value.moves.at(-1)?.ply ?? null);
      setState('ready');
    });
    return () => {
      active = false;
    };
  }, [projectId]);

  const review = useMemo(() => (document ? reviewChessDocument(document, 1) : null), [document]);
  const selectedMove = useMemo(
    () => review?.moves.find((move) => move.ply === selectedPly) ?? null,
    [review, selectedPly],
  );
  const position = useMemo(() => {
    if (!document) return null;
    const fen = chessReviewDisplayFen(
      document.currentFen,
      selectedMove?.fenAfter ?? null,
      retrySession?.currentFen ?? null,
    );
    const parsed = parseFen(fen);
    return parsed.ok ? parsed.value : null;
  }, [document, retrySession, selectedMove]);
  const retryLegalMoves = useMemo(
    () => (trainingItem && retrySession && position ? generateLegalMoves(position) : []),
    [position, retrySession, trainingItem],
  );

  function selectMove(ply: number): void {
    setSelectedPly(ply);
    setTrainingItem(null);
    setRetrySession(null);
    setRetrySelectedSquare(null);
    setRetryFeedback('');
    setRetryHint(null);
  }

  function startRetry(move: AsaMoveReview): void {
    const created = createPrivateReviewTrainingItem(projectId, move);
    if (!created.ok) {
      setRetryFeedback(created.message);
      return;
    }
    setSelectedPly(move.ply);
    setTrainingItem(created.value);
    setRetrySession(createChessReviewRetrySession(created.value));
    setRetrySelectedSquare(null);
    setRetryHint(null);
    setRetryFeedback('Найдите лучший ход из позиции до ошибки. Исходная партия не изменяется.');
  }

  function playRetry(move: ChessMove): void {
    if (!trainingItem || !retrySession) return;
    const result = playChessReviewRetryMove(trainingItem, retrySession, moveToUci(move));
    setRetrySession(result.session);
    setRetrySelectedSquare(null);
    setRetryHint(null);
    setRetryFeedback(result.message);
  }

  function selectRetrySquare(square: Square): void {
    if (!trainingItem || !retrySession || retrySession.status === 'solved' || !position) return;
    const piece = pieceAt(position, square);
    if (!retrySelectedSquare) {
      if (piece?.color === position.turn) setRetrySelectedSquare(square);
      return;
    }
    const candidates = retryLegalMoves.filter(
      (move) => move.from === retrySelectedSquare && move.to === square,
    );
    if (candidates.length > 0) {
      const selected = candidates.find((move) => move.promotion === 'queen') ?? candidates[0];
      if (selected) playRetry(selected);
      return;
    }
    setRetrySelectedSquare(piece?.color === position.turn ? square : null);
  }

  function dragRetryMove(from: Square, to: Square): void {
    const candidates = retryLegalMoves.filter((move) => move.from === from && move.to === to);
    const selected = candidates.find((move) => move.promotion === 'queen') ?? candidates[0];
    if (selected) playRetry(selected);
  }

  function requestRetryHint(): void {
    if (!trainingItem || !retrySession) return;
    const result = requestChessReviewRetryHint(trainingItem, retrySession);
    if (!result.ok) {
      setRetryFeedback(result.message);
      return;
    }
    setRetrySession(result.value.session);
    setRetryHint(result.value.message);
  }

  function resetRetry(): void {
    if (!trainingItem) return;
    setRetrySession(resetChessReviewRetrySession(trainingItem));
    setRetrySelectedSquare(null);
    setRetryHint(null);
    setRetryFeedback('Попробуйте снова найти лучший ход из разбора.');
  }

  function closeRetry(): void {
    setTrainingItem(null);
    setRetrySession(null);
    setRetrySelectedSquare(null);
    setRetryHint(null);
    setRetryFeedback('');
  }

  if (state === 'loading') {
    return (
      <main className="asa-review-loading" role="status" aria-live="polite">
        Выполняем прозрачный локальный разбор партии…
      </main>
    );
  }
  if (state === 'error' || !project || !document || !review || !position) {
    return (
      <main className="asa-review-loading">
        <section role="alert">
          <h1>Разбор недоступен</h1>
          <p>{message || 'Не удалось построить разбор партии.'}</p>
          <button type="button" className="secondary-button" onClick={onBackToProject}>
            К проекту
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="asa-review-shell">
      <header className="asa-review-header">
        <button type="button" className="asa-chess-back" onClick={onBackToProject}>
          <span aria-hidden="true">←</span> К шахматному проекту
        </button>
        <div>
          <span className="eyebrow">ASA Chess · Разбор</span>
          <h1>{project.title}</h1>
        </div>
        <span className="asa-review-algorithm">ASA Review v1 · depth {review.depth}</span>
      </header>

      <div className="asa-review-layout">
        <section className="asa-review-board-card">
          <ChessBoard
            position={position}
            orientation={trainingItem?.source.color ?? document.orientation}
            selectedSquare={trainingItem ? retrySelectedSquare : null}
            legalMoves={trainingItem ? retryLegalMoves : []}
            lastMoveUci={
              retrySession?.status === 'solved'
                ? (retrySession.playedUci ?? undefined)
                : trainingItem
                  ? undefined
                  : (selectedMove?.playedUci ?? document.moves.at(-1)?.uci)
            }
            disabled={!trainingItem || retrySession?.status === 'solved'}
            onSquare={selectRetrySquare}
            onMove={dragRetryMove}
          />
          <p>
            {trainingItem
              ? `Позиция перед ошибкой · полуход ${trainingItem.source.ply}`
              : selectedMove
                ? `Позиция после полухода ${selectedMove.ply} · ${selectedMove.playedSan}`
                : `Исходная позиция · ${document.result}`}
          </p>
          {trainingItem && retrySession ? (
            <section
              className={`asa-review-retry ${retrySession.status === 'solved' ? 'is-solved' : ''}`}
              aria-label="Повторение момента"
            >
              <header>
                <div>
                  <span>Приватная тренировка</span>
                  <strong>Повторить полуход {trainingItem.source.ply}</strong>
                </div>
                <button type="button" onClick={closeRetry} aria-label="Закрыть повторение">
                  ×
                </button>
              </header>
              <div className="asa-review-retry-feedback" role="status" aria-live="polite">
                <strong>{retrySession.status === 'solved' ? 'Момент пройден' : 'Ваш ход'}</strong>
                <p>{retryFeedback}</p>
                {retryHint ? <p className="asa-review-retry-hint">{retryHint}</p> : null}
              </div>
              <dl>
                <div>
                  <dt>Попытки</dt>
                  <dd>{retrySession.attempts}</dd>
                </div>
                <div>
                  <dt>Ошибки</dt>
                  <dd>{retrySession.mistakes}</dd>
                </div>
                <div>
                  <dt>Подсказки</dt>
                  <dd>{retrySession.hintsUsed}</dd>
                </div>
              </dl>
              <div className="asa-review-retry-actions">
                <button
                  type="button"
                  disabled={retrySession.status === 'solved'}
                  onClick={requestRetryHint}
                >
                  Подсказка {Math.min(3, retrySession.hintsUsed + 1)}/3
                </button>
                <button type="button" onClick={resetRetry}>
                  Сбросить
                </button>
              </div>
              <small>
                Это одноходовое повторение позиции из разбора, а не полноценная задача. Исходная
                партия остаётся неизменной.
              </small>
            </section>
          ) : null}
        </section>

        <section className="asa-review-report">
          <div className="asa-review-quality-grid">
            <article>
              <span>Белые</span>
              <strong>{review.whiteQuality ?? '—'}</strong>
              <small>ASA Quality</small>
            </article>
            <article>
              <span>Вся партия</span>
              <strong>{review.overallQuality ?? '—'}</strong>
              <small>ASA Quality</small>
            </article>
            <article>
              <span>Чёрные</span>
              <strong>{review.blackQuality ?? '—'}</strong>
              <small>ASA Quality</small>
            </article>
          </div>

          <div className="asa-review-counts" aria-label="Классификация ходов">
            {(Object.entries(review.counts) as Array<[AsaMoveClassification, number]>).map(
              ([classification, count]) => (
                <div key={classification} data-classification={classification}>
                  <span>{CLASSIFICATION_LABEL[classification]}</span>
                  <strong>{count}</strong>
                </div>
              ),
            )}
          </div>

          <ChessReviewTimeline
            moves={review.moves}
            selectedPly={selectedPly}
            onSelect={selectMove}
          />

          {review.moves.length === 0 ? (
            <div className="asa-chess-empty-list">
              Сначала сделайте несколько ходов в проекте, затем вернитесь к разбору.
            </div>
          ) : (
            <ol className="asa-review-moves" aria-label="Разбор ходов">
              {review.moves.map((move) => (
                <li
                  key={move.ply}
                  data-classification={move.classification}
                  className={selectedPly === move.ply ? 'is-selected' : ''}
                >
                  <button
                    type="button"
                    className="asa-review-move-select"
                    aria-label={`Показать позицию после полухода ${move.ply}: ${move.playedSan}`}
                    aria-pressed={selectedPly === move.ply}
                    onClick={() => selectMove(move.ply)}
                  >
                    <span className="asa-review-ply">{move.ply}</span>
                    <span className="asa-review-move-copy">
                      <strong>{move.playedSan}</strong>
                      <small>
                        {move.color === 'white' ? 'Белые' : 'Чёрные'} · {move.playedUci}
                      </small>
                    </span>
                    <span className="asa-review-classification">
                      {CLASSIFICATION_LABEL[move.classification]}
                    </span>
                    <span className="asa-review-evaluation">
                      <strong>{move.asaQuality}</strong>
                      <small>
                        потеря {move.centipawnLoss} cp · лучший {move.bestUci ?? '—'} ·{' '}
                        {evaluationLabel(move.evaluationAfterCp)}
                      </small>
                    </span>
                  </button>
                  {canCreateReviewRetry(move) ? (
                    <button
                      type="button"
                      className="asa-review-retry-start"
                      onClick={() => startRetry(move)}
                    >
                      Повторить момент
                    </button>
                  ) : null}
                </li>
              ))}
            </ol>
          )}

          <p className="asa-review-note">
            {review.note} Этот foundation-разбор использует небольшой локальный ASA Bot и не
            заменяет будущий глубокий worker-анализ.
          </p>
        </section>
      </div>
    </main>
  );
}
