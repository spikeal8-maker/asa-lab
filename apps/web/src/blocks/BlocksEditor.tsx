import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { saveProjectSnapshot } from '../project-snapshot-client';
import { BlocksEditorShell } from './BlocksEditorShell';
import { BlocksRuntimeBridge, requireExactHttpOrigin } from './runtime-protocol';
import {
  requestBlocksRuntimeSessionResult,
  type BlocksRuntimeSessionResult,
} from './runtime-session';
import { beginDiagnosticContext, reportClientDiagnostic } from '../client-diagnostics';
import { newClientId } from '../client-id';
import { trackBlocksActivity } from './module-activity';
import { actorKey, type TelemetryActor } from '../telemetry-contract';

interface BlocksEditorProps {
  projectId: string;
  recoveryPrincipalKey: string;
  telemetryActor?: TelemetryActor | null;
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
  try {
    // The editor is shipped inside ASA. Deployment settings cannot turn it into
    // another website or send a project capability to an external iframe.
    return requireExactHttpOrigin(window.location.origin);
  } catch {
    return null;
  }
}

export function BlocksEditor({
  projectId,
  recoveryPrincipalKey,
  telemetryActor = null,
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
  const diagnosticInstance = useMemo(() => newClientId(), [projectId, attempt]);
  useEffect(() => beginDiagnosticContext('scratch', diagnosticInstance), [diagnosticInstance]);

  onHomeClickRef.current = onHomeClick;

  const requestHomeExit = useCallback((): void => {
    const activeBridge = bridgeRef.current;
    if (!activeBridge || homeSavePendingRef.current) return;
    homeSavePendingRef.current = true;
    void activeBridge
      .requestSaveBeforeExit()
      .then((result) => {
        if (result.ok && bridgeRef.current === activeBridge) onHomeClickRef.current();
        else if (!result.ok && bridgeRef.current === activeBridge)
          reportClientDiagnostic('autosave_failed', 'scratch');
      })
      .catch(() => reportClientDiagnostic('autosave_failed', 'scratch'))
      .finally(() => {
        homeSavePendingRef.current = false;
      });
  }, []);

  useEffect(() => {
    if (!runtimeOrigin) return undefined;
    const frame = iframeRef.current;
    if (!frame) return undefined;
    const activity = trackBlocksActivity(projectId, undefined, telemetryActor);
    let bridge: BlocksRuntimeBridge | null = null;
    let disposed = false;
    let editorReady = false;
    let lastHeartbeat = performance.now();
    let unresponsive = false;
    let lastWatch = performance.now();
    const heartbeatTimer = window.setInterval(() => {
      const now = performance.now();
      const parentDelay = now - lastWatch;
      lastWatch = now;
      if (parentDelay > 30_000) {
        lastHeartbeat = now;
        queueResumeRefresh();
        return;
      }
      if (!editorReady || document.visibilityState !== 'visible') return;
      const delay = now - lastHeartbeat;
      if (delay > 60_000 && !unresponsive) {
        activity.setReady(false);
        unresponsive = true;
        reportClientDiagnostic('editor_unresponsive', 'scratch', {
          phase: 'runtime',
          durationMs: delay,
        });
      }
    }, 15_000);
    let loadGeneration = 0;
    let requestController: AbortController | null = null;
    let refreshTimer: number | null = null;
    let refreshController: AbortController | null = null;
    let refreshPromise: Promise<boolean> | null = null;
    let refreshFailures = 0;
    let resumeRefreshTimer: number | null = null;
    let resumeGeneration = 0;
    let connectFailures = 0;
    let connectRetryTimer: number | null = null;
    let startupFailed = false;
    const startupTimer = window.setTimeout(() => {
      if (!disposed) {
        startupFailed = true;
        requestController?.abort();
        if (connectRetryTimer !== null) window.clearTimeout(connectRetryTimer);
        reportClientDiagnostic('editor_start_timeout', 'scratch');
        setStartupState('error');
      }
    }, 45000);

    const clearRefreshTimer = (): void => {
      if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer);
        refreshTimer = null;
      }
    };

    const scheduleRefresh = (expiresAtMonotonicMs: number): void => {
      clearRefreshTimer();
      const delay = Math.min(
        2_147_483_647,
        Math.max(0, expiresAtMonotonicMs - performance.now() - CAPABILITY_REFRESH_WINDOW_MS),
      );
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        void refreshCapability();
      }, delay);
    };

    function refreshCapability(): Promise<boolean> {
      if (disposed || !bridge) return Promise.resolve(false);
      if (refreshPromise) return refreshPromise;
      clearRefreshTimer();

      const refreshGeneration = loadGeneration;
      const activeBridge = bridge;
      const controller = new AbortController();
      refreshController = controller;
      const activePromise = (async (): Promise<boolean> => {
        const result = await requestCurrentSession(controller.signal);
        const session = result.session;
        if (
          disposed ||
          controller.signal.aborted ||
          refreshGeneration !== loadGeneration ||
          bridge !== activeBridge
        ) {
          return false;
        }
        if (!session || session.runtimeOrigin !== runtimeOrigin) {
          reportClientDiagnostic('session_refresh_failed', 'scratch');
          if (result.retryable) {
            clearRefreshTimer();
            refreshFailures += 1;
            refreshTimer = window.setTimeout(
              () => {
                refreshTimer = null;
                void refreshCapability();
              },
              Math.max(
                result.retryAfterMs,
                Math.min(30_000, 1_000 * 2 ** Math.min(5, refreshFailures - 1)),
              ),
            );
          }
          return false;
        }
        try {
          activeBridge.updateToken(session.runtimeToken);
        } catch {
          return false;
        }
        scheduleRefresh(session.expiresAtMonotonicMs);
        refreshFailures = 0;
        return true;
      })();

      refreshPromise = activePromise;
      void activePromise.finally(() => {
        if (refreshPromise === activePromise) refreshPromise = null;
        if (refreshController === controller) refreshController = null;
      });
      return activePromise;
    }

    async function requestCurrentSession(signal: AbortSignal): Promise<BlocksRuntimeSessionResult> {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const generation = resumeGeneration;
        const result = await requestBlocksRuntimeSessionResult(projectId, signal);
        if (disposed || signal.aborted || generation === resumeGeneration) return result;
        // A response prepared before suspension cannot establish a fresh local
        // deadline: performance.now may have stopped while the machine slept.
      }
      return { session: null, retryable: true, retryAfterMs: 1_000 };
    }

    function queueResumeRefresh(): void {
      if (disposed || document.visibilityState !== 'visible') return;
      resumeGeneration += 1;
      if (!bridge) return;
      if (resumeRefreshTimer !== null || refreshPromise) return;
      // Coalesce pageshow/online/visibility events from the same resume.
      // Refresh even if performance.now did not advance during OS suspension.
      resumeRefreshTimer = window.setTimeout(() => {
        resumeRefreshTimer = null;
        if (!disposed && document.visibilityState === 'visible') void refreshCapability();
      }, 0);
    }

    const noteVisible = (): void => {
      lastHeartbeat = performance.now();
      queueResumeRefresh();
    };
    document.addEventListener('visibilitychange', noteVisible);
    window.addEventListener('pageshow', noteVisible);
    window.addEventListener('online', noteVisible);

    const failStartup = (runtimeFailure = false): void => {
      if (disposed) return;
      activity.setReady(false);
      editorReady = false;
      startupFailed = true;
      if (connectRetryTimer !== null) window.clearTimeout(connectRetryTimer);
      reportClientDiagnostic(
        runtimeFailure ? 'editor_runtime_error' : 'editor_start_failed',
        'scratch',
      );
      window.clearTimeout(startupTimer);
      setStartupState('error');
    };

    const onMessage = (event: MessageEvent): void => {
      if (event.source !== frame.contentWindow) return;
      if (startupFailed) return;
      if (!bridge?.acceptChildMessage(event)) return;
      const payload = event.data as Record<string, unknown>;
      if (payload['messageType'] === 'ASA_BLOCKS_USER_ACTIVITY') activity.input();
      if (
        payload['messageType'] === 'ASA_BLOCKS_STATUS' &&
        payload['status'] === 'request-failed'
      ) {
        reportClientDiagnostic('request_failed', 'scratch', {
          phase: 'request',
          ...(typeof payload['httpStatus'] === 'number'
            ? { httpStatus: payload['httpStatus'] }
            : {}),
          ...(typeof payload['relatedRequestId'] === 'string'
            ? { relatedRequestId: payload['relatedRequestId'] }
            : {}),
          ...(typeof payload['durationMs'] === 'number'
            ? { durationMs: payload['durationMs'] }
            : {}),
        });
      }
      if (
        payload['messageType'] === 'ASA_BLOCKS_STATUS' &&
        payload['status'] === 'runtime-heartbeat'
      ) {
        lastHeartbeat = performance.now();
        reportClientDiagnostic(unresponsive ? 'editor_recovered' : 'editor_heartbeat', 'scratch', {
          phase: 'runtime',
        });
        unresponsive = false;
        if (editorReady) activity.setReady(true);
      }
      if (payload['messageType'] === 'ASA_BLOCKS_STATUS' && payload['status'] === 'editor-ready') {
        editorReady = true;
        activity.setReady(true);
        lastHeartbeat = performance.now();
        reportClientDiagnostic('editor_ready', 'scratch', { phase: 'startup' });
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
    };

    const connect = async (generation: number, controller: AbortController): Promise<void> => {
      const result = await requestCurrentSession(controller.signal);
      const session = result.session;
      if (disposed || startupFailed || controller.signal.aborted || generation !== loadGeneration)
        return;
      if (!session || session.runtimeOrigin !== runtimeOrigin) {
        if (result.retryable && connectFailures < 2 && !startupFailed) {
          connectFailures += 1;
          connectRetryTimer = window.setTimeout(
            () => {
              connectRetryTimer = null;
              if (!startupFailed) void connect(generation, controller);
            },
            Math.max(result.retryAfterMs, 1_000 * connectFailures),
          );
          return;
        }
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
          onFatal: (message) =>
            failStartup(
              editorReady ||
                ['runtime_error', 'runtime_unhandled_rejection'].includes(String(message['code'])),
            ),
        });
        bridgeRef.current = bridge;
        bridge.sendInit();
        scheduleRefresh(session.expiresAtMonotonicMs);
      } catch {
        bridge?.stop();
        if (bridgeRef.current === bridge) bridgeRef.current = null;
        bridge = null;
        failStartup();
      }
    };

    const onLoad = (): void => {
      activity.setReady(false);
      editorReady = false;
      unresponsive = false;
      lastHeartbeat = performance.now();
      requestController?.abort();
      refreshController?.abort();
      clearRefreshTimer();
      if (resumeRefreshTimer !== null) window.clearTimeout(resumeRefreshTimer);
      resumeRefreshTimer = null;
      if (connectRetryTimer !== null) window.clearTimeout(connectRetryTimer);
      connectFailures = 0;
      refreshFailures = 0;
      startupFailed = false;
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
      activity.dispose();
      disposed = true;
      loadGeneration += 1;
      requestController?.abort();
      refreshController?.abort();
      clearRefreshTimer();
      if (resumeRefreshTimer !== null) window.clearTimeout(resumeRefreshTimer);
      if (connectRetryTimer !== null) window.clearTimeout(connectRetryTimer);
      window.clearTimeout(startupTimer);
      window.clearInterval(heartbeatTimer);
      document.removeEventListener('visibilitychange', noteVisible);
      window.removeEventListener('pageshow', noteVisible);
      window.removeEventListener('online', noteVisible);
      frame.removeEventListener('load', onLoad);
      window.removeEventListener('message', onMessage);
      bridge?.stop();
      if (bridgeRef.current === bridge) bridgeRef.current = null;
      homeSavePendingRef.current = false;
    };
  }, [
    projectId,
    recoveryPrincipalKey,
    runtimeOrigin,
    attempt,
    requestHomeExit,
    actorKey(telemetryActor),
  ]);

  if (!runtimeOrigin) {
    return (
      <main className="page-center" role="alert">
        <section className="login-card">
          <h1>Не удалось открыть среду</h1>
          <p>Откройте проект через приложение ASA Lab.</p>
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
          key={`${projectId}:${recoveryPrincipalKey}:${actorKey(telemetryActor)}:${attempt}`}
          ref={iframeRef}
          title="Scratch runtime"
          src={`/internal/blocks/?asaStatus=parent&diagnosticInstance=${diagnosticInstance}`}
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
