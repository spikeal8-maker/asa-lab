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

  // In production this script precedes the hashed Vite module in index.html.
  // Read the entry only after parsing completes; otherwise the monitor never starts.
  function beginReleaseMonitor() {
    const entryPattern = /^\/assets\/index-[\w-]+\.js$/;
    const currentEntry = document.querySelector('script[type="module"][src]')?.getAttribute('src');
    if (!entryPattern.test(currentEntry ?? '')) return;

    const checkIntervalMs = 300_000;
    let lastCheck = -checkIntervalMs;
    let checking = false;
    let notice = null;
    let dismissedEntry = '';

    function showUpdateNotice(nextEntry) {
      if (notice || nextEntry === dismissedEntry || !document.body) return;
      notice = document.createElement('aside');
      notice.className = 'asa-release-update';
      notice.setAttribute('role', 'status');
      notice.setAttribute('aria-live', 'polite');

      const message = document.createElement('span');
      message.textContent = 'Доступна новая версия ASA Lab. Сохраните работу перед обновлением.';
      notice.appendChild(message);

      const actions = document.createElement('div');
      actions.className = 'asa-release-update-actions';

      const reload = document.createElement('button');
      reload.type = 'button';
      reload.textContent = 'Обновить';
      reload.addEventListener('click', () => window.location.reload());
      actions.appendChild(reload);

      const later = document.createElement('button');
      later.type = 'button';
      later.textContent = 'Позже';
      later.addEventListener('click', () => {
        dismissedEntry = nextEntry;
        notice?.remove();
        notice = null;
      });
      actions.appendChild(later);
      notice.appendChild(actions);
      document.body.appendChild(notice);
    }

    async function checkRelease() {
      if (document.visibilityState === 'hidden' || checking || notice) return;
      const now = Date.now();
      if (now - lastCheck < checkIntervalMs) return;
      checking = true;
      lastCheck = now;
      try {
        const response = await fetch('/', {
          cache: 'no-store',
          credentials: 'same-origin',
          headers: { Accept: 'text/html' },
        });
        if (!response.ok) return;
        const html = new DOMParser().parseFromString(await response.text(), 'text/html');
        const nextEntry = html.querySelector('script[type="module"][src]')?.getAttribute('src');
        if (entryPattern.test(nextEntry ?? '') && nextEntry !== currentEntry) {
          showUpdateNotice(nextEntry);
        }
      } catch {
        // Offline, failed or non-HTML responses must not interrupt the current work.
      } finally {
        checking = false;
      }
    }

    window.addEventListener('focus', () => void checkRelease());
    document.addEventListener('visibilitychange', () => void checkRelease());
    window.setInterval(() => void checkRelease(), checkIntervalMs);
    void checkRelease();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', beginReleaseMonitor, { once: true });
  } else {
    beginReleaseMonitor();
  }
})();
