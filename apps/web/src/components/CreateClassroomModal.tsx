import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { api, type Classroom } from '../api';

const CONFLICT_MESSAGES: Record<string, string> = {
  idempotency_conflict:
    'Этот запрос уже был выполнен с другими данными. Закройте окно и попробуйте ещё раз.',
  no_school_assigned: 'У вашего профиля не указана школа. Обратитесь к администратору.',
  no_active_period: 'Для вашей школы нет активного учебного периода. Обратитесь к администратору.',
};

export function CreateClassroomModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (classroom: Classroom, created: boolean) => void;
}): JSX.Element {
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  // One idempotency key per modal lifetime: a retry of the same submit cannot
  // create a duplicate classroom.
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);

  // Initial focus goes to the title field.
  useEffect(() => {
    titleInputRef.current?.focus();
  }, []);

  function requestClose(): void {
    if (!busy) {
      onClose();
    }
  }

  function onDialogKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') {
      event.stopPropagation();
      requestClose();
      return;
    }
    if (event.key !== 'Tab') {
      return;
    }
    // Focus trap: Tab cycles inside the dialog only.
    const container = dialogRef.current;
    if (!container) {
      return;
    }
    const focusable = Array.from(
      container.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ),
    );
    if (focusable.length === 0) {
      return;
    }
    const first = focusable[0] as HTMLElement;
    const last = focusable[focusable.length - 1] as HTMLElement;
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
      return;
    }
    if (trimmed.length > 255) {
      setError('Название не длиннее 255 символов.');
      return;
    }
    setBusy(true);
    const result = await api.createClassroom(trimmed, idempotencyKey);
    setBusy(false);
    if (result.ok) {
      onCreated(result.data.classroom, result.data.created);
      return;
    }
    if (result.status === 409) {
      setError(CONFLICT_MESSAGES[result.error.code] ?? 'Конфликт запроса. Попробуйте ещё раз.');
    } else if (result.status === 400) {
      setError(result.error.message || 'Некорректное название.');
    } else if (result.status === 0) {
      setError('Сервер недоступен. Попробуйте ещё раз.');
    } else {
      setError('Ошибка сервера. Класс не создан.');
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={requestClose}>
      <div
        ref={dialogRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-classroom-title"
        aria-describedby="create-classroom-description"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={onDialogKeyDown}
      >
        <h2 id="create-classroom-title">Создать класс</h2>
        <p id="create-classroom-description" className="muted">
          Название увидят ученики и коллеги. Его можно будет изменить позже.
        </p>
        <form onSubmit={(event) => void submit(event)} noValidate>
          <label htmlFor="classroom-title">Название класса</label>
          <input
            id="classroom-title"
            ref={titleInputRef}
            autoFocus
            name="title"
            placeholder="8А Робототехника"
            maxLength={255}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            aria-describedby={error ? 'classroom-title-error' : undefined}
          />
          <p
            id="classroom-title-error"
            className="form-error"
            role="alert"
            aria-live="assertive"
            hidden={!error}
          >
            {error}
          </p>
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={requestClose} disabled={busy}>
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
