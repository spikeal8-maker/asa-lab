(() => {
  function createStatusReporter(options) {
    const post = (messageType, payload = {}) => {
      const binding = options.getBinding();
      if (!binding) return false;
      options.parentWindow.postMessage(
        { ...binding, messageType, ...payload },
        options.targetOrigin,
      );
      return true;
    };

    return {
      ready(provenance) {
        return post('ASA_BLOCKS_READY', { provenance });
      },
      status(status) {
        return post('ASA_BLOCKS_STATUS', { status });
      },
      tokenRefreshRequired() {
        return post('ASA_BLOCKS_TOKEN_REFRESH_REQUIRED');
      },
      flushResult(requestId, ok, reason = null, revision = null) {
        return post('ASA_BLOCKS_FLUSH_RESULT', {
          requestId,
          ok,
          reason,
          ...(Number.isSafeInteger(revision) ? { revision } : {}),
        });
      },
      fatal(code) {
        return post('ASA_BLOCKS_FATAL', { code });
      },
    };
  }

  globalThis.AsaBlocksStatus = { createStatusReporter };
})();
