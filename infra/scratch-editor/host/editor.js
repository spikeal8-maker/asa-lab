(() => {
  const ASSET_ID_RE = /^[a-f0-9]{32}$/;
  const COSTUME_FORMATS = new Set(['svg', 'png', 'jpg']);
  const SOUND_FORMATS = new Set(['wav', 'mp3']);

  const failure = (code) => Object.assign(new Error(code), { code });
  const mediaKey = (assetId, dataFormat) => `${assetId}.${dataFormat}`;
  const chooseAutoSaveIntervalSecs = () => {
    if (!globalThis.crypto?.getRandomValues) return 6;
    const value = new Uint8Array(1);
    globalThis.crypto.getRandomValues(value);
    return 5 + (value[0] % 4);
  };

  const exactBytes = (data) => {
    if (data instanceof Uint8Array) return Uint8Array.from(data);
    if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0));
    if (ArrayBuffer.isView(data)) {
      return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
    }
    throw failure('asset_capture_failed');
  };

  const referencedAssets = (projectJson) => {
    if (!projectJson || typeof projectJson !== 'object' || !Array.isArray(projectJson.targets)) {
      throw failure('snapshot_project_invalid');
    }
    const references = [];
    const seen = new Set();
    for (const target of projectJson.targets) {
      if (
        !target ||
        typeof target !== 'object' ||
        !Array.isArray(target.costumes) ||
        !Array.isArray(target.sounds)
      ) {
        throw failure('snapshot_project_invalid');
      }
      for (const costume of target.costumes) {
        const assetId = costume?.assetId;
        const dataFormat = costume?.dataFormat;
        if (!ASSET_ID_RE.test(assetId ?? '') || !COSTUME_FORMATS.has(dataFormat)) {
          throw failure('snapshot_project_invalid');
        }
        const key = mediaKey(assetId, dataFormat);
        if (!seen.has(key)) {
          seen.add(key);
          references.push({ assetId, dataFormat });
        }
      }
      for (const sound of target.sounds) {
        const assetId = sound?.assetId;
        const dataFormat = sound?.dataFormat;
        if (!ASSET_ID_RE.test(assetId ?? '') || !SOUND_FORMATS.has(dataFormat)) {
          throw failure('snapshot_project_invalid');
        }
        const key = mediaKey(assetId, dataFormat);
        if (!seen.has(key)) {
          seen.add(key);
          references.push({ assetId, dataFormat });
        }
      }
    }
    return references;
  };

  async function captureLiveSnapshot(vm) {
    if (!vm || typeof vm.toJSON !== 'function' || !Array.isArray(vm.assets)) {
      throw failure('snapshot_unavailable');
    }
    let projectJson;
    try {
      projectJson = JSON.parse(vm.toJSON());
    } catch {
      throw failure('snapshot_project_invalid');
    }
    const references = referencedAssets(projectJson);
    const liveAssets = new Map();
    for (const asset of vm.assets) {
      if (
        asset &&
        ASSET_ID_RE.test(asset.assetId ?? '') &&
        (COSTUME_FORMATS.has(asset.dataFormat) || SOUND_FORMATS.has(asset.dataFormat))
      ) {
        liveAssets.set(mediaKey(asset.assetId, asset.dataFormat), asset);
      }
    }

    const assets = [];
    for (const reference of references) {
      const live = liveAssets.get(mediaKey(reference.assetId, reference.dataFormat));
      if (!live) throw failure('asset_capture_failed');
      const bytes = exactBytes(live.data);
      if (bytes.byteLength < 1) throw failure('asset_capture_failed');
      if (!globalThis.crypto?.subtle) throw failure('runtime_crypto_unavailable');
      const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
      const sha256 = [...digest].map((value) => value.toString(16).padStart(2, '0')).join('');
      assets.push({
        ...reference,
        bytes,
        sizeBytes: bytes.byteLength,
        sha256,
      });
    }
    return { projectJson, assets };
  }

  function mountEditor({
    standalone,
    container,
    shell,
    session,
    bootstrap,
    getRuntimeToken,
    onReady,
    onDirty,
  }) {
    let state = null;
    let vm = null;
    let root = null;
    let disposed = false;
    let loaded = false;
    let saveInProgress = false;
    let projectGeneration = 0;
    const autoSaveIntervalSecs = chooseAutoSaveIntervalSecs();
    const storage = globalThis.AsaBlocksStorage.createReadOnlyStorage(standalone, {
      projectId: session.projectId,
      projectJson: bootstrap.projectJson,
      assets: bootstrap.assets,
      draftRevision: bootstrap.draftRevision,
      apiOrigin: bootstrap.apiOrigin,
      getRuntimeToken,
      canSave: session.mode === 'editor',
      getProjectGeneration: () => projectGeneration,
      onSaveCompletedStale: () => {
        globalThis.setTimeout(() => {
          if (!disposed && loaded && vm) vm.emit('PROJECT_CHANGED');
        }, 0);
      },
    });

    const changed = () => {
      if (disposed || !loaded) return;
      projectGeneration += 1;
      shell.dataset.projectChanges = String(projectGeneration);
      onDirty?.(projectGeneration);
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
          projectId: session.projectId,
          canSave: session.mode === 'editor',
          autoSaveIntervalSecs,
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
      } catch (error) {
        if (disposed) return;
        dispose();
        throw error;
      }
    };

    const flush = async () => {
      if (saveInProgress) return { ok: false, reason: 'save_in_progress' };
      if (disposed || !loaded || !vm) return { ok: false, reason: 'editor_not_ready' };
      saveInProgress = true;
      const snapshotGeneration = projectGeneration;
      try {
        const snapshot = await captureLiveSnapshot(vm);
        const revision = await storage.persistSnapshot(snapshot);
        shell.dataset.draftRevision = String(revision);
        return { ok: true, revision, snapshotGeneration };
      } catch (error) {
        return {
          ok: false,
          reason:
            typeof error?.code === 'string' && error.code.length > 0 ? error.code : 'save_failed',
        };
      } finally {
        saveInProgress = false;
      }
    };

    const startup = start();
    return { dispose, flush, startup };
  }

  globalThis.AsaBlocksEditor = { mountEditor };
})();
