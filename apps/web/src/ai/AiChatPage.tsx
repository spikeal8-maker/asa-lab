import {
  isValidElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { call } from '../api-call';
import { AsaLabMark } from '../brand/AsaLabBrand';
import { AiStreamClientError, streamAiRequest } from './stream-ai-request';
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
  readonly state?: 'complete' | 'stopped';
}

interface AiCursor {
  readonly at: string;
  readonly id: string;
}

function mergeMessages(
  previous: readonly AiMessage[],
  incoming: readonly AiMessage[],
): readonly AiMessage[] {
  const messages = new Map(previous.map((message) => [message.id, message]));
  for (const message of incoming) messages.set(message.id, message);
  return [...messages.values()];
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
  readonly availableModels?: readonly string[];
}

function flattenText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(flattenText).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return flattenText(node.props.children);
  return '';
}

function safeLink(href?: string): { href: string; external: boolean } | null {
  if (!href) return null;
  try {
    const url = new URL(href, window.location.origin);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return { href, external: url.origin !== window.location.origin };
  } catch {
    return null;
  }
}

function Content({ content }: { readonly content: string }): JSX.Element {
  return (
    <div className="asa-ai-rich-text">
      <ReactMarkdown
        skipHtml
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            const safe = safeLink(href);
            return safe ? (
              <a
                href={safe.href}
                target={safe.external ? '_blank' : undefined}
                rel={safe.external ? 'noreferrer noopener' : undefined}
              >
                {children}
              </a>
            ) : (
              <span>{children}</span>
            );
          },
          pre: ({ children }) => {
            const code = flattenText(children).replace(/\n$/, '');
            return (
              <div className="asa-ai-code-block">
                <button
                  type="button"
                  onClick={() => void navigator.clipboard.writeText(code).catch(() => undefined)}
                  aria-label="Копировать код"
                >
                  Копировать код
                </button>
                <pre>{children}</pre>
              </div>
            );
          },
          table: ({ children }) => (
            <div
              className="asa-ai-table-scroll"
              role="region"
              aria-label="Таблица ответа"
              tabIndex={0}
            >
              <table>{children}</table>
            </div>
          ),
          img: ({ alt }) => <span>{alt || 'Изображение в ответе недоступно'}</span>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export function AiChatPage(): JSX.Element {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [selectedModel, setSelectedModel] = useState('');
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
  const [creatingChat, setCreatingChat] = useState(false);
  // Serialize creation and sending before React renders disabled controls.
  const requestBusy = useRef(false);
  const selectedHistoryReady = useRef(true);
  const [historyReady, setHistoryReady] = useState(true);
  const interactionBusy = busy || creatingChat;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sideOpen, setSideOpen] = useState(() => window.matchMedia('(min-width: 1120px)').matches);
  const [desktop, setDesktop] = useState(() => window.matchMedia('(min-width: 1120px)').matches);
  const selectedVersion = useRef(0);
  const pendingRequest = useRef<{ threadId: string; requestId: string; text: string } | null>(null);
  const [streamedText, setStreamedText] = useState('');
  const activeStream = useRef<{
    threadId: string;
    requestId: string;
    controller: AbortController;
  } | null>(null);
  const [pendingMessage, setPendingMessage] = useState<{ requestId: string; text: string } | null>(
    null,
  );
  const chatScroll = useRef<HTMLDivElement>(null);
  const layout = useRef<HTMLElement>(null);
  const historyPanel = useRef<HTMLDialogElement>(null);
  const historyToggle = useRef<HTMLButtonElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const restoreScroll = useRef<{ height: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const panel = historyPanel.current;
    if (!panel) return;
    if (panel.open) panel.close();
    if (sideOpen) {
      if (desktop) panel.show();
      else panel.showModal();
    }
  }, [desktop, sideOpen]);

  useLayoutEffect(() => {
    // visualViewport also follows the on-screen keyboard on mobile browsers.
    // Keep this measurement on the chat root; the portal shell is unaffected.
    const resize = (): void => {
      const node = layout.current;
      if (!node) return;
      const viewport = window.visualViewport;
      const bottom = viewport ? viewport.height + viewport.offsetTop : window.innerHeight;
      node.style.setProperty(
        '--ai-available-height',
        `${Math.max(0, bottom - node.getBoundingClientRect().top - 8)}px`,
      );
    };
    resize();
    window.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('scroll', resize);
    return () => {
      window.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('scroll', resize);
    };
  }, []);

  useLayoutEffect(() => {
    const node = composer.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${Math.min(node.scrollHeight, 160)}px`;
  }, [draft]);

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
    void Promise.all([call<AiStatus>('/api/ai/status'), call<AiPage<AiThread>>('/api/ai/threads')])
      .then(([model, history]) => {
        if (!active) return;
        if (model.ok) {
          setStatus(model.data);
          setSelectedModel((previous) =>
            model.data.availableModels?.includes(previous) ? previous : model.data.model,
          );
        } else setError(model.error.message);
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
      activeStream.current?.controller.abort();
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
  }, [messages, busy, streamedText]);

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
    if (!cursor || !threadId || loadingOlder || requestBusy.current) return;
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
    if (!title || title.length > 120 || requestBusy.current || threadActionBusy) return;
    setThreadActionBusy(true);
    const result = await call<AiThread>('/api/ai/threads/' + encodeURIComponent(id), {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    });
    if (result.ok) {
      setThreads((previous) => previous.map((thread) => (thread.id === id ? result.data : thread)));
      setEditingId(null);
      setError(null);
    } else setError(result.error.message);
    setThreadActionBusy(false);
  }

  async function deleteThread(id: string): Promise<void> {
    if (requestBusy.current || threadActionBusy) return;
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
        selectedHistoryReady.current = true;
        setHistoryReady(true);
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
    if (requestBusy.current) return;
    const version = ++selectedVersion.current;
    // Guard synchronously, including Enter before disabled controls render.
    selectedHistoryReady.current = false;
    setHistoryReady(false);
    pendingRequest.current = null;
    setPendingMessage(null);
    setCurrentId(id);
    setMessages([]);
    setMessageCursor(null);
    restoreScroll.current = null;
    setError(null);
    if (!desktop) setSideOpen(false);
    try {
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
      selectedHistoryReady.current = true;
    } catch {
      if (version === selectedVersion.current) {
        setError('Не удалось загрузить переписку. Попробуйте ещё раз.');
      }
    } finally {
      // An older GET must never unlock a newer selection. Failed loads stay
      // guarded until retry succeeds or the user selects/creates another chat.
      if (version === selectedVersion.current) setHistoryReady(selectedHistoryReady.current);
    }
  }

  async function newChat(): Promise<string | null> {
    if (requestBusy.current) return null;
    requestBusy.current = true;
    setCreatingChat(true);
    setError(null);
    try {
      const result = await call<{ id: string }>('/api/ai/threads', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      if (!result.ok) {
        setError(result.error.message);
        return null;
      }
      selectedVersion.current += 1;
      selectedHistoryReady.current = true;
      setHistoryReady(true);
      pendingRequest.current = null;
      setPendingMessage(null);
      setCurrentId(result.data.id);
      setMessages([]);
      setMessageCursor(null);
      if (!desktop) setSideOpen(false);
      await refreshThreads();
      return result.data.id;
    } catch {
      setError('Не удалось создать чат. Попробуйте ещё раз.');
      return null;
    } finally {
      requestBusy.current = false;
      setCreatingChat(false);
    }
  }

  async function stop(): Promise<void> {
    const current = activeStream.current;
    if (!current) return;
    const result = await call<{ stopped: boolean }>(
      '/api/ai/threads/' +
        encodeURIComponent(current.threadId) +
        '/requests/' +
        encodeURIComponent(current.requestId) +
        '/stop',
      { method: 'POST', body: JSON.stringify({}) },
    );
    // If another server worker owns the stream, aborting this connection
    // still cancels its own upstream call and preserves available text.
    if (!result.ok || !result.data.stopped) current.controller.abort();
  }

  async function send(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const text = draft.trim();
    if (
      !text ||
      text.length > 3000 ||
      !status?.enabled ||
      requestBusy.current ||
      !selectedHistoryReady.current
    ) {
      return;
    }
    const previous = pendingRequest.current;
    const requestId =
      previous?.threadId === currentId && previous.text === text
        ? previous.requestId
        : crypto.randomUUID();
    requestBusy.current = true;
    setPendingMessage({ requestId, text });
    setStreamedText('');
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
        setMessageCursor(null);
        if (!desktop) setSideOpen(false);
      }
      pendingRequest.current = { threadId: id, requestId, text };
      const controller = new AbortController();
      activeStream.current = { threadId: id, requestId, controller };
      try {
        const result = await streamAiRequest<AiMessage>(
          id,
          text,
          requestId,
          (piece) => {
            if (version === selectedVersion.current) setStreamedText((value) => value + piece);
          },
          controller.signal,
          selectedModel || status.model,
        );
        if (version !== selectedVersion.current) return;
        setStreamedText('');
        // Older servers include their last 80 messages; only this request is
        // acknowledged here. Keep the loaded history and its pagination cursor.
        const acknowledged = result.messages.filter((message) => message.requestId === requestId);
        setMessages((previous) => mergeMessages(previous, acknowledged));
        const completed = result.messages.some(
          (message) => message.requestId === requestId && message.role === 'assistant',
        );
        if (!result.replayed || completed) {
          setDraft('');
          pendingRequest.current = null;
        } else {
          setError('Запрос уже был принят. Повторная платная генерация не выполнялась.');
        }
      } catch (problem) {
        if (version !== selectedVersion.current) return;
        setError(
          problem instanceof AiStreamClientError
            ? problem.message
            : 'Не удалось завершить ответ. Проверьте историю диалога.',
        );
        const history = await call<AiPage<AiMessage>>(
          '/api/ai/threads/' + encodeURIComponent(id) + '/messages',
        );
        if (history.ok && version === selectedVersion.current) {
          // Recovery returns the newest page, not all previously loaded pages.
          setMessages((previous) => mergeMessages(previous, history.data.items));
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
      } finally {
        activeStream.current = null;
      }
      await refreshThreads();
    } finally {
      requestBusy.current = false;
      setPendingMessage(null);
      setStreamedText('');
      setBusy(false);
    }
  }

  const visible = threads.filter((thread) =>
    thread.title.toLocaleLowerCase('ru-RU').includes(search.trim().toLocaleLowerCase('ru-RU')),
  );
  const empty = messages.length === 0 && pendingMessage === null && !streamedText;
  const currentTitle = threads.find((thread) => thread.id === currentId)?.title || 'Новый диалог';

  function closeHistory(): void {
    setSideOpen(false);
    requestAnimationFrame(() => historyToggle.current?.focus());
  }

  return (
    <main id="main-content" className="asa-ai-layout" tabIndex={-1} ref={layout}>
      <section
        className={
          'chat-page asa-ai-chat' + (sideOpen ? ' sidebar-open' : '') + (empty ? ' is-empty' : '')
        }
        aria-label="ИИ-помощник ASA Lab"
      >
        <dialog
          id="ai-chat-history"
          className="chat-sidebar"
          ref={historyPanel}
          aria-label="История диалогов"
          onCancel={(event) => {
            event.preventDefault();
            closeHistory();
          }}
          onClick={(event) => {
            if (desktop || event.target !== event.currentTarget) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            if (
              event.clientX < bounds.left ||
              event.clientX > bounds.right ||
              event.clientY < bounds.top ||
              event.clientY > bounds.bottom
            ) {
              closeHistory();
            }
          }}
        >
          <header className="chat-sidebar-head">
            <strong className="chat-sidebar-title">История диалогов</strong>
            <div className="chat-sidebar-head-actions">
              <button
                className="chat-icon-button"
                type="button"
                onClick={closeHistory}
                aria-label={desktop ? 'Свернуть историю' : 'Закрыть историю'}
                title={desktop ? 'Свернуть историю' : 'Закрыть историю'}
              >
                <span aria-hidden="true">{desktop ? '‹' : '×'}</span>
              </button>
            </div>
          </header>
          <div className="chat-sidebar-actions">
            <button
              type="button"
              disabled={interactionBusy || loading}
              onClick={() => void newChat()}
            >
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
          {!desktop && error ? (
            <div className="asa-ai-error asa-ai-history-error" role="alert">
              {error}
            </div>
          ) : null}
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
                    <button
                      type="submit"
                      disabled={interactionBusy || threadActionBusy || !editingTitle.trim()}
                    >
                      Сохранить
                    </button>
                    <button type="button" onClick={() => setEditingId(null)}>
                      Отмена
                    </button>
                  </form>
                ) : confirmDeleteId === thread.id ? (
                  <div
                    className="asa-ai-thread-edit"
                    role="group"
                    aria-label="Подтверждение удаления"
                  >
                    <span>Удалить диалог?</span>
                    <button
                      type="button"
                      disabled={interactionBusy || threadActionBusy}
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
                      disabled={interactionBusy || threadActionBusy}
                      className={'chat-history-item' + (currentId === thread.id ? ' active' : '')}
                      aria-current={currentId === thread.id ? 'page' : undefined}
                      onClick={() => void selectThread(thread.id)}
                    >
                      {thread.title}
                    </button>
                    <button
                      className="asa-ai-thread-action"
                      type="button"
                      disabled={interactionBusy || threadActionBusy}
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
                      disabled={interactionBusy || threadActionBusy}
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
              <p className="asa-ai-empty-list">
                {search.trim()
                  ? 'Ничего не найдено в загруженной истории'
                  : 'Здесь появятся ваши диалоги'}
              </p>
            ) : null}
          </nav>
          <footer className="chat-sidebar-bottom">
            <span className="asa-ai-privacy">Диалоги доступны только вашему аккаунту.</span>
          </footer>
        </dialog>

        <div className="chat-main">
          <header className="chat-toolbar">
            {!sideOpen || !desktop ? (
              <button
                ref={historyToggle}
                type="button"
                className="chat-icon-button chat-sidebar-open"
                onClick={() => setSideOpen(true)}
                aria-label="Открыть историю диалогов"
                aria-controls="ai-chat-history"
                aria-expanded={sideOpen}
                title="История диалогов"
              >
                <span aria-hidden="true">☰</span>
              </button>
            ) : null}
            <div className="asa-ai-provider-label">
              <strong>ИИ-помощник</strong>
              <span className="asa-ai-current-title" title={currentTitle}>
                {currentTitle}
              </span>
            </div>
            <div className="asa-ai-model-status">
              {(status?.availableModels?.length ?? 0) > 1 ? (
                <select
                  className="asa-ai-model-picker"
                  aria-label="Модель ИИ"
                  value={selectedModel || status?.model}
                  onChange={(event) => setSelectedModel(event.target.value)}
                  disabled={interactionBusy || !status?.enabled}
                >
                  {status?.availableModels?.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              ) : (
                <span>
                  {loading ? 'Подключение…' : status?.enabled ? status.model : 'Не подключён'}
                </span>
              )}
            </div>
            <button
              type="button"
              className="chat-icon-button asa-ai-new-chat"
              disabled={interactionBusy || loading}
              onClick={() => void newChat()}
              aria-label="Создать новый диалог"
              title="Новый диалог"
            >
              <span aria-hidden="true">＋</span>
            </button>
          </header>

          {!historyReady && !error ? (
            <div className="chat-start-state" role="status">
              Загрузка переписки…
            </div>
          ) : empty ? (
            <div className="chat-start-state">
              <div className="asa-ai-start-copy">
                <div className="asa-ai-start-brand">
                  <AsaLabMark /> ASA Lab · ИИ
                </div>
                <h1>От идеи к работающему проекту</h1>
                <p>
                  Продумайте замысел, напишите код или разберитесь со схемой — начните с того, что
                  хотите создать.
                </p>
                <div className="asa-ai-starters" aria-label="С чего начать">
                  {[
                    {
                      title: 'Продумать идею',
                      detail: 'От замысла к плану',
                      prompt:
                        'Помоги продумать идею проекта и составить план реализации. Мой замысел: ',
                    },
                    {
                      title: 'Написать код',
                      detail: 'Решение и логика',
                      prompt: 'Помоги написать или улучшить код. Я хочу сделать: ',
                    },
                    {
                      title: 'Разобрать схему',
                      detail: 'Электроника и Arduino',
                      prompt:
                        'Помоги разобраться с электронной схемой и подобрать компоненты. Моя задача: ',
                    },
                  ].map((starter) => (
                    <button
                      key={starter.title}
                      type="button"
                      disabled={!status?.enabled || interactionBusy || !historyReady}
                      onClick={() => {
                        setDraft(starter.prompt);
                        composer.current?.focus();
                      }}
                    >
                      <strong>
                        {starter.title}
                        <span aria-hidden="true">↗</span>
                      </strong>
                      <span>{starter.detail}</span>
                    </button>
                  ))}
                </div>
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
                      disabled={loadingOlder || interactionBusy}
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
                      <span className="chat-turn-label">
                        {message.role === 'user' ? 'Вы' : 'ASA · ИИ'}
                      </span>
                      {message.role === 'user' ? (
                        <div className="chat-user-bubble">{message.content}</div>
                      ) : (
                        <div className="chat-assistant-message">
                          <Content content={message.content} />
                          {message.state === 'stopped' ? (
                            <span className="chat-runtime-note" role="status">
                              Ответ остановлен.
                            </span>
                          ) : null}
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
                      <span className="chat-turn-label">Вы</span>
                      <div className="chat-user-bubble">{pendingMessage.text}</div>
                    </article>
                  ) : null}
                  {streamedText &&
                  !messages.some(
                    (item) =>
                      item.role === 'assistant' && item.requestId === pendingMessage?.requestId,
                  ) ? (
                    <article
                      className="chat-turn chat-turn-assistant"
                      data-testid="ai-streaming-answer"
                      aria-live="polite"
                      aria-atomic="false"
                    >
                      <span className="chat-turn-label">ASA · ИИ</span>
                      <div className="chat-assistant-message">
                        <Content content={streamedText} />
                      </div>
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
              {currentId && !interactionBusy ? (
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
                <textarea
                  ref={composer}
                  value={draft}
                  maxLength={3000}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (
                      event.key === 'Enter' &&
                      !event.shiftKey &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                  rows={2}
                  placeholder={
                    status?.enabled ? 'Опишите идею или задачу…' : 'ИИ пока не подключён'
                  }
                  disabled={!status?.enabled || interactionBusy}
                  aria-label="Сообщение ИИ"
                  aria-describedby="ai-composer-note"
                />
                <span className="chat-composer-hint">Shift + Enter — новая строка</span>
                <span className="chat-character-count">{draft.length} / 3000</span>
                <button
                  type={busy ? 'button' : 'submit'}
                  className="chat-send-button"
                  disabled={
                    !status?.enabled || creatingChat || (!busy && (!historyReady || !draft.trim()))
                  }
                  onClick={busy ? () => void stop() : undefined}
                  aria-label={busy ? 'Остановить генерацию' : 'Отправить сообщение'}
                >
                  {busy ? '■' : '↑'}
                </button>
              </form>
              <p className="chat-composer-note" id="ai-composer-note">
                Проверяйте важные ответы. Не отправляйте пароли и личные данные.
              </p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
