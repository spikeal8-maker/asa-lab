import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  api,
  type AssignmentClassroom,
  type AssignmentFolder,
  visibilityLabel,
  type LibraryAssignment,
  type ModuleSummary,
} from '../api';
import { AssignmentEditorDialog } from '../components/AssignmentEditor';
import { CataloguePanel } from '../components/CataloguePanel';
import { CoursesPanel } from '../components/CoursesPanel';
import { ShareDialog } from '../components/ShareDialog';
import { CLASSROOM_AGE_OPTIONS } from '../components/ClassroomFields';
import { Dropdown } from '../components/Dropdown';
import { useSchoolTime } from '../components/school-time';
import '../components/classroom-assignments.css';
import './assignment-library.css';

/**
 * Банк заданий.
 *
 * Задание принадлежит человеку, который его написал, а не классу и не году:
 * одно и то же уходит и в этом сентябре, и в следующем, правится в одном месте
 * и не пишется заново каждый август.
 *
 * За три года заданий набирается двести, и одним списком они не ищутся.
 * Поэтому полка двухслойная. Папки — дерево, задание лежит в одной папке, как
 * файл на диске: понятно без объяснений. Признаки — среда, возраст, классы,
 * учебные годы — не папки, потому что пересекаются: задание про светодиод это
 * и «электроника», и «8 класс», и «2024/25». Их не расставляют руками, они
 * известны из самого задания и его выдач.
 */

/** Подпись возраста по значению, каким оно пришло из базы. */
function ageLabel(band: string): string {
  return CLASSROOM_AGE_OPTIONS.find((entry) => entry.value === band)?.label ?? band;
}

/** Отбор слева: вся полка, корень, конкретная папка или архив. */
type Scope =
  { kind: 'all' } | { kind: 'root' } | { kind: 'folder'; id: string } | { kind: 'archive' };

type SortKey = 'new' | 'title' | 'handed';

const SORTS: ReadonlyArray<{ id: SortKey; label: string }> = [
  { id: 'new', label: 'Сначала новые' },
  { id: 'title', label: 'По названию' },
  { id: 'handed', label: 'Недавно выдавал' },
];

function HandOutDialog({
  assignment,
  onClose,
  onChanged,
}: {
  readonly assignment: LibraryAssignment;
  readonly onClose: () => void;
  readonly onChanged: () => void;
}): JSX.Element {
  const [items, setItems] = useState<AssignmentClassroom[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const result = await api.assignmentClassrooms(assignment.id);
    setItems(result.ok ? result.data.items : []);
  }, [assignment.id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function toggle(row: AssignmentClassroom, given: boolean): Promise<void> {
    setBusy(row.classroomId);
    await api.handOutAssignment(assignment.id, row.classroomId, given, row.dueAt);
    setBusy(null);
    await reload();
    onChanged();
  }

  async function setDue(row: AssignmentClassroom, dueAt: string | null): Promise<void> {
    setBusy(row.classroomId);
    await api.handOutAssignment(assignment.id, row.classroomId, true, dueAt);
    setBusy(null);
    await reload();
    onChanged();
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="hand-out-heading">
        <h2 id="hand-out-heading">Кому выдать</h2>
        <p>«{assignment.title}» — отметьте классы. Срок можно задать для каждого свой.</p>
        {items === null ? (
          <p role="status">Загружаем классы…</p>
        ) : items.length === 0 ? (
          <p className="account-hint">У вас пока нет классов.</p>
        ) : (
          <ul className="hand-out-list" data-testid="hand-out-list">
            {items.map((row) => (
              <li key={row.classroomId}>
                <label>
                  <input
                    type="checkbox"
                    checked={row.handedOut}
                    disabled={busy === row.classroomId}
                    onChange={(event) => void toggle(row, event.target.checked)}
                  />
                  <span>{row.classroomTitle}</span>
                </label>
                <input
                  type="date"
                  aria-label={`Срок сдачи: ${row.classroomTitle}`}
                  disabled={!row.handedOut || busy === row.classroomId}
                  value={row.dueAt ? row.dueAt.slice(0, 10) : ''}
                  onChange={(event) =>
                    void setDue(
                      row,
                      event.target.value
                        ? new Date(`${event.target.value}T23:59:59`).toISOString()
                        : null,
                    )
                  }
                />
              </li>
            ))}
          </ul>
        )}
        <div className="modal-actions">
          <button type="button" className="btn-primary" onClick={onClose}>
            Готово
          </button>
        </div>
      </div>
    </div>
  );
}

/** Папки одного уровня и всё, что под ними. */
function descendantsOf(folders: readonly AssignmentFolder[], id: string): Set<string> {
  const result = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const folder of folders) {
      if (folder.parentId && result.has(folder.parentId) && !result.has(folder.id)) {
        result.add(folder.id);
        grew = true;
      }
    }
  }
  return result;
}

export function AssignmentLibraryPage(): JSX.Element {
  const [items, setItems] = useState<LibraryAssignment[] | null>(null);
  const [folders, setFolders] = useState<AssignmentFolder[]>([]);
  const [modules, setModules] = useState<readonly ModuleSummary[]>([]);
  const [editing, setEditing] = useState<LibraryAssignment | null | 'new'>(null);
  const [handingOut, setHandingOut] = useState<LibraryAssignment | null>(null);
  const [scope, setScope] = useState<Scope>({ kind: 'all' });
  const [search, setSearch] = useState('');
  const [moduleFilter, setModuleFilter] = useState('');
  const [ageFilter, setAgeFilter] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [yearFilter, setYearFilter] = useState('');
  const [sort, setSort] = useState<SortKey>('new');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Курсы — основной рабочий экран; банк заданий остаётся строительным материалом. */
  const [tab, setTab] = useState<'bank' | 'courses' | 'catalogue'>('courses');
  const [sharing, setSharing] = useState<LibraryAssignment | null>(null);
  const time = useSchoolTime();

  const reload = useCallback(async () => {
    const [list, tree] = await Promise.all([api.listAssignmentLibrary(), api.assignmentFolders()]);
    setItems(list.ok ? list.data.items : []);
    setFolders(tree.ok ? tree.data.items : []);
  }, []);

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

  const moduleName = (key: string): string =>
    modules.find((entry) => entry.moduleKey === key)?.displayName ?? key;

  const all = items ?? [];
  const active = all.filter((entry) => entry.archivedAt === null);

  /** Значения признаков берутся из самих заданий: пустых строк в отборе нет. */
  const facets = useMemo(() => {
    const usedModules = new Set<string>();
    const usedAges = new Set<string>();
    const usedClasses = new Set<string>();
    const usedYears = new Set<string>();
    for (const entry of all) {
      usedModules.add(entry.moduleKey);
      if (entry.ageBand) usedAges.add(entry.ageBand);
      for (const title of entry.classroomTitles) usedClasses.add(title);
      for (const year of entry.academicYears) usedYears.add(year);
    }
    return {
      modules: [...usedModules].sort(),
      ages: [...usedAges].sort(),
      classes: [...usedClasses].sort((a, b) => a.localeCompare(b, 'ru')),
      years: [...usedYears].sort().reverse(),
    };
  }, [all]);

  const needle = search.trim().toLocaleLowerCase('ru-RU');
  const scopeIds = scope.kind === 'folder' ? descendantsOf(folders, scope.id) : null;

  const visible = (scope.kind === 'archive' ? all.filter((e) => e.archivedAt !== null) : active)
    .filter((entry) => {
      if (scope.kind === 'root' && entry.folderId !== null) return false;
      if (scopeIds && (entry.folderId === null || !scopeIds.has(entry.folderId))) return false;
      if (moduleFilter && entry.moduleKey !== moduleFilter) return false;
      if (ageFilter && entry.ageBand !== ageFilter) return false;
      if (classFilter && !entry.classroomTitles.includes(classFilter)) return false;
      if (yearFilter && !entry.academicYears.includes(yearFilter)) return false;
      if (needle.length === 0) return true;
      return (
        entry.title.toLocaleLowerCase('ru-RU').includes(needle) ||
        (entry.brief ?? '').toLocaleLowerCase('ru-RU').includes(needle) ||
        (entry.goal ?? '').toLocaleLowerCase('ru-RU').includes(needle)
      );
    })
    .sort((a, b) => {
      if (sort === 'title') return a.title.localeCompare(b.title, 'ru');
      if (sort === 'handed') {
        return (
          new Date(b.lastHandedOutAt ?? 0).getTime() - new Date(a.lastHandedOutAt ?? 0).getTime()
        );
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

  const archivedCount = all.length - active.length;
  const rootCount = active.filter((entry) => entry.folderId === null).length;
  const filtersOn = Boolean(moduleFilter || ageFilter || classFilter || yearFilter);

  async function act(
    run: () => Promise<{ ok: boolean; error?: { message: string } }>,
    done: string,
  ): Promise<void> {
    const result = await run();
    if (!result.ok) {
      setError(result.error?.message ?? 'Не получилось.');
      return;
    }
    setError(null);
    setNotice(done);
    await reload();
  }

  function selectTab(next: 'bank' | 'courses' | 'catalogue'): void {
    setTab(next);
    setNotice(null);
    setError(null);
  }

  async function newFolder(parentId: string | null): Promise<void> {
    const title = window.prompt(
      parentId ? 'Название вложенной папки' : 'Название папки',
      parentId ? 'Подкатегория' : 'Электроника',
    );
    if (!title || !title.trim()) return;
    await act(
      () => api.createAssignmentFolder(title.trim(), parentId),
      `Папка «${title.trim()}» создана.`,
    );
  }

  return (
    <main id="main-content" className="portal-content" tabIndex={-1}>
      <header className="library-heading">
        <div>
          <h1>Курсы и задания</h1>
          <p>
            Собирайте программу из разделов, материалов и практики. В классах назначайте её ученикам
            и проверяйте работы.
          </p>
        </div>
        {tab === 'bank' ? (
          <button type="button" className="portal-create-button" onClick={() => setEditing('new')}>
            Новое задание
          </button>
        ) : null}
      </header>

      {/* Три ответа на три разных вопроса: что у меня есть, в каком порядке я
          это даю и что есть у коллег. */}
      <nav className="library-tabs" aria-label="Разделы курсов и заданий">
        <button
          type="button"
          className={tab === 'bank' ? 'is-active' : undefined}
          aria-current={tab === 'bank' ? 'page' : undefined}
          onClick={() => selectTab('bank')}
        >
          Банк заданий
        </button>
        <button
          type="button"
          className={tab === 'courses' ? 'is-active' : undefined}
          aria-current={tab === 'courses' ? 'page' : undefined}
          onClick={() => selectTab('courses')}
        >
          Мои курсы
        </button>
        <button
          type="button"
          className={tab === 'catalogue' ? 'is-active' : undefined}
          aria-current={tab === 'catalogue' ? 'page' : undefined}
          onClick={() => selectTab('catalogue')}
        >
          Каталог
        </button>
      </nav>

      {notice ? (
        <p className="notice-success" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      {tab === 'courses' ? (
        <CoursesPanel assignments={all} onChanged={() => void reload()} />
      ) : null}
      {tab === 'catalogue' ? (
        <CataloguePanel modules={modules} onTaken={() => void reload()} />
      ) : null}

      <div className="library-layout" hidden={tab !== 'bank'}>
        {/* Дерево отвечает на вопрос «куда я это положил». */}
        <aside className="library-tree" aria-label="Папки заданий">
          <div className="library-tree-head">
            <span>Папки</span>
            <button type="button" className="btn-secondary" onClick={() => void newFolder(null)}>
              + Папка
            </button>
          </div>
          <ul>
            <li>
              <button
                type="button"
                className={`library-folder${scope.kind === 'all' ? ' is-active' : ''}`}
                onClick={() => setScope({ kind: 'all' })}
              >
                <span>Все задания</span>
                <em>{active.length}</em>
              </button>
            </li>
            {folders.map((folder) => (
              <li key={folder.id}>
                <button
                  type="button"
                  className={`library-folder${
                    scope.kind === 'folder' && scope.id === folder.id ? ' is-active' : ''
                  }`}
                  style={{ paddingLeft: `${8 + (folder.depth - 1) * 16}px` }}
                  onClick={() => setScope({ kind: 'folder', id: folder.id })}
                >
                  <span>{folder.title}</span>
                  <em>{folder.totalCount}</em>
                </button>
                {scope.kind === 'folder' && scope.id === folder.id ? (
                  <div className="library-folder-tools">
                    <button type="button" onClick={() => void newFolder(folder.id)}>
                      Вложенная
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const title = window.prompt('Новое название папки', folder.title);
                        if (!title || !title.trim()) return;
                        void act(
                          () => api.updateAssignmentFolder(folder.id, { title: title.trim() }),
                          'Папка переименована.',
                        );
                      }}
                    >
                      Переименовать
                    </button>
                    <button
                      type="button"
                      className="assignment-remove"
                      onClick={() => {
                        if (
                          !window.confirm(
                            `Удалить папку «${folder.title}»? Задания и вложенные папки не пропадут — они поднимутся на уровень выше.`,
                          )
                        )
                          return;
                        setScope({ kind: 'all' });
                        void act(
                          () => api.deleteAssignmentFolder(folder.id),
                          `Папка «${folder.title}» удалена, задания остались.`,
                        );
                      }}
                    >
                      Удалить
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
            <li>
              <button
                type="button"
                className={`library-folder${scope.kind === 'root' ? ' is-active' : ''}`}
                onClick={() => setScope({ kind: 'root' })}
              >
                <span>Без папки</span>
                <em>{rootCount}</em>
              </button>
            </li>
            <li>
              {/* Старые годы убираются из списка, но остаются в базе: вместе с
                  заданием исчезли бы выдачи и работы учеников за тот год. */}
              <button
                type="button"
                className={`library-folder${scope.kind === 'archive' ? ' is-active' : ''}`}
                onClick={() => setScope({ kind: 'archive' })}
              >
                <span>Архив</span>
                <em>{archivedCount}</em>
              </button>
            </li>
          </ul>
        </aside>

        <section className="library-main">
          <div className="library-filters">
            <label className="library-search">
              <span className="sr-only">Поиск заданий</span>
              <input
                type="search"
                placeholder="Поиск по названию, цели или описанию"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <label>
              <span className="sr-only">Среда</span>
              <select value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value)}>
                <option value="">Любая среда</option>
                {facets.modules.map((key) => (
                  <option key={key} value={key}>
                    {moduleName(key)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="sr-only">Возраст</span>
              <select value={ageFilter} onChange={(e) => setAgeFilter(e.target.value)}>
                <option value="">Любой возраст</option>
                {facets.ages.map((band) => (
                  <option key={band} value={band}>
                    {ageLabel(band)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="sr-only">Класс</span>
              <select value={classFilter} onChange={(e) => setClassFilter(e.target.value)}>
                <option value="">Любой класс</option>
                {facets.classes.map((title) => (
                  <option key={title} value={title}>
                    {title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="sr-only">Учебный год</span>
              <select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}>
                <option value="">Любой год</option>
                {facets.years.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="sr-only">Порядок</span>
              <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
                {SORTS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            {filtersOn ? (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setModuleFilter('');
                  setAgeFilter('');
                  setClassFilter('');
                  setYearFilter('');
                }}
              >
                Сбросить отбор
              </button>
            ) : null}
          </div>

          {items === null ? (
            <p role="status">Загружаем задания…</p>
          ) : visible.length === 0 ? (
            <div className="classroom-roster-empty">
              <h3>{needle || filtersOn ? 'Ничего не найдено' : 'Здесь пока пусто'}</h3>
              <p>
                {scope.kind === 'archive'
                  ? 'В архив попадают задания прошлых лет. Работы учеников по ним остаются на месте.'
                  : 'Напишите задание — потом его можно будет выдать сразу нескольким классам.'}
              </p>
            </div>
          ) : (
            <ul className="library-list" data-testid="assignment-library">
              {visible.map((assignment) => (
                <li key={assignment.id}>
                  {assignment.sampleImage ? (
                    <img src={assignment.sampleImage} alt="" width={72} height={72} />
                  ) : (
                    <span className="library-no-sample" aria-hidden="true" />
                  )}
                  <div className="library-copy">
                    <strong>
                      {assignment.title}
                      {assignment.isDemo ? <em>пример</em> : null}
                      {assignment.copiedFrom ? <em>копия</em> : null}
                      {assignment.visibility !== 'private' ? (
                        <em className={`is-visibility is-${assignment.visibility}`}>
                          {visibilityLabel(assignment.visibility)}
                        </em>
                      ) : null}
                      {assignment.courseTitles.map((course) => (
                        <em key={course} className="is-course">
                          {course}
                        </em>
                      ))}
                      {assignment.archivedAt ? <em className="is-archived">в архиве</em> : null}
                      {/* Папка — отдельной меткой: рядом со средой она читается
                          как повтор, когда названия совпадают. */}
                      {assignment.folderTitle ? (
                        <em className="is-folder">{assignment.folderTitle}</em>
                      ) : null}
                    </strong>
                    <span>
                      {moduleName(assignment.moduleKey)}
                      {assignment.ageBand ? ` · ${ageLabel(assignment.ageBand)}` : ''}
                      {` · создано ${time.date(assignment.createdAt)}`}
                    </span>
                    {assignment.goal ? (
                      <span className="library-goal-line">Цель: {assignment.goal}</span>
                    ) : null}
                    <span className="library-counts">
                      {assignment.handoutCount === 0
                        ? 'Не выдано ни одному классу'
                        : `Выдано классам: ${assignment.handoutCount} · работают: ${assignment.startedCount} · сдали: ${assignment.submittedCount}`}
                    </span>
                    {/* Кому и когда выдавалось: этой строкой задание и находят
                        через год, когда название уже ничего не говорит. */}
                    {assignment.classroomTitles.length > 0 ? (
                      <span className="library-history">
                        {assignment.classroomTitles.join(', ')}
                        {assignment.academicYears.length > 0
                          ? ` · ${assignment.academicYears.join(', ')}`
                          : ''}
                      </span>
                    ) : null}
                  </div>
                  {/* Часто нужное — кнопками, редкое — в меню. Шесть кнопок в
                      ряд не помещались и залезали на текст карточки. */}
                  <div className="library-actions">
                    <button
                      type="button"
                      className="portal-create-button"
                      onClick={() => setHandingOut(assignment)}
                    >
                      Выдать классам
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => setEditing(assignment)}
                    >
                      Изменить
                    </button>
                    <label className="library-move">
                      <span className="sr-only">Папка задания</span>
                      <select
                        value={assignment.folderId ?? ''}
                        onChange={(event) =>
                          void act(
                            () =>
                              api.moveAssignmentToFolder(assignment.id, event.target.value || null),
                            'Задание перемещено.',
                          )
                        }
                      >
                        <option value="">Без папки</option>
                        {folders.map((folder) => (
                          <option key={folder.id} value={folder.id}>
                            {'— '.repeat(folder.depth - 1) + folder.title}
                          </option>
                        ))}
                      </select>
                    </label>
                    <Dropdown
                      className="library-row-menu"
                      ariaLabel={`Ещё: ${assignment.title}`}
                      label={<span aria-hidden="true">•••</span>}
                    >
                      {(close) => (
                        <>
                          {/* Переделка под свой класс не должна менять задание
                              всем остальным — для этого копия, а не правка. */}
                          <button
                            type="button"
                            onClick={() => {
                              close();
                              setSharing(assignment);
                            }}
                          >
                            Кому видно…
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              close();
                              void act(
                                () => api.copyLibraryAssignment(assignment.id),
                                `Копия задания «${assignment.title}» создана — правьте её, исходник цел.`,
                              );
                            }}
                          >
                            Сделать копию
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              close();
                              void act(
                                () =>
                                  api.archiveAssignment(
                                    assignment.id,
                                    assignment.archivedAt === null,
                                  ),
                                assignment.archivedAt === null
                                  ? 'Задание убрано в архив. Работы учеников остались.'
                                  : 'Задание вернулось в работу.',
                              );
                            }}
                          >
                            {assignment.archivedAt === null ? 'Убрать в архив' : 'Вернуть в работу'}
                          </button>
                          <button
                            type="button"
                            className="is-danger"
                            onClick={async () => {
                              close();
                              if (
                                !window.confirm(
                                  `Удалить «${assignment.title}» из ваших заданий? Оно пропадёт и у классов, которым выдано. Работы учеников останутся у них.`,
                                )
                              )
                                return;
                              await act(
                                () => api.deleteLibraryAssignment(assignment.id),
                                `Задание «${assignment.title}» удалено.`,
                              );
                            }}
                          >
                            Удалить
                          </button>
                        </>
                      )}
                    </Dropdown>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {editing ? (
        <AssignmentEditorDialog
          assignment={editing === 'new' ? null : editing}
          modules={modules}
          folders={folders}
          defaultFolderId={scope.kind === 'folder' ? scope.id : null}
          onClose={() => setEditing(null)}
          onSaved={async (_id, draft) => {
            setEditing(null);
            setNotice(`Задание «${draft.title}» сохранено.`);
            await reload();
            return null;
          }}
        />
      ) : null}

      {sharing ? (
        <ShareDialog
          kind="assignment"
          subjectId={sharing.id}
          title={sharing.title}
          visibility={sharing.visibility}
          onClose={() => setSharing(null)}
          onChanged={() => void reload()}
        />
      ) : null}

      {handingOut ? (
        <HandOutDialog
          assignment={handingOut}
          onClose={() => setHandingOut(null)}
          onChanged={() => void reload()}
        />
      ) : null}
    </main>
  );
}
