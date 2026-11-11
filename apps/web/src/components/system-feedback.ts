/** Publish caller-supplied safe text only. Exclude passwords and access codes.
 * One active page owner publishes through its lifetime-bound handle.
 */
export type SystemFeedbackTone = 'success' | 'error' | 'warning' | 'info';
export interface SystemFeedbackMessage {
  readonly id: number;
  readonly message: string;
  readonly tone: SystemFeedbackTone;
  readonly scope: string;
}
export interface SystemFeedbackHandle {
  notify(message: string, tone: SystemFeedbackTone): number | null;
  clear(): void;
  dispose(): void;
}
export const SYSTEM_FEEDBACK_MAX_LENGTH = 2000;
const listeners = new Set<() => void>();
let snapshot: SystemFeedbackMessage | null = null;
let sequence = 0;
let owner: object | null = null;

function publish(next: SystemFeedbackMessage | null): void {
  if (snapshot === next) return;
  snapshot = next;
  for (const listener of [...listeners]) listener();
}
function boundedText(message: string): string {
  const text = message.trim();
  if (text.length <= SYSTEM_FEEDBACK_MAX_LENGTH) return text;
  let result = '';
  for (const character of text) {
    if (result.length + character.length > SYSTEM_FEEDBACK_MAX_LENGTH - 1) break;
    result += character;
  }
  return `${result}…`;
}
export function subscribeSystemFeedback(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function getSystemFeedbackSnapshot(): SystemFeedbackMessage | null {
  return snapshot;
}
export function getSystemFeedbackServerSnapshot(): null {
  return null;
}

/** IDs are globally unique, so an old dismissal cannot erase a replacement. */
export function dismissSystemFeedback(id: number): void {
  if (snapshot?.id === id) publish(null);
}
/** Explicit teardown/test reset. Publishers must use their handle.clear(). */
export function clearSystemFeedback(): void {
  owner = null;
  publish(null);
}
export function activateSystemFeedbackScope(scope: string): SystemFeedbackHandle {
  const token = {};
  owner = token;
  // Install the new owner before notifying subscribers about the cleared scope.
  publish(null);
  return {
    notify(message, tone) {
      if (owner !== token) return null;
      const text = boundedText(message);
      const id = ++sequence;
      publish(text ? Object.freeze({ id, message: text, tone, scope }) : null);
      return id;
    },
    clear() {
      if (owner === token) publish(null);
    },
    dispose() {
      if (owner !== token) return;
      owner = null;
      publish(null);
    },
  };
}
