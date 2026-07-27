/**
 * Public entry. Three doors, nothing else: the visitor states what they want
 * to do before any form asks who they are.
 */
export type PublicIntent = 'create-account' | 'sign-in' | 'join-class';

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
            onClick={() => onChoose('create-account')}
          >
            Создать аккаунт
          </button>
          <button
            type="button"
            className="btn-secondary entry-action"
            onClick={() => onChoose('sign-in')}
          >
            Войти
          </button>
          <button
            type="button"
            className="btn-secondary entry-action"
            onClick={() => onChoose('join-class')}
          >
            Присоединиться к классу
          </button>
        </div>
      </main>
    </div>
  );
}
