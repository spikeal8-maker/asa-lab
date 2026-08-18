import { useCallback, useEffect, useState } from 'react';
import { api, type SeatAssignment } from '../api';
import { AssignmentGoal, BriefText } from './BriefText';
import { newClientId } from '../client-id';
import { useSchoolTime } from './school-time';
import './classroom-assignments.css';

/**
 * What the teacher has set, on the learner's own home page.
 *
 * "Начать" makes the learner a project of their own in the environment the
 * teacher chose and opens it — the same kind of project they make on their own,
 * so everything that already works for their work works for this. Nothing is
 * pressed to report progress: opening it is starting it.
 *
 * "Сдать" is separate and is the learner's decision. It does not lock anything:
 * a child may keep working and hand in again. Freezing someone out of their own
 * model to enforce a deadline is a thing school software does and should not.
 */
export function SeatAssignments({
  onOpenProject,
}: {
  readonly onOpenProject: (projectId: string, moduleKey: string) => void;
}): JSX.Element | null {
  const [items, setItems] = useState<SeatAssignment[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Which task is being read. One at a time: a learner is doing one thing.
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const time = useSchoolTime();

  const reload = useCallback(async () => {
    const result = await api.seatAssignments();
    setItems(result.ok ? result.data.items : []);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function start(assignment: SeatAssignment): Promise<void> {
    setBusy(assignment.id);
    setError(null);
    const created = await api.createProject({
      scope: 'personal',
      module: assignment.moduleKey,
      title: assignment.title,
      idempotencyKey: newClientId(),
    });
    if (!created.ok) {
      setBusy(null);
      setError(created.error.message || 'Не удалось начать задание.');
      return;
    }
    const linked = await api.startSeatAssignment(assignment.id, created.data.project.id);
    setBusy(null);
    if (!linked.ok) {
      setError(linked.error.message || 'Не удалось начать задание.');
      return;
    }
    await reload();
    onOpenProject(linked.data.projectId, assignment.moduleKey);
  }

  if (items === null || items.length === 0) return null;

  return (
    <section className="seat-assignments" aria-labelledby="seat-assignments-title">
      <h2 id="seat-assignments-title">Задания от преподавателя</h2>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <ul data-testid="seat-assignments">
        {items.map((assignment) => (
          <li
            key={assignment.id}
            className={openId === assignment.id ? 'is-open' : undefined}
            // Нажатие в любое место карточки раскрывает задание. Заголовок
            // остаётся кнопкой ради клавиатуры и чтения с экрана, но искать
            // глазами, куда именно нажать, больше не нужно.
            onClick={(event) => {
              const target = event.target as HTMLElement;
              if (target.closest('button, a')) return;
              setOpenId(openId === assignment.id ? null : assignment.id);
            }}
          >
            {/* On a "make this" task the picture is half the brief: a paragraph
                about a castle is not the same as seeing one. */}
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
              {/* The whole card opens it. A task is the thing on this page, so
                  reading it should not mean finding a small triangle. */}
              <button
                type="button"
                className="seat-assignment-open"
                aria-expanded={openId === assignment.id}
                onClick={() => setOpenId(openId === assignment.id ? null : assignment.id)}
              >
                {assignment.title}
              </button>
              <span>
                {assignment.dueAt ? `Сдать до ${time.date(assignment.dueAt)}` : 'Без срока'}
                {assignment.status === 'closed' ? ' · задание закрыто' : ''}
              </span>
              {/* Состояние работы словом и цветом. «Сдал и ничего не изменилось»
                  — первое, на что жалуется ребёнок, нажавший «Сдать». */}
              <span
                className={`seat-assignment-state${
                  assignment.submittedAt ? ' is-done' : assignment.projectId ? ' is-working' : ''
                }`}
              >
                {assignment.submittedAt
                  ? `Сдано ${time.dateTime(assignment.submittedAt)}`
                  : assignment.projectId
                    ? 'В работе'
                    : 'Не начато'}
              </span>
              {openId === assignment.id ? (
                <div className="seat-assignment-full">
                  <AssignmentGoal goal={assignment.goal} />
                  {assignment.brief ? <BriefText text={assignment.brief} /> : null}
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
                    disabled={busy === assignment.id}
                    onClick={async () => {
                      setBusy(assignment.id);
                      const result = await api.submitSeatAssignment(
                        assignment.id,
                        assignment.submittedAt === null,
                      );
                      setBusy(null);
                      if (result.ok) await reload();
                    }}
                  >
                    {assignment.submittedAt ? 'Вернуть в работу' : 'Сдать'}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="portal-create-button"
                  disabled={busy === assignment.id || assignment.status === 'closed'}
                  onClick={() => void start(assignment)}
                >
                  {busy === assignment.id ? 'Готовим…' : 'Начать'}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
