import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  journalApi,
  journalAccessibleLabel,
  journalGradeLabel,
  journalLevels,
  journalPresets,
  journalMonthRange,
  type JournalColumn,
  type JournalGrade,
  type JournalSnapshot,
} from '../classroom-journal-api';
import './manual-classroom-journal.css';
import { JournalMonthNavigation } from './JournalMonthNavigation';
import { useJournalDestination } from '../learning/journal-destination';
import { schoolTimeFormats } from './school-time';

function CellEditor({
  classroomId,
  column,
  student,
  grade,
  archived,
  onSaved,
  onClose,
  onRefresh,
  timeZone,
}: {
  classroomId: string;
  column: JournalColumn;
  student: { id: string; name: string };
  grade: JournalGrade | undefined;
  archived: boolean;
  onSaved: (grade: JournalGrade) => void;
  onClose: () => void;
  onRefresh: () => void;
  timeZone: string;
}) {
  const [value, setValue] = useState(grade?.value == null ? '' : String(grade.value));
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<JournalGrade[] | null>(null);
  const [historyError, setHistoryError] = useState('');
  const [reloadHistory, setReloadHistory] = useState(0);
  const [historyBefore, setHistoryBefore] = useState<number | undefined>();
  const [nextHistory, setNextHistory] = useState<number | null>(null);
  const [historyPages, setHistoryPages] = useState<(number | undefined)[]>([]);
  const receipt = useRef<{ payload: string; id: string } | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    let active = true;
    setHistory(null);
    setHistoryError('');
    setNextHistory(null);
    void journalApi.history(classroomId, column.id, student.id, historyBefore).then((r) => {
      if (!active) return;
      if (r.ok) {
        setHistory(r.data.items);
        setNextHistory(r.data.nextBeforeRevision);
        setHistoryError('');
      } else setHistoryError(r.error.message);
    });
    return () => {
      active = false;
      mounted.current = false;
    };
  }, [classroomId, column.id, student.id, reloadHistory, historyBefore]);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || archived || conflict || (grade && !reason.trim()) || (!grade && value === ''))
      return;
    const input = {
      columnId: column.id,
      seatId: student.id,
      value: value === '' ? null : Number(value),
      reason: reason.trim() || null,
      expectedRevision: grade?.revision ?? 0,
    };
    const payload = JSON.stringify(input);
    if (receipt.current?.payload !== payload)
      receipt.current = { payload, id: crypto.randomUUID() };
    setBusy(true);
    setError('');
    const r = await journalApi.grade(classroomId, { ...input, requestId: receipt.current.id });
    if (!mounted.current) return;
    setBusy(false);
    if (r.ok) onSaved(r.data);
    else {
      setError(r.error.message);
      setConflict(r.status === 409);
    }
  }
  return (
    <section className="manual-journal-editor" aria-label={`Оценка: ${student.name}`}>
      <header>
        <h3>
          {student.name} · {column.date} · {column.category}
        </h3>
        <button disabled={busy} onClick={onClose}>
          Закрыть
        </button>
      </header>
      <p>
        Шкала: {journalPresets[column.preset]}, версия {column.scaleVersion}.
      </p>
      <form onSubmit={(e) => void save(e)}>
        <fieldset disabled={busy || archived || conflict}>
          <label>
            Оценка{' '}
            <select autoFocus value={value} onChange={(e) => setValue(e.target.value)}>
              <option value="">Нет оценки (очистить)</option>
              {journalLevels(column.preset).map((v) => (
                <option key={v} value={v}>
                  {journalAccessibleLabel(column.preset, v)}
                </option>
              ))}
            </select>
          </label>
          {['smileys', 'symbols'].includes(column.preset) ? (
            <p>Уровни возрастают от 1 до 5.</p>
          ) : null}
          {grade ? (
            <label>
              Причина изменения{' '}
              <input
                value={reason}
                required
                maxLength={500}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
          ) : null}
          <button
            type="submit"
            className="btn-primary"
            disabled={Boolean((grade && !reason.trim()) || (!grade && value === ''))}
          >
            {busy ? 'Сохраняем…' : error ? 'Повторить сохранение' : 'Сохранить оценку'}
          </button>
        </fieldset>
      </form>
      {error ? (
        <p role="alert">
          {error}
          {conflict ? <button onClick={onRefresh}>Обновить журнал</button> : null}
        </p>
      ) : null}
      {archived ? <p>Архивный класс: только просмотр.</p> : null}
      <details open>
        <summary>История оценки</summary>
        {historyError ? (
          <p role="alert">
            {historyError}{' '}
            <button onClick={() => setReloadHistory((n) => n + 1)}>
              Повторить загрузку истории
            </button>
          </p>
        ) : null}
        {!history && !historyError ? <p>Загружаем историю…</p> : null}
        {history?.length === 0 ? <p>Оценка ещё не выставлялась.</p> : null}
        <ol>
          {history?.map((r) => (
            <li key={r.id}>
              <strong>{journalAccessibleLabel(column.preset, r.value)}</strong> · {r.authorName} ·{' '}
              {schoolTimeFormats(timeZone).dateTime(r.publishedAt)}
              <p>{r.reason}</p>
            </li>
          ))}
        </ol>
        <nav aria-label="Страницы истории оценки">
          <button
            disabled={!history || historyPages.length === 0}
            onClick={() => {
              setHistoryBefore(historyPages[historyPages.length - 1]);
              setHistoryPages((old) => old.slice(0, -1));
            }}
          >
            Новые изменения
          </button>
          <button
            disabled={!history || nextHistory === null}
            onClick={() => {
              if (nextHistory !== null) {
                setHistoryPages((old) => [...old, historyBefore]);
                setHistoryBefore(nextHistory);
              }
            }}
          >
            Прежние изменения
          </button>
        </nav>
      </details>
    </section>
  );
}

export function ManualClassroomJournal({ classroomId }: { classroomId: string }) {
  return <Journal key={classroomId} classroomId={classroomId} />;
}
function Journal({ classroomId }: { classroomId: string }) {
  const destination = useJournalDestination();
  const [month, setMonth] = useState(destination.month);
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<JournalSnapshot | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [date, setDate] = useState('');
  const [category, setCategory] = useState('Работа на уроке');
  const [busy, setBusy] = useState(false);
  const [loadBusy, setLoadBusy] = useState(false);
  const [opened, setOpened] = useState<{
    column: JournalColumn;
    student: { id: string; name: string };
  } | null>(null);
  const active = useRef(false);
  const generation = useRef(0);
  const receipt = useRef<{ payload: string; id: string } | null>(null);
  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoadBusy(true);
    setData(null);
    setError('');
    const r = await journalApi.read(classroomId, {
      ...(month ? journalMonthRange(month) : {}),
      offset,
    });
    if (!active.current || current !== generation.current) return;
    setLoadBusy(false);
    if (r.ok) {
      setData(r.data);
      setDate((old) => old || r.data.range.today);
      setError('');
    } else {
      setData(null);
      setError(r.error.message);
    }
  }, [classroomId, month, offset]);
  useEffect(() => {
    active.current = true;
    void load();
    return () => {
      active.current = false;
      generation.current += 1;
    };
  }, [load]);
  async function addColumn(e: FormEvent) {
    e.preventDefault();
    if (!data || busy || data.status !== 'active' || loadBusy) return;
    const input = { date, category: category.trim(), expectedRevision: data.scale.version };
    const payload = JSON.stringify(input);
    if (receipt.current?.payload !== payload)
      receipt.current = { payload, id: crypto.randomUUID() };
    setBusy(true);
    setNotice('');
    setError('');
    generation.current += 1;
    const r = await journalApi.column(classroomId, { ...input, requestId: receipt.current.id });
    if (!active.current) return;
    setBusy(false);
    if (r.ok) {
      receipt.current = null;
      setNotice('Столбец сохранён.');
      if (month !== date.slice(0, 7) || offset !== 0) {
        setData(null);
        setMonth(date.slice(0, 7));
        setOffset(0);
      } else await load();
    } else setError(r.error.message);
  }
  const archived = data?.status !== 'active';
  const columns =
    data?.columns.filter((c) => !categoryFilter || c.category === categoryFilter) ?? [];
  const students =
    data?.students.filter((s) =>
      s.name.toLocaleLowerCase('ru-RU').includes(search.toLocaleLowerCase('ru-RU')),
    ) ?? [];
  const grades = new Map(data?.grades.map((g) => [`${g.columnId}:${g.seatId}`, g]));
  return (
    <section className="manual-journal" aria-label="Ручной журнал">
      <JournalMonthNavigation
        month={month || data?.range.from.slice(0, 7) || ''}
        disabled={busy || loadBusy}
        onChange={(next) => {
          setData(null);
          setOpened(null);
          setMonth(next);
          setOffset(0);
          setCategoryFilter('');
        }}
      />
      <div className="manual-journal-toolbar">
        <label>
          Поиск ученика{' '}
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <label>
          Категория{' '}
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="">Все категории</option>
            {[...new Set(data?.columns.map((c) => c.category))].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <button
          disabled={busy || loadBusy}
          onClick={() => {
            setOpened(null);
            receipt.current = null;
            void load();
          }}
        >
          Обновить журнал
        </button>
      </div>
      {error ? (
        <p role="alert">
          {error}{' '}
          <button disabled={busy || loadBusy} onClick={() => void load()}>
            Повторить загрузку
          </button>
        </p>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}
      {!data && !error ? <p role="status">Загружаем журнал…</p> : null}
      {data ? (
        <>
          {archived ? (
            <p>Архивный класс: только просмотр.</p>
          ) : (
            <form className="manual-journal-toolbar" onSubmit={(e) => void addColumn(e)}>
              <label>
                Дата занятия{' '}
                <input
                  type="date"
                  required
                  min="2000-01-01"
                  max="2100-12-31"
                  value={date}
                  disabled={busy}
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>
              <label>
                Категория занятия{' '}
                <input
                  required
                  maxLength={80}
                  list="journal-categories"
                  value={category}
                  disabled={busy}
                  onChange={(e) => setCategory(e.target.value)}
                />
              </label>
              <datalist id="journal-categories">
                <option value="Работа на уроке" />
                <option value="Домашняя работа" />
                {[...new Set(data.columns.map((c) => c.category))].map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
              <button
                type="submit"
                className="btn-primary"
                disabled={busy || loadBusy || !category.trim()}
              >
                {busy ? 'Добавляем…' : 'Добавить столбец'}
              </button>
            </form>
          )}
          <p className="manual-journal-hint">
            Нажмите ячейку, чтобы поставить оценку. Пусто — нет оценки. Ноль — отдельная оценка.{' '}
            Даты класса: {data.timeZone}. Прежние занятия доступны через выбор месяца.
          </p>
          <div
            className="manual-journal-scroll"
            tabIndex={0}
            role="region"
            aria-label="Таблица оценок по датам"
          >
            <table>
              <thead>
                <tr>
                  <th scope="col">Ученик</th>
                  {columns.map((c) => (
                    <th scope="col" key={c.id}>
                      <time dateTime={c.date}>{c.date.split('-').reverse().join('.')}</time>
                      <span>{c.category}</span>
                      <small>{journalPresets[c.preset]}</small>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {students.map((s) => (
                  <tr key={s.id}>
                    <th scope="row">
                      {s.name}
                      {!['issued', 'active'].includes(s.status) ? (
                        <small>Доступ закрыт</small>
                      ) : null}
                    </th>
                    {columns.map((c) => {
                      const grade = grades.get(`${c.id}:${s.id}`);
                      return (
                        <td key={c.id}>
                          <button
                            disabled={busy}
                            className="manual-journal-cell"
                            aria-label={`${s.name}, ${c.date}, ${c.category}: ${journalAccessibleLabel(c.preset, grade?.value ?? null)}`}
                            onClick={() => {
                              setOpened({ column: c, student: s });
                              setNotice('');
                            }}
                          >
                            {grade?.value == null ? '—' : journalGradeLabel(c.preset, grade.value)}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!columns.length ? (
            <p>
              За выбранный месяц занятий нет. Можно открыть другой месяц или добавить дату и
              категорию занятия.
            </p>
          ) : null}
          <nav className="manual-journal-toolbar" aria-label="Страницы столбцов журнала">
            <button
              disabled={busy || loadBusy || offset === 0}
              onClick={() => {
                setOpened(null);
                setData(null);
                setOffset(Math.max(0, offset - 50));
              }}
            >
              Предыдущие столбцы
            </button>
            <button
              disabled={busy || loadBusy || data.nextOffset === null}
              onClick={() => {
                if (data.nextOffset !== null) {
                  setOpened(null);
                  setData(null);
                  setOffset(data.nextOffset);
                }
              }}
            >
              Следующие столбцы
            </button>
          </nav>
          {!students.length ? <p>Ученики не найдены.</p> : null}
          {opened ? (
            <CellEditor
              key={`${opened.column.id}:${opened.student.id}:${grades.get(`${opened.column.id}:${opened.student.id}`)?.revision ?? 0}`}
              classroomId={classroomId}
              timeZone={data.timeZone}
              {...opened}
              grade={grades.get(`${opened.column.id}:${opened.student.id}`)}
              archived={
                archived ||
                !['issued', 'active'].includes(
                  data.students.find((s) => s.id === opened.student.id)?.status ?? '',
                )
              }
              onClose={() => setOpened(null)}
              onRefresh={() => {
                setOpened(null);
                void load();
              }}
              onSaved={(grade) => {
                generation.current += 1;
                setData((old) =>
                  old
                    ? {
                        ...old,
                        grades: [
                          ...old.grades.filter(
                            (g) => !(g.columnId === grade.columnId && g.seatId === grade.seatId),
                          ),
                          grade,
                        ],
                      }
                    : old,
                );
                setNotice(
                  grade.value === null ? 'Оценка очищена. История сохранена.' : 'Оценка сохранена.',
                );
                setOpened(null);
                void load();
              }}
            />
          ) : null}
        </>
      ) : null}
    </section>
  );
}
