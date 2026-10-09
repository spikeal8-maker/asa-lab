(() => {
  const shell = document.querySelector('[data-asa-host-shell]');
  const status = document.getElementById('runtime-status');
  const standalone = globalThis.GUI;
  const protocolApi = globalThis.AsaBlocksProtocol;
  const statusApi = globalThis.AsaBlocksStatus;
  const recoveryApi = globalThis.AsaBlocksRecovery;
  const requiredExports = [
    'EditorState',
    'createStandaloneRoot',
    'setAppElement',
    'ScratchStorage',
    'buildDefaultProject',
    'setProjectId',
  ];

  if (!shell || !status) {
    throw new Error('ASA Scratch host shell is incomplete');
  }

  const failLocal = (state, text) => {
    shell.dataset.runtimeState = state;
    status.textContent = text;
  };

  const missingExports = requiredExports.filter(
    (name) => !standalone || typeof standalone[name] === 'undefined',
  );
  if (missingExports.length > 0) {
    failLocal('error', 'Не удалось загрузить среду визуального программирования.');
    throw new Error(`Scratch standalone bundle missing exports: ${missingExports.join(', ')}`);
  }

  if (!protocolApi || !statusApi || !recoveryApi) {
    failLocal('error', 'Не удалось загрузить протокол среды визуального программирования.');
    throw new Error('ASA Blocks protocol/status/recovery modules are unavailable');
  }
  const rawParentOrigin = document
    .querySelector('meta[name="asa-parent-origin"]')
    ?.getAttribute('content')
    ?.trim();

  let expectedParentOrigin = null;
  // The shipping editor is a component of this ASA page, never a standalone
  // application. The configured origin below remains for isolated protocol CI.
  const integrated = new URL(window.location.href).pathname.startsWith('/internal/blocks/');
  if (integrated) {
    if (window.parent === window) {
      failLocal('configuration-required', 'Откройте проект через приложение ASA Lab.');
      return;
    }
    expectedParentOrigin = new URL(window.location.href).origin;
  } else if (rawParentOrigin) {
    try {
      const parsed = new URL(rawParentOrigin);
      if (['http:', 'https:'].includes(parsed.protocol) && parsed.origin === rawParentOrigin) {
        // `localhost` is a local-deployment template. The runtime still accepts only
        // the exact configured protocol/port and the same hostname it was loaded from.
        if (parsed.hostname === 'localhost') {
          parsed.hostname = new URL(window.location.href).hostname;
          expectedParentOrigin = parsed.origin;
        } else {
          expectedParentOrigin = rawParentOrigin;
        }
      }
    } catch {
      expectedParentOrigin = null;
    }
  }

  if (!expectedParentOrigin) {
    failLocal('configuration-required', 'Среда ожидает настроенное приложение ASA Lab.');
    return;
  }

  let reporter = null;
  let editor = null;
  let heartbeat = null;
  const stopHeartbeat = () => {
    if (heartbeat !== null) window.clearInterval(heartbeat);
    heartbeat = null;
  };
  // A disposable diagnostic ID carries no capability or project identity.
  const diagnosticInstance = new URL(window.location.href).searchParams.get('diagnosticInstance');
  if (
    integrated &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(diagnosticInstance ?? '')
  ) {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = new URL(
        input instanceof Request ? input.url : String(input),
        window.location.href,
      );
      if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/'))
        return originalFetch(input, init);
      const headers = new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined),
      );
      headers.set('x-asa-diagnostic-instance', diagnosticInstance);
      headers.set('x-asa-diagnostic-module', 'scratch');
      const started = performance.now();
      try {
        const response = await originalFetch(input, { ...init, headers });
        if (response.status >= 400)
          reporter?.requestFailed(
            response.status,
            response.headers.get('x-request-id'),
            Math.round(performance.now() - started),
          );
        return response;
      } catch (failure) {
        if (failure?.name !== 'AbortError')
          reporter?.requestFailed(null, null, Math.round(performance.now() - started));
        throw failure;
      }
    };
  }
  const incrementRejections = () => {
    const current = Number.parseInt(shell.dataset.protocolRejections ?? '0', 10) || 0;
    shell.dataset.protocolRejections = String(current + 1);
  };

  const protocol = protocolApi.createChildProtocol({
    parentWindow: window.parent,
    expectedParentOrigin,
    onInit(session, bootstrap) {
      // Presentation only, after accepted INIT. Other parents keep the local status.
      status.hidden =
        session.mode === 'editor' &&
        new URL(window.location.href).searchParams.get('asaStatus') === 'parent';
      reporter = statusApi.createStatusReporter({
        parentWindow: window.parent,
        targetOrigin: expectedParentOrigin,
        getBinding: () => protocol.getBinding(),
      });
      shell.dataset.runtimeState = 'init-accepted';
      status.textContent = 'Загрузка учебного проекта…';
      reporter.status('init-accepted');
      try {
        editor = globalThis.AsaBlocksEditor.mountEditor({
          standalone,
          container: document.getElementById('scratch-editor-root'),
          shell,
          session,
          bootstrap,
          recoveryApi,
          getRuntimeToken: () => protocol.getRuntimeToken(),
          onReady() {
            status.textContent = 'Учебный проект готов.';
            reporter.status('editor-ready');
            stopHeartbeat();
            heartbeat = window.setInterval(() => reporter?.status('runtime-heartbeat'), 15_000);
          },
          onDirty(generation) {
            reporter?.projectDirty(generation);
          },
          onHomeRequest() {
            reporter?.homeRequest();
          },
          onThumbnailReady(sourceRevision, imageDataUrl) {
            reporter?.thumbnailReady(sourceRevision, imageDataUrl);
          },
        });
        void editor.startup.catch(() => reportFatal('editor_mount_failed'));
      } catch {
        reportFatal('editor_mount_failed');
      }
    },
    onSaveBeforeExitRequest(requestId) {
      if (!editor) {
        reporter?.saveBeforeExitResult(requestId, false, 'editor_not_ready');
        return;
      }
      void editor.saveBeforeExit().then((result) => {
        if (result.ok) {
          reporter?.saveBeforeExitResult(
            requestId,
            true,
            null,
            result.revision,
            result.savedGeneration,
          );
          return;
        }
        reporter?.saveBeforeExitResult(requestId, false, result.reason);
      });
    },
    onStop() {
      stopHeartbeat();
      reporter?.status('stopped');
      void editor?.dispose().catch(() => undefined);
      shell.dataset.runtimeState = 'stopped';
      status.textContent = 'Среда остановлена приложением ASA Lab.';
    },
    onRejected: incrementRejections,
  });

  const reportFatal = (code) => {
    stopHeartbeat();
    if (!reporter) return;
    shell.dataset.runtimeState = 'error';
    status.textContent = 'Среда визуального программирования завершилась с ошибкой.';
    reporter.fatal(code);
    void editor?.dispose().catch(() => undefined);
  };

  window.addEventListener('error', () => reportFatal('runtime_error'));
  window.addEventListener('unhandledrejection', () => reportFatal('runtime_unhandled_rejection'));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      void editor?.flushRecovery().catch(() => undefined);
    }
  });
  window.addEventListener('pagehide', () => {
    stopHeartbeat();
    void editor?.flushRecovery().catch(() => undefined);
    void editor?.dispose().catch(() => undefined);
    protocol.dispose();
  });

  protocol.start();
  shell.dataset.runtimeState = 'awaiting-init';
  shell.dataset.protocolRejections = '0';
  status.textContent = 'Ожидание безопасного подключения ASA Lab…';
})();
