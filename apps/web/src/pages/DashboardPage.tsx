import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type Classroom, type ClassroomStatus } from '../api';
import { CreateClassroomModal } from '../components/CreateClassroomModal';
import { ClassroomPropertiesModal } from '../components/ClassroomPropertiesModal';
import { ageBandLabel } from '../components/ClassroomFields';
import { Dropdown } from '../components/Dropdown';
import { useSchoolTime } from '../components/school-time';
import { ClassesIcon, PlusIcon } from '../electronics/workbench-icons';

type ListState =
  { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; items: Classroom[] };

type ClassroomRoleView = 'teaching' | 'archived' | 'coteaching' | 'enrolled';

const CLASSROOM_ROLE_TABS: ReadonlyArray<{ id: ClassroomRoleView; label: string }> = [
  { id: 'teaching', label: 'Преподавание' },
  { id: 'archived', label: 'В архиве' },
  { id: 'coteaching', label: 'Совместное преподавание' },
  { id: 'enrolled', label: 'Зарегистрированные' },
];

/**
 * How a register of classes is ordered.
 *
 * A teacher with thirty classes across four years looks for them in two ways:
 * by name, when they know which one they want, and by age, when they are
 * clearing out last year. Size matters once a term, when a class that should
 * have twenty-eight learners has three.
 */
type SortKey = 'created-desc' | 'created-asc' | 'title-asc' | 'title-desc' | 'students-desc';

const SORTS: ReadonlyArray<{ id: SortKey; label: string }> = [
  { id: 'created-desc', label: 'Сначала новые' },
  { id: 'created-asc', label: 'Сначала старые' },
  { id: 'title-asc', label: 'По названию: А–Я' },
  { id: 'title-desc', label: 'По названию: Я–А' },
  { id: 'students-desc', label: 'Больше учеников' },
];

const collator = new Intl.Collator('ru-RU', { sensitivity: 'base', numeric: true });

function sortClassrooms(items: readonly Classroom[], sort: SortKey): Classroom[] {
  const sorted = [...items];
  if (sort === 'title-asc') sorted.sort((a, b) => collator.compare(a.title, b.title));
  else if (sort === 'title-desc') sorted.sort((a, b) => collator.compare(b.title, a.title));
  else if (sort === 'students-desc')
    sorted.sort((a, b) => b.studentCount - a.studentCount || collator.compare(a.title, b.title));
  else
    sorted.sort((a, b) => {
      const left = Date.parse(a.createdAt);
      const right = Date.parse(b.createdAt);
      return sort === 'created-asc' ? left - right : right - left;
    });
  return sorted;
}

export function DashboardPage({
  onOpenProjects,
}: {
  onOpenProjects: (classroomId: string, classroomTitle: string) => void;
}): JSX.Element {
  const [list, setList] = useState<ListState>({ kind: 'loading' });
  const [modalOpen, setModalOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [roleView, setRoleView] = useState<ClassroomRoleView>('teaching');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [sort, setSort] = useState<SortKey>('created-desc');
  const [editing, setEditing] = useState<Classroom | null>(null);
  const [busy, setBusy] = useState(false);
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const time = useSchoolTime();

  const reload = useCallback(async () => {
    const result = await api.listClassrooms();
    if (result.ok) setList({ kind: 'ready', items: result.data.items });
    else if (result.status === 0)
      setList({ kind: 'error', message: 'Сервер недоступен. Проверьте соединение.' });
    else setList({ kind: 'error', message: 'Не удалось загрузить классы.' });
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  /**
   * Focus returns to the control the dialog was opened from. Two buttons open
   * it — the one in the header and the one in the empty state — and sending
   * focus to a fixed one moved a keyboard user somewhere they never were.
   */
  function openModal(event: { currentTarget: HTMLButtonElement }): void {
    openerRef.current = event.currentTarget;
    setNotice(null);
    setModalOpen(true);
  }

  /**
   * Dismissing the dialog returns focus to the control it was opened from.
   * Creating a class is different: the first class removes the empty state, so
   * the control that opened the dialog is about to leave the page even though
   * it is still there at this moment. Focus goes to the button that survives.
   */
  function restoreFocus(target: 'opener' | 'header'): void {
    window.requestAnimationFrame(() => {
      const opener = openerRef.current;
      const element =
        target === 'opener' && opener?.isConnected === true ? opener : createButtonRef.current;
      element?.focus({ preventScroll: true });
    });
  }

  function closeModal(): void {
    setModalOpen(false);
    restoreFocus('opener');
  }

  const visibleItems = useMemo(() => {
    if (list.kind !== 'ready') return [];
    const running = list.items.filter((item) => item.status !== 'archived');
    const matched =
      roleView === 'teaching'
        ? running.filter((item) => item.teacherRole === 'owner')
        : roleView === 'coteaching'
          ? running.filter((item) => item.teacherRole === 'co_teacher')
          : roleView === 'archived'
            ? list.items.filter((item) => item.status === 'archived')
            : [];
    return sortClassrooms(matched, sort);
  }, [list, roleView, sort]);

  const selectedItems = visibleItems.filter((item) => selected.has(item.id));
  const allSelected = visibleItems.length > 0 && selectedItems.length === visibleItems.length;
  const ownedSelection = selectedItems.filter((item) => item.teacherRole === 'owner');

  function toggleAll(): void {
    setSelected(allSelected ? new Set() : new Set(visibleItems.map((item) => item.id)));
  }

  function toggleOne(classroomId: string): void {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(classroomId)) next.delete(classroomId);
      else next.add(classroomId);
      return next;
    });
  }

  /**
   * One state change, applied to every class a teacher ticked.
   *
   * Sequential rather than parallel: this is the end of a school year, thirty
   * classes at a time, and a burst of thirty writes against one database is a
   * way to lose some of them quietly. The count reported back is what actually
   * succeeded, not what was asked for.
   */
  async function applyStatus(targets: readonly Classroom[], status: ClassroomStatus) {
    setBusy(true);
    let changed = 0;
    for (const classroom of targets) {
      const result = await api.setClassroomStatus(classroom.id, status);
      if (result.ok) changed += 1;
    }
    setBusy(false);
    setSelected(new Set());
    await reload();
    const failed = targets.length - changed;
    const verb =
      status === 'archived' ? 'В архиве' : status === 'active' ? 'Возвращено из архива' : 'Удалено';
    setNotice(
      changed === 0
        ? 'Ничего не изменилось.'
        : `${verb}: ${changed}${failed > 0 ? `. Не удалось: ${failed}.` : '.'}`,
    );
  }

  function confirmRemoval(targets: readonly Classroom[]): boolean {
    const names = targets.length === 1 ? `«${targets[0]!.title}»` : `классов: ${targets.length}`;
    return window.confirm(
      `Удалить ${names}? Вход по коду закроется, ученики выйдут из класса. Работы учеников сохранятся.`,
    );
  }

  const sortLabel = SORTS.find((entry) => entry.id === sort)?.label ?? 'Сначала новые';

  return (
    <main
      id="main-content"
      className="portal-content"
      tabIndex={-1}
      aria-busy={list.kind === 'loading'}
    >
      <section className="classroom-hub-heading" aria-labelledby="classroom-hub-title">
        <h1 id="classroom-hub-title">Мои классы</h1>
        <nav className="classroom-role-tabs" aria-label="Роли в классах">
          {CLASSROOM_ROLE_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={roleView === tab.id ? 'active' : undefined}
              aria-current={roleView === tab.id ? 'page' : undefined}
              onClick={() => {
                setRoleView(tab.id);
                setSelected(new Set());
              }}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </section>

      {notice ? (
        <p className="notice-success" role="status" aria-live="polite">
          {notice}
        </p>
      ) : null}

      <section className="classroom-hub-toolbar" aria-label="Действия с классами">
        <label className="classroom-select-all">
          <input
            type="checkbox"
            checked={allSelected}
            disabled={visibleItems.length === 0}
            aria-label="Выбрать все классы"
            onChange={toggleAll}
          />
        </label>
        <button
          ref={createButtonRef}
          type="button"
          className="portal-create-button"
          onClick={openModal}
        >
          <PlusIcon /> Создать новый класс
        </button>
        {/* The actions apply to what is ticked. With nothing ticked the menu
            says so instead of being a dead button that gives no reason. */}
        <Dropdown
          className="classroom-bulk-menu"
          ariaLabel="Действия с выбранными классами"
          label={
            <>
              Действия
              {selectedItems.length > 0 ? <em>{selectedItems.length}</em> : null}
              <span aria-hidden="true">▾</span>
            </>
          }
        >
          {(close) =>
            selectedItems.length === 0 ? (
              <p className="dropdown-hint">Отметьте классы галочками слева.</p>
            ) : (
              <>
                {roleView === 'archived' ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      close();
                      void applyStatus(selectedItems, 'active');
                    }}
                  >
                    Вернуть из архива
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      close();
                      void applyStatus(selectedItems, 'archived');
                    }}
                  >
                    Архивировать
                  </button>
                )}
                <button
                  type="button"
                  className="danger"
                  disabled={busy || ownedSelection.length === 0}
                  title={
                    ownedSelection.length === 0
                      ? 'Удалить класс может только основной преподаватель.'
                      : undefined
                  }
                  onClick={() => {
                    close();
                    if (confirmRemoval(ownedSelection)) void applyStatus(ownedSelection, 'deleted');
                  }}
                >
                  Удалить
                </button>
              </>
            )
          }
        </Dropdown>
        <Dropdown
          className="classroom-sort-menu"
          ariaLabel="Порядок классов"
          label={
            <>
              {sortLabel}
              <span aria-hidden="true">▾</span>
            </>
          }
        >
          {(close) =>
            SORTS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={sort === option.id ? 'active' : undefined}
                aria-pressed={sort === option.id}
                onClick={() => {
                  setSort(option.id);
                  close();
                }}
              >
                {option.label}
              </button>
            ))
          }
        </Dropdown>
      </section>

      {list.kind === 'loading' ? (
        <section className="classroom-list loading" role="status" aria-label="Загрузка классов">
          <div />
          <div />
          <div />
        </section>
      ) : null}
      {list.kind === 'error' ? (
        <div className="portal-empty" role="alert">
          <p>{list.message}</p>
          <button type="button" className="btn-secondary" onClick={() => void reload()}>
            Повторить
          </button>
        </div>
      ) : null}
      {list.kind === 'ready' && roleView === 'teaching' && visibleItems.length === 0 ? (
        <section className="portal-empty">
          <span className="portal-empty-icon">
            <ClassesIcon />
          </span>
          <h2>Создайте первый класс</h2>
          <p>Классы нужны для учеников, заданий и проверки. Личные проекты доступны отдельно.</p>
          <button type="button" className="portal-create-button" onClick={openModal}>
            <PlusIcon /> Создать класс
          </button>
        </section>
      ) : null}
      {list.kind === 'ready' && roleView !== 'teaching' && visibleItems.length === 0 ? (
        <section className="classroom-tab-empty">
          <span aria-hidden="true">
            <ClassesIcon />
          </span>
          <h2>Здесь пока нет классов</h2>
          <p>
            {roleView === 'archived'
              ? 'Классы, которые вы уберёте из работы, появятся здесь. Их всегда можно вернуть.'
              : roleView === 'coteaching'
                ? 'Здесь появятся классы, которые вы ведёте вместе с коллегами.'
                : 'Здесь появятся классы, в которых вы зарегистрированы как участник.'}
          </p>
        </section>
      ) : null}
      {list.kind === 'ready' && visibleItems.length > 0 ? (
        <ul className="classroom-list" data-testid="classroom-grid" aria-label="Мои классы">
          {visibleItems.map((classroom) => (
            <li key={classroom.id} className="classroom-list-row" data-testid="classroom-card">
              <label className="classroom-row-select">
                <input
                  type="checkbox"
                  checked={selected.has(classroom.id)}
                  aria-label={`Выбрать класс ${classroom.title}`}
                  onChange={() => toggleOne(classroom.id)}
                />
              </label>
              <button
                type="button"
                className="classroom-row-title"
                onClick={() => onOpenProjects(classroom.id, classroom.title)}
              >
                {classroom.title}
                {classroom.status === 'archived' ? (
                  <em className="classroom-row-archived">в архиве</em>
                ) : null}
              </button>
              <span className="classroom-row-students">Ученики: {classroom.studentCount}</span>
              {/* Сколько работ сдано и ждёт ответа. Раньше это можно было
                  узнать, только зайдя в класс, открыв «Действия» и открыв
                  задание — четыре шага ради вопроса «есть ли что проверять». */}
              {classroom.awaitingReview ? (
                <span className="classroom-row-review">
                  Ждут проверки: {classroom.awaitingReview}
                </span>
              ) : null}
              <span className="classroom-row-scope">
                {classroom.workspaceKind === 'personal' ? 'Личный класс' : classroom.workspaceTitle}
              </span>
              <span className="classroom-row-date">
                <small>{classroom.status === 'archived' ? 'В архиве с' : 'Дата создания'}</small>
                {time.date(
                  classroom.status === 'archived'
                    ? (classroom.archivedAt ?? classroom.createdAt)
                    : classroom.createdAt,
                )}
              </span>
              {/* Everything a teacher does to a class from outside it. Tinkercad
                  puts properties and removal here, and it is right: opening a
                  class to rename it is a trip for nothing. */}
              <Dropdown
                className="classroom-row-menu"
                ariaLabel={`Действия с классом ${classroom.title}`}
                label="•••"
              >
                {(close) => (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        close();
                        onOpenProjects(classroom.id, classroom.title);
                      }}
                    >
                      Открыть класс
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        close();
                        setEditing(classroom);
                      }}
                    >
                      Свойства
                    </button>
                    {classroom.status === 'archived' ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          close();
                          void applyStatus([classroom], 'active');
                        }}
                      >
                        Вернуть из архива
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          close();
                          void applyStatus([classroom], 'archived');
                        }}
                      >
                        Архивировать
                      </button>
                    )}
                    <button
                      type="button"
                      className="danger"
                      disabled={busy || classroom.teacherRole !== 'owner'}
                      title={
                        classroom.teacherRole === 'owner'
                          ? undefined
                          : 'Удалить класс может только основной преподаватель.'
                      }
                      onClick={() => {
                        close();
                        if (confirmRemoval([classroom])) void applyStatus([classroom], 'deleted');
                      }}
                    >
                      Удалить
                    </button>
                    <p className="dropdown-hint">
                      {ageBandLabel(classroom.ageBand)} · создан {time.date(classroom.createdAt)}
                    </p>
                  </>
                )}
              </Dropdown>
            </li>
          ))}
        </ul>
      ) : null}

      {editing ? (
        <ClassroomPropertiesModal
          classroom={editing}
          onClose={() => setEditing(null)}
          onSaved={(classroom) => {
            setEditing(null);
            setNotice(`Класс «${classroom.title}» обновлён.`);
            void reload();
          }}
        />
      ) : null}

      {modalOpen ? (
        <CreateClassroomModal
          onClose={closeModal}
          onCreated={(classroom, created) => {
            setModalOpen(false);
            setNotice(
              created
                ? `Класс «${classroom.title}» создан.`
                : `Класс «${classroom.title}» уже существует.`,
            );
            restoreFocus('header');
            void reload();
          }}
        />
      ) : null}
    </main>
  );
}
