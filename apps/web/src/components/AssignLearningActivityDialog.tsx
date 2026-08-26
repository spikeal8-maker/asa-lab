import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, type ClassroomStudentSeat, type LearningAssignableActivity } from '../api';
import { newClientId } from '../client-id';

export function AssignLearningActivityDialog({
  classroomId,
  onClose,
  onAssigned,
}: {
  readonly classroomId: string;
  readonly onClose: () => void;
  readonly onAssigned: (title: string, count: number) => void;
}): JSX.Element {
  const [activities, setActivities] = useState<LearningAssignableActivity[] | null>(null);
  const [students, setStudents] = useState<ClassroomStudentSeat[] | null>(null);
  const [activityVersionId, setActivityVersionId] = useState('');
  const [audienceType, setAudienceType] = useState<'whole_class' | 'named_learners'>('whole_class');
  const [selectedSeats, setSelectedSeats] = useState<string[]>([]);
  const [dueAt, setDueAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      api.listAssignableLearningActivities(classroomId),
      api.listClassroomRoster(classroomId),
    ]).then(([library, roster]) => {
      if (cancelled) return;
      setActivities(library.ok ? library.data.items : []);
      setStudents(
        roster.ok
          ? roster.data.items.filter((student) => ['issued', 'active'].includes(student.status))
          : [],
      );
      if (library.ok && library.data.items[0]) {
        setActivityVersionId(library.data.items[0].versionId);
      }
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
    setBusy(true);
    setError(null);
    const result = await api.assignLearningActivity(classroomId, {
      activityVersionId: activity.versionId,
      audienceType,
      seatIds: audienceType === 'named_learners' ? selectedSeats : [],
      dueAt: dueAt ? new Date(`${dueAt}T23:59:00`).toISOString() : null,
      requestId: `assign:${newClientId()}`,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message || 'Не удалось назначить задание.');
      return;
    }
    onAssigned(activity.title, result.data.assignedCount);
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="modal learning-assign-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="learning-assign-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h2 id="learning-assign-title">Назначить задание</h2>
            <p>Выберите готовый материал, учеников и срок.</p>
          </div>
          <button type="button" className="modal-close" aria-label="Закрыть" onClick={onClose}>
            ×
          </button>
        </header>
        {activities === null || students === null ? (
          <p role="status">Загружаем материалы и класс…</p>
        ) : activities.length === 0 ? (
          <div className="classroom-roster-empty">
            <h3>Нет опубликованных заданий</h3>
            <p>Сначала опубликуйте проект в разделе «Задания».</p>
          </div>
        ) : (
          <form onSubmit={(event) => void submit(event)}>
            <label className="learning-assign-field">
              <span>Задание</span>
              <select
                value={activityVersionId}
                onChange={(event) => setActivityVersionId(event.target.value)}
              >
                {activities.map((entry) => (
                  <option key={entry.versionId} value={entry.versionId}>
                    {entry.title}
                  </option>
                ))}
              </select>
            </label>
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
              <input type="date" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
            </label>
            {error ? (
              <p className="form-error" role="alert">
                {error}
              </p>
            ) : null}
            <footer>
              <button type="button" className="btn-secondary" onClick={onClose}>
                Отмена
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
