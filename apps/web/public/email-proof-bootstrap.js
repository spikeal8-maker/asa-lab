/* global window */
// Runs before runtime configuration, third-party SDKs and diagnostics.
(() => {
  if (window.location.pathname !== '/confirm-email') return;
  let proof = window.location.hash.slice(1);
  window.history.replaceState(null, '', window.location.pathname);
  Object.defineProperty(window, '__asaTakeEmailProof', {
    configurable: true,
    value: () => {
      const value = proof;
      proof = '';
      delete window.__asaTakeEmailProof;
      return value;
    },
  });
})();
