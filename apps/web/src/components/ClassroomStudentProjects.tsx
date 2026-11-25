import { useEffect, useMemo, useState } from 'react';
import { observationApi, type ObservationProjectsPage } from '../classroom-observation-api';
import { useSchoolTime } from './school-time';
import { ClassroomWorkCard } from './ClassroomWorkCard';
import { WorkPreview } from './WorkPreview';
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
  const [snapshotRefresh, setSnapshotRefresh] = useState(0);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [learners, setLearners] = useState<ObservationProjectsPage['learners']>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [retry, setRetry] = useState(0);
  const [prepared, setPrepared] = useState(false);
  const filters = useMemo(
    () => ({ module, learner, search, assignment, archive: String(archive), offset, limit }),
    [module, learner, search, assignment, archive, offset, limit],
  );
  useEffect(() => {
    setPage(null);
    setPreviewId(null);
  }, [filters]);
  useEffect(() => {
    let current = true;
    setBusy(true);
    setError(null);
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
      const result = await observationApi.projects(classroomId, filters);
      if (!current) return;
      if (!result.ok) {
        setPage(null);
        setPreviewId(null);
        // A scoped 404 also covers loss of classroom access. Reset the filter only
        // after an authorized read confirms that this learner is no longer listed.
        if (filters.learner && result.status === 404) {
          const currentClass = await observationApi.projects(classroomId, {
            ...filters,
            learner: '',
            offset: 0,
          });
          if (!current) return;
          if (
            currentClass.ok &&
            !currentClass.data.learners.some((student) => student.id === filters.learner)
          ) {
            setLearners(currentClass.data.learners);
            setLearner('');
            setOffset(0);
            return;
          }
        }
        setBusy(false);
        setError(result.error.message);
        return;
      }
      setPage(result.data);
      // A new snapshot can arrive without changing the project's draft date.
      const refreshedAt = Date.now();
      setSnapshotRefresh((previous) => Math.max(refreshedAt, previous + 1));
      setPreviewId((id) => (result.data.items.some((work) => work.id === id) ? id : null));
      setLearners(result.data.learners);
      setBusy(false);
    })();
    return () => {
      current = false;
    };
  }, [classroomId, filters, retry, prepared]);
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
      {busy && !page && <p role="status">Загружаем работы…</p>}
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
            <ul className="observation-projects classroom-work-card-list">
              {page.items.map((work) => (
                <ClassroomWorkCard
                  key={work.id}
                  projectId={work.id}
                  title={work.title}
                  learner={work.student}
                  moduleLabel={EDITORS[work.moduleKey] ?? work.moduleKey}
                  status={<span>{work.assigned ? 'По заданию' : 'Без задания'}</span>}
                  archived={work.status === 'archived'}
                  updatedAt={work.updatedAt}
                  dateLabel={time.dateTime(work.updatedAt)}
                  refresh={snapshotRefresh}
                  onPreview={() => setPreviewId(work.id)}
                  editor={{ onOpen: () => onOpenProject(work.id, work.moduleKey, work.seatId) }}
                />
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
          key={`${classroomId}:${preview.seatId}:${preview.id}`}
          reviewScope={
            preview.assigned &&
            (preview.moduleKey === 'three-d' || preview.moduleKey === 'electronics')
              ? { classroomId, seatId: preview.seatId, canReview: preview.status !== 'archived' }
              : undefined
          }
          readOnly
          snapshotRefresh={snapshotRefresh}
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
