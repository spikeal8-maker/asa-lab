import { useEffect, useMemo, useState } from 'react';
import type { CheckersReviewInsight } from '@asa-lab/checkers';
import { EditorHeader } from '../components/editor-chrome/EditorHeader';
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
  readonly orientation?: 'light' | 'dark';
  readonly lesson?: {
    readonly stage: 'explain' | 'demonstrate' | 'practice' | 'feedback';
    readonly rule: string;
    readonly example: string;
    readonly feedback?: string;
  };
  readonly canRestart?: boolean;
  readonly canResign?: boolean;
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
  onLessonStageChange,
  onRestart,
  onResign,
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
  onLessonStageChange?: (stage: 'explain' | 'demonstrate' | 'practice') => void;
  onRestart?: () => void;
  onResign?: () => void;
}): JSX.Element {
  const [selectedPieceId, setSelectedPieceId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState(model.projectTitle);
  const [panel, setPanel] = useState<'task' | 'moves' | 'reactions'>('task');
  const [boardFlipped, setBoardFlipped] = useState(false);
  const [showCoordinates, setShowCoordinates] = useState(true);
  const [boardTheme, setBoardTheme] = useState<'calm' | 'contrast'>('calm');
  useEffect(() => setDraftTitle(model.projectTitle), [model.projectTitle]);
  const selectedMoves = useMemo(
    () => model.legalMoves.filter((move) => move.pieceId === selectedPieceId),
    [model.legalMoves, selectedPieceId],
  );
  const movablePieceIds = useMemo(
    () => [...new Set(model.legalMoves.map((move) => move.pieceId))],
    [model.legalMoves],
  );
  const destinations = selectedMoves.flatMap((move) => move.path.at(-1) ?? []);
  const orientation = boardFlipped
    ? model.orientation === 'dark'
      ? 'light'
      : 'dark'
    : (model.orientation ?? 'light');
  const lessonBlocksInput =
    model.lesson !== undefined &&
    (model.lesson.stage === 'explain' || model.lesson.stage === 'demonstrate');
  const boardHelp = model.readOnly
    ? {
        step: 'i',
        text:
          model.mode === 'review'
            ? 'Доска открыта для разбора. Перемещайтесь по ходам в панели справа.'
            : 'Доска пока доступна только для просмотра. Дождитесь продолжения партии.',
      }
    : model.legalMoves.length === 0
      ? { step: 'i', text: 'Сейчас нет доступных ходов. Проверьте состояние партии.' }
      : selectedPieceId
        ? { step: '2', text: 'Теперь выберите подсвеченное поле назначения.' }
        : { step: '1', text: 'Выберите шашку с мягкой золотой подсветкой.' };

  const selectSquare = (square: CheckersBoardSquare): void => {
    const selectedMove = selectedMoves.find((move) => move.path.at(-1) === square);
    if (selectedMove) {
      onMove(selectedMove);
      setSelectedPieceId(null);
      return;
    }
    const piece = model.pieces.find(
      (candidate) =>
        candidate.square === square &&
        candidate.side === model.sideToMove &&
        movablePieceIds.includes(candidate.id),
    );
    setSelectedPieceId(piece?.id ?? null);
  };

  return (
    <div className="checkers-workspace">
      <EditorHeader
        moduleId="checkers"
        onExit={onBack}
        exitLabel="Вернуться в кабинет шашек"
        title={{
          kind: 'editable',
          value: draftTitle,
          ariaLabel: 'Название игры',
          maxLength: 255,
          onChange: setDraftTitle,
          onCommit: () => onRename(draftTitle),
          onCancel: () => setDraftTitle(model.projectTitle),
        }}
        status={{
          kind: model.saveState,
          label: SAVE_LABELS[model.saveState],
          ...(model.saveError ? { detail: model.saveError } : {}),
          ...(model.saveState === 'saved' ? { icon: '✓' } : {}),
        }}
        navigation={{
          ariaLabel: 'Режим шашек',
          items: [
            {
              id: 'learn',
              label: 'Учусь',
              selected: model.mode === 'learn',
              onActivate: () => onModeChange('learn'),
            },
            {
              id: 'play',
              label: 'Играю',
              selected: model.mode === 'play',
              onActivate: () => onModeChange('play'),
            },
            {
              id: 'review',
              label: 'Разбор',
              selected: model.mode === 'review',
              onActivate: () => onModeChange('review'),
            },
          ],
        }}
        avatar={{ label: model.userName, text: initials(model.userName) }}
      />

      <nav className="checkers-mobile-modes" aria-label="Режим шашек на мобильном устройстве">
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
            aria-pressed={model.mode === mode}
            onClick={() => onModeChange(mode)}
          >
            {label}
          </button>
        ))}
      </nav>

      <main className="checkers-game-layout" id="main-content" tabIndex={-1}>
        <section className="checkers-board-stage" aria-label="Игровая доска">
          <div className="checkers-board-frame">
            {model.mode !== 'review' ? (
              <section className="checkers-mobile-task" aria-label="Текущее задание">
                <span>{model.mode === 'learn' ? 'Учебный шаг' : 'Партия'}</span>
                <strong>{model.instructionTitle}</strong>
                <p>{model.instruction}</p>
              </section>
            ) : null}
            <div className="checkers-board-toolbar">
              <div className="checkers-board-turn">
                <span className={`checkers-turn-dot ${model.sideToMove}`} aria-hidden="true" />
                <span>
                  <strong>{model.sideToMove === 'light' ? 'Ход светлых' : 'Ход тёмных'}</strong>
                  <small>{model.opponentLabel}</small>
                </span>
              </div>
              <div className="checkers-board-meta">
                <small>{model.modeLabel}</small>
                <span className="checkers-legal-count">Ходов: {model.legalMoves.length}</span>
              </div>
            </div>

            <div
              className="checkers-game-actions"
              role="group"
              aria-label="Настройки доски и партии"
            >
              <button type="button" onClick={() => setBoardFlipped((value) => !value)}>
                ↻ Перевернуть
              </button>
              <button type="button" onClick={() => setShowCoordinates((value) => !value)}>
                {showCoordinates ? 'Скрыть координаты' : 'Показать координаты'}
              </button>
              <button
                type="button"
                aria-pressed={boardTheme === 'contrast'}
                onClick={() => setBoardTheme((value) => (value === 'calm' ? 'contrast' : 'calm'))}
              >
                {boardTheme === 'calm' ? 'Высокий контраст' : 'Спокойная тема'}
              </button>
              {model.canRestart && onRestart ? (
                <button type="button" onClick={onRestart}>
                  Новая партия
                </button>
              ) : null}
              {model.canResign && onResign ? (
                <button type="button" className="danger" onClick={onResign}>
                  Сдаться
                </button>
              ) : null}
            </div>

            <CheckersBoard
              pieces={model.pieces}
              orientation={orientation}
              theme={boardTheme}
              showCoordinates={showCoordinates}
              selectedPieceId={selectedPieceId}
              legalDestinations={destinations}
              movablePieceIds={movablePieceIds}
              disabled={Boolean(model.readOnly || lessonBlocksInput)}
              onSquareClick={selectSquare}
            />

            <div className="checkers-board-help" role="status" aria-live="polite">
              <span aria-hidden="true">{boardHelp.step}</span>
              <p>{boardHelp.text}</p>
            </div>
          </div>
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
                  {model.lesson ? (
                    <div className="checkers-lesson-flow">
                      <ol aria-label="Этапы короткого урока">
                        <li className={model.lesson.stage === 'explain' ? 'active' : ''}>
                          1. Правило
                        </li>
                        <li className={model.lesson.stage === 'demonstrate' ? 'active' : ''}>
                          2. Пример
                        </li>
                        <li className={model.lesson.stage === 'practice' ? 'active' : ''}>
                          3. Твой ход
                        </li>
                        <li className={model.lesson.stage === 'feedback' ? 'active' : ''}>
                          4. Итог
                        </li>
                      </ol>
                      {model.lesson.stage === 'explain' ? (
                        <section>
                          <strong>Сначала пойми правило</strong>
                          <p>{model.lesson.rule}</p>
                          <button
                            type="button"
                            onClick={() => onLessonStageChange?.('demonstrate')}
                          >
                            Посмотреть пример
                          </button>
                        </section>
                      ) : null}
                      {model.lesson.stage === 'demonstrate' ? (
                        <section>
                          <strong>Разберём пример</strong>
                          <p>{model.lesson.example}</p>
                          <button type="button" onClick={() => onLessonStageChange?.('practice')}>
                            Попробовать самому
                          </button>
                        </section>
                      ) : null}
                      {model.lesson.stage === 'practice' ? (
                        <section>
                          <strong>Теперь твой ход</strong>
                          <p>
                            Найди решение на доске. Разрешены только ходы по правилам русских шашек.
                          </p>
                        </section>
                      ) : null}
                      {model.lesson.stage === 'feedback' ? (
                        <section className="success">
                          <strong>Навык подтверждён</strong>
                          <p>{model.lesson.feedback ?? 'Решение сохранено в учебном прогрессе.'}</p>
                          {onRestart ? (
                            <button type="button" onClick={onRestart}>
                              Решить ещё раз
                            </button>
                          ) : null}
                        </section>
                      ) : null}
                    </div>
                  ) : null}
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
