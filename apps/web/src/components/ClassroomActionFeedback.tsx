import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { onSessionLoggedOut } from '../session-fetch';
import type { useClassroomFeedback } from './useClassroomFeedback';
import { dismissSystemFeedback, getSystemFeedbackSnapshot } from './system-feedback';

export type ClassroomFeedbackPublisher = ReturnType<typeof useClassroomFeedback>;

const ClassroomActionFeedbackContext = createContext<ClassroomFeedbackPublisher | null>(null);

/** Reuses the page owner. A provider adds neither DOM nor a second store owner. */
export function ClassroomActionFeedbackProvider({
  value,
  children,
}: {
  readonly value: ClassroomFeedbackPublisher;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <ClassroomActionFeedbackContext.Provider value={value}>
      {children}
    </ClassroomActionFeedbackContext.Provider>
  );
}

export function useClassroomFeedbackPublisher(): ClassroomFeedbackPublisher | null {
  return useContext(ClassroomActionFeedbackContext);
}

/**
 * Confirmed action success only. Validation, loading, conflict and ambiguous
 * retry errors remain local to the form. No API outcome is inferred here.
 * Outside a page provider, retain the existing inline-success fallback.
 */
export function useClassroomActionFeedback(contextKey: string): {
  readonly notice: string | null;
  readonly setNotice: (message: string | null) => void;
} {
  const publisher = useClassroomFeedbackPublisher();
  const scope = useMemo(
    () => ({ publisher, contextKey, lastPublicationId: null as number | null }),
    [publisher, contextKey],
  );
  const committed = useRef<typeof scope | null>(null);
  const [local, setLocal] = useState<{ owner: typeof scope; message: string } | null>(null);

  useLayoutEffect(() => {
    committed.current = scope;
    setLocal(null);
    const clearOwnPublication = () => {
      if (scope.lastPublicationId !== null) dismissSystemFeedback(scope.lastPublicationId);
      scope.lastPublicationId = null;
    };
    const unsubscribe = onSessionLoggedOut(() => {
      clearOwnPublication();
      if (committed.current === scope) committed.current = null;
      setLocal(null);
    });
    return () => {
      unsubscribe();
      clearOwnPublication();
      if (committed.current === scope) committed.current = null;
    };
  }, [scope]);

  const setNotice = useCallback(
    (message: string | null) => {
      if (committed.current !== scope) return;
      if (!message?.trim()) {
        if (scope.lastPublicationId !== null) dismissSystemFeedback(scope.lastPublicationId);
        scope.lastPublicationId = null;
        setLocal(null);
        // ID-bound dismissal cannot clear a sibling's replacement message.
        return;
      }
      if (scope.publisher) {
        const previousId = getSystemFeedbackSnapshot()?.id;
        scope.publisher.success(message);
        const confirmed = getSystemFeedbackSnapshot();
        if (
          confirmed &&
          confirmed.id !== previousId &&
          confirmed.scope === scope.publisher.scopeKey &&
          confirmed.tone === 'success'
        ) {
          scope.lastPublicationId = confirmed.id;
        }
      } else setLocal({ owner: scope, message });
    },
    [scope],
  );

  return {
    notice: !publisher && local?.owner === scope ? local.message : null,
    setNotice,
  };
}
