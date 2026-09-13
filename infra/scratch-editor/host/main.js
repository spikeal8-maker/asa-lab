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
        expectedParentOrigin = rawParentOrigin;
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
    onInit(session, { hasProjectJson }) {
      reporter = statusApi.createStatusReporter({
        parentWindow: window.parent,
        targetOrigin: expectedParentOrigin,
        getBinding: () => protocol.getBinding(),
      });
      shell.dataset.runtimeState = 'init-accepted';
      status.textContent = 'Загрузка учебного проекта… Изменения не сохраняются.';
      reporter.status('init-accepted');
      try {
        editor = globalThis.AsaBlocksEditor.mountEditor({
          standalone,
          container: document.getElementById('scratch-editor-root'),
          shell,
          session,
          hasProjectJson,
          onReady() {
            status.textContent = 'Учебный проект готов. Изменения не сохраняются.';
            reporter.status('editor-ready');
          },
        });
      } catch {
        reportFatal('editor_mount_failed');
      }
    },
    onTokenUpdate() {
      reporter?.status('token-updated');
    },
    onFlushRequest(requestId) {
      reporter?.flushResult(requestId, false, 'storage_not_available');
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
