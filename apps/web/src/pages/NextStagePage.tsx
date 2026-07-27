/**
 * Honest placeholder for journeys that the platform does not serve yet.
 * It always offers a route that works today instead of a dead end.
 */
export function NextStagePage({
  title,
  explanation,
  onSignIn,
  onBack,
}: {
  title: string;
  explanation: string;
  onSignIn: () => void;
  onBack: () => void;
}): JSX.Element {
  return (
    <div className="page-center">
      <main className="entry-card">
        <button type="button" className="btn-ghost entry-back" onClick={onBack}>
          ← Назад
        </button>
        <h1 className="brand entry-brand">ASA Lab</h1>
        <h2 className="next-stage-title">{title}</h2>
        <p className="next-stage-text">{explanation}</p>
        <div className="entry-actions">
          <button type="button" className="btn-secondary entry-action" onClick={onSignIn}>
            Войти
          </button>
          <button type="button" className="btn-ghost entry-action" onClick={onBack}>
            К началу
          </button>
        </div>
      </main>
    </div>
  );
}
