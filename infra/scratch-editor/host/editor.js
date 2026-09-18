(() => {
  function mountEditor({
    standalone,
    container,
    shell,
    session,
    bootstrap,
    getRuntimeToken,
    onReady,
  }) {
    const storage = globalThis.AsaBlocksStorage.createReadOnlyStorage(standalone, {
      projectId: session.projectId,
      projectJson: bootstrap.projectJson,
      assets: bootstrap.assets,
      apiOrigin: bootstrap.apiOrigin,
      getRuntimeToken,
    });
    let state = null;
    let vm = null;
    let root = null;
    let disposed = false;
    let loaded = false;

    const changed = () => {
      if (disposed || !loaded) return;
      shell.dataset.projectChanges = String(Number(shell.dataset.projectChanges) + 1);
    };
    const running = () => {
      if (!disposed) shell.dataset.projectRunning = 'true';
    };
    const stopped = () => {
      shell.dataset.projectRunning = 'false';
    };

    shell.dataset.editorState = 'loading';
    shell.dataset.projectChanges = '0';
    shell.dataset.projectRunning = 'false';
    shell.dataset.projectSource = bootstrap.hasProjectJson ? 'runtime-session' : 'new-default';
    shell.dataset.draftRevision = String(bootstrap.draftRevision);

    const disposeVm = () => {
      if (!vm) return;
      vm.removeListener('PROJECT_CHANGED', changed);
      vm.removeListener('PROJECT_RUN_START', running);
      vm.removeListener('PROJECT_RUN_STOP', stopped);
      vm.stopAll();
      vm.quit();
    };

    const dispose = () => {
      if (disposed) return;
      disposed = true;
      loaded = false;
      storage.dispose();
      try {
        disposeVm();
      } finally {
        root?.unmount();
        shell.dataset.editorState = 'disposed';
        shell.dataset.projectRunning = 'false';
      }
    };

    const start = async () => {
      try {
        if (bootstrap.hasProjectJson) {
          await storage.prepareProjectAssets();
        }
        if (disposed) return;

        state = new standalone.EditorState(
          {
            isPlayerOnly: session.mode === 'player',
            showTelemetryModal: false,
          },
          () => ({ storage }),
        );
        standalone.setAppElement(container);
        root = standalone.createStandaloneRoot(state, container);
        root.render({
          ...(bootstrap.hasProjectJson ? { projectId: session.projectId } : {}),
          canSave: false,
          logo: '/asa-lab-scratch-wordmark.svg',
          onVmInit(instance) {
            vm = instance;
            if (disposed) {
              disposeVm();
              return;
            }
            vm.on('PROJECT_CHANGED', changed);
            vm.on('PROJECT_RUN_START', running);
            vm.on('PROJECT_RUN_STOP', stopped);
          },
          onProjectLoaded() {
            if (disposed) {
              disposeVm();
              return;
            }
            loaded = true;
            shell.dataset.editorState = 'ready';
            onReady();
          },
        });
        if (!bootstrap.hasProjectJson) state.dispatch(standalone.setProjectId('0'));
      } catch (error) {
        if (disposed) return;
        dispose();
        throw error;
      }
    };

    const startup = start();
    return { dispose, startup };
  }

  globalThis.AsaBlocksEditor = { mountEditor };
})();
