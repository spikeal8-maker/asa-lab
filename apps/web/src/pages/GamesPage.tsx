import { useEffect, useRef, useState } from 'react';
import { api, type ModuleSummary } from '../api';
import { GAMES, type GameKey } from '../games/game-catalog';
import { openGame } from '../games/open-game';
import './games.css';

export function GamesPage({
  onOpenGame,
}: {
  onOpenGame: (id: string, game: GameKey) => void;
}): JSX.Element {
  const [modules, setModules] = useState<ModuleSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<GameKey | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const busy = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setModules(null);
    setError(null);
    void api.listModules().then((result) => {
      if (!active) return;
      if (result.ok) setModules(result.data.items);
      else {
        setModules([]);
        setError('Не удалось загрузить игры. Попробуйте ещё раз.');
      }
    });
    return () => {
      active = false;
    };
  }, [loadAttempt]);

  async function play(game: GameKey): Promise<void> {
    if (busy.current) return;
    busy.current = true;
    setOpening(game);
    setError(null);
    try {
      const save = await openGame(game);
      if (mounted.current) onOpenGame(save.id, game);
    } catch (failure) {
      if (mounted.current)
        setError(
          failure instanceof Error ? failure.message : 'Игра не открылась. Попробуйте ещё раз.',
        );
    } finally {
      busy.current = false;
      if (mounted.current) setOpening(null);
    }
  }

  return (
    <main className="portal-content games-page" id="main-content" tabIndex={-1}>
      <header className="games-heading">
        <h1>Игры</h1>
        <p>Выберите игру — и сделайте первый ход.</p>
      </header>
      {error ? (
        <p className="games-error" role="alert">
          {error}
          {modules?.length === 0 ? (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setLoadAttempt((attempt) => attempt + 1)}
            >
              Повторить
            </button>
          ) : null}
        </p>
      ) : null}
      <div className="games-grid">
        {GAMES.map((game) => {
          const enabled = modules?.some(
            (module) =>
              module.moduleKey === game.key && module.availability === 'active' && module.creatable,
          );
          const label =
            opening === game.key
              ? 'Открываем…'
              : modules === null
                ? 'Загрузка…'
                : enabled
                  ? 'Играть'
                  : 'Пока недоступно';
          return (
            <button
              key={game.key}
              type="button"
              className={`game-card game-card--${game.key}`}
              disabled={!enabled || opening !== null}
              onClick={() => void play(game.key)}
              aria-label={`${label}: ${game.title}`}
              aria-busy={opening === game.key}
            >
              <span className="game-card-art" aria-hidden="true" />
              <span className="game-card-body">
                <span className="game-card-title">{game.title}</span>
                <span className="game-card-description">{game.description}</span>
                <span className="game-card-action">
                  {label}
                  <span aria-hidden="true">→</span>
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </main>
  );
}
