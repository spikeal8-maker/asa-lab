import { useMemo, useState, type FormEvent } from 'react';
import { api, type Classroom } from '../api';

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
  // One idempotency key per modal lifetime: a retry of the same submit cannot
  // create a duplicate classroom.
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);

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
    if (result.status === 400) {
      setError(result.error.message || 'Некорректное название.');
    } else if (result.status === 0) {
      setError('Сервер недоступен. Попробуйте ещё раз.');
    } else {
      setError('Ошибка сервера. Класс не создан.');
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-classroom-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="create-classroom-title">Создать класс</h2>
        <form onSubmit={(event) => void submit(event)} noValidate>
          <label htmlFor="classroom-title">Название класса</label>
          <input
            id="classroom-title"
            name="title"
            placeholder="8А Робототехника"
            maxLength={255}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
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
