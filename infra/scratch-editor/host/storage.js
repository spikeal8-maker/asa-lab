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

  function createReadOnlyStorage(standalone, options = {}) {
    const scratchStorage = new standalone.ScratchStorage();
    const cachedAssets = new Map();
    let confirmedAssets = new Map(
      (options.assets ?? []).map((asset) => [runtimeKey(asset.assetId, asset.dataFormat), asset]),
    );
    let confirmedRevision =
      Number.isSafeInteger(options.draftRevision) && options.draftRevision >= 0
        ? options.draftRevision
        : 0;
    const abortController = typeof AbortController === 'undefined' ? null : new AbortController();
    let disposed = false;

    const key = (type, id, format) => `${type.name}:${id}:${format}`;
    const cache = (type, format, data, id) => {
      const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
      const asset = scratchStorage.createAsset(type, format, bytes, String(id), false);
      cachedAssets.set(key(type, id, format), asset);
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

    const getToken = () => {
      const token = options.getRuntimeToken?.();
      if (typeof token !== 'string' || token.length === 0) {
        throw unavailable('runtime_token_unavailable');
      }
      return token;
    };

    const loadRuntimeAsset = async (reference, type, format) => {
      if (disposed || !validTypeAndFormat(type, format)) throw unavailable();
      const existing = cachedAssets.get(key(type, reference.assetId, format));
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

      return cache(type, format, bytes, reference.assetId);
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
      return expected;
    };

    scratchStorage.addHelper(
      {
        load: async (type, id, format) => {
          const cached = cachedAssets.get(key(type, id, format));
          if (cached) return cached;
          if (type === scratchStorage.AssetType.Project) return null;

          const declared = confirmedAssets.get(runtimeKey(id, format));
          if (declared) {
            try {
              return await loadRuntimeAsset(declared, type, format);
            } catch {
              return null;
            }
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
      },
      async persistSnapshot(snapshot) {
        if (disposed) throw unavailable('storage_disposed');
        if (!snapshot || typeof snapshot !== 'object' || !Array.isArray(snapshot.assets)) {
          throw unavailable('snapshot_invalid');
        }
        const references = [];
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
          const expected = {
            assetId: asset.assetId,
            dataFormat: asset.dataFormat,
            sha256: asset.sha256,
            sizeBytes: asset.sizeBytes,
          };
          const durable = confirmedAssets.get(runtimeKey(asset.assetId, asset.dataFormat));
          references.push(
            sameReference(durable, expected) ? expected : await uploadSnapshotAsset(asset),
          );
        }

        const mutationId = globalThis.crypto?.randomUUID?.();
        if (typeof mutationId !== 'string' || !UUID_V4_RE.test(mutationId)) {
          throw unavailable('mutation_id_unavailable');
        }
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
              body: JSON.stringify({
                document: {
                  schemaVersion: 1,
                  format: 'scratch-3',
                  projectJson: snapshot.projectJson,
                  assets: references,
                },
                baseRevision: confirmedRevision,
                mutationId,
              }),
              ...(abortController ? { signal: abortController.signal } : {}),
            },
          );
        } catch {
          throw unavailable('draft_write_failed');
        }
        if (!response.ok || response.redirected) throw unavailable('draft_write_failed');
        let payload;
        try {
          payload = await response.json();
        } catch {
          throw unavailable('draft_write_failed');
        }
        if (
          payload?.status !== 'ok' ||
          !Number.isSafeInteger(payload.revision) ||
          payload.revision <= confirmedRevision
        ) {
          throw unavailable('draft_revision_invalid');
        }

        confirmedRevision = payload.revision;
        confirmedAssets = new Map(
          references.map((reference) => [
            runtimeKey(reference.assetId, reference.dataFormat),
            Object.freeze({ ...reference }),
          ]),
        );
        return confirmedRevision;
      },
      getConfirmedRevision() {
        return confirmedRevision;
      },
      async saveProject() {
        throw new Error('runtime_storage_read_only');
      },
      getLibraryAssetUrl(id, format) {
        const asset = [...cachedAssets.values()].find(
          (item) =>
            item.assetType !== scratchStorage.AssetType.Project &&
            item.assetId === id &&
            item.dataFormat === format,
        );
        if (asset) return asset.encodeDataURI();
        if (confirmedAssets.has(runtimeKey(id, format))) throw unavailable();
        if (!validLibraryAsset(id, format)) throw unavailable();
        return `/library-assets/${id}.${format}`;
      },
      dispose() {
        disposed = true;
        abortController?.abort();
      },
    };
  }

  globalThis.AsaBlocksStorage = { createReadOnlyStorage };
})();
