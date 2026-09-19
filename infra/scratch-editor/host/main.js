(() => {
  const shell = document.querySelector('[data-asa-host-shell]');
  const status = document.getElementById('runtime-status');
  const standalone = globalThis.GUI;
  const protocolApi = globalThis.AsaBlocksProtocol;
  const statusApi = globalThis.AsaBlocksStatus;
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

  if (!protocolApi || !statusApi) {
    failLocal('error', 'Не удалось загрузить протокол среды визуального программирования.');
    throw new Error('ASA Blocks protocol/status modules are unavailable');
  }
  const rawParentOrigin = document
    .querySelector('meta[name="asa-parent-origin"]')
    ?.getAttribute('content')
    ?.trim();

  let expectedParentOrigin = null;
  if (rawParentOrigin) {
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
          getRuntimeToken: () => protocol.getRuntimeToken(),
          onReady() {
            status.textContent = 'Учебный проект готов.';
            reporter.status('editor-ready');
          },
          onDirty(generation) {
            reporter?.projectDirty(generation);
          },
        });
        void editor.startup.catch(() => reportFatal('editor_mount_failed'));
      } catch {
        reportFatal('editor_mount_failed');
      }
    },
    onFlushRequest(requestId) {
      if (!editor) {
        reporter?.flushResult(requestId, false, 'editor_not_ready');
        return;
      }
      void editor.flush().then((result) => {
        if (result.ok) {
          reporter?.flushResult(requestId, true, null, result.revision, result.snapshotGeneration);
          return;
        }
        reporter?.flushResult(requestId, false, result.reason);
      });
    },
    onStop() {
      reporter?.status('stopped');
      editor?.dispose();
      shell.dataset.runtimeState = 'stopped';
      status.textContent = 'Среда остановлена приложением ASA Lab.';
    },
    onRejected: incrementRejections,
  });

  const reportFatal = (code) => {
    if (!reporter) return;
    shell.dataset.runtimeState = 'error';
    status.textContent = 'Среда визуального программирования завершилась с ошибкой.';
    reporter.fatal(code);
    editor?.dispose();
  };

  window.addEventListener('error', () => reportFatal('runtime_error'));
  window.addEventListener('unhandledrejection', () => reportFatal('runtime_unhandled_rejection'));
  window.addEventListener('pagehide', () => {
    editor?.dispose();
    protocol.dispose();
  });

  protocol.start();
  shell.dataset.runtimeState = 'awaiting-init';
  shell.dataset.protocolRejections = '0';
  status.textContent = 'Ожидание безопасного подключения ASA Lab…';
})();
