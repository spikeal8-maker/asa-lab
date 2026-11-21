import { useEffect, useState, type ReactNode } from 'react';
import { startLivePoll } from '../chess/live-poll';
import { gameAccessApi, gameAccessMessage } from './game-access-api';
import type { GameKey } from './game-catalog';

/** Revocation unmounts the entire game, including local workers and save effects. */
export function GameAccessBoundary({
  game,
  guarded,
  actor,
  onBack,
  children,
}: {
  game: GameKey;
  guarded: boolean;
  actor: string;
  onBack(): void;
  children: ReactNode;
}) {
  const [allowed, setAllowed] = useState<boolean | null>(guarded ? null : true);
  const [notice, setNotice] = useState('Проверяем доступ к играм…');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!guarded) {
      setAllowed(true);
      return;
    }
    const stop = startLivePoll(
      async (isCurrent) => {
        const result = await gameAccessApi.read(game);
        if (!isCurrent()) return;
        setAllowed(result.ok && result.data.granted);
        setNotice(
          result.ok
            ? gameAccessMessage(result.data)
            : 'Не удалось проверить доступ. Повторите проверку или войдите в класс заново.',
        );
      },
      2000,
      () => {
        setAllowed(false);
        setNotice('Не удалось проверить доступ к играм.');
      },
    );
    const focus = () => setAttempt((value) => value + 1);
    window.addEventListener('focus', focus);
    return () => {
      stop();
      window.removeEventListener('focus', focus);
    };
  }, [game, guarded, actor, attempt]);
  if (!guarded || allowed === true) return <>{children}</>;
  return (
    <main className="page-center">
      <section className="login-card" role="status">
        <h1>{allowed === null ? 'Проверяем доступ к играм' : 'Игры недоступны'}</h1>
        <p>{notice}</p>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => setAttempt((value) => value + 1)}
        >
          Проверить доступ
        </button>
        <button type="button" className="btn-secondary" onClick={onBack}>
          К играм
        </button>
      </section>
    </main>
  );
}
