(() => {
  const shell = document.querySelector('[data-asa-host-shell]');
  const status = document.getElementById('runtime-status');
  const standalone = globalThis.GUI;
  const requiredExports = ['EditorState', 'createStandaloneRoot', 'setAppElement'];

  if (!shell || !status) {
    throw new Error('ASA Scratch host shell is incomplete');
  }

  const missingExports = requiredExports.filter(
    (name) => !standalone || typeof standalone[name] === 'undefined',
  );

  if (missingExports.length > 0) {
    shell.dataset.runtimeState = 'error';
    status.textContent = 'Не удалось загрузить среду визуального программирования.';
    throw new Error(`Scratch standalone bundle missing exports: ${missingExports.join(', ')}`);
  }

  shell.dataset.runtimeState = 'standalone-ready';
  status.textContent = 'Среда визуального программирования подготовлена.';
})();
