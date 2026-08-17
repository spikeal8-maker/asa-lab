import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  api,
  type Classroom,
  type ClassroomStudentSeat,
  type ClassroomTeacher,
  type ClassroomActivityEntry,
  type ClassroomTeacherInvitation,
} from '../api';
import { ClassesIcon, PlusIcon } from '../electronics/workbench-icons';
import { ClassroomActivityList } from '../components/ClassroomActivityList';
import { ClassroomStudentPage } from './ClassroomStudentPage';
import { ClassJoinQr } from '../components/ClassJoinQr';
import { defaultAvatarForAccount } from '../creator-portal/default-avatars';

type ClassroomTab = 'students' | 'activities' | 'projects' | 'moderation' | 'teachers';
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
  { id: 'activities', label: 'Действия' },
  { id: 'projects', label: 'Проекты' },
  { id: 'moderation', label: 'Модерация' },
  { id: 'teachers', label: 'Коллеги-преподаватели' },
];

function lastActive(value: string | null): string {
  if (!value) return 'Ещё не входил';
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function invitationExpiry(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function handleFromLabel(label: string): string {
  const latin = label
    .toLocaleLowerCase('ru-RU')
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  return latin.length >= 3 ? latin : '';
}

function StudentDialog({
  student,
  onClose,
  onSaved,
}: {
  student: ClassroomStudentSeat | null;
  onClose: () => void;
  onSaved: (input: {
    displayLabel: string;
    loginHandle: string;
    safeMode: boolean;
  }) => Promise<string | null>;
}): JSX.Element {
  const [displayLabel, setDisplayLabel] = useState(student?.displayLabel ?? '');
  const [loginHandle, setLoginHandle] = useState(student?.loginHandle ?? '');
  const [safeMode, setSafeMode] = useState(student?.safeMode ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const label = displayLabel.trim();
    const handle = loginHandle.trim().toLowerCase();
    if (!label) {
      setError('Введите имя ученика для списка класса.');
      return;
    }
    if (handle && !/^[a-z0-9._-]{3,32}$/.test(handle)) {
      setError('Имя для входа: 3–32 латинских символа, цифры, точка, дефис или подчёркивание.');
      return;
    }
    setBusy(true);
    const message = await onSaved({ displayLabel: label, loginHandle: handle, safeMode });
    setBusy(false);
    if (message) setError(message);
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal classroom-student-dialog" role="dialog" aria-modal="true">
        <h2>{student ? 'Настройки ученика' : 'Добавить ученика'}</h2>
        <p>Ученик войдёт без почты: по коду класса и имени, которое вы ему выдадите.</p>
        <form onSubmit={(event) => void submit(event)}>
          <label htmlFor="seat-display-label">Имя в списке класса</label>
          <input
            id="seat-display-label"
            autoFocus
            maxLength={120}
            value={displayLabel}
            disabled={busy}
            placeholder="Алина К."
            onChange={(event) => {
              const next = event.target.value;
              setDisplayLabel(next);
              if (!student && !loginHandle) setLoginHandle(handleFromLabel(next));
            }}
          />
          <label htmlFor="seat-login-handle">Имя для входа</label>
          <input
            id="seat-login-handle"
            maxLength={32}
            value={loginHandle}
            disabled={busy}
            placeholder="Можно оставить пустым — создадим автоматически"
            onChange={(event) => setLoginHandle(event.target.value.toLowerCase())}
          />
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
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (
    students: Array<{ displayLabel: string; loginHandle?: string; safeMode: boolean }>,
  ) => Promise<string | null>;
}): JSX.Element {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const students = useMemo(
    () =>
      text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 100)
        .map((line) => {
          const [displayLabel = '', requestedHandle = ''] = line
            .split(',')
            .map((value) => value.trim());
          const generated = handleFromLabel(displayLabel);
          return {
            displayLabel,
            ...(requestedHandle || generated ? { loginHandle: requestedHandle || generated } : {}),
            safeMode: true,
          };
        }),
    [text],
  );

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (students.length === 0) {
      setError('Добавьте хотя бы одного ученика.');
      return;
    }
    setBusy(true);
    const message = await onCreate(students);
    setBusy(false);
    if (message) setError(message);
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal classroom-batch-dialog" role="dialog" aria-modal="true">
        <h2>Добавить список учеников</h2>
        <p>Один ученик на строку. При желании после запятой укажите имя для входа.</p>
        <form onSubmit={(event) => void submit(event)}>
          <label htmlFor="seat-batch">Ученики</label>
          <textarea
            id="seat-batch"
            autoFocus
            rows={8}
            value={text}
            disabled={busy}
            placeholder={'Алина К., alina-k\nМаксим П., maxim-p\nСофия М.'}
            onChange={(event) => setText(event.target.value)}
          />
          {students.length > 0 ? (
            <div className="classroom-batch-preview" aria-label="Предварительный просмотр">
              <strong>Будет добавлено: {students.length}</strong>
              {students.slice(0, 5).map((student, index) => (
                <span key={`${student.displayLabel}-${index}`}>
                  {student.displayLabel}{' '}
                  <small>{student.loginHandle || 'логин создастся автоматически'}</small>
                </span>
              ))}
              {students.length > 5 ? <span>И ещё {students.length - 5}</span> : null}
            </div>
          ) : null}
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
              {busy ? 'Добавляем…' : 'Добавить учеников'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function ClassroomPage({
  classroomId,
  onBack,
  onOpenProjects,
  onOpenProject,
}: {
  classroomId: string;
  onBack: () => void;
  onOpenProjects: (classroomTitle: string) => void;
  onOpenProject: (projectId: string, moduleKey: string) => void;
}): JSX.Element {
  const [page, setPage] = useState<PageState>({ kind: 'loading' });
  const [tab, setTab] = useState<ClassroomTab>('students');
  const [dialog, setDialog] = useState<'single' | 'batch' | null>(null);
  const [editing, setEditing] = useState<ClassroomStudentSeat | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [teacherTeam, setTeacherTeam] = useState<TeacherTeamState>({ kind: 'idle' });
  const [teacherInviteLink, setTeacherInviteLink] = useState<string | null>(null);
  const [activityKind, setActivityKind] = useState<'all' | 'projects'>('all');
  const [activity, setActivity] = useState<ClassroomActivityEntry[]>([]);
  // Which learner is being looked at. A class page and a learner's page are the
  // same place at two depths, so this is state rather than another route.
  const [openStudent, setOpenStudent] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);

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
        onOpenProject={onOpenProject}
      />
    );
  }
  const classLink = classroom.joinCode
    ? `${window.location.origin}/#/join-class?code=${encodeURIComponent(classroom.joinCode)}`
    : null;

  return (
    <main id="main-content" className="portal-content classroom-workspace" tabIndex={-1}>
      <button type="button" className="classroom-back" onClick={onBack}>
        ← Мои классы
      </button>
      <header className="classroom-workspace-header">
        <div>
          <span className="portal-eyebrow">
            {classroom.workspaceKind === 'personal' ? 'Личный класс' : classroom.workspaceTitle}
            {' · '}
            {classroom.teacherRole === 'owner' ? 'Основной преподаватель' : 'Коллега-преподаватель'}
          </span>
          <h1>{classroom.title}</h1>
          <p>
            {classroom.studentCount} учеников · возраст{' '}
            {classroom.ageBand === 'mixed' ? 'разный' : classroom.ageBand}
          </p>
        </div>
        <div className="classroom-code-card">
          <span>Код класса</span>
          <strong>{classroom.joinCode ?? 'Вход закрыт'}</strong>
          {/* A camera does not mistype a nine-character code, and a primary
              class with one shared code loses ten minutes to typing it. */}
          {classroom.joinCode && classLink ? (
            <button
              type="button"
              className="classroom-qr-toggle"
              aria-expanded={showQr}
              onClick={() => setShowQr((current) => !current)}
            >
              {showQr ? 'Скрыть QR-код' : 'Показать QR-код'}
            </button>
          ) : null}
          {showQr && classLink ? (
            <ClassJoinQr url={classLink} label={`Ссылка на класс ${classroom.title}`} />
          ) : null}
          <div>
            {classroom.joinCode ? (
              <>
                <button
                  type="button"
                  onClick={() => void copy(classroom.joinCode as string, 'Код скопирован.')}
                >
                  Копировать код
                </button>
                {classLink ? (
                  <button type="button" onClick={() => void copy(classLink, 'Ссылка скопирована.')}>
                    Копировать ссылку
                  </button>
                ) : null}
              </>
            ) : null}
            <button
              type="button"
              disabled={busy === 'code'}
              onClick={async () => {
                setBusy('code');
                const result = await api.rotateClassroomJoinCode(classroomId);
                setBusy(null);
                if (result.ok) {
                  setNotice(
                    classroom.joinCode
                      ? 'Создан новый код. Старый больше не работает.'
                      : 'Вход в класс открыт.',
                  );
                  await reload();
                }
              }}
            >
              {classroom.joinCode ? 'Сменить код' : 'Открыть вход'}
            </button>
            {classroom.joinCode ? (
              <button
                type="button"
                className="danger"
                disabled={busy === 'code'}
                onClick={async () => {
                  if (
                    !window.confirm(
                      'Закрыть вход по текущему коду? Уже вошедшие ученики сохранят доступ.',
                    )
                  )
                    return;
                  setBusy('code');
                  const result = await api.revokeClassroomJoinCode(classroomId);
                  setBusy(null);
                  if (result.ok) {
                    setNotice('Вход по коду закрыт.');
                    await reload();
                  }
                }}
              >
                Закрыть вход
              </button>
            ) : null}
          </div>
        </div>
      </header>

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
      {notice ? (
        <p className="notice-success" role="status">
          {notice}
        </p>
      ) : null}

      {tab === 'students' ? (
        <section className="classroom-roster-panel">
          <div className="classroom-roster-toolbar">
            <div>
              <h2>Учащиеся</h2>
              <p>Выдайте ученику код класса и его имя для входа. Почта не нужна.</p>
            </div>
            <div>
              <button type="button" className="btn-secondary" onClick={() => setDialog('batch')}>
                Добавить списком
              </button>
              <button
                type="button"
                className="portal-create-button"
                onClick={() => setDialog('single')}
              >
                <PlusIcon /> Добавить ученика
              </button>
            </div>
          </div>
          <label className="classroom-global-safe-mode">
            <input
              type="checkbox"
              checked={classroom.safeModeDefault}
              disabled={busy === 'policy'}
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
            <span>
              <strong>Безопасный режим для всего класса</strong>
              <small>Закрывает публичную публикацию и открытые социальные функции.</small>
            </span>
          </label>
          {students.length === 0 ? (
            <div className="classroom-roster-empty">
              <span>
                <ClassesIcon />
              </span>
              <h3>В классе пока нет учеников</h3>
              <p>Добавьте одного ученика или вставьте готовый список.</p>
            </div>
          ) : (
            <div className="classroom-roster-table" role="table" aria-label="Ученики класса">
              <div className="classroom-roster-head" role="row">
                <span>Ученик</span>
                <span>Имя для входа</span>
                <span>Последняя активность</span>
                <span>Safe Mode</span>
                <span>Действия</span>
              </div>
              {students.map((student) => (
                <div className="classroom-roster-row" role="row" key={student.id}>
                  {/* The name is the way in: a register tells you who is here,
                      and the next thing a teacher wants is how they are doing. */}
                  <button
                    type="button"
                    className="classroom-student-name"
                    onClick={() => setOpenStudent(student.id)}
                  >
                    <i>{student.displayLabel.slice(0, 1).toUpperCase()}</i>
                    <span>
                      <strong>{student.displayLabel}</strong>
                      <small>
                        {student.status === 'suspended' ? 'Доступ приостановлен' : 'Место ученика'}
                      </small>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="classroom-login-handle"
                    onClick={() =>
                      void copy(student.loginHandle, `Имя «${student.loginHandle}» скопировано.`)
                    }
                  >
                    {student.loginHandle}
                  </button>
                  <span>{lastActive(student.lastActiveAt)}</span>
                  <label className="classroom-seat-safe">
                    <input
                      type="checkbox"
                      checked={student.safeMode}
                      disabled={Boolean(busy)}
                      onChange={() =>
                        void updateStudent({ ...student, safeMode: !student.safeMode })
                      }
                    />
                    <span>{student.safeMode ? 'Включён' : 'Выключен'}</span>
                  </label>
                  <details className="classroom-row-menu">
                    <summary aria-label={`Действия: ${student.displayLabel}`}>•••</summary>
                    <div>
                      <button type="button" onClick={() => setEditing(student)}>
                        Изменить данные
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void updateStudent({
                            ...student,
                            status: student.status === 'suspended' ? 'active' : 'suspended',
                          })
                        }
                      >
                        {student.status === 'suspended' ? 'Вернуть доступ' : 'Приостановить доступ'}
                      </button>
                      <button
                        type="button"
                        className="danger"
                        onClick={async () => {
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
                    </div>
                  </details>
                </div>
              ))}
            </div>
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
        <section className="classroom-tab-panel">
          <h2>Действия</h2>
          <p>
            Здесь появятся задания и учебные активности класса. Сейчас вы можете подготовить проекты
            во вкладке «Проекты».
          </p>
        </section>
      ) : null}
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
                        <small>Действует до {invitationExpiry(invitation.expiresAt)}</small>
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

      {dialog === 'single' ? (
        <StudentDialog
          student={null}
          onClose={() => setDialog(null)}
          onSaved={async (input) => {
            const result = await api.addClassroomSeat(classroomId, {
              displayLabel: input.displayLabel,
              ...(input.loginHandle ? { loginHandle: input.loginHandle } : {}),
              safeMode: input.safeMode,
            });
            if (!result.ok) return result.error.message || 'Не удалось добавить ученика.';
            setDialog(null);
            setNotice(
              `${result.data.student.displayLabel} добавлен. Имя для входа: ${result.data.student.loginHandle}`,
            );
            await reload();
            return null;
          }}
        />
      ) : null}
      {dialog === 'batch' ? (
        <BatchDialog
          onClose={() => setDialog(null)}
          onCreate={async (items) => {
            const result = await api.addClassroomSeatsBatch(classroomId, items);
            if (!result.ok) return result.error.message || 'Не удалось добавить список.';
            const failed = result.data.results.length - result.data.created;
            setDialog(null);
            setNotice(
              `Добавлено учеников: ${result.data.created}${failed ? `. Не добавлено: ${failed}.` : '.'}`,
            );
            await reload();
            return null;
          }}
        />
      ) : null}
      {editing ? (
        <StudentDialog
          student={editing}
          onClose={() => setEditing(null)}
          onSaved={(input) =>
            updateStudent({
              ...editing,
              ...input,
              loginHandle: input.loginHandle || editing.loginHandle,
            })
          }
        />
      ) : null}
    </main>
  );
}
