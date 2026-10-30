import { aiImageSizeLabel } from '@asa-lab/contracts';
import {
  useEffect,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type CSSProperties,
} from 'react';
import { aiAdmissionMessage, aiScopeHeaders, createAiScopeCall } from './ai-scope-api';
import { AiStreamClientError, streamAiRegeneration, streamAiRequest } from './stream-ai-request';
import { AiMessageContent } from './AiMessageContent';
import type { AiTokenBudgetsOwn } from '@asa-lab/contracts';
import { AiChatIcon } from './AiChatIcon';
import { AiChatTooltips } from './AiChatTooltips';
import { AiActivity } from './AiActivity';
import { AiCompactSelect } from './AiCompactSelect';
import { AiVoiceInput } from './AiVoiceInput';
import { mergeVoiceTranscript } from './voice-transcript-draft';
import {
  AiImageGeneration,
  imageGenerationStatusShape,
  type ImageComposerController,
  type ImageComposerState,
} from './AiImageGeneration';
import type { ImageGenerationMode } from './image-generation-intent';
import { AiGeneratedImage } from './AiGeneratedImage';
import type {
  AiGeneratedImage as ImageReceipt,
  AiImageGenerationStatus,
  AiImageSize,
  AiImageGenerationJob,
} from '@asa-lab/contracts';
import { AiAnswerDownloads } from './AiAnswerDownloads';
import type { AiWebSearchEvidence, AiWebSearchMode, AiWebSearchStatus } from '@asa-lab/contracts';
import { AiWebEvidence } from './AiWebEvidence';
import { AiHistoryAttachment as SavedAttachmentCard } from './AiHistoryAttachment';
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
  readonly webSearch?: AiWebSearchEvidence;
  readonly generatedImages?: readonly ImageReceipt[];
  readonly generationKind?: 'image';
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

function attachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
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
  readonly nativeImageTools?: readonly string[];
  readonly reason?: string | null;
  readonly canGenerate?: boolean;
  readonly providerEnabled?: boolean;
  readonly enabled: boolean;
  readonly provider: 'openai' | 'deepseek' | 'ollama' | 'ollama-cloud';
  readonly ollamaModel?: string | null;
  readonly model: string;
  readonly availableModels?: readonly string[];
  readonly modelChoices?: readonly { id: string; label: string }[];
}

/** Keep the popover entirely inside the chat canvas, including short viewports
 * and the mobile visual viewport when the software keyboard is visible. */
function positionToolsMenu(details: HTMLDetailsElement): void {
  const trigger = details.querySelector('summary');
  const canvas = details.closest('.asa-ai-chat');
  if (!trigger || !canvas) return;
  const triggerBounds = trigger.getBoundingClientRect();
  const canvasBounds = canvas.getBoundingClientRect();
  const viewport = window.visualViewport;
  const top = Math.max(canvasBounds.top, viewport?.offsetTop ?? 0);
  const bottom = Math.min(
    canvasBounds.bottom,
    (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight),
  );
  const spaceAbove = Math.max(0, triggerBounds.top - top - 18);
  const spaceBelow = Math.max(0, bottom - triggerBounds.bottom - 12);
  const placeBelow = spaceAbove < 242 && spaceBelow > spaceAbove;
  details.dataset.menuPlacement = placeBelow ? 'below' : 'above';
  const usable = placeBelow ? spaceBelow : spaceAbove;
  details.style.setProperty(
    '--ai-tools-menu-max-height',
    Math.max(32, Math.min(360, usable)) + 'px',
  );
}

/** Render the server-supplied message snippet safely, without HTML injection. */
function searchExcerpt(preview: string, query: string): ReactNode {
  const needle = query.trim();
  if (!needle) return preview;
  const index = preview.toLocaleLowerCase('ru-RU').indexOf(needle.toLocaleLowerCase('ru-RU'));
  if (index < 0) return preview;
  const end = index + needle.length;
  return (
    <>
      {preview.slice(0, index)}
      <mark>{preview.slice(index, end)}</mark>
      {preview.slice(end)}
    </>
  );
}

export function AiChatPage({
  seatId,
  scopeControl,
}: { seatId?: string; scopeControl?: ReactNode } = {}): JSX.Element {
  const call = useMemo(() => createAiScopeCall(seatId), [seatId]);
  const [imageMode, setImageMode] = useState(false);
  const [imageSelection, setImageSelection] = useState<ImageGenerationMode>('auto');
  const [imageSize, setImageSize] = useState<AiImageSize>(1024);
  const imageController = useRef<ImageComposerController>(null);
  const imageHandoffPending = useRef(false);
  const [imageUi, setImageUi] = useState<ImageComposerState>({
    busy: false,
    canCancel: false,
    canSubmit: false,
    notice: '',
    sizes: [1024],
  });
  const onImageState = useCallback((state: ImageComposerState) => {
    if (state.busy) imageHandoffPending.current = false;
    setImageUi(state);
    setImageSize((previous) => (state.sizes.includes(previous) ? previous : state.sizes[0]!));
  }, []);
  const [imageStatus, setImageStatus] = useState<AiImageGenerationStatus | null>(null);
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [tokenBudgets, setTokenBudgets] = useState<AiTokenBudgetsOwn | null>(null);
  const [selectedModel, setSelectedModel] = useState('');
  const [webSearchStatus, setWebSearchStatus] = useState<AiWebSearchStatus | null>(null);
  const [webSearchMode, setWebSearchMode] = useState<AiWebSearchMode>('auto');
  const [searchOpen, setSearchOpen] = useState(false);
  const [historyWidth, setHistoryWidth] = useState(() => {
    try {
      const value = Number(localStorage.getItem('asa-ai-history-width'));
      return value >= 240 && value <= 420 ? value : 264;
    } catch {
      return 264;
    }
  });
  const resizingHistory = useRef(false);
  useEffect(() => {
    try {
      localStorage.setItem('asa-ai-history-width', String(historyWidth));
    } catch {
      /* Storage is optional. */
    }
  }, [historyWidth]);
  // The ASA portal currently uses a light shell. An explicit local choice must
  // not inherit the workstation's dark OS preference by accident.
  const [chatTheme, setChatTheme] = useState<'light' | 'dark'>(() => {
    try {
      return window.localStorage.getItem('asa-ai-chat-theme') === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });
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
    archived: archivedFilter,
    setArchived: setArchivedFilter,
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
  const [overflowTranscript, setOverflowTranscript] = useState<string | null>(null);
  useEffect(() => setOverflowTranscript(null), [currentId, seatId]);
  const [composerExpanded, setComposerExpanded] = useState(false);
  const [composerMaximized, setComposerMaximized] = useState(false);
  const [attachments, setAttachments] = useState<readonly AiChatFileDraft[]>([]);
  const [historyAttachments, setHistoryAttachments] = useState<
    Record<string, readonly AiHistoryAttachment[]>
  >({});
  const searchInput = useRef<HTMLInputElement>(null);
  const searchTrigger = useRef<HTMLButtonElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const toolsMenu = useRef<HTMLDetailsElement>(null);
  const previewUrls = useRef(new Set<string>());
  const attachmentHistoryScope = useRef<{
    threadId: string | null;
    loaded: Set<string>;
  }>({ threadId: null, loaded: new Set<string>() });
  const [busy, setBusy] = useState(false);
  // Reuse model-status refresh (focus/60s) to recover availability after a limit change.
  useEffect(() => {
    if (busy) return;
    let active = true;
    void call<AiTokenBudgetsOwn>('/api/ai/token-budgets')
      .then((reply) => {
        if (active) setTokenBudgets(reply.ok ? reply.data : null);
      })
      .catch(() => {
        if (active) setTokenBudgets(null);
      });
    return () => {
      active = false;
    };
  }, [call, busy, status]);
  const selectedBudget = tokenBudgets?.models?.find(
    (row) => row.model === (selectedModel || status?.model),
  );
  const [creatingChat, setCreatingChat] = useState(false);
  // Serialize creation and sending before React renders disabled controls.
  const requestBusy = useRef(false);
  const selectedHistoryReady = useRef(true);
  const [historyReady, setHistoryReady] = useState(true);
  const composerBusy = busy || imageUi.busy;
  const interactionBusy = composerBusy || creatingChat || threadActionBusy;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sideOpen, setSideOpen] = useState(() => window.matchMedia('(min-width: 1120px)').matches);
  const [desktop, setDesktop] = useState(() => window.matchMedia('(min-width: 1120px)').matches);
  const selectedVersion = useRef(0);
  const pendingRequest = useRef<{
    threadId: string;
    requestId: string;
    text: string;
    webSearch: { readonly mode: AiWebSearchMode } | undefined;
    nativeImage: { readonly mode: 'off' | 'auto'; readonly size: AiImageSize } | undefined;
  } | null>(null);
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
  const restoreComposerFocus = useRef(false);
  useEffect(() => {
    if (!interactionBusy || !restoreComposerFocus.current) return;
    const movedElsewhere = (target: EventTarget | null): void => {
      if (!(target instanceof Element)) return;
      if (target === composer.current || target.closest('.chat-send-button')) return;
      restoreComposerFocus.current = false;
    };
    const onFocus = (event: FocusEvent): void => movedElsewhere(event.target);
    const onPointer = (event: PointerEvent): void => movedElsewhere(event.target);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [interactionBusy]);
  useEffect(() => {
    const reposition = (): void => {
      const details = toolsMenu.current;
      if (details?.open) positionToolsMenu(details);
    };
    window.addEventListener('resize', reposition);
    window.visualViewport?.addEventListener('resize', reposition);
    window.visualViewport?.addEventListener('scroll', reposition);
    const dismissMenu = (event: PointerEvent): void => {
      if ((event.target as Element).closest?.('.ai-compact-popup')) return;
      if (toolsMenu.current && !toolsMenu.current.contains(event.target as Node)) {
        toolsMenu.current.removeAttribute('open');
      }
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !document.querySelector('.ai-compact-popup'))
        toolsMenu.current?.removeAttribute('open');
    };
    document.addEventListener('pointerdown', dismissMenu);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('resize', reposition);
      window.visualViewport?.removeEventListener('resize', reposition);
      window.visualViewport?.removeEventListener('scroll', reposition);
      document.removeEventListener('pointerdown', dismissMenu);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);
  const restoreScroll = useRef<{ height: number; top: number } | null>(null);
  useEffect(() => {
    if (searchOpen) searchInput.current?.focus();
  }, [searchOpen]);

  useEffect(() => {
    try {
      window.localStorage.setItem('asa-ai-chat-theme', chatTheme);
    } catch {
      // Restricted/WebView storage must not prevent normal chat use.
    }
  }, [chatTheme]);

  function closeSearch(restoreFocus = false): void {
    setSearchOpen(false);
    // The document-level Escape handler may have captured an older render;
    // the history hook itself deduplicates this against its live query ref.
    setSearch('');
    if (restoreFocus) requestAnimationFrame(() => searchTrigger.current?.focus());
  }

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
      else {
        panel.showModal();
        // A new overflow menu must not steal the initial keyboard focus
        // from the primary close action in the modal history drawer.
        panel
          .querySelector<HTMLButtonElement>('.chat-sidebar-head-actions .chat-sidebar-close')
          ?.focus();
      }
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
      const controls = [
        ...panel.querySelectorAll<HTMLElement>('button, input, summary, [tabindex]'),
      ].filter(
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
      node.style.height = `${Math.min(naturalHeight, composerMaximized ? 420 : 160)}px`;
      setComposerExpanded((previous) => {
        if (attachments.length > 0 || draft.includes('\n') || naturalHeight > 44) return true;
        return draft.length <= 12 ? false : previous;
      });
    };
    measure();
    // Opening the ASA/history sidebar changes the chat width without a window
    // resize. Observe that container rather than waiting for the next keystroke.
    const widthTarget = node.closest('.chat-main');
    // ResizeObserver is unavailable in some embedded/WebView and test runtimes.
    // Keep the input functional there; window resize remains a safe fallback.
    const observer =
      widthTarget && typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    if (widthTarget) observer?.observe(widthTarget);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [draft, attachments.length, composerMaximized]);

  useEffect(() => {
    setComposerMaximized(false);
  }, [currentId]);

  useEffect(() => {
    if (!draft) setComposerMaximized(false);
  }, [draft]);

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
    setWebSearchStatus(null);
    void call<AiImageGenerationStatus>('/api/ai/image-generation/status')
      .then((reply) => {
        if (active && reply.ok && imageGenerationStatusShape(reply.data))
          setImageStatus(reply.data);
      })
      .catch(() => {
        if (active) setImageStatus(null);
      });
    void call<AiWebSearchStatus>('/api/ai/web-search/status')
      .then((reply) => {
        if (
          active &&
          reply.ok &&
          reply.data &&
          reply.data.schemaVersion === 1 &&
          reply.data.provider === 'searxng' &&
          typeof reply.data.weatherConfigured === 'boolean' &&
          typeof reply.data.configured === 'boolean' &&
          typeof reply.data.enabled === 'boolean'
        ) {
          setWebSearchStatus(reply.data);
        }
      })
      .catch(() => {
        if (active) setWebSearchStatus(null);
      });
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
  }, [messages, busy, streamedText, imageUi.busy]);

  const refreshModelChoices = useCallback(async () => {
    if (requestBusy.current) return;
    const version = selectedVersion.current;
    const reply = await call<AiStatus>('/api/ai/status').catch(() => null);
    if (
      version !== selectedVersion.current ||
      requestBusy.current ||
      !reply ||
      !reply.ok ||
      !Array.isArray(reply.data.availableModels)
    )
      return;
    setStatus(reply.data);
    setSelectedModel((previous) => previous || reply.data.model);
  }, [call]);
  const wasGenerating = useRef(false);
  useEffect(() => {
    if (wasGenerating.current && !busy) void refreshModelChoices();
    wasGenerating.current = busy;
  }, [busy, refreshModelChoices]);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== 'hidden') void refreshModelChoices();
    };
    const timer = window.setInterval(refresh, 60000);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [refreshModelChoices]);

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
    try {
      if (sessionStorage.getItem('asa-ai-image:' + (seatId || 'personal') + ':' + id))
        setImageMode(true);
    } catch {
      /* Storage is optional for reading existing history. */
    }
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
    if (searchOpen) closeSearch();
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
    restoreComposerFocus.current = true;
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
    const active = document.activeElement;
    const focusWasInComposer =
      active === composer.current || active?.classList.contains('chat-send-button') === true;
    const text = draft.trim();
    const nativeReady = status?.nativeImageTools?.includes(selectedModel || status.model) === true;
    if (imageMode) {
      if (!text || interactionBusy || archived || !historyReady || schoolPolicyDenied) return;
      if (attachments.length) {
        setError(
          'Создание изображения работает по текстовому описанию. Уберите вложения или удалите метку изображения.',
        );
        return;
      }
      setImageMode(true);
      restoreComposerFocus.current = focusWasInComposer;
      await imageController.current?.submit(text, imageSize);
      return;
    }
    const requestedWebMode =
      webSearchStatus?.enabled &&
      (webSearchStatus.configured ||
        (webSearchMode === 'weather' && webSearchStatus.weatherConfigured))
        ? webSearchMode
        : 'off';
    const requestKey =
      text +
      '\u0000' +
      attachments.map((item) => item.uploadId).join(',') +
      '\u0000' +
      webSearchMode +
      '\u0000' +
      imageSelection +
      ':' +
      imageSize +
      ':' +
      (selectedModel || status?.model);
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
    restoreComposerFocus.current = focusWasInComposer;
    const previous = pendingRequest.current;
    const samePending = previous?.threadId === currentId && previous.text === requestKey;
    const frozenWebSearch = samePending
      ? previous.webSearch
      : webSearchStatus
        ? { mode: requestedWebMode }
        : undefined;
    const requestId = samePending ? previous.requestId : crypto.randomUUID();
    const frozenNativeImage = samePending
      ? previous.nativeImage
      : nativeReady
        ? { mode: imageSelection === 'off' ? ('off' as const) : ('auto' as const), size: imageSize }
        : undefined;
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
      pendingRequest.current = {
        threadId: id,
        requestId,
        text: requestKey,
        webSearch: frozenWebSearch,
        nativeImage: frozenNativeImage,
      };
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
          ...((frozenNativeImage
            ? [uploadIds, frozenWebSearch, frozenNativeImage]
            : frozenWebSearch
              ? [uploadIds, frozenWebSearch]
              : uploadIds.length
                ? [uploadIds]
                : []) as [
            uploadIds?: readonly string[],
            webSearch?: { mode: AiWebSearchMode },
            nativeImage?: { mode: 'off' | 'auto'; size: AiImageSize },
          ]),
        );
        if (version !== selectedVersion.current) return;
        setStreamedText('');
        if (result.imageJob?.threadId === id) {
          imageHandoffPending.current = !['complete', 'failed', 'cancelled'].includes(
            result.imageJob.state,
          );
          imageController.current?.follow(result.imageJob);
        }
        // Older servers include their last 80 messages; only this request is
        // acknowledged here. Keep the loaded history and its pagination cursor.
        const acknowledged = result.messages.filter((message) => message.requestId === requestId);
        setMessages((previous) => mergeMessages(previous, acknowledged));
        const completed = result.messages.some(
          (message) => message.requestId === requestId && message.role === 'assistant',
        );
        if (!result.replayed || completed || result.imageJob) {
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
        if (frozenNativeImage) {
          const receipt = await call<AiImageGenerationJob | null>(
            '/api/ai/threads/' +
              encodeURIComponent(id) +
              '/requests/' +
              encodeURIComponent(requestId) +
              '/image-generation',
          );
          if (version !== selectedVersion.current) return;
          if (receipt.ok && receipt.data?.threadId === id) {
            imageHandoffPending.current = !['complete', 'failed', 'cancelled'].includes(
              receipt.data.state,
            );
            imageController.current?.follow(receipt.data);
            setDraft('');
            pendingRequest.current = null;
            clearFiles();
            setError(null);
            return;
          }
        }
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
  const schoolPolicyDenied =
    !!seatId &&
    !status?.enabled &&
    !!status?.reason &&
    [
      'ai_rating_required',
      'ai_rating_unavailable',
      'ai_seat_denied',
      'ai_teacher_permission_required',
      'ai_student_denied',
      'ai_scope_inactive',
    ].includes(status.reason);
  const schoolAdmission = schoolPolicyDenied ? aiAdmissionMessage(status?.reason) : null;
  useEffect(() => {
    if (interactionBusy || imageHandoffPending.current || !restoreComposerFocus.current) return;
    const frame = requestAnimationFrame(() => {
      if (!restoreComposerFocus.current) return;
      restoreComposerFocus.current = false;
      if (!archived && !schoolPolicyDenied && composer.current && !composer.current.disabled) {
        composer.current.focus();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [interactionBusy, archived, schoolPolicyDenied]);
  const lastQuestion = [...messages].reverse().find((message) => message.role === 'user');

  function openHistory(): void {
    // Give the site its normal navigation state when history takes the width.
    window.dispatchEvent(new Event('asa-ai-chat-history-opened'));
    setSideOpen(true);
  }

  function closeHistory(): void {
    closeSearch();
    setSideOpen(false);
    requestAnimationFrame(() => historyToggle.current?.focus());
  }

  return (
    <main
      id="main-content"
      className="asa-ai-layout"
      style={{ '--ai-history-width': historyWidth + 'px' } as CSSProperties}
      data-chat-theme={chatTheme}
      tabIndex={-1}
      ref={layout}
    >
      <AiChatTooltips />
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
          {desktop ? (
            <div
              className="chat-history-resizer"
              role="separator"
              aria-label="Ширина истории диалогов"
              aria-orientation="vertical"
              aria-valuemin={240}
              aria-valuemax={420}
              aria-valuenow={historyWidth}
              tabIndex={0}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                resizingHistory.current = true;
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                if (!resizingHistory.current) return;
                const panel = historyPanel.current;
                if (panel)
                  setHistoryWidth(
                    Math.max(
                      240,
                      Math.min(420, Math.round(event.clientX - panel.getBoundingClientRect().left)),
                    ),
                  );
              }}
              onPointerUp={() => {
                resizingHistory.current = false;
              }}
              onLostPointerCapture={() => {
                resizingHistory.current = false;
              }}
              onPointerCancel={() => {
                resizingHistory.current = false;
              }}
              onKeyDown={(event) => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                setHistoryWidth((value) =>
                  event.key === 'Home'
                    ? 240
                    : event.key === 'End'
                      ? 420
                      : Math.max(
                          240,
                          Math.min(420, value + (event.key === 'ArrowRight' ? 20 : -20)),
                        ),
                );
              }}
            />
          ) : null}
          <header className="chat-sidebar-head">
            <strong className="chat-sidebar-title">Чаты</strong>
            <div className="chat-sidebar-head-actions">
              <button
                className="chat-icon-button chat-sidebar-close"
                type="button"
                onClick={closeHistory}
                aria-label={desktop ? 'Свернуть историю' : 'Закрыть историю'}
                data-ai-tooltip={desktop ? 'Свернуть историю' : 'Закрыть историю'}
              >
                <span aria-hidden="true">{desktop ? '‹' : '×'}</span>
              </button>
              <button
                type="button"
                className="chat-icon-button chat-search-trigger"
                ref={searchTrigger}
                aria-label="Поиск по чатам"
                data-ai-tooltip="Поиск по чатам и сообщениям"
                aria-expanded={searchOpen}
                aria-controls="ai-chat-history-search"
                onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
              >
                <AiChatIcon name="search" size={20} />
              </button>
              <details className="chat-history-overflow">
                <summary aria-label="Дополнительно" data-ai-tooltip="Дополнительно">
                  <span aria-hidden="true">⋯</span>
                </summary>
                <div className="chat-history-overflow-popup">
                  <button
                    type="button"
                    onClick={(event) => {
                      setArchivedFilter(!archivedFilter);
                      event.currentTarget.closest('details')?.removeAttribute('open');
                    }}
                  >
                    {archivedFilter ? 'Недавние диалоги' : 'Архивные диалоги'}
                  </button>
                </div>
              </details>
            </div>
          </header>
          {searchOpen ? (
            <div
              id="ai-chat-history-search"
              className="chat-history-search-popover"
              role="search"
              aria-label="Поиск по чатам и сообщениям"
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  event.stopPropagation();
                  closeSearch(true);
                }
              }}
            >
              <label className="chat-search-box">
                <span className="sr-only">Найти диалог</span>
                <input
                  ref={searchInput}
                  type="search"
                  aria-label="Найти диалог"
                  value={search}
                  maxLength={200}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Название или текст сообщения"
                />
              </label>
              <button
                type="button"
                aria-label="Закрыть поиск"
                data-ai-tooltip="Закрыть поиск"
                onClick={() => closeSearch()}
              >
                ×
              </button>
            </div>
          ) : null}
          <div className="chat-sidebar-actions">
            <button
              type="button"
              disabled={interactionBusy || loading}
              onClick={() => void newChat()}
            >
              <AiChatIcon name="new-chat" size={19} />
              <span>Новый чат</span>
            </button>
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
            {search.trim() ? 'Результаты поиска' : archivedFilter ? 'Архивные диалоги' : 'Недавние'}
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
                          {searchExcerpt(thread.matchPreview, search)}
                        </span>
                      ) : null}
                    </button>
                    <div
                      className="asa-ai-thread-actions"
                      role="group"
                      aria-label="Действия с диалогом"
                    >
                      <button
                        className="asa-ai-thread-action"
                        type="button"
                        disabled={interactionBusy || threadActionBusy}
                        aria-label={'Переименовать: ' + thread.title}
                        data-ai-tooltip="Переименовать"
                        onClick={() => {
                          setEditingId(thread.id);
                          setEditingTitle(thread.title);
                          setConfirmDeleteId(null);
                        }}
                      >
                        ✎
                      </button>
                      <button
                        className="asa-ai-thread-action legacy-archive-action"
                        type="button"
                        disabled={interactionBusy}
                        aria-label={
                          (thread.archivedAt ? 'Восстановить: ' : 'В архив: ') + thread.title
                        }
                        data-ai-tooltip={thread.archivedAt ? 'Восстановить диалог' : 'В архив'}
                        onClick={() => void archiveThread(thread.id, !thread.archivedAt)}
                      >
                        <AiChatIcon name="archive" size={16} />
                      </button>
                      <button
                        className="asa-ai-thread-action"
                        type="button"
                        disabled={interactionBusy || threadActionBusy}
                        aria-label={'Удалить: ' + thread.title}
                        data-ai-tooltip="Удалить"
                        onClick={() => {
                          setConfirmDeleteId(thread.id);
                          setEditingId(null);
                        }}
                      >
                        ×
                      </button>
                    </div>
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
                {search.trim()
                  ? 'Ничего не найдено в истории'
                  : archivedFilter
                    ? 'Архивных диалогов нет'
                    : 'Здесь появятся ваши диалоги'}
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
                data-ai-tooltip="История диалогов"
              >
                <AiChatIcon name="sidebar" size={20} />
              </button>
            ) : null}
            <span className="sr-only asa-ai-current-title">{currentTitle}</span>
            <button
              className="chat-icon-button chat-theme-toggle"
              type="button"
              onClick={() => setChatTheme((current) => (current === 'light' ? 'dark' : 'light'))}
              aria-label={chatTheme === 'light' ? 'Тёмная тема чата' : 'Светлая тема чата'}
              data-ai-tooltip={
                chatTheme === 'light' ? 'Включить тёмную тему' : 'Включить светлую тему'
              }
              aria-pressed={chatTheme === 'dark'}
            >
              <AiChatIcon name={chatTheme === 'light' ? 'moon' : 'sun'} size={20} />
            </button>
            <button
              className="chat-icon-button asa-ai-new-chat"
              type="button"
              disabled={interactionBusy || loading}
              onClick={() => void newChat()}
              aria-label="Создать новый диалог"
              data-ai-tooltip="Новый диалог"
            >
              <AiChatIcon name="new-chat" size={20} />
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
                                <SavedAttachmentCard
                                  key={file.uploadId}
                                  file={file}
                                  seatId={seatId}
                                  onDownload={() => void downloadAttachment(file)}
                                />
                              ))}
                            </div>
                          ) : null}
                          <div
                            className="chat-user-actions"
                            role="group"
                            aria-label="Действия с вашим сообщением"
                          >
                            <time
                              dateTime={message.createdAt}
                              data-ai-tooltip={new Date(message.createdAt).toLocaleString('ru-RU')}
                            >
                              {new Date(message.createdAt).toLocaleTimeString('ru-RU', {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </time>
                            <button
                              type="button"
                              onClick={() =>
                                void navigator.clipboard
                                  .writeText(message.content)
                                  .catch(() => setError('Не удалось скопировать сообщение.'))
                              }
                              aria-label="Копировать"
                              data-ai-tooltip="Копировать"
                            >
                              <AiChatIcon name="copy" size={17} />
                            </button>
                            <button
                              type="button"
                              disabled={
                                interactionBusy || archived || !status?.enabled || !historyReady
                              }
                              onClick={() => {
                                setDraft(message.content);
                                composer.current?.focus();
                              }}
                              aria-label="Изменить"
                              data-ai-tooltip="Изменить"
                            >
                              <AiChatIcon name="edit" size={17} />
                            </button>
                          </div>
                          {message.generationKind !== 'image' &&
                          message.id === lastQuestion?.id &&
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
                                data-ai-tooltip="Новый запрос к модели расходует лимит. Исходный вопрос останется в истории."
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
                          <AiMessageContent
                            content={message.content}
                            webSearch={message.webSearch}
                          />
                          <AiWebEvidence
                            evidence={message.webSearch}
                            seatId={seatId}
                            onChooseLocation={(location) => {
                              setDraft('Погода в ' + location);
                              setWebSearchMode('weather');
                              composer.current?.focus();
                            }}
                          />
                          {currentId
                            ? message.generatedImages?.map((image) => (
                                <AiGeneratedImage
                                  key={image.requestId}
                                  image={image}
                                  threadId={currentId}
                                  seatId={seatId}
                                />
                              ))
                            : null}
                          {message.state === 'stopped' ? (
                            <span className="chat-runtime-note" role="status">
                              Ответ не завершён.
                            </span>
                          ) : null}
                          {message.generationKind !== 'image' &&
                          !message.generatedImages?.length ? (
                            <div className="chat-message-actions">
                              <button
                                type="button"
                                onClick={() =>
                                  void navigator.clipboard
                                    .writeText(message.content)
                                    .catch(() => setError('Не удалось скопировать ответ.'))
                                }
                                aria-label="Копировать"
                                data-ai-tooltip="Копировать"
                              >
                                <AiChatIcon name="copy" size={17} />
                                <span>Копировать</span>
                              </button>
                              {message.generationKind !== 'image' &&
                              !message.generatedImages?.length &&
                              sourceFor(message) ? (
                                <button
                                  type="button"
                                  disabled={
                                    interactionBusy || archived || !status?.enabled || !historyReady
                                  }
                                  onClick={() => void regenerate(message)}
                                  data-ai-tooltip="Новый запрос к модели расходует лимит. Вопрос и все прежние ответы останутся в истории."
                                  aria-label="Новый вариант ответа"
                                >
                                  <AiChatIcon name="refresh" size={18} />
                                  <span>Попробовать снова</span>
                                </button>
                              ) : null}
                              <AiAnswerDownloads content={message.content} />
                            </div>
                          ) : null}
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
                        <AiMessageContent content={streamedText} pending />
                      </div>
                    </article>
                  ) : null}
                  {busy ? <AiActivity responding={Boolean(streamedText)} /> : null}
                  {imageUi.busy ? <AiActivity image /> : null}
                </div>
              </div>
            </div>
          )}
          {visibleError || schoolAdmission || archived || (!busy && pendingRegeneration) ? (
            <div
              className={'asa-ai-error' + (visibleError ? '' : ' chat-history-notice')}
              role={visibleError ? 'alert' : 'status'}
            >
              {visibleError ?? schoolAdmission}
              {schoolAdmission ? (
                <button type="button" onClick={() => void refreshAdmission()}>
                  Проверить доступ
                </button>
              ) : null}
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
            <div
              className="chat-composer-wrap"
              role={imageMode ? 'region' : undefined}
              aria-label={imageMode ? 'Создать изображение' : undefined}
            >
              <form
                data-composer-state={
                  composerBusy ? 'busy' : !currentId && !draft.trim() ? 'idle' : 'ready'
                }
                className={
                  (composerExpanded ? 'chat-composer expanded' : 'chat-composer compact') +
                  (composerMaximized ? ' maximized' : '')
                }
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
                      <div
                        key={item.uploadId}
                        className={
                          'chat-attachment-chip ' + (item.preview ? 'is-image' : 'is-file')
                        }
                        data-ai-tooltip={`${item.file.name} · ${attachmentSize(item.file.size)}`}
                      >
                        {item.preview ? (
                          <img src={item.preview} alt={item.file.name} />
                        ) : (
                          <span className="chat-attachment-file-icon">
                            <AiChatIcon name="file" size={20} />
                            <small>{item.file.name.split('.').at(-1)?.toUpperCase()}</small>
                          </span>
                        )}
                        <span data-ai-tooltip={item.file.name}>
                          {item.file.name}
                          <small>
                            {(item.file.type || item.file.name.split('.').at(-1) || 'файл') +
                              ' · ' +
                              attachmentSize(item.file.size)}
                          </small>
                        </span>
                        <button
                          type="button"
                          disabled={interactionBusy}
                          aria-label={'Удалить ' + item.file.name}
                          data-ai-tooltip={'Удалить ' + item.file.name}
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
                    event.currentTarget.accept = AI_CHAT_FILE_ACCEPT;
                  }}
                />
                {imageMode ? (
                  <div className="chat-image-intent" role="group" aria-label="Создание изображения">
                    <span>Изображение</span>
                    <select
                      aria-label="Размер изображения"
                      value={imageSize}
                      disabled={interactionBusy}
                      onChange={(event) => setImageSize(Number(event.target.value) as AiImageSize)}
                    >
                      {imageUi.sizes.map((value) => (
                        <option key={value} value={value}>
                          {aiImageSizeLabel(value as AiImageSize)}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      aria-label="Убрать изображение из запроса"
                      disabled={interactionBusy}
                      onClick={() => {
                        setImageMode(false);
                        setImageSelection('off');
                        composer.current?.focus();
                      }}
                    >
                      <span aria-hidden="true">×</span>
                    </button>
                  </div>
                ) : null}
                <textarea
                  ref={composer}
                  value={draft}
                  maxLength={3000}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (
                      imageMode &&
                      event.key === 'Backspace' &&
                      event.currentTarget.selectionStart === 0 &&
                      event.currentTarget.selectionEnd === 0 &&
                      !interactionBusy
                    ) {
                      event.preventDefault();
                      setImageMode(false);
                      setImageSelection('off');
                      return;
                    }

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
                  disabled={interactionBusy || archived || schoolPolicyDenied}
                  aria-label="Сообщение ИИ"
                  aria-describedby="ai-composer-note"
                />
                {composerExpanded && draft ? (
                  <button
                    type="button"
                    className="chat-composer-expand"
                    aria-label={composerMaximized ? 'Свернуть поле ввода' : 'Развернуть поле ввода'}
                    data-ai-tooltip={
                      composerMaximized ? 'Свернуть поле ввода' : 'Развернуть поле ввода'
                    }
                    aria-pressed={composerMaximized}
                    onClick={() => {
                      setComposerMaximized((value) => !value);
                      composer.current?.focus();
                    }}
                  >
                    <span aria-hidden="true">{composerMaximized ? '↙' : '↗'}</span>
                  </button>
                ) : null}
                <div className="chat-composer-controls">
                  <details
                    className="chat-tools-menu"
                    ref={toolsMenu}
                    onToggle={(event) => {
                      if (event.currentTarget.open) positionToolsMenu(event.currentTarget);
                    }}
                  >
                    <summary
                      onClick={() => {
                        // Set placement before the native <details> default toggle;
                        // the first opened frame must already fit the canvas.
                        if (toolsMenu.current && !toolsMenu.current.open)
                          positionToolsMenu(toolsMenu.current);
                      }}
                      className="chat-attach-button"
                      aria-label="Инструменты чата"
                      data-ai-tooltip="Инструменты"
                    >
                      <span aria-hidden="true">+</span>
                    </summary>
                    <div className="chat-tools-popup" role="group" aria-label="Добавить в чат">
                      <button
                        type="button"
                        disabled={interactionBusy || archived}
                        onClick={() => {
                          if (fileInput.current) {
                            fileInput.current.accept = 'image/png,image/jpeg,image/webp';
                            fileInput.current.click();
                          }
                          toolsMenu.current?.removeAttribute('open');
                        }}
                      >
                        <AiChatIcon name="image" size={20} /> Добавить изображение
                      </button>
                      <button
                        type="button"
                        disabled={interactionBusy || archived}
                        onClick={() => {
                          if (fileInput.current) {
                            fileInput.current.accept = AI_CHAT_FILE_ACCEPT;
                            fileInput.current.click();
                          }
                          toolsMenu.current?.removeAttribute('open');
                        }}
                      >
                        <AiChatIcon name="file" size={20} /> Фото и файлы
                      </button>
                      <div className="chat-tools-divider" />
                      <div className="chat-tools-option-row">
                        <button
                          type="button"
                          disabled={
                            interactionBusy ||
                            !webSearchStatus?.enabled ||
                            !webSearchStatus.configured
                          }
                          data-ai-tooltip={
                            webSearchStatus?.enabled && webSearchStatus.configured
                              ? 'Включить поиск с источниками'
                              : 'Интернет-поиск не подключён администратором'
                          }
                          onClick={() => {
                            setWebSearchMode('web');
                            toolsMenu.current?.removeAttribute('open');
                            composer.current?.focus();
                          }}
                        >
                          <AiChatIcon name="search" size={19} /> Поиск в интернете
                        </button>
                        {webSearchStatus ? (
                          <AiCompactSelect
                            label="Режим интернет-поиска"
                            value={
                              !webSearchStatus.configured && webSearchMode !== 'weather'
                                ? 'off'
                                : webSearchMode
                            }
                            disabled={
                              interactionBusy ||
                              !webSearchStatus.enabled ||
                              (!webSearchStatus.configured && !webSearchStatus.weatherConfigured)
                            }
                            options={[
                              {
                                value: 'auto',
                                label: 'Авто',
                                disabled: !webSearchStatus.configured,
                              },
                              { value: 'off', label: 'Выключен' },
                              {
                                value: 'web',
                                label: 'Веб-поиск',
                                disabled: !webSearchStatus.configured,
                              },
                              {
                                value: 'images',
                                label: 'Картинки',
                                disabled: !webSearchStatus.configured,
                              },
                              { value: 'weather', label: 'Погода' },
                            ]}
                            onChange={(value) => {
                              setWebSearchMode(value as AiWebSearchMode);
                              toolsMenu.current?.removeAttribute('open');
                            }}
                            onSelect={() => composer.current?.focus()}
                          />
                        ) : null}
                      </div>
                      <div className="chat-tools-option-row">
                        <button
                          type="button"
                          disabled={
                            interactionBusy ||
                            archived ||
                            schoolPolicyDenied ||
                            !imageStatus?.enabled ||
                            !imageStatus.ready
                          }
                          data-ai-tooltip={
                            imageStatus?.enabled && imageStatus.ready
                              ? 'Создать моделью FLUX.2 Klein 4B'
                              : 'Локальная генерация недоступна или выключена администратором'
                          }
                          onClick={() => {
                            setImageSelection('flux2-klein-4b-v1');
                            setImageMode(true);
                            toolsMenu.current?.removeAttribute('open');
                          }}
                        >
                          <AiChatIcon name="sparkles" size={20} /> Изображение
                        </button>
                        <AiCompactSelect
                          label="Генерация изображений"
                          value={imageSelection}
                          disabled={interactionBusy}
                          options={[
                            { value: 'off', label: 'Выключено' },
                            { value: 'auto', label: 'Авто' },
                            { value: 'flux2-klein-4b-v1', label: 'FLUX.2 Klein 4B' },
                          ]}
                          onChange={(value) => {
                            const mode = value as ImageGenerationMode;
                            setImageSelection(mode);
                            setImageMode(mode === 'flux2-klein-4b-v1');
                          }}
                          onSelect={() => composer.current?.focus()}
                        />
                      </div>
                      <div className="chat-tools-option-row chat-tools-video-row">
                        <button type="button" disabled data-ai-tooltip="Видео — скоро">
                          <AiChatIcon name="video" size={20} /> Видео
                        </button>
                        <span className="chat-tools-model-caption">Скоро</span>
                      </div>
                    </div>
                  </details>
                  <div className="chat-composer-end">
                    {scopeControl}
                    <div className="asa-ai-provider-label">
                      {imageMode ? (
                        <span className="asa-ai-model-single">FLUX.2 Klein 4B</span>
                      ) : (status?.availableModels?.length ?? 0) > 1 ||
                        (status?.enabled &&
                          !status.availableModels?.includes(selectedModel || status.model)) ? (
                        <AiCompactSelect
                          className="asa-ai-model-picker"
                          label="Модель ИИ"
                          onOpen={() => void refreshModelChoices()}
                          value={selectedModel || status?.model || ''}
                          displayLabel={
                            status &&
                            !status.availableModels?.includes(selectedModel || status.model)
                              ? 'Модель недоступна'
                              : (status?.modelChoices?.find(
                                  (m) => m.id === (selectedModel || status.model),
                                )?.label ??
                                ((selectedModel || status?.model) === 'ollama-local'
                                  ? status?.ollamaModel || 'Локальная модель'
                                  : selectedModel || status?.model))
                          }
                          onChange={setSelectedModel}
                          disabled={interactionBusy || !status?.enabled}
                          options={[
                            ...(status &&
                            !status.availableModels?.includes(selectedModel || status.model)
                              ? [
                                  {
                                    value: selectedModel || status.model,
                                    label: 'Выбранная модель недоступна — выберите другую',
                                    disabled: true,
                                  },
                                ]
                              : []),
                            ...(status?.availableModels?.map((name) => ({
                              value: name,
                              disabled: tokenBudgets?.models?.some(
                                (row) => row.model === name && !row.available,
                              ),
                              label:
                                (status.modelChoices?.find((m) => m.id === name)?.label ??
                                  (name === 'ollama-local'
                                    ? status.ollamaModel || 'Локальная модель'
                                    : name)) +
                                (tokenBudgets?.models?.find((row) => row.model === name)?.reason ===
                                'ai_budget_pending'
                                  ? ' · расход ожидает подтверждения'
                                  : tokenBudgets?.models?.find((row) => row.model === name)
                                        ?.reason === 'ai_budget_exhausted'
                                    ? ' · бюджет исчерпан'
                                    : ''),
                            })) ?? []),
                          ]}
                        />
                      ) : (
                        <span className="asa-ai-model-single">
                          {status?.enabled
                            ? status.model === 'ollama-local'
                              ? status.ollamaModel || 'Локальная модель'
                              : (status.modelChoices?.find((m) => m.id === status.model)?.label ??
                                status.model)
                            : schoolPolicyDenied
                              ? 'Доступ закрыт'
                              : 'Модель'}
                        </span>
                      )}
                    </div>
                    <AiVoiceInput
                      key={(seatId ?? 'personal') + ':' + (currentId ?? 'new')}
                      call={call}
                      disabled={
                        interactionBusy ||
                        archived ||
                        schoolPolicyDenied ||
                        imageMode ||
                        !historyReady
                      }
                      onTranscript={(text) => {
                        const result = mergeVoiceTranscript(draft, text);
                        setDraft(result.draft);
                        setOverflowTranscript(result.overflow);
                        composer.current?.focus();
                        return result.overflow === null ? 'inserted' : 'overflow';
                      }}
                    />
                    <button
                      type={composerBusy ? 'button' : 'submit'}
                      className="chat-send-button"
                      data-ai-tooltip={
                        !composerBusy && !imageMode && selectedBudget?.available === false
                          ? selectedBudget.reason === 'ai_budget_pending'
                            ? 'Расход ожидает подтверждения'
                            : 'Месячный бюджет модели исчерпан'
                          : undefined
                      }
                      disabled={
                        (imageUi.busy && !imageUi.canCancel) ||
                        (!composerBusy && imageMode && !imageUi.canSubmit) ||
                        (!composerBusy && !imageMode && selectedBudget?.available === false) ||
                        (!composerBusy && ((!status?.enabled && !imageMode) || archived)) ||
                        creatingChat ||
                        threadActionBusy ||
                        (!composerBusy && (!historyReady || !draft.trim()))
                      }
                      onClick={
                        composerBusy
                          ? () => void (busy ? stop() : imageController.current?.cancel())
                          : undefined
                      }
                      aria-label={
                        composerBusy
                          ? busy
                            ? 'Остановить генерацию'
                            : 'Отменить задание'
                          : imageMode
                            ? 'Создать изображение'
                            : 'Отправить сообщение'
                      }
                    >
                      {composerBusy ? (
                        <svg
                          width="20"
                          height="20"
                          viewBox="0 0 24 24"
                          fill="currentColor"
                          aria-hidden="true"
                        >
                          <rect x="6" y="6" width="12" height="12" rx="2" />
                        </svg>
                      ) : (
                        <svg
                          width="22"
                          height="22"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M12 19V5m-6 6 6-6 6 6" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
                <span className="chat-composer-hint sr-only">Shift + Enter — новая строка</span>
                <span className="chat-character-count sr-only">{draft.length} / 3000</span>
                {overflowTranscript !== null ? (
                  <div role="alert" className="chat-transcript-overflow">
                    <p>
                      Расшифровка не поместилась в сообщение. Черновик сохранён. Скопируйте текст и
                      добавьте нужную часть вручную.
                    </p>
                    <textarea aria-label="Полная расшифровка" readOnly value={overflowTranscript} />
                    <button type="button" onClick={() => setOverflowTranscript(null)}>
                      Закрыть расшифровку
                    </button>
                  </div>
                ) : null}
              </form>
              <AiImageGeneration
                headless
                providedStatus={imageStatus}
                controllerRef={imageController}
                onStateChange={onImageState}
                onPromptChange={setDraft}
                threadId={currentId}
                seatId={seatId}
                disabled={interactionBusy || archived || !historyReady || schoolPolicyDenied}
                createThread={() => newChat()}
                onComplete={(id) => {
                  if (id === currentId) void selectThread(id);
                  if (imageSelection === 'auto') setImageMode(false);
                }}
                onClose={() => {
                  setImageMode(false);
                  setImageSelection('off');
                }}
              />
              {(imageMode || imageUi.busy) && imageUi.notice ? (
                <p className="ai-image-status" role="status">
                  {imageUi.notice}
                </p>
              ) : null}
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
