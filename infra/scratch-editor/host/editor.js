(() => {
  const ASSET_ID_RE = /^[a-f0-9]{32}$/;
  const COSTUME_FORMATS = new Set(['svg', 'png', 'jpg']);
  const SOUND_FORMATS = new Set(['wav', 'mp3']);
  const THUMBNAIL_WIDTH = 480;
  const THUMBNAIL_HEIGHT = 360;
  const SNAPSHOT_MAX_BYTES = 262_144;
  const WEBP_QUALITIES = [0.92, 0.84, 0.76, 0.68, 0.6, 0.52];

  const failure = (code) => Object.assign(new Error(code), { code });
  const mediaKey = (assetId, dataFormat) => `${assetId}.${dataFormat}`;
  const chooseAutoSaveIntervalSecs = () => {
    if (!globalThis.crypto?.getRandomValues) return 6;
    const value = new Uint8Array(1);
    globalThis.crypto.getRandomValues(value);
    return 5 + (value[0] % 4);
  };

  const readBlobAsDataUrl = (blob) =>
    new Promise((resolve) => {
      const reader = new FileReader();
      reader.onerror = () => resolve(null);
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.readAsDataURL(blob);
    });

  const canvasToBlob = (canvas, type, quality) =>
    new Promise((resolve) => {
      canvas.toBlob(resolve, type, quality);
    });

  const prepareThumbnailDataUrl = async (blob) => {
    if (!(blob instanceof Blob) || !['image/png', 'image/webp'].includes(blob.type)) return null;
    if (blob.size <= SNAPSHOT_MAX_BYTES) return readBlobAsDataUrl(blob);
    if (typeof globalThis.createImageBitmap !== 'function') return null;

    let bitmap;
    try {
      bitmap = await globalThis.createImageBitmap(blob);
      if (bitmap.width !== THUMBNAIL_WIDTH || bitmap.height !== THUMBNAIL_HEIGHT) return null;
      const canvas = document.createElement('canvas');
      canvas.width = THUMBNAIL_WIDTH;
      canvas.height = THUMBNAIL_HEIGHT;
      const context = canvas.getContext('2d');
      if (!context) return null;
      context.drawImage(bitmap, 0, 0, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);
      for (const quality of WEBP_QUALITIES) {
        const encoded = await canvasToBlob(canvas, 'image/webp', quality);
        if (
          encoded &&
          encoded.type === 'image/webp' &&
          encoded.size > 0 &&
          encoded.size <= SNAPSHOT_MAX_BYTES
        ) {
          return readBlobAsDataUrl(encoded);
        }
      }
      return null;
    } catch {
      return null;
    } finally {
      bitmap?.close?.();
    }
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
    recoveryApi,
    getRuntimeToken,
    onReady,
    onDirty,
    onThumbnailReady,
  }) {
    let state = null;
    let vm = null;
    let root = null;
    let disposed = false;
    let loaded = false;
    let saveInProgress = false;
    let projectGeneration = 0;
    let storage = null;
    let recoveryStore = null;
    let recoveryController = null;
    let recoveredRecord = null;
    let recoveryConflict = false;
    let initialProjectLoadedHandled = false;
    let readyReported = false;
    let upstreamProjectSaver = null;
    let saveBeforeExitPromise = null;
    let upstreamSaverRearmSequence = 0;
    const upstreamSaverRearmWaiters = new Set();
    const autoSaveIntervalSecs = chooseAutoSaveIntervalSecs();
    const createStorage = () =>
      globalThis.AsaBlocksStorage.createReadOnlyStorage(standalone, {
        projectId: session.projectId,
        projectJson: bootstrap.projectJson,
        assets: bootstrap.assets,
        draftRevision: bootstrap.draftRevision,
        apiOrigin: bootstrap.apiOrigin,
        getRuntimeToken,
        canSave: session.mode === 'editor',
        getProjectGeneration: () => projectGeneration,
        onProjectDurable: ({ savedGeneration }) => {
          void recoveryController?.durable(savedGeneration);
        },
        onSaveCompletedStale: () => {
          globalThis.setTimeout(() => {
            if (!disposed && loaded && vm) vm.emit('PROJECT_CHANGED');
            upstreamSaverRearmSequence += 1;
            for (const waiter of [...upstreamSaverRearmWaiters]) {
              if (upstreamSaverRearmSequence > waiter.afterSequence) {
                upstreamSaverRearmWaiters.delete(waiter);
                waiter.resolve(!disposed);
              }
            }
          }, 0);
        },
      });

    const changed = () => {
      if (disposed || !loaded) return;
      projectGeneration += 1;
      shell.dataset.projectChanges = String(projectGeneration);
      recoveryController?.schedule(projectGeneration);
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
    shell.dataset.recoveryState = 'none';
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
      upstreamProjectSaver = null;
      for (const waiter of [...upstreamSaverRearmWaiters]) {
        upstreamSaverRearmWaiters.delete(waiter);
        waiter.resolve(false);
      }
      recoveryController?.dispose();
      recoveryStore?.close();
      storage?.dispose();
      try {
        disposeVm();
      } finally {
        root?.unmount();
        shell.dataset.editorState = 'disposed';
        shell.dataset.projectRunning = 'false';
      }
    };

    const reportReady = () => {
      if (disposed || readyReported) return;
      loaded = true;
      readyReported = true;
      shell.dataset.editorState = 'ready';
      onReady();
    };

    const restoreRecoveredProject = async () => {
      const record = recoveredRecord;
      if (!record || session.mode !== 'editor' || !vm) {
        reportReady();
        return;
      }

      let canonicalProjectJson;
      try {
        canonicalProjectJson = JSON.parse(vm.toJSON());
      } catch {
        shell.dataset.recoveryState = 'restore_failed';
        reportReady();
        return;
      }

      shell.dataset.editorState = 'recovering';
      shell.dataset.recoveryState = 'restoring';
      loaded = false;
      try {
        await storage.installRecoveryAssets(record.assets ?? []);
        await vm.loadProject(record.projectJson);
        if (disposed) return;
        projectGeneration = Math.max(0, record.generation - 1);
        loaded = true;
        shell.dataset.projectSource = 'recovery';
        shell.dataset.recoveryState = 'restored';
        // The upstream VM manager clears projectChanged with a zero-delay timer
        // after the canonical server project first loads. Re-arm recovery dirty
        // state on the following task so ProjectSaverHOC observes false -> true.
        await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
        if (disposed) return;
        vm.emit('PROJECT_CHANGED');
        reportReady();
      } catch {
        try {
          await vm.loadProject(canonicalProjectJson);
        } catch {
          // The canonical project had already loaded successfully; recovery remains best-effort.
        }
        if (disposed) return;
        loaded = true;
        shell.dataset.recoveryState = 'restore_failed';
        reportReady();
      }
    };

    const start = async () => {
      try {
        if (
          session.mode === 'editor' &&
          recoveryApi &&
          typeof bootstrap.recoveryPrincipalKey === 'string'
        ) {
          try {
            recoveryStore = recoveryApi.createRecoveryStore();
            if (recoveryStore) {
              const selection = await recoveryApi.selectRecovery({
                store: recoveryStore,
                principalKey: bootstrap.recoveryPrincipalKey,
                projectId: session.projectId,
                serverRevision: bootstrap.draftRevision,
                serverProjectJson: bootstrap.projectJson,
              });
              if (selection.kind === 'restore' && selection.record) {
                recoveredRecord = selection.record;
                shell.dataset.recoveryState = 'restore-pending';
              } else if (selection.kind === 'conflict') {
                recoveryConflict = true;
                shell.dataset.recoveryState = 'recovery_conflict';
              } else {
                shell.dataset.recoveryState = selection.kind;
              }
            } else {
              shell.dataset.recoveryState = 'unavailable';
            }
          } catch {
            recoveryStore = null;
            shell.dataset.recoveryState = 'unavailable';
          }
        }

        storage = createStorage();
        if (
          recoveredRecord &&
          !storage.canRecoverProject(recoveredRecord.projectJson, recoveredRecord.assets ?? [])
        ) {
          recoveredRecord = null;
          shell.dataset.recoveryState = 'media_recovery_required';
        }
        if (recoveryStore && !recoveryConflict && recoveryApi) {
          recoveryController = recoveryApi.createRecoveryController({
            store: recoveryStore,
            principalKey: bootstrap.recoveryPrincipalKey,
            projectId: session.projectId,
            getBaseRevision: () => storage?.getConfirmedRevision() ?? bootstrap.draftRevision,
            captureRecoverySnapshot: async () => {
              if (!vm || typeof vm.toJSON !== 'function' || !Array.isArray(vm.assets)) {
                throw failure('recovery_vm_unavailable');
              }
              const projectJson = JSON.parse(vm.toJSON());
              const assets = await storage.captureRecoveryAssets(projectJson, vm.assets);
              return { projectJson, assets };
            },
            onState: ({ state: recoveryState }) => {
              if (!disposed) shell.dataset.recoveryState = recoveryState;
            },
          });
        }
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
          canCreateNew: session.mode === 'editor',
          showSaveNow: false,
          autoSaveIntervalSecs,
          logo: '/asa-lab-scratch-wordmark.svg',
          onSetProjectSaver(projectSaver) {
            upstreamProjectSaver = typeof projectSaver === 'function' ? projectSaver : null;
          },
          onUpdateProjectThumbnail(projectId, imageBlob) {
            const sourceRevision = storage.getConfirmedRevision();
            if (
              disposed ||
              String(projectId ?? '') !== String(session.projectId) ||
              storage.getDurableProjectGeneration() < projectGeneration ||
              !Number.isSafeInteger(sourceRevision) ||
              sourceRevision < 1
            ) {
              return;
            }
            void prepareThumbnailDataUrl(imageBlob)
              .then((imageDataUrl) => {
                if (!disposed && imageDataUrl) onThumbnailReady?.(sourceRevision, imageDataUrl);
              })
              .catch(() => undefined);
          },
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
            if (initialProjectLoadedHandled) return;
            initialProjectLoadedHandled = true;
            void restoreRecoveredProject();
          },
        });
      } catch (error) {
        if (disposed) return;
        dispose();
        throw error;
      }
    };

    const waitForUpstreamSaveable = () =>
      new Promise((resolve) => {
        const currentStore = state?.store;
        if (!currentStore || typeof currentStore.subscribe !== 'function') {
          resolve(false);
          return;
        }
        let unsubscribe = null;
        const check = () => {
          if (disposed) {
            unsubscribe?.();
            resolve(false);
            return;
          }
          if (storage.getDurableProjectGeneration() >= projectGeneration) {
            unsubscribe?.();
            resolve(true);
            return;
          }
          const gui = currentStore.getState()?.scratchGui;
          if (
            gui?.projectChanged === true &&
            gui?.projectState?.loadingState === 'SHOWING_WITH_ID'
          ) {
            unsubscribe?.();
            resolve(true);
          }
        };
        unsubscribe = currentStore.subscribe(check);
        check();
      });

    const waitForUpstreamSaverRearmAfter = (afterSequence) => {
      if (upstreamSaverRearmSequence > afterSequence) return Promise.resolve(true);
      if (disposed) return Promise.resolve(false);
      return new Promise((resolve) => {
        upstreamSaverRearmWaiters.add({ afterSequence, resolve });
      });
    };

    const saveBeforeExit = () => {
      if (saveBeforeExitPromise) return saveBeforeExitPromise;
      saveBeforeExitPromise = (async () => {
        if (disposed || !loaded || !vm || session.mode !== 'editor') {
          return { ok: false, reason: 'editor_not_ready' };
        }
        while (!disposed) {
          if (storage.getDurableProjectGeneration() >= projectGeneration) {
            return {
              ok: true,
              revision: storage.getConfirmedRevision(),
              savedGeneration: storage.getDurableProjectGeneration(),
            };
          }
          if (!(await waitForUpstreamSaveable())) {
            return { ok: false, reason: 'editor_not_ready' };
          }
          if (storage.getDurableProjectGeneration() >= projectGeneration) continue;
          if (typeof upstreamProjectSaver !== 'function') {
            return { ok: false, reason: 'upstream_saver_unavailable' };
          }
          const sequence = storage.getUpstreamSaveSequence();
          const rearmSequence = upstreamSaverRearmSequence;
          upstreamProjectSaver();
          const outcome = await storage.waitForUpstreamSaveAfter(sequence);
          if (!outcome?.ok) {
            return { ok: false, reason: outcome?.reason || 'save_failed' };
          }
          if (Number.isSafeInteger(outcome.revision)) {
            shell.dataset.draftRevision = String(outcome.revision);
          }
          if (
            Number.isSafeInteger(outcome.savedGeneration) &&
            Number.isSafeInteger(outcome.latestGeneration) &&
            outcome.latestGeneration > outcome.savedGeneration &&
            !(await waitForUpstreamSaverRearmAfter(rearmSequence))
          ) {
            return { ok: false, reason: 'editor_not_ready' };
          }
        }
        return { ok: false, reason: 'editor_not_ready' };
      })().finally(() => {
        saveBeforeExitPromise = null;
      });
      return saveBeforeExitPromise;
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
    return { dispose, flush, saveBeforeExit, startup };
  }

  globalThis.AsaBlocksEditor = { mountEditor };
})();
