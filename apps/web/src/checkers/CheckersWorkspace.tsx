import { useMemo, useState } from 'react';
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
  readonly reactionsEnabled: boolean;
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
}: {
  model: CheckersWorkspaceViewModel;
  onBack: () => void;
  onRename: (title: string) => void;
  onModeChange: (mode: CheckersWorkspaceViewModel['mode']) => void;
  onMove: (move: CheckersWorkspaceMove) => void;
  onReaction: (reactionId: (typeof REACTIONS)[number][0]) => void;
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
              disabled={!model.reactionsEnabled}
              onClick={() => setPanel('reactions')}
            >
              Реакции
            </button>
          </div>

          {panel === 'task' ? (
            <div className="checkers-task-panel" role="tabpanel">
              <span className="checkers-home-eyebrow">Сейчас</span>
              <h2>{model.instructionTitle}</h2>
              <p>{model.instruction}</p>
              <div className="checkers-hint-ladder">
                <strong>Нужна подсказка?</strong>
                <button type="button">Напомнить правило</button>
              </div>
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
              <div>
                {REACTIONS.map(([id, label]) => (
                  <button key={id} type="button" onClick={() => onReaction(id)}>
                    {label}
                  </button>
                ))}
              </div>
              <button type="button" className="checkers-mute-reactions">
                Отключить реакции у себя
              </button>
            </div>
          ) : null}
        </aside>
      </main>
    </div>
  );
}
