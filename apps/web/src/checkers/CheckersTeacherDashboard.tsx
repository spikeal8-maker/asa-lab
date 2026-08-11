import './checkers.css';

export interface CheckersTeacherAssignmentRow {
  readonly id: string;
  readonly title: string;
  readonly kindLabel: string;
  readonly dueLabel: string;
  readonly completed: number;
  readonly assigned: number;
  readonly status: 'active' | 'draft' | 'closed';
}

export interface CheckersTeacherStudentRow {
  readonly id: string;
  readonly displayName: string;
  readonly masteryPercent: number;
  readonly activityLabel: string;
  readonly assignmentProgress: string;
  readonly signal: 'ok' | 'inactive' | 'repeated-error';
  readonly signalLabel: string;
  readonly lastEvidence: string;
}

export interface CheckersConceptColumn {
  readonly id: string;
  readonly shortLabel: string;
  readonly fullLabel: string;
}

export interface CheckersTeacherDashboardViewModel {
  readonly classroomTitle: string;
  readonly studentCount: number;
  readonly activeThisWeek: number;
  readonly assignmentCompletionPercent: number;
  readonly needsAttention: number;
  readonly assignments: readonly CheckersTeacherAssignmentRow[];
  readonly students: readonly CheckersTeacherStudentRow[];
  readonly concepts: readonly CheckersConceptColumn[];
  readonly masteryByStudent: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

function statusLabel(status: CheckersTeacherAssignmentRow['status']): string {
  if (status === 'active') return 'Назначено';
  if (status === 'draft') return 'Черновик';
  return 'Завершено';
}

function masteryBand(value: number): 'low' | 'developing' | 'secure' | 'mastered' {
  if (value < 40) return 'low';
  if (value < 65) return 'developing';
  if (value < 85) return 'secure';
  return 'mastered';
}

export function CheckersTeacherDashboard({
  model,
  onBack,
  onCreateAssignment,
  onOpenAssignment,
  onOpenStudent,
}: {
  model: CheckersTeacherDashboardViewModel;
  onBack: () => void;
  onCreateAssignment: () => void;
  onOpenAssignment: (id: string) => void;
  onOpenStudent: (id: string) => void;
}): JSX.Element {
  return (
    <main className="checkers-teacher" id="main-content" tabIndex={-1}>
      <header className="checkers-teacher-heading">
        <div>
          <button type="button" className="checkers-link-button" onClick={onBack}>
            ← К списку классов
          </button>
          <span className="checkers-kicker">ASA Шашки · педагог</span>
          <h1>{model.classroomTitle}</h1>
          <p>Задания, активность и доказательства по каждому шашечному понятию.</p>
        </div>
        <button type="button" className="checkers-primary-action" onClick={onCreateAssignment}>
          Создать задание
        </button>
      </header>

      <section className="checkers-teacher-stats" aria-label="Сводка класса">
        <article>
          <span>Учеников</span>
          <strong>{model.studentCount}</strong>
          <small>в этом классе</small>
        </article>
        <article>
          <span>Активны за неделю</span>
          <strong>
            {model.activeThisWeek} / {model.studentCount}
          </strong>
          <small>открывали шашки</small>
        </article>
        <article>
          <span>Задания выполнены</span>
          <strong>{model.assignmentCompletionPercent}%</strong>
          <small>по активным заданиям</small>
        </article>
        <article className={model.needsAttention > 0 ? 'attention' : ''}>
          <span>Нужно внимание</span>
          <strong>{model.needsAttention}</strong>
          <small>сигналов, а не ярлыков</small>
        </article>
      </section>

      <section className="checkers-teacher-section" aria-labelledby="teacher-assignments-title">
        <div className="checkers-section-heading">
          <div>
            <span className="checkers-home-eyebrow">Работа класса</span>
            <h2 id="teacher-assignments-title">Задания</h2>
          </div>
          <button type="button" className="checkers-link-button" onClick={onCreateAssignment}>
            Новое задание
          </button>
        </div>
        <div className="checkers-assignment-table-wrap">
          <table className="checkers-teacher-table">
            <thead>
              <tr>
                <th>Название</th>
                <th>Тип</th>
                <th>Срок</th>
                <th>Выполнение</th>
                <th>Статус</th>
              </tr>
            </thead>
            <tbody>
              {model.assignments.map((assignment) => {
                const percent =
                  assignment.assigned === 0
                    ? 0
                    : Math.round((assignment.completed / assignment.assigned) * 100);
                return (
                  <tr key={assignment.id}>
                    <td>
                      <button type="button" onClick={() => onOpenAssignment(assignment.id)}>
                        {assignment.title}
                      </button>
                    </td>
                    <td>{assignment.kindLabel}</td>
                    <td>{assignment.dueLabel}</td>
                    <td>
                      <div className="checkers-table-progress">
                        <span style={{ width: `${percent}%` }} />
                      </div>
                      <small>
                        {assignment.completed} из {assignment.assigned}
                      </small>
                    </td>
                    <td>
                      <span className={`checkers-assignment-status ${assignment.status}`}>
                        {statusLabel(assignment.status)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="checkers-teacher-section" aria-labelledby="teacher-mastery-title">
        <div className="checkers-section-heading">
          <div>
            <span className="checkers-home-eyebrow">Не рейтинг</span>
            <h2 id="teacher-mastery-title">Освоение понятий</h2>
          </div>
          <p>Цвет показывает доказанное освоение, а не «способность ребёнка».</p>
        </div>
        <div className="checkers-mastery-table-wrap">
          <table className="checkers-mastery-table">
            <thead>
              <tr>
                <th>Ученик</th>
                {model.concepts.map((concept) => (
                  <th key={concept.id} title={concept.fullLabel}>
                    {concept.shortLabel}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {model.students.map((student) => (
                <tr key={student.id}>
                  <th>
                    <button type="button" onClick={() => onOpenStudent(student.id)}>
                      {student.displayName}
                    </button>
                  </th>
                  {model.concepts.map((concept) => {
                    const mastery = model.masteryByStudent[student.id]?.[concept.id] ?? 0;
                    return (
                      <td key={concept.id}>
                        <span
                          className={`checkers-mastery-cell ${masteryBand(mastery)}`}
                          title={`${concept.fullLabel}: ${mastery}%`}
                          aria-label={`${student.displayName}, ${concept.fullLabel}: ${mastery}%`}
                        >
                          {mastery}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="checkers-teacher-section" aria-labelledby="teacher-evidence-title">
        <div className="checkers-section-heading">
          <div>
            <span className="checkers-home-eyebrow">До конкретного хода</span>
            <h2 id="teacher-evidence-title">Активность и сигналы</h2>
          </div>
        </div>
        <div className="checkers-assignment-table-wrap">
          <table className="checkers-teacher-table evidence">
            <thead>
              <tr>
                <th>Ученик</th>
                <th>Активность</th>
                <th>Задания</th>
                <th>Наблюдаемый сигнал</th>
                <th>Последнее доказательство</th>
              </tr>
            </thead>
            <tbody>
              {model.students.map((student) => (
                <tr key={student.id}>
                  <td>
                    <button type="button" onClick={() => onOpenStudent(student.id)}>
                      {student.displayName}
                    </button>
                  </td>
                  <td>{student.activityLabel}</td>
                  <td>{student.assignmentProgress}</td>
                  <td>
                    <span className={`checkers-student-signal ${student.signal}`}>
                      {student.signalLabel}
                    </span>
                  </td>
                  <td>{student.lastEvidence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
