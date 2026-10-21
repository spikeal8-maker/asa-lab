(() => {
  const recoveryKey = 'asa-vite-preload-recovery';

  const recover = () => {
    const now = Date.now();
    const previousAttempt = Number.parseInt(sessionStorage.getItem(recoveryKey) ?? '0', 10);
    if (Number.isFinite(previousAttempt) && now - previousAttempt < 10_000) return;
    sessionStorage.setItem(recoveryKey, String(now));
    window.location.reload();
  };

  window.addEventListener('vite:preloadError', (event) => {
    const optional = new CustomEvent('asa-optional-preload-error', {
      detail: event.payload,
      cancelable: true,
    });
    if (!window.dispatchEvent(optional)) return;
    event.preventDefault();
    recover();
  });

  // Vite forwards the original Error instance in preloadError.payload, even
  // when WebKit omits the URL. Attribute errors after this particular import
  // settles instead of hiding concurrent failures from other lazy chunks.
  window.asaLoadOptionalChunk = async (load) => {
    const observed = new Set();
    const hold = (event) => {
      observed.add(event.detail);
      event.preventDefault();
    };
    window.addEventListener('asa-optional-preload-error', hold);
    let rejected = false;
    let ownFailure;
    try {
      return await load();
    } catch (error) {
      rejected = true;
      ownFailure = error;
      throw error;
    } finally {
      window.removeEventListener('asa-optional-preload-error', hold);
      if ([...observed].some((error) => !rejected || error !== ownFailure)) recover();
    }
  };
})();
