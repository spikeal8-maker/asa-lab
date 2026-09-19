(() => {
  const SCHEMA_VERSION = 1;
  const DB_NAME = 'asa-blocks-recovery';
  const DB_VERSION = 1;
  const STORE_NAME = 'project-recovery';
  const CHECKPOINT_DEBOUNCE_MS = 400;
  const TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

  const normalizedRecord = (value) => {
    if (
      !isRecord(value) ||
      value.schemaVersion !== SCHEMA_VERSION ||
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
    return Object.freeze({
      schemaVersion: SCHEMA_VERSION,
      principalKey: value.principalKey,
      projectId: value.projectId,
      baseRevision: value.baseRevision,
      projectJson: JSON.parse(JSON.stringify(value.projectJson)),
      generation: value.generation,
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
      await requestResult(
        transaction.objectStore(STORE_NAME).put({
          key: recordKey(normalized.principalKey, normalized.projectId),
          ...normalized,
        }),
      );
      await done;
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

    const checkpoint = (generation) =>
      enqueue(async () => {
        if (disposed || !store) return Object.freeze({ ok: false, reason: 'unavailable' });
        let projectJson;
        try {
          projectJson = options.captureProjectJson();
        } catch {
          publishState('capture_failed');
          return Object.freeze({ ok: false, reason: 'capture_failed' });
        }

        let recoverable = false;
        try {
          recoverable = options.canRecoverProject(projectJson) === true;
        } catch {
          recoverable = false;
        }
        if (!recoverable) {
          await store.delete(principalKey, projectId);
          publishState('media_recovery_required', { generation });
          return Object.freeze({ ok: false, reason: 'media_recovery_required' });
        }

        const baseRevision = options.getBaseRevision();
        if (!Number.isSafeInteger(baseRevision) || baseRevision < 0) {
          publishState('base_revision_invalid');
          return Object.freeze({ ok: false, reason: 'base_revision_invalid' });
        }

        const capturedAt = now();
        const record = await store.put({
          schemaVersion: SCHEMA_VERSION,
          principalKey,
          projectId,
          baseRevision,
          projectJson,
          generation,
          capturedAt,
          expiresAt: capturedAt + TTL_MS,
        });
        publishState('checkpointed', { generation, baseRevision });
        return Object.freeze({ ok: true, record });
      });

    const schedule = (generation) => {
      if (disposed || !store || !Number.isSafeInteger(generation) || generation < 1) {
        return;
      }
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
    createRecoveryStore,
    selectRecovery,
    createRecoveryController,
    sameProjectJson,
  });
})();
