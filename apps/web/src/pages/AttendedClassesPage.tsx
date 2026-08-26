import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, type AttendedClass, type SeatAssignment } from '../api';
import { AssignmentView } from '../components/AssignmentView';
import { newClientId } from '../client-id';
import { SeatCourses } from '../components/SeatCourses';
import { useSchoolTime } from '../components/school-time';
import '../components/classroom-assignments.css';
import './attended-classes.css';
import {
  canonicalLearningClass,
  canonicalLearningLabel,
  canonicalSubmissionLocked,
} from '../learning/canonical-learning-presentation';

/**
 * Классы, в которых учится сам владелец аккаунта.
 *
 * Учатся не только дети. Преподаватель проходит курс коллеги, студент берёт
 * факультатив, взрослый учится ради себя — и всем им незачем заводить второй
 * вход по выданному логину и вторую полку работ. Тот же код класса, то же
 * место, те же задания; отличие ровно одно — человек остаётся собой.
 */
export function AttendedClassesPage({
  onOpenProject,
  mode = 'classes',
}: {
  readonly onOpenProject: (projectId: string, moduleKey: string) => void;
  readonly mode?: 'classes' | 'learning';
}): JSX.Element {
  const [classes, setClasses] = useState<readonly AttendedClass[] | null>(null);
  const [assignments, setAssignments] = useState<
    readonly (SeatAssignment & { classroomTitle: string })[]
  >([]);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const time = useSchoolTime();

  const load = useCallback(async () => {
    const [attended, work] = await Promise.all([api.attendedClasses(), api.attendedAssignments()]);
    setClasses(attended.ok ? attended.data.items : []);
    setAssignments(work.ok ? work.data.items : []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function join(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await api.joinClassAsAccount(code.trim());
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message || 'Не удалось войти в класс.');
      return;
    }
    setCode('');
    setNotice(
      result.data.alreadyMember
        ? `Вы уже учитесь в классе «${result.data.classroom.title}».`
        : `Вы в классе «${result.data.classroom.title}».`,
    );
    await load();
  }

  async function start(assignment: SeatAssignment): Promise<void> {
    setBusy(true);
    setError(null);
    const created = await api.createProject({
      scope: 'personal',
      module: assignment.moduleKey,
      title: assignment.title,
      idempotencyKey: newClientId(),
    });
    if (!created.ok) {
      setBusy(false);
      setError(created.error.message || 'Не удалось начать задание.');
      return;
    }
    const linked = await api.startSeatAssignment(assignment.id, created.data.project.id);
    setBusy(false);
    if (!linked.ok) {
      setError(linked.error.message || 'Не удалось начать задание.');
      return;
    }
    await load();
    onOpenProject(linked.data.projectId, assignment.moduleKey);
  }

  return (
    <main id="main-content" className="portal-content attended-classes" tabIndex={-1}>
      <header className="attended-heading">
        <div>
          <h1>{mode === 'learning' ? 'Обучение' : 'Я учусь'}</h1>
          <p>
            {mode === 'learning'
              ? 'Здесь собраны выданные вам материалы и задания. Чтобы получить маршрут, войдите в класс по коду преподавателя.'
              : 'Классы, в которые вы вошли по коду. Работы остаются вашими и лежат в ваших проектах.'}
          </p>
        </div>
      </header>

      <form className="attended-join" onSubmit={(event) => void join(event)}>
        <label htmlFor="attend-code">Код класса</label>
        <div>
          <input
            id="attend-code"
            value={code}
            maxLength={11}
            disabled={busy}
            placeholder="ABC DEF 234"
            onChange={(event) => setCode(event.target.value.toUpperCase())}
          />
          <button type="submit" className="portal-create-button" disabled={busy || !code.trim()}>
            {busy ? 'Входим…' : 'Войти в класс'}
          </button>
        </div>
        {/* Преподаватель своего класса не может быть в нём учеником: об этом
            говорит сервер, и сообщение сюда приходит как есть. */}
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="notice-success" role="status">
            {notice}
          </p>
        ) : null}
      </form>

      {classes === null ? (
        <p role="status">Загружаем…</p>
      ) : classes.length === 0 ? (
        <div className="classroom-roster-empty">
          <h3>Вы пока никуда не записаны</h3>
          <p>Введите код класса, который дал преподаватель.</p>
        </div>
      ) : (
        <ul className="attended-list">
          {classes.map((entry) => (
            <li key={entry.seatId}>
              <div>
                <strong>{entry.classroomTitle}</strong>
                <span>Преподаватель: {entry.teacherDisplayName}</span>
              </div>
              {entry.unfinishedCount > 0 ? (
                <span className="attended-owed">Не сдано: {entry.unfinishedCount}</span>
              ) : (
                <span className="attended-clear">Всё сдано</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {mode === 'learning' ? <SeatCourses source="account" onOpenProject={onOpenProject} /> : null}

      {assignments.length > 0 ? (
        <section aria-labelledby="attended-tasks">
          <h2 id="attended-tasks">Задания</h2>
          <ul className="seat-assignments" data-testid="attended-assignments">
            {assignments.map((assignment) => (
              <li
                key={assignment.id}
                className={openId === assignment.id ? 'is-open' : undefined}
                onClick={(event) => {
                  const target = event.target as HTMLElement;
                  if (target.closest('button, a')) return;
                  setOpenId(openId === assignment.id ? null : assignment.id);
                }}
              >
                {assignment.sampleImage ? (
                  <img
                    className="seat-assignment-sample"
                    src={assignment.sampleImage}
                    alt={`Образец: ${assignment.title}`}
                    width={96}
                    height={96}
                    loading="lazy"
                  />
                ) : null}
                <div className="seat-assignment-body">
                  <button
                    type="button"
                    className="seat-assignment-open"
                    aria-expanded={openId === assignment.id}
                    onClick={() => setOpenId(openId === assignment.id ? null : assignment.id)}
                  >
                    {assignment.title}
                  </button>
                  <span>
                    {assignment.classroomTitle}
                    {assignment.dueAt ? ` · сдать до ${time.date(assignment.dueAt)}` : ''}
                  </span>
                  <span
                    className={`seat-assignment-state${canonicalLearningClass(assignment.canonicalState) || (assignment.submittedAt ? ' is-done' : assignment.projectId ? ' is-working' : '')}`}
                  >
                    {canonicalLearningLabel(assignment.canonicalState) ??
                      (assignment.submittedAt
                        ? `Сдано ${time.dateTime(assignment.submittedAt)}`
                        : assignment.projectId
                          ? 'В работе'
                          : 'Не начато')}
                  </span>
                  {openId === assignment.id ? (
                    <div className="seat-assignment-full">
                      {/* Тот же вид задания и та же своя работа рядом, что и у
                          ребёнка с местом: учится тот же человек. */}
                      <AssignmentView
                        assignment={assignment}
                        aside={
                          assignment.projectId ? (
                            <figure className="seat-assignment-work">
                              {assignment.snapshotRevision === null ? (
                                <span className="seat-assignment-work-empty">
                                  Работа открыта, но пока пустая.
                                </span>
                              ) : (
                                <img
                                  src={`/api/projects/${encodeURIComponent(
                                    assignment.projectId,
                                  )}/snapshot?rev=${assignment.snapshotRevision}`}
                                  alt="Ваша работа"
                                  loading="lazy"
                                />
                              )}
                              <figcaption>
                                {assignment.updatedAt
                                  ? `Вы работали ${time.dateTime(assignment.updatedAt)}`
                                  : 'Ваша работа'}
                              </figcaption>
                            </figure>
                          ) : null
                        }
                      />
                    </div>
                  ) : null}
                </div>
                <div className="seat-assignment-actions">
                  {assignment.projectId ? (
                    <>
                      <button
                        type="button"
                        className="portal-create-button"
                        onClick={() =>
                          onOpenProject(assignment.projectId as string, assignment.moduleKey)
                        }
                      >
                        Открыть работу
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        disabled={
                          busy ||
                          (assignment.canonicalState
                            ? canonicalSubmissionLocked(assignment.canonicalState)
                            : assignment.submittedAt !== null)
                        }
                        onClick={async () => {
                          setBusy(true);
                          const result = await api.submitSeatAssignment(assignment.id, true);
                          setBusy(false);
                          if (result.ok) await load();
                        }}
                      >
                        {assignment.canonicalState
                          ? assignment.canonicalState.workflowState === 'changes_requested'
                            ? 'Сдать доработку'
                            : canonicalSubmissionLocked(assignment.canonicalState)
                              ? 'Работа сдана'
                              : 'Сдать'
                          : assignment.submittedAt
                            ? 'Работа сдана'
                            : 'Сдать'}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="portal-create-button"
                      disabled={busy || assignment.status === 'closed'}
                      onClick={() => void start(assignment)}
                    >
                      {busy ? 'Открываем…' : 'Открыть'}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
