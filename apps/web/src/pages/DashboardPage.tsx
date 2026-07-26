import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type Classroom, type PublicUser } from '../api';
import { CreateClassroomModal } from '../components/CreateClassroomModal';

type ListState = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; items: Classroom[] };

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
  const [logoutError, setLogoutError] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);
  const createButtonRef = useRef<HTMLButtonElement>(null);

  const reload = useCallback(async () => {
    setList({ kind: 'loading' });
    const result = await api.listClassrooms();
    if (result.ok) {
      setList({ kind: 'ready', items: result.data.items });
    } else {
      setList({ kind: 'error' });
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // While the dialog is open the background must be inert for keyboard and
  // assistive tech; the dialog itself lives outside this subtree.
  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) {
      return;
    }
    if (modalOpen) {
      shell.setAttribute('inert', '');
      shell.setAttribute('aria-hidden', 'true');
    } else {
      shell.removeAttribute('inert');
      shell.removeAttribute('aria-hidden');
    }
  }, [modalOpen]);

  function closeModal(): void {
    setModalOpen(false);
    // Focus returns to the control that opened the dialog.
    requestAnimationFrame(() => createButtonRef.current?.focus());
  }

  async function logout(): Promise<void> {
    setLogoutError(false);
    const result = await api.logout();
    if (result.ok) {
      onLoggedOut();
    } else {
      // An unconfirmed server-side logout must not be presented as success.
      setLogoutError(true);
    }
  }

  return (
    <>
      <div className="shell" ref={shellRef}>
        <header className="topbar">
          <span className="brand">ASA Lab</span>
          <nav aria-label="Основная навигация">
            <a href="#classes" className="nav-link nav-active" aria-current="page">
              Классы
            </a>
          </nav>
          <div className="topbar-user">
            <span className="user-name">{user.displayName}</span>
            <button type="button" className="btn-ghost" onClick={() => void logout()}>
              Выйти
            </button>
          </div>
        </header>

        <main id="classes" className="content">
          <div className="content-head">
            <h1>Мои классы</h1>
            <button
              type="button"
              ref={createButtonRef}
              className="btn-primary"
              onClick={() => setModalOpen(true)}
            >
              Создать класс
            </button>
          </div>

          {logoutError ? (
            <p className="form-error" role="alert">
              Не удалось завершить сеанс на сервере. Попробуйте выйти ещё раз.
            </p>
          ) : null}

          {notice ? (
            <p className="notice-success" role="status">
              {notice}
            </p>
          ) : null}

          {list.kind === 'loading' ? (
            <div className="card-grid" aria-hidden="true">
              <div className="card skeleton" />
              <div className="card skeleton" />
              <div className="card skeleton" />
            </div>
          ) : null}

          {list.kind === 'error' ? (
            <div className="empty-state" role="alert">
              <p>Не удалось загрузить классы.</p>
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
            <ul className="card-grid" data-testid="classroom-grid">
              {list.items.map((classroom) => (
                <li key={classroom.id} className="card" data-testid="classroom-card">
                  <h2>{classroom.title}</h2>
                  <p className="muted">Активный класс</p>
                </li>
              ))}
            </ul>
          ) : null}
        </main>
      </div>

      {modalOpen ? (
        <CreateClassroomModal
          onClose={closeModal}
          onCreated={(classroom, created) => {
            closeModal();
            setNotice(
              created
                ? `Класс «${classroom.title}» создан.`
                : `Класс «${classroom.title}» уже существует.`,
            );
            void reload();
          }}
        />
      ) : null}
    </>
  );
}
