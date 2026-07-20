import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type Classroom, type PublicUser } from '../api';
import { CreateClassroomModal } from '../components/CreateClassroomModal';

type ListState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; items: Classroom[] };

export function DashboardPage({
  user,
  onLoggedOut,
}: {
  user: PublicUser;
  onLoggedOut: () => void;
}): JSX.Element {
  const [list, setList] = useState<ListState>({ kind: 'loading' });
  const [modalOpen, setModalOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const createButtonRef = useRef<HTMLButtonElement>(null);

  const reload = useCallback(async () => {
    setList({ kind: 'loading' });
    const result = await api.listClassrooms();
    if (result.ok) {
      setList({ kind: 'ready', items: result.data.items });
    } else if (result.status === 0) {
      setList({ kind: 'error', message: 'Сервер недоступен. Проверьте соединение.' });
    } else {
      setList({ kind: 'error', message: 'Не удалось загрузить классы.' });
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  function restoreCreateButtonFocus(): void {
    window.requestAnimationFrame(() => createButtonRef.current?.focus({ preventScroll: true }));
  }

  function closeModal(): void {
    setModalOpen(false);
    restoreCreateButtonFocus();
  }

  async function logout(): Promise<void> {
    if (logoutBusy) return;
    setLogoutBusy(true);
    setLogoutError(null);
    const result = await api.logout();
    setLogoutBusy(false);
    if (result.ok) {
      onLoggedOut();
      return;
    }
    setLogoutError(
      result.status === 0
        ? 'Не удалось связаться с сервером. Сессия не завершена.'
        : 'Не удалось завершить сессию. Попробуйте ещё раз.',
    );
  }

  return (
    <div className="shell">
      <header className="topbar">
        <span className="brand">ASA Lab</span>
        <nav aria-label="Основная навигация">
          <a href="#classes" className="nav-link nav-active" aria-current="page">
            Классы
          </a>
        </nav>
        <div className="topbar-user">
          <span className="user-name">{user.displayName}</span>
          <button
            type="button"
            className="btn-ghost"
            disabled={logoutBusy}
            aria-busy={logoutBusy}
            onClick={() => void logout()}
          >
            {logoutBusy ? 'Выходим…' : 'Выйти'}
          </button>
        </div>
      </header>

      <main id="classes" className="content" aria-busy={list.kind === 'loading'}>
        <div className="content-head">
          <h1>Мои классы</h1>
          <button
            ref={createButtonRef}
            type="button"
            className="btn-primary"
            onClick={() => {
              setNotice(null);
              setModalOpen(true);
            }}
          >
            Создать класс
          </button>
        </div>

        {logoutError ? (
          <p className="notice-error" role="alert">
            {logoutError}
          </p>
        ) : null}

        {notice ? (
          <p className="notice-success" role="status" aria-live="polite">
            {notice}
          </p>
        ) : null}

        {list.kind === 'loading' ? (
          <section aria-label="Загрузка классов" role="status" aria-live="polite">
            <span className="sr-only">Загружаем список классов…</span>
            <div className="card-grid" aria-hidden="true">
              <div className="card skeleton" />
              <div className="card skeleton" />
              <div className="card skeleton" />
            </div>
          </section>
        ) : null}

        {list.kind === 'error' ? (
          <div className="empty-state" role="alert">
            <p>{list.message}</p>
            <button type="button" className="btn-secondary" onClick={() => void reload()}>
              Повторить
            </button>
          </div>
        ) : null}

        {list.kind === 'ready' && list.items.length === 0 ? (
          <div className="empty-state">
            <p>Классов пока нет.</p>
            <p className="muted">Создайте первый класс, чтобы начать работу.</p>
          </div>
        ) : null}

        {list.kind === 'ready' && list.items.length > 0 ? (
          <ul className="card-grid" data-testid="classroom-grid" aria-label="Мои классы">
            {list.items.map((classroom) => (
              <li key={classroom.id} className="card" data-testid="classroom-card">
                <h2>{classroom.title}</h2>
                <p className="muted">Активный класс</p>
              </li>
            ))}
          </ul>
        ) : null}
      </main>

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
            restoreCreateButtonFocus();
            void reload();
          }}
        />
      ) : null}
    </div>
  );
}
