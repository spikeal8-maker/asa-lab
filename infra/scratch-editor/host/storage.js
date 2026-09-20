(() => {
  const unavailable = (code = 'runtime_asset_unavailable') =>
    Object.assign(new Error(code), { code });
  const formatsByType = {
    ImageVector: ['svg'],
    ImageBitmap: ['png', 'jpg', 'jpeg'],
    Sound: ['wav', 'mp3'],
  };
  const mediaTypes = {
    svg: ['image/svg+xml'],
    png: ['image/png'],
    jpg: ['image/jpeg'],
    jpeg: ['image/jpeg'],
    wav: ['audio/wav', 'audio/x-wav', 'audio/wave'],
    mp3: ['audio/mpeg'],
  };
  const canonicalMediaType = {
    svg: 'image/svg+xml',
    png: 'image/png',
    jpg: 'image/jpeg',
    wav: 'audio/wav',
    mp3: 'audio/mpeg',
  };
  const ASSET_ID_RE = /^[a-f0-9]{32}$/;
  const SHA256_RE = /^[a-f0-9]{64}$/;
  const RECOVERY_ASSET_TOTAL_LIMIT = 250 * 1024 * 1024;
  const UPSTREAM_ASSET_STORE_CONCURRENCY = 4;
  const PROJECT_OPEN_ASSET_GET_CONCURRENCY = 4;
  const RECOVERY_ASSET_LIMITS = {
    svg: 10 * 1024 * 1024,
    png: 10 * 1024 * 1024,
    jpg: 10 * 1024 * 1024,
    wav: 25 * 1024 * 1024,
    mp3: 25 * 1024 * 1024,
  };
  const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const validLibraryAsset = (id, format) =>
    typeof id === 'string' &&
    ASSET_ID_RE.test(id) &&
    typeof format === 'string' &&
    Object.hasOwn(mediaTypes, format);

  const runtimeKey = (id, format) => `${id}.${format}`;
  const exactBytes = (data) => {
    if (data instanceof Uint8Array) return Uint8Array.from(data);
    if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0));
    if (ArrayBuffer.isView(data) && data.BYTES_PER_ELEMENT === 1) {
      return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
    }
    return null;
  };
  const sameReference = (a, b) =>
    a?.assetId === b?.assetId &&
    a?.dataFormat === b?.dataFormat &&
    a?.sha256 === b?.sha256 &&
    a?.sizeBytes === b?.sizeBytes;
  const compareReference = (a, b) =>
    a.assetId === b.assetId
      ? a.dataFormat.localeCompare(b.dataFormat)
      : a.assetId.localeCompare(b.assetId);

  const canonicalJson = (value) => {
    if (value === null) return 'null';
    if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw unavailable('canonical_document_invalid');
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    if (typeof value !== 'object') throw unavailable('canonical_document_invalid');
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  };

  const referencedProjectAssets = (projectJson) => {
    if (!projectJson || typeof projectJson !== 'object' || !Array.isArray(projectJson.targets)) {
      throw unavailable('project_document_invalid');
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
        throw unavailable('project_document_invalid');
      }
      for (const item of [...target.costumes, ...target.sounds]) {
        const assetId = item?.assetId;
        const dataFormat = item?.dataFormat;
        if (
          !ASSET_ID_RE.test(assetId ?? '') ||
          !Object.hasOwn(canonicalMediaType, dataFormat ?? '')
        ) {
          throw unavailable('project_document_invalid');
        }
        const key = runtimeKey(assetId, dataFormat);
        if (!seen.has(key)) {
          seen.add(key);
          references.push({ assetId, dataFormat });
        }
      }
    }
    return references;
  };

  function createReadOnlyStorage(standalone, options = {}) {
    const scratchStorage = new standalone.ScratchStorage();
    const newProject = options.projectJson === null || typeof options.projectJson === 'undefined';
    const cachedAssets = new Map();
    const recoveryAssets = new Map();
    const verifiedRuntimeAssets = new Map();
    let confirmedAssets = new Map(
      (options.assets ?? []).map((asset) => [runtimeKey(asset.assetId, asset.dataFormat), asset]),
    );
    let confirmedRevision =
      Number.isSafeInteger(options.draftRevision) && options.draftRevision >= 0
        ? options.draftRevision
        : 0;
    const durableAssets = new Map(confirmedAssets);
    let confirmedFingerprint = options.projectJson === null ? null : undefined;
    let unresolvedMutation = null;
    let upstreamSaveGeneration = null;
    const upstreamAssetStoreQueue = [];
    let activeUpstreamAssetStores = 0;
    let durableProjectGeneration = 0;
    let upstreamSaveSequence = 0;
    let latestUpstreamSaveOutcome = null;
    const upstreamSaveWaiters = new Set();
    const abortController = typeof AbortController === 'undefined' ? null : new AbortController();
    let disposed = false;

    const key = (type, id, format) => `${type.name}:${id}:${format}`;
    const cache = (type, format, data, id, target = cachedAssets) => {
      const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
      const asset = scratchStorage.createAsset(type, format, bytes, String(id), false);
      target.set(key(type, id, format), asset);
      return asset;
    };

    const defaults = standalone.buildDefaultProject();
    const defaultMediaAssets = [];
    for (const asset of defaults) {
      if (asset.assetType !== 'Project') {
        const cached = cache(
          scratchStorage.AssetType[asset.assetType],
          scratchStorage.DataFormat[asset.dataFormat],
          asset.data,
          asset.id,
        );
        defaultMediaAssets.push(cached);
        if (newProject) cached.clean = false;
      }
    }

    const original = defaults.find((asset) => asset.assetType === 'Project');
    if (!original) throw new Error('default_project_unavailable');
    cache(scratchStorage.AssetType.Project, scratchStorage.DataFormat.JSON, original.data, '0');
    if (newProject) {
      cache(
        scratchStorage.AssetType.Project,
        scratchStorage.DataFormat.JSON,
        original.data,
        options.projectId,
      );
    } else {
      cache(
        scratchStorage.AssetType.Project,
        scratchStorage.DataFormat.JSON,
        JSON.stringify(options.projectJson),
        options.projectId,
      );
    }

    const typeForFormat = (format) => {
      if (format === 'svg') return scratchStorage.AssetType.ImageVector;
      if (format === 'png' || format === 'jpg') return scratchStorage.AssetType.ImageBitmap;
      if (format === 'wav' || format === 'mp3') return scratchStorage.AssetType.Sound;
      return null;
    };

    const validTypeAndFormat = (type, format) =>
      Object.hasOwn(formatsByType, type?.name) &&
      scratchStorage.AssetType[type.name] === type &&
      formatsByType[type.name].includes(format);

    const sha256 = async (bytes) => {
      if (!globalThis.crypto?.subtle) throw unavailable('runtime_crypto_unavailable');
      const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
      return [...digest].map((value) => value.toString(16).padStart(2, '0')).join('');
    };

    const canonicalReferences = (references) =>
      [...references]
        .map((reference) => ({
          assetId: reference.assetId,
          dataFormat: reference.dataFormat,
          sha256: reference.sha256,
          sizeBytes: reference.sizeBytes,
        }))
        .sort(compareReference);

    const documentFingerprint = async (projectJson, references) => {
      const document = {
        schemaVersion: 1,
        format: 'scratch-3',
        projectJson,
        assets: canonicalReferences(references),
      };
      return sha256(new TextEncoder().encode(canonicalJson(document)));
    };

    const ensureConfirmedFingerprint = async () => {
      if (typeof confirmedFingerprint !== 'undefined') return confirmedFingerprint;
      confirmedFingerprint = await documentFingerprint(
        options.projectJson,
        confirmedAssets.values(),
      );
      return confirmedFingerprint;
    };

    const getToken = () => {
      const token = options.getRuntimeToken?.();
      if (typeof token !== 'string' || token.length === 0) {
        throw unavailable('runtime_token_unavailable');
      }
      return token;
    };

    const saveFailureReason = (error) =>
      typeof error?.code === 'string' && error.code.length > 0 ? error.code : 'save_failed';
    const publishUpstreamSaveOutcome = (outcome) => {
      upstreamSaveSequence += 1;
      latestUpstreamSaveOutcome = Object.freeze({ sequence: upstreamSaveSequence, ...outcome });
      for (const waiter of [...upstreamSaveWaiters]) {
        if (latestUpstreamSaveOutcome.sequence > waiter.afterSequence) {
          upstreamSaveWaiters.delete(waiter);
          waiter.resolve(latestUpstreamSaveOutcome);
        }
      }
      return latestUpstreamSaveOutcome;
    };
    const waitForUpstreamSaveAfter = (afterSequence) => {
      if (latestUpstreamSaveOutcome?.sequence > afterSequence) {
        return Promise.resolve(latestUpstreamSaveOutcome);
      }
      if (disposed) {
        return Promise.resolve({
          sequence: upstreamSaveSequence,
          ok: false,
          reason: 'storage_disposed',
        });
      }
      return new Promise((resolve) => {
        upstreamSaveWaiters.add({ afterSequence, resolve });
      });
    };

    const webStoreRequest = (asset) => {
      if (
        disposed ||
        options.canSave === false ||
        !asset ||
        !validTypeAndFormat(asset.assetType, asset.dataFormat) ||
        !ASSET_ID_RE.test(String(asset.assetId ?? '')) ||
        !Object.hasOwn(canonicalMediaType, asset.dataFormat)
      ) {
        throw unavailable('asset_write_failed');
      }
      return {
        url: `${options.apiOrigin}/api/blocks/runtime/projects/${options.projectId}/assets/${asset.assetId}.${asset.dataFormat}`,
        method: 'PUT',
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${getToken()}`,
          'content-type': canonicalMediaType[asset.dataFormat],
        },
      };
    };

    scratchStorage.addWebStore(
      [
        scratchStorage.AssetType.ImageVector,
        scratchStorage.AssetType.ImageBitmap,
        scratchStorage.AssetType.Sound,
      ],
      () => null,
      webStoreRequest,
      webStoreRequest,
    );

    const upstreamStore = scratchStorage.store.bind(scratchStorage);
    const drainUpstreamAssetStoreQueue = () => {
      while (
        activeUpstreamAssetStores < UPSTREAM_ASSET_STORE_CONCURRENCY &&
        upstreamAssetStoreQueue.length > 0
      ) {
        const queued = upstreamAssetStoreQueue.shift();
        activeUpstreamAssetStores += 1;
        Promise.resolve()
          .then(queued.operation)
          .then(
            (value) => {
              activeUpstreamAssetStores -= 1;
              queued.resolve(value);
              drainUpstreamAssetStoreQueue();
            },
            (error) => {
              activeUpstreamAssetStores -= 1;
              queued.reject(error);
              drainUpstreamAssetStoreQueue();
            },
          );
      }
    };
    const enqueueUpstreamAssetStore = (operation) =>
      new Promise((resolve, reject) => {
        upstreamAssetStoreQueue.push({ operation, resolve, reject });
        drainUpstreamAssetStoreQueue();
      });
    scratchStorage.store = async (assetType, dataFormat, data, assetId) => {
      const format = dataFormat || assetType?.runtimeFormat;
      if (
        !validTypeAndFormat(assetType, format) ||
        !ASSET_ID_RE.test(String(assetId ?? '')) ||
        !ArrayBuffer.isView(data) ||
        data.BYTES_PER_ELEMENT !== 1 ||
        data.byteLength < 1
      ) {
        throw unavailable('asset_write_failed');
      }
      const generation = options.getProjectGeneration?.();
      if (upstreamSaveGeneration === null && Number.isSafeInteger(generation)) {
        upstreamSaveGeneration = generation;
      }
      try {
        const response = await enqueueUpstreamAssetStore(() =>
          upstreamStore(assetType, format, data, assetId),
        );
        const expected = {
          assetId: String(assetId),
          dataFormat: format,
          sha256: await sha256(data),
          sizeBytes: data.byteLength,
        };
        if (
          !response ||
          typeof response !== 'object' ||
          response.status !== 'ok' ||
          !sameReference(response.asset, expected)
        ) {
          throw unavailable('asset_reference_mismatch');
        }
        durableAssets.set(
          runtimeKey(expected.assetId, expected.dataFormat),
          Object.freeze({ ...expected }),
        );
        return response;
      } catch (error) {
        const failedGeneration = upstreamSaveGeneration;
        upstreamSaveGeneration = null;
        if (Number.isSafeInteger(failedGeneration)) {
          publishUpstreamSaveOutcome({
            ok: false,
            reason: saveFailureReason(error),
            savedGeneration: failedGeneration,
            latestGeneration: options.getProjectGeneration?.(),
          });
        }
        throw error;
      }
    };

    const loadRuntimeAsset = async (reference, type, format) => {
      if (disposed || !validTypeAndFormat(type, format)) throw unavailable();
      const existing = verifiedRuntimeAssets.get(key(type, reference.assetId, format));
      if (existing) return existing;

      const response = await fetch(
        `${options.apiOrigin}/api/blocks/runtime/projects/${options.projectId}/assets/${reference.assetId}.${reference.dataFormat}`,
        {
          method: 'GET',
          credentials: 'omit',
          redirect: 'error',
          cache: 'no-store',
          headers: {
            accept: mediaTypes[reference.dataFormat][0],
            authorization: `Bearer ${getToken()}`,
          },
          ...(abortController ? { signal: abortController.signal } : {}),
        },
      );
      if (!response.ok || response.redirected) throw unavailable();

      const contentType = response.headers.get('content-type')?.split(';')[0].trim();
      if (!mediaTypes[reference.dataFormat].includes(contentType)) throw unavailable();

      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength !== reference.sizeBytes) throw unavailable();
      if ((await sha256(bytes)) !== reference.sha256) throw unavailable();

      return cache(type, format, bytes, reference.assetId, verifiedRuntimeAssets);
    };

    const createDraftMutation = (fingerprint, document, references) => {
      const mutationId = globalThis.crypto?.randomUUID?.();
      if (typeof mutationId !== 'string' || !UUID_V4_RE.test(mutationId)) {
        throw unavailable('mutation_id_unavailable');
      }
      const baseRevision = confirmedRevision;
      const stableDocument = JSON.parse(JSON.stringify(document));
      const stableReferences = Object.freeze(
        references.map((reference) => Object.freeze({ ...reference })),
      );
      return Object.freeze({
        fingerprint,
        baseRevision,
        mutationId,
        document: stableDocument,
        references: stableReferences,
        body: JSON.stringify({
          document: stableDocument,
          baseRevision,
          mutationId,
        }),
      });
    };

    const sendDraftMutation = async (mutation, reconciliation) => {
      let response;
      try {
        response = await fetch(
          `${options.apiOrigin}/api/blocks/runtime/projects/${options.projectId}/draft`,
          {
            method: 'PUT',
            credentials: 'omit',
            redirect: 'error',
            cache: 'no-store',
            headers: {
              accept: 'application/json',
              authorization: `Bearer ${getToken()}`,
              'content-type': 'application/vnd.asa.blocks-draft+json',
            },
            body: mutation.body,
            ...(abortController ? { signal: abortController.signal } : {}),
          },
        );
      } catch {
        throw unavailable('draft_write_failed');
      }

      if (!response.ok || response.redirected) {
        if (response.status === 409) {
          let payload = null;
          try {
            payload = await response.json();
          } catch {
            payload = null;
          }
          unresolvedMutation = null;
          if (payload?.error?.code === 'project_revision_conflict') {
            throw unavailable('revision_conflict');
          }
          throw unavailable('draft_write_failed');
        }
        if (response.status < 500 && !reconciliation) unresolvedMutation = null;
        throw unavailable('draft_write_failed');
      }

      let payload;
      try {
        payload = await response.json();
      } catch {
        throw unavailable('draft_write_failed');
      }
      if (
        payload?.status !== 'ok' ||
        !Number.isSafeInteger(payload.revision) ||
        payload.revision <= mutation.baseRevision
      ) {
        throw unavailable('draft_revision_invalid');
      }
      return payload.revision;
    };

    const confirmDraftMutation = (mutation, revision) => {
      confirmedRevision = revision;
      confirmedFingerprint = mutation.fingerprint;
      confirmedAssets = new Map(
        mutation.references.map((reference) => [
          runtimeKey(reference.assetId, reference.dataFormat),
          Object.freeze({ ...reference }),
        ]),
      );
      unresolvedMutation = null;
      return revision;
    };

    const reconcileUnresolvedMutation = async () => {
      const mutation = unresolvedMutation;
      if (!mutation) return;
      const revision = await sendDraftMutation(mutation, true);
      confirmDraftMutation(mutation, revision);
    };

    const persistCanonicalDocument = async (projectJson, references) => {
      await ensureConfirmedFingerprint();
      const canonical = canonicalReferences(references);
      const fingerprint = await documentFingerprint(projectJson, canonical);

      if (unresolvedMutation) {
        await reconcileUnresolvedMutation();
      }
      if (confirmedFingerprint !== null && fingerprint === confirmedFingerprint) {
        return confirmedRevision;
      }

      const document = {
        schemaVersion: 1,
        format: 'scratch-3',
        projectJson,
        assets: canonical,
      };
      const mutation = createDraftMutation(fingerprint, document, canonical);
      unresolvedMutation = mutation;
      const revision = await sendDraftMutation(mutation, false);
      return confirmDraftMutation(mutation, revision);
    };

    const validateRecoveryAsset = async (asset) => {
      if (
        !asset ||
        !ASSET_ID_RE.test(asset.assetId ?? '') ||
        !Object.hasOwn(RECOVERY_ASSET_LIMITS, asset.dataFormat ?? '') ||
        !SHA256_RE.test(asset.sha256 ?? '') ||
        !Number.isSafeInteger(asset.sizeBytes) ||
        asset.sizeBytes < 1 ||
        asset.sizeBytes > RECOVERY_ASSET_LIMITS[asset.dataFormat]
      ) {
        throw unavailable('recovery_asset_invalid');
      }
      const bytes = exactBytes(asset.bytes);
      if (!bytes || bytes.byteLength !== asset.sizeBytes) {
        throw unavailable('recovery_asset_invalid');
      }
      if ((await sha256(bytes)) !== asset.sha256) {
        throw unavailable('recovery_asset_invalid');
      }
      return {
        assetId: asset.assetId,
        dataFormat: asset.dataFormat,
        sha256: asset.sha256,
        sizeBytes: asset.sizeBytes,
        bytes,
      };
    };

    const captureRecoveryAssets = async (projectJson, liveAssets) => {
      if (!Array.isArray(liveAssets)) throw unavailable('recovery_vm_assets_unavailable');
      const liveByKey = new Map();
      for (const asset of liveAssets) {
        if (
          asset &&
          ASSET_ID_RE.test(String(asset.assetId ?? '')) &&
          Object.hasOwn(canonicalMediaType, asset.dataFormat ?? '')
        ) {
          liveByKey.set(runtimeKey(asset.assetId, asset.dataFormat), asset);
        }
      }

      const captured = [];
      let totalBytes = 0;
      for (const reference of referencedProjectAssets(projectJson)) {
        const referenceKey = runtimeKey(reference.assetId, reference.dataFormat);
        if (confirmedAssets.has(referenceKey)) continue;

        const live = liveByKey.get(referenceKey);
        if (
          !live ||
          !validTypeAndFormat(live.assetType, reference.dataFormat) ||
          String(live.assetId) !== reference.assetId
        ) {
          throw unavailable('media_recovery_required');
        }
        const bytes = exactBytes(live.data);
        const limit = RECOVERY_ASSET_LIMITS[reference.dataFormat];
        if (!bytes || bytes.byteLength < 1 || bytes.byteLength > limit) {
          throw unavailable('media_recovery_required');
        }
        totalBytes += bytes.byteLength;
        if (!Number.isSafeInteger(totalBytes) || totalBytes > RECOVERY_ASSET_TOTAL_LIMIT) {
          throw unavailable('recovery_quota_exceeded');
        }
        captured.push(
          Object.freeze({
            assetId: reference.assetId,
            dataFormat: reference.dataFormat,
            sha256: await sha256(bytes),
            sizeBytes: bytes.byteLength,
            bytes,
          }),
        );
      }
      return Object.freeze(captured);
    };

    const installRecoveryAssets = async (assets) => {
      if (!Array.isArray(assets)) throw unavailable('recovery_asset_invalid');
      const staged = [];
      const seen = new Set();
      let totalBytes = 0;

      for (const candidate of assets) {
        const asset = await validateRecoveryAsset(candidate);
        const assetKey = runtimeKey(asset.assetId, asset.dataFormat);
        if (seen.has(assetKey)) throw unavailable('recovery_asset_invalid');
        seen.add(assetKey);
        totalBytes += asset.sizeBytes;
        if (!Number.isSafeInteger(totalBytes) || totalBytes > RECOVERY_ASSET_TOTAL_LIMIT) {
          throw unavailable('recovery_quota_exceeded');
        }

        const confirmed = confirmedAssets.get(assetKey);
        if (confirmed) {
          if (!sameReference(confirmed, asset)) {
            throw unavailable('recovery_asset_conflicts_confirmed');
          }
          continue;
        }
        const type = typeForFormat(asset.dataFormat);
        if (!type) throw unavailable('recovery_asset_invalid');
        staged.push({ asset, type });
      }

      recoveryAssets.clear();
      for (const { asset, type } of staged) {
        const cached = cache(type, asset.dataFormat, asset.bytes, asset.assetId, recoveryAssets);
        cached.clean = false;
      }
      return staged.length;
    };

    scratchStorage.addHelper(
      {
        load: async (type, id, format) => {
          if (type === scratchStorage.AssetType.Project) {
            if (String(id ?? '') === '0') {
              for (const asset of defaultMediaAssets) asset.clean = false;
            }
            return cachedAssets.get(key(type, id, format)) ?? null;
          }

          const declared = confirmedAssets.get(runtimeKey(id, format));
          if (declared) {
            try {
              return await loadRuntimeAsset(declared, type, format);
            } catch {
              return null;
            }
          }

          const recovered = recoveryAssets.get(key(type, id, format));
          if (recovered) return recovered;

          const cached = cachedAssets.get(key(type, id, format));
          if (cached) {
            if (!confirmedAssets.has(runtimeKey(id, format))) cached.clean = false;
            return cached;
          }
          if (!validLibraryAsset(id, format) || !validTypeAndFormat(type, format)) return null;
          try {
            const response = await fetch(`/library-assets/${id}.${format}`, {
              credentials: 'omit',
              redirect: 'error',
            });
            if (!response.ok || response.redirected) return null;
            const contentType = response.headers.get('content-type')?.split(';')[0].trim();
            if (!mediaTypes[format].includes(contentType)) return null;
            const bytes = new Uint8Array(await response.arrayBuffer());
            const asset = cache(type, format, bytes, id);
            asset.clean = false;
            return asset;
          } catch {
            return null;
          }
        },
      },
      200,
    );

    return {
      scratchStorage,
      async prepareProjectAssets() {
        if (options.projectJson === null || typeof options.projectJson === 'undefined') return;
        const references = confirmedAssets.values();
        const loadNextConfirmedAsset = async () => {
          for (let next = references.next(); !next.done; next = references.next()) {
            const reference = next.value;
            const type = typeForFormat(reference.dataFormat);
            if (!type) throw unavailable();
            await loadRuntimeAsset(reference, type, reference.dataFormat);
          }
        };
        const workers = Array.from(
          { length: Math.min(PROJECT_OPEN_ASSET_GET_CONCURRENCY, confirmedAssets.size) },
          () => loadNextConfirmedAsset(),
        );
        await Promise.all(workers);
        await ensureConfirmedFingerprint();
      },
      getConfirmedRevision() {
        return confirmedRevision;
      },
      async captureRecoveryAssets(projectJson, liveAssets) {
        return captureRecoveryAssets(projectJson, liveAssets);
      },
      async installRecoveryAssets(assets) {
        return installRecoveryAssets(assets);
      },
      canRecoverProject(projectJson, assets = []) {
        try {
          const local = new Set(
            assets
              .filter(
                (asset) =>
                  asset &&
                  ASSET_ID_RE.test(asset.assetId ?? '') &&
                  Object.hasOwn(canonicalMediaType, asset.dataFormat ?? ''),
              )
              .map((asset) => runtimeKey(asset.assetId, asset.dataFormat)),
          );
          return referencedProjectAssets(projectJson).every((reference) => {
            const referenceKey = runtimeKey(reference.assetId, reference.dataFormat);
            return confirmedAssets.has(referenceKey) || local.has(referenceKey);
          });
        } catch {
          return false;
        }
      },
      getDurableProjectGeneration() {
        return durableProjectGeneration;
      },
      getUpstreamSaveSequence() {
        return upstreamSaveSequence;
      },
      waitForUpstreamSaveAfter,
      async saveProject(projectId, vmState) {
        if (disposed) throw unavailable('storage_disposed');
        if (options.canSave === false) throw unavailable('runtime_storage_read_only');
        const isManagedReset = projectId === null || typeof projectId === 'undefined';
        if (!isManagedReset && String(projectId) !== String(options.projectId ?? '')) {
          throw unavailable('project_identity_mismatch');
        }
        if (typeof vmState !== 'string') throw unavailable('project_document_invalid');

        let projectJson;
        try {
          projectJson = JSON.parse(vmState);
        } catch {
          throw unavailable('project_document_invalid');
        }

        const currentGeneration = options.getProjectGeneration?.();
        const generationAtStart = Number.isSafeInteger(upstreamSaveGeneration)
          ? upstreamSaveGeneration
          : currentGeneration;
        try {
          const references = referencedProjectAssets(projectJson).map((reference) => {
            const durable = durableAssets.get(runtimeKey(reference.assetId, reference.dataFormat));
            if (!durable) throw unavailable('asset_reference_missing');
            return durable;
          });
          const revision = await persistCanonicalDocument(projectJson, references);
          const generationAtEnd = options.getProjectGeneration?.();
          if (Number.isSafeInteger(generationAtStart)) {
            durableProjectGeneration = Math.max(durableProjectGeneration, generationAtStart);
          }
          const savedGeneration = Number.isSafeInteger(generationAtStart)
            ? generationAtStart
            : durableProjectGeneration;
          publishUpstreamSaveOutcome({
            ok: true,
            revision,
            savedGeneration,
            latestGeneration: Number.isSafeInteger(generationAtEnd)
              ? generationAtEnd
              : durableProjectGeneration,
          });
          try {
            options.onProjectDurable?.({ revision, savedGeneration });
          } catch {
            // Local recovery cleanup must never turn a durable server save into a failure.
          }
          if (
            Number.isSafeInteger(generationAtStart) &&
            Number.isSafeInteger(generationAtEnd) &&
            generationAtEnd > generationAtStart
          ) {
            options.onSaveCompletedStale?.({
              savedGeneration: generationAtStart,
              latestGeneration: generationAtEnd,
              revision,
            });
          }
          return { id: options.projectId };
        } catch (error) {
          publishUpstreamSaveOutcome({
            ok: false,
            reason: saveFailureReason(error),
            savedGeneration: Number.isSafeInteger(generationAtStart) ? generationAtStart : null,
            latestGeneration: options.getProjectGeneration?.(),
          });
          throw error;
        } finally {
          upstreamSaveGeneration = null;
        }
      },
      getLibraryAssetUrl(id, format) {
        if (confirmedAssets.has(runtimeKey(id, format))) {
          const type = typeForFormat(format);
          if (!type) throw unavailable();
          const verified = verifiedRuntimeAssets.get(key(type, id, format));
          if (verified) return verified.encodeDataURI();
          throw unavailable();
        }
        const asset = [...cachedAssets.values()].find(
          (item) =>
            item.assetType !== scratchStorage.AssetType.Project &&
            item.assetId === id &&
            item.dataFormat === format,
        );
        if (asset) return asset.encodeDataURI();
        if (!validLibraryAsset(id, format)) throw unavailable();
        return `/library-assets/${id}.${format}`;
      },
      dispose() {
        disposed = true;
        abortController?.abort();
        unresolvedMutation = null;
        upstreamSaveGeneration = null;
        const outcome = {
          sequence: upstreamSaveSequence,
          ok: false,
          reason: 'storage_disposed',
        };
        for (const waiter of [...upstreamSaveWaiters]) {
          upstreamSaveWaiters.delete(waiter);
          waiter.resolve(outcome);
        }
      },
    };
  }

  globalThis.AsaBlocksStorage = { createReadOnlyStorage };
})();
