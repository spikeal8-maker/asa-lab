(() => {
  function mountEditor({ standalone, container, shell, session, hasProjectJson, onReady }) {
    const storage = globalThis.AsaBlocksStorage.createFixtureStorage(standalone);
    const state = new standalone.EditorState(
      {
        isPlayerOnly: session.mode === 'player',
        showTelemetryModal: false,
      },
      () => ({ storage }),
    );
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
    shell.dataset.fixtureKind = hasProjectJson ? 'existing' : 'new';
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
      try {
        disposeVm();
      } finally {
        root?.unmount();
        shell.dataset.editorState = 'disposed';
        shell.dataset.projectRunning = 'false';
      }
    };
    try {
      standalone.setAppElement(container);
      root = standalone.createStandaloneRoot(state, container);
      root.render({
        ...(hasProjectJson ? { projectId: globalThis.AsaBlocksStorage.EXISTING_FIXTURE_ID } : {}),
        canSave: false,
        logo: '/asa-lab-mark.svg',
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
      // The standalone export does not start the default-project fetch itself.
      // Trigger its supported reducer only after ProjectFetcher has mounted.
      if (!hasProjectJson) state.dispatch(standalone.setProjectId('0'));
    } catch (error) {
      dispose();
      throw error;
    }
    return { dispose };
  }
  globalThis.AsaBlocksEditor = { mountEditor };
})();
