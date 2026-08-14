import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type Classroom } from '../api';
import { CreateClassroomModal } from '../components/CreateClassroomModal';
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

function formatClassroomDate(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
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
  const createButtonRef = useRef<HTMLButtonElement>(null);

  const reload = useCallback(async () => {
    setList({ kind: 'loading' });
    const result = await api.listClassrooms();
    if (result.ok) setList({ kind: 'ready', items: result.data.items });
    else if (result.status === 0)
      setList({ kind: 'error', message: 'Сервер недоступен. Проверьте соединение.' });
    else setList({ kind: 'error', message: 'Не удалось загрузить классы.' });
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  function closeModal(): void {
    setModalOpen(false);
    window.requestAnimationFrame(() => createButtonRef.current?.focus({ preventScroll: true }));
  }

  const visibleItems = list.kind === 'ready' && roleView === 'teaching' ? list.items : [];
  const allSelected = visibleItems.length > 0 && selected.size === visibleItems.length;

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
          onClick={() => {
            setNotice(null);
            setModalOpen(true);
          }}
        >
          <PlusIcon /> Создать новый класс
        </button>
        <button type="button" className="btn-secondary classroom-bulk-action" disabled>
          Действия⌄
        </button>
        <button
          type="button"
          className="classroom-sort-button"
          aria-label="Сортировка по дате создания"
        >
          Дата создания⌄
        </button>
      </section>

      {list.kind === 'loading' && roleView === 'teaching' ? (
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
      {list.kind === 'ready' && roleView === 'teaching' && list.items.length === 0 ? (
        <section className="portal-empty">
          <span className="portal-empty-icon">
            <ClassesIcon />
          </span>
          <h2>Создайте первый класс</h2>
          <p>Классы нужны для учеников, заданий и проверки. Личные проекты доступны отдельно.</p>
          <button type="button" className="portal-create-button" onClick={() => setModalOpen(true)}>
            <PlusIcon /> Создать класс
          </button>
        </section>
      ) : null}
      {list.kind === 'ready' && roleView !== 'teaching' ? (
        <section className="classroom-tab-empty">
          <span aria-hidden="true">
            <ClassesIcon />
          </span>
          <h2>Здесь пока нет классов</h2>
          <p>
            {roleView === 'archived'
              ? 'Архивированные классы появятся в этом разделе.'
              : roleView === 'coteaching'
                ? 'Здесь появятся классы, которые вы ведёте вместе с коллегами.'
                : 'Здесь появятся классы, в которых вы зарегистрированы как участник.'}
          </p>
        </section>
      ) : null}
      {list.kind === 'ready' && roleView === 'teaching' && list.items.length > 0 ? (
        <ul className="classroom-list" data-testid="classroom-grid" aria-label="Мои классы">
          {list.items.map((classroom) => (
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
              </button>
              <span className="classroom-row-students">Ученики: —</span>
              <span className="classroom-row-date">
                <small>Дата создания</small>
                {formatClassroomDate(classroom.createdAt)}
              </span>
              <details className="classroom-row-menu">
                <summary aria-label={`Действия с классом ${classroom.title}`}>•••</summary>
                <div>
                  <button
                    type="button"
                    onClick={() => onOpenProjects(classroom.id, classroom.title)}
                  >
                    Открыть класс
                  </button>
                  <button
                    type="button"
                    disabled
                    title="Серверное архивирование будет добавлено следующим шагом"
                  >
                    Архивировать
                  </button>
                </div>
              </details>
            </li>
          ))}
        </ul>
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
            window.requestAnimationFrame(() =>
              createButtonRef.current?.focus({ preventScroll: true }),
            );
            void reload();
          }}
        />
      ) : null}
    </main>
  );
}
