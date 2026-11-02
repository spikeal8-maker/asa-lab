import {
  generateLegalMoves,
  moveToUci,
  parseFen,
  pieceAt,
  type ChessMove,
  type ChessPosition,
  type Square,
} from '@asa-lab/chess';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PublicUser } from '../api';
import { newClientId } from '../client-id';
import { ChessBoard } from './ChessBoard';
import { ChessSectionHeader } from './ChessSectionHeader';
import {
  chessLiveApi,
  type LiveChallengeView,
  type LiveColor,
  type LiveColorPreference,
  type LiveGameView,
  type LiveRatingView,
  type MatchmakingTicketView,
} from './chess-live-api';
import { formatChessClock, resultLabel } from './chess-ui';
import { newestLiveSnapshot, startLivePoll } from './live-poll';
import './chess-online.css';

// Server-authority contract: Ходы, версия позиции, результат и часы определяются сервером.
// Candidate-contract marker retained after the visible title was simplified:
// Вызовы и поиск соперника.

interface ChessOnlineLobbyProps {
  user: PublicUser;
  onExit(): void;
  onBackToProject(): void;
}

interface TimePreset {
  readonly label: string;
  readonly initialMs: number;
  readonly incrementMs: number;
}

const TIME_PRESETS: readonly TimePreset[] = [
  { label: '1+0', initialMs: 60_000, incrementMs: 0 },
  { label: '3+2', initialMs: 180_000, incrementMs: 2_000 },
  { label: '5+0', initialMs: 300_000, incrementMs: 0 },
  { label: '10+5', initialMs: 600_000, incrementMs: 5_000 },
  { label: '15+10', initialMs: 900_000, incrementMs: 10_000 },
] as const;

function newCommandId(prefix: string): string {
  return `${prefix}:${newClientId()}`;
}

function positionFromGame(game: LiveGameView | null): ChessPosition | null {
  if (!game) return null;
  const parsed = parseFen(game.currentFen);
  return parsed.ok ? parsed.value : null;
}

function playerLabel(game: LiveGameView, color: LiveColor, user: PublicUser): string {
  const id = color === 'white' ? game.whitePlayerId : game.blackPlayerId;
  if (id === user.id) return user.displayName;
  return color === 'white' ? 'Соперник — белые' : 'Соперник — чёрные';
}

function LivePlayer({
  game,
  color,
  user,
}: {
  game: LiveGameView;
  color: LiveColor;
  user: PublicUser;
}) {
  const remaining = color === 'white' ? game.whiteRemainingMs : game.blackRemainingMs;
  const active = game.status === 'active' && game.activeColor === color;
  return (
    <div className={`asa-live-player ${active ? 'active' : ''}`} data-color={color}>
      <span className={`asa-live-avatar ${color}`} aria-hidden="true">
        {color === 'white' ? '♔' : '♚'}
      </span>
      <span>
        <strong>{playerLabel(game, color, user)}</strong>
        <small>{active ? 'Ход' : color === 'white' ? 'Белые' : 'Чёрные'}</small>
      </span>
      <time className={remaining < 20_000 ? 'low' : ''}>{formatChessClock(remaining)}</time>
    </div>
  );
}

function LiveMoveList({ game }: { game: LiveGameView }) {
  if (game.moves.length === 0) {
    return <div className="asa-online-empty">Партия началась. Белые делают первый ход.</div>;
  }
  const rows = Array.from({ length: Math.ceil(game.moves.length / 2) }, (_, index) => ({
    number: index + 1,
    white: game.moves[index * 2],
    black: game.moves[index * 2 + 1],
  }));
  return (
    <ol className="asa-online-moves" aria-label="Ходы онлайн-партии">
      {rows.map((row) => (
        <li key={row.number}>
          <span>{row.number}.</span>
          <strong>{row.white?.san ?? ''}</strong>
          <strong>{row.black?.san ?? ''}</strong>
        </li>
      ))}
    </ol>
  );
}

export function ChessOnlineLobby({ user, onExit, onBackToProject }: ChessOnlineLobbyProps) {
  const [presetIndex, setPresetIndex] = useState(3);
  const [colorPreference, setColorPreference] = useState<LiveColorPreference>('random');
  const [rated, setRated] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [challenge, setChallenge] = useState<LiveChallengeView | null>(null);
  const [ticket, setTicket] = useState<MatchmakingTicketView | null>(null);
  const [game, setGameState] = useState<LiveGameView | null>(null);
  const setGame = useCallback((incoming: LiveGameView | null) => {
    setGameState((current) => newestLiveSnapshot(current, incoming));
  }, []);
  const [connected, setConnected] = useState(true);
  const [rating, setRating] = useState<LiveRatingView | null>(null);
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  const [notice, setNotice] = useState(
    'Создайте вызов, введите код соперника или войдите в очередь.',
  );
  const [busy, setBusy] = useState(false);
  const matchmakingCommandRef = useRef<string | null>(null);
  const movePendingRef = useRef(false);

  const preset = TIME_PRESETS[presetIndex] ?? TIME_PRESETS[3]!;
  const position = useMemo(() => positionFromGame(game), [game]);
  const legalMoves = useMemo(() => (position ? generateLegalMoves(position) : []), [position]);
  const selectedMoves = useMemo(
    () => legalMoves.filter((move) => move.from === selectedSquare),
    [legalMoves, selectedSquare],
  );
  const canMove = Boolean(
    !busy &&
    connected &&
    game &&
    position &&
    game.status === 'active' &&
    game.viewerColor === position.turn &&
    game.activeColor === position.turn,
  );

  useEffect(() => {
    void chessLiveApi.getRating('rapid').then((response) => {
      if (response.ok) setRating(response.data.rating);
    });
  }, []);

  // Depend on session identity, never on response objects: updating a snapshot
  // must not trigger another immediate request. Cleanup invalidates late replies.
  const pollingState = useRef({ game, challenge, ticket });
  pollingState.current = { game, challenge, ticket };
  const gameId = game?.gameId;
  const gameStatus = game?.status;
  const challengeCode = challenge?.publicCode;
  const challengeStatus = challenge?.status;
  const ticketId = ticket?.id;
  const ticketStatus = ticket?.status;

  useEffect(() => {
    if (gameStatus === 'finished') return;
    if (!gameId && challengeStatus !== 'open' && ticketStatus !== 'queued') return;
    const failed = (): void => setConnected(false);
    return startLivePoll(
      async (isCurrent) => {
        const session = pollingState.current;
        if (gameId) {
          const response = await chessLiveApi.getGame(gameId);
          if (!isCurrent()) return;
          setConnected(response.ok);
          if (response.ok) setGame(response.data.game);
          return;
        }
        if (challengeCode && challengeStatus === 'open') {
          const response = await chessLiveApi.getChallenge(challengeCode);
          if (!isCurrent()) return;
          setConnected(response.ok);
          if (!response.ok) return;
          if (response.data.challenge.gameId) {
            const opened = await chessLiveApi.getGame(response.data.challenge.gameId);
            if (!isCurrent()) return;
            setConnected(opened.ok);
            if (!opened.ok) return;
            if (opened.ok) {
              setGame(opened.data.game);
              setNotice('Соперник принял вызов. Партия началась.');
            }
          }
          setChallenge(response.data.challenge);
          return;
        }
        if (session.ticket?.status === 'queued' && matchmakingCommandRef.current) {
          const response = await chessLiveApi.joinMatchmaking({
            commandId: matchmakingCommandRef.current,
            initialMs: session.ticket.timeControl.initialMs,
            incrementMs: session.ticket.timeControl.incrementMs,
            rated: session.ticket.rated,
            colorPreference: session.ticket.colorPreference,
            expiresInMs: Math.max(30_000, session.ticket.expiresAtMs - Date.now()),
          });
          if (!isCurrent()) return;
          setConnected(response.ok);
          if (!response.ok) return;
          setTicket(response.data.ticket);
          if (response.data.game) {
            setGame(response.data.game);
            setNotice('Соперник найден. Партия началась.');
          }
        }
      },
      gameId ? 800 : 1_200,
      failed,
    );
  }, [gameId, gameStatus, challengeCode, challengeStatus, ticketId, ticketStatus, setGame]);

  async function createChallenge(): Promise<void> {
    setBusy(true);
    const response = await chessLiveApi.createChallenge({
      commandId: newCommandId('challenge-create'),
      colorPreference,
      initialMs: preset.initialMs,
      incrementMs: preset.incrementMs,
      rated,
      expiresInMs: 30 * 60_000,
    });
    setBusy(false);
    if (!response.ok) {
      setNotice(response.error.message);
      return;
    }
    setChallenge(response.data.challenge);
    setTicket(null);
    setGame(null);
    setNotice(`Вызов создан. Передайте код ${response.data.challenge.publicCode} сопернику.`);
  }

  async function acceptChallenge(): Promise<void> {
    const code = joinCode.trim().toUpperCase();
    if (!code) return;
    setBusy(true);
    const response = await chessLiveApi.acceptChallenge(code, newCommandId('challenge-accept'));
    setBusy(false);
    if (!response.ok) {
      setNotice(response.error.message);
      return;
    }
    setChallenge(response.data.challenge);
    setTicket(null);
    setGame(response.data.game);
    setNotice('Вызов принят. Сервер назначил цвета и запустил часы.');
  }

  async function cancelChallenge(): Promise<void> {
    if (!challenge) return;
    const response = await chessLiveApi.cancelChallenge(
      challenge.id,
      newCommandId('challenge-cancel'),
    );
    if (response.ok) {
      setChallenge(response.data.challenge);
      setNotice('Вызов отменён.');
    } else {
      setNotice(response.error.message);
    }
  }

  async function joinMatchmaking(): Promise<void> {
    const commandId = newCommandId('matchmaking-join');
    matchmakingCommandRef.current = commandId;
    setBusy(true);
    const response = await chessLiveApi.joinMatchmaking({
      commandId,
      initialMs: preset.initialMs,
      incrementMs: preset.incrementMs,
      rated,
      colorPreference,
      expiresInMs: 10 * 60_000,
    });
    setBusy(false);
    if (!response.ok) {
      setNotice(response.error.message);
      return;
    }
    setChallenge(null);
    setTicket(response.data.ticket);
    setGame(response.data.game);
    setNotice(response.data.game ? 'Соперник найден.' : 'Вы вошли в очередь поиска соперника.');
  }

  async function cancelMatchmaking(): Promise<void> {
    if (!ticket) return;
    const response = await chessLiveApi.cancelMatchmaking(
      ticket.id,
      ticket.version,
      newCommandId('matchmaking-cancel'),
    );
    if (response.ok) {
      setTicket(response.data.ticket);
      matchmakingCommandRef.current = null;
      setNotice('Поиск соперника отменён.');
    } else {
      setNotice(response.error.message);
    }
  }

  async function play(move: ChessMove): Promise<void> {
    if (!game || !canMove || movePendingRef.current) return;
    movePendingRef.current = true;
    setBusy(true);
    setSelectedSquare(null);
    const response = await chessLiveApi.submitMove(
      game.gameId,
      game.version,
      moveToUci(move),
      newCommandId('live-move'),
    );
    if (response.ok) {
      setGame(response.data.game);
      setNotice(`Ход ${response.data.game.moves.at(-1)?.san ?? moveToUci(move)} принят сервером.`);
    } else {
      setNotice(response.error.message);
      const refreshed = await chessLiveApi.getGame(game.gameId);
      if (refreshed.ok) setGame(refreshed.data.game);
    }
    movePendingRef.current = false;
    setBusy(false);
  }

  function selectBoardSquare(square: Square): void {
    if (!position || !canMove || !game?.viewerColor) return;
    const clicked = pieceAt(position, square);
    if (!selectedSquare) {
      if (clicked?.color === game.viewerColor) setSelectedSquare(square);
      return;
    }
    const candidates = legalMoves.filter(
      (move) => move.from === selectedSquare && move.to === square,
    );
    if (candidates.length === 1) {
      void play(candidates[0]!);
      return;
    }
    if (candidates.length > 1) {
      const queen = candidates.find((move) => move.promotion === 'queen') ?? candidates[0];
      if (queen) void play(queen);
      return;
    }
    setSelectedSquare(clicked?.color === game.viewerColor ? square : null);
  }

  function dragMove(from: Square, to: Square): void {
    const candidates = legalMoves.filter((move) => move.from === from && move.to === to);
    const move =
      candidates.length === 1
        ? candidates[0]
        : candidates.find((candidate) => candidate.promotion === 'queen');
    if (move) void play(move);
  }

  async function control(
    action: 'draw-offer' | 'draw-accept' | 'draw-decline' | 'resign' | 'claim-timeout',
  ): Promise<void> {
    if (!game) return;
    const response = await chessLiveApi.gameControl(
      game.gameId,
      action,
      game.version,
      newCommandId(`live-${action}`),
    );
    if (response.ok) {
      setGame(response.data.game);
      setNotice('Команда подтверждена сервером.');
    } else {
      setNotice(response.error.message);
    }
  }

  function leaveGame(): void {
    setGame(null);
    setChallenge(null);
    setTicket(null);
    setSelectedSquare(null);
    matchmakingCommandRef.current = null;
    setNotice('Онлайн-сессия закрыта на этом устройстве. Завершённая партия остаётся на сервере.');
  }

  if (game && position) {
    const viewer = game.viewerColor;
    const topColor: LiveColor = viewer === 'black' ? 'white' : 'black';
    const bottomColor: LiveColor = viewer === 'black' ? 'black' : 'white';
    const opponentOffered = Boolean(
      game.drawOffer &&
      ((viewer === 'white' && game.drawOffer.offeredBy === game.blackPlayerId) ||
        (viewer === 'black' && game.drawOffer.offeredBy === game.whitePlayerId)),
    );
    return (
      <main className="asa-online-shell">
        <ChessSectionHeader
          user={user}
          title={game.rated ? 'Рейтинговая партия' : 'Товарищеская партия'}
          status={{
            kind: connected ? 'saved' : 'error',
            label: connected ? 'Подключено' : 'Восстанавливаем связь',
            detail: connected ? 'Позиция синхронизируется автоматически' : 'Повторяем подключение',
          }}
          onExit={onExit}
          onHome={onBackToProject}
        />
        <div className="asa-online-game-layout">
          <section className="asa-online-board-column">
            <LivePlayer game={game} color={topColor} user={user} />
            <ChessBoard
              position={position}
              orientation={viewer ?? 'white'}
              selectedSquare={selectedSquare}
              legalMoves={selectedMoves.length > 0 ? selectedMoves : legalMoves}
              lastMoveUci={game.moves.at(-1)?.uci}
              disabled={!canMove}
              onSquare={selectBoardSquare}
              onMove={dragMove}
            />
            <LivePlayer game={game} color={bottomColor} user={user} />
          </section>
          <aside className="asa-online-game-panel">
            <section className={`asa-online-result ${game.status}`} aria-live="polite">
              <strong>{resultLabel(game.result, game.termination)}</strong>
              <span>
                {game.status === 'active'
                  ? game.activeColor === viewer
                    ? 'Ваш ход.'
                    : 'Ожидаем ход соперника.'
                  : 'Партия завершена.'}
              </span>
            </section>
            {opponentOffered && (
              <section className="asa-online-draw-offer">
                <strong>Соперник предлагает ничью</strong>
                <div>
                  <button type="button" onClick={() => void control('draw-accept')}>
                    Принять
                  </button>
                  <button type="button" onClick={() => void control('draw-decline')}>
                    Отклонить
                  </button>
                </div>
              </section>
            )}
            <LiveMoveList game={game} />
            <div className="asa-online-controls">
              <button
                type="button"
                disabled={game.status !== 'active' || game.drawOffer !== null}
                onClick={() => void control('draw-offer')}
              >
                Предложить ничью
              </button>
              <button
                type="button"
                disabled={game.status !== 'active'}
                onClick={() => void control('claim-timeout')}
              >
                Проверить время
              </button>
              <button
                type="button"
                className="danger"
                disabled={game.status !== 'active'}
                onClick={() => void control('resign')}
              >
                Сдаться
              </button>
              <button type="button" onClick={leaveGame}>
                Закрыть
              </button>
            </div>
            <p className="asa-online-authority-note" role="status">
              {connected
                ? 'Выберите фигуру и поле или перетащите фигуру, чтобы сделать ход.'
                : 'Связь с сервером потеряна. Повторяем подключение автоматически.'}
            </p>
            <button type="button" className="asa-online-notice" onClick={() => setNotice('')}>
              {notice}
            </button>
          </aside>
        </div>
      </main>
    );
  }

  return (
    <main className="asa-online-shell">
      <ChessSectionHeader
        user={user}
        title="Онлайн-шахматы"
        status={{
          kind: 'saved',
          label: `Rapid ${rating?.rating ?? 1200}${rating?.provisional ? '?' : ''}`,
          detail: `${rating?.games ?? 0} подтверждённых партий`,
        }}
        onExit={onExit}
        onHome={onBackToProject}
      />
      <div className="asa-online-lobby">
        <section className="asa-online-card asa-online-create-card">
          <span className="eyebrow">Новая партия</span>
          <h2>Создать вызов</h2>
          <fieldset className="asa-online-time-grid">
            <legend>Контроль времени</legend>
            {TIME_PRESETS.map((value, index) => (
              <button
                type="button"
                key={value.label}
                className={presetIndex === index ? 'selected' : ''}
                onClick={() => setPresetIndex(index)}
              >
                {value.label}
              </button>
            ))}
          </fieldset>
          <fieldset className="asa-online-color-grid">
            <legend>Цвет</legend>
            {(
              [
                ['white', 'Белые'],
                ['random', 'Случайно'],
                ['black', 'Чёрные'],
              ] as const
            ).map(([value, label]) => (
              <button
                type="button"
                key={value}
                className={colorPreference === value ? 'selected' : ''}
                onClick={() => setColorPreference(value)}
              >
                {label}
              </button>
            ))}
          </fieldset>
          <label className="asa-online-rated-toggle">
            <input
              type="checkbox"
              checked={rated}
              onChange={(event) => setRated(event.target.checked)}
            />
            <span>
              <strong>Рейтинговая</strong>
              <small>Использует прозрачный ASA Elo v1 после завершения.</small>
            </span>
          </label>
          <div className="asa-online-primary-actions">
            <button type="button" disabled={busy} onClick={() => void createChallenge()}>
              Создать код вызова
            </button>
            <button type="button" disabled={busy} onClick={() => void joinMatchmaking()}>
              Найти соперника
            </button>
          </div>
        </section>

        <section className="asa-online-card">
          <span className="eyebrow">Прямой вызов</span>
          <h2>Принять код</h2>
          <label className="asa-online-code-field">
            <span>Код соперника</span>
            <input
              value={joinCode}
              maxLength={16}
              placeholder="LIVE00000001"
              onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
            />
          </label>
          <button
            type="button"
            className="primary-button full"
            disabled={busy || joinCode.trim().length < 8}
            onClick={() => void acceptChallenge()}
          >
            Принять вызов
          </button>
          <p>
            Введите код друга из вашей организации. После подключения партия начнётся автоматически.
          </p>
        </section>

        <section className="asa-online-card asa-online-status-card" aria-live="polite">
          <span className="eyebrow">Состояние</span>
          {challenge?.status === 'open' ? (
            <>
              <h2>Ожидаем соперника</h2>
              <output className="asa-online-share-code">{challenge.publicCode}</output>
              <p>
                {challenge.timeControl.initialMs / 60_000}+
                {challenge.timeControl.incrementMs / 1_000}
                {' · '}
                {challenge.rated ? 'рейтинговая' : 'товарищеская'}
              </p>
              <button
                type="button"
                onClick={() => void navigator.clipboard?.writeText(challenge.publicCode)}
              >
                Копировать код
              </button>
              <button type="button" className="danger" onClick={() => void cancelChallenge()}>
                Отменить вызов
              </button>
            </>
          ) : ticket?.status === 'queued' ? (
            <>
              <h2>Ищем соперника</h2>
              <div className="asa-online-search-pulse" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <p>
                {ticket.pool} · рейтинг {ticket.rating} · окно поиска расширяется со временем.
              </p>
              <button type="button" className="danger" onClick={() => void cancelMatchmaking()}>
                Отменить поиск
              </button>
            </>
          ) : (
            <>
              <h2>Готово к подключению</h2>
              <p>{notice}</p>
              <dl className="asa-online-rating-details">
                <div>
                  <dt>Rapid</dt>
                  <dd>{rating?.rating ?? 1200}</dd>
                </div>
                <div>
                  <dt>Партий</dt>
                  <dd>{rating?.games ?? 0}</dd>
                </div>
                <div>
                  <dt>Статус</dt>
                  <dd>{(rating?.provisional ?? true) ? 'Предварительный' : 'Подтверждённый'}</dd>
                </div>
              </dl>
            </>
          )}
        </section>
      </div>
      <footer className="asa-online-footer">
        Онлайн-партии подтверждаются сервером ASA Lab. Подсказки и анализ во время рейтинговой игры
        отключены правилами Fair Play.
      </footer>
    </main>
  );
}
