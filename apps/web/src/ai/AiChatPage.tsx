import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { call } from '../api-call';
import './izo-chat-design.css';

interface AiThread {
  readonly id: string;
  readonly title: string;
  readonly updatedAt: string;
}

interface AiMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly content: string;
  readonly createdAt: string;
  readonly requestId: string;
}

interface AiCursor {
  readonly at: string;
  readonly id: string;
}

interface AiPage<T> {
  readonly items: readonly T[];
  readonly nextCursor?: AiCursor | null;
}

function cursorQuery(cursor: AiCursor): string {
  const query = new URLSearchParams({ beforeAt: cursor.at, beforeId: cursor.id });
  return '?' + query.toString();
}

interface AiStatus {
  readonly enabled: boolean;
  readonly provider: 'openai' | 'deepseek';
  readonly model: string;
}

function Content({ content }: { readonly content: string }): JSX.Element {
  const pieces = content.split(/(\x60{3}[\s\S]*?\x60{3})/g);
  return (
    <div className="asa-ai-rich-text">
      {pieces.map((part, index) => {
        if (part.startsWith('\x60\x60\x60')) {
          const source = part.replace(/^\x60{3}[^\n]*\n?/, '').replace(/\x60{3}$/, '');
          return (
            <div className="asa-ai-code-block" key={index}>
              <button
                type="button"
                onClick={() => void navigator.clipboard.writeText(source).catch(() => undefined)}
                aria-label="Копировать код"
              >
                Копировать код
              </button>
              <pre>
                <code>{source}</code>
              </pre>
            </div>
          );
        }
        return (
          <p className="asa-ai-paragraph" key={index}>
            {part}
          </p>
        );
      })}
    </div>
  );
}

export function AiChatPage(): JSX.Element {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [threads, setThreads] = useState<readonly AiThread[]>([]);
  const [threadCursor, setThreadCursor] = useState<AiCursor | null>(null);
  const [loadingMoreThreads, setLoadingMoreThreads] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [threadActionBusy, setThreadActionBusy] = useState(false);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [messages, setMessages] = useState<readonly AiMessage[]>([]);
  const [messageCursor, setMessageCursor] = useState<AiCursor | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sideOpen, setSideOpen] = useState(() => window.matchMedia('(min-width: 1120px)').matches);
  const [desktop, setDesktop] = useState(() => window.matchMedia('(min-width: 1120px)').matches);
  const selectedVersion = useRef(0);
  const pendingRequest = useRef<{ threadId: string; requestId: string; text: string } | null>(null);
  const [pendingMessage, setPendingMessage] = useState<{ requestId: string; text: string } | null>(
    null,
  );
  const chatScroll = useRef<HTMLDivElement>(null);
  const restoreScroll = useRef<{ height: number; top: number } | null>(null);

  useEffect(() => {
    const media = window.matchMedia('(min-width: 1120px)');
    const change = (): void => {
      setDesktop(media.matches);
      setSideOpen(media.matches);
    };
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.all([
      call<AiStatus>('/api/ai/status'),
      call<AiPage<AiThread>>('/api/ai/threads'),
    ])
      .then(([model, history]) => {
        if (!active) return;
        if (model.ok) setStatus(model.data);
        else setError(model.error.message);
        if (history.ok) {
          setThreads(history.data.items);
          setThreadCursor(history.data.nextCursor ?? null);
        } else setError(history.error.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      selectedVersion.current += 1;
    };
  }, []);

  useLayoutEffect(() => {
    const node = chatScroll.current;
    if (!node) return;
    const restore = restoreScroll.current;
    if (restore) {
      node.scrollTop = node.scrollHeight - restore.height + restore.top;
      restoreScroll.current = null;
    } else {
      node.scrollTo({ top: node.scrollHeight });
    }
  }, [messages, busy]);

  async function refreshThreads(): Promise<void> {
    const result = await call<AiPage<AiThread>>('/api/ai/threads');
    if (result.ok) {
      setThreads(result.data.items);
      setThreadCursor(result.data.nextCursor ?? null);
    }
  }

  async function loadMoreThreads(): Promise<void> {
    const cursor = threadCursor;
    if (!cursor || loadingMoreThreads) return;
    setLoadingMoreThreads(true);
    try {
      const result = await call<AiPage<AiThread>>('/api/ai/threads' + cursorQuery(cursor));
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setThreads((previous) => {
        const ids = new Set(previous.map((thread) => thread.id));
        return [...previous, ...result.data.items.filter((thread) => !ids.has(thread.id))];
      });
      setThreadCursor(result.data.nextCursor ?? null);
    } finally {
      setLoadingMoreThreads(false);
    }
  }

  async function loadOlderMessages(): Promise<void> {
    const cursor = messageCursor;
    const threadId = currentId;
    if (!cursor || !threadId || loadingOlder || busy) return;
    const version = selectedVersion.current;
    setLoadingOlder(true);
    const node = chatScroll.current;
    if (node) restoreScroll.current = { height: node.scrollHeight, top: node.scrollTop };
    try {
      const result = await call<AiPage<AiMessage>>(
        '/api/ai/threads/' + encodeURIComponent(threadId) + '/messages' + cursorQuery(cursor),
      );
      if (version !== selectedVersion.current) return;
      if (!result.ok) {
        restoreScroll.current = null;
        setError(result.error.message);
        return;
      }
      setMessages((previous) => {
        const seen = new Set(previous.map((message) => message.id));
        return [...result.data.items.filter((item) => !seen.has(item.id)), ...previous];
      });
      setMessageCursor(result.data.nextCursor ?? null);
    } finally {
      setLoadingOlder(false);
    }
  }

  async function renameThread(id: string): Promise<void> {
    const title = editingTitle.trim();
    if (!title || title.length > 120 || busy || threadActionBusy) return;
    setThreadActionBusy(true);
    const result = await call<AiThread>('/api/ai/threads/' + encodeURIComponent(id), {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    });
    if (result.ok) {
      setThreads((previous) =>
        previous.map((thread) => (thread.id === id ? result.data : thread)),
      );
      setEditingId(null);
      setError(null);
    } else setError(result.error.message);
    setThreadActionBusy(false);
  }

  async function deleteThread(id: string): Promise<void> {
    if (busy || threadActionBusy) return;
    setThreadActionBusy(true);
    const result = await call<{ deleted: true }>('/api/ai/threads/' + encodeURIComponent(id), {
      method: 'DELETE',
      body: JSON.stringify({}),
    });
    if (result.ok) {
      setThreads((previous) => previous.filter((thread) => thread.id !== id));
      setConfirmDeleteId(null);
      if (currentId === id) {
        selectedVersion.current += 1;
        setCurrentId(null);
        setMessages([]);
        setMessageCursor(null);
        setDraft('');
      }
      setError(null);
    } else setError(result.error.message);
    setThreadActionBusy(false);
  }

  async function selectThread(id: string): Promise<void> {
    if (busy) return;
    const version = ++selectedVersion.current;
    pendingRequest.current = null;
    setPendingMessage(null);
    setCurrentId(id);
    setMessages([]);
    setMessageCursor(null);
    restoreScroll.current = null;
    setError(null);
    if (!desktop) setSideOpen(false);
    const result = await call<AiPage<AiMessage>>(
      '/api/ai/threads/' + encodeURIComponent(id) + '/messages',
    );
    if (version !== selectedVersion.current) return;
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setMessages(result.data.items);
    setMessageCursor(result.data.nextCursor ?? null);
  }

  async function newChat(): Promise<string | null> {
    if (busy) return null;
    setError(null);
    const result = await call<{ id: string }>('/api/ai/threads', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    if (!result.ok) {
      setError(result.error.message);
      return null;
    }
    selectedVersion.current += 1;
    pendingRequest.current = null;
    setPendingMessage(null);
    setCurrentId(result.data.id);
    setMessages([]);
    setMessageCursor(null);
    if (!desktop) setSideOpen(false);
    await refreshThreads();
    return result.data.id;
  }

  async function send(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const text = draft.trim();
    if (!text || text.length > 3000 || !status?.enabled || busy) return;

    // A repeated click after a network-unknown outcome must use exactly the
    // original billable admission ID rather than silently paying twice.
    const previous = pendingRequest.current;
    const requestId =
      previous?.threadId === currentId && previous.text === text
        ? previous.requestId
        : crypto.randomUUID();
    setPendingMessage({ requestId, text });
    setBusy(true);
    setError(null);
    const version = ++selectedVersion.current;
    try {
      let id = currentId;
      if (!id) {
        const created = await call<{ id: string }>('/api/ai/threads', {
          method: 'POST',
          body: JSON.stringify({}),
        });
        if (!created.ok) {
          setError(created.error.message);
          return;
        }
        id = created.data.id;
        setCurrentId(id);
        setMessages([]);
        if (!desktop) setSideOpen(false);
      }
      pendingRequest.current = { threadId: id, requestId, text };
      const result = await call<{ messages: AiMessage[]; replayed: boolean }>(
        '/api/ai/threads/' + encodeURIComponent(id) + '/messages',
        {
          method: 'POST',
          body: JSON.stringify({ message: text, requestId }),
        },
      );
      if (version !== selectedVersion.current) return;
      if (result.ok) {
        setMessages(result.data.messages);
        const completed = result.data.messages.some(
          (message) => message.requestId === requestId && message.role === 'assistant',
        );
        if (!result.data.replayed || completed) {
          setDraft('');
          pendingRequest.current = null;
        } else {
          setError(
            'Запрос уже был принят. Повторная отправка модели не выполнялась. Обновите историю, чтобы проверить ответ.',
          );
        }
      } else {
        setError(result.error.message);
        // A lost response may still have committed the user turn. Load it by
        // the stable request ID, not by matching arbitrary previous text.
        const history = await call<{ items: AiMessage[] }>(
          '/api/ai/threads/' + encodeURIComponent(id) + '/messages',
        );
        if (history.ok && version === selectedVersion.current) {
          setMessages(history.data.items);
          if (
            history.data.items.some(
              (message) => message.role === 'user' && message.requestId === requestId,
            )
          ) {
            setDraft('');
          }
          if (
            history.data.items.some(
              (message) => message.role === 'assistant' && message.requestId === requestId,
            )
          ) {
            pendingRequest.current = null;
            setError(null);
          }
        }
      }
      await refreshThreads();
    } finally {
      if (version === selectedVersion.current) {
        setPendingMessage(null);
        setBusy(false);
      }
    }
  }

  const visible = threads.filter((thread) =>
    thread.title.toLocaleLowerCase('ru-RU').includes(search.trim().toLocaleLowerCase('ru-RU')),
  );
  const empty = messages.length === 0 && pendingMessage === null;

  return (
    <main id="main-content" className="asa-ai-layout" tabIndex={-1}>
      <section
        className={
          'chat-page asa-ai-chat' + (sideOpen ? ' sidebar-open' : '') + (empty ? ' is-empty' : '')
        }
        aria-label="ИИ-помощник ASA Lab"
      >
        <aside className="chat-sidebar" aria-label="История диалогов">
          <header className="chat-sidebar-head">
            <strong className="chat-sidebar-title">ASA Lab · ИИ</strong>
            <div className="chat-sidebar-head-actions">
              <button
                className="chat-icon-button"
                type="button"
                onClick={() => setSideOpen(false)}
                aria-label="Свернуть историю"
              >
                ☰
              </button>
            </div>
          </header>
          <div className="chat-sidebar-actions">
            <button type="button" disabled={busy || loading} onClick={() => void newChat()}>
              <span aria-hidden="true">＋</span>
              <span>Новый чат</span>
            </button>
            <label className="chat-search-box">
              <span className="sr-only">Найти диалог</span>
              <span aria-hidden="true">⌕</span>
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Поиск по истории"
              />
            </label>
          </div>
          <strong className="chat-side-section">Недавние</strong>
          <nav className="chat-history-list" aria-label="Диалоги">
            {visible.map((thread) => (
              <div className="asa-ai-thread-row" key={thread.id}>
                {editingId === thread.id ? (
                  <form
                    className="asa-ai-thread-edit"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void renameThread(thread.id);
                    }}
                  >
                    <input
                      aria-label="Новое название диалога"
                      maxLength={120}
                      value={editingTitle}
                      onChange={(event) => setEditingTitle(event.target.value)}
                      autoFocus
                    />
                    <button type="submit" disabled={threadActionBusy || !editingTitle.trim()}>
                      Сохранить
                    </button>
                    <button type="button" onClick={() => setEditingId(null)}>
                      Отмена
                    </button>
                  </form>
                ) : confirmDeleteId === thread.id ? (
                  <div className="asa-ai-thread-edit" role="group" aria-label="Подтверждение удаления">
                    <span>Удалить диалог?</span>
                    <button
                      type="button"
                      disabled={threadActionBusy}
                      onClick={() => void deleteThread(thread.id)}
                    >
                      Удалить
                    </button>
                    <button type="button" onClick={() => setConfirmDeleteId(null)}>
                      Отмена
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={busy || threadActionBusy}
                      className={'chat-history-item' + (currentId === thread.id ? ' active' : '')}
                      aria-current={currentId === thread.id ? 'page' : undefined}
                      onClick={() => void selectThread(thread.id)}
                    >
                      {thread.title}
                    </button>
                    <button
                      className="asa-ai-thread-action"
                      type="button"
                      disabled={busy || threadActionBusy}
                      aria-label={'Переименовать: ' + thread.title}
                      title="Переименовать"
                      onClick={() => {
                        setEditingId(thread.id);
                        setEditingTitle(thread.title);
                        setConfirmDeleteId(null);
                      }}
                    >
                      ✎
                    </button>
                    <button
                      className="asa-ai-thread-action"
                      type="button"
                      disabled={busy || threadActionBusy}
                      aria-label={'Удалить: ' + thread.title}
                      title="Удалить"
                      onClick={() => {
                        setConfirmDeleteId(thread.id);
                        setEditingId(null);
                      }}
                    >
                      ×
                    </button>
                  </>
                )}
              </div>
            ))}
            {threadCursor ? (
              <button
                type="button"
                className="chat-history-more"
                disabled={loadingMoreThreads}
                onClick={() => void loadMoreThreads()}
              >
                {loadingMoreThreads ? 'Загружаем…' : 'Показать больше диалогов'}
              </button>
            ) : null}
            {!loading && visible.length === 0 ? (
              <p className="asa-ai-empty-list">Диалогов пока нет</p>
            ) : null}
          </nav>
          <footer className="chat-sidebar-bottom">
            <span className="asa-ai-privacy">Диалоги доступны только вашему аккаунту.</span>
          </footer>
        </aside>

        {!desktop && sideOpen ? (
          <button
            className="chat-drawer-backdrop"
            type="button"
            onClick={() => setSideOpen(false)}
            aria-label="Закрыть историю"
          />
        ) : null}

        <div className="chat-main">
          <header className="chat-toolbar">
            {!sideOpen ? (
              <button
                type="button"
                className="chat-icon-button chat-sidebar-open"
                onClick={() => setSideOpen(true)}
                aria-label="Открыть историю диалогов"
              >
                ☰
              </button>
            ) : null}
            <div className="asa-ai-provider-label">
              <strong>ИИ-помощник</strong>
              <span>{status?.enabled ? status.model : 'Модель не подключена'}</span>
            </div>
          </header>

          {empty ? (
            <div className="chat-start-state">
              <div className="asa-ai-start-copy">
                <span className="asa-ai-orb" aria-hidden="true">
                  A
                </span>
                <h1>Чем я могу помочь?</h1>
                <p>Спросите про программирование, электронику, Arduino, проекты или учёбу.</p>
                {!status?.enabled && !loading ? (
                  <p className="chat-start-note" role="status">
                    ИИ пока выключен. Администратор должен подключить модель в разделе «Админ → ИИ».
                  </p>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="chat-scroll" ref={chatScroll}>
              <div className="chat-column">
                <div className="chat-turns">
                  {messageCursor ? (
                    <button
                      type="button"
                      className="chat-load-older"
                      disabled={loadingOlder || busy}
                      onClick={() => void loadOlderMessages()}
                    >
                      {loadingOlder ? 'Загрузка…' : 'Загрузить предыдущие сообщения'}
                    </button>
                  ) : null}
                  {messages.map((message) => (
                    <article
                      className={
                        'chat-turn ' +
                        (message.role === 'user' ? 'chat-turn-user' : 'chat-turn-assistant')
                      }
                      key={message.id}
                    >
                      {message.role === 'user' ? (
                        <div className="chat-user-bubble">{message.content}</div>
                      ) : (
                        <div className="chat-assistant-message">
                          <Content content={message.content} />
                          <div className="chat-message-actions">
                            <button
                              type="button"
                              onClick={() =>
                                void navigator.clipboard
                                  .writeText(message.content)
                                  .catch(() => setError('Не удалось скопировать ответ.'))
                              }
                            >
                              Копировать
                            </button>
                          </div>
                        </div>
                      )}
                    </article>
                  ))}
                  {pendingMessage &&
                  !messages.some(
                    (message) =>
                      message.requestId === pendingMessage.requestId && message.role === 'user',
                  ) ? (
                    <article className="chat-turn chat-turn-user" data-testid="ai-pending-message">
                      <div className="chat-user-bubble">{pendingMessage.text}</div>
                    </article>
                  ) : null}
                  {busy ? (
                    <div className="chat-runtime-note" role="status">
                      Модель формирует ответ… Сообщение сохранится в истории.
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          )}
          {error ? (
            <div className="asa-ai-error" role="alert">
              {error}
              {currentId && !busy ? (
                <button
                  className="btn-secondary"
                  type="button"
                  onClick={() => void selectThread(currentId)}
                >
                  Обновить переписку
                </button>
              ) : null}
            </div>
          ) : null}
          <div className="chat-composer-dock">
            <div className="chat-composer-wrap">
              <form className="chat-composer" onSubmit={(event) => void send(event)}>
                <button
                  className="chat-circle-button chat-composer-plus"
                  type="button"
                  disabled
                  title="Вложения будут подключены на следующем этапе"
                  aria-label="Прикрепление файлов пока недоступно"
                >
                  ＋
                </button>
                <textarea
                  value={draft}
                  maxLength={3000}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                  rows={2}
                  placeholder={status?.enabled ? 'Напишите сообщение…' : 'ИИ пока не подключён'}
                  disabled={!status?.enabled || busy}
                  aria-label="Сообщение ИИ"
                />
                <span className="chat-model-selector" aria-label="Текущая модель">
                  {status?.model ?? 'GPT'}
                </span>
                <button
                  type="submit"
                  className="chat-send-button"
                  disabled={!status?.enabled || busy || !draft.trim()}
                  aria-label="Отправить сообщение"
                >
                  ↑
                </button>
              </form>
              <p className="chat-composer-note">
                Возможны неточности. Не отправляйте в ИИ личные данные учеников.
              </p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
