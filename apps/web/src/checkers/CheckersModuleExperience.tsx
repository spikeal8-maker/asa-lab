import * as CheckersDomain from '@asa-lab/checkers';
import type {
  CheckersAssignment,
  CheckersAssignmentKind,
  CheckersBotId,
  CheckersConceptId,
  CheckersDocument,
  CheckersPuzzle,
  CheckersPuzzleAttempt,
  CheckersReactionId,
} from '@asa-lab/checkers';
import { useEffect, useMemo, useState } from 'react';
import type { CheckersClassGame, CheckersTeacherFeedbackId, PublicUser } from '../api';
import { newClientId } from '../client-id';
import { CheckersClassPlay } from './CheckersClassPlay';
import { CheckersStudentHome, type CheckersHomeCard } from './CheckersStudentHome';
import { CheckersTeacherDashboard } from './CheckersTeacherDashboard';
import { CheckersWorkspace, type CheckersWorkspaceMove } from './CheckersWorkspace';
import {
  useCheckersProject,
  type CheckersClassroomOverview,
  type CreateCheckersAssignmentInput,
} from './use-checkers-project';
import './checkers.css';

const {
  CHECKERS_BOTS,
  CHECKERS_CONCEPT_IDS,
  CHECKERS_CURRICULUM,
  CHECKERS_REACTIONS,
  CHECKERS_STARTER_PUZZLES,
  analyzeCheckersGameReview,
  createCheckersPuzzleAttempt,
  generateLegalCheckersMoves,
  replayCheckersGame,
  requestCheckersPuzzleHint,
  submitCheckersPuzzleMove,
} = CheckersDomain;

interface CheckersModuleExperienceProps {
  projectId: string;
  onBack: () => void;
  user: PublicUser;
}

type CheckersSurface = 'home' | 'play' | 'learning' | 'bots' | 'review' | 'class' | 'teacher';

export function resolveCheckersLandingSurface(
  projectScope: 'personal' | 'classroom',
  canManageClassroom: boolean,
): 'home' | 'teacher' {
  return projectScope === 'classroom' && canManageClassroom ? 'teacher' : 'home';
}

const ASSIGNMENT_KINDS: readonly { value: CheckersAssignmentKind; label: string }[] = [
  { value: 'puzzle-set', label: 'Набор задач' },
  { value: 'lesson', label: 'Урок' },
  { value: 'position', label: 'Позиция' },
  { value: 'bot-milestone', label: 'Победа над ботом' },
  { value: 'game', label: 'Учебная партия' },
] as const;

const TEACHER_FEEDBACK_LABELS: Readonly<Record<CheckersTeacherFeedbackId, string>> = {
  'great-progress': 'Отличный прогресс — продолжай в том же темпе.',
  'retry-capture': 'Повтори обязательное взятие и попробуй задачу ещё раз.',
  'review-turning-point': 'Открой разбор партии и вернись к переломному ходу.',
  'ready-next': 'Ты готов к следующей теме учебного пути.',
};

function assignmentKindLabel(kind: CheckersAssignmentKind): string {
  return ASSIGNMENT_KINDS.find((item) => item.value === kind)?.label ?? 'Задание';
}

function formatDue(value: string | null): string {
  if (!value) return 'без срока';
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(
    new Date(value),
  );
}

function assignmentComplete(
  assignment: CheckersAssignment,
  student: CheckersClassroomOverview['students'][number],
): boolean {
  const starterPuzzleIds = new Set(CHECKERS_STARTER_PUZZLES.map((puzzle) => puzzle.id));
  return (
    student.evidence.filter(
      (item) =>
        (item.sourceId === assignment.targetRef ||
          (assignment.targetRef === 'puzzle-set:starter' && starterPuzzleIds.has(item.sourceId))) &&
        (item.outcome === 'correct' || item.outcome === 'demonstrated') &&
        item.score >= assignment.minimumScore,
    ).length >= assignment.requiredCompletions
  );
}

function assignmentTargetsStudent(
  assignment: CheckersAssignment,
  student: CheckersClassroomOverview['students'][number],
): boolean {
  return assignment.assigneeKind === 'class' || assignment.assigneeIds.includes(student.id);
}

export function buildCheckersTeacherModel(
  classroomTitle: string,
  assignments: readonly CheckersAssignment[],
  overview: CheckersClassroomOverview | null,
  now = Date.now(),
  classGames: readonly CheckersClassGame<CheckersDocument>[] = [],
) {
  const students = overview?.students ?? [];
  const weekAgo = now - 7 * 24 * 60 * 60 * 1_000;
  const studentRows = students.map((student) => {
    const masteryPercent = student.progress.length
      ? Math.round(
          student.progress.reduce((sum, item) => sum + item.mastery, 0) / student.progress.length,
        )
      : 0;
    const targeted = assignments.filter((assignment) =>
      assignmentTargetsStudent(assignment, student),
    );
    const completed = targeted.filter((assignment) =>
      assignmentComplete(assignment, student),
    ).length;
    const recent = student.evidence.slice(-3);
    const repeatedErrors =
      recent.length >= 2 &&
      recent.every((item) => item.outcome === 'incorrect' || item.outcome === 'needs-work');
    const inactive = !student.lastActivityAt || Date.parse(student.lastActivityAt) < weekAgo;
    const last = student.evidence.at(-1);
    const attempts = student.evidence.filter(
      (item) => item.kind === 'puzzle-attempt' || item.kind === 'game-demonstration',
    );
    const successfulAttempts = attempts.filter(
      (item) => item.outcome === 'correct' || item.outcome === 'demonstrated',
    );
    const hintedAttempts = attempts.filter((item) => item.hintLevel > 0);
    const mistakeCounts = new Map<CheckersConceptId, number>();
    for (const item of attempts.filter(
      (evidence) => evidence.outcome === 'incorrect' || evidence.outcome === 'needs-work',
    )) {
      mistakeCounts.set(item.conceptId, (mistakeCounts.get(item.conceptId) ?? 0) + 1);
    }
    const recurringMistake = [...mistakeCounts.entries()].sort(
      ([leftId, leftCount], [rightId, rightCount]) =>
        rightCount - leftCount || leftId.localeCompare(rightId),
    )[0];
    const lastMove = student.lastMove;
    const lastMoveNotation = lastMove
      ? lastMove.path.join(lastMove.capturedIds.length > 0 ? ':' : '-')
      : null;
    return {
      id: student.id,
      displayName: student.displayName,
      masteryPercent,
      activityLabel: student.lastActivityAt
        ? new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(
            new Date(student.lastActivityAt),
          )
        : 'ещё не открывал',
      assignmentProgress: `${completed} из ${targeted.length}`,
      signal: repeatedErrors
        ? ('repeated-error' as const)
        : inactive
          ? ('inactive' as const)
          : ('ok' as const),
      signalLabel: repeatedErrors
        ? 'повторяется ошибка'
        : inactive
          ? 'нет активности'
          : 'всё в порядке',
      accuracyLabel:
        attempts.length === 0
          ? 'нет попыток'
          : `${Math.round((successfulAttempts.length / attempts.length) * 100)}%`,
      hintUsageLabel:
        attempts.length === 0 ? 'нет попыток' : `${hintedAttempts.length} из ${attempts.length}`,
      mistakeTheme: recurringMistake
        ? (CHECKERS_CURRICULUM.find((unit) => unit.conceptIds.includes(recurringMistake[0]))
            ?.title ?? recurringMistake[0])
        : 'нет повторяющейся ошибки',
      lastEvidence: last
        ? `${last.sourceId}${lastMoveNotation ? ` · ход ${lastMoveNotation}` : ''} · ${last.score}% · подсказка ${last.hintLevel}`
        : 'пока нет доказательств',
    };
  });
  const completionSlots = assignments.reduce(
    (sum, assignment) =>
      sum + students.filter((student) => assignmentTargetsStudent(assignment, student)).length,
    0,
  );
  const completedSlots = assignments.reduce(
    (sum, assignment) =>
      sum +
      students.filter(
        (student) =>
          assignmentTargetsStudent(assignment, student) && assignmentComplete(assignment, student),
      ).length,
    0,
  );
  const concepts = CHECKERS_CONCEPT_IDS.slice(0, 6).map((conceptId, index) => ({
    id: conceptId,
    shortLabel: String(index + 1),
    fullLabel:
      CHECKERS_CURRICULUM.find((unit) => unit.conceptIds.includes(conceptId))?.title ?? conceptId,
  }));
  return {
    classroomTitle,
    studentCount: students.length,
    activeThisWeek: students.filter(
      (student) => student.lastActivityAt && Date.parse(student.lastActivityAt) >= weekAgo,
    ).length,
    assignmentCompletionPercent:
      completionSlots === 0 ? 0 : Math.round((completedSlots / completionSlots) * 100),
    needsAttention:
      studentRows.filter((student) => student.signal !== 'ok').length +
      (overview?.safetySignals.filter((signal) => signal.status === 'open').length ?? 0),
    assignments: assignments.map((assignment) => ({
      id: assignment.id,
      title: assignment.title,
      kindLabel: assignmentKindLabel(assignment.kind),
      dueLabel: formatDue(assignment.dueAt),
      completed: students.filter(
        (student) =>
          assignmentTargetsStudent(assignment, student) && assignmentComplete(assignment, student),
      ).length,
      assigned: students.filter((student) => assignmentTargetsStudent(assignment, student)).length,
      status:
        assignment.status === 'assigned'
          ? ('active' as const)
          : assignment.status === 'draft'
            ? ('draft' as const)
            : ('closed' as const),
    })),
    students: studentRows,
    concepts,
    masteryByStudent: Object.fromEntries(
      students.map((student) => [
        student.id,
        Object.fromEntries(student.progress.map((item) => [item.conceptId, item.mastery])),
      ]),
    ),
    safetySignals: (overview?.safetySignals ?? []).map((signal) => ({
      id: signal.id,
      reporterName: signal.reporterName,
      senderName: signal.senderName,
      reactionLabel:
        CHECKERS_REACTIONS[signal.reactionId as CheckersReactionId] ?? 'Готовая реакция',
      status: signal.status,
      createdLabel: new Intl.DateTimeFormat('ru-RU', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(signal.createdAt)),
    })),
    games: classGames.map((game) => ({
      id: game.id,
      playersLabel: `${game.lightPlayer.displayName} — ${game.darkPlayer.displayName}`,
      modeLabel:
        game.mode === 'teacher-event'
          ? 'Матч педагога'
          : game.mode === 'team'
            ? 'Командная цель'
            : 'Дружеская партия',
      statusLabel:
        game.status === 'finished'
          ? 'Завершена'
          : game.status === 'active'
            ? 'В процессе'
            : 'Ожидает ответа',
      moveCount: game.document.moveHistory.length,
    })),
  };
}

function AssignmentDialog({
  onClose,
  onCreate,
  classroomId,
  students,
}: {
  onClose: () => void;
  onCreate: (input: CreateCheckersAssignmentInput) => Promise<boolean>;
  classroomId: string;
  students: readonly { id: string; displayName: string }[];
}): JSX.Element {
  const [title, setTitle] = useState('Обязательное взятие');
  const [kind, setKind] = useState<CheckersAssignmentKind>('puzzle-set');
  const [targetRef, setTargetRef] = useState('puzzle-set:starter');
  const [dueDate, setDueDate] = useState('');
  const [hintsAllowed, setHintsAllowed] = useState(true);
  const [minimumScore, setMinimumScore] = useState(70);
  const [assignee, setAssignee] = useState('class');
  const [groupStudentIds, setGroupStudentIds] = useState<readonly string[]>([]);
  const [attemptLimit, setAttemptLimit] = useState('');
  const [requiredCompletions, setRequiredCompletions] = useState(1);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (kind === 'puzzle-set') setTargetRef('puzzle-set:starter');
    else if (kind === 'bot-milestone') setTargetRef(`bot:${CHECKERS_BOTS[0]!.id}`);
    else if (kind === 'game') setTargetRef('class-match');
    else setTargetRef(CHECKERS_STARTER_PUZZLES[0]!.id);
  }, [kind]);

  return (
    <div className="checkers-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="checkers-assignment-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="checkers-assignment-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span className="checkers-kicker">ASA Шашки · педагог</span>
            <h2 id="checkers-assignment-title">Новое задание</h2>
          </div>
          <button type="button" className="checkers-link-button" onClick={onClose}>
            Закрыть
          </button>
        </header>
        <label>
          Название
          <input value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label>
          Формат
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value as CheckersAssignmentKind)}
          >
            {ASSIGNMENT_KINDS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Учебный материал
          <select value={targetRef} onChange={(event) => setTargetRef(event.target.value)}>
            {kind === 'puzzle-set' ? (
              <option value="puzzle-set:starter">Стартовый набор ASA · все позиции</option>
            ) : null}
            {kind === 'lesson' || kind === 'position'
              ? CHECKERS_STARTER_PUZZLES.map((puzzle) => (
                  <option key={puzzle.id} value={puzzle.id}>
                    {kind === 'lesson' ? 'Урок' : 'Позиция'} · {puzzle.title}
                  </option>
                ))
              : null}
            {kind === 'bot-milestone'
              ? CHECKERS_BOTS.map((bot) => (
                  <option key={bot.id} value={`bot:${bot.id}`}>
                    Бот · {bot.displayName}
                  </option>
                ))
              : null}
            {kind === 'game' ? <option value="class-match">Матч внутри класса</option> : null}
          </select>
        </label>
        <label>
          Кому назначить
          <select value={assignee} onChange={(event) => setAssignee(event.target.value)}>
            <option value="class">Всему классу</option>
            <option value="group">Выбранной учебной группе</option>
            {students.map((student) => (
              <option key={student.id} value={`student:${student.id}`}>
                Только: {student.displayName}
              </option>
            ))}
          </select>
        </label>
        {assignee === 'group' ? (
          <fieldset className="checkers-group-picker">
            <legend>Состав учебной группы</legend>
            {students.map((student) => (
              <label key={student.id} className="checkers-checkbox-row">
                <input
                  type="checkbox"
                  checked={groupStudentIds.includes(student.id)}
                  onChange={(event) =>
                    setGroupStudentIds((current) =>
                      event.target.checked
                        ? [...current, student.id]
                        : current.filter((id) => id !== student.id),
                    )
                  }
                />
                {student.displayName}
              </label>
            ))}
          </fieldset>
        ) : null}
        <div className="checkers-dialog-grid">
          <label>
            Срок
            <input
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
            />
          </label>
          <label>
            Минимальный результат
            <input
              type="number"
              min={0}
              max={100}
              value={minimumScore}
              onChange={(event) => setMinimumScore(Number(event.target.value))}
            />
          </label>
          <label>
            Лимит попыток
            <input
              type="number"
              min={1}
              placeholder="без лимита"
              value={attemptLimit}
              onChange={(event) => setAttemptLimit(event.target.value)}
            />
          </label>
          <label>
            Сколько успешных решений
            <input
              type="number"
              min={1}
              max={10}
              value={requiredCompletions}
              onChange={(event) => setRequiredCompletions(Number(event.target.value))}
            />
          </label>
        </div>
        <label className="checkers-checkbox-row">
          <input
            type="checkbox"
            checked={hintsAllowed}
            onChange={(event) => setHintsAllowed(event.target.checked)}
          />
          Разрешить ступенчатые подсказки
        </label>
        <footer>
          <button type="button" className="checkers-link-button" onClick={onClose}>
            Отмена
          </button>
          <button
            type="button"
            className="checkers-primary-action"
            disabled={
              saving || !title.trim() || (assignee === 'group' && groupStudentIds.length === 0)
            }
            onClick={() => {
              setSaving(true);
              void onCreate({
                title,
                kind,
                targetRef,
                dueAt: dueDate ? new Date(`${dueDate}T20:59:00.000Z`).toISOString() : null,
                hintsAllowed,
                minimumScore,
                assigneeKind:
                  assignee === 'class' ? 'class' : assignee === 'group' ? 'group' : 'student',
                assigneeIds:
                  assignee === 'class'
                    ? [classroomId]
                    : assignee === 'group'
                      ? groupStudentIds
                      : [assignee.replace('student:', '')],
                attemptLimit: attemptLimit ? Number(attemptLimit) : null,
                requiredCompletions,
              }).then((created) => {
                setSaving(false);
                if (created) onClose();
              });
            }}
          >
            {saving ? 'Сохраняем…' : 'Назначить'}
          </button>
        </footer>
      </section>
    </div>
  );
}

function EnrolStudentDialog({
  onClose,
  onEnrol,
}: {
  onClose: () => void;
  onEnrol: (email: string) => Promise<boolean>;
}): JSX.Element {
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  return (
    <div className="checkers-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="checkers-assignment-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="checkers-enrol-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span className="checkers-kicker">ASA Шашки · класс</span>
            <h2 id="checkers-enrol-title">Добавить ученика</h2>
          </div>
          <button type="button" className="checkers-link-button" onClick={onClose}>
            Закрыть
          </button>
        </header>
        <p>Ученик сначала создаёт обычный аккаунт ASA Lab. Добавьте его по email.</p>
        <label>
          Email ученика
          <input
            type="email"
            autoComplete="off"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <footer>
          <button type="button" className="checkers-link-button" onClick={onClose}>
            Отмена
          </button>
          <button
            type="button"
            className="checkers-primary-action"
            disabled={saving || !email.includes('@')}
            onClick={() => {
              setSaving(true);
              void onEnrol(email).then((created) => {
                setSaving(false);
                if (created) onClose();
              });
            }}
          >
            {saving ? 'Добавляем…' : 'Добавить в класс'}
          </button>
        </footer>
      </section>
    </div>
  );
}

function TeacherFeedbackDialog({
  studentName,
  lastEvidence,
  onClose,
  onSend,
}: {
  studentName: string;
  lastEvidence: string;
  onClose: () => void;
  onSend: (feedbackId: CheckersTeacherFeedbackId) => Promise<boolean>;
}): JSX.Element {
  const [feedbackId, setFeedbackId] = useState<CheckersTeacherFeedbackId>('great-progress');
  const [saving, setSaving] = useState(false);
  return (
    <div className="checkers-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="checkers-assignment-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="checkers-feedback-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span className="checkers-kicker">Доказательство → помощь</span>
            <h2 id="checkers-feedback-dialog-title">Рекомендация для {studentName}</h2>
          </div>
          <button type="button" className="checkers-link-button" onClick={onClose}>
            Закрыть
          </button>
        </header>
        <p>
          Последнее доказательство: <strong>{lastEvidence}</strong>
        </p>
        <label>
          Готовая педагогическая рекомендация
          <select
            value={feedbackId}
            onChange={(event) => setFeedbackId(event.target.value as CheckersTeacherFeedbackId)}
          >
            {Object.entries(TEACHER_FEEDBACK_LABELS).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <p>Свободного общения между детьми это не открывает.</p>
        <footer>
          <button type="button" className="checkers-link-button" onClick={onClose}>
            Отмена
          </button>
          <button
            type="button"
            className="checkers-primary-action"
            disabled={saving}
            onClick={() => {
              setSaving(true);
              void onSend(feedbackId).then((sent) => {
                setSaving(false);
                if (sent) onClose();
              });
            }}
          >
            {saving ? 'Отправляем…' : 'Отправить рекомендацию'}
          </button>
        </footer>
      </section>
    </div>
  );
}

function TeacherEventDialog({
  students,
  onClose,
  onCreate,
}: {
  students: readonly { id: string; displayName: string }[];
  onClose: () => void;
  onCreate: (lightPlayerId: string, darkPlayerId: string) => Promise<boolean>;
}): JSX.Element {
  const [lightPlayerId, setLightPlayerId] = useState(students[0]?.id ?? '');
  const [darkPlayerId, setDarkPlayerId] = useState(students[1]?.id ?? '');
  const [saving, setSaving] = useState(false);
  return (
    <div className="checkers-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="checkers-assignment-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="checkers-event-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span className="checkers-kicker">ASA Шашки · событие класса</span>
            <h2 id="checkers-event-title">Новый матч педагога</h2>
          </div>
          <button type="button" className="checkers-link-button" onClick={onClose}>
            Закрыть
          </button>
        </header>
        <p>
          Матч появится только у выбранных учеников этого класса и сразу будет готов к игре.
          Свободного чата в нём нет.
        </p>
        <label>
          Светлые
          <select value={lightPlayerId} onChange={(event) => setLightPlayerId(event.target.value)}>
            {students.map((student) => (
              <option key={student.id} value={student.id}>
                {student.displayName}
              </option>
            ))}
          </select>
        </label>
        <label>
          Тёмные
          <select value={darkPlayerId} onChange={(event) => setDarkPlayerId(event.target.value)}>
            {students.map((student) => (
              <option key={student.id} value={student.id}>
                {student.displayName}
              </option>
            ))}
          </select>
        </label>
        <footer>
          <button type="button" className="checkers-link-button" onClick={onClose}>
            Отмена
          </button>
          <button
            type="button"
            className="checkers-primary-action"
            disabled={saving || !lightPlayerId || !darkPlayerId || lightPlayerId === darkPlayerId}
            onClick={() => {
              setSaving(true);
              void onCreate(lightPlayerId, darkPlayerId).then((created) => {
                setSaving(false);
                if (created) onClose();
              });
            }}
          >
            {saving ? 'Создаём…' : 'Создать матч'}
          </button>
        </footer>
      </section>
    </div>
  );
}

export function CheckersModuleExperience(props: CheckersModuleExperienceProps): JSX.Element {
  const checkers = useCheckersProject(props.projectId, props.user);
  const [surface, setSurface] = useState<CheckersSurface>('home');
  const [activePuzzle, setActivePuzzle] = useState<CheckersPuzzle | null>(null);
  const [attempt, setAttempt] = useState<CheckersPuzzleAttempt | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [assignmentDialog, setAssignmentDialog] = useState(false);
  const [eventDialog, setEventDialog] = useState(false);
  const [enrolDialog, setEnrolDialog] = useState(false);
  const [feedbackStudentId, setFeedbackStudentId] = useState<string | null>(null);
  const [activeClassGameId, setActiveClassGameId] = useState<string | null>(null);
  const [reviewPly, setReviewPly] = useState(0);

  useEffect(() => {
    if (checkers.project?.scope !== 'classroom') return;
    setSurface(resolveCheckersLandingSurface(checkers.project.scope, checkers.canManageClassroom));
  }, [checkers.canManageClassroom, checkers.project?.scope]);

  useEffect(() => {
    if (surface !== 'class' || checkers.project?.scope !== 'classroom') return;
    const timer = window.setInterval(() => void checkers.refreshClassPlay(), 2_500);
    return () => window.clearInterval(timer);
  }, [checkers.project?.scope, checkers.refreshClassPlay, surface]);

  const mastery = useMemo(() => {
    const progress = checkers.document?.education.progress ?? [];
    return progress.length === 0
      ? 0
      : Math.round(progress.reduce((sum, item) => sum + item.mastery, 0) / progress.length);
  }, [checkers.document]);

  if (checkers.loadState === 'loading') {
    return (
      <main className="checkers-loading" role="status" aria-live="polite">
        <span className="checkers-kicker">ASA Шашки</span>
        <h1>Загружаем партию и учебный прогресс…</h1>
      </main>
    );
  }
  if (checkers.loadState === 'error' || !checkers.document || !checkers.project) {
    return (
      <main className="checkers-loading" role="alert">
        <span className="checkers-kicker">ASA Шашки</span>
        <h1>Проект не открыт</h1>
        <p>{checkers.notice}</p>
        <div>
          <button
            type="button"
            className="checkers-primary-action"
            onClick={() => void checkers.reload()}
          >
            Повторить
          </button>
          <button type="button" className="checkers-link-button" onClick={props.onBack}>
            К проектам
          </button>
        </div>
      </main>
    );
  }

  const document = checkers.document;
  const project = checkers.project;
  const selectedBot = CHECKERS_BOTS.find((bot) => bot.id === document.education.selectedBotId)!;
  const activeClassGame = checkers.classPlay?.games.find((game) => game.id === activeClassGameId);
  const sourceGame = activeClassGame?.document ?? document.game;
  const isReview = surface === 'review' || activeClassGame?.status === 'finished';
  const replayed = isReview ? replayCheckersGame(sourceGame, reviewPly) : null;
  const workspaceGame = replayed?.ok ? replayed.value : sourceGame;
  const workspaceLegalMoves = isReview
    ? []
    : activeClassGame
      ? activeClassGame.side === sourceGame.sideToMove
        ? generateLegalCheckersMoves(sourceGame)
        : []
      : checkers.legalMoves;
  const reviewInsights = analyzeCheckersGameReview(sourceGame);

  const startPuzzle = (puzzle: CheckersPuzzle): void => {
    const limitedAssignment = document.education.assignments.find(
      (assignment) =>
        (assignment.targetRef === puzzle.id || assignment.targetRef === 'puzzle-set:starter') &&
        assignment.attemptLimit !== null,
    );
    const usedAttempts = document.education.evidence.filter(
      (item) => item.sourceId === puzzle.id && item.kind === 'puzzle-attempt',
    ).length;
    if (
      limitedAssignment?.attemptLimit !== null &&
      limitedAssignment?.attemptLimit !== undefined &&
      usedAttempts >= limitedAssignment.attemptLimit
    ) {
      checkers.setNotice(
        `Лимит попыток по заданию исчерпан (${usedAttempts} из ${limitedAssignment.attemptLimit}). Педагог видит результат и может изменить условие.`,
      );
      return;
    }
    const created = createCheckersPuzzleAttempt(puzzle, `attempt-${newClientId()}`, props.user.id);
    if (!created.ok) {
      checkers.setNotice(created.message);
      return;
    }
    setActivePuzzle(puzzle);
    setAttempt(created.value);
    setHint(null);
    checkers.openLesson(created.value.document, puzzle.title);
    setSurface('learning');
  };

  const openAssignedWork = (assignmentId: string): void => {
    const assignment = document.education.assignments.find((item) => item.id === assignmentId);
    if (!assignment) {
      setSurface('learning');
      return;
    }
    if (assignment.kind === 'bot-milestone' && assignment.targetRef.startsWith('bot:')) {
      const botId = assignment.targetRef.slice(4) as CheckersBotId;
      if (checkers.startBotGame(botId, true)) setSurface('play');
      return;
    }
    if (assignment.kind === 'game') {
      void checkers.refreshClassPlay();
      setSurface('class');
      return;
    }
    const puzzle = CHECKERS_STARTER_PUZZLES.find((item) => item.id === assignment.targetRef);
    if (puzzle) {
      startPuzzle(puzzle);
      return;
    }
    setSurface('learning');
  };

  const playWorkspaceMove = (move: CheckersWorkspaceMove): void => {
    if (activeClassGame && !activePuzzle) {
      const legal = workspaceLegalMoves.find(
        (candidate) => candidate.pieceId === move.pieceId && candidate.notation === move.notation,
      );
      if (legal) {
        void checkers.playClassMove(activeClassGame.id, activeClassGame.version, legal);
      }
      return;
    }
    if (!activePuzzle || !attempt) {
      const legal = checkers.legalMoves.find(
        (candidate) => candidate.pieceId === move.pieceId && candidate.notation === move.notation,
      );
      if (legal) checkers.playMove(legal);
      return;
    }
    const outcome = submitCheckersPuzzleMove(activePuzzle, attempt, {
      pieceId: move.pieceId,
      path: move.path,
    });
    if (!outcome.ok) {
      checkers.setNotice(outcome.message);
      return;
    }
    setAttempt(outcome.value.attempt);
    if (outcome.value.feedback === 'illegal') {
      checkers.setNotice('Этот ход не разрешён правилами русских шашек.');
      return;
    }
    if (outcome.value.feedback === 'incorrect') {
      checkers.recordPuzzleFailure(outcome.value.attempt, outcome.value.conceptIds);
      checkers.setNotice('Ход допустим, но не решает задачу. Попробуй ещё раз.');
      return;
    }
    checkers.openLesson(outcome.value.attempt.document, activePuzzle.title);
    if (outcome.value.feedback === 'solved') {
      checkers.completePuzzle(outcome.value.attempt, outcome.value.conceptIds);
    } else {
      checkers.setNotice('Верно. Продолжи обязательную последовательность.');
    }
  };

  const workspace = (
    <CheckersWorkspace
      model={{
        projectTitle: checkers.projectTitle,
        saveState: checkers.saveStatus,
        userName: props.user.displayName,
        mode: activePuzzle ? 'learn' : isReview ? 'review' : 'play',
        modeLabel: activePuzzle
          ? `Задача · ${activePuzzle.title}`
          : activeClassGame
            ? `${
                activeClassGame.mode === 'team'
                  ? 'Командная цель'
                  : activeClassGame.mode === 'teacher-event'
                    ? 'Матч педагога'
                    : 'Игра класса'
              } · ${activeClassGame.status === 'finished' ? 'завершена' : 'в процессе'}`
            : `Игра с ботом · ${selectedBot.displayName}`,
        opponentLabel: activeClassGame
          ? activeClassGame.side === 'light'
            ? activeClassGame.darkPlayer.displayName
            : activeClassGame.lightPlayer.displayName
          : checkers.botThinking
            ? `${selectedBot.displayName} думает…`
            : selectedBot.displayName,
        sideToMove: workspaceGame.sideToMove,
        pieces: workspaceGame.pieces,
        legalMoves: workspaceLegalMoves,
        moveHistory: sourceGame.moveHistory.map((move) => ({
          ply: move.ply,
          notation: move.path.join(move.capturedIds.length > 0 ? ':' : '-'),
        })),
        instructionTitle:
          activePuzzle?.title ??
          (activeClassGame ? 'Партия с одноклассником' : 'Сыграй полноценную партию'),
        instruction:
          activePuzzle?.instruction ??
          (activeClassGame
            ? 'Ходы сохраняются на сервере. Доступны только участники этого класса и готовые реакции.'
            : 'Выбирай шашку и подсвеченное поле. Если взятие возможно, система разрешит только взятие.'),
        ...(hint ? { hintText: hint } : {}),
        reactionsEnabled: activeClassGame
          ? !(checkers.classPlay?.muted ?? false)
          : document.education.reactionsEnabled,
        ...(activeClassGame ? { reactionEvents: activeClassGame.reactions } : {}),
        ...(isReview
          ? {
              reviewInsights,
              reviewPly,
              reviewTotalPly: sourceGame.moveHistory.length,
            }
          : {}),
        readOnly:
          isReview ||
          Boolean(
            activeClassGame &&
            (activeClassGame.status !== 'active' || activeClassGame.side !== sourceGame.sideToMove),
          ),
      }}
      onBack={() => {
        if (activeClassGame) {
          setActiveClassGameId(null);
          setSurface(checkers.canManageClassroom ? 'teacher' : 'class');
          return;
        }
        setActivePuzzle(null);
        setAttempt(null);
        setHint(null);
        setSurface(resolveCheckersLandingSurface(project.scope, checkers.canManageClassroom));
      }}
      onRename={(title) => void checkers.renameProject(title)}
      onModeChange={(mode) => {
        if (activeClassGame) {
          if (mode === 'review') {
            setReviewPly(sourceGame.moveHistory.length);
          }
          return;
        }
        setActivePuzzle(null);
        setAttempt(null);
        if (mode === 'learn') setSurface('learning');
        else if (mode === 'review') {
          setReviewPly(document.game.moveHistory.length);
          setSurface('review');
        } else setSurface('play');
      }}
      onMove={playWorkspaceMove}
      {...(activePuzzle && attempt
        ? {
            onHint: () => {
              const result = requestCheckersPuzzleHint(activePuzzle, attempt);
              if (!result.ok) return;
              setAttempt(result.value.attempt);
              setHint(result.value.hint);
            },
          }
        : {})}
      onReaction={(reactionId) => {
        if (activeClassGame) {
          void checkers.sendClassReaction(activeClassGame.id, reactionId);
          return;
        }
        checkers.setNotice(
          `Реакция «${CHECKERS_REACTIONS[reactionId as CheckersReactionId]}» доступна только в игре класса.`,
        );
      }}
      onToggleReactions={() => {
        if (activeClassGame) {
          void checkers.setClassReactionsMuted(!(checkers.classPlay?.muted ?? false));
        } else {
          checkers.toggleReactions();
        }
      }}
      onReviewStep={setReviewPly}
      {...(activeClassGame
        ? {
            onReportReaction: (eventId: string) =>
              void checkers.reportClassReaction(activeClassGame.id, eventId),
          }
        : {})}
    />
  );

  let content: JSX.Element;
  if (
    surface === 'play' ||
    (surface === 'learning' && activePuzzle) ||
    surface === 'review' ||
    (surface === 'class' && activeClassGame)
  ) {
    content = workspace;
  } else if (surface === 'class') {
    content = (
      <CheckersClassPlay
        model={checkers.classPlay ?? { role: 'student', muted: false, classmates: [], games: [] }}
        onBack={() => setSurface('home')}
        onChallenge={checkers.createClassChallenge}
        onAccept={checkers.acceptClassChallenge}
        onOpenGame={(gameId) => {
          const game = checkers.classPlay?.games.find((item) => item.id === gameId);
          setReviewPly(game?.status === 'finished' ? game.document.moveHistory.length : 0);
          setActiveClassGameId(gameId);
        }}
      />
    );
  } else if (surface === 'bots') {
    content = (
      <main className="checkers-learning-shell" id="main-content" tabIndex={-1}>
        <header className="checkers-surface-heading">
          <div>
            <button
              type="button"
              className="checkers-link-button"
              onClick={() => setSurface('home')}
            >
              ← На главную шашек
            </button>
            <span className="checkers-kicker">Лестница ASA Bot</span>
            <h1>Шесть соперников — от первого хода до мастера</h1>
            <p>Следующий уровень открывается после двух побед и доказанного решения задач.</p>
          </div>
        </header>
        <section className="checkers-bot-grid" aria-label="Соперники ASA Bot">
          {CHECKERS_BOTS.map((bot) => {
            const locked = bot.rung > document.education.unlockedBotRung;
            return (
              <article key={bot.id} className={`checkers-bot-card${locked ? ' locked' : ''}`}>
                <span className="checkers-bot-rung">Уровень {bot.rung}</span>
                <div className="checkers-bot-token" aria-hidden="true">
                  {bot.rung}
                </div>
                <h2>{bot.displayName}</h2>
                <p>{bot.description}</p>
                <small>
                  Поиск: глубина {bot.searchDepth} · до{' '}
                  {bot.defaultNodeBudget.toLocaleString('ru-RU')} узлов
                </small>
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => {
                    if (checkers.startBotGame(bot.id as CheckersBotId)) setSurface('play');
                  }}
                >
                  {locked ? 'Сначала предыдущий уровень' : 'Начать партию'}
                </button>
              </article>
            );
          })}
        </section>
      </main>
    );
  } else if (surface === 'learning') {
    content = (
      <main className="checkers-learning-shell" id="main-content" tabIndex={-1}>
        <header className="checkers-surface-heading">
          <div>
            <button
              type="button"
              className="checkers-link-button"
              onClick={() => setSurface('home')}
            >
              ← На главную шашек
            </button>
            <span className="checkers-kicker">Самообучение</span>
            <h1>Путь русских шашек</h1>
            <p>
              11 последовательных тем и позиции, проверяемые тем же движком, что и обычная партия.
            </p>
          </div>
          <strong>
            {document.education.completedPuzzleIds.length} / {CHECKERS_STARTER_PUZZLES.length} задач
          </strong>
        </header>
        <section className="checkers-curriculum-strip" aria-label="Учебная программа">
          {CHECKERS_CURRICULUM.map((unit) => (
            <article key={unit.id}>
              <span>{unit.order}</span>
              <strong>{unit.title}</strong>
            </article>
          ))}
        </section>
        <section className="checkers-puzzle-grid" aria-labelledby="checkers-puzzles-title">
          <div className="checkers-section-heading">
            <div>
              <span className="checkers-home-eyebrow">Практика</span>
              <h2 id="checkers-puzzles-title">Стартовые задачи ASA</h2>
            </div>
          </div>
          <div className="checkers-home-grid">
            {CHECKERS_STARTER_PUZZLES.map((puzzle, index) => {
              const complete = document.education.completedPuzzleIds.includes(puzzle.id);
              return (
                <article className="checkers-home-card" key={puzzle.id}>
                  <span className="checkers-home-eyebrow">Задача {index + 1}</span>
                  <h3>{puzzle.title}</h3>
                  <p>{puzzle.instruction}</p>
                  <small>Объяснение → пример → ваш ход → обратная связь движка</small>
                  <small>{complete ? '✓ Доказательство сохранено' : '5 ступеней подсказки'}</small>
                  <button type="button" onClick={() => startPuzzle(puzzle)}>
                    {complete ? 'Решить ещё раз' : 'Начать'}
                  </button>
                </article>
              );
            })}
          </div>
        </section>
      </main>
    );
  } else if (surface === 'teacher') {
    const teacherModel = buildCheckersTeacherModel(
      checkers.project.title,
      document.education.assignments,
      checkers.classroomOverview,
      Date.now(),
      checkers.classPlay?.games ?? [],
    );
    content = (
      <CheckersTeacherDashboard
        model={teacherModel}
        onBack={props.onBack}
        onCreateAssignment={() => setAssignmentDialog(true)}
        onCreateEvent={() => setEventDialog(true)}
        onEnrolStudent={() => setEnrolDialog(true)}
        onRefresh={() => void checkers.refreshClassroomOverview()}
        onOpenAssignment={(id) =>
          checkers.setNotice(`Задание ${id} хранится в черновике проекта класса.`)
        }
        onOpenStudent={setFeedbackStudentId}
        onOpenGame={(gameId) => {
          const game = checkers.classPlay?.games.find((item) => item.id === gameId);
          setReviewPly(game?.document.moveHistory.length ?? 0);
          setActiveClassGameId(gameId);
          setSurface('review');
        }}
      />
    );
  } else {
    const assignmentCards: CheckersHomeCard[] = document.education.assignments.map(
      (assignment) => ({
        id: assignment.id,
        eyebrow: 'От педагога',
        title: assignment.title,
        description: `${assignmentKindLabel(assignment.kind)} · ${formatDue(assignment.dueAt)}`,
        actionLabel: 'Открыть',
      }),
    );
    content = (
      <CheckersStudentHome
        projectTitle={checkers.projectTitle}
        onBack={props.onBack}
        model={{
          studentName: props.user.displayName,
          recommendation: {
            id: assignmentCards[0]?.id ?? 'learning-path',
            eyebrow: assignmentCards.length > 0 ? 'Сначала это' : 'Следующий шаг',
            title: assignmentCards[0]?.title ?? 'Обязательное взятие',
            description:
              assignmentCards[0]?.description ??
              'Короткая позиция научит видеть главное правило партии.',
            progressLabel: `${document.education.completedPuzzleIds.length} из ${CHECKERS_STARTER_PUZZLES.length} задач`,
            progressPercent: Math.round(
              (document.education.completedPuzzleIds.length / CHECKERS_STARTER_PUZZLES.length) *
                100,
            ),
            actionLabel: 'Продолжить',
          },
          assignments: assignmentCards,
          reviewCount: document.education.progress.filter(
            (item) => item.nextReviewAt && Date.parse(item.nextReviewAt) <= Date.now(),
          ).length,
          learningUnit: Math.min(11, document.education.completedPuzzleIds.length + 1),
          learningUnitsTotal: 11,
          masteryPercent: mastery,
          currentBotName: selectedBot.displayName,
          botRung: document.education.unlockedBotRung,
          botRungsTotal: CHECKERS_BOTS.length,
          classPlayAvailable: checkers.project.scope === 'classroom',
          ...(checkers.teacherFeedback[0]
            ? {
                teacherFeedback: TEACHER_FEEDBACK_LABELS[checkers.teacherFeedback[0].feedbackId],
              }
            : {}),
        }}
        onOpen={(id) => {
          if (id === 'bot-ladder') setSurface('bots');
          else if (id === 'class-play') {
            void checkers.refreshClassPlay();
            setSurface('class');
          } else if (id === 'review-queue') {
            const dueConcept = document.education.progress.find(
              (item) => item.nextReviewAt && Date.parse(item.nextReviewAt) <= Date.now(),
            )?.conceptId;
            const reviewPuzzle = dueConcept
              ? CHECKERS_STARTER_PUZZLES.find((puzzle) => puzzle.conceptIds.includes(dueConcept))
              : null;
            if (reviewPuzzle) startPuzzle(reviewPuzzle);
            else {
              checkers.setNotice(
                'На сегодня обязательных повторений нет. Можно продолжить учебный путь.',
              );
              setSurface('learning');
            }
          } else if (document.education.assignments.some((assignment) => assignment.id === id)) {
            openAssignedWork(id);
          } else setSurface('learning');
        }}
      />
    );
  }

  return (
    <div className="checkers-experience">
      {checkers.notice ? (
        <div className="checkers-global-notice" role="status" aria-live="polite">
          <span>{checkers.notice}</span>
          <button
            type="button"
            onClick={() => checkers.setNotice(null)}
            aria-label="Закрыть сообщение"
          >
            ×
          </button>
        </div>
      ) : null}
      {content}
      {assignmentDialog ? (
        <AssignmentDialog
          onClose={() => setAssignmentDialog(false)}
          onCreate={checkers.createAssignment}
          classroomId={checkers.project.classroomId ?? ''}
          students={checkers.classroomOverview?.students ?? []}
        />
      ) : null}
      {enrolDialog ? (
        <EnrolStudentDialog onClose={() => setEnrolDialog(false)} onEnrol={checkers.enrolStudent} />
      ) : null}
      {eventDialog ? (
        <TeacherEventDialog
          students={checkers.classroomOverview?.students ?? []}
          onClose={() => setEventDialog(false)}
          onCreate={checkers.createTeacherEvent}
        />
      ) : null}
      {feedbackStudentId ? (
        <TeacherFeedbackDialog
          studentName={
            checkers.classroomOverview?.students.find((item) => item.id === feedbackStudentId)
              ?.displayName ?? 'ученика'
          }
          lastEvidence={(() => {
            const student = checkers.classroomOverview?.students.find(
              (item) => item.id === feedbackStudentId,
            );
            const last = student?.evidence.at(-1);
            const lastMove = student?.lastMove;
            const notation = lastMove
              ? lastMove.path.join(lastMove.capturedIds.length > 0 ? ':' : '-')
              : null;
            return last
              ? `${last.sourceId}${notation ? `, ход ${notation}` : ''}, ${last.score}%, подсказка ${last.hintLevel}`
              : 'пока нет';
          })()}
          onClose={() => setFeedbackStudentId(null)}
          onSend={(feedbackId) => checkers.sendTeacherFeedback(feedbackStudentId, feedbackId)}
        />
      ) : null}
    </div>
  );
}
