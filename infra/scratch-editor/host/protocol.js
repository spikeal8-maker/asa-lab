(() => {
  const PROTOCOL_VERSION = 1;
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const PARENT_TYPES = new Set([
    'ASA_BLOCKS_INIT',
    'ASA_BLOCKS_TOKEN_UPDATE',
    'ASA_BLOCKS_FLUSH_REQUEST',
    'ASA_BLOCKS_STOP',
  ]);

  const isRecord = (value) => value && typeof value === 'object' && !Array.isArray(value);
  const nonEmptyString = (value) => typeof value === 'string' && value.length > 0;

  function createChildProtocol(options) {
    const { parentWindow, expectedParentOrigin } = options;
    let session = null;
    let started = false;

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
      if (!nonEmptyString(message.runtimeToken)) return reject('runtime_token');
      if (message.mode !== 'editor' && message.mode !== 'player') return reject('mode');
      if (message.mode === 'player' && !UUID_RE.test(message.versionId ?? '')) {
        return reject('version_id');
      }

      session = {
        protocolVersion: PROTOCOL_VERSION,
        projectId: message.projectId,
        sessionNonce: message.sessionNonce,
        mode: message.mode,
        versionId: message.versionId ?? null,
        runtimeToken: message.runtimeToken,
      };
      options.onInit?.({ ...session, runtimeToken: undefined });
      return true;
    };

    const handleBoundMessage = (message) => {
      if (!validBinding(message)) return reject('binding');
      if (message.messageType === 'ASA_BLOCKS_TOKEN_UPDATE') {
        if (!nonEmptyString(message.runtimeToken)) return reject('runtime_token');
        session.runtimeToken = message.runtimeToken;
        options.onTokenUpdate?.();
        return true;
      }
      if (message.messageType === 'ASA_BLOCKS_FLUSH_REQUEST') {
        if (!nonEmptyString(message.requestId)) return reject('request_id');
        options.onFlushRequest?.(message.requestId);
        return true;
      }
      if (message.messageType === 'ASA_BLOCKS_STOP') {
        options.onStop?.();
        return true;
      }
      return reject('message_type');
    };

    const onMessage = (event) => {
      if (event.source !== parentWindow) return reject('source');
      if (event.origin !== expectedParentOrigin) return reject('origin');
      const message = isRecord(event.data) ? event.data : null;
      if (!message || !PARENT_TYPES.has(message.messageType)) return reject('message_type');
      if (message.protocolVersion !== PROTOCOL_VERSION) return reject('protocol_version');
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
        if (!started) return;
        window.removeEventListener('message', onMessage);
        started = false;
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
