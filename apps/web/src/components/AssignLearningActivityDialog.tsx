import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { api, type ClassroomStudentSeat, type LearningAssignableActivity } from '../api';
import { newClientId } from '../client-id';
import { assignmentDateTime } from '../learning/assignment-date-time';

export function AssignLearningActivityDialog({
  classroomId,
  preparedVersionId,
  onClose,
  onCreate,
  onAssigned,
}: {
  readonly classroomId: string;
  readonly preparedVersionId: string | null;
  readonly onClose: () => void;
  readonly onCreate: (draftId?: string) => void;
  readonly onAssigned: (title: string, count: number, wholeClass: boolean) => void;
}): JSX.Element {
  const [activities, setActivities] = useState<LearningAssignableActivity[] | null>(null);
  const [students, setStudents] = useState<ClassroomStudentSeat[] | null>(null);
  const [activityVersionId, setActivityVersionId] = useState(preparedVersionId ?? '');
  const [drafts, setDrafts] = useState<{ id: string; title: string }[]>([]);
  const [draftError, setDraftError] = useState(false);
  const [draftId, setDraftId] = useState('');
  const [audienceType, setAudienceType] = useState<'whole_class' | 'named_learners'>('whole_class');
  const [selectedSeats, setSelectedSeats] = useState<string[]>([]);
  const [dueAt, setDueAt] = useState('');
  const request = useRef<{ payload: string; id: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => closeButton.current?.focus(), []);
  useEffect(() => {
    if (preparedVersionId) return;
    let active = true;
    void api.authoredActivities().then((result) => {
      if (!active) return;
      if (!result.ok) {
        setDraftError(true);
        return;
      }
      setDrafts(
        result.data.items.filter(
          (item) =>
            item.currentPublishedVersionId === null &&
            (item.kind === 'project' || item.kind === 'quiz' || item.kind === 'file'),
        ),
      );
    });
    return () => {
      active = false;
    };
  }, [preparedVersionId]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      api.listAssignableLearningActivities(classroomId),
      api.listClassroomRoster(classroomId),
    ]).then(([library, roster]) => {
      if (cancelled) return;
      if (!library.ok || !roster.ok)
        setError(!library.ok ? library.error.message : !roster.ok ? roster.error.message : null);
      setActivities(library.ok ? library.data.items : []);
      setStudents(
        roster.ok
          ? roster.data.items.filter((student) => ['issued', 'active'].includes(student.status))
          : [],
      );
    });
    return () => {
      cancelled = true;
    };
  }, [classroomId]);

  const activity = useMemo(
    () => activities?.find((entry) => entry.versionId === activityVersionId) ?? null,
    [activities, activityVersionId],
  );

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!activity || (audienceType === 'named_learners' && selectedSeats.length === 0)) return;
    const date = assignmentDateTime(dueAt);
    if (!date.ok) {
      setError(date.message);
      return;
    }
    setBusy(true);
    setError(null);
    const payload = JSON.stringify({
      activityVersionId,
      audienceType,
      selectedSeats,
      dueAt: date.instant,
      timeZone: date.timeZone,
    });
    if (request.current?.payload !== payload)
      request.current = { payload, id: `assign:${newClientId()}` };
    const result = await api.assignLearningActivity(classroomId, {
      activityVersionId: activity.versionId,
      audienceType,
      seatIds: audienceType === 'named_learners' ? selectedSeats : [],
      dueAt: date.instant,
      timeZone: date.timeZone,
      requestId: request.current.id,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message || 'Не удалось назначить задание.');
      return;
    }
    onAssigned(activity.title, result.data.assignedCount, audienceType === 'whole_class');
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={busy ? undefined : onClose}>
      <section
        className="modal learning-assign-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="learning-assign-title"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !busy) onClose();
        }}
      >
        <header>
          <div>
            <h2 id="learning-assign-title">Назначить задание</h2>
            <p>
              {preparedVersionId
                ? 'Выберите получателей и срок.'
                : 'Создайте новое или выберите готовое задание для класса.'}
            </p>
          </div>
          <button
            type="button"
            ref={closeButton}
            className="modal-close"
            aria-label="Закрыть"
            onClick={onClose}
            disabled={busy}
          >
            ×
          </button>
        </header>
        {preparedVersionId ? null : (
          <div className="classroom-assignment-issue">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => onCreate()}
              disabled={busy}
            >
              Создать новое задание
            </button>
            {drafts.length > 0 ? (
              <details>
                <summary>Продолжить черновик</summary>
                <label className="learning-assign-field">
                  Черновик
                  <select
                    aria-label="Черновик"
                    value={draftId}
                    onChange={(event) => setDraftId(event.target.value)}
                  >
                    <option value="" disabled>
                      Выберите черновик
                    </option>
                    {drafts.map((draft) => (
                      <option key={draft.id} value={draft.id}>
                        {draft.title}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={!draftId || busy}
                  onClick={() => onCreate(draftId)}
                >
                  Открыть черновик
                </button>
              </details>
            ) : null}
            {draftError ? <p role="status">Черновики временно недоступны.</p> : null}
          </div>
        )}
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        {activities === null || students === null ? (
          <p role="status">Загружаем материалы и класс…</p>
        ) : preparedVersionId && !activity ? (
          <p role="alert">Подготовленная версия недоступна. Вернитесь к редактору.</p>
        ) : activities.length === 0 ? (
          <div className="classroom-roster-empty">
            <p>Готовых заданий пока нет. Создайте первое прямо здесь.</p>
          </div>
        ) : (
          <form onSubmit={(event) => void submit(event)}>
            {preparedVersionId ? (
              <strong>{activity?.title}</strong>
            ) : (
              <label className="learning-assign-field">
                <span>Задание</span>
                <select
                  value={activityVersionId}
                  onChange={(event) => setActivityVersionId(event.target.value)}
                >
                  <option value="" disabled>
                    Выберите готовое задание
                  </option>
                  {activities.map((entry) => (
                    <option key={entry.versionId} value={entry.versionId}>
                      {entry.title}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {activity?.instructions ? (
              <p className="learning-assign-preview">{activity.instructions}</p>
            ) : null}
            <fieldset className="learning-audience-options">
              <legend>Кому</legend>
              <label>
                <input
                  type="radio"
                  name="audience"
                  checked={audienceType === 'whole_class'}
                  onChange={() => setAudienceType('whole_class')}
                />
                Весь класс
              </label>
              <label>
                <input
                  type="radio"
                  name="audience"
                  checked={audienceType === 'named_learners'}
                  onChange={() => setAudienceType('named_learners')}
                />
                Выбранные ученики
              </label>
            </fieldset>
            {audienceType === 'named_learners' ? (
              <div className="learning-learner-picker" aria-label="Ученики">
                {students.map((student) => (
                  <label key={student.id}>
                    <input
                      type="checkbox"
                      checked={selectedSeats.includes(student.id)}
                      onChange={(event) =>
                        setSelectedSeats((current) =>
                          event.target.checked
                            ? [...current, student.id]
                            : current.filter((id) => id !== student.id),
                        )
                      }
                    />
                    {student.displayLabel}
                  </label>
                ))}
              </div>
            ) : null}
            <label className="learning-assign-field">
              <span>Срок</span>
              <input
                aria-label="Срок"
                type="datetime-local"
                value={dueAt}
                onChange={(event) => setDueAt(event.target.value)}
              />
              <small>
                Дата и время: {Intl.DateTimeFormat().resolvedOptions().timeZone}. Пусто — без срока.
              </small>
            </label>
            <footer>
              <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
                {preparedVersionId ? 'К редактору' : 'Отмена'}
              </button>
              <button
                type="submit"
                className="portal-create-button"
                disabled={
                  busy ||
                  !activity ||
                  (audienceType === 'named_learners' && selectedSeats.length === 0)
                }
              >
                {busy ? 'Назначаем…' : 'Назначить'}
              </button>
            </footer>
          </form>
        )}
      </section>
    </div>
  );
}
