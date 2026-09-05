import {
  ASA_BOT_PROFILES,
  PIECE_SYMBOL as DOMAIN_PIECES,
  opposite,
  type ChessMode,
  type Color,
  type PromotionPiece,
} from '@asa-lab/chess';
import { useEffect, useMemo, useState } from 'react';
import type { PublicUser } from '../api';
import { ChessBoard } from './ChessBoard';
import { ChessEditorHeader } from './ChessEditorHeader';
import type { ChessPanelTab } from './chess-navigation';
import {
  PIECE_SYMBOL,
  botProfileUiSummary,
  evaluationLabel,
  formatChessClock,
  resolveAsaBotProfile,
  resultLabel,
} from './chess-ui';
import { useChessProject, type ProfiledChessGameOptions } from './use-chess-project';
import './chess.css';

interface ChessEditorProps {
  projectId: string;
  onBack: () => void;
  onHome?: () => void;
  startNewGame?: boolean;
  setupPage?: boolean;
  onGameStarted?: () => void;
  initialPanelTab?: ChessPanelTab;
  onPanelTabChange?: (tab: ChessPanelTab) => void;
  user: PublicUser;
}

type ImportKind = 'pgn' | 'fen';

interface TimePreset {
  readonly label: string;
  readonly initialMs: number;
  readonly incrementMs: number;
}

const TIME_PRESETS: readonly TimePreset[] = [
  { label: '3+2', initialMs: 3 * 60 * 1000, incrementMs: 2 * 1000 },
  { label: '5+0', initialMs: 5 * 60 * 1000, incrementMs: 0 },
  { label: '10+5', initialMs: 10 * 60 * 1000, incrementMs: 5 * 1000 },
  { label: '15+10', initialMs: 15 * 60 * 1000, incrementMs: 10 * 1000 },
] as const;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function evaluationPercent(scoreCp: number): number {
  if (scoreCp >= 90_000) return 98;
  if (scoreCp <= -90_000) return 2;
  return clamp(50 + Math.tanh(scoreCp / 600) * 47, 3, 97);
}

function modeLabel(mode: ChessMode): string {
  if (mode === 'computer') return 'Игра с ASA Bot';
  if (mode === 'local') return 'Два игрока';
  return 'Анализ';
}

function playerName(
  color: Color,
  mode: ChessMode,
  botColor: Color | null,
  botDisplayName: string | null,
  user: PublicUser,
): string {
  if (mode === 'computer')
    return color === botColor ? (botDisplayName ?? 'ASA Bot') : user.displayName;
  if (mode === 'local') return color === 'white' ? 'Белые' : 'Чёрные';
  return color === 'white' ? 'Белая сторона' : 'Чёрная сторона';
}

function ChessPlayerBar({
  color,
  name,
  milliseconds,
  active,
  thinking,
}: {
  color: Color;
  name: string;
  milliseconds: number | null;
  active: boolean;
  thinking: boolean;
}) {
  return (
    <div className={`asa-chess-player ${active ? 'active' : ''}`} data-color={color}>
      <span className={`asa-chess-player-piece ${color}`} aria-hidden="true">
        {PIECE_SYMBOL[color].king}
      </span>
      <span className="asa-chess-player-copy">
        <strong>{name}</strong>
        <small>
          {thinking ? 'Думает…' : active ? 'Ход' : color === 'white' ? 'Белые' : 'Чёрные'}
        </small>
      </span>
      {milliseconds !== null && (
        <time className={`asa-chess-clock ${milliseconds < 20_000 ? 'low' : ''}`}>
          {formatChessClock(milliseconds)}
        </time>
      )}
    </div>
  );
}

function MoveList({ moves }: { moves: readonly { san: string; uci: string }[] }) {
  const rows = useMemo(() => {
    const value: Array<{
      number: number;
      white?: { san: string; uci: string };
      black?: { san: string; uci: string };
    }> = [];
    for (let index = 0; index < moves.length; index += 2) {
      value.push({
        number: Math.floor(index / 2) + 1,
        ...(moves[index] ? { white: moves[index] } : {}),
        ...(moves[index + 1] ? { black: moves[index + 1] } : {}),
      });
    }
    return value;
  }, [moves]);
  if (rows.length === 0) {
    return <div className="asa-chess-empty-list">Ходов пока нет. Выберите фигуру на доске.</div>;
  }
  return (
    <ol className="asa-chess-moves" aria-label="Ходы партии">
      {rows.map((row) => (
        <li key={row.number}>
          <span className="move-number">{row.number}.</span>
          <span title={row.white?.uci}>{row.white?.san ?? ''}</span>
          <span title={row.black?.uci}>{row.black?.san ?? ''}</span>
        </li>
      ))}
    </ol>
  );
}

function NewGameSetup({
  embedded,
  busy = false,
  onCancel,
  onStart,
}: {
  embedded: boolean;
  busy?: boolean;
  onCancel?: () => void;
  onStart(options: ProfiledChessGameOptions): void;
}) {
  const [mode, setMode] = useState<ChessMode>('computer');
  const [playerColor, setPlayerColor] = useState<Color>('white');
  const [botProfileId, setBotProfileId] = useState('asa-bot-compass');
  const [timeIndex, setTimeIndex] = useState(2);
  const preset = TIME_PRESETS[timeIndex] ?? TIME_PRESETS[2]!;
  const selectedProfile =
    ASA_BOT_PROFILES.find((profile) => profile.id === botProfileId) ?? ASA_BOT_PROFILES[0]!;
  const profileSummary = botProfileUiSummary(selectedProfile);
  const titleId = embedded ? 'chess-bot-page-title' : 'new-chess-game-title';
  return (
    <section
      className={embedded ? 'asa-chess-new-game-panel' : 'asa-chess-dialog'}
      {...(!embedded ? { role: 'dialog', 'aria-modal': true } : {})}
      aria-labelledby={titleId}
      onMouseDown={!embedded ? (event) => event.stopPropagation() : undefined}
    >
      <div className="asa-chess-dialog-head">
        <div>
          <span className="eyebrow">{embedded ? 'Независимая страница' : 'ASA Chess'}</span>
          <h2 id={titleId}>
            {embedded ? 'Выберите соперника и начните партию' : 'Новая партия или позиция'}
          </h2>
        </div>
        {!embedded && onCancel && (
          <button type="button" className="icon-button" onClick={onCancel} aria-label="Закрыть">
            ×
          </button>
        )}
      </div>
      {!embedded && (
        <fieldset className="asa-chess-choice-grid">
          <legend>Режим</legend>
          {(
            [
              ['computer', 'Против ASA Bot', 'Локальный детерминированный соперник'],
              ['local', 'Два игрока', 'Игра на одном устройстве'],
              ['analysis', 'Анализ', 'Без часов, с отменой ходов'],
            ] as const
          ).map(([value, title, note]) => (
            <label key={value} className={mode === value ? 'selected' : ''}>
              <input
                type="radio"
                name="chess-mode"
                value={value}
                checked={mode === value}
                onChange={() => setMode(value)}
              />
              <strong>{title}</strong>
              <small>{note}</small>
            </label>
          ))}
        </fieldset>
      )}
      {mode !== 'analysis' && (
        <fieldset className="asa-chess-time-options">
          <legend>Контроль времени</legend>
          {TIME_PRESETS.map((value, index) => (
            <button
              type="button"
              key={value.label}
              className={timeIndex === index ? 'selected' : ''}
              onClick={() => setTimeIndex(index)}
            >
              {value.label}
            </button>
          ))}
        </fieldset>
      )}
      {mode === 'computer' && (
        <div className="asa-chess-bot-setup">
          <fieldset>
            <legend>Играть</legend>
            <div className="asa-chess-segmented">
              {(['white', 'black'] as const).map((color) => (
                <button
                  type="button"
                  key={color}
                  className={playerColor === color ? 'selected' : ''}
                  onClick={() => setPlayerColor(color)}
                >
                  {color === 'white' ? 'Белыми' : 'Чёрными'}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset className="asa-chess-bot-profile-picker">
            <legend>Профиль соперника</legend>
            <div className="asa-chess-bot-profile-grid">
              {ASA_BOT_PROFILES.map((profile) => (
                <label
                  key={profile.id}
                  className={profile.id === selectedProfile.id ? 'selected' : ''}
                >
                  <input
                    type="radio"
                    name="asa-bot-profile"
                    value={profile.id}
                    checked={profile.id === selectedProfile.id}
                    onChange={() => setBotProfileId(profile.id)}
                  />
                  <strong>{profile.displayName}</strong>
                  <small>Движок {profile.engine.level}/3</small>
                </label>
              ))}
            </div>
          </fieldset>
          <section className="asa-chess-bot-profile-detail" aria-live="polite">
            <div>
              <span>Выбранный соперник</span>
              <strong>{selectedProfile.displayName}</strong>
            </div>
            <dl>
              <div>
                <dt>Уровень</dt>
                <dd>{profileSummary.levelLabel}</dd>
              </div>
              <div>
                <dt>Стиль (проект)</dt>
                <dd>{profileSummary.styleLabel}</dd>
              </div>
              <div>
                <dt>Помощь (не включена)</dt>
                <dd>{profileSummary.assistanceLabel}</dd>
              </div>
              <div>
                <dt>Вызов (не включён)</dt>
                <dd>{profileSummary.challengeLabel}</dd>
              </div>
            </dl>
            <p>{profileSummary.calibrationNote}</p>
          </section>
        </div>
      )}
      <div className="asa-chess-dialog-actions">
        {onCancel && (
          <button type="button" className="secondary-button" onClick={onCancel}>
            {embedded ? 'Вернуться на главную' : 'Отмена'}
          </button>
        )}
        <button
          type="button"
          className="primary-button"
          disabled={busy}
          onClick={() => {
            onStart({
              mode,
              playerColor,
              botLevel: selectedProfile.engine.level,
              botProfileId: selectedProfile.id,
              ...(mode === 'analysis'
                ? {}
                : { initialMs: preset.initialMs, incrementMs: preset.incrementMs }),
            });
          }}
        >
          {mode === 'analysis' ? 'Открыть анализ' : 'Начать партию'}
        </button>
      </div>
    </section>
  );
}

export function NewGameDialog({
  onClose,
  onStart,
}: {
  onClose(): void;
  onStart(options: ProfiledChessGameOptions): void;
}) {
  return (
    <div className="asa-chess-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <NewGameSetup
        embedded={false}
        onCancel={onClose}
        onStart={(options) => {
          onStart(options);
          onClose();
        }}
      />
    </div>
  );
}

function ImportDialog({
  kind,
  exportPgn,
  currentFen,
  onClose,
  onImportPgn,
  onImportFen,
}: {
  kind: ImportKind;
  exportPgn: string;
  currentFen: string;
  onClose(): void;
  onImportPgn(value: string): boolean;
  onImportFen(value: string): boolean;
}) {
  const [value, setValue] = useState(kind === 'pgn' ? exportPgn : currentFen);
  const [copied, setCopied] = useState(false);
  const importValue = () => {
    const accepted = kind === 'pgn' ? onImportPgn(value) : onImportFen(value);
    if (accepted) onClose();
  };
  return (
    <div className="asa-chess-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="asa-chess-dialog asa-chess-import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="chess-import-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="asa-chess-dialog-head">
          <div>
            <span className="eyebrow">Обмен позициями</span>
            <h2 id="chess-import-title">{kind === 'pgn' ? 'PGN партии' : 'FEN позиции'}</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Закрыть">
            ×
          </button>
        </div>
        <p>
          Импорт создаёт анализ внутри текущего проекта. Текст проверяется доменным движком;
          нелегальные ходы и дополнительные поля отклоняются.
        </p>
        <textarea
          value={value}
          onChange={(event) => setValue(event.target.value)}
          spellCheck={false}
          aria-label={kind === 'pgn' ? 'PGN' : 'FEN'}
        />
        <div className="asa-chess-dialog-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              void navigator.clipboard?.writeText(value).then(() => setCopied(true));
            }}
          >
            {copied ? 'Скопировано' : 'Копировать'}
          </button>
          <button type="button" className="primary-button" onClick={importValue}>
            Импортировать
          </button>
        </div>
      </section>
    </div>
  );
}

export function ChessEditor({
  projectId,
  onBack,
  onHome,
  startNewGame = false,
  setupPage = false,
  onGameStarted,
  initialPanelTab = 'game',
  onPanelTabChange,
  user,
}: ChessEditorProps): JSX.Element {
  const controller = useChessProject(projectId);
  const [panelTab, setPanelTab] = useState<ChessPanelTab>(initialPanelTab);
  const [newGameOpen, setNewGameOpen] = useState(startNewGame);
  const [importKind, setImportKind] = useState<ImportKind | null>(null);

  useEffect(() => {
    setPanelTab(initialPanelTab);
  }, [initialPanelTab]);

  function selectPanelTab(tab: ChessPanelTab): void {
    setPanelTab(tab);
    onPanelTabChange?.(tab);
  }

  if (controller.loadState === 'loading') {
    return (
      <main className="asa-chess-loading" role="status" aria-live="polite">
        Загружаем ASA Chess…
      </main>
    );
  }
  if (
    controller.loadState === 'error' ||
    !controller.document ||
    !controller.position ||
    !controller.project
  ) {
    return (
      <main className="asa-chess-loading">
        <section role="alert">
          <h1>Не удалось открыть шахматы</h1>
          <p>{controller.notice ?? 'Попробуйте открыть игру ещё раз.'}</p>
          <button type="button" className="secondary-button" onClick={onBack}>
            К играм
          </button>
        </section>
      </main>
    );
  }

  const document = controller.document;
  const position = controller.position;

  if (setupPage) {
    return (
      <main className="asa-chess-shell asa-chess-bot-page">
        <ChessEditorHeader
          projectTitle={controller.projectTitle}
          persistedProjectTitle={controller.project.title}
          onProjectTitleChange={controller.setProjectTitle}
          onProjectTitleCommit={controller.renameProject}
          saveStatus={controller.saveStatus}
          statusDetail="Выбор соперника"
          busy={controller.busy}
          onBack={onBack}
          onHome={onHome}
          onNewGame={() => undefined}
          onCheckpoint={() => void controller.checkpoint()}
          onSave={() => void controller.saveNow()}
          userDisplayName={user.displayName}
        />
        <div className="asa-chess-bot-page-body">
          <header>
            <span className="eyebrow">ASA Chess · Боты</span>
            <h1>Игра с ASA Bot</h1>
            <p>Выберите контроль времени, цвет и одного из 12 оригинальных соперников ASA.</p>
          </header>
          <NewGameSetup
            embedded
            busy={controller.busy}
            {...(onHome ? { onCancel: onHome } : {})}
            onStart={(options) => {
              void controller.startGameAndSave(options).then((saved) => {
                if (saved) onGameStarted?.();
              });
            }}
          />
        </div>
      </main>
    );
  }
  const topColor = opposite(document.orientation);
  const bottomColor = document.orientation;
  const botColor = document.bot?.color ?? null;
  const botProfile = document.bot?.profileId
    ? resolveAsaBotProfile(document.bot.profileId, document.bot.level)
    : null;
  const botSummary = botProfile ? botProfileUiSummary(botProfile) : null;
  const whiteClock = controller.displayClock('white');
  const blackClock = controller.displayClock('black');
  const evaluation = evaluationPercent(controller.evaluationCp);
  const lastMoveUci = document.moves.at(-1)?.uci;

  return (
    <main className="asa-chess-shell">
      <ChessEditorHeader
        projectTitle={controller.projectTitle}
        persistedProjectTitle={controller.project.title}
        onProjectTitleChange={controller.setProjectTitle}
        onProjectTitleCommit={controller.renameProject}
        saveStatus={controller.saveStatus}
        statusDetail={
          controller.saveStatus === 'error'
            ? 'Изменения не удалось записать на сервер.'
            : modeLabel(document.mode)
        }
        busy={controller.busy}
        onBack={onBack}
        onHome={onHome}
        onNewGame={() => setNewGameOpen(true)}
        onCheckpoint={() => void controller.checkpoint()}
        onSave={() => void controller.saveNow()}
        userDisplayName={user.displayName}
      />

      <div className="asa-chess-workspace">
        <section className="asa-chess-board-column" aria-label="Партия">
          <ChessPlayerBar
            color={topColor}
            name={playerName(
              topColor,
              document.mode,
              botColor,
              botProfile?.displayName ?? null,
              user,
            )}
            milliseconds={topColor === 'white' ? whiteClock : blackClock}
            active={position.turn === topColor && document.result === '*'}
            thinking={controller.botThinking && botColor === topColor}
          />
          <div className="asa-chess-board-row">
            <div
              className="asa-chess-eval"
              aria-label={`Оценка позиции ${evaluationLabel(controller.evaluationCp)}`}
            >
              <span className="asa-chess-eval-black" style={{ height: `${100 - evaluation}%` }} />
              <span className="asa-chess-eval-white" style={{ height: `${evaluation}%` }} />
              <strong>{evaluationLabel(controller.evaluationCp)}</strong>
            </div>
            <ChessBoard
              position={position}
              orientation={document.orientation}
              selectedSquare={controller.selectedSquare}
              legalMoves={controller.legalMoves}
              lastMoveUci={lastMoveUci}
              disabled={!controller.canHumanMove || controller.promotion !== null}
              onSquare={controller.selectBoardSquare}
              onMove={controller.moveFromTo}
            />
          </div>
          <ChessPlayerBar
            color={bottomColor}
            name={playerName(
              bottomColor,
              document.mode,
              botColor,
              botProfile?.displayName ?? null,
              user,
            )}
            milliseconds={bottomColor === 'white' ? whiteClock : blackClock}
            active={position.turn === bottomColor && document.result === '*'}
            thinking={controller.botThinking && botColor === bottomColor}
          />
          <div className="asa-chess-board-actions" aria-label="Управление доской">
            <button type="button" onClick={controller.flip}>
              Перевернуть
            </button>
            <button
              type="button"
              disabled={document.moves.length === 0 || controller.botThinking}
              onClick={controller.undo}
            >
              Отменить ход
            </button>
            <button type="button" disabled={document.moves.length === 0} onClick={controller.reset}>
              В начало
            </button>
            <button type="button" onClick={() => setImportKind('fen')}>
              FEN
            </button>
            <button type="button" onClick={() => setImportKind('pgn')}>
              PGN
            </button>
          </div>
        </section>

        <aside className="asa-chess-panel">
          <div className="asa-chess-tabs" role="tablist" aria-label="Панель шахматной игры">
            {(
              [
                ['game', 'Партия'],
                ['analysis', 'Анализ'],
                ['versions', 'Версии'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={panelTab === value}
                className={panelTab === value ? 'active' : ''}
                onClick={() => selectPanelTab(value)}
              >
                {label}
              </button>
            ))}
          </div>

          {panelTab === 'game' && (
            <div className="asa-chess-panel-content">
              <section
                className={`asa-chess-result result-${document.result.replaceAll('/', '-')}`}
                aria-live="polite"
              >
                <strong>{resultLabel(document.result, document.termination)}</strong>
                <span>
                  {controller.botThinking
                    ? 'ASA Bot рассчитывает ход.'
                    : controller.chessStatus?.inCheck
                      ? 'Король под шахом.'
                      : `${controller.legalMoves.length} допустимых ходов.`}
                </span>
              </section>
              {botProfile && botSummary && (
                <section className="asa-chess-active-bot" aria-label="Профиль соперника">
                  <div>
                    <span>ASA соперник</span>
                    <strong>{botProfile.displayName}</strong>
                  </div>
                  <dl>
                    <div>
                      <dt>Уровень; стиль — проектный сигнал</dt>
                      <dd>
                        {botSummary.levelLabel}; {botSummary.styleLabel}
                      </dd>
                    </div>
                    <div>
                      <dt>Будущая политика партии</dt>
                      <dd>
                        {botSummary.assistanceLabel}; {botSummary.challengeLabel}
                      </dd>
                    </div>
                  </dl>
                  <p>{botSummary.calibrationNote}</p>
                </section>
              )}
              <MoveList moves={document.moves} />
              <div className="asa-chess-game-controls">
                <button
                  type="button"
                  disabled={document.result !== '*'}
                  onClick={controller.agreeDraw}
                >
                  Ничья
                </button>
                <button
                  type="button"
                  className="danger"
                  disabled={document.result !== '*'}
                  onClick={controller.resign}
                >
                  Сдаться
                </button>
              </div>
              {/* Candidate-contract marker: fair play */}
              <p className="asa-chess-fair-play-note">
                Подсказки и анализ доступны на учебной доске. В рейтинговой онлайн-партии они
                автоматически отключаются правилами Fair Play.
              </p>
            </div>
          )}

          {panelTab === 'analysis' && (
            <div className="asa-chess-panel-content">
              <section className="asa-chess-analysis-card">
                <span>Оценка</span>
                <strong>{evaluationLabel(controller.evaluationCp)}</strong>
                <small>Положительное значение — преимущество белых.</small>
              </section>
              <dl className="asa-chess-analysis-list">
                <div>
                  <dt>Лучший ход после сохранения</dt>
                  <dd>{controller.analysis?.bestMoveUci ?? '—'}</dd>
                </div>
                <div>
                  <dt>Узлов локального анализа</dt>
                  <dd>{controller.analysis?.searchedNodes.toLocaleString('ru-RU') ?? '—'}</dd>
                </div>
                <div>
                  <dt>FEN</dt>
                  <dd>
                    <code>{document.currentFen}</code>
                  </dd>
                </div>
                <div>
                  <dt>Режим</dt>
                  <dd>{modeLabel(document.mode)}</dd>
                </div>
              </dl>
              <div className="asa-chess-analysis-actions">
                <button type="button" onClick={() => controller.startGame({ mode: 'analysis' })}>
                  Новая доска анализа
                </button>
                <button type="button" onClick={() => setImportKind('pgn')}>
                  Импорт / экспорт PGN
                </button>
                <button type="button" onClick={() => setImportKind('fen')}>
                  Установить FEN
                </button>
              </div>
            </div>
          )}

          {panelTab === 'versions' && (
            <div className="asa-chess-panel-content">
              <button
                type="button"
                className="primary-button full"
                onClick={() => void controller.checkpoint()}
              >
                Создать неизменяемую версию
              </button>
              {controller.versions.length === 0 ? (
                <div className="asa-chess-empty-list">Версий пока нет.</div>
              ) : (
                <ol className="asa-chess-versions">
                  {controller.versions.map((version) => (
                    <li key={version.id}>
                      <strong>Версия №{version.versionNo}</strong>
                      <span>{version.label ?? 'Без подписи'}</span>
                      <time>{new Date(version.createdAt).toLocaleString('ru-RU')}</time>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
        </aside>
      </div>

      {controller.notice && (
        <button
          type="button"
          className="asa-chess-toast"
          onClick={controller.clearNotice}
          aria-live="polite"
        >
          {controller.notice}
        </button>
      )}

      {controller.promotion && (
        <div className="asa-chess-dialog-backdrop" role="presentation">
          <section
            className="asa-chess-promotion"
            role="dialog"
            aria-modal="true"
            aria-labelledby="promotion-title"
          >
            <h2 id="promotion-title">Выберите фигуру</h2>
            <div>
              {controller.promotion.moves.map((move) => {
                const promotion = move.promotion as PromotionPiece;
                const color = position.turn;
                return (
                  <button
                    key={promotion}
                    type="button"
                    onClick={() => controller.choosePromotion(move)}
                  >
                    <span aria-hidden="true">{DOMAIN_PIECES[color][promotion]}</span>
                    {promotion === 'queen'
                      ? 'Ферзь'
                      : promotion === 'rook'
                        ? 'Ладья'
                        : promotion === 'bishop'
                          ? 'Слон'
                          : 'Конь'}
                  </button>
                );
              })}
            </div>
            <button type="button" className="secondary-button" onClick={controller.cancelPromotion}>
              Отмена
            </button>
          </section>
        </div>
      )}

      {newGameOpen && (
        <NewGameDialog onClose={() => setNewGameOpen(false)} onStart={controller.startGame} />
      )}
      {importKind && (
        <ImportDialog
          kind={importKind}
          exportPgn={controller.exportPgn()}
          currentFen={document.currentFen}
          onClose={() => setImportKind(null)}
          onImportPgn={controller.importPgn}
          onImportFen={controller.importFen}
        />
      )}
    </main>
  );
}
