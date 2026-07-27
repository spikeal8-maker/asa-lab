import type { JoinIntent } from '../join-intent';

/**
 * What an account sees after signing in with a class waiting.
 *
 * The intent survived the sign-in, so the class is named here instead of being
 * silently dropped — and the screen says plainly that joining itself is not
 * built yet rather than pretending the membership exists.
 */
export function JoinPendingPage({
  intent,
  onContinue,
}: {
  intent: JoinIntent;
  onContinue: () => void;
}): JSX.Element {
  return (
    <div className="page-center">
      <main className="login-card" data-testid="join-pending">
        <h1 className="brand">ASA Lab</h1>
        <p className="subtitle">Вы вошли в аккаунт</p>

        <dl className="class-preview" data-testid="join-pending-class">
          <dt>Класс</dt>
          <dd data-testid="join-pending-title">{intent.title}</dd>
          <dt>Педагог</dt>
          <dd>{intent.educatorDisplayName}</dd>
        </dl>

        <p className="field-hint">
          Присоединение аккаунта к классу появится на следующем этапе — сейчас участие в классе
          оформляет педагог. Класс мы запомнили и не потеряли.
        </p>

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
