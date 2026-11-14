import { useEffect, useId, useState, type JSX } from 'react';
import {
  api,
  type Classroom,
  type ClassroomStudentSeat,
  type PublishedAuthorVersion,
} from '../api';
import { assignmentDateTime } from '../learning/assignment-date-time';
import './classroom-assignments.css';

type CourseAudience = 'whole_class' | 'named_learners';

export interface CourseAssignAttempt {
  classroomId: string;
  dueDate: string;
  dueTime?: string;
  audienceType?: CourseAudience;
  seatIds?: string[];
  submitted?: {
    classroomId: string;
    dueAt: string | null;
    requestId: string;
    timeZone: string;
    audienceType: CourseAudience;
    seatIds: string[];
  };
  completed?: { runId: string; versionNumber: number };
}

export function CourseAssignDialog({
  courseId,
  version,
  attempt,
  onClose,
  onBusyChange,
  onAssigned,
}: {
  readonly courseId: string;
  readonly version: PublishedAuthorVersion;
  readonly attempt: CourseAssignAttempt;
  readonly onClose: () => void;
  readonly onBusyChange: (busy: boolean) => void;
  readonly onAssigned?: () => void;
}): JSX.Element {
  const [classrooms, setClassrooms] = useState<Classroom[] | null>(null);
  const [classroomId, setClassroomId] = useState(attempt.classroomId);
  const [dueDate, setDueDate] = useState(attempt.dueDate);
  const [dueTime, setDueTime] = useState(attempt.dueTime ?? '');
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [audienceType, setAudienceType] = useState<CourseAudience>(
    attempt.audienceType ?? 'whole_class',
  );
  const [seatIds, setSeatIds] = useState(attempt.seatIds ?? []);
  const [roster, setRoster] = useState<ClassroomStudentSeat[] | null>(null);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [rosterRetry, setRosterRetry] = useState(0);
  const audienceName = useId();
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
  useEffect(() => {
    if (!classroomId || audienceType !== 'named_learners' || attempt.submitted) return;
    let active = true;
    setRoster(null);
    setRosterError(null);
    void api.listClassroomRoster(classroomId).then((result) => {
      if (!active) return;
      if (result.ok) {
        setRoster(
          result.data.items.filter((student) => ['issued', 'active'].includes(student.status)),
        );
      } else {
        setRosterError(result.error.message || 'Не удалось загрузить список учеников.');
      }
    });
    return () => {
      active = false;
    };
  }, [attempt, classroomId, audienceType, rosterRetry]);

  const locked = busy || attempt.submitted !== undefined;
  const selectedSeats = roster?.filter((student) => seatIds.includes(student.id)) ?? [];
  const canAssign =
    !busy &&
    !completed &&
    !!classroomId &&
    (attempt.submitted !== undefined || audienceType === 'whole_class' || selectedSeats.length > 0);

  async function assign(): Promise<void> {
    if (!canAssign) return;
    let submitted = attempt.submitted;
    if (!submitted) {
      const deadline = assignmentDateTime(dueDate ? `${dueDate}T${dueTime || '23:59'}` : '');
      if (!deadline.ok) {
        setError(deadline.message);
        return;
      }
      // A date without a specified time includes the entire final minute.
      const dueAt =
        deadline.instant && !dueTime
          ? new Date(Date.parse(deadline.instant) + 59_000).toISOString()
          : deadline.instant;
      submitted = {
        classroomId,
        dueAt,
        requestId: crypto.randomUUID(),
        timeZone: deadline.timeZone,
        audienceType,
        seatIds:
          audienceType === 'named_learners' ? selectedSeats.map((student) => student.id) : [],
      };
      attempt.submitted = submitted;
    }
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
          audienceType: submitted.audienceType,
          seatIds: submitted.seatIds,
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
      onAssigned?.();
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }
  function startNewAssignment(): void {
    if (busy || !attempt.completed) return;
    // A confirmed receipt closes the old attempt. An ambiguous attempt is
    // never reset, including when this dialog is closed and reopened.
    delete attempt.submitted;
    delete attempt.completed;
    attempt.classroomId = '';
    attempt.dueDate = '';
    delete attempt.dueTime;
    attempt.audienceType = 'whole_class';
    attempt.seatIds = [];
    setClassroomId('');
    setDueDate('');
    setDueTime('');
    setAudienceType('whole_class');
    setSeatIds([]);
    setCompleted(undefined);
    setError(null);
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
            disabled={locked}
            onChange={(event) => {
              attempt.classroomId = event.target.value;
              attempt.seatIds = [];
              setSeatIds([]);
              setRoster(null);
              setRosterError(null);
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
        <fieldset className="learning-audience-options" disabled={locked || !classroomId}>
          <legend>Кому</legend>
          <label>
            <input
              type="radio"
              name={audienceName}
              checked={audienceType === 'whole_class'}
              onChange={() => {
                attempt.audienceType = 'whole_class';
                setAudienceType('whole_class');
              }}
            />
            Весь класс, включая новых учеников
          </label>
          <label>
            <input
              type="radio"
              name={audienceName}
              checked={audienceType === 'named_learners'}
              onChange={() => {
                attempt.audienceType = 'named_learners';
                setAudienceType('named_learners');
              }}
            />
            Выбранные ученики
          </label>
        </fieldset>
        {classroomId && audienceType === 'named_learners' ? (
          attempt.submitted ? (
            <p>Выбрано учеников: {attempt.submitted.seatIds.length}.</p>
          ) : rosterError ? (
            <div role="alert">
              {rosterError}{' '}
              <button type="button" onClick={() => setRosterRetry((value) => value + 1)}>
                Повторить
              </button>
            </div>
          ) : roster === null ? (
            <p role="status">Загружаем список учеников…</p>
          ) : roster.length === 0 ? (
            <p>В классе пока нет доступных учеников.</p>
          ) : (
            <fieldset className="learning-learner-picker" disabled={locked}>
              <legend>Ученики</legend>
              {roster.map((student) => (
                <label key={student.id}>
                  <input
                    type="checkbox"
                    checked={seatIds.includes(student.id)}
                    onChange={(event) => {
                      const next = event.target.checked
                        ? [...seatIds, student.id]
                        : seatIds.filter((id) => id !== student.id);
                      attempt.seatIds = next;
                      setSeatIds(next);
                    }}
                  />
                  {student.displayLabel}
                </label>
              ))}
            </fieldset>
          )
        ) : null}
        <label className="course-field">
          Срок, если нужен
          <input
            type="date"
            value={dueDate}
            disabled={locked}
            onChange={(event) => {
              attempt.dueDate = event.target.value;
              setDueDate(event.target.value);
              if (!event.target.value) {
                delete attempt.dueTime;
                setDueTime('');
              }
            }}
          />
        </label>
        {dueDate ? (
          <label className="course-field">
            Время сдачи
            <input
              type="time"
              value={dueTime}
              disabled={locked}
              onChange={(event) => {
                attempt.dueTime = event.target.value;
                setDueTime(event.target.value);
              }}
            />
            <small>{timeZone}. Если оставить время пустым, срок — до конца выбранного дня.</small>
          </label>
        ) : null}
        <div className="modal-actions">
          {completed ? (
            <button
              type="button"
              className="btn-primary"
              disabled={busy}
              onClick={startNewAssignment}
            >
              Новое назначение
            </button>
          ) : null}
          <button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>
            Закрыть назначение
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!canAssign}
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
