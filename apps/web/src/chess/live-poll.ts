/** One request at a time, with a full quiet interval after each response. */
export function startLivePoll(
  request: (isCurrent: () => boolean) => Promise<void>,
  intervalMs: number,
  onError: () => void,
): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const isCurrent = (): boolean => !stopped;
  async function run(): Promise<void> {
    try {
      await request(isCurrent);
    } catch {
      if (!stopped) onError();
    } finally {
      if (!stopped) timer = setTimeout(() => void run(), intervalMs);
    }
  }
  void run();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

/** A delayed poll must never undo a command or rewind an authoritative clock. */
export function newestLiveSnapshot<
  T extends { gameId: string; version: number; sequence: number; serverNowMs: number },
>(current: T | null, incoming: T | null): T | null {
  if (!current || !incoming || current.gameId !== incoming.gameId) return incoming;
  if (incoming.version < current.version || incoming.sequence < current.sequence) return current;
  if (
    incoming.version === current.version &&
    incoming.sequence === current.sequence &&
    incoming.serverNowMs < current.serverNowMs
  )
    return current;
  return incoming;
}
