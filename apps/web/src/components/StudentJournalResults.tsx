import { useCallback, useEffect, useRef, useState } from 'react';
import {
  journalApi,
  journalAccessibleLabel,
  journalPresets,
  journalMonthRange,
  type JournalResultsPage,
  type JournalScope,
} from '../classroom-journal-api';
import { onSessionLoggedOut } from '../session-fetch';
import { useJournalDestination } from '../learning/journal-destination';
import { JournalMonthNavigation } from './JournalMonthNavigation';
import { schoolTimeFormats } from './school-time';
import './manual-classroom-journal.css';

/** Explicit identity surface. No fallback, shared cache, fetch-all or polling. */
export function StudentJournalResults({ scope }: { scope: JournalScope }) {
  return <Results key={scope} scope={scope} />;
}
function Results({ scope }: { scope: JournalScope }) {
  const destination = useJournalDestination();
  const [month, setMonth] = useState(destination.month);
  const [columnId, setColumnId] = useState(destination.columnId);
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<JournalResultsPage | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const active = useRef(false);
  useEffect(() => {
    setMonth(destination.month);
    setColumnId(destination.columnId);
    setOffset(0);
    setData(null);
  }, [destination.month, destination.columnId]);
  const load = useCallback(async () => {
    const current = ++generation.current;
    // Cookies can change while mounted. Clear before revalidating and reject
    // out-of-order reads, so an error cannot retain another identity's data.
    setData(null);
    setError('');
    setBusy(true);
    const result = await journalApi.results(scope, {
      ...(month ? journalMonthRange(month) : {}),
      offset,
      ...(columnId === undefined ? {} : { columnId }),
    });
    if (!active.current || current !== generation.current) return;
    setBusy(false);
    if (result.ok) setData(result.data);
    else {
      setData(null);
      setError(result.error.message);
    }
  }, [scope, month, offset, columnId]);
  useEffect(() => {
    active.current = true;
    void load();
    const focus = () => {
      void load();
    };
    const visibility = () => {
      if (document.visibilityState === 'visible') void load();
      else {
        generation.current += 1;
        setData(null);
      }
    };
    const unsubscribe = onSessionLoggedOut(() => {
      generation.current += 1;
      setData(null);
      setBusy(false);
      setError('Войдите заново, чтобы увидеть оценки.');
    });
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      active.current = false;
      generation.current += 1;
      unsubscribe();
      window.removeEventListener('focus', focus);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [load]);
  const shownMonth = month || data?.range.from.slice(0, 7) || '';
  return (
    <section className="student-journal-results" aria-label="Мои оценки по датам">
      <h2>Мои оценки по датам</h2>
      <JournalMonthNavigation
        month={shownMonth}
        disabled={busy}
        onChange={(next) => {
          setData(null);
          setMonth(next);
          setColumnId(undefined);
          setOffset(0);
        }}
      />
      <button onClick={() => void load()} disabled={busy}>
        Обновить оценки
      </button>
      {columnId ? (
        <p>
          Оценка из оповещения.{' '}
          <button
            onClick={() => {
              setData(null);
              setColumnId(undefined);
              setOffset(0);
            }}
          >
            Все оценки месяца
          </button>
        </p>
      ) : null}
      {error ? (
        <p role="alert">
          {error} <button onClick={() => void load()}>Повторить загрузку оценок</button>
        </p>
      ) : null}
      {busy ? <p role="status">Загружаем оценки…</p> : null}
      {data?.items.length === 0 ? (
        <p>За выбранный месяц оценок нет. Прежние оценки доступны в других месяцах.</p>
      ) : null}
      <ul>
        {data?.items.map((r) => (
          <li key={r.columnId + ':' + r.seatId} id={'journal-result-' + r.id}>
            <div>
              <strong>{r.category}</strong>
              <span>
                {r.date.split('-').reverse().join('.')} · {r.classroomTitle}
              </span>
            </div>
            <b>{journalAccessibleLabel(r.preset, r.value)}</b>
            <small>
              {journalPresets[r.preset]} · {r.authorName} ·{' '}
              {schoolTimeFormats(r.timeZone).dateTime(r.publishedAt)} · {r.timeZone}
              {r.revision > 1 ? ' · исправлено' : ''}
            </small>
            {r.reason ? <p>{r.reason}</p> : null}
          </li>
        ))}
      </ul>
      <nav className="manual-journal-toolbar" aria-label="Страницы моих оценок">
        <button
          disabled={busy || offset === 0}
          onClick={() => {
            setData(null);
            setOffset(Math.max(0, offset - 20));
          }}
        >
          Предыдущая страница оценок
        </button>
        <button
          disabled={busy || data?.nextOffset == null}
          onClick={() => {
            if (data?.nextOffset != null) {
              setData(null);
              setOffset(data.nextOffset);
            }
          }}
        >
          Следующая страница оценок
        </button>
      </nav>
    </section>
  );
}
