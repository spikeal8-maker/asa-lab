import { AsaLabWordmark } from '../brand/AsaLabBrand';

export type PublicIntent = 'sign-in' | 'sign-up' | 'class-code';

export function PublicEntryPage({
  onChoose,
}: {
  onChoose: (intent: PublicIntent) => void;
}): JSX.Element {
  return (
    <div className="page-center public-entry">
      <main className="entry-card">
        <h1 className="brand-heading">
          <AsaLabWordmark />
        </h1>
        <p className="entry-kicker">Личное пространство для идей, схем и исследований</p>
        <h2>Создавайте. Проверяйте. Делитесь.</h2>
        <p className="subtitle">
          Одна среда для собственных проектов, занятий и совместной работы.
        </p>

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
            Получите личное пространство для своих проектов.
          </span>

          <button
            type="button"
            className="btn-secondary entry-action"
            data-testid="entry-class-code"
            onClick={() => onChoose('class-code')}
          >
            Войти по коду класса
          </button>
          <span className="entry-action-hint">Для ученика, которому педагог выдал код.</span>
        </div>
      </main>
    </div>
  );
}
