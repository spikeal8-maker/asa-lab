import { useEffect, useSyncExternalStore } from 'react';
import {
  clearSystemFeedback,
  dismissSystemFeedback,
  getSystemFeedbackSnapshot,
  subscribeSystemFeedback,
  type SystemFeedbackKind,
} from './system-feedback';
import './system-feedback.css';
import { onSessionLoggedOut } from '../session-fetch';

const EMPTY: ReturnType<typeof getSystemFeedbackSnapshot> = [];
const SYMBOL: Readonly<Record<SystemFeedbackKind, string>> = {
  success: '✓',
  error: '!',
  warning: '!',
  info: 'i',
};

/**
 * Render once in main.tsx, outside route transitions. The live messages
 * announce themselves without stealing focus from a form or editor.
 */
export function SystemToastViewport(): JSX.Element {
  const messages = useSyncExternalStore(
    subscribeSystemFeedback,
    getSystemFeedbackSnapshot,
    () => EMPTY,
  );

  useEffect(() => onSessionLoggedOut(clearSystemFeedback), []);

  useEffect(() => {
    const timers = messages
      .filter((item) => item.expiresAt !== null)
      .map((item) =>
        window.setTimeout(
          () => dismissSystemFeedback(item.id),
          Math.max(0, item.expiresAt! - Date.now()),
        ),
      );
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [messages]);

  return (
    <aside className="asa-toast-viewport" aria-label="Системные уведомления">
      {messages.map((item) => (
        <div
          key={item.id}
          className={`asa-toast asa-toast--${item.kind}`}
          role={item.kind === 'error' ? 'alert' : 'status'}
        >
          <span className="asa-toast-symbol" aria-hidden="true">
            {SYMBOL[item.kind]}
          </span>
          <span className="asa-toast-message">{item.message}</span>
          <button
            type="button"
            className="asa-toast-dismiss"
            aria-label="Закрыть уведомление"
            onClick={() => dismissSystemFeedback(item.id)}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
      ))}
    </aside>
  );
}
