import { useEffect, useState } from 'react';
import { observationApi, type ObservationProjectsPage } from '../classroom-observation-api';
import { seatAvatar } from '../creator-portal/default-avatars';
import { useSchoolTime } from './school-time';
import './classroom-observation.css';

const EDITORS: Record<string, string> = {
  'three-d': '3D',
  electronics: 'Электроника',
  blocks: 'Блоки',
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
      const result = await observationApi.projects(classroomId, {
        module,
        learner,
        search,
        assignment,
        archive: String(archive),
        offset,
        limit,
      });
      if (!current) return;
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
  return (
    <section className="classroom-observation" aria-label="Работы учеников" aria-busy={busy}>
      <div className="observation-heading">
        <h3>Работы учеников</h3>
        <span>Последнее изменение ↓</span>
      </div>
      <p className="observation-note">
        Проекты в 3D, электронике и блоках, в том числе без задания. Архив включается отдельно.
      </p>
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
                <li key={work.id} data-project-id={work.id}>
                  <img
                    src={seatAvatar(work.seatId, work.avatarKey).src}
                    alt=""
                    width={32}
                    height={32}
                  />
                  <div className="observation-project-title">
                    <strong>{work.title}</strong>
                    <span>{work.student}</span>
                  </div>
                  <span>{EDITORS[work.moduleKey] ?? work.moduleKey}</span>
                  <span>
                    {work.assigned ? 'По заданию' : 'Без задания'}
                    {work.status === 'archived' ? ' · Архив' : ''}
                  </span>
                  <time dateTime={work.updatedAt}>{time.dateTime(work.updatedAt)}</time>
                  <button
                    type="button"
                    aria-label={`Открыть работу ${work.title}`}
                    onClick={() => onOpenProject(work.id, work.moduleKey, work.seatId)}
                  >
                    Открыть
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
    </section>
  );
}
