import { useEffect, useMemo, useRef, useState } from 'react';
import { newClientId } from '../client-id';
import { BlocksEditorShell, type BlocksSaveState } from './BlocksEditorShell';
import { BlocksRuntimeBridge, requireExactHttpOrigin } from './runtime-protocol';
import { requestBlocksRuntimeSession } from './runtime-session';

interface BlocksEditorProps {
  projectId: string;
  onBack: () => void;
  accountLabel: string;
  accountInitials: string;
  avatarUrl?: string | null;
  onAccountClick: () => void;
  onHomeClick: () => void;
}

const CAPABILITY_REFRESH_WINDOW_MS = 60_000;

function capabilityNeedsRefresh(expiresAt: number | null, nowMs = Date.now()): boolean {
  return expiresAt === null || expiresAt * 1000 - nowMs <= CAPABILITY_REFRESH_WINDOW_MS;
}

function configuredRuntimeOrigin(): string | null {
  if (typeof window === 'undefined') return null;
  if (typeof __ASA_BLOCKS_RUNTIME_ORIGIN__ === 'undefined' || !__ASA_BLOCKS_RUNTIME_ORIGIN__)
    return null;
  try {
    const configured = new URL(requireExactHttpOrigin(__ASA_BLOCKS_RUNTIME_ORIGIN__));
    // Preserve the default localhost runtime beside the 127.0.0.1 portal.
    // Different ports alone do not isolate host cookies. Keep the existing
    // non-loopback LAN template behavior; explicit production origins stay exact.
    const parentHostname = window.location.hostname;
    const loopbackParent =
      parentHostname === 'localhost' ||
      parentHostname === '[::1]' ||
      /^127(?:\.\d{1,3}){3}$/.test(parentHostname);
    if (configured.hostname === 'localhost' && !loopbackParent)
      configured.hostname = parentHostname;
    const origin = configured.origin;
    // Visibility never grants the runtime portal authority or permits mixed content.
    if (window.location.origin.startsWith('https:') && origin.startsWith('http:')) return null;
    return origin === window.location.origin ? null : origin;
  } catch {
    return null;
  }
}

export function BlocksEditor({
  projectId,
  onBack,
  accountLabel,
  accountInitials,
  avatarUrl = null,
  onAccountClick,
  onHomeClick,
}: BlocksEditorProps): JSX.Element {
  const runtimeOrigin = useMemo(configuredRuntimeOrigin, []);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const bridgeRef = useRef<BlocksRuntimeBridge | null>(null);
  const saveRequestRef = useRef<string | null>(null);
  const saveOperationRef = useRef(false);
  const capabilityExpiresAtRef = useRef<number | null>(null);
  const refreshCapabilityRef = useRef<(() => Promise<boolean>) | null>(null);
  const latestDirtyGenerationRef = useRef(0);
  const [status, setStatus] = useState('Подключение Scratch…');
  const [saveState, setSaveState] = useState<BlocksSaveState>('idle');
  const [savedRevision, setSavedRevision] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!runtimeOrigin) return undefined;
    const frame = iframeRef.current;
    if (!frame) return undefined;
    let bridge: BlocksRuntimeBridge | null = null;
    let disposed = false;
    let loadGeneration = 0;
    let requestController: AbortController | null = null;
    let refreshTimer: number | null = null;
    let refreshController: AbortController | null = null;
    let refreshPromise: Promise<boolean> | null = null;
    const startupTimer = window.setTimeout(() => {
      if (!disposed) setStatus('Ошибка Scratch runtime');
    }, 45000);

    const clearRefreshTimer = (): void => {
      if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer);
        refreshTimer = null;
      }
    };

    const scheduleRefresh = (expiresAt: number): void => {
      capabilityExpiresAtRef.current = expiresAt;
      clearRefreshTimer();
      const delay = Math.min(
        2_147_483_647,
        Math.max(0, expiresAt * 1000 - Date.now() - CAPABILITY_REFRESH_WINDOW_MS),
      );
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        void refreshCapability();
      }, delay);
    };

    function refreshCapability(): Promise<boolean> {
      if (disposed || !bridge) return Promise.resolve(false);
      if (refreshPromise) return refreshPromise;

      const refreshGeneration = loadGeneration;
      const activeBridge = bridge;
      const controller = new AbortController();
      refreshController = controller;
      const activePromise = (async (): Promise<boolean> => {
        const session = await requestBlocksRuntimeSession(projectId, controller.signal);
        if (
          disposed ||
          controller.signal.aborted ||
          refreshGeneration !== loadGeneration ||
          bridge !== activeBridge
        ) {
          return false;
        }
        if (!session || session.runtimeOrigin !== runtimeOrigin) return false;
        try {
          activeBridge.updateToken(session.runtimeToken);
        } catch {
          return false;
        }
        scheduleRefresh(session.expiresAt);
        return true;
      })();

      refreshPromise = activePromise;
      void activePromise.finally(() => {
        if (refreshPromise === activePromise) refreshPromise = null;
        if (refreshController === controller) refreshController = null;
      });
      return activePromise;
    }

    refreshCapabilityRef.current = refreshCapability;

    const failStartup = (): void => {
      if (disposed) return;
      window.clearTimeout(startupTimer);
      setStatus('Ошибка Scratch runtime');
      saveOperationRef.current = false;
      if (saveRequestRef.current) {
        saveRequestRef.current = null;
        setSaveState('error');
        setSavedRevision(null);
      }
    };

    const onMessage = (event: MessageEvent): void => {
      if (!bridge?.acceptChildMessage(event)) return;
      const payload = event.data as Record<string, unknown>;
      if (payload['messageType'] === 'ASA_BLOCKS_STATUS') {
        if (payload['status'] === 'project-dirty') {
          const generation = Number(payload['generation']);
          latestDirtyGenerationRef.current = Math.max(latestDirtyGenerationRef.current, generation);
          setSavedRevision(null);
          setSaveState((current) => (current === 'saved' ? 'idle' : current));
          return;
        }
        if (payload['status'] === 'token-updated') return;
        if (payload['status'] === 'editor-ready') window.clearTimeout(startupTimer);
        setStatus(String(payload['status'] ?? 'Scratch подключён'));
      }
      if (payload['messageType'] === 'ASA_BLOCKS_FLUSH_RESULT') {
        const requestId = payload['requestId'];
        if (requestId === saveRequestRef.current) {
          saveRequestRef.current = null;
          saveOperationRef.current = false;
          if (
            payload['ok'] === true &&
            Number.isSafeInteger(payload['revision']) &&
            Number.isSafeInteger(payload['snapshotGeneration'])
          ) {
            const snapshotGeneration = Number(payload['snapshotGeneration']);
            if (snapshotGeneration >= latestDirtyGenerationRef.current) {
              setSavedRevision(Number(payload['revision']));
              setSaveState('saved');
            } else {
              setSavedRevision(null);
              setSaveState('idle');
            }
          } else {
            setSavedRevision(null);
            setSaveState(payload['reason'] === 'revision_conflict' ? 'conflict' : 'error');
          }
        }
      }
      if (payload['messageType'] === 'ASA_BLOCKS_TOKEN_REFRESH_REQUIRED') {
        void refreshCapability();
      }
      if (payload['messageType'] === 'ASA_BLOCKS_FATAL') failStartup();
    };

    const connect = async (generation: number, controller: AbortController): Promise<void> => {
      const session = await requestBlocksRuntimeSession(projectId, controller.signal);
      if (disposed || controller.signal.aborted || generation !== loadGeneration) return;
      if (!session || session.runtimeOrigin !== runtimeOrigin) {
        failStartup();
        return;
      }

      const childWindow = frame.contentWindow;
      if (!childWindow) {
        failStartup();
        return;
      }

      try {
        bridge = new BlocksRuntimeBridge({
          childWindow,
          runtimeOrigin: session.runtimeOrigin,
          projectId,
          mode: 'editor',
          versionId: null,
          apiOrigin: window.location.origin,
          runtimeToken: session.runtimeToken,
          draftRevision: session.draftRevision,
          projectJson: session.projectJson,
          hasProjectJson: session.projectJson !== null,
          assets: session.assets,
          recoveryNamespace: `asa-blocks-preview-${projectId}`,
          onMessage: (message) => {
            if (message['messageType'] === 'ASA_BLOCKS_READY') setStatus('Scratch готов');
          },
          onFatal: failStartup,
        });
        bridgeRef.current = bridge;
        bridge.sendInit();
        scheduleRefresh(session.expiresAt);
      } catch {
        bridge?.stop();
        bridge = null;
        bridgeRef.current = null;
        failStartup();
      }
    };

    const onLoad = (): void => {
      requestController?.abort();
      refreshController?.abort();
      clearRefreshTimer();
      refreshPromise = null;
      requestController = new AbortController();
      loadGeneration += 1;
      bridge?.stop();
      bridge = null;
      bridgeRef.current = null;
      saveRequestRef.current = null;
      saveOperationRef.current = false;
      capabilityExpiresAtRef.current = null;
      latestDirtyGenerationRef.current = 0;
      setStatus('Подключение Scratch…');
      setSaveState('idle');
      setSavedRevision(null);
      void connect(loadGeneration, requestController);
    };

    window.addEventListener('message', onMessage);
    frame.addEventListener('load', onLoad);
    return () => {
      disposed = true;
      loadGeneration += 1;
      requestController?.abort();
      refreshController?.abort();
      clearRefreshTimer();
      window.clearTimeout(startupTimer);
      frame.removeEventListener('load', onLoad);
      window.removeEventListener('message', onMessage);
      bridge?.stop();
      bridgeRef.current = null;
      saveRequestRef.current = null;
      saveOperationRef.current = false;
      capabilityExpiresAtRef.current = null;
      latestDirtyGenerationRef.current = 0;
      if (refreshCapabilityRef.current === refreshCapability) {
        refreshCapabilityRef.current = null;
      }
    };
  }, [projectId, runtimeOrigin, attempt]);

  const requestSave = async (): Promise<void> => {
    if (saveOperationRef.current) return;
    const bridge = bridgeRef.current;
    if (!bridge || status !== 'editor-ready') {
      setSavedRevision(null);
      setSaveState('error');
      return;
    }

    saveOperationRef.current = true;
    setSavedRevision(null);
    setSaveState('saving');

    if (capabilityNeedsRefresh(capabilityExpiresAtRef.current)) {
      const refresh = refreshCapabilityRef.current;
      const refreshed = refresh ? await refresh() : false;
      if (bridgeRef.current !== bridge) {
        saveOperationRef.current = false;
        return;
      }
      if (!refreshed) {
        saveOperationRef.current = false;
        setSavedRevision(null);
        setSaveState('error');
        return;
      }
    }

    const requestId = newClientId();
    saveRequestRef.current = requestId;
    try {
      bridge.requestFlush(requestId);
    } catch {
      saveRequestRef.current = null;
      saveOperationRef.current = false;
      setSaveState('error');
    }
  };

  if (!runtimeOrigin) {
    return (
      <main className="page-center" role="alert">
        <section className="login-card">
          <h1>Среда Scratch не подключена</h1>
          <p>Для этого развёртывания не настроен изолированный Scratch runtime.</p>
          <button type="button" className="btn-secondary" onClick={onBack}>
            К проектам
          </button>
        </section>
      </main>
    );
  }

  return (
    <div className="blocks-editor-fullscreen" data-asa-blocks-fullscreen>
      <BlocksEditorShell
        accountLabel={accountLabel}
        accountInitials={accountInitials}
        avatarUrl={avatarUrl}
        saveState={saveState}
        savedRevision={savedRevision}
        saveDisabled={status !== 'editor-ready' || saveState === 'saving'}
        onSave={() => void requestSave()}
        onAccountClick={onAccountClick}
        onHomeClick={() => {
          if (
            window.confirm(
              'Несохранённые изменения могут быть потеряны. Перед выходом используйте «Сохранить в ASA». Выйти?',
            )
          )
            onHomeClick();
        }}
      >
        <iframe
          key={attempt}
          ref={iframeRef}
          title="Scratch runtime"
          src={`${runtimeOrigin}/?asaStatus=parent`}
        />
      </BlocksEditorShell>
      {status !== 'editor-ready' ? (
        <div className="blocks-editor-connection-status" role="status">
          {status}
          {status === 'Ошибка Scratch runtime' ? (
            <button
              type="button"
              className="blocks-editor-retry"
              onClick={() => {
                setStatus('Подключение Scratch…');
                setAttempt((value) => value + 1);
              }}
            >
              Повторить подключение
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
