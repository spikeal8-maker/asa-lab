import { useRef, useState, type FormEvent } from 'react';
import { api, type ClassroomPreview } from '../api';
import { AsaLabWordmark } from '../brand/AsaLabBrand';

/**
 * Class-code entry: the code first, then the class, then how to identify.
 *
 * Resolving a code shows which class it is and creates nothing. Only once the
 * class is on screen does joining become a meaningful confirmation, and only
 * then is the person asked whether they have an account or a login name from
 * their teacher.
 */
export function JoinClassPage({
  onAccountPath,
  onHandlePath,
  onBack,
}: {
  onAccountPath: (preview: ClassroomPreview) => void;
  onHandlePath: (preview: ClassroomPreview) => void;
  onBack: () => void;
}): JSX.Element {
  const [code, setCode] = useState('');
  const [preview, setPreview] = useState<ClassroomPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    if (!code.trim()) {
      setError('Введите код класса.');
      codeRef.current?.focus();
      return;
    }
    setBusy(true);
    const result = await api.resolveClassCode(code.trim());
    setBusy(false);
    if (result.ok) {
      setPreview(result.data.classroom);
      return;
    }
    setError(
      result.status === 0
        ? 'Сервер недоступен. Попробуйте ещё раз.'
        : result.status === 429
          ? 'Слишком много попыток — подождите минуту.'
          : 'Класс с таким кодом не найден. Проверьте код у педагога.',
    );
    codeRef.current?.focus();
  }

  if (preview !== null) {
    return (
      <div className="page-center">
        <main className="login-card">
          <button
            type="button"
            className="btn-ghost entry-back"
            onClick={() => {
              setPreview(null);
              setError(null);
            }}
          >
            ← Другой код
          </button>
          <h1 className="brand-heading">
            <AsaLabWordmark />
          </h1>
          <p className="subtitle">Класс найден</p>

          <dl className="class-preview" data-testid="class-preview">
            <dt>Класс</dt>
            <dd data-testid="class-preview-title">{preview.title}</dd>
            <dt>Педагог</dt>
            <dd>{preview.educatorDisplayName}</dd>
          </dl>

          <p className="field-hint">Как вы будете входить?</p>
          <div className="entry-routes">
            <button
              type="button"
              className="btn-primary entry-action"
              data-testid="join-with-account"
              onClick={() => onAccountPath(preview)}
            >
              У меня есть аккаунт ASA Lab
            </button>
            <span className="entry-action-hint">
              Войти в аккаунт и присоединиться к этому классу.
            </span>
            <button
              type="button"
              className="btn-secondary entry-action"
              data-testid="join-with-handle"
              onClick={() => onHandlePath(preview)}
            >
              Педагог выдал мне имя для входа
            </button>
            <span className="entry-action-hint">Войти без email по назначенному имени.</span>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="page-center">
      <main className="login-card" aria-busy={busy}>
        <button type="button" className="btn-ghost entry-back" onClick={onBack}>
          ← Назад
        </button>
        <h1 className="brand-heading">
          <AsaLabWordmark />
        </h1>
        <p className="subtitle">Вход по коду класса</p>
        <form onSubmit={(event) => void submit(event)} noValidate>
          <label htmlFor="class-code">Код класса</label>
          <input
            id="class-code"
            data-testid="class-code"
            ref={codeRef}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            value={code}
            disabled={busy}
            onChange={(event) => setCode(event.target.value)}
            aria-describedby="class-code-hint"
          />
          <p id="class-code-hint" className="field-hint">
            Код выдаёт педагог. Пробелы, дефисы и регистр не важны.
          </p>
          {error ? (
            <p className="form-error" role="alert" data-testid="class-code-error">
              {error}
            </p>
          ) : null}
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? 'Ищем класс…' : 'Продолжить'}
          </button>
        </form>
      </main>
    </div>
  );
}
