import { useMemo, useState } from 'react';
import type { CheckersReviewInsight } from '@asa-lab/checkers';
import { CheckersBoard, type CheckersBoardPiece, type CheckersBoardSquare } from './CheckersBoard';
import './checkers.css';

export interface CheckersWorkspaceMove {
  readonly pieceId: string;
  readonly path: readonly CheckersBoardSquare[];
  readonly notation: string;
}

export interface CheckersMoveHistoryItem {
  readonly ply: number;
  readonly notation: string;
}

export interface CheckersWorkspaceViewModel {
  readonly projectTitle: string;
  readonly saveState: 'saved' | 'saving' | 'dirty' | 'error';
  readonly saveError?: string;
  readonly userName: string;
  readonly mode: 'learn' | 'play' | 'review';
  readonly modeLabel: string;
  readonly opponentLabel: string;
  readonly sideToMove: 'light' | 'dark';
  readonly pieces: readonly CheckersBoardPiece[];
  readonly legalMoves: readonly CheckersWorkspaceMove[];
  readonly moveHistory: readonly CheckersMoveHistoryItem[];
  readonly instructionTitle: string;
  readonly instruction: string;
  readonly hintText?: string;
  readonly reactionsEnabled: boolean;
  readonly reactionEvents?: readonly {
    readonly id: string;
    readonly senderName: string;
    readonly reactionId: string;
    readonly sentAt: string;
  }[];
  readonly reviewInsights?: readonly CheckersReviewInsight[];
  readonly reviewPly?: number;
  readonly reviewTotalPly?: number;
  readonly readOnly?: boolean;
}

const SAVE_LABELS: Readonly<Record<CheckersWorkspaceViewModel['saveState'], string>> = {
  saved: 'Сохранено',
  saving: 'Сохранение…',
  dirty: 'Есть изменения',
  error: 'Ошибка сохранения',
};

const REACTIONS = [
  ['good-luck', 'Удачи!'],
  ['good-move', 'Хороший ход!'],
  ['thanks-for-game', 'Спасибо за игру!'],
  ['applause', 'Аплодисменты'],
  ['thinking', 'Думаю…'],
  ['friendly-smile', 'Улыбка'],
] as const;

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

export function CheckersWorkspace({
  model,
  onBack,
  onRename,
  onModeChange,
  onMove,
  onReaction,
  onHint,
  onToggleReactions,
  onReviewStep,
  onReportReaction,
}: {
  model: CheckersWorkspaceViewModel;
  onBack: () => void;
  onRename: (title: string) => void;
  onModeChange: (mode: CheckersWorkspaceViewModel['mode']) => void;
  onMove: (move: CheckersWorkspaceMove) => void;
  onReaction: (reactionId: (typeof REACTIONS)[number][0]) => void;
  onHint?: () => void;
  onToggleReactions?: () => void;
  onReviewStep?: (ply: number) => void;
  onReportReaction?: (eventId: string) => void;
}): JSX.Element {
  const [selectedPieceId, setSelectedPieceId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState(model.projectTitle);
  const [panel, setPanel] = useState<'task' | 'moves' | 'reactions'>('task');
  const selectedMoves = useMemo(
    () => model.legalMoves.filter((move) => move.pieceId === selectedPieceId),
    [model.legalMoves, selectedPieceId],
  );
  const destinations = selectedMoves.flatMap((move) => move.path.at(-1) ?? []);

  const selectSquare = (square: CheckersBoardSquare): void => {
    const selectedMove = selectedMoves.find((move) => move.path.at(-1) === square);
    if (selectedMove) {
      onMove(selectedMove);
      setSelectedPieceId(null);
      return;
    }
    const piece = model.pieces.find(
      (candidate) => candidate.square === square && candidate.side === model.sideToMove,
    );
    setSelectedPieceId(piece?.id ?? null);
  };

  return (
    <div className="checkers-workspace">
      <header className="checkers-editor-header">
        <div className="checkers-brand-zone">
          <button type="button" className="checkers-brand" onClick={onBack} aria-label="ASA Lab">
            <img src="/asa-lab-mark.svg" alt="" aria-hidden="true" />
            <span>ASA Lab</span>
          </button>
          <input
            value={draftTitle}
            aria-label="Название шашечного проекта"
            maxLength={255}
            onChange={(event) => setDraftTitle(event.target.value)}
            onBlur={() => onRename(draftTitle)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
              if (event.key === 'Escape') {
                setDraftTitle(model.projectTitle);
                event.currentTarget.blur();
              }
            }}
          />
        </div>
        <span
          className={`checkers-save-state ${model.saveState}`}
          role="status"
          title={model.saveError}
        >
          {model.saveState === 'saved' ? '✓ ' : ''}
          {model.saveState === 'error' && model.saveError
            ? `${SAVE_LABELS.error}: ${model.saveError}`
            : SAVE_LABELS[model.saveState]}
        </span>
        <nav className="checkers-mode-tabs" aria-label="Режим шашек">
          {(
            [
              ['learn', 'Учусь'],
              ['play', 'Играю'],
              ['review', 'Разбор'],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              className={model.mode === mode ? 'active' : ''}
              aria-pressed={model.mode === mode}
              onClick={() => onModeChange(mode)}
            >
              {label}
            </button>
          ))}
          <span className="checkers-avatar" title={model.userName}>
            {initials(model.userName)}
          </span>
        </nav>
      </header>

      <div className="checkers-context-bar">
        <div>
          <span className={`checkers-turn-dot ${model.sideToMove}`} />
          <strong>{model.sideToMove === 'light' ? 'Ход светлых' : 'Ход тёмных'}</strong>
          <span>{model.opponentLabel}</span>
        </div>
        <span>{model.modeLabel}</span>
      </div>

      <main className="checkers-game-layout" id="main-content" tabIndex={-1}>
        <section className="checkers-board-stage" aria-label="Игровая доска">
          <CheckersBoard
            pieces={model.pieces}
            selectedPieceId={selectedPieceId}
            legalDestinations={destinations}
            {...(model.readOnly === undefined ? {} : { disabled: model.readOnly })}
            onSquareClick={selectSquare}
          />
        </section>

        <aside className="checkers-side-panel" aria-label="Панель занятия и партии">
          <div className="checkers-panel-tabs" role="tablist" aria-label="Панель шашек">
            <button
              type="button"
              role="tab"
              aria-selected={panel === 'task'}
              onClick={() => setPanel('task')}
            >
              Задание
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={panel === 'moves'}
              onClick={() => setPanel('moves')}
            >
              Ходы
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={panel === 'reactions'}
              title="Свободного чата здесь нет — только готовые добрые реакции"
              onClick={() => setPanel('reactions')}
            >
              Реакции
            </button>
          </div>

          {panel === 'task' ? (
            <div className="checkers-task-panel" role="tabpanel">
              {model.mode === 'review' ? (
                <>
                  <span className="checkers-home-eyebrow">Пошаговый разбор</span>
                  <h2>Позиция после хода {model.reviewPly ?? 0}</h2>
                  <div className="checkers-review-controls" aria-label="Навигация по записи партии">
                    <button
                      type="button"
                      disabled={(model.reviewPly ?? 0) <= 0}
                      onClick={() => onReviewStep?.(Math.max(0, (model.reviewPly ?? 0) - 1))}
                    >
                      ← Предыдущий
                    </button>
                    <span>
                      {model.reviewPly ?? 0} / {model.reviewTotalPly ?? 0}
                    </span>
                    <button
                      type="button"
                      disabled={(model.reviewPly ?? 0) >= (model.reviewTotalPly ?? 0)}
                      onClick={() =>
                        onReviewStep?.(
                          Math.min(model.reviewTotalPly ?? 0, (model.reviewPly ?? 0) + 1),
                        )
                      }
                    >
                      Следующий →
                    </button>
                  </div>
                  <div className="checkers-review-insights">
                    {(model.reviewInsights ?? []).map((insight) => (
                      <article key={insight.id} className={insight.tone}>
                        <strong>{insight.title}</strong>
                        <p>{insight.explanation}</p>
                        {insight.ply !== null ? (
                          <button type="button" onClick={() => onReviewStep?.(insight.ply!)}>
                            Показать ход {insight.ply}
                          </button>
                        ) : null}
                      </article>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <span className="checkers-home-eyebrow">Сейчас</span>
                  <h2>{model.instructionTitle}</h2>
                  <p>{model.instruction}</p>
                  <div className="checkers-hint-ladder">
                    <strong>Нужна подсказка?</strong>
                    {model.hintText ? <p className="checkers-hint-text">{model.hintText}</p> : null}
                    <button type="button" onClick={onHint} disabled={!onHint}>
                      {model.hintText ? 'Следующая подсказка' : 'Напомнить правило'}
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : null}
          {panel === 'moves' ? (
            <div className="checkers-move-panel" role="tabpanel">
              <h2>Ходы партии</h2>
              {model.moveHistory.length === 0 ? (
                <p>Ходов пока нет. Выбери шашку на доске.</p>
              ) : (
                <ol>
                  {model.moveHistory.map((move) => (
                    <li key={move.ply}>
                      <span>{move.ply}.</span>
                      <strong>{move.notation}</strong>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          ) : null}
          {panel === 'reactions' ? (
            <div className="checkers-reaction-panel" role="tabpanel">
              <h2>Добрые реакции</h2>
              <p>Свободного чата здесь нет. Выбери готовую реакцию.</p>
              {model.reactionsEnabled ? (
                <div>
                  {REACTIONS.map(([id, label]) => (
                    <button key={id} type="button" onClick={() => onReaction(id)}>
                      {label}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="checkers-reactions-muted">Реакции скрыты только у вас.</p>
              )}
              {(model.reactionEvents ?? []).length > 0 && model.reactionsEnabled ? (
                <ol className="checkers-reaction-events" aria-label="Журнал готовых реакций">
                  {(model.reactionEvents ?? []).map((event) => (
                    <li key={event.id}>
                      <span>
                        <strong>{event.senderName}</strong>{' '}
                        {REACTIONS.find(([id]) => id === event.reactionId)?.[1] ?? 'реакция'}
                      </span>
                      {onReportReaction ? (
                        <button type="button" onClick={() => onReportReaction(event.id)}>
                          Сообщить педагогу
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ol>
              ) : null}
              <button type="button" className="checkers-mute-reactions" onClick={onToggleReactions}>
                {model.reactionsEnabled ? 'Скрыть реакции у себя' : 'Показывать реакции'}
              </button>
            </div>
          ) : null}
        </aside>
      </main>
    </div>
  );
}
