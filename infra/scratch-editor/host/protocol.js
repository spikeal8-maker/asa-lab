(() => {
  const PROTOCOL_VERSION = 1;
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const TOKEN_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
  const ASSET_ID_RE = /^[a-f0-9]{32}$/;
  const SHA256_RE = /^[a-f0-9]{64}$/;
  const ASSET_FORMATS = new Set(['svg', 'png', 'jpg', 'wav', 'mp3']);
  const COSTUME_FORMATS = new Set(['svg', 'png', 'jpg']);
  const SOUND_FORMATS = new Set(['wav', 'mp3']);
  const ASSET_KEYS = new Set(['assetId', 'dataFormat', 'sha256', 'sizeBytes']);
  const PARENT_TYPES = new Set([
    'ASA_BLOCKS_INIT',
    'ASA_BLOCKS_TOKEN_UPDATE',
    'ASA_BLOCKS_FLUSH_REQUEST',
    'ASA_BLOCKS_SAVE_BEFORE_EXIT_REQUEST',
    'ASA_BLOCKS_STOP',
  ]);

  const isRecord = (value) => value && typeof value === 'object' && !Array.isArray(value);
  const nonEmptyString = (value) => typeof value === 'string' && value.length > 0;
  const validRuntimeToken = (value) =>
    typeof value === 'string' && value.length <= 4096 && TOKEN_RE.test(value);
  const exactHttpOrigin = (value) => {
    if (typeof value !== 'string') return null;
    try {
      const parsed = new URL(value);
      return ['http:', 'https:'].includes(parsed.protocol) && parsed.origin === value
        ? value
        : null;
    } catch {
      return null;
    }
  };
  const exactKeys = (value, expected) => {
    const keys = Object.keys(value);
    return keys.length === expected.size && keys.every((key) => expected.has(key));
  };
  const validAsset = (value) =>
    isRecord(value) &&
    exactKeys(value, ASSET_KEYS) &&
    ASSET_ID_RE.test(value.assetId ?? '') &&
    ASSET_FORMATS.has(value.dataFormat) &&
    SHA256_RE.test(value.sha256 ?? '') &&
    Number.isSafeInteger(value.sizeBytes) &&
    value.sizeBytes >= 1;

  const mediaKey = (assetId, dataFormat) => `${assetId}.${dataFormat}`;
  function projectAssetKeys(projectJson) {
    if (!isRecord(projectJson)) return null;
    if (
      !Array.isArray(projectJson.targets) ||
      !Array.isArray(projectJson.monitors) ||
      !Array.isArray(projectJson.extensions)
    ) {
      return null;
    }
    const keys = new Set();
    for (const target of projectJson.targets) {
      if (!isRecord(target) || !Array.isArray(target.costumes) || !Array.isArray(target.sounds)) {
        return null;
      }
      for (const costume of target.costumes) {
        if (
          !isRecord(costume) ||
          !ASSET_ID_RE.test(costume.assetId ?? '') ||
          !COSTUME_FORMATS.has(costume.dataFormat) ||
          costume.md5ext !== mediaKey(costume.assetId, costume.dataFormat)
        ) {
          return null;
        }
        keys.add(mediaKey(costume.assetId, costume.dataFormat));
      }
      for (const sound of target.sounds) {
        if (
          !isRecord(sound) ||
          !ASSET_ID_RE.test(sound.assetId ?? '') ||
          !SOUND_FORMATS.has(sound.dataFormat) ||
          sound.md5ext !== mediaKey(sound.assetId, sound.dataFormat)
        ) {
          return null;
        }
        keys.add(mediaKey(sound.assetId, sound.dataFormat));
      }
    }
    return keys;
  }

  function validatedBootstrap(message, expectedParentOrigin) {
    if (!Number.isSafeInteger(message.draftRevision) || message.draftRevision < 0) return null;
    const apiOrigin = exactHttpOrigin(message.apiOrigin);
    if (!apiOrigin || apiOrigin !== expectedParentOrigin) return null;
    if (!Array.isArray(message.assets) || !message.assets.every(validAsset)) return null;

    const assets = [];
    const declared = new Set();
    for (const value of message.assets) {
      const key = mediaKey(value.assetId, value.dataFormat);
      if (declared.has(key)) return null;
      declared.add(key);
      assets.push(
        Object.freeze({
          assetId: value.assetId,
          dataFormat: value.dataFormat,
          sha256: value.sha256,
          sizeBytes: value.sizeBytes,
        }),
      );
    }

    const projectJson = message.projectJson ?? null;
    const hasProjectJson = message.hasProjectJson === true;
    if (hasProjectJson !== (projectJson !== null)) return null;
    if (projectJson === null) {
      if (assets.length !== 0) return null;
    } else {
      const referenced = projectAssetKeys(projectJson);
      if (!referenced) return null;
      for (const key of referenced) {
        if (!declared.has(key)) return null;
      }
    }

    return Object.freeze({
      apiOrigin,
      draftRevision: message.draftRevision,
      projectJson,
      hasProjectJson,
      assets: Object.freeze(assets),
    });
  }

  function createChildProtocol(options) {
    const { parentWindow, expectedParentOrigin } = options;
    let session = null;
    let started = false;
    let stopped = false;

    const reject = (reason) => {
      options.onRejected?.(reason);
      return false;
    };

    const validBinding = (message) =>
      message.protocolVersion === PROTOCOL_VERSION &&
      message.projectId === session?.projectId &&
      message.sessionNonce === session?.sessionNonce;

    const handleInit = (message) => {
      if (session) return reject('duplicate_init');
      if (!UUID_RE.test(message.projectId ?? '')) return reject('project_id');
      if (!nonEmptyString(message.sessionNonce)) return reject('session_nonce');
      if (!validRuntimeToken(message.runtimeToken)) return reject('runtime_token');
      if (message.mode !== 'editor' && message.mode !== 'player') return reject('mode');
      if (message.mode === 'player' && !UUID_RE.test(message.versionId ?? '')) {
        return reject('version_id');
      }
      const bootstrap = validatedBootstrap(message, expectedParentOrigin);
      if (!bootstrap) return reject('bootstrap');

      session = {
        protocolVersion: PROTOCOL_VERSION,
        projectId: message.projectId,
        sessionNonce: message.sessionNonce,
        mode: message.mode,
        versionId: message.versionId ?? null,
        runtimeToken: message.runtimeToken,
      };
      options.onInit?.(
        Object.freeze({
          protocolVersion: session.protocolVersion,
          projectId: session.projectId,
          sessionNonce: session.sessionNonce,
          mode: session.mode,
          versionId: session.versionId,
        }),
        bootstrap,
      );
      return true;
    };

    const handleBoundMessage = (message) => {
      if (!validBinding(message)) return reject('binding');
      if (message.messageType === 'ASA_BLOCKS_TOKEN_UPDATE') {
        if (!validRuntimeToken(message.runtimeToken)) return reject('runtime_token');
        session.runtimeToken = message.runtimeToken;
        options.onTokenUpdate?.();
        return true;
      }
      if (message.messageType === 'ASA_BLOCKS_FLUSH_REQUEST') {
        if (!nonEmptyString(message.requestId)) return reject('request_id');
        options.onFlushRequest?.(message.requestId);
        return true;
      }
      if (message.messageType === 'ASA_BLOCKS_SAVE_BEFORE_EXIT_REQUEST') {
        if (!nonEmptyString(message.requestId)) return reject('request_id');
        options.onSaveBeforeExitRequest?.(message.requestId);
        return true;
      }
      if (message.messageType === 'ASA_BLOCKS_STOP') {
        try {
          options.onStop?.();
          return true;
        } finally {
          session = null;
          stopped = true;
        }
      }
      return reject('message_type');
    };

    const onMessage = (event) => {
      if (event.source !== parentWindow) return reject('source');
      if (event.origin !== expectedParentOrigin) return reject('origin');
      const message = isRecord(event.data) ? event.data : null;
      if (!message || !PARENT_TYPES.has(message.messageType)) return reject('message_type');
      if (message.protocolVersion !== PROTOCOL_VERSION) return reject('protocol_version');
      if (stopped) return reject('stopped');
      if (message.messageType === 'ASA_BLOCKS_INIT') return handleInit(message);
      if (!session) return reject('not_initialized');
      return handleBoundMessage(message);
    };

    return {
      start() {
        if (started) return;
        window.addEventListener('message', onMessage);
        started = true;
      },
      dispose() {
        if (started) {
          window.removeEventListener('message', onMessage);
          started = false;
        }
        session = null;
        stopped = true;
      },
      getBinding() {
        if (!session) return null;
        return {
          protocolVersion: PROTOCOL_VERSION,
          projectId: session.projectId,
          sessionNonce: session.sessionNonce,
        };
      },
      getRuntimeToken() {
        return session?.runtimeToken ?? null;
      },
      isInitialized() {
        return Boolean(session);
      },
    };
  }

  globalThis.AsaBlocksProtocol = {
    PROTOCOL_VERSION,
    createChildProtocol,
  };
})();
