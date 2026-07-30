import { useCallback, useEffect, useState } from 'react';
import { api, type Project } from '../api';
import { CreateProjectModal } from '../components/CreateProjectModal';
import { CircuitIcon, PlusIcon } from '../electronics/workbench-icons';

export function ProjectsPage({
  classroomId,
  classroomTitle,
  onBack,
  onOpenProject,
}: {
  classroomId: string;
  classroomTitle: string;
  onBack: () => void;
  onOpenProject: (projectId: string) => void;
}): JSX.Element {
  const [items, setItems] = useState<Project[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    const response = await api.listProjects({ scope: 'classroom', classroomId });
    if (response.ok) setItems(response.data.items);
    else setFailed(true);
  }, [classroomId]);

  useEffect(() => { void load(); }, [load]);

  return (
    <main className="portal-content" id="main-content">
      <button type="button" className="portal-back" onClick={onBack}>← К классам</button>
      <section className="portal-hero compact">
        <div>
          <p className="portal-eyebrow">Проекты класса</p>
          <h1>{classroomTitle}</h1>
          <p>Шаблоны и демонстрации, привязанные к этому классу.</p>
        </div>
        <button type="button" className="portal-create-button" onClick={() => setCreating(true)}><PlusIcon /> Создать проект</button>
      </section>

      {failed ? <div className="portal-empty" role="alert"><p>Не удалось загрузить проекты.</p><button className="btn-secondary" onClick={() => void load()}>Повторить</button></div> : null}
      {items === null && !failed ? <div className="project-gallery loading"><div/><div/></div> : null}
      {items?.length === 0 ? (
        <section className="portal-empty project-empty">
          <span className="portal-empty-icon"><CircuitIcon /></span>
          <h2>В классе пока нет проектов</h2>
          <p>Создайте демонстрацию или будущий шаблон задания.</p>
          <button type="button" className="portal-create-button" onClick={() => setCreating(true)}><PlusIcon /> Создать проект</button>
        </section>
      ) : null}
      {items && items.length > 0 ? (
        <ul className="project-gallery" data-testid="project-grid">
          {items.map((project) => (
            <li key={project.id} className="project-gallery-card" data-testid="project-card">
              <button type="button" className="project-preview" onClick={() => onOpenProject(project.id)}><span className="project-preview-grid"><CircuitIcon /></span></button>
              <div className="project-card-meta">
                <div><h2>{project.title}</h2><p>Электроника · {classroomTitle}</p></div>
                <button type="button" className="btn-secondary" onClick={() => onOpenProject(project.id)}>Открыть</button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {creating ? (
        <CreateProjectModal
          scope="classroom"
          classroomId={classroomId}
          onClose={() => setCreating(false)}
          onCreated={(project) => { setCreating(false); onOpenProject(project.id); }}
        />
      ) : null}
    </main>
  );
}
