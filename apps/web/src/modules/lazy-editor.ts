/**
 * Loading a subject editor on demand has one failure mode worth handling: after
 * a deploy the page still holds the previous build's chunk names, so the import
 * fails for a reason the learner cannot act on. One reload onto the current
 * build fixes it; a second would be a loop, so the attempt is recorded per build
 * revision and per URL.
 */
export function isRecoverableChunkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|loading chunk .+ failed/i.test(
    message,
  );
}

export interface LazyEditorChunk<T> {
  /** sessionStorage key that records the one permitted reload. */
  readonly reloadMarker: string;
  /** Shown when a reload already happened and the chunk still fails. */
  readonly exhaustedMessage: string;
  /** Shown when sessionStorage is unavailable and a safe retry is impossible. */
  readonly unavailableMessage: string;
  load(): Promise<T>;
}

function reloadCurrentBuildOnce(chunk: LazyEditorChunk<unknown>): Promise<never> {
  const marker = `${__ASA_BUILD_REVISION__}:${window.location.href}`;
  try {
    if (window.sessionStorage.getItem(chunk.reloadMarker) === marker) {
      return Promise.reject(new Error(chunk.exhaustedMessage));
    }
    window.sessionStorage.setItem(chunk.reloadMarker, marker);
  } catch {
    return Promise.reject(new Error(chunk.unavailableMessage));
  }
  window.location.reload();
  return new Promise<never>(() => undefined);
}

export async function loadEditorChunk<T>(chunk: LazyEditorChunk<T>): Promise<T> {
  try {
    const loaded = await chunk.load();
    try {
      window.sessionStorage.removeItem(chunk.reloadMarker);
    } catch {
      // The chunk is already loaded; storage cleanup is optional.
    }
    return loaded;
  } catch (error) {
    if (isRecoverableChunkError(error)) return reloadCurrentBuildOnce(chunk);
    throw error;
  }
}
