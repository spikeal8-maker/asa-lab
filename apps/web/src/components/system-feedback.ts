/**
 * One process-wide UI notification channel, independent of the current route.
 * Publish only a confirmed operation result: never a speculative save, never
 * student access codes, passwords or other secrets.
 */
export type SystemFeedbackKind = 'success' | 'error' | 'warning' | 'info';

export interface SystemFeedbackMessage {
  readonly id: number;
  readonly kind: SystemFeedbackKind;
  readonly message: string;
  readonly expiresAt: number | null;
}

const VISIBLE_LIMIT = 3;
const PENDING_LIMIT = 20;
const listeners = new Set<() => void>();
let visible: readonly SystemFeedbackMessage[] = [];
let pending: SystemFeedbackMessage[] = [];
let sequence = 0;

function changed(): void {
  for (const notify of listeners) notify();
}

export function subscribeSystemFeedback(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSystemFeedbackSnapshot(): readonly SystemFeedbackMessage[] {
  return visible;
}

function lifetimeFor(kind: SystemFeedbackKind): number | null {
  return kind === 'error' ? null : kind === 'warning' ? 7000 : 4500;
}

function enqueue(kind: SystemFeedbackKind, raw: string): number {
  const message = raw.trim();
  if (!message) return 0;
  const existing = [...visible, ...pending].find(
    (item) => item.kind === kind && item.message === message,
  );
  if (existing) {
    if (visible.some((item) => item.id === existing.id)) {
      const lifetime = lifetimeFor(kind);
      if (lifetime !== null) {
        visible = visible.map((item) =>
          item.id === existing.id ? { ...item, expiresAt: Date.now() + lifetime } : item,
        );
        changed();
      }
    }
    return existing.id;
  }

  const id = ++sequence;
  const lifetime = lifetimeFor(kind);
  const item: SystemFeedbackMessage = {
    id,
    kind,
    message,
    expiresAt: lifetime === null ? null : Date.now() + lifetime,
  };
  if (visible.length < VISIBLE_LIMIT) {
    visible = [...visible, item];
    changed();
  } else {
    if (pending.length >= PENDING_LIMIT) {
      const disposable = pending.findIndex((entry) => entry.kind !== 'error');
      pending.splice(disposable >= 0 ? disposable : 0, 1);
    }
    pending.push(item);
  }
  return id;
}

export const systemFeedback = {
  success: (message: string) => enqueue('success', message),
  error: (message: string) => enqueue('error', message),
  warning: (message: string) => enqueue('warning', message),
  info: (message: string) => enqueue('info', message),
};

export function dismissSystemFeedback(id: number): void {
  if (visible.some((item) => item.id === id)) {
    const next = pending.shift();
    const lifetime = next ? lifetimeFor(next.kind) : null;
    visible = [
      ...visible.filter((item) => item.id !== id),
      ...(next ? [{ ...next, expiresAt: lifetime === null ? null : Date.now() + lifetime }] : []),
    ];
    changed();
    return;
  }
  pending = pending.filter((item) => item.id !== id);
}

export function clearSystemFeedback(): void {
  if (!visible.length && !pending.length) return;
  visible = [];
  pending = [];
  changed();
}
