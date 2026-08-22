import { useCallback, useEffect, useState } from 'react';
import {
  api,
  type ClassroomAssignment,
  type ClassroomAssignmentProgress,
  type LibraryAssignment,
  type ModuleSummary,
} from '../api';
import { AssignmentEditorDialog } from './AssignmentEditor';
import { AssignmentView } from './AssignmentView';
import { useSchoolTime } from './school-time';
import { seatAvatar } from '../creator-portal/default-avatars';
import { WorkPreview } from './WorkPreview';
import './classroom-assignments.css';

/**
 * Work a teacher sets, and how the class is getting on with it.
 *
 * Two numbers per assignment, because a class asks two questions. "Started" is
 * how many opened it at all — the one that finds the child who is stuck before
 * the lesson ends. "Handed in" is how many decided they were done. Neither can
 * be derived from the other: a learner who has been working for twenty minutes
 * has not finished, and one who pressed the button has stopped asking for help.
 *
 * Opening an assignment shows the register against it, including the learners
 * who never opened it — the empty row is the one that matters.
 */

/**
 * Выданное классом задание — это то же задание из «Заданий» преподавателя.
 *
 * У строки в классе свой номер (кому и когда выдано), у самого задания — свой.
 * Правится именно задание, поэтому форме отдаём его.
 */
function libraryShape(assignment: ClassroomAssignment): LibraryAssignment {
  return {
    id: assignment.assignmentId,
    title: assignment.title,
    brief: assignment.brief,
    goal: assignment.goal,
    moduleKey: assignment.moduleKey,
    ageBand: null,
    sampleImage: assignment.sampleImage,
    isDemo: assignment.isDemo,
    // Строка класса знает про выдачу, а не про полку: папку, архив и историю
    // выдач форма перечитает из банка, когда её откроют оттуда.
    folderId: null,
    folderTitle: null,
    archivedAt: null,
    visibility: 'private',
    sharedWith: 0,
    courseTitles: [],
    copiedFrom: null,
    createdAt: assignment.createdAt,
    updatedAt: assignment.createdAt,
    handoutCount: 0,
    startedCount: assignment.startedCount,
    submittedCount: assignment.submittedCount,
    classroomTitles: [],
    academicYears: [],
    lastHandedOutAt: null,
  };
}

export function ClassroomAssignments({
  classroomId,
  archived,
  onOpenProject,
}: {
  readonly classroomId: string;
  readonly archived: boolean;
  readonly onOpenProject: (projectId: string, moduleKey: string) => void;
}): JSX.Element {
  const [items, setItems] = useState<ClassroomAssignment[] | null>(null);
  const [modules, setModules] = useState<readonly ModuleSummary[]>([]);
  const [creating, setCreating] = useState(false);
  /** Какое задание правим той же формой. null — пишем новое. */
  const [editing, setEditing] = useState<LibraryAssignment | null>(null);
  const [open, setOpen] = useState<ClassroomAssignment | null>(null);
  const [progress, setProgress] = useState<ClassroomAssignmentProgress[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<ClassroomAssignmentProgress | null>(null);
  const time = useSchoolTime();

  const reload = useCallback(async () => {
    const result = await api.listClassroomAssignments(classroomId);
    setItems(result.ok ? result.data.items : []);
  }, [classroomId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    void api.listModules().then((result) => {
      if (result.ok) {
        setModules(
          result.data.items.filter((entry) => entry.availability === 'active' && entry.creatable),
        );
      }
    });
  }, []);

  useEffect(() => {
    if (!open) {
      setProgress(null);
      return;
    }
    let cancelled = false;
    setProgress(null);
    void api.classroomAssignmentProgress(classroomId, open.id).then((result) => {
      if (!cancelled) setProgress(result.ok ? result.data.items : []);
    });
    return () => {
      cancelled = true;
    };
  }, [classroomId, open]);

  const moduleName = (key: string): string =>
    modules.find((entry) => entry.moduleKey === key)?.displayName ?? key;

  const editorDialog = creating ? (
    <AssignmentEditorDialog
      assignment={editing}
      modules={modules}
      withDueDate={!editing}
      heading={editing ? 'Задание' : 'Новое задание для класса'}
      intro={
        editing
          ? 'Изменения увидят все классы, которым это задание выдано.'
          : 'Задание сохранится у вас в «Заданиях» и сразу уйдёт этому классу.'
      }
      submitLabel={editing ? 'Сохранить' : 'Выдать классу'}
      onClose={() => {
        setCreating(false);
        setEditing(null);
      }}
      onSaved={async (assignmentId, draft) => {
        // Выдача — единственное, что связывает задание с классом: то же
        // действие, что и галочка в «Кому выдать». Задание, уже выданное
        // классу, выдаётся не заново: иначе правка текста стирала бы срок.
        if (!editing) {
          const handed = await api.handOutAssignment(assignmentId, classroomId, true, draft.dueAt);
          if (!handed.ok) return handed.error.message || 'Не удалось выдать задание классу.';
        }
        const wasEditing = Boolean(editing);
        setCreating(false);
        setEditing(null);
        setNotice(
          wasEditing
            ? `Задание «${draft.title}» сохранено.`
            : `Задание «${draft.title}» выдано классу.`,
        );
        await reload();
        if (open) {
          const fresh = await api.listClassroomAssignments(classroomId);
          if (fresh.ok) {
            setOpen(fresh.data.items.find((item) => item.id === open.id) ?? null);
          }
        }
        return null;
      }}
    />
  ) : null;

  if (open) {
    return (
      <section className="classroom-tab-panel">
        <button type="button" className="classroom-back" onClick={() => setOpen(null)}>
          ← Все задания
        </button>
        <div className="assignment-detail-heading">
          <h2>{open.title}</h2>
          <button
            type="button"
            className="btn-secondary"
            disabled={archived}
            onClick={() => {
              setEditing(libraryShape(open));
              setCreating(true);
            }}
          >
            Изменить задание
          </button>
          <p>
            {moduleName(open.moduleKey)}
            {open.dueAt ? ` · срок ${time.date(open.dueAt)}` : ''}
            {open.status === 'closed' ? ' · закрыто' : ''}
          </p>
        </div>
        {/* Тот же вид, что видит ученик: преподаватель проверяет по тому же
            тексту, который читал ребёнок, а не по своей версии вёрстки. */}
        <AssignmentView assignment={open} />

        {progress === null ? (
          <p role="status">Загружаем…</p>
        ) : (
          <ul className="assignment-progress" data-testid="assignment-progress">
            {progress.map((row) => (
              <li key={row.seatId}>
                <img
                  src={seatAvatar(row.seatId, row.avatarKey).src}
                  alt=""
                  width={36}
                  height={36}
                />
                <span className="assignment-progress-name">{row.displayLabel}</span>
                <span
                  className={`assignment-state ${
                    row.submittedAt ? 'is-done' : row.startedAt ? 'is-started' : 'is-idle'
                  }`}
                >
                  {row.submittedAt
                    ? `Сдано ${time.dateTime(row.submittedAt)}`
                    : row.startedAt
                      ? `Работает с ${time.dateTime(row.startedAt)}`
                      : 'Не открывал'}
                </span>
                {/* The picture first. Launching an editor to answer "is this
                    finished" thirty times is not marking, it is waiting. */}
                {row.projectId ? (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setPreviewing(row)}
                  >
                    Посмотреть работу
                  </button>
                ) : (
                  <span />
                )}
              </li>
            ))}
          </ul>
        )}

        {previewing?.projectId ? (
          <WorkPreview
            projectId={previewing.projectId}
            snapshotRevision={previewing.snapshotRevision}
            moduleKey={open.moduleKey}
            learnerName={previewing.displayLabel}
            workTitle={open.title}
            submittedAt={previewing.submittedAt}
            assignment={open}
            onClose={() => setPreviewing(null)}
            onOpenEditor={() => {
              const projectId = previewing.projectId as string;
              setPreviewing(null);
              onOpenProject(projectId, open.moduleKey);
            }}
            onGraded={() => {
              void api.classroomAssignmentProgress(classroomId, open.id).then((result) => {
                if (result.ok) setProgress(result.data.items);
              });
            }}
          />
        ) : null}
        {editorDialog}
      </section>
    );
  }

  return (
    <section className="classroom-tab-panel">
      <div className="assignment-heading">
        <div>
          <h2>Задания класса</h2>
          <p>Каждый ученик получает свою копию работы. Прогресс виден сразу.</p>
        </div>
        <button
          type="button"
          className="portal-create-button"
          disabled={archived || modules.length === 0}
          onClick={() => setCreating(true)}
        >
          Новое задание
        </button>
      </div>

      {notice ? (
        <p className="notice-success" role="status">
          {notice}
        </p>
      ) : null}

      {items === null ? (
        <p role="status">Загружаем задания…</p>
      ) : items.length === 0 ? (
        <div className="classroom-roster-empty">
          <h3>Заданий пока нет</h3>
          <p>Выдайте первое — ученики увидят его на своей главной странице.</p>
        </div>
      ) : (
        <>
          {items.some((entry) => entry.isDemo) ? (
            <p className="assignment-demo-note">
              Это старые примеры, созданные раньше. Их можно изменить или удалить. Новые классы
              больше не получают задания автоматически: курс назначается отдельно во вкладке
              «Курсы».
            </p>
          ) : null}
          <ul className="assignment-list" data-testid="assignment-list">
            {items.map((assignment) => (
              <li key={assignment.id}>
                {/* Задание узнают по картинке раньше, чем по названию: строка
                    «Домик» и домик — разные вещи, особенно когда их десять. */}
                {assignment.sampleImage ? (
                  <img
                    className="assignment-row-sample"
                    src={assignment.sampleImage}
                    alt=""
                    width={44}
                    height={44}
                  />
                ) : (
                  <span className="assignment-row-sample is-empty" aria-hidden="true" />
                )}
                <button
                  type="button"
                  className="assignment-title"
                  onClick={() => setOpen(assignment)}
                >
                  {assignment.title}
                  {assignment.isDemo ? <em className="is-demo">пример</em> : null}
                  {assignment.status === 'closed' ? <em>закрыто</em> : null}
                </button>
                <span className="assignment-module">{moduleName(assignment.moduleKey)}</span>
                <span className="assignment-counts">
                  Работают: {assignment.startedCount} из {assignment.seatCount} · Сдали:{' '}
                  {assignment.submittedCount}
                </span>
                <span className="assignment-due">
                  {assignment.dueAt ? `Срок ${time.date(assignment.dueAt)}` : 'Без срока'}
                </span>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={archived}
                  onClick={() => {
                    setEditing(libraryShape(assignment));
                    setCreating(true);
                  }}
                >
                  Изменить
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={archived}
                  onClick={async () => {
                    const next = assignment.status === 'open' ? 'closed' : 'open';
                    const result = await api.setClassroomAssignmentStatus(
                      classroomId,
                      assignment.id,
                      next,
                    );
                    if (result.ok) {
                      setNotice(
                        next === 'closed'
                          ? 'Задание закрыто. Начатые работы останутся у учеников.'
                          : 'Задание снова открыто.',
                      );
                      await reload();
                    }
                  }}
                >
                  {assignment.status === 'open' ? 'Закрыть' : 'Открыть'}
                </button>
                <button
                  type="button"
                  className="assignment-remove"
                  aria-label={`Удалить задание ${assignment.title}`}
                  disabled={archived}
                  onClick={async () => {
                    if (
                      !window.confirm(
                        `Удалить «${assignment.title}»? Работы учеников останутся у них.`,
                      )
                    )
                      return;
                    const result = await api.deleteClassroomAssignment(classroomId, assignment.id);
                    if (result.ok) {
                      setNotice(`Задание «${assignment.title}» удалено.`);
                      await reload();
                    }
                  }}
                >
                  Удалить
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {editorDialog}
    </section>
  );
}
