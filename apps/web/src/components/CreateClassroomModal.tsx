import {
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { api, type Classroom } from '../api';
import { newClientId } from '../client-id';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function CreateClassroomModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (classroom: Classroom, created: boolean) => void;
}): JSX.Element {
  const [title, setTitle] = useState('');
  const [ageBand, setAgeBand] = useState<Classroom['ageBand']>('mixed');
  const [topicKeys, setTopicKeys] = useState<string[]>([]);
  const [safeModeDefault, setSafeModeDefault] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const errorId = useId();
  // One idempotency key per modal lifetime: retrying the same intent cannot
  // create a duplicate classroom.
  const idempotencyKey = useMemo(() => newClientId(), []);

  useLayoutEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusInput = (): void => inputRef.current?.focus({ preventScroll: true });

    // Focus synchronously before paint, then once more on the next frame. No
    // focus restoration is performed from this cleanup: React StrictMode runs
    // mount cleanups during its development probe and would otherwise steal
    // focus back from the dialog. The parent restores focus when it closes.
    focusInput();
    const frame = window.requestAnimationFrame(focusInput);
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  function close(): void {
    if (!busy) onClose();
  }

  function handleDialogKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;

    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
      (element) =>
        !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true',
    );
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    const trimmed = title.trim();
    if (!trimmed) {
      setError('Введите название класса.');
      inputRef.current?.focus();
      return;
    }
    if (trimmed.length > 255) {
      setError('Название не длиннее 255 символов.');
      inputRef.current?.focus();
      return;
    }

    setBusy(true);
    const result = await api.createClassroom(
      { title: trimmed, ageBand, topicKeys, safeModeDefault },
      idempotencyKey,
    );
    setBusy(false);
    if (result.ok) {
      onCreated(result.data.classroom, result.data.created);
      return;
    }
    if (result.status === 400) {
      setError(result.error.message || 'Некорректное название.');
    } else if (result.status === 409 && result.error.code === 'idempotency_conflict') {
      setError('Запрос уже был использован с другим названием. Закройте окно и повторите.');
    } else if (result.status === 0) {
      setError('Сервер недоступен. Проверьте соединение и повторите попытку.');
    } else {
      setError('Ошибка сервера. Класс не создан. Повторите попытку позже.');
    }
    inputRef.current?.focus();
  }

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        ref={dialogRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-classroom-title"
        aria-describedby={error ? errorId : undefined}
        aria-busy={busy}
        tabIndex={-1}
        onKeyDown={handleDialogKeyDown}
      >
        <h2 id="create-classroom-title">Создать класс</h2>
        <form onSubmit={(event) => void submit(event)} noValidate>
          <label htmlFor="classroom-title">Название класса</label>
          <input
            ref={inputRef}
            autoFocus
            id="classroom-title"
            name="title"
            placeholder="8А Робототехника"
            maxLength={255}
            value={title}
            disabled={busy}
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={error ? errorId : undefined}
            onChange={(event) => setTitle(event.target.value)}
          />
          <label htmlFor="classroom-age-band">Возраст учеников</label>
          <select
            id="classroom-age-band"
            value={ageBand}
            disabled={busy}
            onChange={(event) => setAgeBand(event.target.value as Classroom['ageBand'])}
          >
            <option value="mixed">Разный возраст</option>
            <option value="6-8">6–8 лет</option>
            <option value="9-10">9–10 лет</option>
            <option value="11-12">11–12 лет</option>
            <option value="13-15">13–15 лет</option>
            <option value="16-18">16–18 лет</option>
          </select>
          <fieldset className="classroom-topic-fieldset">
            <legend>Направления</legend>
            {[
              ['electronics', 'Электроника'],
              ['3d', '3D-моделирование'],
              ['chess', 'Шахматы'],
              ['checkers', 'Шашки'],
              ['robotics', 'Робототехника'],
            ].map(([key, label]) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={topicKeys.includes(key as string)}
                  disabled={busy}
                  onChange={(event) =>
                    setTopicKeys((current) =>
                      event.target.checked
                        ? [...current, key as string]
                        : current.filter((entry) => entry !== key),
                    )
                  }
                />
                {label}
              </label>
            ))}
          </fieldset>
          <label className="classroom-safe-mode-field">
            <input
              type="checkbox"
              checked={safeModeDefault}
              disabled={busy}
              onChange={(event) => setSafeModeDefault(event.target.checked)}
            />
            <span>
              <strong>Безопасный режим</strong>
              <small>Проекты учеников закрыты от публичной публикации. Рекомендуется.</small>
            </span>
          </label>
          {error ? (
            <p id={errorId} className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={close} disabled={busy}>
              Отмена
            </button>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? 'Создаём…' : 'Создать'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
