import { useEffect, useRef, useState } from 'react';

type AvatarModule = typeof import('./AvatarChooser');
const LOCAL_PRELOAD_EVENT = 'asa-optional-preload-error';

/** Optional avatar UI owns its import errors; other chunks keep global recovery. */
export function useAvatarModule(enabled: boolean): {
  readonly module: AvatarModule | null;
  readonly failed: boolean;
  readonly canRetry: boolean;
  readonly retry: () => void;
} {
  const [module, setModule] = useState<AvatarModule | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const failedUrl = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const keepLocal = (event: Event) => {
      const reason = (event as CustomEvent<unknown>).detail;
      if (!(reason instanceof Error)) return;
      const address = reason.message.match(/https?:\/\/[^\s]+/)?.[0];
      if (!address) return;
      try {
        const url = new URL(address);
        if (
          url.origin !== window.location.origin ||
          !/^\/assets\/AvatarChooser-[\w-]+\.js$/.test(url.pathname)
        )
          return;
        failedUrl.current = `${url.origin}${url.pathname}`;
        event.preventDefault();
      } catch {
        /* This consumer never handles an unknown chunk or global error. */
      }
    };
    window.addEventListener(LOCAL_PRELOAD_EVENT, keepLocal);
    return () => window.removeEventListener(LOCAL_PRELOAD_EVENT, keepLocal);
  }, [enabled]);
  useEffect(() => {
    if (!enabled || module) return;
    let current = true;
    setFailed(false);
    // Chromium can retain a failed module-map entry. One of three explicit
    // retries uses a fresh URL for this exact same-origin immutable chunk.
    const load: Promise<AvatarModule> =
      attempt > 0 && failedUrl.current
        ? import(/* @vite-ignore */ `${failedUrl.current}?avatar_retry=${attempt}`)
        : import('./AvatarChooser');
    void load
      .then((result) => {
        if (current) setModule(result);
      })
      .catch(() => {
        if (current) setFailed(true);
      });
    return () => {
      current = false;
    };
  }, [enabled, attempt, module]);
  return {
    module,
    failed,
    canRetry: attempt < 3,
    retry: () => setAttempt((value) => Math.min(3, value + 1)),
  };
}
