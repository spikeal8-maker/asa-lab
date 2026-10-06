import { useEffect, useState, type JSX } from 'react';
import { api, type Classroom, type PublishedAuthorVersion } from '../api';

export interface CourseAssignAttempt {
  classroomId: string;
  dueDate: string;
  submitted?: { classroomId: string; dueAt: string | null; requestId: string; timeZone: string };
  completed?: { runId: string; versionNumber: number };
}

export function CourseAssignDialog({
  courseId,
  version,
  attempt,
  onClose,
  onBusyChange,
}: {
  readonly courseId: string;
  readonly version: PublishedAuthorVersion;
  readonly attempt: CourseAssignAttempt;
  readonly onClose: () => void;
  readonly onBusyChange: (busy: boolean) => void;
}): JSX.Element {
  const [classrooms, setClassrooms] = useState<Classroom[] | null>(null);
  const [classroomId, setClassroomId] = useState(attempt.classroomId);
  const [dueDate, setDueDate] = useState(attempt.dueDate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(attempt.completed);
  useEffect(() => {
    let active = true;
    void api.listClassrooms().then((result) => {
      if (!active) return;
      if (result.ok) setClassrooms(result.data.items.filter((item) => item.archivedAt === null));
      else setError(result.error.message);
    });
    return () => {
      active = false;
    };
  }, []);
  async function assign(): Promise<void> {
    if (busy || completed || !classroomId) return;
    const submitted = attempt.submitted ?? {
      classroomId,
      dueAt: dueDate ? new Date(`${dueDate}T23:59:59`).toISOString() : null,
      requestId: crypto.randomUUID(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
    attempt.submitted = submitted;
    setBusy(true);
    onBusyChange(true);
    setError(null);
    try {
      const result = await api.assignCourseToClassroom(
        submitted.classroomId,
        courseId,
        submitted.dueAt,
        {
          versionNumber: version.versionNumber,
          audienceType: 'whole_class',
          seatIds: [],
          requestId: submitted.requestId,
          timeZone: submitted.timeZone,
        },
      );
      if (!result.ok) {
        setError(
          result.error.message ||
            'Ответ не подтверждён. Повторите назначение с теми же параметрами.',
        );
        return;
      }
      if (result.data.versionNumber !== version.versionNumber) {
        setError('Сервер не подтвердил выбранную версию. Назначение не считается завершённым.');
        return;
      }
      attempt.completed = result.data;
      setCompleted(result.data);
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }
  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="modal course-assign-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Назначить курс"
      >
        <h2>Назначить курс</h2>
        <p>
          <strong>{version.outline?.course.title}</strong> · опубликованная версия{' '}
          {version.versionNumber}
        </p>
        <p>
          Ученики получат содержание показанной версии. Последующие правки не изменят это
          назначение.
        </p>
        {error ? <p role="alert">{error}</p> : null}
        {completed ? (
          <p role="status">Курс назначен. Сервер подтвердил версию {completed.versionNumber}.</p>
        ) : null}
        <label className="course-field">
          Класс
          <select
            aria-label="Класс для курса"
            value={classroomId}
            disabled={busy || attempt.submitted !== undefined}
            onChange={(event) => {
              attempt.classroomId = event.target.value;
              setClassroomId(event.target.value);
            }}
          >
            <option value="">Выберите класс…</option>
            {classrooms?.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
        {classrooms === null ? (
          <p role="status">Загружаем классы…</p>
        ) : classrooms.length === 0 ? (
          <p>Создайте класс, чтобы назначить курс.</p>
        ) : null}
        <label className="course-field">
          Срок, если нужен
          <input
            type="date"
            value={dueDate}
            disabled={busy || attempt.submitted !== undefined}
            onChange={(event) => {
              attempt.dueDate = event.target.value;
              setDueDate(event.target.value);
            }}
          />
        </label>
        <div className="modal-actions">
          <button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>
            Закрыть назначение
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={busy || !classroomId || completed !== undefined}
            onClick={() => void assign()}
          >
            {busy
              ? 'Назначаем…'
              : attempt.submitted && !completed
                ? 'Повторить назначение'
                : 'Назначить'}
          </button>
        </div>
      </section>
    </div>
  );
}
