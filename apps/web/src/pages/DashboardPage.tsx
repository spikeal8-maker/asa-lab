import '../modules/classroom-owner-layout.css';
import '../modules/classroom-mobile.css';
import '../modules/classroom-usability.css';
import '../modules/classroom-teacher-density.css';
import '../modules/classroom-teacher-dashboard.css';
import '../modules/classroom-teacher-dashboard-responsive.css';
import '../modules/classroom-teacher-ultrawide.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type Classroom, type ClassroomStatus } from '../api';
import { CreateClassroomModal } from '../components/CreateClassroomModal';
import { ClassroomPropertiesModal } from '../components/ClassroomPropertiesModal';
import { ageBandLabel } from '../components/ClassroomFields';
import { Dropdown } from '../components/Dropdown';
import { useSchoolTime } from '../components/school-time';
import { ClassesIcon, PlusIcon } from '../electronics/workbench-icons';
import { ClassroomMetrics, useClassroomMetrics } from '../components/ClassroomMetrics';
import { classroomAverageRatingPresentation } from '../components/classroom-average-rating';

type ListState =
  { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; items: Classroom[] };

type ClassroomRoleView = 'teaching' | 'archived' | 'coteaching' | 'enrolled';

const CLASSROOM_ROLE_TABS: ReadonlyArray<{
  id: ClassroomRoleView;
  label: string;
  compactLabel: string;
}> = [
  { id: 'teaching', label: 'Преподавание', compactLabel: 'Преподаю' },
  { id: 'archived', label: 'В архиве', compactLabel: 'Архив' },
  {
    id: 'coteaching',
    label: 'Совместное преподавание',
    compactLabel: 'Совместно',
  },
  { id: 'enrolled', label: 'Зарегистрированные', compactLabel: 'Учусь' },
];

type SortColumn =
  'title' | 'students' | 'works' | 'submitted' | 'awaiting' | 'behind' | 'rating' | 'created';
type SortDirection = 'asc' | 'desc';
type SortKey = `${SortColumn}-${SortDirection}`;
const SORT_COLUMNS: ReadonlyArray<{ column: SortColumn; label: string }> = [
  { column: 'title', label: 'Класс' },
  { column: 'students', label: 'Ученики' },
  { column: 'works', label: 'Работы' },
  { column: 'submitted', label: 'Сдано' },
  { column: 'awaiting', label: 'Ждут' },
  { column: 'behind', label: 'Не сдали' },
  { column: 'rating', label: 'Рейтинг' },
  { column: 'created', label: 'Создан' },
];
const SORTS: ReadonlyArray<{ id: SortKey; label: string }> = [
  { id: 'created-desc', label: 'Сначала новые' },
  { id: 'created-asc', label: 'Сначала старые' },
  { id: 'title-asc', label: 'Класс: А–Я' },
  { id: 'title-desc', label: 'Класс: Я–А' },
  { id: 'students-desc', label: 'Больше учеников' },
  { id: 'students-asc', label: 'Меньше учеников' },
  { id: 'works-desc', label: 'Больше работ' },
  { id: 'works-asc', label: 'Меньше работ' },
  { id: 'submitted-desc', label: 'Больше сдано' },
  { id: 'submitted-asc', label: 'Меньше сдано' },
  { id: 'awaiting-desc', label: 'Больше ждут проверки' },
  { id: 'awaiting-asc', label: 'Меньше ждут проверки' },
  { id: 'behind-desc', label: 'Больше не сдали' },
  { id: 'behind-asc', label: 'Меньше не сдали' },
  { id: 'rating-desc', label: 'Выше рейтинг' },
  { id: 'rating-asc', label: 'Ниже рейтинг' },
];
type SortMetric = {
  students?: number;
  works?: number;
  submitted?: number;
  waiting?: number;
  notSubmitted?: number;
  averageRating?: number | null;
};
const collator = new Intl.Collator('ru-RU', { sensitivity: 'base', numeric: true });
function sortClassrooms(
  items: readonly Classroom[],
  sort: SortKey,
  metrics: ReadonlyMap<string, SortMetric>,
): Classroom[] {
  const [column, direction] = sort.split('-') as [SortColumn, SortDirection];
  const sign = direction === 'asc' ? 1 : -1;
  const value = (item: Classroom): number | null => {
    const metric = metrics.get(item.id);
    switch (column) {
      case 'students':
        return metric?.students ?? item.studentCount;
      case 'works':
        return metric?.works ?? null;
      case 'submitted':
        return metric?.submitted ?? item.submittedCount ?? null;
      case 'awaiting':
        return metric?.waiting ?? item.awaitingReview ?? null;
      case 'behind':
        return metric?.notSubmitted ?? item.behindCount ?? null;
      case 'rating':
        return metric?.averageRating ?? null;
      case 'created':
        return Date.parse(item.createdAt);
      default:
        return null;
    }
  };
  return [...items].sort((a, b) => {
    if (column === 'title') return sign * collator.compare(a.title, b.title);
    const left = value(a),
      right = value(b);
    if (left == null || !Number.isFinite(left))
      return right == null || !Number.isFinite(right) ? collator.compare(a.title, b.title) : 1;
    if (right == null || !Number.isFinite(right)) return -1;
    return sign * (left - right) || (column === 'created' ? 0 : collator.compare(a.title, b.title));
  });
}
export function DashboardPage({
  onOpenProjects,
  onAttendClasses,
}: {
  onOpenProjects: (classroomId: string, classroomTitle: string) => void;
  onAttendClasses: () => void;
}): JSX.Element {
  const [list, setList] = useState<ListState>({ kind: 'loading' });
  const [modalOpen, setModalOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [roleView, setRoleView] = useState<ClassroomRoleView>('teaching');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [sort, setSort] = useState<SortKey>('created-desc');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Classroom | null>(null);
  const [busy, setBusy] = useState(false);
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const time = useSchoolTime();

  const reload = useCallback(async () => {
    const result = await api.listClassrooms();
    if (result.ok) setList({ kind: 'ready', items: result.data.items });
    else if (result.status === 0)
      setList({
        kind: 'error',
        message: 'Сервер недоступен. Проверьте соединение.',
      });
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

  const roleItems = useMemo(() => {
    if (list.kind !== 'ready') return [];
    const running = list.items.filter((item) => item.status !== 'archived');
    return roleView === 'teaching'
      ? running.filter((item) => item.teacherRole === 'owner')
      : roleView === 'coteaching'
        ? running.filter((item) => item.teacherRole === 'co_teacher')
        : roleView === 'archived'
          ? list.items.filter((item) => item.status === 'archived')
          : [];
  }, [list, roleView]);

  const summaryClassIds = roleItems
    .map((item) => item.id)
    .sort()
    .join(',');
  const summary = useClassroomMetrics(
    summaryClassIds,
    list,
    list.kind === 'ready' && roleView !== 'enrolled',
  );
  const rowMetrics = useMemo(
    () => new Map(summary.data?.items.map((item) => [item.classroomId, item])),
    [summary.data],
  );
  const visibleItems = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('ru-RU');
    return sortClassrooms(
      needle
        ? roleItems.filter((item) => item.title.toLocaleLowerCase('ru-RU').includes(needle))
        : roleItems,
      sort,
      rowMetrics,
    );
  }, [roleItems, search, sort, rowMetrics]);

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
  function toggleColumnSort(column: SortColumn): void {
    const first: SortDirection = column === 'title' ? 'asc' : 'desc';
    const reverse: SortDirection = first === 'asc' ? 'desc' : 'asc';
    setSort(sort === `${column}-${first}` ? `${column}-${reverse}` : `${column}-${first}`);
  }

  return (
    <main
      id="main-content"
      className={`portal-content classroom-owner-list${selectionMode ? ' is-selecting' : ''}`}
      tabIndex={-1}
      aria-busy={list.kind === 'loading'}
    >
      <section className="classroom-hub-heading" aria-labelledby="classroom-hub-title">
        <div className="classroom-title-row">
          <div className="classroom-title-and-link">
            <h1 id="classroom-hub-title">Мои классы</h1>
            <button type="button" className="classroom-attend-link" onClick={onAttendClasses}>
              Я учусь в классе <span aria-hidden="true">↗</span>
            </button>
          </div>
          {roleView !== 'enrolled' ? (
            <ClassroomMetrics
              showClasses
              classes={list.kind === 'ready' ? roleItems.length : undefined}
              data={summary.data?.totals ?? null}
            />
          ) : null}
        </div>
        {summary.error ? (
          <p role="alert">
            Показатели: {summary.error}{' '}
            <button type="button" onClick={summary.retry}>
              Повторить
            </button>
          </p>
        ) : null}
        <div className="classroom-hub-control-row">
          <nav className="classroom-role-tabs" aria-label="Роли в классах">
            {CLASSROOM_ROLE_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={roleView === tab.id ? 'active' : undefined}
                aria-label={tab.label}
                aria-current={roleView === tab.id ? 'page' : undefined}
                onClick={() => {
                  setRoleView(tab.id);
                  setSelected(new Set());
                  setSelectionMode(false);
                }}
              >
                <span className="classroom-role-label-full" aria-hidden="true">
                  {tab.label}
                </span>
                <span className="classroom-role-label-compact" aria-hidden="true">
                  {tab.compactLabel}
                </span>
              </button>
            ))}
          </nav>
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
              aria-label="Создать класс"
              onClick={openModal}
            >
              <PlusIcon />
              <span className="classroom-create-label-full">Создать класс</span>
              <span className="classroom-create-label-compact" aria-hidden="true">
                Класс
              </span>
            </button>
            <label className="classroom-hub-search">
              <span className="sr-only">Поиск класса по названию</span>
              <input
                type="search"
                value={search}
                placeholder="Найти класс"
                onChange={(event) => {
                  setSearch(event.target.value);
                  setSelected(new Set());
                }}
              />
            </label>
            <Dropdown
              className="classroom-bulk-menu"
              ariaLabel="Действия с классами"
              label={
                <>
                  Действия
                  {selectionMode && selectedItems.length > 0 ? (
                    <em>{selectedItems.length}</em>
                  ) : null}
                  <span aria-hidden="true">▾</span>
                </>
              }
            >
              {(close) => (
                <>
                  {!selectionMode ? (
                    <button
                      type="button"
                      onClick={() => {
                        close();
                        setSelectionMode(true);
                        setSelected(new Set());
                      }}
                    >
                      Выбрать классы
                    </button>
                  ) : (
                    <>
                      <p className="dropdown-hint">
                        {selectedItems.length
                          ? `Выбрано классов: ${selectedItems.length}`
                          : 'Отметьте классы для действий.'}
                      </p>
                      {selectedItems.length > 0 ? (
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
                              if (confirmRemoval(ownedSelection))
                                void applyStatus(ownedSelection, 'deleted');
                            }}
                          >
                            Удалить
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              close();
                              setSelected(new Set());
                            }}
                          >
                            Снять выделение
                          </button>
                        </>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => {
                          close();
                          setSelectionMode(false);
                          setSelected(new Set());
                        }}
                      >
                        Завершить выбор
                      </button>
                    </>
                  )}
                </>
              )}
            </Dropdown>
            <Dropdown
              className="classroom-sort-menu"
              ariaLabel="Порядок классов"
              label={
                <>
                  <span className="classroom-sort-label-full">{sortLabel}</span>
                  <span className="classroom-sort-label-compact" aria-hidden="true">
                    Сорт.
                  </span>
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
        </div>
      </section>

      {notice ? (
        <p className="notice-success" role="status" aria-live="polite">
          {notice}
        </p>
      ) : null}

      {list.kind === 'ready' &&
      search.trim() &&
      roleItems.length > 0 &&
      visibleItems.length === 0 ? (
        <p className="classroom-search-empty" role="status">
          Классы не найдены. Измените поисковый запрос.
        </p>
      ) : null}
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
      {list.kind === 'ready' && roleView === 'teaching' && roleItems.length === 0 ? (
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
      {list.kind === 'ready' && roleView !== 'teaching' && roleItems.length === 0 ? (
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
      {/* Дашборд по всем классам сразу: до него преподавателю приходилось
          складывать колонки глазами, чтобы понять, где сегодня работа. */}
      {list.kind === 'ready' && visibleItems.length > 0 ? (
        <ul className="classroom-list" data-testid="classroom-grid" aria-label="Мои классы">
          <li className="classroom-list-head">
            {selectionMode ? <span className="classroom-head-select" aria-hidden="true" /> : null}
            {SORT_COLUMNS.map(({ column, label }) => (
              <span key={column} className={`classroom-head-${column}`}>
                <button
                  type="button"
                  className={
                    sort.startsWith(`${column}-`)
                      ? 'classroom-column-sort active'
                      : 'classroom-column-sort'
                  }
                  aria-label={`Сортировать по колонке «${label}»`}
                  aria-pressed={sort.startsWith(`${column}-`)}
                  onClick={() => toggleColumnSort(column)}
                >
                  {label}
                  <span className="classroom-column-arrow" aria-hidden="true">
                    {sort.startsWith(`${column}-`) ? (sort.endsWith('-asc') ? '↑' : '↓') : '↕'}
                  </span>
                </button>
              </span>
            ))}
            <span aria-hidden="true" />
          </li>
          {visibleItems.map((classroom, index) => {
            const metric = rowMetrics.get(classroom.id);
            const rating = classroomAverageRatingPresentation(
              metric?.averageRating,
              metric?.ratingParticipants,
              metric?.ratingPeriodDays,
            );
            return (
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
                  title={classroom.title}
                  onClick={() => onOpenProjects(classroom.id, classroom.title)}
                >
                  <span className="classroom-row-index" aria-hidden="true">
                    {index + 1}.
                  </span>
                  <span className="classroom-row-title-text">{classroom.title}</span>
                  {classroom.status === 'archived' ? (
                    <em className="classroom-row-archived">в архиве</em>
                  ) : null}
                </button>
                <span className="classroom-row-students" data-label="Ученики">
                  <span className="classroom-stat-number">
                    {rowMetrics.get(classroom.id)?.students ?? '—'}
                  </span>
                  <span className="classroom-stat-label">Ученики</span>
                </span>
                <span className="classroom-row-works" data-label="Работы">
                  <span className="classroom-stat-number">
                    {rowMetrics.get(classroom.id)?.works ?? '—'}
                  </span>
                  <span className="classroom-stat-label">Работы</span>
                </span>
                <span className="classroom-row-progress" data-label="Сдано">
                  <span className="classroom-stat-number">
                    {rowMetrics.has(classroom.id)
                      ? `${rowMetrics.get(classroom.id)!.submitted}/${rowMetrics.get(classroom.id)!.assigned}`
                      : '—'}
                  </span>
                  <span className="classroom-stat-label">Сдано</span>
                </span>
                <span className="classroom-row-awaiting" data-label="Ждут">
                  <span className="classroom-stat-number">
                    {rowMetrics.get(classroom.id)?.waiting ?? '—'}
                  </span>
                  <span className="classroom-stat-label">Ждут</span>
                </span>
                <span className="classroom-row-behind" data-label="Не сдали">
                  <span className="classroom-stat-number">
                    {rowMetrics.get(classroom.id)?.notSubmitted ?? '—'}
                  </span>
                  <span className="classroom-stat-label">Не сдали</span>
                </span>
                <span className="classroom-row-rating" data-label="Средний рейтинг">
                  <span className="classroom-rating-value">
                    <span className="classroom-stat-number">{rating.value}</span>
                    <abbr
                      className="classroom-rating-help"
                      title={rating.detail}
                      aria-label={rating.detail}
                      tabIndex={0}
                    >
                      ⓘ
                    </abbr>
                  </span>
                  <span className="classroom-stat-label">
                    <span className="classroom-rating-label-full">Средний рейтинг</span>
                    <span className="classroom-rating-label-compact">Рейт.</span>
                  </span>
                </span>
                <span className="classroom-row-date">
                  {/* Подпись нужна только архиву: у остальных её говорит колонка. */}
                  {classroom.status === 'archived' ? <small>В архиве с</small> : null}
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
            );
          })}
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
