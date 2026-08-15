import { EditorHeader } from '../components/editor-chrome/EditorHeader';
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
  readonly accuracyLabel: string;
  readonly hintUsageLabel: string;
  readonly mistakeTheme: string;
  readonly lastEvidence: string;
}

export interface CheckersConceptColumn {
  readonly id: string;
  readonly shortLabel: string;
  readonly fullLabel: string;
}

export interface CheckersTeacherSafetySignal {
  readonly id: string;
  readonly reporterName: string;
  readonly senderName: string;
  readonly reactionLabel: string;
  readonly status: string;
  readonly createdLabel: string;
}

export interface CheckersTeacherGameRow {
  readonly id: string;
  readonly playersLabel: string;
  readonly modeLabel: string;
  readonly statusLabel: string;
  readonly moveCount: number;
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
  readonly safetySignals: readonly CheckersTeacherSafetySignal[];
  readonly games: readonly CheckersTeacherGameRow[];
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
  onCreateEvent,
  onEnrolStudent,
  onRefresh,
  onOpenAssignment,
  onOpenStudent,
  onOpenGame,
}: {
  model: CheckersTeacherDashboardViewModel;
  onBack: () => void;
  onCreateAssignment: () => void;
  onCreateEvent: () => void;
  onEnrolStudent: () => void;
  onRefresh: () => void;
  onOpenAssignment: (id: string) => void;
  onOpenStudent: (id: string) => void;
  onOpenGame: (id: string) => void;
}): JSX.Element {
  return (
    <>
      <EditorHeader
        moduleId="checkers"
        onExit={onBack}
        exitLabel="Вернуться к списку классов"
        title={{ kind: 'readonly', text: model.classroomTitle }}
        status={{ kind: 'saved', label: 'Данные класса актуальны', icon: '✓' }}
        navigation={{
          ariaLabel: 'Разделы кабинета педагога',
          items: [
            {
              id: 'assignments',
              label: 'Задания',
              onActivate: () =>
                document.getElementById('teacher-assignments-title')?.scrollIntoView(),
            },
            {
              id: 'students',
              label: 'Ученики',
              onActivate: () => document.getElementById('teacher-mastery-title')?.scrollIntoView(),
            },
          ],
        }}
        actions={[
          {
            id: 'create-assignment',
            label: 'Новое задание',
            emphasis: 'primary',
            onActivate: onCreateAssignment,
          },
        ]}
      />
      <main className="checkers-teacher" id="main-content" tabIndex={-1}>
        <header className="checkers-teacher-heading">
          <div>
            <span className="checkers-kicker">ASA Шашки · педагог</span>
            <h1>{model.classroomTitle}</h1>
            <p>Задания, активность и доказательства по каждому шашечному понятию.</p>
          </div>
          <div className="checkers-teacher-actions">
            <button type="button" className="checkers-link-button" onClick={onRefresh}>
              Обновить данные
            </button>
            <button type="button" className="checkers-link-button" onClick={onEnrolStudent}>
              Добавить ученика
            </button>
            <button
              type="button"
              className="checkers-link-button"
              disabled={model.studentCount < 2}
              onClick={onCreateEvent}
            >
              Создать матч класса
            </button>
          </div>
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

        <section className="checkers-teacher-section" aria-labelledby="teacher-games-title">
          <div className="checkers-section-heading">
            <div>
              <span className="checkers-home-eyebrow">Матчи класса</span>
              <h2 id="teacher-games-title">Партии и разбор</h2>
            </div>
            <p>Педагог видит точную историю ходов, но не вмешивается в активную партию.</p>
          </div>
          {model.games.length > 0 ? (
            <div className="checkers-assignment-table-wrap">
              <table className="checkers-teacher-table">
                <thead>
                  <tr>
                    <th>Участники</th>
                    <th>Режим</th>
                    <th>Статус</th>
                    <th>Ходов</th>
                    <th>Действие</th>
                  </tr>
                </thead>
                <tbody>
                  {model.games.map((game) => (
                    <tr key={game.id}>
                      <td>{game.playersLabel}</td>
                      <td>{game.modeLabel}</td>
                      <td>{game.statusLabel}</td>
                      <td>{game.moveCount}</td>
                      <td>
                        <button type="button" onClick={() => onOpenGame(game.id)}>
                          Открыть разбор
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="checkers-home-empty">
              <strong>Партий класса пока нет</strong>
              <span>Создайте матч педагога или дождитесь дружеского вызова учеников.</span>
            </div>
          )}
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
            <div className="checkers-concept-legend" aria-label="Обозначения учебных понятий">
              {model.concepts.map((concept) => (
                <span key={concept.id}>
                  <strong>{concept.shortLabel}</strong> {concept.fullLabel}
                </span>
              ))}
            </div>
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
                            className={`checkers-mastery-cell ${
                              mastery === 0 ? 'unstarted' : masteryBand(mastery)
                            }`}
                            title={
                              mastery === 0
                                ? `${concept.fullLabel}: ещё нет данных`
                                : `${concept.fullLabel}: ${mastery}%`
                            }
                            aria-label={`${student.displayName}, ${concept.fullLabel}: ${
                              mastery === 0 ? 'ещё нет данных' : `${mastery}%`
                            }`}
                          >
                            {mastery === 0 ? '—' : mastery}
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
                  <th>Точность</th>
                  <th>Подсказки</th>
                  <th>Тема ошибок</th>
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
                    <td>{student.accuracyLabel}</td>
                    <td>{student.hintUsageLabel}</td>
                    <td>{student.mistakeTheme}</td>
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

        <section className="checkers-teacher-section" aria-labelledby="teacher-safety-title">
          <div className="checkers-section-heading">
            <div>
              <span className="checkers-home-eyebrow">Без свободного текста</span>
              <h2 id="teacher-safety-title">Сигналы по реакциям</h2>
            </div>
            <p>Ученик передаёт только сам факт и готовую реакцию — собственного сообщения нет.</p>
          </div>
          {model.safetySignals.length > 0 ? (
            <div className="checkers-assignment-table-wrap">
              <table className="checkers-teacher-table">
                <thead>
                  <tr>
                    <th>Кто сообщил</th>
                    <th>Отправитель</th>
                    <th>Реакция</th>
                    <th>Время</th>
                    <th>Статус</th>
                  </tr>
                </thead>
                <tbody>
                  {model.safetySignals.map((signal) => (
                    <tr key={signal.id}>
                      <td>{signal.reporterName}</td>
                      <td>{signal.senderName}</td>
                      <td>{signal.reactionLabel}</td>
                      <td>{signal.createdLabel}</td>
                      <td>{signal.status === 'open' ? 'Нужно проверить' : 'Проверено'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="checkers-home-empty">
              <strong>Открытых сигналов нет</strong>
              <span>Все готовые реакции сохраняются в аудите и ограничены по частоте.</span>
            </div>
          )}
        </section>
      </main>
    </>
  );
}
