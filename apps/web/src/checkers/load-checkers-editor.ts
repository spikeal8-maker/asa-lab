const CHECKERS_RELOAD_MARKER = 'asa-checkers:lazy-reload';

export function isRecoverableCheckersChunkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|loading chunk .+ failed/i.test(
    message,
  );
}

function reloadCurrentBuildOnce(): Promise<never> {
  const marker = `${__ASA_BUILD_REVISION__}:${window.location.href}`;
  try {
    if (window.sessionStorage.getItem(CHECKERS_RELOAD_MARKER) === marker) {
      return Promise.reject(new Error('Не удалось загрузить обновлённый модуль шашек.'));
    }
    window.sessionStorage.setItem(CHECKERS_RELOAD_MARKER, marker);
  } catch {
    // Storage may be unavailable in a locked-down browser. Reloading once is
    // still safer than leaving a permanently rejected React.lazy boundary.
  }
  window.location.reload();
  return new Promise<never>(() => undefined);
}

export async function loadCheckersEditor() {
  try {
    const module = await import('./CheckersModuleExperience');
    try {
      window.sessionStorage.removeItem(CHECKERS_RELOAD_MARKER);
    } catch {
      // The module is already loaded; storage cleanup is optional.
    }
    return { default: module.CheckersModuleExperience };
  } catch (error) {
    if (isRecoverableCheckersChunkError(error)) return reloadCurrentBuildOnce();
    throw error;
  }
}
