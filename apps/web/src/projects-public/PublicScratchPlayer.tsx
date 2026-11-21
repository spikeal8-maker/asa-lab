import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { PublicScratchPlayerBootstrap } from '@asa-lab/contracts';
import { BlocksRuntimeBridge } from '../blocks/runtime-protocol';
import { parseBlocksRuntimeSession } from '../blocks/runtime-session';

/** Official isolated Scratch host, with a publication-only read capability. */
export function PublicScratchPlayer({
  publicationId,
  revisionId,
  onUnavailable,
  fallback,
}: {
  readonly publicationId: string;
  readonly revisionId: string;
  readonly onUnavailable: () => void;
  readonly fallback: ReactNode;
}): JSX.Element {
  const frame = useRef<HTMLIFrameElement>(null);
  const wrapper = useRef<HTMLElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState(false);
  const [integrations, setIntegrations] = useState(false);
  const [loaded, setLoaded] = useState(0);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  useEffect(() => {
    const element = wrapper.current;
    const changed = () => setFullscreen(document.fullscreenElement === element);
    document.addEventListener('fullscreenchange', changed);
    return () => {
      document.removeEventListener('fullscreenchange', changed);
      if (element && document.fullscreenElement === element)
        void document.exitFullscreen().catch(() => undefined);
    };
  }, []);
  useEffect(() => {
    if (!loaded || !frame.current?.contentWindow) return;
    let disposed = false,
      failed = false;
    setState('loading');
    let bridge: BlocksRuntimeBridge | null = null;
    let controller: AbortController | null = null;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let deadlineTimer: ReturnType<typeof setTimeout> | null = null;
    let resumeTimer: ReturnType<typeof setTimeout> | null = null;
    let epoch = 0,
      retries = 0,
      validUntil = 0;
    const startupTimer = setTimeout(() => fail(false), 45000);
    const clear = () => {
      epoch++;
      controller?.abort();
      controller = null;
      if (refreshTimer) clearTimeout(refreshTimer);
      if (deadlineTimer) clearTimeout(deadlineTimer);
      if (resumeTimer) clearTimeout(resumeTimer);
      clearTimeout(startupTimer);
      bridge?.stop();
      bridge = null;
      window.removeEventListener('message', receive);
      window.removeEventListener('pageshow', resume);
      window.removeEventListener('online', resume);
      document.removeEventListener('visibilitychange', resume);
    };
    const fail = (unavailable: boolean) => {
      if (disposed || failed) return;
      failed = true;
      clear();
      setState('error');
      if (unavailable) onUnavailable();
    };
    const connect = async () => {
      if (disposed || failed || controller) return;
      if (refreshTimer) {
        clearTimeout(refreshTimer);
        refreshTimer = null;
      }
      const generation = epoch;
      const requestController = new AbortController();
      controller = requestController;
      const current = () =>
        !disposed && !failed && generation === epoch && controller === requestController;
      const requestStart = performance.now();
      const requestTimer = setTimeout(() => requestController.abort(), 15000);
      let retryable = true;
      try {
        const response = await fetch(
          `/api/public-projects/${publicationId}/scratch-player?revisionId=${revisionId}`,
          {
            signal: requestController.signal,
            credentials: 'omit',
            cache: 'no-store',
            redirect: 'error',
            headers: { accept: 'application/json' },
          },
        );
        if (!current()) return;
        if (requestController.signal.aborted) throw new Error('Player request timed out');
        if ([400, 401, 403, 404, 409, 410].includes(response.status)) {
          fail(true);
          return;
        }
        if (response.status === 422) {
          fail(false);
          return;
        }
        if (!response.ok) {
          retryable = response.status === 429 || response.status >= 500;
          throw new Error('Player unavailable');
        }
        const value = (await response.json()) as PublicScratchPlayerBootstrap;
        if (!current()) return;
        if (requestController.signal.aborted) {
          retryable = true;
          throw new Error('Player request timed out');
        }
        // A complete body is required before classifying schema/authority errors.
        // Stream truncation or a body-read abort is still a temporary transport failure.
        retryable = false;
        if (
          value.schemaVersion !== 1 ||
          value.viewerFamily !== 'scratch' ||
          value.publicationId !== publicationId ||
          value.revisionId !== revisionId
        )
          throw new Error('Player binding mismatch');
        // The HTTP server Date, not a body field or the pupil's calendar, anchors expiry.
        const date = response.headers.get('date');
        const serverNow = date ? Math.floor(Date.parse(date) / 1000) : NaN;
        const session = parseBlocksRuntimeSession(
          {
            runtimeOrigin: value.runtimeOrigin,
            runtimeToken: value.runtimeToken,
            expiresAt: value.expiresAt,
            draftRevision: 0,
            projectJson: value.projectJson,
            assets: value.assets,
          },
          serverNow,
          requestStart,
        );
        if (!session || !session.projectJson || session.assets.length > 256)
          throw new Error('Invalid player session');
        setIntegrations(
          (session.projectJson['extensions'] as string[]).some(
            (id) => !['pen', 'music'].includes(id),
          ),
        );
        if (bridge && bridge.runtimeOrigin !== session.runtimeOrigin)
          throw new Error('Player origin changed');
        retries = 0;
        if (!bridge) {
          bridge = new BlocksRuntimeBridge({
            childWindow: frame.current!.contentWindow!,
            runtimeOrigin: session.runtimeOrigin,
            projectId: publicationId,
            versionId: revisionId,
            assetScope: 'publication',
            mode: 'player',
            apiOrigin: window.location.origin,
            runtimeToken: session.runtimeToken,
            draftRevision: 0,
            projectJson: session.projectJson,
            hasProjectJson: true,
            assets: session.assets,
            recoveryPrincipalKey: `public:${publicationId}:${revisionId}`,
          });
          bridge.sendInit();
        } else bridge.updateToken(session.runtimeToken);
        validUntil = session.expiresAtMonotonicMs;
        if (deadlineTimer) clearTimeout(deadlineTimer);
        deadlineTimer = setTimeout(() => fail(false), Math.max(0, validUntil - performance.now()));
        refreshTimer = setTimeout(
          () => void connect(),
          Math.min(60000, Math.max(1000, validUntil - performance.now() - 30000)),
        );
      } catch {
        if (!current()) return;
        if (!retryable) {
          fail(false);
          return;
        }
        retries++;
        const remaining = validUntil - performance.now();
        if (bridge && remaining > 0) {
          // Keep the already authorised running VM during a temporary outage.
          // The existing deadline still tears it down; retries never extend authority.
          refreshTimer = setTimeout(
            () => void connect(),
            Math.min(remaining, retries <= 2 ? retries * 2000 : 30000),
          );
        } else if (!bridge && retries <= 2)
          refreshTimer = setTimeout(() => void connect(), retries * 2000);
        else fail(false);
      } finally {
        clearTimeout(requestTimer);
        if (controller === requestController) controller = null;
      }
    };
    const receive = (event: MessageEvent) => {
      if (!bridge?.acceptChildMessage(event)) return;
      const message = event.data as Record<string, unknown>;
      if (message['messageType'] === 'ASA_BLOCKS_FATAL') fail(false);
      else if (message['messageType'] === 'ASA_BLOCKS_TOKEN_REFRESH_REQUIRED') void connect();
      else if (
        message['messageType'] === 'ASA_BLOCKS_STATUS' &&
        message['status'] === 'editor-ready'
      ) {
        clearTimeout(startupTimer);
        setState('ready');
      }
    };
    const resume = () => {
      if (disposed || failed || document.visibilityState !== 'visible') return;
      // An in-flight response may predate OS suspension while performance.now paused.
      // Invalidate it even if fetch/json ignores abort; one fresh request follows the burst.
      epoch++;
      const old = controller;
      controller = null;
      old?.abort();
      if (refreshTimer) {
        clearTimeout(refreshTimer);
        refreshTimer = null;
      }
      if (resumeTimer !== null) return;
      resumeTimer = setTimeout(() => {
        resumeTimer = null;
        if (document.visibilityState === 'visible') void connect();
      }, 0);
    };
    window.addEventListener('message', receive);
    window.addEventListener('pageshow', resume);
    window.addEventListener('online', resume);
    document.addEventListener('visibilitychange', resume);
    void connect();
    return () => {
      disposed = true;
      clear();
    };
  }, [loaded, publicationId, revisionId, onUnavailable]);
  if (state === 'error')
    return (
      <div data-testid="public-scratch-fallback">
        <p role="status">Scratch не загрузился. Откройте публикацию повторно.</p>
        {fallback}
      </div>
    );
  return (
    <section
      ref={wrapper}
      className="public-scratch-player"
      aria-label="Просмотр Scratch"
      data-testid="public-scratch-player"
    >
      <div className="public-scratch-tools">
        {typeof document !== 'undefined' && document.fullscreenEnabled ? (
          <button
            type="button"
            data-testid="public-scratch-fullscreen"
            aria-label={fullscreen ? 'Выйти из полного экрана' : 'На весь экран'}
            title={fullscreen ? 'Выйти из полного экрана' : 'На весь экран'}
            onClick={() => {
              setFullscreenError(false);
              void (
                document.fullscreenElement === wrapper.current
                  ? document.exitFullscreen()
                  : wrapper.current!.requestFullscreen()
              ).catch(() => setFullscreenError(true));
            }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path
                d={
                  fullscreen
                    ? 'M4 9h5V4m6 0v5h5M4 15h5v5m6 0v-5h5'
                    : 'M9 4H4v5m11-5h5v5M4 15v5h5m6 0h5v-5'
                }
              />
            </svg>
          </button>
        ) : null}
      </div>
      {fullscreenError ? (
        <p role="status">Полноэкранный режим недоступен в этом браузере.</p>
      ) : null}
      {integrations ? (
        <p className="public-scratch-integration-note" role="status">
          Расширения могут требовать интернет или оборудование. Доступ к устройствам в просмотре
          автоматически не предоставляется.
        </p>
      ) : null}
      {state === 'loading' ? (
        <p role="status" className="public-scratch-loading">
          Загружаем Scratch…
        </p>
      ) : null}
      <iframe
        ref={frame}
        title="Scratch — просмотр опубликованного проекта"
        src="/internal/blocks/?asaStatus=parent"
        sandbox="allow-scripts allow-same-origin"
        allow="fullscreen; camera 'none'; microphone 'none'; usb 'none'; serial 'none'; hid 'none'"
        allowFullScreen
        onLoad={() => setLoaded((value) => value + 1)}
        data-testid="public-scratch-frame"
      />
    </section>
  );
}
