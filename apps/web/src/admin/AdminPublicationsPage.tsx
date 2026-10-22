import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { call } from './admin-api';
import './admin-publications.css';

interface Publication {
  readonly publicationId: string;
  readonly revisionId: string;
  readonly title: string;
  readonly authorLabel: string;
  readonly moduleKey: string;
  readonly publishedAt: string;
  readonly state: string;
  readonly hidden: boolean;
  readonly moderationVersion: number;
  readonly reason: string | null;
  readonly moderatedAt: string | null;
  readonly featured: boolean;
  readonly editorialVersion: number;
}

interface ModerationResult {
  readonly publicationId: string;
  readonly hidden: boolean;
  readonly moderationVersion: number;
  readonly reason: string | null;
  readonly moderatedAt: string;
}

const BASE = '/api/admin/v1/publications';
const endpoint = (id: string): string => `${BASE}/${encodeURIComponent(id)}`;
const dateTime = (value: string): string => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString('ru-RU') : 'Дата неизвестна';
};

function Preview({ publication }: { readonly publication: Publication }): JSX.Element {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <span className="admin-publication-preview" role="img" aria-label="Превью недоступно">
      <span aria-hidden="true">▧</span>
    </span>
  ) : (
    <img
      className="admin-publication-preview"
      src={`${endpoint(publication.publicationId)}/image`}
      alt={`Превью: ${publication.title}`}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

export function AdminPublicationsPage({
  onAccessDenied,
}: {
  readonly onAccessDenied: () => void;
}): JSX.Element {
  const [items, setItems] = useState<readonly Publication[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [selected, setSelected] = useState<Publication | null>(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const blocked = useRef(false);
  const version = useRef(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const reasonInput = useRef<HTMLTextAreaElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);

  const fail = useCallback(
    (status: number): void => {
      if (status === 401 || status === 403) {
        blocked.current = true;
        setDenied(true);
        setSelected(null);
        setItems([]);
        setError('Административный доступ утрачен. Войдите заново и проверьте права.');
        onAccessDenied();
      } else {
        setError(
          'Не удалось выполнить запрос. Изменение не подтверждено. Обновите список или повторите.',
        );
      }
    },
    [onAccessDenied],
  );

  const load = useCallback(
    async (offset = 0): Promise<void> => {
      if (busy.current || blocked.current) return;
      busy.current = true;
      const current = ++version.current;
      setLoading(true);
      setError(null);
      const result = await call<{ items: Publication[]; nextOffset: number | null }>(
        `${BASE}?offset=${offset}&limit=25`,
      );
      if (current !== version.current) return;
      busy.current = false;
      setLoading(false);
      if (!result.ok) {
        fail(result.status);
        return;
      }
      setItems((previous) =>
        offset === 0
          ? result.data.items
          : [
              ...previous,
              ...result.data.items.filter(
                (item) => !previous.some((row) => row.publicationId === item.publicationId),
              ),
            ],
      );
      setNextOffset(result.data.nextOffset);
    },
    [fail],
  );

  useEffect(() => {
    void load();
    return () => {
      version.current += 1;
      busy.current = false;
    };
  }, [load]);

  useEffect(() => {
    if (!selected) return;
    dialog.current?.showModal();
    reasonInput.current?.focus();
    return () => {
      dialog.current?.close();
      trigger.current?.focus();
    };
  }, [selected]);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const text = reason.trim();
    if (!selected || !text || text.length > 500 || busy.current || blocked.current) return;
    busy.current = true;
    setSaving(true);
    setError(null);
    const current = version.current;
    const result = await call<ModerationResult>(
      `${endpoint(selected.publicationId)}/${selected.hidden ? 'restore' : 'hide'}`,
      {
        method: 'POST',
        body: JSON.stringify({
          reason: text,
          expectedVersion: selected.moderationVersion,
          expectedRevisionId: selected.revisionId,
        }),
      },
    );
    if (current !== version.current) return;
    busy.current = false;
    setSaving(false);
    if (!result.ok) {
      if (result.status === 409) {
        setError(
          'Публикация изменилась у другого администратора. Закройте окно и обновите список.',
        );
      } else {
        fail(result.status);
      }
      return;
    }
    if (
      result.data.publicationId !== selected.publicationId ||
      result.data.hidden === selected.hidden ||
      result.data.moderationVersion !== selected.moderationVersion + 1
    ) {
      setError('Сервер не подтвердил новое состояние. Обновите список.');
      return;
    }
    setItems((previous) =>
      previous.map((item) =>
        item.publicationId === result.data.publicationId
          ? { ...item, ...result.data, featured: false }
          : item,
      ),
    );
    setSelected(null);
  };

  const toggleFeatured = async (item: Publication): Promise<void> => {
    if (busy.current || blocked.current || item.hidden || item.state !== 'public') return;
    busy.current = true;
    setSaving(true);
    setError(null);
    const current = version.current;
    const result = await call<{
      publicationId: string;
      revisionId: string;
      featured: boolean;
      editorialVersion: number;
    }>(`${endpoint(item.publicationId)}/featured`, {
      method: 'POST',
      body: JSON.stringify({
        featured: !item.featured,
        expectedVersion: item.editorialVersion,
        expectedRevisionId: item.revisionId,
        expectedModerationVersion: item.moderationVersion,
      }),
    });
    if (current !== version.current) return;
    busy.current = false;
    setSaving(false);
    if (!result.ok) {
      if (result.status === 409)
        setError('Редакционная отметка изменилась. Обновите список перед повтором.');
      else fail(result.status);
      return;
    }
    if (
      result.data.publicationId !== item.publicationId ||
      result.data.revisionId !== item.revisionId ||
      result.data.featured === item.featured ||
      result.data.editorialVersion !== item.editorialVersion + 1
    ) {
      setError('Сервер не подтвердил редакционное действие. Обновите список.');
      return;
    }
    setItems((previous) =>
      previous.map((currentItem) =>
        currentItem.publicationId === result.data.publicationId
          ? {
              ...currentItem,
              featured: result.data.featured,
              editorialVersion: result.data.editorialVersion,
            }
          : currentItem,
      ),
    );
  };

  return (
    <section
      className="admin-publications"
      aria-labelledby="admin-publications-title"
      aria-busy={loading || saving}
    >
      <div className="admin-section-heading">
        <div>
          <h2 id="admin-publications-title">Публикации</h2>
          <p>Модерация публичных проектов</p>
        </div>
        <button
          type="button"
          className="btn-secondary"
          disabled={loading || saving || denied || selected !== null}
          onClick={() => void load()}
        >
          Обновить
        </button>
      </div>
      {error && !selected ? (
        <p role="alert" className="admin-inline-error">
          {error}
        </p>
      ) : null}
      {loading ? <p role="status">Загружаем публикации…</p> : null}
      {!loading && !error && items.length === 0 ? <p role="status">Публикаций пока нет.</p> : null}
      <ul className="admin-publications-list">
        {items.map((item) => (
          <li key={item.publicationId} className="admin-publication-row">
            <Preview key={item.revisionId} publication={item} />
            <div className="admin-publication-details">
              <h3>{item.title}</h3>
              <p>
                {item.authorLabel} · {item.moduleKey}
              </p>
              <p>
                <time dateTime={item.publishedAt}>{dateTime(item.publishedAt)}</time>
              </p>
              <p>
                <strong>
                  {item.hidden
                    ? 'Скрыта модератором'
                    : item.state === 'public'
                      ? 'Опубликована'
                      : item.state}
                </strong>
              </p>
              {item.featured && !item.hidden ? (
                <p className="admin-publication-featured" data-testid="admin-publication-featured">
                  ★ Выбор редакции
                </p>
              ) : null}
              {item.hidden && item.reason ? <p>Причина: {item.reason}</p> : null}
              {item.moderatedAt ? <p>Модерация: {dateTime(item.moderatedAt)}</p> : null}
              {!item.hidden && item.state === 'public' ? (
                <a href={`/#/public-projects/${encodeURIComponent(item.publicationId)}`}>
                  Открыть публикацию
                </a>
              ) : null}
            </div>
            <div className="admin-publication-actions">
              {!item.hidden && item.state === 'public' ? (
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={loading || saving || denied || selected !== null}
                  onClick={() => void toggleFeatured(item)}
                >
                  {item.featured ? 'Снять отметку' : 'Выбор редакции'}
                </button>
              ) : null}
              <button
                type="button"
                className="btn-secondary"
                disabled={loading || saving || denied}
                onClick={(event) => {
                  trigger.current = event.currentTarget;
                  setReason('');
                  setError(null);
                  setSelected(item);
                }}
              >
                {item.hidden ? 'Восстановить' : 'Скрыть'}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {nextOffset !== null ? (
        <button
          type="button"
          className="btn-secondary"
          disabled={loading || saving || denied || selected !== null}
          onClick={() => void load(nextOffset)}
        >
          Показать ещё
        </button>
      ) : null}
      {selected ? (
        <dialog
          ref={dialog}
          className="admin-publication-dialog"
          aria-labelledby="publication-confirm-title"
          aria-describedby="publication-confirm-note"
          onCancel={(event) => {
            event.preventDefault();
            if (!busy.current) setSelected(null);
          }}
        >
          <form onSubmit={(event) => void submit(event)}>
            <h3 id="publication-confirm-title">
              {selected.hidden ? 'Восстановить публикацию?' : 'Скрыть публикацию?'}
            </h3>
            <p>{selected.title}</p>
            <p id="publication-confirm-note">
              Рабочий проект не удаляется.{' '}
              {selected.hidden
                ? 'Восстановление снимает ограничение модерации, но не публикует отозванный проект заново.'
                : 'Публикация станет недоступна в публичном доступе.'}
            </p>
            <label htmlFor="publication-reason">Причина (обязательно, до 500 символов)</label>
            <textarea
              ref={reasonInput}
              id="publication-reason"
              required
              maxLength={500}
              value={reason}
              disabled={saving || denied}
              onChange={(event) => setReason(event.target.value)}
            />
            {error ? (
              <p role="alert" className="admin-inline-error">
                {error}
              </p>
            ) : null}
            <div className="admin-publication-dialog-actions">
              <button
                type="button"
                className="btn-secondary"
                disabled={saving}
                onClick={() => setSelected(null)}
              >
                Отмена
              </button>
              <button
                type="submit"
                className="btn-primary"
                disabled={saving || denied || !reason.trim()}
              >
                {saving
                  ? 'Сохраняем…'
                  : selected.hidden
                    ? 'Подтвердить восстановление'
                    : 'Подтвердить скрытие'}
              </button>
            </div>
          </form>
        </dialog>
      ) : null}
    </section>
  );
}
