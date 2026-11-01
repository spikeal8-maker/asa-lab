import { useCallback, useEffect, useRef, useState } from 'react';
import { call } from '../api-call';
import { PortalLink } from '../components/PortalLink';
import { newClientId } from '../client-id';
import { onSessionLoggedOut } from '../session-fetch';
import { subscribeTelemetry, telemetryContext } from '../telemetry-context';
import { LikeSignIn } from './PublicationLike';

export interface DiscussionState {
  authenticated: boolean;
  enabled: boolean;
  adminEnabled: boolean;
  version: number;
  revisionId: string;
  canManage: boolean;
  canPin?: boolean;
  canComment: boolean;
  reason: 'closed' | 'sign_in' | 'permission' | null;
}
export interface PublicComment {
  id: string;
  parentId: string | null;
  author: string | null;
  body: string | null;
  status: 'visible' | 'deleted' | 'owner_hidden' | 'moderator_hidden';
  createdAt: string;
  version: number;
  canDelete: boolean;
  canManage: boolean;
  replyCount: number;
  likeCount?: number;
  liked?: boolean;
  canLike?: boolean;
  pinned?: boolean;
}
interface Page {
  state: DiscussionState;
  items: PublicComment[];
  nextCursor: string | null;
  pinnedComment?: PublicComment | null;
}
interface Receipt {
  comment?: PublicComment;
  parentReplyCount?: number;
  reported?: boolean;
}
const statusText = (status: PublicComment['status']) =>
  status === 'deleted'
    ? 'Комментарий удалён автором'
    : status === 'moderator_hidden'
      ? 'Комментарий скрыт модератором'
      : 'Комментарий скрыт автором проекта';
function commentError(status: number, fallback: string) {
  return status === 401
    ? 'Войдите заново, чтобы продолжить.'
    : status === 403
      ? 'Действие запрещено текущими настройками доступа.'
      : status === 409
        ? 'Данные изменились. Обновите обсуждение; текст пока сохранён.'
        : status === 429
          ? 'Слишком много действий. Попробуйте позже.'
          : fallback;
}

export function PublicationComments({
  publicationId,
  revisionId,
}: {
  readonly publicationId: string;
  readonly revisionId: string;
}): JSX.Element {
  const [page, setPage] = useState<Page | null>(null),
    [items, setItems] = useState<PublicComment[]>([]);
  const [sort, setSort] = useState('newest');
  const sortRef = useRef('newest');
  const [text, setText] = useState(''),
    [parent, setParent] = useState<PublicComment | null>(null),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState<string | null>(null),
    [replyEpoch, setReplyEpoch] = useState(0),
    [replied, setReplied] = useState<string | null>(null);
  const active = useRef(false),
    retired = useRef(false),
    inFlight = useRef(false),
    epoch = useRef(0),
    readSeq = useRef(0),
    requests = useRef(new Set<AbortController>());
  const intent = useRef<{ body: string; parent: string | null; id: string } | null>(null);
  const endpoint = `/api/public-projects/${encodeURIComponent(publicationId)}/comments`;
  const request = useCallback(async <T,>(path: string, init: RequestInit = {}) => {
    const controller = new AbortController();
    requests.current.add(controller);
    const timer = window.setTimeout(() => controller.abort(), 15000);
    try {
      return await call<T>(path, { ...init, cache: 'no-store', signal: controller.signal });
    } finally {
      clearTimeout(timer);
      requests.current.delete(controller);
    }
  }, []);
  const load = useCallback(
    async (cursor: string | null = null) => {
      if (retired.current || inFlight.current) return;
      const generation = epoch.current,
        seq = ++readSeq.current;
      setLoading(true);
      setError(null);
      const result = await request<Page>(
        endpoint +
          `?sort=${sortRef.current}` +
          (cursor ? `&before=${encodeURIComponent(cursor)}` : ''),
      );
      if (
        !active.current ||
        retired.current ||
        generation !== epoch.current ||
        seq !== readSeq.current
      )
        return;
      setLoading(false);
      if (result.ok && result.data && Array.isArray(result.data.items) && result.data.state) {
        setPage(result.data);
        setItems((old) =>
          cursor
            ? [...old, ...result.data.items.filter((row) => !old.some((v) => v.id === row.id))]
            : result.data.items,
        );
      } else {
        setError(
          commentError(result.status, 'Не удалось загрузить комментарии. Повторите попытку.'),
        );
        if (result.status === 401 || result.status === 403 || result.status === 404) {
          setPage(null);
          setItems([]);
        }
      }
    },
    [endpoint, request],
  );
  useEffect(() => {
    active.current = true;
    retired.current = false;
    epoch.current++;
    setPage(null);
    setItems([]);
    setText('');
    setParent(null);
    setNotice(null);
    const continuity = telemetryContext().continuity;
    const retire = () => {
      retired.current = true;
      epoch.current++;
      requests.current.forEach((c) => c.abort());
      setPage(null);
      setItems([]);
      setText('');
      setParent(null);
      setBusy(false);
      setLoading(false);
      setError('Контекст входа изменился. Откройте публикацию заново.');
    };
    const offContext = subscribeTelemetry((c) => {
        if (c.continuity !== continuity) retire();
      }),
      offLogout = onSessionLoggedOut(retire);
    void load();
    return () => {
      active.current = false;
      epoch.current++;
      requests.current.forEach((c) => c.abort());
      offContext();
      offLogout();
    };
  }, [load]);
  async function command(action: string, input: Record<string, unknown>): Promise<boolean> {
    if (retired.current || inFlight.current) return false;
    inFlight.current = true;
    // A GET started before this command must not restore stale permissions or
    // replace an acknowledged comment with its older snapshot.
    readSeq.current++;
    setLoading(false);
    setBusy(true);
    setError(null);
    setNotice(null);
    const generation = epoch.current;
    const result = await request<Receipt & DiscussionState>(endpoint + '/commands', {
      method: 'POST',
      body: JSON.stringify({ action, ...input }),
    });
    inFlight.current = false;
    if (!active.current || retired.current || generation !== epoch.current) return false;
    setBusy(false);
    if (!result.ok) {
      setError(
        commentError(
          result.status,
          action === 'like'
            ? 'Лайк не подтверждён. Повторите действие.'
            : action === 'pin'
              ? 'Не удалось изменить закрепление. Обновите обсуждение.'
              : 'Ответ не подтверждён. Повторная отправка того же текста не создаст второй комментарий.',
        ),
      );
      if (result.status === 401) {
        retired.current = true;
        epoch.current++;
        requests.current.forEach((c) => c.abort());
        setPage(null);
        setItems([]);
        setText('');
        setParent(null);
      } else if (result.status === 403 && action !== 'like' && action !== 'pin')
        setPage((p) => (p ? { ...p, state: { ...p.state, canComment: false } } : p));
      return false;
    }
    if (action === 'pin') {
      await load();
      return true;
    }
    if (action === 'settings') setPage((p) => (p ? { ...p, state: result.data } : p));
    else if (result.data.comment) {
      const comment = result.data.comment;
      if (page?.pinnedComment?.id === comment.id) {
        setPage((p) => (p ? { ...p, pinnedComment: comment } : p));
      }
      if (comment.parentId) {
        setItems((old) =>
          old.map((row) =>
            row.id === comment.parentId
              ? { ...row, replyCount: result.data.parentReplyCount ?? row.replyCount }
              : row,
          ),
        );
        setReplied(comment.parentId);
        setReplyEpoch((v) => v + 1);
      } else if (page?.pinnedComment?.id !== comment.id)
        setItems((old) =>
          old.some((row) => row.id === comment.id)
            ? old.map((row) => (row.id === comment.id ? comment : row))
            : [comment, ...old],
        );
    }
    if (action === 'report') setNotice('Жалоба отправлена модератору.');
    if (
      result.data.comment &&
      !result.data.comment.parentId &&
      ((action === 'create' && sortRef.current !== 'newest') ||
        (action === 'like' && sortRef.current === 'popular') ||
        (page?.pinnedComment?.id === result.data.comment.id &&
          result.data.comment.status !== 'visible'))
    )
      await load();
    return true;
  }
  async function submit() {
    const body = text.trim(),
      parentId = parent?.id ?? null;
    if (!body || Array.from(body).length > 2000 || !page?.state.canComment) return;
    if (!intent.current || intent.current.body !== body || intent.current.parent !== parentId)
      intent.current = { body, parent: parentId, id: newClientId() };
    if (await command('create', { body, parentId, revisionId, mutationId: intent.current.id })) {
      setText('');
      setParent(null);
      intent.current = null;
      setNotice('Комментарий опубликован.');
    }
  }
  const length = Array.from(text.trim()).length;
  return (
    <section
      className="publication-comments"
      aria-labelledby="publication-comments-title"
      data-testid="publication-comments"
    >
      <div className="publication-comments-heading">
        <h2 id="publication-comments-title">Комментарии</h2>
        <div className="publication-comments-tools">
          <label className="sr-only" htmlFor="comment-sort">
            Порядок комментариев
          </label>
          <select
            id="comment-sort"
            value={sort}
            disabled={busy || loading || retired.current}
            onChange={(e) => {
              sortRef.current = e.target.value;
              setSort(e.target.value);
              void load();
            }}
          >
            <option value="newest">Сначала новые</option>
            <option value="oldest">Сначала старые</option>
            <option value="popular">Популярные</option>
          </select>
          <button
            type="button"
            className="publication-comment-link"
            disabled={busy || loading || retired.current}
            onClick={() => void load()}
          >
            Обновить
          </button>
        </div>
      </div>
      {page?.state.canManage ? (
        <label className="publication-comments-switch">
          <input
            type="checkbox"
            checked={page.state.enabled}
            disabled={busy}
            onChange={(e) =>
              void command('settings', {
                enabled: e.target.checked,
                expectedVersion: page.state.version,
              })
            }
          />
          Обсуждение открыто
        </label>
      ) : null}
      {loading && !page ? <p role="status">Загружаем комментарии…</p> : null}
      {page?.state.canComment ? (
        <form
          className="publication-comment-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {parent ? (
            <div className="publication-comment-reply-target">
              Ответ: {parent.author}
              <button type="button" onClick={() => setParent(null)}>
                Отмена
              </button>
            </div>
          ) : null}
          <label>
            Ваш комментарий
            <textarea
              rows={3}
              value={text}
              maxLength={4000}
              disabled={busy}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <div className="publication-comment-form-footer">
            <small aria-live="polite">{length} / 2000</small>
            <button
              className="btn-primary"
              type="submit"
              disabled={busy || !length || length > 2000}
            >
              {busy ? 'Отправляем…' : 'Отправить'}
            </button>
          </div>
        </form>
      ) : page ? (
        <p className="publication-comments-access">
          {page.state.reason === 'sign_in' ? (
            <PortalLink href="/#/sign-in">Войдите, чтобы оставить комментарий</PortalLink>
          ) : !page.state.adminEnabled ? (
            'Обсуждение закрыто администратором. Прежние комментарии доступны для чтения.'
          ) : !page.state.enabled ? (
            'Автор закрыл обсуждение. Прежние комментарии доступны для чтения.'
          ) : (
            'Комментарии недоступны по настройкам вашего класса или ученика.'
          )}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="notice-error">
          {error}
          {!page && !retired.current ? (
            <button type="button" disabled={loading} onClick={() => void load()}>
              Повторить
            </button>
          ) : null}
        </p>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}
      {!loading && page && !items.length && !page.pinnedComment ? (
        <p className="publication-comments-empty">
          Пока нет комментариев. Здесь можно обсудить работу проекта.
        </p>
      ) : null}
      <div className="publication-comment-list">
        {[
          ...(page?.pinnedComment ? [page.pinnedComment] : []),
          ...items.filter((row) => row.id !== page?.pinnedComment?.id),
        ].map((row) => (
          <CommentThread
            key={row.id}
            row={row}
            endpoint={endpoint}
            request={request}
            canComment={!!page?.state.canComment}
            signedIn={!!page?.state.authenticated}
            canPin={!!page?.state.canPin}
            pinVersion={page?.state.version ?? 0}
            busy={busy}
            epoch={replyEpoch}
            openInitially={replied === row.id}
            onReply={setParent}
            command={command}
          />
        ))}
      </div>
      {page?.nextCursor ? (
        <button
          className="btn-secondary"
          type="button"
          disabled={loading || busy}
          onClick={() => void load(page.nextCursor)}
        >
          {loading ? 'Загружаем…' : 'Ещё комментарии'}
        </button>
      ) : null}
    </section>
  );
}

type Request = <T>(path: string, init?: RequestInit) => ReturnType<typeof call<T>>;
function CommentThread({
  row,
  endpoint,
  request,
  canComment,
  signedIn,
  canPin,
  pinVersion,
  busy,
  epoch,
  openInitially,
  onReply,
  command,
}: {
  readonly row: PublicComment;
  readonly endpoint: string;
  readonly request: Request;
  readonly canComment: boolean;
  readonly signedIn: boolean;
  readonly canPin: boolean;
  readonly pinVersion: number;
  readonly busy: boolean;
  readonly epoch: number;
  readonly openInitially: boolean;
  readonly onReply: (row: PublicComment) => void;
  readonly command: (action: string, input: Record<string, unknown>) => Promise<boolean>;
}): JSX.Element {
  const [open, setOpen] = useState(openInitially),
    [replies, setReplies] = useState<PublicComment[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState<string | null>(null),
    [report, setReport] = useState<string | null>(null);
  const [guestPrompt, setGuestPrompt] = useState(false);
  const sequence = useRef(0),
    alive = useRef(true);
  const visible = row.status === 'visible';
  const load = useCallback(
    async (before: string | null = null) => {
      const seq = ++sequence.current;
      setLoading(true);
      setError(null);
      const result = await request<Page>(
        endpoint +
          `?parentId=${encodeURIComponent(row.id)}` +
          (before ? `&before=${encodeURIComponent(before)}` : ''),
      );
      if (!alive.current || seq !== sequence.current) return;
      setLoading(false);
      if (result.ok && Array.isArray(result.data?.items)) {
        setReplies((old) =>
          before
            ? [...old, ...result.data.items.filter((item) => !old.some((v) => v.id === item.id))]
            : result.data.items,
        );
        setCursor(result.data.nextCursor);
      } else setError('Не удалось загрузить ответы.');
    },
    [endpoint, request, row.id],
  );
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      sequence.current++;
    };
  }, []);
  useEffect(() => {
    if (openInitially) setOpen(true);
  }, [openInitially, epoch]);
  useEffect(() => {
    if (open && visible) void load();
    else {
      sequence.current++;
      setReplies([]);
    }
  }, [open, visible, load, epoch]);
  const render = (item: PublicComment, reply = false) => (
    <article
      key={item.id}
      className={`publication-comment${reply ? ' is-reply' : ''}${item.pinned ? ' is-pinned' : ''}`}
      data-testid="publication-comment"
    >
      {item.status === 'visible' ? (
        <>
          <header>
            <span className="publication-comment-avatar" aria-hidden="true">
              {item.author?.trim().slice(0, 1).toLocaleUpperCase('ru-RU') || '·'}
            </span>
            <strong>{item.author}</strong>
            <time dateTime={item.createdAt}>
              {new Date(item.createdAt).toLocaleString('ru-RU')}
            </time>
            {item.pinned ? <span className="publication-comment-pin-label">Закреплено</span> : null}
          </header>
          <p className="publication-comment-body">{item.body}</p>
        </>
      ) : (
        <p className="publication-comment-tombstone">{statusText(item.status)}</p>
      )}
      <div className="publication-comment-actions">
        {item.status === 'visible' && typeof item.likeCount === 'number' ? (
          <button
            type="button"
            className="publication-comment-heart"
            aria-label={item.liked ? 'Убрать лайк комментария' : 'Нравится комментарий'}
            aria-pressed={!!item.liked}
            disabled={busy || (signedIn && !item.liked && !item.canLike)}
            onClick={() => {
              if (!signedIn) {
                setGuestPrompt(true);
                return;
              }
              void command('like', { commentId: item.id, on: !item.liked });
            }}
          >
            <svg
              aria-hidden="true"
              width="19"
              height="19"
              viewBox="0 0 24 24"
              fill={item.liked ? 'currentColor' : 'none'}
              stroke="currentColor"
              strokeWidth="1.7"
            >
              <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" />
            </svg>
            <span>{item.likeCount ?? 0}</span>
          </button>
        ) : null}
        {!reply && item.status === 'visible' && canComment ? (
          <button type="button" disabled={busy} onClick={() => onReply(item)}>
            Ответить
          </button>
        ) : null}
        {signedIn || item.canManage || item.canDelete || canPin ? (
          <details className="publication-comment-menu">
            <summary aria-label="Действия с комментарием" title="Действия с комментарием">
              ···
            </summary>
            <div>
              {!reply && item.status === 'visible' && canPin ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void command('pin', {
                      commentId: item.id,
                      on: !item.pinned,
                      expectedVersion: pinVersion,
                    })
                  }
                >
                  {item.pinned ? 'Открепить' : 'Закрепить'}
                </button>
              ) : null}
              {item.canDelete ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void command('delete', { commentId: item.id, expectedVersion: item.version })
                  }
                >
                  Удалить
                </button>
              ) : null}
              {item.canManage ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void command(item.status === 'owner_hidden' ? 'restore' : 'hide', {
                      commentId: item.id,
                      expectedVersion: item.version,
                    })
                  }
                >
                  {item.status === 'owner_hidden' ? 'Показать' : 'Скрыть'}
                </button>
              ) : null}
              {item.status === 'visible' && signedIn ? (
                <button type="button" disabled={busy} onClick={() => setReport(item.id)}>
                  Пожаловаться
                </button>
              ) : null}
            </div>
          </details>
        ) : null}
      </div>
      {report === item.id ? (
        <form
          className="publication-comment-report"
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            void command('report', {
              commentId: item.id,
              reason: String(data.get('reason') ?? ''),
            }).then((ok) => {
              if (ok) setReport(null);
            });
          }}
        >
          <label>
            Причина жалобы
            <textarea name="reason" required maxLength={500} rows={2} />
          </label>
          <button type="submit" disabled={busy}>
            Отправить жалобу
          </button>
          <button type="button" onClick={() => setReport(null)}>
            Отмена
          </button>
        </form>
      ) : null}
    </article>
  );
  return (
    <div className="publication-comment-thread">
      {render(row)}
      {guestPrompt ? <LikeSignIn comment onClose={() => setGuestPrompt(false)} /> : null}
      {row.replyCount > 0 && visible ? (
        <button
          className="publication-comment-link"
          type="button"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? 'Свернуть ответы' : `Ответы: ${row.replyCount}`}
        </button>
      ) : null}
      {open && visible ? (
        <div className="publication-comment-replies">
          {replies.map((r) => render(r, true))}
          {loading ? <p role="status">Загружаем ответы…</p> : null}
          {error ? (
            <p role="alert">
              {error}
              <button type="button" onClick={() => void load()}>
                Повторить
              </button>
            </p>
          ) : null}
          {cursor ? (
            <button type="button" disabled={loading} onClick={() => void load(cursor)}>
              Ещё ответы
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
