/**
 * Public entry: three intentions, in the words a visitor already uses.
 *
 * Nothing here asks who someone is — an account is one thing, and what it may
 * do is decided by the server after sign-in.
 */
export type PublicIntent = 'sign-in' | 'sign-up' | 'class-code';

export function PublicEntryPage({
  onChoose,
}: {
  onChoose: (intent: PublicIntent) => void;
}): JSX.Element {
  return (
    <div className="page-center">
      <main className="entry-card">
        <h1 className="brand entry-brand">ASA Lab</h1>
        <p className="subtitle">Творческая среда для школы и для себя</p>

        <div className="entry-actions">
          <button
            type="button"
            className="btn-primary entry-action"
            data-testid="entry-sign-in"
            onClick={() => onChoose('sign-in')}
          >
            Войти
          </button>
          <span className="entry-action-hint">Для всех, у кого уже есть аккаунт ASA Lab.</span>

          <button
            type="button"
            className="btn-secondary entry-action"
            data-testid="entry-sign-up"
            onClick={() => onChoose('sign-up')}
          >
            Создать аккаунт
          </button>
          <span className="entry-action-hint">
            Для личных проектов. Педагогические возможности включаются после регистрации.
          </span>

          <button
            type="button"
            className="btn-secondary entry-action"
            data-testid="entry-class-code"
            onClick={() => onChoose('class-code')}
          >
            Войти по коду класса
          </button>
          <span className="entry-action-hint">
            Для ученика, которому педагог выдал код класса или имя для входа.
          </span>
        </div>
      </main>
    </div>
  );
}
