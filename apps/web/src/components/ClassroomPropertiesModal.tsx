import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { api, type Classroom } from '../api';
import { ClassroomFields, type ClassroomDraft } from './ClassroomFields';

/**
 * A class's settings, reached without entering the class.
 *
 * A teacher renaming "8ж" after a typo, or correcting an age band chosen in a
 * hurry, should not have to open the class, find a tab and come back. Every
 * property that was answered when the class was made can be answered again
 * here, from the row it belongs to.
 */
export function ClassroomPropertiesModal({
  classroom,
  onClose,
  onSaved,
}: {
  readonly classroom: Classroom;
  readonly onClose: () => void;
  readonly onSaved: (classroom: Classroom) => void;
}): JSX.Element {
  const [draft, setDraft] = useState<ClassroomDraft>({
    title: classroom.title,
    ageBand: classroom.ageBand,
    topicKeys: classroom.topicKeys,
    safeModeDefault: classroom.safeModeDefault,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape' && !busy) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const title = draft.title.trim();
    if (!title) {
      setError('Введите название класса.');
      titleRef.current?.focus();
      return;
    }
    setBusy(true);
    const result = await api.updateClassroom(classroom.id, {
      title,
      ageBand: draft.ageBand,
      topicKeys: [...draft.topicKeys],
      safeModeDefault: draft.safeModeDefault,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message || 'Не удалось сохранить настройки класса.');
      return;
    }
    onSaved(result.data.classroom);
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="classroom-properties-heading"
      >
        <h2 id="classroom-properties-heading">Свойства класса</h2>
        <p>Изменения увидят все преподаватели класса. Ученики останутся на местах.</p>
        <form onSubmit={(event) => void submit(event)} noValidate>
          <ClassroomFields
            idPrefix="classroom-properties"
            draft={draft}
            busy={busy}
            autoFocus
            titleRef={titleRef}
            invalid={Boolean(error)}
            describedBy={error ? errorId : undefined}
            onChange={setDraft}
          />
          {error ? (
            <p id={errorId} className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="modal-actions">
            <button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>
              Отмена
            </button>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? 'Сохраняем…' : 'Сохранить'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
