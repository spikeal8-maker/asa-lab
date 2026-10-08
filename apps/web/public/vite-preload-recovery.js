(() => {
  const recoveryKey = 'asa-vite-preload-recovery';
  window.addEventListener('vite:preloadError', (event) => {
    const optional = new CustomEvent('asa-optional-preload-error', {
      detail: event.payload,
      cancelable: true,
    });
    if (!window.dispatchEvent(optional)) return;
    event.preventDefault();
    const now = Date.now();
    const previousAttempt = Number.parseInt(sessionStorage.getItem(recoveryKey) ?? '0', 10);
    if (Number.isFinite(previousAttempt) && now - previousAttempt < 10_000) return;
    sessionStorage.setItem(recoveryKey, String(now));
    window.location.reload();
  });
})();
