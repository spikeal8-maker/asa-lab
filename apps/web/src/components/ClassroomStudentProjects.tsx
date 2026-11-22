import { useEffect, useState } from 'react';
import { observationApi, type ObservationProjectsPage } from '../classroom-observation-api';
import { useSchoolTime } from './school-time';
import { WorkPreview, WorkSnapshot } from './WorkPreview';
import './classroom-observation.css';

const EDITORS: Record<string, string> = {
  'three-d': '3D',
  electronics: 'Электроника',
  blocks: 'Scratch',
};
export function ClassroomStudentProjects({
  classroomId,
  onOpenProject,
}: {
  classroomId: string;
  onOpenProject: (projectId: string, moduleKey: string, seatId?: string) => void;
}): JSX.Element {
  // A keyed child discards filters/pages immediately when the class changes.
  return <ProjectList key={classroomId} classroomId={classroomId} onOpenProject={onOpenProject} />;
}
function ProjectList({
  classroomId,
  onOpenProject,
}: {
  classroomId: string;
  onOpenProject: (projectId: string, moduleKey: string, seatId?: string) => void;
}): JSX.Element {
  const time = useSchoolTime();
  const [module, setModule] = useState('');
  const [learner, setLearner] = useState('');
  const [search, setSearch] = useState('');
  const [assignment, setAssignment] = useState('');
  const [archive, setArchive] = useState(false);
  const [limit, setLimit] = useState(30);
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<ObservationProjectsPage | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [learners, setLearners] = useState<ObservationProjectsPage['learners']>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [retry, setRetry] = useState(0);
  const [prepared, setPrepared] = useState(false);
  useEffect(() => {
    let current = true;
    setBusy(true);
    setError(null);
    setPage(null);
    setPreviewId(null);
    void (async () => {
      if (!prepared) {
        const result = await observationApi.prepare([classroomId]);
        if (!current) return;
        if (!result.ok) {
          setError(result.error.message);
          setBusy(false);
          return;
        }
        setPrepared(true);
        return;
      }
      const filters = {
        module,
        learner,
        search,
        assignment,
        archive: String(archive),
        offset,
        limit,
      };
      const result = await observationApi.projects(classroomId, filters);
      if (!current) return;
      // A scoped 404 also covers loss of classroom access. Reset the filter only
      // after an authorized read confirms that this learner is no longer listed.
      if (learner && !result.ok && result.status === 404) {
        const currentClass = await observationApi.projects(classroomId, {
          ...filters,
          learner: '',
          offset: 0,
        });
        if (!current) return;
        if (
          currentClass.ok &&
          !currentClass.data.learners.some((student) => student.id === learner)
        ) {
          setLearners(currentClass.data.learners);
          setLearner('');
          setOffset(0);
          return;
        }
      }
      setBusy(false);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setPage(result.data);
      setLearners(result.data.learners);
    })();
    return () => {
      current = false;
    };
  }, [classroomId, module, learner, search, assignment, archive, offset, limit, retry, prepared]);
  useEffect(() => {
    const refresh = () => setRetry((value) => value + 1);
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);
  const preview = page?.items.find((work) => work.id === previewId);
  return (
    <section className="classroom-observation" aria-label="Работы учеников" aria-busy={busy}>
      <div className="observation-heading">
        <h3>Работы учеников</h3>
        <span>Последнее изменение ↓</span>
      </div>
      <div className="observation-filters">
        <label>
          Название
          <input
            type="search"
            aria-label="Название"
            maxLength={100}
            value={search}
            placeholder="Найти работу"
            onChange={(e) => {
              setSearch(e.target.value);
              setOffset(0);
            }}
          />
        </label>
        <label>
          Редактор
          <select
            aria-label="Редактор"
            value={module}
            onChange={(e) => {
              setModule(e.target.value);
              setOffset(0);
            }}
          >
            <option value="">Все редакторы</option>
            {Object.entries(EDITORS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Ученик
          <select
            aria-label="Ученик"
            value={learner}
            onChange={(e) => {
              setLearner(e.target.value);
              setOffset(0);
            }}
          >
            <option value="">Все ученики</option>
            {learners.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Задание
          <select
            aria-label="Задание"
            value={assignment}
            onChange={(e) => {
              setAssignment(e.target.value);
              setOffset(0);
            }}
          >
            <option value="">Все работы</option>
            <option value="assigned">По заданию</option>
            <option value="unassigned">Без задания</option>
          </select>
        </label>
        <label className="observation-checkbox">
          <input
            type="checkbox"
            checked={archive}
            onChange={(e) => {
              setArchive(e.target.checked);
              setOffset(0);
            }}
          />
          Включить архив
        </label>
      </div>
      {error && (
        <p role="alert">
          {error}{' '}
          <button type="button" onClick={() => setRetry((v) => v + 1)}>
            Повторить
          </button>
        </p>
      )}
      {busy && <p role="status">Загружаем работы…</p>}
      {page && (
        <>
          <p className="observation-note">
            Доступно по фильтрам: {page.total}.
            {page.hidden > 0 &&
              ` Ещё ${page.hidden} работ учтено в сводке; содержимое закрыто текущими правами.`}
          </p>
          {page.items.length === 0 ? (
            <p>По этим фильтрам доступных работ нет.</p>
          ) : (
            <ul className="observation-projects">
              {page.items.map((work) => (
                <li className="observation-project-card" key={work.id} data-project-id={work.id}>
                  <button
                    type="button"
                    className="observation-preview-trigger"
                    aria-label={`Предпросмотр работы ${work.title}, ${work.student}`}
                    aria-haspopup="dialog"
                    onClick={() => setPreviewId(work.id)}
                  >
                    <span className="observation-project-picture">
                      <WorkSnapshot
                        projectId={work.id}
                        alt=""
                        lazy
                        fallback={<span>Без снимка</span>}
                      />
                    </span>
                    <span className="observation-project-title">
                      <strong>{work.title}</strong>
                      <span>{work.student}</span>
                      <span className="observation-project-meta">
                        <span>{EDITORS[work.moduleKey] ?? work.moduleKey}</span>
                        <span>{work.assigned ? 'По заданию' : 'Без задания'}</span>
                        {work.status === 'archived' ? <span>Архив</span> : null}
                      </span>
                      <time dateTime={work.updatedAt}>{time.dateTime(work.updatedAt)}</time>
                    </span>
                  </button>
                  <button
                    className="observation-editor-action"
                    type="button"
                    aria-label={`Открыть в редакторе: ${work.title}`}
                    onClick={() => onOpenProject(work.id, work.moduleKey, work.seatId)}
                  >
                    Открыть в редакторе
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="observation-pagination">
            <button
              type="button"
              disabled={offset === 0 || busy}
              onClick={() => setOffset((v) => Math.max(0, v - limit))}
            >
              Назад
            </button>
            <span>
              {page.total
                ? `${offset + 1}–${offset + page.items.length} из ${page.total}`
                : '0 работ'}
            </span>
            <button
              type="button"
              disabled={page.nextOffset === null || busy}
              onClick={() => {
                if (page.nextOffset !== null) setOffset(page.nextOffset);
              }}
            >
              Далее
            </button>
            <label>
              На странице
              <select
                value={limit}
                onChange={(e) => {
                  setLimit(Number(e.target.value));
                  setOffset(0);
                }}
              >
                <option value={30}>30</option>
                <option value={50}>50</option>
              </select>
            </label>
          </div>
        </>
      )}
      {preview ? (
        <WorkPreview
          key={preview.id}
          readOnly
          projectId={preview.id}
          moduleKey={preview.moduleKey}
          learnerName={preview.student}
          workTitle={preview.title}
          submittedAt={null}
          onClose={() => setPreviewId(null)}
          onOpenEditor={() => {
            setPreviewId(null);
            onOpenProject(preview.id, preview.moduleKey, preview.seatId);
          }}
        />
      ) : null}
    </section>
  );
}
