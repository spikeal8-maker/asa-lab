/**
 * Contextual router. School and personal use are different journeys, so the
 * path is chosen explicitly instead of being guessed from a single form.
 */
export type EntryContext =
  'school-educator' | 'school-class-code' | 'school-registered-student' | 'personal-account';

const SCHOOL: { key: EntryContext; title: string; hint: string }[] = [
  { key: 'school-educator', title: 'Педагог', hint: 'Классы, ученики и проверка работ.' },
  {
    key: 'school-class-code',
    title: 'Ученик с кодом класса',
    hint: 'Код выдаёт педагог. Email и пароль не нужны.',
  },
  {
    key: 'school-registered-student',
    title: 'Зарегистрированный ученик',
    hint: 'У ученика уже есть собственный аккаунт.',
  },
];

const PERSONAL: { key: EntryContext; title: string; hint: string }[] = [
  {
    key: 'personal-account',
    title: 'Личный аккаунт',
    hint: 'Свои проекты без школы и без класса.',
  },
];

export function ContextChooserPage({
  intent,
  onChoose,
  onBack,
}: {
  intent: 'create-account' | 'sign-in';
  onChoose: (context: EntryContext) => void;
  onBack: () => void;
}): JSX.Element {
  return (
    <div className="page-center">
      <main className="entry-card entry-card-wide">
        <button type="button" className="btn-ghost entry-back" onClick={onBack}>
          ← Назад
        </button>
        <h1 className="brand entry-brand">ASA Lab</h1>
        <p className="subtitle">
          {intent === 'create-account' ? 'Кто будет пользоваться аккаунтом?' : 'Как вы входите?'}
        </p>

        <section className="entry-group" aria-labelledby="entry-group-school">
          <h2 id="entry-group-school">В школе</h2>
          <div className="entry-grid">
            {SCHOOL.map((option) => (
              <button
                key={option.key}
                type="button"
                className="entry-option"
                data-testid={`entry-${option.key}`}
                onClick={() => onChoose(option.key)}
              >
                <span className="entry-option-title">{option.title}</span>
                <span className="entry-option-hint">{option.hint}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="entry-group" aria-labelledby="entry-group-personal">
          <h2 id="entry-group-personal">Самостоятельно</h2>
          <div className="entry-grid">
            {PERSONAL.map((option) => (
              <button
                key={option.key}
                type="button"
                className="entry-option"
                data-testid={`entry-${option.key}`}
                onClick={() => onChoose(option.key)}
              >
                <span className="entry-option-title">{option.title}</span>
                <span className="entry-option-hint">{option.hint}</span>
              </button>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
