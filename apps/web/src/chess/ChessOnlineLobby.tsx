import {
  generateLegalMoves,
  moveToUci,
  parseFen,
  pieceAt,
  type ChessMove,
  type ChessPosition,
  type Square,
} from '@asa-lab/chess';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PublicUser } from '../api';
import { ChessBoard } from './ChessBoard';
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
import './chess-online.css';

interface ChessOnlineLobbyProps {
  user: PublicUser;
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
  return `${prefix}:${crypto.randomUUID()}`;
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

export function ChessOnlineLobby({ user, onBackToProject }: ChessOnlineLobbyProps) {
  const [presetIndex, setPresetIndex] = useState(3);
  const [colorPreference, setColorPreference] = useState<LiveColorPreference>('random');
  const [rated, setRated] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [challenge, setChallenge] = useState<LiveChallengeView | null>(null);
  const [ticket, setTicket] = useState<MatchmakingTicketView | null>(null);
  const [game, setGame] = useState<LiveGameView | null>(null);
  const [rating, setRating] = useState<LiveRatingView | null>(null);
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  const [notice, setNotice] = useState(
    'Создайте вызов, введите код соперника или войдите в очередь.',
  );
  const [busy, setBusy] = useState(false);
  const [pollTick, setPollTick] = useState(0);
  const matchmakingCommandRef = useRef<string | null>(null);

  const preset = TIME_PRESETS[presetIndex] ?? TIME_PRESETS[3]!;
  const position = useMemo(() => positionFromGame(game), [game]);
  const legalMoves = useMemo(() => (position ? generateLegalMoves(position) : []), [position]);
  const selectedMoves = useMemo(
    () => legalMoves.filter((move) => move.from === selectedSquare),
    [legalMoves, selectedSquare],
  );
  const canMove = Boolean(
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

  useEffect(() => {
    if (!challenge || challenge.status !== 'open' || game) return;
    const timer = window.setInterval(() => setPollTick((value) => value + 1), 1_000);
    return () => window.clearInterval(timer);
  }, [challenge, game]);

  useEffect(() => {
    if (!ticket || ticket.status !== 'queued' || game) return;
    const timer = window.setInterval(() => setPollTick((value) => value + 1), 1_200);
    return () => window.clearInterval(timer);
  }, [game, ticket]);

  useEffect(() => {
    if (!game || game.status !== 'active') return;
    const timer = window.setInterval(() => setPollTick((value) => value + 1), 800);
    return () => window.clearInterval(timer);
  }, [game]);

  useEffect(() => {
    if (game) {
      void chessLiveApi.getGame(game.gameId).then((response) => {
        if (response.ok) setGame(response.data.game);
      });
      return;
    }
    if (challenge?.status === 'open') {
      void chessLiveApi.getChallenge(challenge.publicCode).then(async (response) => {
        if (!response.ok) return;
        setChallenge(response.data.challenge);
        if (response.data.challenge.gameId) {
          const opened = await chessLiveApi.getGame(response.data.challenge.gameId);
          if (opened.ok) {
            setGame(opened.data.game);
            setNotice('Соперник принял вызов. Партия началась.');
          }
        }
      });
      return;
    }
    if (ticket?.status === 'queued' && matchmakingCommandRef.current) {
      void chessLiveApi
        .joinMatchmaking({
          commandId: matchmakingCommandRef.current,
          initialMs: ticket.timeControl.initialMs,
          incrementMs: ticket.timeControl.incrementMs,
          rated: ticket.rated,
          colorPreference: ticket.colorPreference,
          expiresInMs: Math.max(30_000, ticket.expiresAtMs - Date.now()),
        })
        .then((response) => {
          if (!response.ok) return;
          setTicket(response.data.ticket);
          if (response.data.game) {
            setGame(response.data.game);
            setNotice('Соперник найден. Сервер создал онлайн-партию.');
          }
        });
    }
  }, [challenge, game, pollTick, ticket]);

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
    if (!game || !canMove) return;
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
        <header className="asa-online-header">
          <button type="button" className="asa-chess-back" onClick={onBackToProject}>
            <span aria-hidden="true">←</span> К шахматному проекту
          </button>
          <div>
            <span className="eyebrow">ASA Chess · Онлайн</span>
            <h1>{game.rated ? 'Рейтинговая партия' : 'Товарищеская партия'}</h1>
          </div>
          <span className="asa-online-version">
            v{game.version} · seq {game.sequence}
          </span>
        </header>
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
                    ? 'Ваш ход подтверждается сервером.'
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
            <p className="asa-online-authority-note">
              Ходы, версия позиции, результат и часы определяются сервером. Браузер отправляет
              только UCI-команду и ожидаемую версию.
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
      <header className="asa-online-header">
        <button type="button" className="asa-chess-back" onClick={onBackToProject}>
          <span aria-hidden="true">←</span> К шахматному проекту
        </button>
        <div>
          <span className="eyebrow">ASA Chess · Онлайн</span>
          <h1>Вызовы и поиск соперника</h1>
        </div>
        <span className="asa-online-rating">
          Rapid {rating?.rating ?? 1200}
          {rating?.provisional ? '?' : ''}
        </span>
      </header>
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
            Код действует только внутри текущей организации. Пользователь не может принять
            собственный вызов или указать чужой tenant/user в запросе.
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
        Candidate использует REST polling и in-memory adapter. Production WebSocket и PostgreSQL
        repository подключаются только после локального gate, R0 и Chess Foundation acceptance.
      </footer>
    </main>
  );
}
