import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type Classroom } from '../api';
import { CreateClassroomModal } from '../components/CreateClassroomModal';
import { PortalLink } from '../components/PortalLink';
import { creatorViewToHash } from '../creator-portal/navigation';
import { ClassesIcon, PlusIcon } from '@asa-lab/ui-kit';

type ListState =
  { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; items: Classroom[] };

export function DashboardPage({
  onOpenProjects,
}: {
  onOpenProjects: (classroomId: string, classroomTitle: string) => void;
}): JSX.Element {
  const [list, setList] = useState<ListState>({ kind: 'loading' });
  const [modalOpen, setModalOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
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

  return (
    <main
      id="main-content"
      className="portal-content"
      tabIndex={-1}
      aria-busy={list.kind === 'loading'}
    >
      <section className="portal-hero">
        <div>
          <p className="portal-eyebrow">Учебные группы</p>
          <h1>Мои классы</h1>
          <p>Управляйте классами отдельно от личной мастерской и будущих предметных проектов.</p>
        </div>
        <button
          ref={createButtonRef}
          type="button"
          className="portal-create-button"
          onClick={() => {
            setNotice(null);
            setModalOpen(true);
          }}
        >
          <PlusIcon /> Создать класс
        </button>
      </section>

      {notice ? (
        <p className="notice-success" role="status" aria-live="polite">
          {notice}
        </p>
      ) : null}

      {list.kind === 'loading' ? (
        <section className="classroom-gallery loading" role="status" aria-label="Загрузка классов">
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
      {list.kind === 'ready' && list.items.length === 0 ? (
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
      {list.kind === 'ready' && list.items.length > 0 ? (
        <ul className="classroom-gallery" data-testid="classroom-grid" aria-label="Мои классы">
          {list.items.map((classroom) => (
            <li key={classroom.id} className="classroom-gallery-card" data-testid="classroom-card">
              <div className="classroom-card-icon">
                <ClassesIcon />
              </div>
              <div className="classroom-card-copy">
                <h2>{classroom.title}</h2>
                <p>Активный класс</p>
              </div>
              <PortalLink
                className="btn-secondary"
                href={creatorViewToHash({
                  kind: 'classroom-projects',
                  classroomId: classroom.id,
                  classroomTitle: classroom.title,
                })}
                onNavigate={() => onOpenProjects(classroom.id, classroom.title)}
              >
                Открыть проекты класса
              </PortalLink>
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
