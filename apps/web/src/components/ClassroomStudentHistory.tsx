import { useEffect, useState } from 'react';
import { observationApi, type ObservationHistoryPage } from '../classroom-observation-api';
import { useSchoolTime } from './school-time';
import './classroom-observation.css';

const ACTIONS: Record<string, string> = {
  'seat.signed_in': 'Вход по коду класса',
  'seat.signed_out': 'Явный выход',
  'asa.signed_in': 'Вход в ASA Lab',
  'project.created': 'Создание проекта',
  'project.saved': 'Изменение проекта',
  'project.updated': 'Изменение проекта',
  'project.submitted': 'Сдача работы',
  'assignment.submitted': 'Сдача работы',
  'seat.activated': 'Активация ученика',
  'seat.joined': 'Присоединение к классу',
  'project.duplicated': 'Копирование проекта',
  'project.archived': 'Архивация проекта',
  'project.restored': 'Восстановление проекта',
  'project.trashed': 'Удаление проекта',
  'project.renamed': 'Переименование проекта',
  'project.checkpoint': 'Сохранение версии',
  'submission.created': 'Сдача работы',
};
export function ClassroomStudentHistory({ classroomId }: { classroomId: string }): JSX.Element {
  return <HistoryList key={classroomId} classroomId={classroomId} />;
}
function HistoryList({ classroomId }: { classroomId: string }): JSX.Element {
  const time = useSchoolTime();
  const [category, setCategory] = useState('all');
  const [learner, setLearner] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [cursor, setCursor] = useState<string | undefined>();
  const [previous, setPrevious] = useState<Array<string | undefined>>([]);
  const [page, setPage] = useState<ObservationHistoryPage | null>(null);
  const [learners, setLearners] = useState<ObservationHistoryPage['learners']>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [prepared, setPrepared] = useState(false);
  function resetPage() {
    setCursor(undefined);
    setPrevious([]);
  }
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
      // Date bounds are inclusive local calendar dates. The API uses an exclusive upper bound.
      const end = to ? new Date(`${to}T00:00:00`) : null;
      if (end) end.setDate(end.getDate() + 1);
      const result = await observationApi.history(classroomId, {
        category,
        learner,
        from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
        to: end?.toISOString(),
        cursor,
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
  }, [classroomId, category, learner, from, to, cursor, retry, prepared]);
  return (
    <section className="classroom-observation" aria-label="История класса" aria-busy={busy}>
      <div className="observation-heading">
        <h3>История класса</h3>
        <span>Сначала новые события</span>
      </div>
      <p className="observation-note">
        Вход в ASA Lab — общий вход в аккаунт. Выход показан только при явном действии; закрытие
        вкладки не считается выходом. Старые события могли не фиксироваться. Действия с закрытыми
        проектами скрыты.
      </p>
      <div className="observation-filters">
        <label>
          Действия
          <select
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              resetPage();
            }}
          >
            <option value="all">Все действия</option>
            <option value="access">Входы и доступ</option>
            <option value="projects">Работа с проектами</option>
          </select>
        </label>
        <label>
          Ученик
          <select
            value={learner}
            onChange={(e) => {
              setLearner(e.target.value);
              resetPage();
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
          С даты
          <input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              resetPage();
            }}
          />
        </label>
        <label>
          По дату
          <input
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              resetPage();
            }}
          />
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
      {busy && <p role="status">Загружаем историю…</p>}
      {page && (
        <>
          {page.items.length === 0 ? (
            <p>За выбранный период записанных действий нет.</p>
          ) : (
            <ol className="observation-history">
              {page.items.map((event) => (
                <li key={event.id}>
                  <time dateTime={event.at}>{time.dateTime(event.at)}</time>
                  <div>
                    <strong>
                      {event.byTeacher ? 'Преподаватель' : (event.student ?? 'Ученик')}
                    </strong>
                    <span>
                      {ACTIONS[event.action] ?? 'Действие в классе'}
                      {event.projectTitle ? ` · ${event.projectTitle}` : ''}
                      {event.count > 1 ? ` · ${event.count} раз` : ''}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          )}
          <div className="observation-pagination">
            <button
              type="button"
              disabled={!previous.length || busy}
              onClick={() => {
                setCursor(previous.at(-1));
                setPrevious((v) => v.slice(0, -1));
              }}
            >
              Назад
            </button>
            <button
              type="button"
              disabled={!page.nextCursor || busy}
              onClick={() => {
                if (page.nextCursor) {
                  setPrevious((v) => [...v, cursor]);
                  setCursor(page.nextCursor);
                }
              }}
            >
              Ранее
            </button>
          </div>
        </>
      )}
    </section>
  );
}
