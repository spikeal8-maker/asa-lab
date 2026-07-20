import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { api, type Classroom } from '../api';

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
  returnFocusRef,
}: {
  onClose: () => void;
  onCreated: (classroom: Classroom, created: boolean) => void;
  returnFocusRef: RefObject<HTMLButtonElement>;
}): JSX.Element {
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const errorId = useId();
  // One idempotency key per modal lifetime: retrying the same intent cannot
  // create a duplicate classroom.
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);

  useEffect(() => {
    const fallback = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const returnTarget = returnFocusRef.current ?? fallback;
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      window.requestAnimationFrame(() => returnTarget?.focus());
    };
  }, [returnFocusRef]);

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
      (element) => !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true',
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
    const result = await api.createClassroom(trimmed, idempotencyKey);
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
