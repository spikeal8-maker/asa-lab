import { useId, useLayoutEffect, useMemo } from 'react';
import { onSessionLoggedOut } from '../session-fetch';
import { activateSystemFeedbackScope, type SystemFeedbackTone } from './system-feedback';

export function useClassroomFeedback(contextKey: string) {
  const instance = useId();
  const scope = useMemo(() => {
    const scopeKey = JSON.stringify([instance, contextKey]);
    let publisher: ReturnType<typeof activateSystemFeedbackScope> | null = null;
    let ended = false;
    const callback =
      (tone: SystemFeedbackTone) =>
      (message: string | null): void => {
        if (message === null) publisher?.clear();
        else publisher?.notify(message, tone);
      };
    const feedback = {
      scopeKey,
      success: callback('success'),
      error: callback('error'),
      info: callback('info'),
      warning: callback('warning'),
      clear: () => {
        publisher?.clear();
      },
    };
    return {
      feedback,
      setup: () => {
        // Each layout-effect setup owns a fresh token, including StrictMode replay.
        const handle = ended ? null : activateSystemFeedbackScope(scopeKey);
        publisher = handle;
        const unsubscribe = onSessionLoggedOut(() => {
          ended = true;
          handle?.dispose();
          if (publisher === handle) publisher = null;
        });
        return () => {
          unsubscribe();
          handle?.dispose();
          if (publisher === handle) publisher = null;
        };
      },
    };
  }, [instance, contextKey]);

  useLayoutEffect(() => scope.setup(), [scope]);
  return scope.feedback;
}
