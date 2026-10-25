import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { aiScopeHeaders, createAiScopeCall } from './ai-scope-api';
import { AiStreamClientError, streamAiRegeneration, streamAiRequest } from './stream-ai-request';
import { AiMessageContent } from './AiMessageContent';
import {
  AI_CHAT_FILE_ACCEPT,
  checkAiChatFiles,
  uploadAiChatFile,
  type AiChatFileDraft,
} from './ai-chat-attachments';
import { fetchWithSessionRefresh } from '../session-fetch';
import { useAiThreadHistory, type AiHistoryThread as AiThread } from './use-ai-thread-history';
import './izo-chat-design.css';
import './ai-gpt-layout.css';

interface AiMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly content: string;
  readonly createdAt: string;
  readonly requestId: string;
  readonly state?: 'complete' | 'stopped';
  readonly sourceUserMessageId?: string;
  readonly sourcePrompt?: string;
  readonly regenerated?: boolean;
}

interface AiHistoryAttachment {
  readonly uploadId: string;
  readonly fileName: string | null;
  readonly sizeBytes: number;
  readonly mediaType: string;
  readonly kind: string;
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
  readonly reason?: string | null;
  readonly canGenerate?: boolean;
  readonly providerEnabled?: boolean;
  readonly enabled: boolean;
  readonly provider: 'openai' | 'deepseek' | 'ollama';
  readonly ollamaModel?: string | null;
  readonly model: string;
  readonly availableModels?: readonly string[];
}

export function AiChatPage({
  seatId,
  scopeControl,
}: { seatId?: string; scopeControl?: ReactNode } = {}): JSX.Element {
  const call = useMemo(() => createAiScopeCall(seatId), [seatId]);
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [selectedModel, setSelectedModel] = useState('');
  const {
    threads,
    nextCursor: threadCursor,
    loadingMore: loadingMoreThreads,
    loading: loadingThreads,
    error: historyError,
    refresh: refreshThreads,
    loadMore: loadMoreThreads,
    search,
    setSearch,
  } = useAiThreadHistory(call);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [threadActionBusy, setThreadActionBusy] = useState(false);
  const threadMutationBusy = useRef(false);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [currentThread, setCurrentThread] = useState<AiThread | null>(null);
  const currentArchived = useRef(false);
  const [messages, setMessages] = useState<readonly AiMessage[]>([]);
  const [messageCursor, setMessageCursor] = useState<AiCursor | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [draft, setDraft] = useState('');
  const [composerExpanded, setComposerExpanded] = useState(false);
  const [attachments, setAttachments] = useState<readonly AiChatFileDraft[]>([]);
  const [historyAttachments, setHistoryAttachments] = useState<
    Record<string, readonly AiHistoryAttachment[]>
  >({});
  const fileInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const toolsMenu = useRef<HTMLDetailsElement>(null);
  const previewUrls = useRef(new Set<string>());
  const attachmentHistoryScope = useRef<{
    threadId: string | null;
    loaded: Set<string>;
  }>({ threadId: null, loaded: new Set<string>() });
  const [busy, setBusy] = useState(false);
  const [creatingChat, setCreatingChat] = useState(false);
  // Serialize creation and sending before React renders disabled controls.
  const requestBusy = useRef(false);
  const selectedHistoryReady = useRef(true);
  const [historyReady, setHistoryReady] = useState(true);
  const interactionBusy = busy || creatingChat || threadActionBusy;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sideOpen, setSideOpen] = useState(() => window.matchMedia('(min-width: 1120px)').matches);
  const [desktop, setDesktop] = useState(() => window.matchMedia('(min-width: 1120px)').matches);
  const selectedVersion = useRef(0);
  const pendingRequest = useRef<{ threadId: string; requestId: string; text: string } | null>(null);
  const [streamedText, setStreamedText] = useState('');
  const [pendingRegeneration, setPendingRegeneration] = useState<{
    threadId: string;
    requestId: string;
    sourceId: string;
    prompt: string;
  } | null>(null);
  const [checkingResult, setCheckingResult] = useState(false);
  const resultCheckBusy = useRef(false);
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
  useEffect(() => {
    const dismissMenu = (event: PointerEvent): void => {
      if (toolsMenu.current && !toolsMenu.current.contains(event.target as Node)) {
        toolsMenu.current.removeAttribute('open');
      }
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') toolsMenu.current?.removeAttribute('open');
    };
    document.addEventListener('pointerdown', dismissMenu);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', dismissMenu);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);
  const restoreScroll = useRef<{ height: number; top: number } | null>(null);

  useEffect(() => {
    const urls = previewUrls.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  function releaseFiles(files: readonly AiChatFileDraft[]): void {
    for (const item of files) {
      if (item.preview) {
        URL.revokeObjectURL(item.preview);
        previewUrls.current.delete(item.preview);
      }
    }
  }

  function clearFiles(): void {
    releaseFiles(attachments);
    setAttachments([]);
  }

  function addFiles(files: readonly File[]): void {
    if (interactionBusy || requestBusy.current || currentArchived.current) return;
    const selected = [...attachments.map((item) => item.file), ...files];
    const issue = checkAiChatFiles(selected);
    if (issue) {
      setError(issue);
      return;
    }
    const additions = files.map((file) => {
      const image = /\.(png|jpe?g|webp)$/i.test(file.name);
      const preview = image ? URL.createObjectURL(file) : null;
      if (preview) previewUrls.current.add(preview);
      return { uploadId: crypto.randomUUID(), file, preview };
    });
    setAttachments((current) => [...current, ...additions]);
    setError(null);
  }

  function removeFile(uploadId: string): void {
    const selected = attachments.find((item) => item.uploadId === uploadId);
    if (selected) releaseFiles([selected]);
    setAttachments((current) => current.filter((item) => item.uploadId !== uploadId));
  }

  async function downloadAttachment(file: AiHistoryAttachment): Promise<void> {
    try {
      const response = await fetchWithSessionRefresh(
        '/api/ai/attachments/' + encodeURIComponent(file.uploadId) + '/bytes',
        { headers: aiScopeHeaders(seatId), cache: 'no-store' },
      );
      if (!response.ok) throw new Error('Не удалось открыть сохранённое вложение.');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = file.fileName ?? 'attachment';
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError('Не удалось получить файл. Проверьте доступ к нему.');
    }
  }

  useEffect(() => {
    const receipts = attachmentHistoryScope.current;
    if (receipts.threadId !== currentId) {
      receipts.threadId = currentId;
      receipts.loaded.clear();
      setHistoryAttachments({});
    }
    if (!currentId) return;
    const ids = [
      ...new Set(
        messages.filter((message) => message.role === 'user').map((message) => message.requestId),
      ),
    ].filter((id) => !receipts.loaded.has(id));
    if (!ids.length) return;
    const version = selectedVersion.current;
    const threadId = currentId;
    let cancelled = false;
    // The server accepts at most 50 IDs. Load only previously unseen requests
    // and merge batches so paginating old turns never hides newer file chips.
    void (async () => {
      for (let start = 0; start < ids.length; start += 50) {
        if (
          cancelled ||
          version !== selectedVersion.current ||
          attachmentHistoryScope.current.threadId !== threadId
        )
          return;
        const batch = ids.slice(start, start + 50);
        const result = await call<{
          items: readonly { requestId: string; attachments: readonly AiHistoryAttachment[] }[];
        }>(
          '/api/ai/threads/' +
            encodeURIComponent(threadId) +
            '/attachments?requestIds=' +
            batch.join(','),
        );
        if (
          cancelled ||
          version !== selectedVersion.current ||
          attachmentHistoryScope.current.threadId !== threadId ||
          !result.ok
        )
          return;
        for (const id of batch) receipts.loaded.add(id);
        setHistoryAttachments((previous) => ({
          ...previous,
          ...Object.fromEntries(
            result.data.items.map((item) => [item.requestId, item.attachments]),
          ),
        }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [call, currentId, messages]);

  useEffect(() => {
    const selected = threads.find((thread) => thread.id === currentId);
    if (selected) {
      currentArchived.current = !!selected.archivedAt;
      setCurrentThread(selected);
    }
  }, [currentId, threads]);

  useLayoutEffect(() => {
    const panel = historyPanel.current;
    if (!panel) return;
    if (panel.open) panel.close();
    if (sideOpen) {
      if (desktop) panel.show();
      else panel.showModal();
    }
  }, [desktop, sideOpen]);

  useEffect(() => {
    const panel = historyPanel.current;
    if (desktop || !sideOpen || !panel) return;
    // A native modal makes the background inert. Keep keyboard navigation
    // inside its controls as well, including after a focused action disables
    // itself while loading and the browser moves focus to the document.
    const handleHistoryKey = (event: KeyboardEvent): void => {
      if (!panel.matches(':modal')) return;
      if (event.key === 'Escape') {
        // Search inputs consume Escape to clear their value before a native
        // dialog receives cancel. The history shortcut must still close it.
        event.preventDefault();
        closeHistory();
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = [...panel.querySelectorAll<HTMLElement>('button, input, [tabindex]')].filter(
        (node) =>
          node.tabIndex >= 0 && !node.matches(':disabled') && node.getClientRects().length > 0,
      );
      const first = controls[0];
      const last = controls.at(-1);
      if (!first || !last) return;
      const active = document.activeElement;
      const inside = controls.some((node) => node === active);
      if (event.shiftKey ? active === first || !inside : active === last || !inside) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener('keydown', handleHistoryKey);
    return () => document.removeEventListener('keydown', handleHistoryKey);
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
    const measure = (): void => {
      node.style.height = 'auto';
      const naturalHeight = node.scrollHeight;
      node.style.height = `${Math.min(naturalHeight, 160)}px`;
      setComposerExpanded((previous) => {
        if (attachments.length > 0 || draft.includes('\n') || naturalHeight > 44) return true;
        return draft.length <= 12 ? false : previous;
      });
    };
    measure();
    // Opening the ASA/history sidebar changes the chat width without a window
    // resize. Observe that container rather than waiting for the next keystroke.
    const widthTarget = node.closest('.chat-main');
    const observer = widthTarget ? new ResizeObserver(measure) : null;
    if (widthTarget) observer?.observe(widthTarget);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [draft, attachments.length]);

  useEffect(() => {
    const media = window.matchMedia('(min-width: 1120px)');
    const change = (): void => {
      setDesktop(media.matches);
      // Do not reopen history on a wide viewport when ASA navigation is open.
      const sidebar = document.getElementById('portal-sidebar');
      setSideOpen(media.matches && (!sidebar || sidebar.classList.contains('collapsed')));
    };
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);

  useEffect(() => {
    // ASA navigation is a sibling React tree. Observe its *actual* state so
    // history never competes for width when the site panel expands, including
    // when navigation is restored by another control or during hydration.
    const portalSidebar = document.getElementById('portal-sidebar');
    if (!portalSidebar) return;
    const sync = (): void => {
      if (
        window.matchMedia('(min-width: 1120px)').matches &&
        !portalSidebar.classList.contains('collapsed')
      )
        setSideOpen(false);
    };
    const observer = new MutationObserver(sync);
    observer.observe(portalSidebar, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('asa-ai-portal-sidebar-expanded', sync);
    sync();
    return () => {
      observer.disconnect();
      window.removeEventListener('asa-ai-portal-sidebar-expanded', sync);
    };
  }, []);

  useEffect(() => {
    let active = true;
    void call<AiStatus>('/api/ai/status')
      .then((model) => {
        if (!active) return;
        if (model.ok) {
          setStatus(model.data);
          setSelectedModel((previous) =>
            model.data.availableModels?.includes(previous) ? previous : model.data.model,
          );
        } else setError(model.error.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      selectedVersion.current += 1;
      activeStream.current?.controller.abort();
    };
  }, [call]);

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

  async function refreshAdmission() {
    const version = selectedVersion.current;
    const result = await call<AiStatus>('/api/ai/status');
    if (version !== selectedVersion.current) return;
    if (result.ok) {
      setStatus(result.data);
      setError(null);
    } else setError(result.error.message);
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
    if (!title || title.length > 120 || requestBusy.current || threadMutationBusy.current) return;
    threadMutationBusy.current = true;
    setThreadActionBusy(true);
    try {
      const result = await call<AiThread>('/api/ai/threads/' + encodeURIComponent(id), {
        method: 'PATCH',
        body: JSON.stringify({ title }),
      });
      if (result.ok) {
        setCurrentThread((previous) =>
          previous?.id === id ? { ...previous, title: result.data.title } : previous,
        );
        void refreshThreads();
        setEditingId(null);
        setError(null);
      } else setError(result.error.message);
    } finally {
      threadMutationBusy.current = false;
      setThreadActionBusy(false);
    }
  }

  async function deleteThread(id: string): Promise<void> {
    if (requestBusy.current || threadMutationBusy.current) return;
    threadMutationBusy.current = true;
    setThreadActionBusy(true);
    const version = selectedVersion.current;
    try {
      const result = await call<{ deleted: true }>('/api/ai/threads/' + encodeURIComponent(id), {
        method: 'DELETE',
        body: JSON.stringify({}),
      });
      if (result.ok) {
        void refreshThreads();
        setConfirmDeleteId(null);
        // A delayed response must never clear a newer selected conversation.
        if (currentId === id && version === selectedVersion.current) {
          selectedVersion.current += 1;
          selectedHistoryReady.current = true;
          pendingRequest.current = null;
          restoreScroll.current = null;
          setHistoryReady(true);
          setCurrentId(null);
          setCurrentThread(null);
          currentArchived.current = false;
          setPendingRegeneration(null);
          setMessages([]);
          setMessageCursor(null);
          setDraft('');
        }
        setError(null);
      } else setError(result.error.message);
    } finally {
      threadMutationBusy.current = false;
      setThreadActionBusy(false);
    }
  }

  async function archiveThread(id: string, archived: boolean): Promise<void> {
    if (requestBusy.current || threadMutationBusy.current) return;
    threadMutationBusy.current = true;
    setThreadActionBusy(true);
    const version = selectedVersion.current;
    try {
      const result = await call<AiThread>(
        '/api/ai/threads/' + encodeURIComponent(id) + '/archive',
        {
          method: 'PATCH',
          body: JSON.stringify({ archived }),
        },
      );
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      if (currentId === id && version === selectedVersion.current) {
        currentArchived.current = !!result.data.archivedAt;
        setCurrentThread(result.data);
      }
      setEditingId(null);
      setConfirmDeleteId(null);
      setError(null);
      void refreshThreads();
    } finally {
      threadMutationBusy.current = false;
      setThreadActionBusy(false);
    }
  }

  async function selectThread(id: string): Promise<void> {
    if (requestBusy.current || threadMutationBusy.current) return;
    const version = ++selectedVersion.current;
    // Guard synchronously, including Enter before disabled controls render.
    selectedHistoryReady.current = false;
    setHistoryReady(false);
    pendingRequest.current = null;
    setPendingMessage(null);
    clearFiles();
    // Reset both sides of the receipt cache when reselecting this same thread.
    // Clearing only the rendered chips would keep old IDs marked as loaded.
    attachmentHistoryScope.current.loaded.clear();
    setHistoryAttachments({});
    setCurrentId(id);
    currentArchived.current = !!(threads.find((thread) => thread.id === id) ?? currentThread)
      ?.archivedAt;
    setCurrentThread(
      (previous) =>
        threads.find((thread) => thread.id === id) ?? (previous?.id === id ? previous : null),
    );
    setPendingRegeneration((previous) => (previous?.threadId === id ? previous : null));
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

  async function newChat(preserveAttachments = false): Promise<string | null> {
    if (requestBusy.current || threadMutationBusy.current) return null;
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
      if (!preserveAttachments) clearFiles();
      attachmentHistoryScope.current.loaded.clear();
      setHistoryAttachments({});
      setCurrentId(result.data.id);
      setCurrentThread({
        id: result.data.id,
        title: 'Новый диалог',
        updatedAt: new Date().toISOString(),
      });
      currentArchived.current = false;
      setPendingRegeneration(null);
      setMessages([]);
      setMessageCursor(null);
      if (!desktop) setSideOpen(false);
      void refreshThreads();
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
    const requestKey = text + '\u0000' + attachments.map((item) => item.uploadId).join(',');
    if (
      !text ||
      text.length > 3000 ||
      !status?.enabled ||
      currentArchived.current ||
      requestBusy.current ||
      threadMutationBusy.current ||
      !selectedHistoryReady.current
    ) {
      return;
    }
    const previous = pendingRequest.current;
    const requestId =
      previous?.threadId === currentId && previous.text === requestKey
        ? previous.requestId
        : crypto.randomUUID();
    requestBusy.current = true;
    setPendingRegeneration(null);
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
        // Scope changes or navigation invalidate this send before a stream
        // exists for cleanup to abort. Never start one for that stale owner.
        if (version !== selectedVersion.current) return;
        if (!created.ok) {
          setError(created.error.message);
          return;
        }
        id = created.data.id;
        setCurrentId(id);
        setCurrentThread({ id, title: 'Новый диалог', updatedAt: new Date().toISOString() });
        currentArchived.current = false;
        setMessages([]);
        setMessageCursor(null);
        if (!desktop) setSideOpen(false);
      }
      pendingRequest.current = { threadId: id, requestId, text: requestKey };
      const controller = new AbortController();
      activeStream.current = { threadId: id, requestId, controller };
      try {
        const uploadIds: string[] = [];
        for (const file of attachments) {
          uploadIds.push(await uploadAiChatFile(file, seatId, controller.signal));
          if (version !== selectedVersion.current) return;
        }
        const result = await streamAiRequest<AiMessage>(
          id,
          text,
          requestId,
          (piece) => {
            if (version === selectedVersion.current) setStreamedText((value) => value + piece);
          },
          controller.signal,
          selectedModel || status.model,
          aiScopeHeaders(seatId),
          ...(uploadIds.length ? ([uploadIds] as const) : ([] as const)),
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
          clearFiles();
        } else {
          setError('Запрос уже был принят. Повторная платная генерация не выполнялась.');
        }
      } catch (problem) {
        if (problem instanceof AiStreamClientError && problem.code === 'ai_student_denied') {
          void refreshAdmission();
        }
        if (version !== selectedVersion.current) return;
        setError(
          problem instanceof Error
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
              (message) => message.role === 'assistant' && message.requestId === requestId,
            )
          ) {
            // The persisted answer settles the original request. Never carry
            // its already-bound uploads into a new request after an SSE loss.
            setDraft('');
            pendingRequest.current = null;
            clearFiles();
            setError(null);
          }
        }
      } finally {
        activeStream.current = null;
      }
      void refreshThreads();
    } finally {
      requestBusy.current = false;
      setPendingMessage(null);
      setStreamedText('');
      setBusy(false);
    }
  }

  function sourceFor(message: AiMessage): { id: string; prompt: string } | null {
    if (message.role === 'user') return { id: message.id, prompt: message.content };
    if (message.sourceUserMessageId) {
      return { id: message.sourceUserMessageId, prompt: message.sourcePrompt ?? '' };
    }
    const question = messages.find(
      (item) => item.role === 'user' && item.requestId === message.requestId,
    );
    return question ? { id: question.id, prompt: question.content } : null;
  }

  async function readRegeneration(
    operation: NonNullable<typeof pendingRegeneration>,
    version: number,
  ): Promise<'saved' | 'pending' | 'failed' | 'stale'> {
    const result = await call<AiPage<AiMessage>>(
      '/api/ai/threads/' +
        encodeURIComponent(operation.threadId) +
        '/requests/' +
        encodeURIComponent(operation.requestId),
    );
    if (version !== selectedVersion.current) return 'stale';
    if (!result.ok) {
      setError(result.error.message);
      return 'failed';
    }
    const acknowledged = result.data.items.filter(
      (message) => message.requestId === operation.requestId,
    );
    setMessages((previous) => mergeMessages(previous, acknowledged));
    if (acknowledged.some((message) => message.role === 'assistant')) {
      setPendingRegeneration((previous) =>
        previous?.requestId === operation.requestId ? null : previous,
      );
      setError(null);
      return 'saved';
    }
    return 'pending';
  }

  async function checkRegeneration(): Promise<void> {
    if (!pendingRegeneration || resultCheckBusy.current || requestBusy.current) return;
    resultCheckBusy.current = true;
    setCheckingResult(true);
    const version = selectedVersion.current;
    try {
      const result = await readRegeneration(pendingRegeneration, version);
      if (result === 'pending' && version === selectedVersion.current) {
        setError(
          'Сохранённого ответа пока нет. Проверка не запускает модель и не расходует лимит.',
        );
      }
    } finally {
      resultCheckBusy.current = false;
      setCheckingResult(false);
    }
  }

  async function regenerate(message: AiMessage): Promise<void> {
    const source = sourceFor(message);
    if (
      !source ||
      !currentId ||
      !status?.enabled ||
      currentArchived.current ||
      requestBusy.current ||
      threadMutationBusy.current ||
      !selectedHistoryReady.current
    )
      return;
    // Only this explicit action creates a new paid operation. Checking an
    // uncertain result below always reads the original UUID without a POST.
    const operation = {
      threadId: currentId,
      requestId: crypto.randomUUID(),
      sourceId: source.id,
      prompt: source.prompt,
    };
    const version = ++selectedVersion.current;
    requestBusy.current = true;
    setBusy(true);
    setError(null);
    setPendingMessage(null);
    setStreamedText('');
    setPendingRegeneration(operation);
    const controller = new AbortController();
    activeStream.current = { ...operation, controller };
    try {
      const result = await streamAiRegeneration<AiMessage>(
        operation.threadId,
        operation.sourceId,
        operation.requestId,
        (piece) => {
          if (version === selectedVersion.current) setStreamedText((value) => value + piece);
        },
        controller.signal,
        selectedModel || status.model,
        aiScopeHeaders(seatId),
      );
      if (version !== selectedVersion.current) return;
      const acknowledged = result.messages.filter(
        (message) => message.requestId === operation.requestId,
      );
      setMessages((previous) => mergeMessages(previous, acknowledged));
      if (acknowledged.some((message) => message.role === 'assistant')) {
        setPendingRegeneration(null);
      } else {
        setError(
          'Ответ пока не сохранён. Можно проверить результат этого запроса без новой генерации.',
        );
      }
    } catch (problem) {
      if (version !== selectedVersion.current) return;
      if (problem instanceof AiStreamClientError && problem.code === 'ai_student_denied') {
        // The SQL admission denied this operation before reserving a payment.
        // Refresh only AI permission; there is no uncertain answer to recover.
        setPendingRegeneration(null);
        await refreshAdmission();
        return;
      }
      setError(
        problem instanceof AiStreamClientError
          ? problem.message
          : 'Соединение прервалось. Проверьте сохранённый ответ.',
      );
      await readRegeneration(operation, version);
    } finally {
      activeStream.current = null;
      requestBusy.current = false;
      setBusy(false);
      setStreamedText('');
    }
    void refreshThreads();
  }

  const empty = messages.length === 0 && pendingMessage === null && !streamedText;
  const currentTitle = currentThread?.title || 'Новый диалог';
  const archived = !!currentThread?.archivedAt;
  const visibleError = error ?? historyError;
  const lastQuestion = [...messages].reverse().find((message) => message.role === 'user');

  function openHistory(): void {
    // Give the site its normal navigation state when history takes the width.
    window.dispatchEvent(new Event('asa-ai-chat-history-opened'));
    setSideOpen(true);
  }

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
            <strong className="chat-sidebar-title">Чаты</strong>
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
              <span aria-hidden="true">+</span>
              <span>Новый чат</span>
            </button>
            <label className="chat-search-box">
              <span className="sr-only">Найти диалог</span>
              <span aria-hidden="true">⌕</span>
              <input
                type="search"
                value={search}
                maxLength={200}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Поиск по истории"
              />
            </label>
          </div>
          {!desktop && visibleError ? (
            <div className="asa-ai-error asa-ai-history-error" role="alert">
              {visibleError}
            </div>
          ) : null}
          {!desktop && historyError ? (
            <button
              type="button"
              className="chat-history-more"
              onClick={() => void refreshThreads()}
            >
              Обновить список
            </button>
          ) : null}
          <strong className="chat-side-section">
            {search.trim() ? 'Результаты поиска' : 'Недавние'}
          </strong>
          <nav className="chat-history-list" aria-label="Диалоги" aria-busy={loadingThreads}>
            {loadingThreads ? (
              <p className="asa-ai-empty-list" role="status">
                Загружаем историю…
              </p>
            ) : null}
            {threads.map((thread) => (
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
                      aria-label={thread.title}
                      aria-describedby={thread.matchPreview ? 'ai-match-' + thread.id : undefined}
                      onClick={() => void selectThread(thread.id)}
                    >
                      <span className="chat-history-title">{thread.title}</span>
                      {thread.matchPreview ? (
                        <span className="chat-history-preview" id={'ai-match-' + thread.id}>
                          {thread.matchPreview}
                        </span>
                      ) : null}
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
            {!loadingThreads && !historyError && threads.length === 0 ? (
              <p className="asa-ai-empty-list">
                {search.trim() ? 'Ничего не найдено в истории' : 'Здесь появятся ваши диалоги'}
              </p>
            ) : null}
          </nav>
        </dialog>

        <div className="chat-main">
          <div className="chat-utility-strip">
            {!sideOpen || !desktop ? (
              <button
                ref={historyToggle}
                className="chat-icon-button chat-sidebar-open"
                type="button"
                onClick={openHistory}
                aria-label="Открыть историю диалогов"
                aria-controls="ai-chat-history"
                aria-expanded={sideOpen}
                title="История диалогов"
              >
                <span aria-hidden="true">☰</span>
              </button>
            ) : null}
            <span className="sr-only asa-ai-current-title">{currentTitle}</span>
            <button
              className="chat-icon-button asa-ai-new-chat"
              type="button"
              disabled={interactionBusy || loading}
              onClick={() => void newChat()}
              aria-label="Создать новый диалог"
              title="Новый диалог"
            >
              <span aria-hidden="true">✎</span>
            </button>
          </div>

          {!historyReady && !error ? (
            <div className="chat-start-state" role="status">
              Загрузка переписки…
            </div>
          ) : empty ? (
            <div className="chat-start-state" aria-hidden="true" />
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
                        <>
                          <div className="chat-user-bubble">{message.content}</div>
                          {historyAttachments[message.requestId]?.length ? (
                            <div className="chat-attached-history" aria-label="Вложения сообщения">
                              {historyAttachments[message.requestId]?.map((file) => (
                                <button
                                  key={file.uploadId}
                                  type="button"
                                  onClick={() => void downloadAttachment(file)}
                                  title="Получить сохранённое вложение"
                                >
                                  {file.kind === 'image' ? '▧' : '▤'} {file.fileName ?? 'Вложение'}
                                </button>
                              ))}
                            </div>
                          ) : null}
                          {message.id === lastQuestion?.id &&
                          !messages.some(
                            (answer) =>
                              answer.role === 'assistant' &&
                              (answer.sourceUserMessageId === message.id ||
                                answer.requestId === message.requestId),
                          ) ? (
                            <div className="chat-message-actions">
                              <button
                                type="button"
                                disabled={
                                  interactionBusy || archived || !status?.enabled || !historyReady
                                }
                                onClick={() => void regenerate(message)}
                                title="Новый запрос к модели расходует лимит. Исходный вопрос останется в истории."
                              >
                                Получить новый ответ
                              </button>
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <div className="chat-assistant-message">
                          {message.regenerated ? (
                            <details className="chat-variant-source">
                              <summary>Новый вариант · исходный вопрос</summary>
                              <p>
                                {message.sourcePrompt || 'Исходный вопрос сохранён выше в истории.'}
                              </p>
                            </details>
                          ) : null}
                          <AiMessageContent content={message.content} />
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
                            {sourceFor(message) ? (
                              <button
                                type="button"
                                disabled={
                                  interactionBusy || archived || !status?.enabled || !historyReady
                                }
                                onClick={() => void regenerate(message)}
                                title="Новый запрос к модели расходует лимит. Вопрос и все прежние ответы останутся в истории."
                              >
                                Новый вариант ответа
                              </button>
                            ) : null}
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
                      item.role === 'assistant' &&
                      item.requestId ===
                        (pendingMessage?.requestId ?? pendingRegeneration?.requestId),
                  ) ? (
                    <article
                      className="chat-turn chat-turn-assistant"
                      data-testid="ai-streaming-answer"
                      aria-live="polite"
                      aria-atomic="false"
                    >
                      <span className="chat-turn-label">ASA · ИИ</span>
                      <div className="chat-assistant-message">
                        {pendingRegeneration ? (
                          <details className="chat-variant-source">
                            <summary>Новый вариант · исходный вопрос</summary>
                            <p>{pendingRegeneration.prompt}</p>
                          </details>
                        ) : null}
                        <AiMessageContent content={streamedText} />
                      </div>
                    </article>
                  ) : null}
                  {busy ? (
                    <div className="chat-runtime-note" role="status">
                      Модель формирует ответ…
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          )}
          {visibleError || archived || (!busy && pendingRegeneration) ? (
            <div
              className={'asa-ai-error' + (visibleError ? '' : ' chat-history-notice')}
              role={visibleError ? 'alert' : 'status'}
            >
              {visibleError}
              {historyError ? (
                <button type="button" onClick={() => void refreshThreads()}>
                  Обновить список
                </button>
              ) : null}
              {archived ? (
                <>
                  <span>Диалог в архиве. Переписка и черновик сохранены.</span>
                  <button
                    type="button"
                    disabled={interactionBusy}
                    onClick={() => currentId && void archiveThread(currentId, false)}
                  >
                    Восстановить диалог
                  </button>
                </>
              ) : null}
              {pendingRegeneration && !busy ? (
                <button
                  type="button"
                  disabled={checkingResult}
                  onClick={() => void checkRegeneration()}
                >
                  {checkingResult ? 'Проверяем…' : 'Проверить сохранённый ответ'}
                </button>
              ) : null}
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
              <form
                className={composerExpanded ? 'chat-composer expanded' : 'chat-composer compact'}
                onSubmit={(event) => void send(event)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  addFiles(Array.from(event.dataTransfer.files));
                }}
              >
                {attachments.length ? (
                  <div className="chat-attachment-drafts" aria-label="Выбранные вложения">
                    {attachments.map((item) => (
                      <div key={item.uploadId} className="chat-attachment-chip">
                        {item.preview ? (
                          <img src={item.preview} alt="" />
                        ) : (
                          <span aria-hidden="true">▤</span>
                        )}
                        <span title={item.file.name}>
                          {item.file.name}
                          <small>
                            {(item.file.type || item.file.name.split('.').at(-1) || 'файл') +
                              ' · ' +
                              Math.ceil(item.file.size / 1024) +
                              ' КБ'}
                          </small>
                        </span>
                        <button
                          type="button"
                          disabled={interactionBusy}
                          aria-label={'Удалить ' + item.file.name}
                          onClick={() => removeFile(item.uploadId)}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
                <input
                  ref={fileInput}
                  type="file"
                  multiple
                  accept={AI_CHAT_FILE_ACCEPT}
                  className="sr-only"
                  aria-label="Выбрать файлы для ИИ"
                  onChange={(event) => {
                    addFiles(Array.from(event.currentTarget.files ?? []));
                    event.currentTarget.value = '';
                  }}
                />
                <input
                  ref={imageInput}
                  type="file"
                  multiple
                  accept="image/png,image/jpeg,image/webp"
                  className="sr-only"
                  aria-label="Выбрать изображения для ИИ"
                  onChange={(event) => {
                    addFiles(Array.from(event.currentTarget.files ?? []));
                    event.currentTarget.value = '';
                  }}
                />
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
                  rows={1}
                  placeholder="Спросить ASA Lab"
                  disabled={interactionBusy || archived}
                  aria-label="Сообщение ИИ"
                  aria-describedby="ai-composer-note"
                />
                <div className="chat-composer-controls">
                  <details className="chat-tools-menu" ref={toolsMenu}>
                    <summary
                      className="chat-attach-button"
                      aria-label="Инструменты чата"
                      title="Инструменты"
                    >
                      <span aria-hidden="true">+</span>
                    </summary>
                    <div className="chat-tools-popup" role="group" aria-label="Добавить в чат">
                      <button
                        type="button"
                        disabled={interactionBusy || archived}
                        onClick={() => {
                          toolsMenu.current?.removeAttribute('open');
                          imageInput.current?.click();
                        }}
                      >
                        <span aria-hidden="true">▧</span> Добавить изображение
                      </button>
                      <button
                        type="button"
                        disabled={interactionBusy || archived}
                        onClick={() => {
                          toolsMenu.current?.removeAttribute('open');
                          fileInput.current?.click();
                        }}
                      >
                        <span aria-hidden="true">▤</span> Фото и файлы
                      </button>
                      <div className="chat-tools-divider" />
                      <button type="button" disabled title="Интернет-поиск пока не реализован">
                        <span aria-hidden="true">⌕</span> Поиск в интернете
                        <small>Скоро</small>
                      </button>
                      <button
                        type="button"
                        disabled
                        title="Генерация изображений пока не реализована"
                      >
                        <span aria-hidden="true">◇</span> Создать изображение
                        <small>Скоро</small>
                      </button>
                    </div>
                  </details>
                  <div className="chat-composer-end">
                    {scopeControl}
                    <div className="asa-ai-provider-label">
                      {(status?.availableModels?.length ?? 0) > 1 ? (
                        <select
                          className="asa-ai-model-picker"
                          aria-label="Модель ИИ"
                          title="Выбрать модель"
                          value={selectedModel || status?.model}
                          onChange={(event) => setSelectedModel(event.target.value)}
                          disabled={interactionBusy || !status?.enabled}
                        >
                          {status?.availableModels?.map((name) => (
                            <option key={name} value={name}>
                              {name === 'ollama-local'
                                ? 'Ollama · ' + (status.ollamaModel || 'локальная модель')
                                : name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="asa-ai-model-single">
                          {status?.enabled
                            ? status.model === 'ollama-local'
                              ? 'Ollama · ' + (status.ollamaModel || 'локальная модель')
                              : status.model
                            : 'Модель'}
                        </span>
                      )}
                    </div>
                    <button
                      className="chat-microphone"
                      type="button"
                      disabled
                      title="Голосовой ввод пока не доступен"
                      aria-label="Голосовой ввод пока не доступен"
                    >
                      <svg
                        width="19"
                        height="19"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        aria-hidden="true"
                      >
                        <rect x="9" y="2" width="6" height="13" rx="3" />
                        <path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" />
                      </svg>
                    </button>
                    <button
                      type={busy ? 'button' : 'submit'}
                      className="chat-send-button"
                      disabled={
                        (!busy && (!status?.enabled || archived)) ||
                        creatingChat ||
                        threadActionBusy ||
                        (!busy && (!historyReady || !draft.trim()))
                      }
                      onClick={busy ? () => void stop() : undefined}
                      aria-label={busy ? 'Остановить генерацию' : 'Отправить сообщение'}
                    >
                      {busy ? '■' : '↑'}
                    </button>
                  </div>
                </div>
                <span className="chat-composer-hint sr-only">Shift + Enter — новая строка</span>
                <span className="chat-character-count sr-only">{draft.length} / 3000</span>
              </form>
              <p className="sr-only" id="ai-composer-note">
                Проверяйте важные ответы. Не отправляйте пароли и личные данные.
              </p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
