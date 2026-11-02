import {
  generateLegalMoves,
  moveToUci,
  parseFen,
  pieceAt,
  type ChessMove,
  type Square,
} from '@asa-lab/chess';
import type {
  ChessNetworkAccess,
  ChessNetworkAction,
  ChessNetworkInvite,
  ChessNetworkLobby as LobbySnapshot,
  ChessNetworkMatch,
  ChessNetworkScope,
} from '@asa-lab/contracts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PublicUser } from '../api';
import { ChessBoard } from './ChessBoard';
import { ChessSectionHeader } from './ChessSectionHeader';
import { chessNetworkApi } from './chess-network-api';
import { formatChessClock, resultLabel } from './chess-ui';
import { startLivePoll } from './live-poll';
import { defaultAvatarForAccount } from '../creator-portal/default-avatars';
import './chess-online.css';
import './chess-network.css';

const SCOPE_LABEL: Record<ChessNetworkScope, string> = {
  classroom: 'Мой класс',
  school: 'Моя школа',
  platform: 'Вся платформа',
};
const TIMES = [
  { label: '3+2', initialMs: 180000, incrementMs: 2000 },
  { label: '5+0', initialMs: 300000, incrementMs: 0 },
  { label: '10+5', initialMs: 600000, incrementMs: 5000 },
];
const PROMOTIONS = { queen: 'Ферзь', rook: 'Ладья', bishop: 'Слон', knight: 'Конь' };

function LobbyAvatar({ player }: { player: LobbySnapshot['players'][number] }) {
  return (
    <img
      className="asa-network-avatar"
      src={player.avatarUrl || defaultAvatarForAccount(player.playerId).src}
      alt={`Аватар ${player.displayAlias}`}
      width={44}
      height={44}
      loading="lazy"
      onError={(event) => {
        if (event.currentTarget.dataset['fallback'] !== 'true') {
          event.currentTarget.dataset['fallback'] = 'true';
          event.currentTarget.src = defaultAvatarForAccount(player.playerId).src;
        }
      }}
    />
  );
}

/** Only the server's terminal result and current opaque viewer identity establish an outcome. */
export function networkResultPresentation(match: ChessNetworkMatch, viewerPlayerId?: string) {
  if (match.status === 'aborted')
    return {
      kind: 'aborted',
      title: 'Партия остановлена',
      detail: 'Доступ или круг соперников изменился. Результат не засчитан.',
    } as const;
  if (match.status === 'active')
    return {
      kind: 'active',
      title: 'Партия продолжается',
      detail: match.activeColor === match.viewerColor ? 'Ваш ход' : 'Ход соперника',
    } as const;
  const detail = resultLabel(match.result, match.termination);
  if (match.result === '1/2-1/2') return { kind: 'draw', title: 'Ничья', detail } as const;
  if (match.result === '*')
    return {
      kind: 'finished',
      title: 'Партия завершена',
      detail: 'Итог партии пока недоступен.',
    } as const;
  if (!viewerPlayerId || match[match.viewerColor].playerId !== viewerPlayerId)
    return { kind: 'finished', title: 'Партия завершена', detail } as const;
  const won = (match.result === '1-0') === (match.viewerColor === 'white');
  return {
    kind: won ? 'win' : 'loss',
    title: won ? 'Вы победили' : 'Вы проиграли',
    detail,
  } as const;
}

export function isNewNetworkVictory(
  previous: ChessNetworkMatch | null,
  incoming: ChessNetworkMatch,
  viewerPlayerId?: string,
): boolean {
  return (
    previous?.id === incoming.id &&
    previous.status === 'active' &&
    incoming.version > previous.version &&
    incoming.sequence > previous.sequence &&
    networkResultPresentation(incoming, viewerPlayerId).kind === 'win'
  );
}

export function ChessNetworkLobby({
  user,
  onExit,
  onHome,
}: {
  user: PublicUser;
  onExit(): void;
  onHome(): void;
}) {
  const [access, setAccess] = useState<ChessNetworkAccess | null>(null);
  const [history, setHistory] = useState<ChessNetworkMatch[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [match, setMatch] = useState<ChessNetworkMatch | null>(null);
  const [invite, setInvite] = useState<ChessNetworkInvite | null>(null);
  const [lobby, setLobby] = useState<LobbySnapshot | null>(null);
  const [lobbyError, setLobbyError] = useState(false);
  const [lobbyRevision, setLobbyRevision] = useState(0);
  const [scope, setScope] = useState<ChessNetworkScope>('classroom');
  const [time, setTime] = useState(2);
  const [color, setColor] = useState<'white' | 'black' | 'random'>('random');
  const [code, setCode] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Square | null>(null);
  const [promotion, setPromotion] = useState<ChessMove[]>([]);
  const [clockTick, setClockTick] = useState(0);
  const [victoryEffect, setVictoryEffect] = useState<string | null>(null);
  const observedMatch = useRef<ChessNetworkMatch | null>(null);
  const celebrated = useRef(new Set<string>());
  const currentMatch = useRef(match);
  currentMatch.current = match;
  const commandPending = useRef(false);
  const receivedAt = useRef(performance.now());
  const mounted = useRef(true);
  const historyFailed = useRef(true);
  const historyGeneration = useRef(0);
  const historyPending = useRef(false);
  const bootstrapPending = useRef(true);
  const navigation = useRef(0);
  const activeMatch = useRef<string | null>(null);
  activeMatch.current = match?.id ?? null;
  const adopt = useCallback((incoming: ChessNetworkMatch) => {
    setMatch((current) => {
      if (
        current?.id === incoming.id &&
        (current.version > incoming.version ||
          current.sequence > incoming.sequence ||
          (current.version === incoming.version && current.serverNowMs > incoming.serverNowMs))
      )
        return current;
      receivedAt.current = performance.now();
      return incoming;
    });
  }, []);
  const refreshHistory = useCallback(
    async (cursor?: string) => {
      if (historyPending.current) return;
      historyPending.current = true;
      const generation = ++historyGeneration.current;
      const navigationAtStart = navigation.current;
      setHistoryBusy(true);
      try {
        const saved = await chessNetworkApi.history(cursor);
        if (!mounted.current || generation !== historyGeneration.current) return;
        historyFailed.current = !saved.ok;
        setHistoryError(!saved.ok);
        if (!saved.ok) {
          setConnected(false);
          setNotice('Не удалось загрузить приглашения и историю. Повторите загрузку.');
          return;
        }
        setHistory((current) =>
          Array.from(
            new Map(
              [...(cursor ? current : []), ...saved.data.matches].map((item) => [item.id, item]),
            ).values(),
          ),
        );
        setNextCursor(saved.data.nextCursor);
        if (bootstrapPending.current) {
          bootstrapPending.current = false;
          if (navigation.current === navigationAtStart && navigation.current === 0) {
            setInvite(saved.data.invites[0] ?? null);
            const active = saved.data.matches.find((item) => item.status === 'active');
            if (active) {
              adopt(active);
              setNotice('Партия восстановлена. Ходы и часы синхронизируются.');
            }
          }
        }
      } finally {
        if (generation === historyGeneration.current) {
          historyPending.current = false;
          if (mounted.current) setHistoryBusy(false);
        }
      }
    },
    [adopt],
  );
  useEffect(() => {
    mounted.current = true;
    const stop = startLivePoll(
      async (isCurrent) => {
        const result = await chessNetworkApi.access();
        if (!isCurrent()) return;
        if (result.ok) {
          setAccess(result.data);
          setScope((current) =>
            result.data.scopes.includes(current) ? current : (result.data.scopes[0] ?? 'classroom'),
          );
        } else setNotice(result.error.message);
        if (historyFailed.current) await refreshHistory();
        if (!isCurrent()) return;
        if (!activeMatch.current) setConnected(result.ok && !historyFailed.current);
        setLoading(false);
      },
      10_000,
      () => {
        setConnected(false);
        setLoading(false);
      },
    );
    return () => {
      stop();
      mounted.current = false;
      historyGeneration.current++;
      historyPending.current = false;
    };
  }, [refreshHistory]);
  const matchId = match?.id;
  const matchStatus = match?.status;
  const viewerPlayerId = access?.player.playerId;
  useEffect(() => {
    const previous = observedMatch.current;
    observedMatch.current = match;
    if (match?.status !== 'active') {
      setSelected(null);
      setPromotion([]);
    }
    if (
      match &&
      isNewNetworkVictory(previous, match, viewerPlayerId) &&
      !celebrated.current.has(match.id)
    ) {
      celebrated.current.add(match.id);
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches)
        setVictoryEffect(match.id);
    } else if (!match || networkResultPresentation(match, viewerPlayerId).kind !== 'win') {
      setVictoryEffect(null);
    }
  }, [match, viewerPlayerId]);
  useEffect(() => {
    if (!victoryEffect) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const cancelMotion = () => {
      if (reducedMotion.matches) setVictoryEffect(null);
    };
    reducedMotion.addEventListener('change', cancelMotion);
    const timer = window.setTimeout(() => setVictoryEffect(null), 900);
    return () => {
      window.clearTimeout(timer);
      reducedMotion.removeEventListener('change', cancelMotion);
    };
  }, [victoryEffect]);
  useEffect(() => {
    if (!matchId || matchStatus !== 'active') return;
    return startLivePoll(
      async (isCurrent) => {
        const result = await chessNetworkApi.match(matchId);
        if (!isCurrent()) return;
        setConnected(result.ok);
        if (result.ok) adopt(result.data.match);
      },
      800,
      () => setConnected(false),
    );
  }, [matchId, matchStatus, adopt]);
  const inviteCode = invite?.code;
  const inviteStatus = invite?.status;
  useEffect(() => {
    if (!inviteCode || inviteStatus !== 'open' || matchId) return;
    return startLivePoll(
      async (isCurrent) => {
        const result = await chessNetworkApi.invite(inviteCode);
        if (!isCurrent()) return;
        setConnected(result.ok);
        if (!result.ok) return;
        if (result.data.invite.matchId) {
          const started = await chessNetworkApi.match(result.data.invite.matchId);
          if (!isCurrent()) return;
          if (!started.ok) {
            setConnected(false);
            return;
          }
          adopt(started.data.match);
        }
        setInvite(result.data.invite);
      },
      1200,
      () => setConnected(false),
    );
  }, [inviteCode, inviteStatus, matchId, adopt]);
  useEffect(() => {
    if (matchStatus && matchStatus !== 'active') void refreshHistory();
  }, [matchId, matchStatus, refreshHistory]);
  useEffect(() => {
    if (matchStatus !== 'active') return;
    const timer = window.setInterval(() => setClockTick((value) => value + 1), 200);
    return () => window.clearInterval(timer);
  }, [matchStatus]);
  useEffect(() => {
    setLobby(null);
    setLobbyError(false);
    if (!access?.allowed || !access.scopes.includes(scope) || matchId) return;
    return startLivePoll(
      async (isCurrent) => {
        if (document.visibilityState === 'hidden') return;
        const result = await chessNetworkApi.lobby(scope);
        if (!isCurrent()) return;
        const valid =
          result.ok &&
          Array.isArray(result.data.players) &&
          Array.isArray(result.data.incoming) &&
          Array.isArray(result.data.outgoing);
        setLobby(valid && result.ok ? result.data : null);
        setLobbyError(!valid);
      },
      5000,
      () => {
        setLobby(null);
        setLobbyError(true);
      },
    );
  }, [scope, access?.allowed, access?.scopes?.join(','), matchId, user.id, lobbyRevision]);
  const parsed = useMemo(() => (match ? parseFen(match.currentFen) : null), [match?.currentFen]);
  const position = parsed?.ok ? parsed.value : null;
  const legal = useMemo(() => (position ? generateLegalMoves(position) : []), [position]);
  const canMove = Boolean(
    access?.allowed &&
    match &&
    position &&
    match.status === 'active' &&
    position.turn === match.viewerColor &&
    connected &&
    !busy &&
    promotion.length === 0,
  );

  async function command(
    operation: () => ReturnType<typeof chessNetworkApi.create>,
  ): Promise<void> {
    if (commandPending.current) return;
    navigation.current++;
    commandPending.current = true;
    setBusy(true);
    try {
      const result = await operation();
      if (!mounted.current) return;
      if (result.ok) {
        if (result.data.invite) setInvite(result.data.invite);
        if (result.data.match) {
          adopt(result.data.match);
          setSelected(null);
          setPromotion([]);
        }
        setConnected(true);
        setNotice(
          result.data.match
            ? 'Партия обновлена.'
            : result.data.invite?.status === 'open'
              ? 'Приглашение создано.'
              : 'Приглашение закрыто.',
        );
      } else {
        setNotice(result.error.message);
        if (matchId) {
          const current = await chessNetworkApi.match(matchId);
          if (mounted.current && current.ok) adopt(current.data.match);
        } else {
          // A lost accept reply may already have created a match. Refresh owned
          // history without forcing navigation away from the lobby.
          await refreshHistory();
        }
      }
    } finally {
      commandPending.current = false;
      if (mounted.current) {
        setBusy(false);
        setLobbyRevision((value) => value + 1);
      }
    }
  }
  function play(move: ChessMove): void {
    if (
      !match ||
      match.status !== 'active' ||
      currentMatch.current?.id !== match.id ||
      currentMatch.current.status !== 'active' ||
      busy ||
      !connected
    )
      return;
    setPromotion([]);
    void command(() => chessNetworkApi.action(match.id, match.version, 'move', moveToUci(move)));
  }
  function chooseMove(from: Square, to: Square): boolean {
    const candidates = legal.filter((move) => move.from === from && move.to === to);
    if (candidates.length > 1) {
      setPromotion(candidates);
      return true;
    }
    if (candidates[0]) {
      play(candidates[0]);
      return true;
    }
    return false;
  }
  function square(target: Square): void {
    if (!canMove || !position || !match) return;
    if (selected && chooseMove(selected, target)) return;
    setSelected(pieceAt(position, target)?.color === match.viewerColor ? target : null);
  }
  function control(action: ChessNetworkAction): void {
    if (
      match?.status === 'active' &&
      currentMatch.current?.id === match.id &&
      currentMatch.current.status === 'active' &&
      connected &&
      !busy
    )
      void command(() => chessNetworkApi.action(match.id, match.version, action));
  }
  function player(color: 'white' | 'black') {
    if (!match) return null;
    // Smooth display between authoritative snapshots; no client-authored timeout/result.
    const elapsed =
      match.status === 'active' ? Math.max(0, performance.now() - receivedAt.current) : 0;
    void clockTick;
    const remaining = Math.max(
      0,
      (color === 'white' ? match.whiteRemainingMs : match.blackRemainingMs) -
        (match.activeColor === color ? elapsed : 0),
    );
    return (
      <div
        className={`asa-live-player ${match.activeColor === color && match.status === 'active' ? 'active' : ''}`}
      >
        <span className={`asa-live-avatar ${color}`} aria-hidden="true">
          {color === 'white' ? '♔' : '♚'}
        </span>
        <span>
          <strong>
            {match[color].displayAlias}
            {color === match.viewerColor ? ' · Вы' : ''}
          </strong>
          <small>{color === 'white' ? 'Белые' : 'Чёрные'}</small>
        </span>
        <time aria-label={color === 'white' ? 'Время белых' : 'Время чёрных'}>
          {formatChessClock(remaining)}
        </time>
      </div>
    );
  }
  const heading = match ? 'Сетевая партия' : 'Онлайн-шахматы';
  const outcome = match ? networkResultPresentation(match, viewerPlayerId) : null;
  return (
    <main className="asa-online-shell asa-network-shell">
      {match ? (
        <ChessSectionHeader
          user={user}
          title={heading}
          status={{
            kind: loading ? 'saving' : connected && !historyError ? 'saved' : 'error',
            label: loading
              ? 'Подключаемся'
              : connected && !historyError
                ? 'Подключено'
                : 'Восстанавливаем связь',
          }}
          onExit={onExit}
          onHome={onHome}
        />
      ) : (
        <header className="asa-network-setup-heading">
          <button type="button" onClick={onHome}>
            ← Шахматы
          </button>
          <h1>Онлайн-шахматы</h1>
        </header>
      )}
      {historyError && (
        <section className="asa-online-card">
          <p role="alert">Приглашения и история не загружены.</p>
          <button type="button" disabled={historyBusy} onClick={() => void refreshHistory()}>
            Повторить загрузку
          </button>
        </section>
      )}
      {match && position ? (
        <div className="asa-online-game-layout" data-match-status={match.status}>
          <section className="asa-online-board-column" aria-label="Доска сетевой партии">
            {player(match.viewerColor === 'white' ? 'black' : 'white')}
            <ChessBoard
              position={position}
              orientation={match.viewerColor}
              selectedSquare={match.status === 'active' ? selected : null}
              legalMoves={
                match.status === 'active' && selected
                  ? legal.filter((move) => move.from === selected)
                  : []
              }
              lastMoveUci={match.moves.at(-1)?.uci}
              disabled={!canMove}
              onSquare={square}
              onMove={(from, to) => {
                if (canMove) chooseMove(from, to);
              }}
            />
            {player(match.viewerColor)}
            {match.status === 'active' && promotion.length > 0 && (
              <section
                className="asa-network-promotion"
                role="dialog"
                aria-label="Выберите фигуру для превращения"
              >
                <strong>Превращение пешки</strong>
                {promotion.map((move) => (
                  <button type="button" key={move.promotion} onClick={() => play(move)}>
                    {PROMOTIONS[move.promotion as keyof typeof PROMOTIONS]}
                  </button>
                ))}
                <button type="button" onClick={() => setPromotion([])}>
                  Отмена
                </button>
              </section>
            )}
          </section>
          <aside className="asa-online-game-panel">
            <section
              className="asa-online-result asa-network-result"
              aria-live="polite"
              aria-atomic="true"
              data-outcome={outcome?.kind}
              data-victory-effect={
                outcome?.kind === 'win' && victoryEffect === match.id ? 'active' : undefined
              }
            >
              <strong>{outcome?.title}</strong>
              <span>{outcome?.detail}</span>
              {match.status === 'finished' && match.result !== '*' && (
                <span>Результат сохранён.</span>
              )}
            </section>
            {match.drawOfferedBy && match.status === 'active' && (
              <section className="asa-online-draw-offer">
                {match.drawOfferedBy === match[match.viewerColor].playerId ? (
                  'Вы предложили ничью.'
                ) : (
                  <>
                    <strong>Соперник предлагает ничью</strong>
                    <div>
                      <button
                        type="button"
                        disabled={busy || !connected}
                        onClick={() => control('draw-accept')}
                      >
                        Принять ничью
                      </button>
                      <button
                        type="button"
                        disabled={busy || !connected}
                        onClick={() => control('draw-decline')}
                      >
                        Отклонить ничью
                      </button>
                    </div>
                  </>
                )}
              </section>
            )}
            {match.moves.length ? (
              <ol className="asa-online-moves" aria-label="Ходы сетевой партии">
                {Array.from({ length: Math.ceil(match.moves.length / 2) }, (_, index) => (
                  <li key={index}>
                    <span>{index + 1}.</span>
                    <strong>{match.moves[index * 2]?.san}</strong>
                    <strong>{match.moves[index * 2 + 1]?.san}</strong>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="asa-online-empty">Белые делают первый ход.</div>
            )}
            <div className="asa-online-controls">
              <button
                type="button"
                disabled={
                  busy || match.status !== 'active' || !connected || Boolean(match.drawOfferedBy)
                }
                onClick={() => control('draw-offer')}
              >
                Предложить ничью
              </button>
              <button
                type="button"
                className="danger"
                disabled={busy || match.status !== 'active' || !connected}
                onClick={() => {
                  navigation.current++;
                  if (window.confirm('Сдаться в этой партии?')) control('resign');
                }}
              >
                Сдаться
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setMatch(null);
                  setInvite(null);
                  setSelected(null);
                  setPromotion([]);
                  void refreshHistory();
                }}
              >
                К приглашениям
              </button>
            </div>
            <p className="asa-network-notice" role="status">
              {connected
                ? notice
                : 'Нет связи с сервером. Подключение восстановится автоматически.'}
            </p>
          </aside>
        </div>
      ) : (
        <div className="asa-network-lobby">
          <section
            className="asa-online-card asa-network-options"
            aria-label="Настройки сетевой партии"
          >
            {loading ? (
              <p role="status">Проверяем доступ…</p>
            ) : !access?.allowed ? (
              <p role="status">
                Сетевая игра сейчас недоступна по настройкам учителя или состоянию входа.
              </p>
            ) : (
              <>
                {access.scopes.length > 1 ? (
                  <label>
                    Круг соперников
                    <select
                      aria-label="Круг соперников для партии"
                      value={scope}
                      disabled={busy || invite?.status === 'open'}
                      onChange={(event) => setScope(event.target.value as ChessNetworkScope)}
                    >
                      {access.scopes.map((value) => (
                        <option key={value} value={value}>
                          {SCOPE_LABEL[value]}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <p className="asa-network-scope-note">
                    Соперники: {SCOPE_LABEL[access.scopes[0] ?? 'platform']}
                  </p>
                )}
                <div className="asa-network-match-settings">
                  <label>
                    Контроль времени
                    <select
                      aria-label="Контроль времени сетевой партии"
                      value={time}
                      disabled={busy}
                      onChange={(event) => setTime(Number(event.target.value))}
                    >
                      {TIMES.map((value, index) => (
                        <option key={value.label} value={index}>
                          {value.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Цвет
                    <select
                      aria-label="Ваш цвет"
                      value={color}
                      disabled={busy}
                      onChange={(event) => setColor(event.target.value as typeof color)}
                    >
                      <option value="random">Случайный</option>
                      <option value="white">Белые</option>
                      <option value="black">Чёрные</option>
                    </select>
                  </label>
                </div>
              </>
            )}
          </section>
          {access?.allowed && (
            <section className="asa-online-card asa-network-people" aria-label="Игроки в сети">
              <h2>Игроки в сети · {SCOPE_LABEL[scope]}</h2>
              <p>
                Ваше имя в игре: {access.player.displayAlias}. Видны только доступные соперники в
                шахматном лобби.
              </p>
              {lobbyError ? (
                <div role="status">
                  <p>Не удалось обновить список игроков.</p>
                  <button type="button" onClick={() => setLobbyRevision((value) => value + 1)}>
                    Обновить игроков
                  </button>
                </div>
              ) : !lobby ? (
                <p role="status">Ищем доступных игроков…</p>
              ) : (
                <>
                  {lobby.available === false && (
                    <p>У вас уже идёт партия. Вернитесь к ней через историю.</p>
                  )}
                  {lobby.incoming.length > 0 && (
                    <section className="asa-network-incoming" aria-label="Входящие вызовы">
                      <h3>Вас приглашают</h3>
                      {lobby.incoming.map((item) => (
                        <article key={item.invite.id} data-invite-id={item.invite.id}>
                          <LobbyAvatar player={item.from} />
                          <strong>{item.from.displayAlias}</strong>
                          <small>
                            {SCOPE_LABEL[item.invite.scope]} · {item.invite.initialMs / 60000}+
                            {item.invite.incrementMs / 1000}
                          </small>
                          <div>
                            <button
                              type="button"
                              disabled={busy || lobby.available === false}
                              onClick={() =>
                                void command(() => chessNetworkApi.accept(item.invite.code))
                              }
                            >
                              Принять вызов
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void command(() =>
                                  chessNetworkApi.decline(item.invite.id, item.invite.version),
                                )
                              }
                            >
                              Отклонить
                            </button>
                          </div>
                        </article>
                      ))}
                    </section>
                  )}
                  {lobby.outgoing.length > 0 && (
                    <section className="asa-network-incoming" aria-label="Отправленные вызовы">
                      <h3>Ожидаем ответа</h3>
                      {lobby.outgoing.map((item) => (
                        <article key={item.invite.id}>
                          <LobbyAvatar player={item.to} />
                          <strong>{item.to.displayAlias}</strong>
                          <small>{SCOPE_LABEL[item.invite.scope]}</small>
                          <div>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void command(() =>
                                  chessNetworkApi.cancel(item.invite.id, item.invite.version),
                                )
                              }
                            >
                              Отменить вызов
                            </button>
                          </div>
                        </article>
                      ))}
                    </section>
                  )}
                  {lobby.available === false ? null : lobby.players.length ? (
                    <ul className="asa-network-player-list">
                      {lobby.players.map((peer) => {
                        const pending = lobby.outgoing.some(
                          (item) => item.to.playerId === peer.playerId,
                        );
                        return (
                          <li key={peer.playerId} data-player-id={peer.playerId}>
                            <LobbyAvatar player={peer} />
                            <span>
                              <strong>{peer.displayAlias}</strong>
                              <small>В шахматном лобби</small>
                            </span>
                            <button
                              type="button"
                              disabled={busy || pending || lobby.available === false}
                              onClick={() =>
                                void command(() =>
                                  chessNetworkApi.challenge(peer.playerId, {
                                    scope,
                                    colorPreference: color,
                                    initialMs: TIMES[time]!.initialMs,
                                    incrementMs: TIMES[time]!.incrementMs,
                                  }),
                                )
                              }
                            >
                              {pending ? 'Вызов отправлен' : 'Пригласить играть'}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p>
                      Пока нет доступных соперников. Другому игроку нужно открыть сетевые шахматы.
                    </p>
                  )}
                  {lobby.available !== false && lobby.players.length >= lobby.limit && (
                    <p>Показаны первые {lobby.limit} доступных игроков.</p>
                  )}
                </>
              )}
            </section>
          )}
          {access?.allowed && !loading && lobby?.available !== false && (
            <section className="asa-online-card">
              <h2>Приглашение по коду</h2>
              <p>Отправьте код сопернику или введите его код.</p>
              {loading ? (
                <p role="status">Проверяем доступ…</p>
              ) : !access?.allowed ? (
                <p role="status">
                  Сетевая игра сейчас недоступна по настройкам учителя или состоянию входа.
                </p>
              ) : (
                <>
                  <button
                    type="button"
                    className="primary-button"
                    disabled={
                      busy ||
                      invite?.status === 'open' ||
                      !access.scopes.includes(scope) ||
                      lobby?.available === false
                    }
                    onClick={() =>
                      void command(() =>
                        chessNetworkApi.create({
                          scope,
                          colorPreference: color,
                          initialMs: TIMES[time]!.initialMs,
                          incrementMs: TIMES[time]!.incrementMs,
                        }),
                      )
                    }
                  >
                    Создать приглашение
                  </button>
                  <label>
                    Код приглашения
                    <input
                      aria-label="Код приглашения"
                      autoComplete="off"
                      maxLength={24}
                      value={code}
                      onChange={(event) =>
                        setCode(event.target.value.toUpperCase().replace(/\s/g, ''))
                      }
                    />
                  </label>
                  <button
                    type="button"
                    disabled={
                      busy ||
                      code.length !== 24 ||
                      invite?.status === 'open' ||
                      lobby?.available === false
                    }
                    onClick={() => void command(() => chessNetworkApi.accept(code))}
                  >
                    Принять приглашение
                  </button>
                </>
              )}
              <p className="asa-network-notice" role="status">
                {notice}
              </p>
            </section>
          )}
          {invite && !lobby?.outgoing.some((item) => item.invite.id === invite.id) && (
            <section className="asa-online-card" aria-live="polite">
              <h2>{invite?.status === 'open' ? 'Ожидаем соперника' : 'Приглашение'}</h2>
              {invite ? (
                <>
                  <output className="asa-network-code" aria-label="Ваш код приглашения">
                    {invite.code}
                  </output>
                  <p>
                    {SCOPE_LABEL[invite.scope]} · {invite.initialMs / 60000}+
                    {invite.incrementMs / 1000}
                  </p>
                  {invite.status === 'open' ? (
                    <>
                      <p>Отправьте код другу. Он действует 30 минут.</p>
                      <button
                        type="button"
                        onClick={() =>
                          void navigator.clipboard
                            ?.writeText(invite.code)
                            .then(() => setNotice('Код скопирован.'))
                            .catch(() => setNotice('Выделите и скопируйте код вручную.'))
                        }
                      >
                        Скопировать приглашение
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void command(() => chessNetworkApi.cancel(invite.id, invite.version))
                        }
                      >
                        Отменить приглашение
                      </button>
                    </>
                  ) : (
                    <p>
                      {invite.status === 'expired'
                        ? 'Срок действия приглашения истёк.'
                        : invite.status === 'cancelled'
                          ? 'Приглашение отменено.'
                          : 'Приглашение принято.'}
                    </p>
                  )}
                </>
              ) : loading || historyBusy || historyError ? (
                <p>
                  {historyError ? 'Приглашения временно недоступны.' : 'Загружаем приглашения…'}
                </p>
              ) : (
                <p>
                  Создайте код для друга или примите его приглашение. Личные данные и список
                  учеников другим игрокам не показываются.
                </p>
              )}
            </section>
          )}
          <section className="asa-online-card asa-network-history">
            <h2>Мои сетевые партии</h2>
            {!history.length ? (
              <p>
                {loading || historyBusy
                  ? 'Загружаем партии…'
                  : historyError
                    ? 'Список временно недоступен.'
                    : 'Здесь появятся ваши партии.'}
              </p>
            ) : (
              history.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  data-match-id={item.id}
                  disabled={busy}
                  onClick={() =>
                    void command(async () => {
                      const result = await chessNetworkApi.match(item.id);
                      return result.ok
                        ? { ...result, data: { match: result.data.match, replayed: false } }
                        : result;
                    })
                  }
                >
                  <strong>
                    {item.white.displayAlias} — {item.black.displayAlias}
                  </strong>
                  <span>
                    {item.status === 'aborted'
                      ? 'Остановлена без результата'
                      : item.status === 'active'
                        ? 'Продолжить партию'
                        : resultLabel(item.result, item.termination)}
                  </span>
                </button>
              ))
            )}
            {nextCursor && (
              <button
                type="button"
                disabled={historyBusy || busy}
                onClick={() => void refreshHistory(nextCursor)}
              >
                Загрузить ещё партии
              </button>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
