import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { saveProjectSnapshot } from '../project-snapshot-client';
import { BlocksEditorShell } from './BlocksEditorShell';
import { BlocksRuntimeBridge, requireExactHttpOrigin } from './runtime-protocol';
import { requestBlocksRuntimeSession } from './runtime-session';

interface BlocksEditorProps {
  projectId: string;
  recoveryPrincipalKey: string;
  onBack: () => void;
  accountLabel: string;
  accountInitials: string;
  avatarUrl?: string | null;
  onAccountClick: () => void;
  onHomeClick: () => void;
}

const CAPABILITY_REFRESH_WINDOW_MS = 60_000;
type BlocksEditorStartupState = 'loading' | 'ready' | 'error';

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
  recoveryPrincipalKey,
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
  const homeSavePendingRef = useRef(false);
  const onHomeClickRef = useRef(onHomeClick);
  const [startupState, setStartupState] = useState<BlocksEditorStartupState>('loading');
  const [attempt, setAttempt] = useState(0);

  onHomeClickRef.current = onHomeClick;

  const requestHomeExit = useCallback((): void => {
    const activeBridge = bridgeRef.current;
    if (!activeBridge || homeSavePendingRef.current) return;
    homeSavePendingRef.current = true;
    void activeBridge
      .requestSaveBeforeExit()
      .then((result) => {
        if (result.ok && bridgeRef.current === activeBridge) onHomeClickRef.current();
      })
      .catch(() => undefined)
      .finally(() => {
        homeSavePendingRef.current = false;
      });
  }, []);

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
      if (!disposed) setStartupState('error');
    }, 45000);

    const clearRefreshTimer = (): void => {
      if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer);
        refreshTimer = null;
      }
    };

    const scheduleRefresh = (expiresAt: number): void => {
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

    const failStartup = (): void => {
      if (disposed) return;
      window.clearTimeout(startupTimer);
      setStartupState('error');
    };

    const onMessage = (event: MessageEvent): void => {
      if (!bridge?.acceptChildMessage(event)) return;
      const payload = event.data as Record<string, unknown>;
      if (payload['messageType'] === 'ASA_BLOCKS_STATUS' && payload['status'] === 'editor-ready') {
        window.clearTimeout(startupTimer);
        setStartupState('ready');
      }
      if (payload['messageType'] === 'ASA_BLOCKS_TOKEN_REFRESH_REQUIRED') {
        void refreshCapability();
      }
      if (payload['messageType'] === 'ASA_BLOCKS_THUMBNAIL_READY') {
        void saveProjectSnapshot(
          projectId,
          payload['imageDataUrl'] as string,
          payload['sourceRevision'] as number,
        );
      }
      if (payload['messageType'] === 'ASA_BLOCKS_HOME_REQUEST') requestHomeExit();
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
          recoveryPrincipalKey,
          onMessage: () => undefined,
          onFatal: failStartup,
        });
        bridgeRef.current = bridge;
        bridge.sendInit();
        scheduleRefresh(session.expiresAt);
      } catch {
        bridge?.stop();
        if (bridgeRef.current === bridge) bridgeRef.current = null;
        bridge = null;
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
      if (bridgeRef.current === bridge) bridgeRef.current = null;
      bridge = null;
      homeSavePendingRef.current = false;
      setStartupState('loading');
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
      if (bridgeRef.current === bridge) bridgeRef.current = null;
      homeSavePendingRef.current = false;
    };
  }, [projectId, recoveryPrincipalKey, runtimeOrigin, attempt, requestHomeExit]);

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
        onAccountClick={onAccountClick}
      >
        <iframe
          key={attempt}
          ref={iframeRef}
          title="Scratch runtime"
          src={`${runtimeOrigin}/?asaStatus=parent`}
        />
      </BlocksEditorShell>
      <div
        className="blocks-editor-loading-overlay"
        data-asa-blocks-loading-overlay
        data-state={startupState}
        role={startupState === 'error' ? 'alert' : 'status'}
        aria-live={startupState === 'error' ? 'assertive' : 'polite'}
        aria-hidden={startupState === 'ready'}
      >
        <div className="blocks-editor-loading-content">
          <div className="blocks-editor-loading-visual" aria-hidden="true">
            <span className="blocks-editor-loading-spinner" />
            <img className="blocks-editor-loading-mark" src="/asa-lab-mark.svg" alt="" />
          </div>
          {startupState === 'error' ? (
            <>
              <h1 className="blocks-editor-loading-title">Не удалось открыть среду</h1>
              <p className="blocks-editor-loading-detail">
                Проверьте подключение и попробуйте снова.
              </p>
              <div className="blocks-editor-loading-actions">
                <button
                  type="button"
                  className="blocks-editor-loading-button blocks-editor-loading-button-primary"
                  onClick={() => {
                    setStartupState('loading');
                    setAttempt((value) => value + 1);
                  }}
                >
                  Повторить
                </button>
                <button
                  type="button"
                  className="blocks-editor-loading-button blocks-editor-loading-button-secondary"
                  onClick={onBack}
                >
                  К проектам
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="blocks-editor-loading-title">Загружаем рабочую среду…</p>
              <p className="blocks-editor-loading-detail">Открываем ваш проект</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
