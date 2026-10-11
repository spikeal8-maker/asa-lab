import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  journalApi,
  journalAccessibleLabel,
  journalGradeLabel,
  journalRevisionLabel,
  journalLevels,
  journalPresets,
  journalMonthRange,
  type JournalColumn,
  type JournalGrade,
  type JournalSnapshot,
  type JournalQuickResult,
} from '../classroom-journal-api';
import './manual-classroom-journal.css';
import { JournalMonthNavigation } from './JournalMonthNavigation';
import { useJournalDestination } from '../learning/journal-destination';
import { schoolTimeFormats } from './school-time';
import {
  journalRoster,
  journalSlots,
  journalRequestReceipt,
  type JournalRequestReceipt,
  type JournalSlot,
} from './quick-journal-model';

type Receipt = JournalRequestReceipt;
type Student = JournalSnapshot['students'][number];
function GradeHistory({
  classroomId,
  column,
  student,
  timeZone,
  onAccessLost,
}: {
  classroomId: string;
  column: JournalColumn;
  student: Student;
  timeZone: string;
  onAccessLost: (message: string) => void;
}) {
  const [items, setItems] = useState<JournalGrade[] | null>(null);
  const [error, setError] = useState('');
  const [before, setBefore] = useState<number | undefined>();
  const [next, setNext] = useState<number | null>(null);
  const [pages, setPages] = useState<(number | undefined)[]>([]);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setItems(null);
    setError('');
    setNext(null);
    void journalApi.history(classroomId, column.id, student.id, before).then((r) => {
      if (!active) return;
      if (r.ok) {
        setItems(r.data.items);
        setNext(r.data.nextBeforeRevision);
      } else {
        if ([401, 403].includes(r.status) || r.error.code === 'session_conflict')
          onAccessLost(r.error.message);
        else setError(r.error.message);
      }
    });
    return () => {
      active = false;
    };
  }, [classroomId, column.id, student.id, before, retry, onAccessLost]);
  return (
    <div className="manual-journal-history">
      {error ? (
        <p role="alert">
          {error} <button onClick={() => setRetry((n) => n + 1)}>Повторить загрузку истории</button>
        </p>
      ) : null}
      {!items && !error ? <p>Загружаем историю…</p> : null}
      {items?.length === 0 ? <p>Оценка ещё не выставлялась.</p> : null}
      <ol>
        {items?.map((r) => (
          <li key={r.id}>
            <strong>{journalRevisionLabel(column.preset, r.value)}</strong> · {r.authorName} ·{' '}
            {schoolTimeFormats(timeZone).dateTime(r.publishedAt)}
            <p>{r.reason}</p>
          </li>
        ))}
      </ol>
      <nav aria-label="Страницы истории оценки">
        <button
          disabled={!items || !pages.length}
          onClick={() => {
            setBefore(pages[pages.length - 1]);
            setPages((old) => old.slice(0, -1));
          }}
        >
          Новые изменения
        </button>
        <button
          disabled={!items || next === null}
          onClick={() => {
            if (next !== null) {
              setPages((old) => [...old, before]);
              setBefore(next);
            }
          }}
        >
          Прежние изменения
        </button>
      </nav>
    </div>
  );
}
function CellEditor({
  classroomId,
  column,
  student,
  grade,
  scaleVersion,
  archived,
  receipts,
  onSaved,
  onClose,
  onRefresh,
  onAccessLost,
  timeZone,
}: {
  classroomId: string;
  column: JournalSlot;
  student: Student;
  grade: JournalGrade | undefined;
  scaleVersion: number;
  archived: boolean;
  receipts: Map<string, Receipt>;
  onSaved: (column: JournalColumn, grade: JournalGrade, scale?: JournalSnapshot['scale']) => void;
  onClose: (step?: number) => void;
  onRefresh: () => void;
  onAccessLost: (message: string) => void;
  timeZone: string;
}) {
  const [value, setValue] = useState(grade?.value == null ? '' : String(grade.value));
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState(false);
  const [attempt, setAttempt] = useState<number | null | undefined>();
  const mounted = useRef(false),
    saving = useRef(false),
    panel = useRef<HTMLElement>(null);
  useEffect(() => {
    mounted.current = true;
    panel.current
      ?.querySelector<HTMLElement>(
        archived ? 'button:not(:disabled), summary' : 'input, button[data-level]:not(:disabled)',
      )
      ?.focus();
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    setConflict(false);
  }, [grade?.revision, column.headerRevision, scaleVersion]);
  async function save(next: number | null) {
    if (saving.current || archived || conflict) return;
    if (grade && !reason.trim()) {
      setError('Укажите причину исправления или очистки оценки.');
      return;
    }
    if (
      next !== null &&
      (!Number.isInteger(next) || !journalLevels(column.preset).includes(next))
    ) {
      setError('Введите целую оценку в диапазоне шкалы.');
      return;
    }
    if (!grade && next === null) return;
    const input = {
      seatId: student.id,
      value: next,
      reason: reason.trim() || null,
      expectedRevision: grade?.revision ?? 0,
    };
    const body = column.virtual
      ? {
          ...input,
          slotKey: column.slotKey!,
          date: column.date,
          category: column.category,
          expectedScaleVersion: scaleVersion,
          expectedHeaderRevision: 0,
        }
      : { ...input, columnId: column.id };
    const key = `${column.id}:${student.id}`;
    const receipt = journalRequestReceipt(receipts.get(key), body);
    receipts.set(key, receipt);
    receipt.uncertain = true;
    saving.current = true;
    setBusy(true);
    setError('');
    setAttempt(next);
    if (column.virtual) {
      const r = await journalApi.quick(classroomId, {
        ...input,
        slotKey: column.slotKey!,
        date: column.date,
        category: column.category,
        expectedScaleVersion: Number(JSON.parse(receipt.payload).expectedScaleVersion),
        expectedHeaderRevision: 0,
        requestId: receipt.id,
      });
      if (!mounted.current) return;
      if (r.ok && r.data.grade) {
        receipts.delete(key);
        onSaved(r.data.column, r.data.grade, r.data.scale);
        return;
      }
      if (!r.ok) {
        if ([401, 403].includes(r.status) || r.error.code === 'session_conflict') {
          onAccessLost(r.error.message);
          return;
        }
        receipt.uncertain = r.status === 0 || r.status >= 500;
        setError(r.error.message);
        setConflict(r.status === 409);
      }
    } else {
      const r = await journalApi.grade(classroomId, {
        ...input,
        columnId: column.id,
        requestId: receipt.id,
      });
      if (!mounted.current) return;
      if (r.ok) {
        receipts.delete(key);
        onSaved(column, r.data);
        return;
      }
      setError(r.error.message);
      if ([401, 403].includes(r.status) || r.error.code === 'session_conflict') {
        onAccessLost(r.error.message);
        return;
      }
      setConflict(r.status === 409);
      receipt.uncertain = r.status === 0 || r.status >= 500;
    }
    saving.current = false;
    setBusy(false);
  }
  return (
    <dialog
      open
      className="manual-journal-popover"
      aria-label={`Быстрая оценка: ${student.name}`}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onClose();
        }
        if (
          e.key === 'Tab' &&
          !busy &&
          !history &&
          (e.target as HTMLElement).hasAttribute('data-level')
        ) {
          e.preventDefault();
          onClose(e.shiftKey ? -1 : 1);
        }
        if (
          ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) &&
          (e.target as HTMLElement).hasAttribute('data-level')
        ) {
          const options = Array.from(
              panel.current?.querySelectorAll<HTMLButtonElement>('button[data-level]') ?? [],
            ),
            delta = ['ArrowLeft', 'ArrowUp'].includes(e.key) ? -1 : 1;
          options[
            (options.indexOf(e.target as HTMLButtonElement) + delta + options.length) %
              options.length
          ]?.focus();
          e.preventDefault();
        }
      }}
    >
      <section
        ref={panel}
        className="manual-journal-editor"
        aria-label={`Оценка: ${student.name}`}
        aria-busy={busy}
      >
        <header>
          <strong>
            {student.name}
            <small>
              {column.date} · {column.category}
            </small>
          </strong>
          <button aria-label="Закрыть оценку" onClick={() => onClose()}>
            ×
          </button>
        </header>
        {grade ? <small>Сейчас: {journalRevisionLabel(column.preset, grade.value)}</small> : null}
        {grade && !archived ? (
          <label>
            Причина изменения{' '}
            <input
              autoComplete="off"
              required
              maxLength={500}
              value={reason}
              disabled={busy}
              onChange={(e) => {
                setReason(e.target.value);
                setError('');
              }}
            />
          </label>
        ) : null}
        {column.preset === 'hundred' ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (value !== '') void save(Number(value));
            }}
          >
            <label>
              Оценка{' '}
              <input
                type="number"
                inputMode="numeric"
                min="0"
                max="100"
                step="1"
                required
                value={value}
                disabled={busy || archived || conflict}
                onChange={(e) => setValue(e.target.value)}
              />
            </label>
            <small>0–100, Enter — поставить</small>
          </form>
        ) : (
          <div className="manual-journal-levels" role="group" aria-label="Оценка">
            {journalLevels(column.preset).map((v) => (
              <button
                key={v}
                data-level={v}
                aria-label={journalAccessibleLabel(column.preset, v)}
                disabled={busy || archived || conflict || Boolean(grade && !reason.trim())}
                onClick={() => void save(v)}
              >
                {journalGradeLabel(column.preset, v)}
              </button>
            ))}
          </div>
        )}
        {grade && !archived ? (
          <button disabled={busy || conflict || !reason.trim()} onClick={() => void save(null)}>
            Очистить оценку
          </button>
        ) : null}
        {busy ? <p role="status">Сохраняем…</p> : null}
        {error ? (
          <p role="alert">
            {error}{' '}
            {conflict ? (
              <button onClick={onRefresh}>Обновить журнал</button>
            ) : attempt !== undefined ? (
              <button disabled={busy} onClick={() => void save(attempt)}>
                Повторить сохранение
              </button>
            ) : null}
          </p>
        ) : null}
        {archived ? <p>Только просмотр.</p> : null}
        <details onToggle={(e) => setHistory(e.currentTarget.open)}>
          <summary>История оценки · {journalPresets[column.preset]}</summary>
          {history ? (
            column.virtual ? (
              <p>Оценка ещё не выставлялась.</p>
            ) : (
              <GradeHistory
                classroomId={classroomId}
                column={column}
                student={student}
                timeZone={timeZone}
                onAccessLost={onAccessLost}
              />
            )
          ) : null}
        </details>
      </section>
    </dialog>
  );
}
function ColumnEditor({
  classroomId,
  column,
  scaleVersion,
  receipts,
  onSaved,
  onClose,
  onRefresh,
  onAccessLost,
}: {
  classroomId: string;
  column: JournalSlot;
  scaleVersion: number;
  receipts: Map<string, Receipt>;
  onSaved: (result: JournalQuickResult) => void;
  onClose: () => void;
  onRefresh: () => void;
  onAccessLost: (message: string) => void;
}) {
  const [date, setDate] = useState(column.date),
    [category, setCategory] = useState(column.category),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [conflict, setConflict] = useState(false);
  const mounted = useRef(false),
    saving = useRef(false),
    panel = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    mounted.current = true;
    panel.current?.querySelector('input')?.focus();
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    setConflict(false);
  }, [column.headerRevision, scaleVersion]);
  return (
    <dialog
      ref={panel}
      open
      className="manual-journal-popover"
      aria-label="Столбец журнала"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <header>
        <strong>{column.virtual ? 'Новая работа' : 'Название и дата работы'}</strong>
        <button aria-label="Закрыть столбец" onClick={onClose}>
          ×
        </button>
      </header>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (saving.current || conflict || !category.trim()) return;
          const input = {
            ...(column.virtual ? { slotKey: column.slotKey! } : { columnId: column.id }),
            date,
            category: category.trim(),
            expectedScaleVersion: scaleVersion,
            expectedHeaderRevision: column.headerRevision ?? 0,
          };
          const key = `header:${column.id}`;
          const receipt = journalRequestReceipt(receipts.get(key), input);
          receipts.set(key, receipt);
          receipt.uncertain = true;
          saving.current = true;
          setBusy(true);
          setError('');
          void journalApi
            .quick(classroomId, {
              ...input,
              expectedScaleVersion: Number(JSON.parse(receipt.payload).expectedScaleVersion),
              requestId: receipt.id,
            })
            .then((r) => {
              if (!mounted.current) return;
              saving.current = false;
              setBusy(false);
              if (r.ok) {
                receipts.delete(key);
                onSaved(r.data);
              } else {
                if ([401, 403].includes(r.status) || r.error.code === 'session_conflict') {
                  onAccessLost(r.error.message);
                  return;
                }
                receipt.uncertain = r.status === 0 || r.status >= 500;
                setError(r.error.message);
                setConflict(r.status === 409);
              }
            });
        }}
      >
        <label>
          Дата занятия{' '}
          <input
            type="date"
            min={column.virtual ? `${column.date.slice(0, 7)}-01` : '2000-01-01'}
            max={column.virtual ? journalMonthRange(column.date.slice(0, 7)).to : '2100-12-31'}
            required
            disabled={busy}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label>
          Категория занятия{' '}
          <input
            required
            maxLength={80}
            disabled={busy}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          />
        </label>
        <button
          type="submit"
          className="btn-primary"
          disabled={busy || conflict || !category.trim()}
        >
          {busy ? 'Сохраняем…' : error ? 'Повторить сохранение' : 'Сохранить столбец'}
        </button>
      </form>
      {error ? (
        <p role="alert">
          {error}
          {conflict ? <button onClick={onRefresh}>Обновить журнал</button> : null}
        </p>
      ) : null}
      <small>
        Шкала: {journalPresets[column.preset]}. Сохранённые оценки сохраняют свою шкалу.
      </small>
    </dialog>
  );
}
export function ManualClassroomJournal({
  classroomId,
  modeControl,
}: {
  classroomId: string;
  modeControl?: ReactNode;
}) {
  return <Journal key={classroomId} classroomId={classroomId} modeControl={modeControl} />;
}
function Journal({ classroomId, modeControl }: { classroomId: string; modeControl?: ReactNode }) {
  const destination = useJournalDestination();
  const [month, setMonth] = useState(destination.month),
    [offset, setOffset] = useState(0),
    [data, setData] = useState<JournalSnapshot | null>(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [search, setSearch] = useState(''),
    [categoryFilter, setCategoryFilter] = useState(''),
    [minimum, setMinimum] = useState(10),
    [loadBusy, setLoadBusy] = useState(false);
  const [opened, setOpened] = useState<{ column: JournalSlot; student: Student } | null>(null),
    [header, setHeader] = useState<JournalSlot | null>(null);
  const active = useRef(false),
    generation = useRef(0),
    receipts = useRef(new Map<string, Receipt>()),
    cells = useRef(new Map<string, HTMLButtonElement>()),
    origin = useRef<HTMLElement | null>(null);
  const headerButtons = useRef(new Map<string, HTMLButtonElement>());
  const journalRoot = useRef<HTMLElement>(null);
  const headerEditorKey = useRef('');
  const contextRevision = useRef(0);
  const contextVersion = contextRevision.current;
  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoadBusy(true);
    setError('');
    const r = await journalApi.read(classroomId, {
      ...(month ? journalMonthRange(month) : {}),
      offset,
    });
    if (!active.current || current !== generation.current) return;
    setLoadBusy(false);
    if (r.ok) setData(r.data);
    else {
      if ([401, 403, 409].includes(r.status)) {
        contextRevision.current += 1;
        setData(null);
        setOpened(null);
        setHeader(null);
        setNotice('');
        receipts.current.clear();
      }
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
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') void load();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [load]);
  const changeMonth = useCallback((next: string) => {
    contextRevision.current += 1;
    generation.current += 1;
    setData(null);
    setOpened(null);
    setHeader(null);
    setNotice('');
    setError('');
    setMonth(next);
    setOffset(0);
    setCategoryFilter('');
    setMinimum(10);
    receipts.current.clear();
  }, []);
  const previousDestination = useRef(destination.month);
  useEffect(() => {
    if (destination.month !== previousDestination.current) {
      previousDestination.current = destination.month;
      changeMonth(destination.month);
    }
  }, [destination.month, changeMonth]);
  const allColumns = useMemo(
    () => (data ? journalSlots(classroomId, data, minimum) : []),
    [classroomId, data, minimum],
  );
  const columns = allColumns.filter((c) => !categoryFilter || c.category === categoryFilter),
    roster = useMemo(() => journalRoster(data?.students ?? []), [data?.students]);
  const students = roster.filter((s) =>
      s.name.toLocaleLowerCase('ru').includes(search.toLocaleLowerCase('ru')),
    ),
    grades = new Map(data?.grades.map((g) => [`${g.columnId}:${g.seatId}`, g])),
    archived = data?.status !== 'active';
  const openedColumn = opened
    ? (allColumns.find(
        (c) =>
          c.id === opened.column.id ||
          (opened.column.slotKey && c.slotKey === opened.column.slotKey),
      ) ?? opened.column)
    : null;
  const headerColumn = header
    ? (allColumns.find(
        (c) => c.id === header.id || (header.slotKey && c.slotKey === header.slotKey),
      ) ?? header)
    : null;
  function closeCell(step = 0) {
    const key = opened ? `${openedColumn!.id}:${opened.student.id}` : '',
      ordered = students.flatMap((s) => columns.map((c) => `${c.id}:${s.id}`));
    const next = cells.current.get(ordered[ordered.indexOf(key) + step]);
    setOpened(null);
    (next ?? origin.current)?.focus();
  }
  function updateColumn(result: JournalQuickResult) {
    const visibleMonth = month || data?.range.from.slice(0, 7);
    setData((old) =>
      old
        ? {
            ...old,
            scale: result.scale,
            reservedSlotKeys: [
              ...new Set([
                ...(old.reservedSlotKeys ?? []),
                ...(result.column.slotKey ? [result.column.slotKey] : []),
              ]),
            ],
            columns: [
              ...old.columns.filter((c) => c.id !== result.column.id),
              ...(result.column.date.slice(0, 7) === visibleMonth ? [result.column] : []),
            ],
            grades: result.grade
              ? [
                  ...old.grades.filter(
                    (g) =>
                      !(g.columnId === result.grade!.columnId && g.seatId === result.grade!.seatId),
                  ),
                  result.grade,
                ]
              : old.grades,
          }
        : old,
    );
  }
  const accessLost = useCallback((message: string) => {
    contextRevision.current += 1;
    generation.current += 1;
    setData(null);
    setOpened(null);
    setHeader(null);
    setNotice('');
    setLoadBusy(false);
    setError(message);
    receipts.current.clear();
  }, []);
  const accessLostForContext = useCallback(
    (message: string) => {
      if (active.current && contextRevision.current === contextVersion) accessLost(message);
    },
    [accessLost, contextVersion],
  );
  async function refreshHeader() {
    if (!headerColumn) return;
    const r = await journalApi.read(classroomId, {
      ...(month ? journalMonthRange(month) : {}),
      ...(headerColumn.virtual
        ? { slotKey: headerColumn.slotKey! }
        : { columnId: headerColumn.id }),
    });
    if (!active.current || contextRevision.current !== contextVersion) return;
    if (!r.ok) {
      if ([401, 403, 409].includes(r.status)) accessLostForContext(r.error.message);
      else setError(r.error.message);
      return;
    }
    generation.current += 1;
    setLoadBusy(false);
    setError('');
    const latest = r.data.columns[0];
    if (!latest) {
      if (headerColumn.virtual) {
        setData((old) => (old ? { ...old, scale: r.data.scale, status: r.data.status } : old));
      } else setError('Столбец недоступен. Введённые данные сохранены в форме.');
      return;
    }
    setHeader(latest);
    updateColumn({ column: latest, grade: null, scale: r.data.scale });
    setData((old) => (old ? { ...old, status: r.data.status } : old));
  }
  function focusHeader(id: string) {
    const target =
      headerButtons.current.get(id) ?? (origin.current?.isConnected ? origin.current : null);
    if (target) target.focus();
    else
      journalRoot.current
        ?.querySelector<HTMLInputElement>('.manual-journal-monthbar input')
        ?.focus();
  }
  return (
    <section ref={journalRoot} className="manual-journal" aria-label="Ручной журнал">
      <div className="manual-journal-toolbar manual-journal-filters">
        {modeControl}
        <JournalMonthNavigation
          month={month || data?.range.from.slice(0, 7) || ''}
          disabled={loadBusy}
          onChange={changeMonth}
        />
        <input
          aria-label="Поиск ученика"
          placeholder="Поиск ученика"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          aria-label="Категория"
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
        >
          <option value="">Все категории</option>
          {[...new Set(allColumns.map((c) => c.category))].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <button
          aria-label="Обновить журнал"
          title="Обновить журнал"
          disabled={loadBusy}
          onClick={() => {
            setOpened(null);
            setHeader(null);
            setNotice('');
            void load();
          }}
        >
          ↻
        </button>
        <button
          disabled={archived || loadBusy}
          onClick={(e) => {
            if (!data) return;
            const nextMinimum = Math.max(minimum, allColumns.length) + 1;
            const next = journalSlots(
              classroomId,
              { ...data, offset: 0, nextOffset: null },
              nextMinimum,
            ).find((c) => !allColumns.some((existing) => existing.id === c.id))!;
            setMinimum(nextMinimum);
            origin.current = e.currentTarget;
            headerEditorKey.current = next.id;
            setOpened(null);
            setHeader(next);
          }}
        >
          + Столбец
        </button>
      </div>
      {error ? (
        <p role="alert">
          {error}{' '}
          <button disabled={loadBusy} onClick={() => void load()}>
            Повторить загрузку
          </button>
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="manual-journal-notice">
          {notice}
        </p>
      ) : null}
      {!data && !error ? <p role="status">Загружаем журнал…</p> : null}
      {data ? (
        <>
          {archived ? <p>Архивный класс: только просмотр.</p> : null}
          <div
            className="manual-journal-scroll"
            tabIndex={0}
            role="region"
            aria-label="Таблица оценок по датам"
            aria-busy={loadBusy}
          >
            <table
              style={{ width: `calc(var(--journal-name-width, 240px) + ${columns.length} * 96px)` }}
            >
              <colgroup>
                <col className="manual-journal-name-column" />
                {columns.map((c) => (
                  <col key={c.id} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">Ученик</th>
                  {columns.map((c) => (
                    <th scope="col" key={c.id}>
                      <button
                        className="manual-journal-column"
                        ref={(element) => {
                          if (element) headerButtons.current.set(c.id, element);
                          else headerButtons.current.delete(c.id);
                        }}
                        title={`${c.category} · ${journalPresets[c.preset]}, версия ${c.scaleVersion}`}
                        aria-label={`Изменить столбец: ${c.category}, ${c.date}`}
                        disabled={archived || loadBusy}
                        onClick={(e) => {
                          origin.current = e.currentTarget;
                          headerEditorKey.current = c.id;
                          setOpened(null);
                          setHeader(c);
                        }}
                      >
                        <span>{c.category}</span>
                        <time dateTime={c.date}>
                          {c.date.slice(8)}.{c.date.slice(5, 7)}
                        </time>
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {students.map((s, row) => (
                  <tr key={s.id}>
                    <th scope="row">
                      <span className="manual-journal-roster-number" aria-hidden="true">
                        {roster.indexOf(s) + 1}
                      </span>
                      {s.name}
                      {!['issued', 'active'].includes(s.status) ? (
                        <small>Доступ закрыт</small>
                      ) : null}
                    </th>
                    {columns.map((c, col) => {
                      const grade = grades.get(`${c.id}:${s.id}`);
                      return (
                        <td key={c.id}>
                          <button
                            ref={(element) => {
                              const key = `${c.id}:${s.id}`;
                              if (element) cells.current.set(key, element);
                              else cells.current.delete(key);
                            }}
                            className="manual-journal-cell"
                            data-slot-key={c.slotKey ?? ''}
                            disabled={loadBusy}
                            aria-label={`${s.name}, ${c.date}, ${c.category}: ${grade ? journalRevisionLabel(c.preset, grade.value) : journalAccessibleLabel(c.preset, null)}`}
                            onKeyDown={(e) => {
                              const directions: Record<string, [number, number]> = {
                                  ArrowLeft: [0, -1],
                                  ArrowRight: [0, 1],
                                  ArrowUp: [-1, 0],
                                  ArrowDown: [1, 0],
                                },
                                direction = directions[e.key];
                              if (!direction) return;
                              const targetStudent = students[row + direction[0]],
                                targetColumn = columns[col + direction[1]];
                              if (targetStudent && targetColumn) {
                                e.preventDefault();
                                cells.current
                                  .get(`${targetColumn.id}:${targetStudent.id}`)
                                  ?.focus();
                              }
                            }}
                            onClick={(e) => {
                              origin.current = e.currentTarget;
                              setHeader(null);
                              setOpened({ column: c, student: s });
                              setNotice('');
                            }}
                          >
                            {grade?.value == null
                              ? grade
                                ? journalRevisionLabel(c.preset, null)
                                : '—'
                              : journalGradeLabel(c.preset, grade.value)}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!students.length ? <p>Ученики не найдены.</p> : null}
          {offset > 0 || data.nextOffset !== null ? (
            <nav className="manual-journal-toolbar" aria-label="Страницы столбцов журнала">
              <button
                disabled={loadBusy || offset === 0}
                onClick={() => {
                  contextRevision.current += 1;
                  setOpened(null);
                  setHeader(null);
                  setData(null);
                  setNotice('');
                  setOffset(Math.max(0, offset - 50));
                }}
              >
                Предыдущие столбцы
              </button>
              <button
                disabled={loadBusy || data.nextOffset === null}
                onClick={() => {
                  if (data.nextOffset !== null) {
                    contextRevision.current += 1;
                    setOpened(null);
                    setHeader(null);
                    setData(null);
                    setNotice('');
                    setOffset(data.nextOffset);
                  }
                }}
              >
                Следующие столбцы
              </button>
            </nav>
          ) : null}
          <details className="manual-journal-hint">
            <summary>Справка по журналу</summary>
            <p>
              Нажмите ячейку и выберите оценку. «—» — нет оценки, 0 — отдельная оценка. Исправление
              требует причины. История доступна в ячейке. Даты класса: {data.timeZone}. Пустые
              работы сохраняются только при подтверждении заголовка или первой оценке.
            </p>
          </details>
          {opened ? (
            <CellEditor
              key={`${opened.column.id}:${opened.student.id}`}
              classroomId={classroomId}
              column={openedColumn!}
              student={opened.student}
              grade={grades.get(`${openedColumn!.id}:${opened.student.id}`)}
              scaleVersion={data.scale.version}
              timeZone={data.timeZone}
              archived={
                archived ||
                !['issued', 'active'].includes(
                  data.students.find((s) => s.id === opened.student.id)?.status ?? '',
                )
              }
              receipts={receipts.current}
              onClose={closeCell}
              onRefresh={() => void load()}
              onAccessLost={accessLostForContext}
              onSaved={(column, grade, scale) => {
                if (!active.current || contextRevision.current !== contextVersion) return;
                generation.current += 1;
                setLoadBusy(false);
                if (opened.column.virtual)
                  updateColumn({ column, grade, scale: scale ?? data.scale });
                else
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
                requestAnimationFrame(() =>
                  cells.current.get(`${column.id}:${grade.seatId}`)?.focus(),
                );
              }}
            />
          ) : null}
          {header && !archived ? (
            <ColumnEditor
              key={headerEditorKey.current}
              classroomId={classroomId}
              column={headerColumn!}
              scaleVersion={data.scale.version}
              receipts={receipts.current}
              onClose={() => {
                setHeader(null);
                focusHeader(headerColumn!.id);
              }}
              onRefresh={() => void refreshHeader()}
              onAccessLost={accessLostForContext}
              onSaved={(result) => {
                if (!active.current || contextRevision.current !== contextVersion) return;
                generation.current += 1;
                setLoadBusy(false);
                updateColumn(result);
                if (data.offset !== 0 || data.nextOffset !== null) void load();
                setHeader(null);
                setNotice('Столбец сохранён.');
                requestAnimationFrame(() => {
                  if (active.current && contextRevision.current === contextVersion)
                    focusHeader(result.column.id);
                });
              }}
            />
          ) : null}
        </>
      ) : null}
    </section>
  );
}
