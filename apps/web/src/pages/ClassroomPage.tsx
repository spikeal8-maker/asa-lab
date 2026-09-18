import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  api,
  type Classroom,
  type ClassroomStudentSeat,
  type ClassroomTeacher,
  type ClassroomActivityEntry,
  type ClassroomTeacherInvitation,
  type ClassroomSeatBatchCommitResult,
  type ClassroomSeatBatchPreviewRow,
  type ClassroomSeatBatchStudentInput,
} from '../api';
import { ClassesIcon, PlusIcon } from '../electronics/workbench-icons';
import { ClassroomActivityList } from '../components/ClassroomActivityList';
import { ClassroomLearning } from '../components/ClassroomLearning';
import {
  LearningNotificationPreferences,
  ClassroomLearningReminders,
} from '../components/LearningNotificationPreferences';
import { useLearningDestination } from '../learning/use-learning-destination';
import { ClassroomGradebook } from '../components/ClassroomGradebook';
import { ClassroomStudentPage } from './ClassroomStudentPage';
import { ClassShareScreen } from '../components/ClassShareScreen';
import { Dropdown } from '../components/Dropdown';
import { learnerCount } from '../plural';
import { SeatAvatarPicker } from '../components/SeatAvatarPicker';
import { SeatAwardRow } from '../components/SeatAwards';
import { useSchoolTime } from '../components/school-time';
import { defaultAvatarForAccount, seatAvatar } from '../creator-portal/default-avatars';
import { StudentAccessCards } from '../components/StudentAccessCards';
import { StudentCodeDialog } from '../components/StudentCodeDialog';

type ClassroomTab =
  'students' | 'activities' | 'gradebook' | 'projects' | 'moderation' | 'teachers';
type PageState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; classroom: Classroom; students: ClassroomStudentSeat[] };
type TeacherTeamState =
  | { kind: 'idle' | 'loading' }
  | { kind: 'error'; message: string }
  | {
      kind: 'ready';
      teachers: ClassroomTeacher[];
      invitations: ClassroomTeacherInvitation[];
    };

const TABS: ReadonlyArray<{ id: ClassroomTab; label: string }> = [
  { id: 'students', label: 'Учащиеся' },
  { id: 'activities', label: 'Обучение' },
  { id: 'gradebook', label: 'Журнал' },
  { id: 'projects', label: 'Проекты' },
  { id: 'moderation', label: 'История' },
  { id: 'teachers', label: 'Коллеги-преподаватели' },
];

/** 1 ученик, 2 ученика, 5 учеников — a class page that says "1 учеников" reads
 * as a machine, and this one is read by teachers every day. */
function StudentDialog({
  student,
  onClose,
  onSaved,
}: {
  student: ClassroomStudentSeat | null;
  onClose: () => void;
  onSaved: (input: {
    displayLabel: string;
    safeMode: boolean;
    avatarKey: string | null;
  }) => Promise<string | null>;
}): JSX.Element {
  const [displayLabel, setDisplayLabel] = useState(student?.displayLabel ?? '');
  const [safeMode, setSafeMode] = useState(student?.safeMode ?? true);
  const [avatarKey, setAvatarKey] = useState<string | null>(student?.avatarKey ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const label = displayLabel.trim();
    if (!label) {
      setError('Введите имя ученика для списка класса.');
      return;
    }
    setBusy(true);
    const message = await onSaved({ displayLabel: label, safeMode, avatarKey });
    setBusy(false);
    if (message) setError(message);
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal classroom-student-dialog" role="dialog" aria-modal="true">
        <h2>{student ? 'Настройки ученика' : 'Добавить ученика'}</h2>
        <p>
          Здесь хранится имя для журнала. Короткий код ученика создаётся отдельно и не зависит от
          имени.
        </p>
        <form onSubmit={(event) => void submit(event)}>
          <label htmlFor="seat-display-label">Имя в списке класса</label>
          <input
            id="seat-display-label"
            autoFocus
            maxLength={120}
            value={displayLabel}
            disabled={busy}
            placeholder="Алина К."
            onChange={(event) => setDisplayLabel(event.target.value)}
          />
          {student ? (
            <>
              <span className="classroom-seat-avatar-label">Аватар</span>
              <SeatAvatarPicker
                seatId={student.id}
                value={avatarKey}
                busy={busy}
                onChange={setAvatarKey}
              />
            </>
          ) : null}
          <label className="classroom-safe-mode-field">
            <input
              type="checkbox"
              checked={safeMode}
              disabled={busy}
              onChange={(event) => setSafeMode(event.target.checked)}
            />
            <span>
              <strong>Безопасный режим</strong>
              <small>Публичная публикация и открытый профиль недоступны.</small>
            </span>
          </label>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="modal-actions">
            <button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>
              Отмена
            </button>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? 'Сохраняем…' : student ? 'Сохранить' : 'Добавить'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function BatchDialog({
  classroomId,
  onClose,
  onCommitted,
  onOpenCards,
}: {
  classroomId: string;
  onClose: () => void;
  onCommitted: (created: number) => Promise<void>;
  onOpenCards: (seatIds: string[]) => void;
}): JSX.Element {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<'preview' | 'commit' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ClassroomSeatBatchPreviewRow[] | null>(null);
  const [committed, setCommitted] = useState<ClassroomSeatBatchCommitResult | null>(null);
  const requestId = useRef<string | null>(null);
  const students = useMemo<ClassroomSeatBatchStudentInput[]>(
    () =>
      text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((displayLabel) => ({ displayLabel, safeMode: true })),
    [text],
  );
  const counts = useMemo(
    () => ({
      valid: preview?.filter((row) => row.status === 'valid').length ?? 0,
      duplicate: preview?.filter((row) => row.status === 'duplicate').length ?? 0,
      conflict: preview?.filter((row) => row.status === 'conflict').length ?? 0,
      invalid: preview?.filter((row) => row.status === 'invalid').length ?? 0,
    }),
    [preview],
  );
  const createdRows =
    committed?.results.filter((row) => row.status === 'created' && row.seatId) ?? [];

  function resetPreview(nextText: string): void {
    setText(nextText);
    setPreview(null);
    setCommitted(null);
    requestId.current = null;
    setError(null);
  }

  async function previewList(): Promise<void> {
    if (students.length === 0) {
      setError('Добавьте хотя бы одного ученика.');
      return;
    }
    if (students.length > 100) {
      setError('Не более 100 учеников за один раз.');
      return;
    }
    if (!requestId.current) requestId.current = crypto.randomUUID();
    setBusy('preview');
    setError(null);
    const result = await api.previewClassroomSeatsBatch(classroomId, students, requestId.current);
    setBusy(null);
    if (!result.ok) {
      setError(result.error.message || 'Не удалось проверить список.');
      return;
    }
    setPreview(result.data.results);
  }

  async function commitList(): Promise<void> {
    if (!preview || !requestId.current) {
      setError('Проверьте список перед добавлением.');
      return;
    }
    if (counts.valid === 0) {
      setError('Сервер не подтвердил ни одной строки для создания.');
      return;
    }
    setBusy('commit');
    setError(null);
    const result = await api.addClassroomSeatsBatch(classroomId, students, requestId.current);
    setBusy(null);
    if (!result.ok) {
      setError(result.error.message || 'Не удалось добавить учеников.');
      return;
    }
    setCommitted(result.data);
    await onCommitted(result.data.created);
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal classroom-batch-dialog" role="dialog" aria-modal="true">
        <h2>Добавить список учеников</h2>
        {!committed ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void (preview ? commitList() : previewList());
            }}
          >
            <p>
              Один ученик на строку. Вставьте один столбец из таблицы — короткие коды учеников
              создаст сервер.
            </p>
            <label htmlFor="seat-batch">Ученики</label>
            <textarea
              id="seat-batch"
              autoFocus
              rows={8}
              value={text}
              disabled={busy !== null}
              placeholder={'Алина К.\\nМаксим П.\\nСофия М.'}
              onChange={(event) => resetPreview(event.target.value)}
            />
            {students.length > 100 ? (
              <p className="form-error" role="alert">
                Не более 100 учеников за один раз.
              </p>
            ) : null}
            {preview ? (
              <div className="classroom-batch-preview" aria-label="Предварительный просмотр">
                <strong>Список проверен сервером</strong>
                <div className="classroom-batch-summary">
                  <span>Можно добавить: {counts.valid}</span>
                  <span>Повторы: {counts.duplicate}</span>
                  <span>Конфликты: {counts.conflict}</span>
                  <span>Ошибки: {counts.invalid}</span>
                </div>
                <div className="classroom-batch-rows">
                  {preview.map((row) => (
                    <div className="classroom-batch-row" data-status={row.status} key={row.index}>
                      <span>{row.index + 1}</span>
                      <span>
                        <strong>{row.displayLabel || '—'}</strong>
                        <small>Код ученика: {row.studentCode || '—'}</small>
                      </span>
                      <span>
                        {row.status === 'valid'
                          ? 'Готово к добавлению'
                          : row.status === 'duplicate'
                            ? 'Уже существует'
                            : row.status === 'conflict'
                              ? 'Конфликт кода'
                              : 'Некорректная строка'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {error ? (
              <p className="form-error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="modal-actions">
              <button
                type="button"
                className="btn-secondary"
                disabled={busy !== null}
                onClick={onClose}
              >
                Отмена
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={busy !== null || students.length === 0 || students.length > 100}
                onClick={() => void previewList()}
              >
                {busy === 'preview' ? 'Проверяем…' : 'Проверить список'}
              </button>
              {preview ? (
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={busy !== null || counts.valid === 0}
                >
                  {busy === 'commit' ? 'Добавляем…' : `Добавить учеников (${counts.valid})`}
                </button>
              ) : null}
            </div>
          </form>
        ) : (
          <div className="classroom-batch-result">
            <h3>Ученики добавлены: {committed.created}</h3>
            <p>Коды сохранены в списке класса. Карточки можно распечатать сейчас или позже.</p>
            {createdRows.length > 0 ? (
              <div className="classroom-batch-rows" aria-label="Созданные ученики">
                {createdRows.map((row) => (
                  <div className="classroom-batch-row" key={row.index}>
                    <span>{row.index + 1}</span>
                    <span>
                      <strong>{row.displayLabel}</strong>
                      <small>Код ученика: {row.studentCode}</small>
                    </span>
                    <span>Добавлен</span>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="modal-actions">
              {createdRows.length > 0 ? (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() =>
                    onOpenCards(createdRows.flatMap((row) => (row.seatId ? [row.seatId] : [])))
                  }
                >
                  Карточки новых учеников
                </button>
              ) : null}
              <button type="button" className="btn-secondary" onClick={onClose}>
                Закрыть
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function ClassroomPage({
  classroomId,
  openSeatId,
  onBack,
  onOpenProjects,
  onOpenProject,
}: {
  classroomId: string;
  /** Opens straight into one learner: how a teacher returns from their work. */
  openSeatId?: string;
  onBack: () => void;
  onOpenProjects: (classroomTitle: string) => void;
  onOpenProject: (projectId: string, moduleKey: string, seatId?: string) => void;
}): JSX.Element {
  const [page, setPage] = useState<PageState>({ kind: 'loading' });
  const [tab, setTab] = useState<ClassroomTab>('students');
  const [dialog, setDialog] = useState<'single' | 'batch' | null>(null);
  const [editing, setEditing] = useState<ClassroomStudentSeat | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // null = closed; [] = all active learners; non-empty = selected learner cards.
  const [accessCardIds, setAccessCardIds] = useState<string[] | null>(null);
  const [codeEditor, setCodeEditor] = useState<ClassroomStudentSeat | null>(null);
  const [teacherTeam, setTeacherTeam] = useState<TeacherTeamState>({ kind: 'idle' });
  const [teacherInviteLink, setTeacherInviteLink] = useState<string | null>(null);
  const [activityKind, setActivityKind] = useState<'all' | 'projects'>('all');
  const [activity, setActivity] = useState<ClassroomActivityEntry[]>([]);
  // Which learner is being looked at. A class page and a learner's page are the
  // same place at two depths, so this is state rather than another route.
  const [openStudent, setOpenStudent] = useState<string | null>(openSeatId ?? null);
  const destination = useLearningDestination();
  useEffect(() => {
    if (destination.assignment) {
      setTab('gradebook');
      setOpenStudent(null);
    } else if (destination.joinRequest) {
      setTab('students');
      setOpenStudent(null);
    } else if (destination.courseRun) {
      setTab('activities');
      setOpenStudent(null);
    }
  }, [destination.assignment, destination.joinRequest, destination.courseRun]);
  /**
   * Сводка по классу: выдано, сдано, ждут ответа, кто отстаёт.
   *
   * Числа те же, что в списке классов. Преподаватель, открывший класс, не
   * должен считать их заново по строкам.
   */
  const [progress, setProgress] = useState<{
    seatCount: number;
    assignedCount: number;
    submittedCount: number;
    awaitingReview: number;
    behindCount: number;
  } | null>(null);
  /** Чем упорядочен список учащихся. */
  const [rosterSort, setRosterSort] = useState<'name' | 'awaiting' | 'submitted' | 'active'>(
    'name',
  );
  const [sharing, setSharing] = useState(false);
  const [search, setSearch] = useState('');
  const time = useSchoolTime();
  // Badges for the whole class in one answer, so the register does not ask
  // thirty times.
  const [awards, setAwards] = useState<Readonly<Record<string, string[]>>>({});

  const reload = useCallback(async () => {
    const [classroom, roster] = await Promise.all([
      api.getClassroom(classroomId),
      api.listClassroomRoster(classroomId),
    ]);
    if (classroom.ok && roster.ok)
      setPage({ kind: 'ready', classroom: classroom.data.classroom, students: roster.data.items });
    else setPage({ kind: 'error', message: 'Не удалось открыть класс.' });
  }, [classroomId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    void api.classroomAwards(classroomId).then((result) => {
      if (result.ok) setAwards(result.data.items);
    });
  }, [classroomId, openStudent]);

  // Сводка обновляется вместе с классом: после сдачи или отклика числа меняются.
  useEffect(() => {
    void api.classroomProgress(classroomId).then((result) => {
      if (result.ok) setProgress(result.data);
    });
  }, [classroomId, page, openStudent]);

  useEffect(() => {
    setTeacherTeam({ kind: 'idle' });
    setTeacherInviteLink(null);
  }, [classroomId]);

  // The record is fetched when it is being looked at, and refetched when the
  // filter changes, so an open class page does not poll a growing table.
  useEffect(() => {
    if (tab !== 'moderation') return;
    let cancelled = false;
    void api
      .classroomActivity(classroomId, activityKind === 'projects' ? { kind: 'projects' } : {})
      .then((result) => {
        if (!cancelled && result.ok) setActivity(result.data.items);
      });
    return () => {
      cancelled = true;
    };
  }, [activityKind, classroomId, tab]);

  const reloadTeacherTeam = useCallback(async () => {
    setTeacherTeam({ kind: 'loading' });
    const result = await api.listClassroomTeachers(classroomId);
    if (result.ok) {
      setTeacherTeam({
        kind: 'ready',
        teachers: result.data.items,
        invitations: result.data.invitations,
      });
    } else {
      setTeacherTeam({
        kind: 'error',
        message: result.error.message || 'Не удалось загрузить преподавателей класса.',
      });
    }
  }, [classroomId]);

  useEffect(() => {
    if (tab === 'teachers' && teacherTeam.kind === 'idle') void reloadTeacherTeam();
  }, [reloadTeacherTeam, tab, teacherTeam.kind]);

  async function copy(value: string, message: string): Promise<void> {
    await navigator.clipboard.writeText(value);
    setNotice(message);
  }

  async function updateStudent(student: ClassroomStudentSeat): Promise<string | null> {
    setBusy(`seat:${student.id}`);
    const result = await api.updateClassroomSeat(classroomId, student);
    setBusy(null);
    if (!result.ok) return result.error.message || 'Не удалось сохранить настройки.';
    setEditing(null);
    setNotice(`Настройки «${result.data.student.displayLabel}» сохранены.`);
    await reload();
    return null;
  }

  if (page.kind === 'loading')
    return (
      <main id="main-content" className="portal-content classroom-workspace" role="status">
        Загрузка класса…
      </main>
    );
  if (page.kind === 'error')
    return (
      <main id="main-content" className="portal-content classroom-workspace">
        <button type="button" className="btn-ghost" onClick={onBack}>
          ← Мои классы
        </button>
        <div className="portal-empty" role="alert">
          <p>{page.message}</p>
          <button type="button" className="btn-secondary" onClick={() => void reload()}>
            Повторить
          </button>
        </div>
      </main>
    );

  const { classroom, students } = page;
  // A class of thirty is one screen of scrolling; finding one child in it
  // should not be.
  const needle = search.trim().toLocaleLowerCase('ru-RU');
  const visibleStudents =
    needle.length === 0
      ? students
      : students.filter(
          (student) =>
            student.displayLabel.toLocaleLowerCase('ru-RU').includes(needle) ||
            student.studentCode.toLocaleLowerCase('en-US').includes(needle),
        );

  /**
   * Порядок в списке. Сортировка по имени — как в журнале; остальные три
   * отвечают на вопрос «кем заняться сейчас»: кто ждёт ответа, кто сдал больше
   * всех, кто давно не заходил.
   */
  const sortedStudents = [...visibleStudents].sort((a, b) => {
    if (rosterSort === 'submitted') {
      return (b.submittedCount ?? 0) - (a.submittedCount ?? 0);
    }
    if (rosterSort === 'awaiting') {
      return (b.awaitingReview ?? 0) - (a.awaitingReview ?? 0);
    }
    if (rosterSort === 'active') {
      const left = a.lastActiveAt ? new Date(a.lastActiveAt).getTime() : 0;
      const right = b.lastActiveAt ? new Date(b.lastActiveAt).getTime() : 0;
      return right - left;
    }
    return a.displayLabel.localeCompare(b.displayLabel, 'ru');
  });

  if (openStudent !== null) {
    return (
      <ClassroomStudentPage
        classroomId={classroomId}
        classroomTitle={classroom.title}
        seatId={openStudent}
        onBack={() => {
          setOpenStudent(null);
          void reload();
        }}
        onOpenProject={(projectId, moduleKey) => onOpenProject(projectId, moduleKey, openStudent)}
      />
    );
  }
  const classLink = classroom.joinCode
    ? `${window.location.origin}/#/join-class?code=${encodeURIComponent(classroom.joinCode)}`
    : null;
  // A class put away opens for reading: last year's register and last year's
  // work are exactly what a teacher comes back for. Nothing about it changes
  // until it is brought back into service.
  const archived = classroom.status === 'archived';

  return (
    <main id="main-content" className="portal-content classroom-workspace" tabIndex={-1}>
      {/* Возврат и то, чей это класс, — одной строкой: раньше это были три
          строки одна над другой, и две из них ничего не решали. */}
      <div className="classroom-crumbs">
        <button type="button" className="classroom-back" onClick={onBack}>
          ← Мои классы
        </button>
        <span className="classroom-crumb-role">
          {classroom.workspaceKind === 'personal' ? 'Личный класс' : classroom.workspaceTitle}
          {' · '}
          {classroom.teacherRole === 'owner' ? 'основной преподаватель' : 'коллега-преподаватель'}
        </span>
      </div>
      <header className="classroom-head">
        <div className="classroom-head-title">
          <h1>
            {classroom.title}
            <small>
              {learnerCount(classroom.studentCount)} · возраст{' '}
              {classroom.ageBand === 'mixed' ? 'разный' : classroom.ageBand}
            </small>
          </h1>
        </div>
        {/* The code is a chip and a button, not a panel. It is needed twice a
            lesson and read from across a room, so the place it is read properly
            is the full screen behind "Поделиться" — not a block that competes
            with the register for the top of every visit. An archived class has
            no code to give out; what it has is a way back into service. */}
        <div className="classroom-head-code">
          {archived ? (
            <button
              type="button"
              className="portal-create-button"
              disabled={busy === 'status'}
              onClick={async () => {
                setBusy('status');
                const result = await api.setClassroomStatus(classroomId, 'active');
                setBusy(null);
                if (result.ok) {
                  setNotice(
                    'Класс вернулся из архива. Выдайте новый код, чтобы впустить учеников.',
                  );
                  await reload();
                }
              }}
            >
              Вернуть из архива
            </button>
          ) : (
            <>
              {classroom.joinCode ? (
                <button
                  type="button"
                  className="classroom-code-chip"
                  title="Скопировать код"
                  onClick={() => void copy(classroom.joinCode as string, 'Код скопирован.')}
                >
                  {classroom.joinCode}
                </button>
              ) : (
                <span className="classroom-code-chip is-closed">Вход закрыт</span>
              )}
              <button
                type="button"
                className="portal-create-button"
                onClick={() => setSharing(true)}
              >
                Поделиться классом
              </button>
            </>
          )}
        </div>
      </header>

      {archived ? (
        <p className="classroom-archived-note" role="status">
          Класс в архиве с {time.date(classroom.archivedAt ?? classroom.createdAt)} — вход по коду
          закрыт, список и работы доступны для чтения.
        </p>
      ) : null}

      {/* The tabs and the one switch that applies to every learner share a row:
          both are about the class as a whole, and the switch used to be a
          banner of its own that pushed the register below the fold. */}
      <div className="classroom-tabbar">
        <nav className="classroom-workspace-tabs" aria-label="Разделы класса">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={tab === item.id ? 'active' : undefined}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <label className="classroom-safe-switch">
          <span>Безопасный режим для всех</span>
          <input
            type="checkbox"
            checked={classroom.safeModeDefault}
            disabled={busy === 'policy' || archived}
            onChange={async (event) => {
              setBusy('policy');
              const result = await api.updateClassroomPolicy(classroomId, event.target.checked);
              setBusy(null);
              if (result.ok) {
                setNotice(
                  event.target.checked
                    ? 'Безопасный режим включён для класса.'
                    : 'Общий безопасный режим выключен. Индивидуальные настройки сохранены.',
                );
                await reload();
              }
            }}
          />
          <i aria-hidden="true" />
        </label>
      </div>
      <details className="classroom-tab-panel">
        <summary>Настройки учебных оповещений</summary>
        <LearningNotificationPreferences classroomId={classroomId} />
        <ClassroomLearningReminders classroomId={classroomId} />
      </details>
      {notice ? (
        <p className="notice-success" role="status">
          {notice}
        </p>
      ) : null}

      {tab === 'students' ? (
        <section className="classroom-roster-panel">
          <ClassroomJoinRequests classroomId={classroom.id} onChanged={() => void reload()} />
          {/* Actions on the left, finding on the right: the two things a
              teacher does to a register, in the order they do them. */}
          <div className="classroom-roster-toolbar">
            <div className="classroom-roster-actions">
              <button
                type="button"
                className="portal-create-button"
                disabled={archived}
                onClick={() => setDialog('single')}
              >
                <PlusIcon /> Добавить ученика
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={archived}
                onClick={() => setDialog('batch')}
              >
                Добавить списком
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={students.length === 0 || !classroom.joinCode}
                onClick={() => setAccessCardIds([])}
              >
                Карточки доступа
              </button>
            </div>
            <label className="classroom-roster-search">
              <span className="sr-only">Поиск учащихся</span>
              <input
                type="search"
                placeholder="Поиск учащихся"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
          </div>
          {students.length === 0 ? (
            <div className="classroom-roster-empty">
              <span>
                <ClassesIcon />
              </span>
              <h3>В классе пока нет учеников</h3>
              <p>Добавьте одного ученика или вставьте готовый список.</p>
            </div>
          ) : (
            <>
              {progress ? (
                <div className="classroom-progress" aria-label="Успеваемость класса">
                  <span>
                    <strong>{progress.assignedCount}</strong>
                    заданий выдано
                  </span>
                  <span>
                    <strong>{progress.submittedCount}</strong>
                    работ сдано
                  </span>
                  <span className={progress.awaitingReview > 0 ? 'is-waiting' : undefined}>
                    <strong>{progress.awaitingReview}</strong>
                    ждут проверки
                  </span>
                  <span className={progress.behindCount > 0 ? 'is-behind' : undefined}>
                    <strong>{progress.behindCount}</strong>
                    не сдали ничего
                  </span>
                </div>
              ) : null}
              <div className="classroom-roster-table" role="table" aria-label="Ученики класса">
                <div className="classroom-roster-head" role="row">
                  {/* Заголовки сортируют: колонка, которая только сообщает,
                    заставляет искать нужного человека глазами. */}
                  <button
                    type="button"
                    className={`classroom-roster-sort${rosterSort === 'name' ? ' is-active' : ''}`}
                    onClick={() => setRosterSort('name')}
                  >
                    Учащийся
                  </button>
                  <span>Код ученика</span>
                  {/* Две сортировки на одну колонку: «кто сделал больше» и
                    «кто ждёт ответа» — разные вопросы к одним и тем же числам. */}
                  <span className="classroom-roster-sortgroup">
                    <button
                      type="button"
                      className={`classroom-roster-sort${rosterSort === 'submitted' ? ' is-active' : ''}`}
                      onClick={() => setRosterSort('submitted')}
                    >
                      Задания
                    </button>
                    <button
                      type="button"
                      className={`classroom-roster-sort${rosterSort === 'awaiting' ? ' is-active' : ''}`}
                      onClick={() => setRosterSort('awaiting')}
                    >
                      ждут
                    </button>
                  </span>
                  <button
                    type="button"
                    className={`classroom-roster-sort${rosterSort === 'active' ? ' is-active' : ''}`}
                    onClick={() => setRosterSort('active')}
                  >
                    Последняя активность
                  </button>
                  <span>Безопасный режим</span>
                  <span className="sr-only">Действия</span>
                </div>
                {sortedStudents.map((student) => (
                  <div className="classroom-roster-row" role="row" key={student.id}>
                    {/* The name is the way in: a register tells you who is here,
                      and the next thing a teacher wants is how they are doing. */}
                    <button
                      type="button"
                      className="classroom-student-name"
                      onClick={() => setOpenStudent(student.id)}
                    >
                      <img
                        className="classroom-seat-avatar"
                        src={seatAvatar(student.id, student.avatarKey).src}
                        alt=""
                        width={38}
                        height={38}
                        loading="lazy"
                      />
                      <span>
                        <strong>
                          {student.displayLabel}
                          <SeatAwardRow keys={awards[student.id] ?? []} size="small" />
                        </strong>
                        <small>
                          {student.status === 'suspended'
                            ? 'Доступ приостановлен'
                            : 'Место ученика'}
                        </small>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="classroom-login-handle"
                      onClick={() =>
                        void copy(student.studentCode, `Код «${student.studentCode}» скопирован.`)
                      }
                    >
                      {student.studentCode}
                    </button>
                    {/* Сколько сдано из выданного и ждёт ли что-то ответа.
                      Преподаватель видел «ждут проверки» в списке классов,
                      заходил внутрь — и не мог понять, кто именно ждёт. */}
                    <span className="classroom-roster-progress">
                      <span className="classroom-roster-done">
                        {student.submittedCount ?? 0} из {student.assignedCount ?? 0}
                      </span>
                      {(student.awaitingReview ?? 0) > 0 ? (
                        <em>ждёт проверки: {student.awaitingReview}</em>
                      ) : null}
                    </span>
                    <span className="classroom-roster-seen">
                      {student.lastActiveAt ? time.dateTime(student.lastActiveAt) : 'Ещё не входил'}
                    </span>
                    <label className="classroom-seat-safe">
                      <input
                        type="checkbox"
                        checked={student.safeMode}
                        disabled={Boolean(busy) || archived}
                        aria-label={`Безопасный режим: ${student.displayLabel}`}
                        onChange={() =>
                          void updateStudent({ ...student, safeMode: !student.safeMode })
                        }
                      />
                      <i aria-hidden="true" />
                      {/* On a phone the column heading is gone, so the row has to
                        say what the switch is about. */}
                      <span className="classroom-seat-safe-name" aria-hidden="true">
                        Безопасный режим
                      </span>
                      <span>{student.safeMode ? 'Включён' : 'Выключен'}</span>
                    </label>
                    <Dropdown
                      className="classroom-row-menu"
                      ariaLabel={`Действия: ${student.displayLabel}`}
                      label="•••"
                    >
                      {(close) => (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              close();
                              setOpenStudent(student.id);
                            }}
                          >
                            Открыть страницу
                          </button>
                          <button
                            type="button"
                            disabled={archived}
                            onClick={() => {
                              close();
                              setEditing(student);
                            }}
                          >
                            Изменить данные
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              close();
                              setAccessCardIds([student.id]);
                            }}
                          >
                            Карточка доступа
                          </button>
                          <button
                            type="button"
                            disabled={archived || Boolean(busy)}
                            onClick={() => {
                              close();
                              setCodeEditor(student);
                            }}
                          >
                            Изменить код ученика
                          </button>
                          <button
                            type="button"
                            disabled={archived}
                            onClick={() => {
                              close();
                              void updateStudent({
                                ...student,
                                status: student.status === 'suspended' ? 'active' : 'suspended',
                              });
                            }}
                          >
                            {student.status === 'suspended'
                              ? 'Вернуть доступ'
                              : 'Приостановить доступ'}
                          </button>
                          <button
                            type="button"
                            className="danger"
                            disabled={archived}
                            onClick={async () => {
                              close();
                              if (
                                !window.confirm(
                                  `Удалить ${student.displayLabel} из класса? Его вход будет закрыт.`,
                                )
                              )
                                return;
                              setBusy(`remove:${student.id}`);
                              const result = await api.removeClassroomSeat(classroomId, student.id);
                              setBusy(null);
                              if (result.ok) {
                                setNotice(`${student.displayLabel} удалён из класса.`);
                                await reload();
                              }
                            }}
                          >
                            Удалить из класса
                          </button>
                        </>
                      )}
                    </Dropdown>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      ) : null}

      {tab === 'projects' ? (
        <section className="classroom-tab-panel">
          <h2>Проекты класса</h2>
          <p>Откройте проекты, созданные педагогом для этого класса.</p>
          <button
            type="button"
            className="portal-create-button"
            onClick={() => onOpenProjects(classroom.title)}
          >
            Открыть проекты
          </button>
        </section>
      ) : null}
      {tab === 'activities' ? (
        <ClassroomLearning
          classroomId={classroomId}
          archived={archived}
          onOpenProject={(projectId, moduleKey) => onOpenProject(projectId, moduleKey)}
        />
      ) : null}
      {tab === 'gradebook' ? <ClassroomGradebook classroomId={classroomId} /> : null}
      {tab === 'moderation' ? (
        <section className="classroom-tab-panel">
          <div className="classroom-activity-heading">
            <h2>Что происходит в классе</h2>
            <div className="classroom-activity-filters" role="group" aria-label="Фильтр записей">
              <button
                type="button"
                className={activityKind === 'all' ? 'active' : undefined}
                onClick={() => setActivityKind('all')}
              >
                Все действия
              </button>
              <button
                type="button"
                className={activityKind === 'projects' ? 'active' : undefined}
                onClick={() => setActivityKind('projects')}
              >
                Проекты
              </button>
            </div>
          </div>
          <ClassroomActivityList
            entries={activity}
            showWho
            emptyText="Пока ничего не происходило. Записи появятся, когда ученики начнут работать."
          />
        </section>
      ) : null}
      {tab === 'teachers' ? (
        <section className="classroom-tab-panel classroom-teacher-panel">
          <div className="classroom-teacher-heading">
            <div>
              <span className="portal-eyebrow">Команда класса</span>
              <h2>Коллеги-преподаватели</h2>
              <p>
                Коллеги могут вместе с вами вести учеников, настраивать безопасный режим и работать
                с проектами этого класса.
              </p>
            </div>
            {classroom.teacherRole === 'owner' ? (
              <button
                type="button"
                className="portal-create-button"
                disabled={busy === 'teacher-invite'}
                onClick={async () => {
                  setBusy('teacher-invite');
                  const result = await api.createClassroomTeacherInvitation(classroomId);
                  setBusy(null);
                  if (!result.ok) {
                    setTeacherTeam({
                      kind: 'error',
                      message: result.error.message || 'Не удалось создать приглашение.',
                    });
                    return;
                  }
                  const link = new URL(result.data.invitation.invitePath, window.location.origin)
                    .href;
                  setTeacherInviteLink(link);
                  setNotice('Ссылка для коллеги создана и действует 7 дней.');
                  await reloadTeacherTeam();
                }}
              >
                <PlusIcon /> Пригласить коллегу
              </button>
            ) : null}
          </div>

          {classroom.teacherRole === 'co_teacher' ? (
            <div className="classroom-teacher-role-note">
              <strong>Вы — коллега-преподаватель</strong>
              <span>
                Вы можете вести этот класс наравне с основным преподавателем. Состав команды и
                приглашения изменяет владелец класса.
              </span>
            </div>
          ) : null}

          {teacherInviteLink ? (
            <div className="classroom-teacher-invite-link" role="status">
              <div>
                <strong>Ссылка для приглашения</strong>
                <span>
                  Отправьте её одному преподавателю. Ссылка перестанет работать после принятия.
                </span>
              </div>
              <div>
                <input
                  value={teacherInviteLink}
                  readOnly
                  aria-label="Ссылка для приглашения преподавателя"
                />
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => void copy(teacherInviteLink, 'Ссылка для коллеги скопирована.')}
                >
                  Копировать
                </button>
              </div>
            </div>
          ) : null}

          {teacherTeam.kind === 'loading' || teacherTeam.kind === 'idle' ? (
            <div className="classroom-teacher-loading" role="status">
              Загружаем команду класса…
            </div>
          ) : null}
          {teacherTeam.kind === 'error' ? (
            <div className="classroom-teacher-error" role="alert">
              <p>{teacherTeam.message}</p>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => void reloadTeacherTeam()}
              >
                Повторить
              </button>
            </div>
          ) : null}
          {teacherTeam.kind === 'ready' ? (
            <>
              <div className="classroom-teacher-list" aria-label="Преподаватели класса">
                {teacherTeam.teachers.map((teacher) => (
                  <article className="classroom-teacher-card" key={teacher.accountId}>
                    <span className="classroom-teacher-avatar" aria-hidden="true">
                      <img
                        src={
                          teacher.avatarDataUrl ?? defaultAvatarForAccount(teacher.accountId).src
                        }
                        alt=""
                      />
                    </span>
                    <div>
                      <strong>{teacher.displayName}</strong>
                      <span>
                        {teacher.role === 'owner'
                          ? 'Основной преподаватель'
                          : 'Коллега-преподаватель'}
                      </span>
                    </div>
                    <em className={teacher.role === 'owner' ? 'owner' : undefined}>
                      {teacher.role === 'owner' ? 'Владелец' : 'Совместный доступ'}
                    </em>
                    {classroom.teacherRole === 'owner' && teacher.role === 'co_teacher' ? (
                      <button
                        type="button"
                        className="classroom-teacher-remove"
                        disabled={busy === `teacher:${teacher.accountId}`}
                        onClick={async () => {
                          if (
                            !window.confirm(`Закрыть ${teacher.displayName} доступ к этому классу?`)
                          )
                            return;
                          setBusy(`teacher:${teacher.accountId}`);
                          const result = await api.removeClassroomTeacher(
                            classroomId,
                            teacher.accountId,
                          );
                          setBusy(null);
                          if (result.ok) {
                            setNotice(`${teacher.displayName} больше не имеет доступа к классу.`);
                            await reloadTeacherTeam();
                          } else {
                            setTeacherTeam({ kind: 'error', message: result.error.message });
                          }
                        }}
                      >
                        Удалить
                      </button>
                    ) : null}
                  </article>
                ))}
              </div>

              {classroom.teacherRole === 'owner' && teacherTeam.invitations.length > 0 ? (
                <div className="classroom-teacher-pending">
                  <h3>Ожидают принятия</h3>
                  {teacherTeam.invitations.map((invitation) => (
                    <div key={invitation.id}>
                      <span>
                        <strong>Приглашение для коллеги</strong>
                        <small>Действует до {time.longDateTime(invitation.expiresAt)}</small>
                      </span>
                      <button
                        type="button"
                        className="btn-ghost"
                        disabled={busy === `invitation:${invitation.id}`}
                        onClick={async () => {
                          setBusy(`invitation:${invitation.id}`);
                          const result = await api.revokeClassroomTeacherInvitation(
                            classroomId,
                            invitation.id,
                          );
                          setBusy(null);
                          if (result.ok) {
                            setTeacherInviteLink(null);
                            setNotice('Приглашение отозвано.');
                            await reloadTeacherTeam();
                          } else {
                            setTeacherTeam({ kind: 'error', message: result.error.message });
                          }
                        }}
                      >
                        Отозвать
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}

              {classroom.teacherRole === 'owner' && teacherTeam.teachers.length === 1 ? (
                <div className="classroom-teacher-empty">
                  <strong>Вы пока ведёте класс самостоятельно</strong>
                  <span>Пригласите до пяти коллег по защищённой ссылке.</span>
                </div>
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}

      {sharing ? (
        <ClassShareScreen
          title={classroom.title}
          joinCode={classroom.joinCode}
          joinUrl={classLink}
          busy={busy === 'code'}
          onCopyCode={() => void copy(classroom.joinCode as string, 'Код скопирован.')}
          onCopyLink={() => void copy(classLink as string, 'Ссылка скопирована.')}
          onRotate={async () => {
            setBusy('code');
            const result = await api.rotateClassroomJoinCode(classroomId);
            setBusy(null);
            if (result.ok) {
              setNotice(
                'Код класса обновлён. Старые карточки больше не подходят — распечатайте новые.',
              );
              await reload();
              setAccessCardIds([]);
            }
          }}
          onRevoke={async () => {
            setBusy('code');
            const result = await api.revokeClassroomJoinCode(classroomId);
            setBusy(null);
            if (result.ok) {
              setNotice('Вход по коду закрыт.');
              await reload();
            }
          }}
          onClose={() => setSharing(false)}
        />
      ) : null}

      {dialog === 'single' ? (
        <StudentDialog
          student={null}
          onClose={() => setDialog(null)}
          onSaved={async (input) => {
            const result = await api.addClassroomSeat(classroomId, {
              displayLabel: input.displayLabel,
              safeMode: input.safeMode,
            });
            if (!result.ok) return result.error.message || 'Не удалось добавить ученика.';
            setDialog(null);
            setNotice(
              `${result.data.student.displayLabel} добавлен. Код ученика: ${result.data.student.studentCode}`,
            );
            await reload();
            return null;
          }}
        />
      ) : null}
      {dialog === 'batch' ? (
        <BatchDialog
          classroomId={classroomId}
          onClose={() => setDialog(null)}
          onCommitted={async (created) => {
            setNotice(`Добавлено учеников: ${created}.`);
            await reload();
          }}
          onOpenCards={(seatIds) => {
            setDialog(null);
            setAccessCardIds(seatIds);
          }}
        />
      ) : null}
      {editing ? (
        <StudentDialog
          student={editing}
          onClose={() => setEditing(null)}
          onSaved={(input) => updateStudent({ ...editing, ...input })}
        />
      ) : null}
      {accessCardIds !== null ? (
        <StudentAccessCards
          classroomTitle={classroom.title}
          classCode={classroom.joinCode}
          students={students}
          initialStudentIds={accessCardIds}
          onClose={() => setAccessCardIds(null)}
        />
      ) : null}
      {codeEditor ? (
        <StudentCodeDialog
          classroomId={classroomId}
          student={codeEditor}
          onClose={() => setCodeEditor(null)}
          onSaved={async (studentCode) => {
            setNotice(`Код ученика ${codeEditor.displayLabel} изменён: ${studentCode}.`);
            await reload();
          }}
        />
      ) : null}
    </main>
  );
}
import { ClassroomJoinRequests } from '../components/ClassroomJoinRequests';
