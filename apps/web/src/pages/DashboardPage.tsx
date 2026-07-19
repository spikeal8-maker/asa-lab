import { useCallback, useEffect, useState } from 'react';
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

  async function logout(): Promise<void> {
    await api.logout();
    onLoggedOut();
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
          <button type="button" className="btn-ghost" onClick={() => void logout()}>
            Выйти
          </button>
        </div>
      </header>

      <main id="classes" className="content">
        <div className="content-head">
          <h1>Мои классы</h1>
          <button type="button" className="btn-primary" onClick={() => setModalOpen(true)}>
            Создать класс
          </button>
        </div>

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

      {modalOpen ? (
        <CreateClassroomModal
          onClose={() => setModalOpen(false)}
          onCreated={(classroom, created) => {
            setModalOpen(false);
            setNotice(
              created
                ? `Класс «${classroom.title}» создан.`
                : `Класс «${classroom.title}» уже существует.`,
            );
            void reload();
          }}
        />
      ) : null}
    </div>
  );
}
