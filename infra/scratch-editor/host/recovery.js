(() => {
  const SCHEMA_VERSION = 2;
  const LEGACY_SCHEMA_VERSION = 1;
  const DB_NAME = 'asa-blocks-recovery';
  const DB_VERSION = 1;
  const STORE_NAME = 'project-recovery';
  const CHECKPOINT_DEBOUNCE_MS = 400;
  const TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const RECOVERY_ASSET_TOTAL_LIMIT = 250 * 1024 * 1024;
  const RECOVERY_ASSET_LIMITS = Object.freeze({
    svg: 10 * 1024 * 1024,
    png: 10 * 1024 * 1024,
    jpg: 10 * 1024 * 1024,
    wav: 25 * 1024 * 1024,
    mp3: 25 * 1024 * 1024,
  });
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const ASSET_ID_RE = /^[a-f0-9]{32}$/;
  const SHA256_RE = /^[a-f0-9]{64}$/;

  const isRecord = (value) => value && typeof value === 'object' && !Array.isArray(value);
  const validPrincipalKey = (value) =>
    typeof value === 'string' && value.length >= 1 && value.length <= 256;
  const recordKey = (principalKey, projectId) => `${principalKey}\u0000${projectId}`;

  const canonicalJson = (value) => {
    if (value === null) return 'null';
    if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new Error('recovery_project_invalid');
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    if (typeof value !== 'object') throw new Error('recovery_project_invalid');
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  };

  const sameProjectJson = (left, right) => {
    try {
      return canonicalJson(left) === canonicalJson(right);
    } catch {
      return false;
    }
  };

  const exactBytes = (value) => {
    if (value instanceof Uint8Array) return Uint8Array.from(value);
    if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
    if (ArrayBuffer.isView(value) && value.BYTES_PER_ELEMENT === 1) {
      return new Uint8Array(
        value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength),
      );
    }
    return null;
  };

  const normalizedAssets = (value, schemaVersion) => {
    if (schemaVersion === LEGACY_SCHEMA_VERSION) return Object.freeze([]);
    if (!Array.isArray(value)) return null;

    const assets = [];
    const seen = new Set();
    let totalBytes = 0;
    for (const asset of value) {
      if (
        !isRecord(asset) ||
        !ASSET_ID_RE.test(asset.assetId ?? '') ||
        !Object.hasOwn(RECOVERY_ASSET_LIMITS, asset.dataFormat ?? '') ||
        !SHA256_RE.test(asset.sha256 ?? '') ||
        !Number.isSafeInteger(asset.sizeBytes) ||
        asset.sizeBytes < 1 ||
        asset.sizeBytes > RECOVERY_ASSET_LIMITS[asset.dataFormat]
      ) {
        return null;
      }
      const bytes = exactBytes(asset.bytes);
      if (!bytes || bytes.byteLength !== asset.sizeBytes) return null;
      const key = `${asset.assetId}.${asset.dataFormat}`;
      if (seen.has(key)) return null;
      seen.add(key);
      totalBytes += bytes.byteLength;
      if (!Number.isSafeInteger(totalBytes) || totalBytes > RECOVERY_ASSET_TOTAL_LIMIT) return null;
      assets.push(
        Object.freeze({
          assetId: asset.assetId,
          dataFormat: asset.dataFormat,
          sha256: asset.sha256,
          sizeBytes: asset.sizeBytes,
          bytes,
        }),
      );
    }
    return Object.freeze(assets);
  };

  const normalizedRecord = (value) => {
    const schemaVersion = value?.schemaVersion;
    if (
      !isRecord(value) ||
      ![LEGACY_SCHEMA_VERSION, SCHEMA_VERSION].includes(schemaVersion) ||
      !validPrincipalKey(value.principalKey) ||
      !UUID_RE.test(value.projectId ?? '') ||
      !Number.isSafeInteger(value.baseRevision) ||
      value.baseRevision < 0 ||
      !isRecord(value.projectJson) ||
      !Number.isSafeInteger(value.generation) ||
      value.generation < 1 ||
      !Number.isFinite(value.capturedAt) ||
      !Number.isFinite(value.expiresAt) ||
      value.expiresAt <= value.capturedAt
    ) {
      return null;
    }
    const assets = normalizedAssets(value.assets ?? [], schemaVersion);
    if (!assets) return null;
    return Object.freeze({
      schemaVersion: SCHEMA_VERSION,
      principalKey: value.principalKey,
      projectId: value.projectId,
      baseRevision: value.baseRevision,
      projectJson: JSON.parse(JSON.stringify(value.projectJson)),
      generation: value.generation,
      assets,
      capturedAt: value.capturedAt,
      expiresAt: value.expiresAt,
    });
  };

  const requestResult = (request) =>
    new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error('recovery_indexeddb_request_failed'));
    });

  const transactionDone = (transaction) =>
    new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('recovery_indexeddb_transaction_aborted'));
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('recovery_indexeddb_transaction_failed'));
    });

  function createRecoveryStore(options = {}) {
    const indexedDb = options.indexedDB ?? globalThis.indexedDB;
    const now = options.now ?? (() => Date.now());
    if (!indexedDb || typeof indexedDb.open !== 'function') return null;

    let dbPromise = null;
    const open = () => {
      if (dbPromise) return dbPromise;
      dbPromise = new Promise((resolve, reject) => {
        const request = indexedDb.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains(STORE_NAME)) {
            database.createObjectStore(STORE_NAME, { keyPath: 'key' });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () =>
          reject(request.error ?? new Error('recovery_indexeddb_open_failed'));
        request.onblocked = () => reject(new Error('recovery_indexeddb_blocked'));
      });
      return dbPromise;
    };

    const get = async (principalKey, projectId) => {
      if (!validPrincipalKey(principalKey) || !UUID_RE.test(projectId ?? '')) return null;
      const database = await open();
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const done = transactionDone(transaction);
      const value = await requestResult(
        transaction.objectStore(STORE_NAME).get(recordKey(principalKey, projectId)),
      );
      await done;
      return normalizedRecord(value);
    };

    const put = async (record) => {
      const normalized = normalizedRecord(record);
      if (!normalized) throw new Error('recovery_record_invalid');
      const database = await open();
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const done = transactionDone(transaction);
      let requestError = null;
      try {
        await requestResult(
          transaction.objectStore(STORE_NAME).put({
            key: recordKey(normalized.principalKey, normalized.projectId),
            ...normalized,
          }),
        );
      } catch (error) {
        requestError = error;
      }
      try {
        await done;
      } catch (error) {
        if (!requestError) throw error;
      }
      if (requestError) throw requestError;
      return normalized;
    };

    const remove = async (principalKey, projectId) => {
      if (!validPrincipalKey(principalKey) || !UUID_RE.test(projectId ?? '')) return false;
      const database = await open();
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const done = transactionDone(transaction);
      await requestResult(
        transaction.objectStore(STORE_NAME).delete(recordKey(principalKey, projectId)),
      );
      await done;
      return true;
    };

    const gcExpired = async () => {
      const database = await open();
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const done = transactionDone(transaction);
      const store = transaction.objectStore(STORE_NAME);
      let deleted = 0;
      await new Promise((resolve, reject) => {
        const request = store.openCursor();
        request.onerror = () =>
          reject(request.error ?? new Error('recovery_indexeddb_cursor_failed'));
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) {
            resolve();
            return;
          }
          const record = normalizedRecord(cursor.value);
          if (!record || record.expiresAt <= now()) {
            cursor.delete();
            deleted += 1;
          }
          cursor.continue();
        };
      });
      await done;
      return deleted;
    };

    const close = () => {
      if (!dbPromise) return;
      void dbPromise.then((database) => database.close()).catch(() => undefined);
    };
    return Object.freeze({ get, put, delete: remove, gcExpired, close });
  }

  async function selectRecovery(options) {
    const { store, principalKey, projectId, serverRevision, serverProjectJson } = options;
    const now = options.now ?? (() => Date.now());
    if (!store) return Object.freeze({ kind: 'unavailable', record: null });

    await store.gcExpired();
    const record = await store.get(principalKey, projectId);
    if (!record) return Object.freeze({ kind: 'none', record: null });
    if (record.expiresAt <= now()) {
      await store.delete(principalKey, projectId);
      return Object.freeze({ kind: 'expired', record: null });
    }
    if (sameProjectJson(record.projectJson, serverProjectJson)) {
      await store.delete(principalKey, projectId);
      return Object.freeze({ kind: 'stale', record: null });
    }
    if (record.baseRevision === serverRevision) {
      return Object.freeze({ kind: 'restore', record });
    }
    return Object.freeze({ kind: 'conflict', record });
  }

  function createRecoveryController(options) {
    const { store, principalKey, projectId } = options;
    const now = options.now ?? (() => Date.now());
    const debounceMs = options.debounceMs ?? CHECKPOINT_DEBOUNCE_MS;
    let timer = null;
    let pendingGeneration = null;
    let disposed = false;
    let writeTail = Promise.resolve();

    const publishState = (state, extra = {}) => {
      try {
        options.onState?.(Object.freeze({ state, ...extra }));
      } catch {
        // Recovery status is observational and must never break Scratch.
      }
    };

    const enqueue = (operation) => {
      const scheduled = writeTail.then(operation, operation);
      writeTail = scheduled.then(
        () => undefined,
        () => undefined,
      );
      return scheduled;
    };

    const clearTimer = () => {
      if (timer !== null) {
        globalThis.clearTimeout(timer);
        timer = null;
      }
    };

    const capture = async () => {
      if (typeof options.captureRecoverySnapshot === 'function') {
        return options.captureRecoverySnapshot();
      }
      const projectJson = options.captureProjectJson();
      if (options.canRecoverProject(projectJson) !== true) {
        const error = new Error('media_recovery_required');
        error.code = 'media_recovery_required';
        throw error;
      }
      return { projectJson, assets: [] };
    };

    const checkpoint = (generation) =>
      enqueue(async () => {
        if (disposed || !store) return Object.freeze({ ok: false, reason: 'unavailable' });

        let snapshot;
        try {
          snapshot = await capture();
        } catch (error) {
          const reason = error?.code ?? error?.message;
          if (reason === 'recovery_quota_exceeded') {
            publishState('quota_exceeded', { generation });
            return Object.freeze({ ok: false, reason: 'quota_exceeded' });
          }
          if (reason === 'media_recovery_required') {
            publishState('media_recovery_required', { generation });
            return Object.freeze({ ok: false, reason: 'media_recovery_required' });
          }
          publishState('capture_failed', { generation });
          return Object.freeze({ ok: false, reason: 'capture_failed' });
        }

        const projectJson = snapshot?.projectJson;
        const assets = snapshot?.assets ?? [];
        if (!isRecord(projectJson) || !Array.isArray(assets)) {
          publishState('capture_failed', { generation });
          return Object.freeze({ ok: false, reason: 'capture_failed' });
        }

        const baseRevision = options.getBaseRevision();
        if (!Number.isSafeInteger(baseRevision) || baseRevision < 0) {
          publishState('base_revision_invalid');
          return Object.freeze({ ok: false, reason: 'base_revision_invalid' });
        }

        const capturedAt = now();
        try {
          const record = await store.put({
            schemaVersion: SCHEMA_VERSION,
            principalKey,
            projectId,
            baseRevision,
            projectJson,
            generation,
            assets,
            capturedAt,
            expiresAt: capturedAt + TTL_MS,
          });
          publishState('checkpointed', {
            generation,
            baseRevision,
            assetCount: record.assets.length,
            assetBytes: record.assets.reduce((sum, asset) => sum + asset.sizeBytes, 0),
          });
          return Object.freeze({ ok: true, record });
        } catch (error) {
          if (error?.name === 'QuotaExceededError' || error?.code === 'recovery_quota_exceeded') {
            publishState('quota_exceeded', { generation });
            return Object.freeze({ ok: false, reason: 'quota_exceeded' });
          }
          publishState('checkpoint_failed', { generation });
          return Object.freeze({ ok: false, reason: 'checkpoint_failed' });
        }
      });

    const schedule = (generation) => {
      if (disposed || !store || !Number.isSafeInteger(generation) || generation < 1) return;
      pendingGeneration = generation;
      clearTimer();
      timer = globalThis.setTimeout(() => {
        timer = null;
        const generationToWrite = pendingGeneration;
        pendingGeneration = null;
        if (Number.isSafeInteger(generationToWrite)) {
          void checkpoint(generationToWrite).catch(() => publishState('checkpoint_failed'));
        }
      }, debounceMs);
    };

    const durable = (savedGeneration) => {
      if (!Number.isSafeInteger(savedGeneration) || savedGeneration < 0 || !store) {
        return Promise.resolve(false);
      }
      if (pendingGeneration !== null && savedGeneration >= pendingGeneration) {
        clearTimer();
        pendingGeneration = null;
      }
      return enqueue(async () => {
        const record = await store.get(principalKey, projectId);
        if (!record || savedGeneration < record.generation) return false;
        await store.delete(principalKey, projectId);
        publishState('cleared', { generation: record.generation });
        return true;
      }).catch(() => false);
    };

    const flush = () => {
      if (pendingGeneration !== null) {
        clearTimer();
        const generationToWrite = pendingGeneration;
        pendingGeneration = null;
        return checkpoint(generationToWrite);
      }
      return writeTail;
    };

    const dispose = () => {
      disposed = true;
      clearTimer();
      pendingGeneration = null;
    };

    return Object.freeze({ schedule, durable, flush, dispose });
  }

  globalThis.AsaBlocksRecovery = Object.freeze({
    SCHEMA_VERSION,
    CHECKPOINT_DEBOUNCE_MS,
    TTL_MS,
    RECOVERY_ASSET_TOTAL_LIMIT,
    RECOVERY_ASSET_LIMITS,
    createRecoveryStore,
    selectRecovery,
    createRecoveryController,
    sameProjectJson,
  });
})();
