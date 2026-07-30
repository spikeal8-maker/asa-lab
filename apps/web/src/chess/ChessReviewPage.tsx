import {
  parseFen,
  reviewChessDocument,
  validateChessDocument,
  type AsaMoveClassification,
  type ChessAnalysisSummary,
  type ChessDocument,
} from '@asa-lab/chess';
import { useEffect, useMemo, useState } from 'react';
import { api, type Project } from '../api';
import { ChessBoard } from './ChessBoard';
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

export function ChessReviewPage({
  projectId,
  onBackToProject,
}: ChessReviewPageProps): JSX.Element {
  const [project, setProject] = useState<Project | null>(null);
  const [document, setDocument] = useState<ChessDocument | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');

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
      setState('ready');
    });
    return () => {
      active = false;
    };
  }, [projectId]);

  const review = useMemo(
    () => (document ? reviewChessDocument(document, 1) : null),
    [document],
  );
  const position = useMemo(() => {
    if (!document) return null;
    const parsed = parseFen(document.currentFen);
    return parsed.ok ? parsed.value : null;
  }, [document]);

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
            orientation={document.orientation}
            selectedSquare={null}
            legalMoves={[]}
            lastMoveUci={document.moves.at(-1)?.uci}
            disabled
            onSquare={() => undefined}
            onMove={() => undefined}
          />
          <p>
            Итоговая позиция · {document.moves.length} полуходов · {document.result}
          </p>
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

          {review.moves.length === 0 ? (
            <div className="asa-chess-empty-list">
              Сначала сделайте несколько ходов в проекте, затем вернитесь к разбору.
            </div>
          ) : (
            <ol className="asa-review-moves" aria-label="Разбор ходов">
              {review.moves.map((move) => (
                <li key={move.ply} data-classification={move.classification}>
                  <span className="asa-review-ply">{move.ply}</span>
                  <div>
                    <strong>{move.playedSan}</strong>
                    <small>{move.color === 'white' ? 'Белые' : 'Чёрные'} · {move.playedUci}</small>
                  </div>
                  <span className="asa-review-classification">
                    {CLASSIFICATION_LABEL[move.classification]}
                  </span>
                  <div className="asa-review-evaluation">
                    <strong>{move.asaQuality}</strong>
                    <small>
                      потеря {move.centipawnLoss} cp · лучший {move.bestUci ?? '—'} ·{' '}
                      {evaluationLabel(move.evaluationAfterCp)}
                    </small>
                  </div>
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
