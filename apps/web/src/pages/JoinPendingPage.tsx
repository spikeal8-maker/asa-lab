import { useEffect, useState } from 'react';
import { api } from '../api';
import { AsaLabWordmark } from '../brand/AsaLabBrand';
import type { JoinIntent } from '../join-intent';

/**
 * What an account sees after signing in with a class waiting.
 *
 * The class is confirmed by the server, not by what the browser remembered:
 * the stored token is sent back and re-checked, so a rotated code or an
 * expired intent is reported honestly instead of showing a class that is no
 * longer reachable. Joining itself is not built yet, and the screen says so
 * rather than pretending a membership exists.
 */
export function JoinPendingPage({
  intent,
  onContinue,
}: {
  intent: JoinIntent;
  onContinue: () => void;
}): JSX.Element {
  const [state, setState] = useState<'checking' | 'confirmed' | 'stale'>('checking');
  const [title, setTitle] = useState(intent.title);
  const [educator, setEducator] = useState(intent.educatorDisplayName);

  useEffect(() => {
    let cancelled = false;
    void api.describeJoinIntent(intent.joinIntentToken).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setTitle(result.data.classroom.title);
        setEducator(result.data.classroom.educatorDisplayName);
        setState('confirmed');
        return;
      }
      setState('stale');
    });
    return () => {
      cancelled = true;
    };
  }, [intent.joinIntentToken]);

  return (
    <div className="page-center">
      <main className="login-card" data-testid="join-pending">
        <h1 className="brand-heading">
          <AsaLabWordmark />
        </h1>
        <p className="subtitle">Вы вошли в аккаунт</p>

        {state === 'stale' ? (
          <p className="field-hint" data-testid="join-pending-stale">
            Ссылка на класс больше не действует — код мог быть заменён педагогом. Введите код класса
            заново, когда получите новый.
          </p>
        ) : (
          <>
            <dl className="class-preview" data-testid="join-pending-class">
              <dt>Класс</dt>
              <dd data-testid="join-pending-title">{title}</dd>
              <dt>Педагог</dt>
              <dd>{educator}</dd>
            </dl>
            <p className="field-hint">
              {state === 'checking'
                ? 'Проверяем класс…'
                : 'Присоединение аккаунта к классу появится на следующем этапе — сейчас участие в классе оформляет педагог. Класс мы запомнили и не потеряли.'}
            </p>
          </>
        )}

        <button
          type="button"
          className="btn-primary"
          data-testid="join-pending-continue"
          onClick={onContinue}
        >
          Перейти к моим проектам
        </button>
      </main>
    </div>
  );
}
