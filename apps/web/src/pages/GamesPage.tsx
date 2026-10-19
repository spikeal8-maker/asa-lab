import { useEffect, useRef, useState } from 'react';
import { api, type ModuleSummary } from '../api';
import { GAMES, type GameKey } from '../games/game-catalog';
import { openGame } from '../games/open-game';
import { gameAccessApi, gameAccessMessage, type GameAdmission } from '../games/game-access-api';
import './games.css';

export function GamesPage({
  onOpenGame,
}: {
  onOpenGame: (id: string, game: GameKey) => void;
}): JSX.Element {
  const [modules, setModules] = useState<ModuleSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [admissions, setAdmissions] = useState<Partial<Record<GameKey, GameAdmission>>>({});
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
    setAdmissions({});
    void Promise.all([
      api.listModules(),
      gameAccessApi.read('chess'),
      gameAccessApi.read('checkers'),
    ]).then(([result, chess, checkers]) => {
      if (!active) return;
      if (result.ok && chess.ok && checkers.ok) {
        setModules(result.data.items);
        setAdmissions({ chess: chess.data, checkers: checkers.data });
      } else {
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
        <p>Шахматы и шашки для самостоятельной тренировки.</p>
        <div className="games-heading-actions">
          <a href="#/learning">Моё обучение</a>
          {modules !== null && modules.length > 0 ? (
            <button
              type="button"
              className="btn-secondary"
              disabled={opening !== null}
              onClick={() => setLoadAttempt((attempt) => attempt + 1)}
            >
              Проверить доступ
            </button>
          ) : null}
        </div>
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
          const admission = admissions[game.key];
          const enabled =
            admission?.granted === true &&
            modules?.some(
              (module) =>
                module.moduleKey === game.key &&
                module.availability === 'active' &&
                module.creatable,
            );
          const label =
            opening === game.key
              ? 'Открываем…'
              : modules === null
                ? 'Загрузка…'
                : enabled
                  ? 'Играть'
                  : 'Сейчас недоступно';
          return (
            <button
              key={game.key}
              type="button"
              className={`game-card game-card--${game.key}`}
              disabled={!enabled || opening !== null}
              onClick={() => void play(game.key)}
              aria-label={`${label}: ${game.title}`}
              aria-describedby={
                admission && !admission.granted ? `game-${game.key}-admission-reason` : undefined
              }
              aria-busy={opening === game.key}
            >
              <span className="game-card-art" aria-hidden="true" />
              <span className="game-card-body">
                <span className="game-card-title">{game.title}</span>
                <span className="game-card-description">{game.description}</span>
                {admission && !admission.granted ? (
                  <span className="game-card-reason" id={`game-${game.key}-admission-reason`}>
                    {gameAccessMessage(admission)}
                  </span>
                ) : null}
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
