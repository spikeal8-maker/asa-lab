(() => {
  const unavailable = () => new Error('runtime_asset_unavailable');
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
  const validLibraryAsset = (id, format) =>
    typeof id === 'string' &&
    /^[a-f0-9]{32}$/.test(id) &&
    typeof format === 'string' &&
    Object.hasOwn(mediaTypes, format);

  const runtimeKey = (id, format) => `${id}.${format}`;

  function createReadOnlyStorage(standalone, options = {}) {
    const scratchStorage = new standalone.ScratchStorage();
    const cachedAssets = new Map();
    const declaredAssets = new Map(
      (options.assets ?? []).map((asset) => [runtimeKey(asset.assetId, asset.dataFormat), asset]),
    );
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
      if (!globalThis.crypto?.subtle) throw unavailable();
      const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
      return [...digest].map((value) => value.toString(16).padStart(2, '0')).join('');
    };

    const loadRuntimeAsset = async (reference, type, format) => {
      if (disposed || !validTypeAndFormat(type, format)) throw unavailable();
      const existing = cachedAssets.get(key(type, reference.assetId, format));
      if (existing) return existing;

      const token = options.getRuntimeToken?.();
      if (typeof token !== 'string' || token.length === 0) throw unavailable();
      const response = await fetch(
        `${options.apiOrigin}/api/blocks/runtime/projects/${options.projectId}/assets/${reference.assetId}.${reference.dataFormat}`,
        {
          method: 'GET',
          credentials: 'omit',
          redirect: 'error',
          cache: 'no-store',
          headers: {
            accept: mediaTypes[reference.dataFormat][0],
            authorization: `Bearer ${token}`,
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

    scratchStorage.addHelper(
      {
        load: async (type, id, format) => {
          const cached = cachedAssets.get(key(type, id, format));
          if (cached) return cached;
          if (type === scratchStorage.AssetType.Project) return null;

          const declared = declaredAssets.get(runtimeKey(id, format));
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
        for (const reference of declaredAssets.values()) {
          const type = typeForFormat(reference.dataFormat);
          if (!type) throw unavailable();
          await loadRuntimeAsset(reference, type, reference.dataFormat);
        }
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
        if (declaredAssets.has(runtimeKey(id, format))) throw unavailable();
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
