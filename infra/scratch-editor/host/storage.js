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
  const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const validLibraryAsset = (id, format) =>
    typeof id === 'string' &&
    ASSET_ID_RE.test(id) &&
    typeof format === 'string' &&
    Object.hasOwn(mediaTypes, format);

  const runtimeKey = (id, format) => `${id}.${format}`;
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

  function createReadOnlyStorage(standalone, options = {}) {
    const scratchStorage = new standalone.ScratchStorage();
    const cachedAssets = new Map();
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
    for (const asset of defaults) {
      if (asset.assetType !== 'Project') {
        cache(
          scratchStorage.AssetType[asset.assetType],
          scratchStorage.DataFormat[asset.dataFormat],
          asset.data,
          asset.id,
        );
      }
    }

    const original = defaults.find((asset) => asset.assetType === 'Project');
    if (!original) throw new Error('default_project_unavailable');
    if (options.projectJson === null || typeof options.projectJson === 'undefined') {
      cache(scratchStorage.AssetType.Project, scratchStorage.DataFormat.JSON, original.data, '0');
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

    const uploadSnapshotAsset = async (asset) => {
      const expected = {
        assetId: asset.assetId,
        dataFormat: asset.dataFormat,
        sha256: asset.sha256,
        sizeBytes: asset.sizeBytes,
      };
      let response;
      try {
        response = await fetch(
          `${options.apiOrigin}/api/blocks/runtime/projects/${options.projectId}/assets/${asset.assetId}.${asset.dataFormat}`,
          {
            method: 'PUT',
            credentials: 'omit',
            redirect: 'error',
            cache: 'no-store',
            headers: {
              accept: 'application/json',
              authorization: `Bearer ${getToken()}`,
              'content-type': canonicalMediaType[asset.dataFormat],
            },
            body: asset.bytes,
            ...(abortController ? { signal: abortController.signal } : {}),
          },
        );
      } catch {
        throw unavailable('asset_write_failed');
      }
      if (!response.ok || response.redirected) throw unavailable('asset_write_failed');
      let payload;
      try {
        payload = await response.json();
      } catch {
        throw unavailable('asset_write_failed');
      }
      if (
        payload?.status !== 'ok' ||
        !payload.asset ||
        !sameReference(payload.asset, expected) ||
        !ASSET_ID_RE.test(payload.asset.assetId ?? '') ||
        !SHA256_RE.test(payload.asset.sha256 ?? '')
      ) {
        throw unavailable('asset_reference_mismatch');
      }
      durableAssets.set(
        runtimeKey(expected.assetId, expected.dataFormat),
        Object.freeze({ ...expected }),
      );
      return expected;
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

    scratchStorage.addHelper(
      {
        load: async (type, id, format) => {
          if (type === scratchStorage.AssetType.Project) {
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

          const cached = cachedAssets.get(key(type, id, format));
          if (cached) return cached;
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
            return cache(type, format, bytes, id);
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
        for (const reference of confirmedAssets.values()) {
          const type = typeForFormat(reference.dataFormat);
          if (!type) throw unavailable();
          await loadRuntimeAsset(reference, type, reference.dataFormat);
        }
        await ensureConfirmedFingerprint();
      },
      async persistSnapshot(snapshot) {
        if (disposed) throw unavailable('storage_disposed');
        if (!snapshot || typeof snapshot !== 'object' || !Array.isArray(snapshot.assets)) {
          throw unavailable('snapshot_invalid');
        }
        await ensureConfirmedFingerprint();

        const assets = [];
        for (const asset of snapshot.assets) {
          if (
            !asset ||
            !ASSET_ID_RE.test(asset.assetId ?? '') ||
            !Object.hasOwn(canonicalMediaType, asset.dataFormat) ||
            !SHA256_RE.test(asset.sha256 ?? '') ||
            !Number.isSafeInteger(asset.sizeBytes) ||
            asset.sizeBytes < 1 ||
            !ArrayBuffer.isView(asset.bytes) ||
            asset.bytes.BYTES_PER_ELEMENT !== 1 ||
            asset.bytes.byteLength !== asset.sizeBytes ||
            (await sha256(asset.bytes)) !== asset.sha256
          ) {
            throw unavailable('snapshot_asset_invalid');
          }
          assets.push(asset);
        }

        const references = canonicalReferences(assets);
        const fingerprint = await documentFingerprint(snapshot.projectJson, references);

        if (unresolvedMutation) {
          await reconcileUnresolvedMutation();
        }
        if (confirmedFingerprint !== null && fingerprint === confirmedFingerprint) {
          return confirmedRevision;
        }

        for (const asset of assets) {
          const expected = {
            assetId: asset.assetId,
            dataFormat: asset.dataFormat,
            sha256: asset.sha256,
            sizeBytes: asset.sizeBytes,
          };
          const durable = durableAssets.get(runtimeKey(asset.assetId, asset.dataFormat));
          if (!sameReference(durable, expected)) await uploadSnapshotAsset(asset);
        }

        const document = {
          schemaVersion: 1,
          format: 'scratch-3',
          projectJson: snapshot.projectJson,
          assets: references,
        };
        const mutation = createDraftMutation(fingerprint, document, references);
        unresolvedMutation = mutation;
        const revision = await sendDraftMutation(mutation, false);
        return confirmDraftMutation(mutation, revision);
      },
      getConfirmedRevision() {
        return confirmedRevision;
      },
      async saveProject() {
        throw new Error('runtime_storage_read_only');
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
      },
    };
  }

  globalThis.AsaBlocksStorage = { createReadOnlyStorage };
})();
