import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { crmApi, type CrmSubject, type CrmSeatDetailPage } from './crm-user-api';
const categories = {
  projects: 'Проекты и версии',
  publications: 'Публикации',
  ai: 'Использование ИИ',
} as const;
const labels: Record<string, string> = {
  project: 'Проект',
  version: 'Сохранённая версия',
  publication: 'Версия публикации',
  legacy_publication: 'Старая публикация',
  ai: 'Запрос ИИ',
};
export function CrmSeatDetail({
  subject,
  notes = false,
  onAccessDenied,
  renderProject,
}: {
  subject: CrmSubject;
  notes?: boolean;
  onAccessDenied: () => void;
  renderProject?: (projectId: string, versionId?: string) => ReactNode;
}) {
  const [category, setCategory] = useState<'projects' | 'publications' | 'ai'>('projects');
  const [page, setPage] = useState<CrmSeatDetailPage | null>(null),
    [busy, setBusy] = useState(false),
    [failure, setFailure] = useState<string | null>(null);
  const [text, setText] = useState(''),
    [reason, setReason] = useState('');
  const sequence = useRef(0),
    denied = useRef(onAccessDenied);
  denied.current = onAccessDenied;
  useEffect(() => {
    setPage(null);
    setText('');
    setReason('');
    void load(null);
    return () => {
      sequence.current++;
    };
  }, [subject.kind, subject.targetId, subject.classroomId, category, notes]);
  async function load(cursor: string | null) {
    const request = ++sequence.current;
    setBusy(true);
    setFailure(null);
    const result = await crmApi.seatDetail(subject, notes ? 'notes' : category, cursor);
    if (request !== sequence.current) return;
    setBusy(false);
    if (!result.ok) {
      setFailure(result.error.message);
      if (result.status === 401 || result.status === 403) {
        setPage(null);
        denied.current();
      }
      return;
    }
    setPage((previous) => ({
      ...result.data,
      items: cursor ? [...(previous?.items ?? []), ...result.data.items] : result.data.items,
    }));
  }
  async function add(event: FormEvent) {
    event.preventDefault();
    if (!page?.version) return;
    const request = ++sequence.current;
    setBusy(true);
    setFailure(null);
    const result = await crmApi.addSeatNote(subject, { version: page.version, text, reason });
    if (request !== sequence.current) return;
    setBusy(false);
    if (!result.ok) {
      setFailure(result.error.message);
      if (result.status === 401 || result.status === 403) {
        setPage(null);
        denied.current();
      }
      return;
    }
    setPage(result.data);
    setText('');
    setReason('');
  }
  return (
    <section aria-label={notes ? 'Учебные заметки' : 'Сохранённая история ученика'}>
      {notes ? (
        <p>
          Учебные заметки относятся только к этому месту в классе. Сохранённые записи и история не
          удаляются.
        </p>
      ) : (
        <>
          <div className="admin-user-card-tabs">
            {Object.entries(categories).map(([key, label]) => (
              <button
                type="button"
                key={key}
                aria-pressed={category === key}
                onClick={() => setCategory(key as typeof category)}
              >
                {label}
              </button>
            ))}
          </div>
          <p>
            Только сохранённые записи этого ученика и класса. Неизвестные токены не считаются
            нулевыми.
          </p>
        </>
      )}
      <button type="button" disabled={busy} onClick={() => void load(null)}>
        Обновить
      </button>
      {failure ? <p role="alert">{failure}</p> : null}
      {busy ? <p role="status">Загружаем…</p> : null}
      {page?.items.length === 0 ? <p>Сохранённых записей нет.</p> : null}
      <ul>
        {page?.items.map((item) => (
          <li key={item.key ?? item.id}>
            <p>
              {new Date(item.occurredAt).toLocaleString()} ·{' '}
              {notes ? item.text : `${labels[item.type ?? ''] ?? 'Запись'} · ${item.title ?? ''}`}
            </p>
            {!notes ? (
              <>
                <p>
                  {item.status ?? ''}
                  {item.revision !== undefined ? ` · версия ${item.revision}` : ''}
                </p>
                {item.type === 'ai' ? (
                  <p>
                    Модель: {item.model ?? item.requestedModel ?? 'неизвестна'} · вход:{' '}
                    {item.inputTokens ?? 'неизвестно'} · выход: {item.outputTokens ?? 'неизвестно'}
                    {item.errorCode ? ` · ${item.errorCode}` : ''}
                  </p>
                ) : null}
                {item.projectId && ['project', 'version'].includes(item.type ?? '')
                  ? renderProject?.(item.projectId, item.type === 'version' ? item.id : undefined)
                  : null}
              </>
            ) : null}
          </li>
        ))}
      </ul>
      {page?.next ? (
        <button type="button" disabled={busy} onClick={() => void load(page.next)}>
          Показать ещё
        </button>
      ) : null}
      {notes && page?.version ? (
        <form onSubmit={(event) => void add(event)}>
          <label>
            Новая учебная заметка
            <textarea
              required
              maxLength={2000}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <label>
            Причина добавления
            <input
              required
              minLength={3}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <button type="submit" disabled={busy || !text.trim() || reason.trim().length < 3}>
            Добавить заметку
          </button>
        </form>
      ) : null}
    </section>
  );
}
