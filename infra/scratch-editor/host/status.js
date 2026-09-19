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
      projectDirty(generation) {
        return post('ASA_BLOCKS_STATUS', { status: 'project-dirty', generation });
      },
      tokenRefreshRequired() {
        return post('ASA_BLOCKS_TOKEN_REFRESH_REQUIRED');
      },
      flushResult(requestId, ok, reason = null, revision = null, snapshotGeneration = null) {
        return post('ASA_BLOCKS_FLUSH_RESULT', {
          requestId,
          ok,
          reason,
          ...(Number.isSafeInteger(revision) ? { revision } : {}),
          ...(Number.isSafeInteger(snapshotGeneration) ? { snapshotGeneration } : {}),
        });
      },
      saveBeforeExitResult(requestId, ok, reason = null, revision = null, savedGeneration = null) {
        return post('ASA_BLOCKS_SAVE_BEFORE_EXIT_RESULT', {
          requestId,
          ok,
          reason,
          ...(Number.isSafeInteger(revision) ? { revision } : {}),
          ...(Number.isSafeInteger(savedGeneration) ? { savedGeneration } : {}),
        });
      },
      thumbnailReady(sourceRevision, imageDataUrl) {
        return post('ASA_BLOCKS_THUMBNAIL_READY', { sourceRevision, imageDataUrl });
      },
      fatal(code) {
        return post('ASA_BLOCKS_FATAL', { code });
      },
    };
  }

  globalThis.AsaBlocksStatus = { createStatusReporter };
})();
