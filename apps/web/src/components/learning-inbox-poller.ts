import type { ApiResult, LearningNotification } from '../api';

export interface LearningInboxSnapshot {
  snapshot: string;
  unread: number;
  items: LearningNotification[];
}

// Passive browser activation events often arrive together. Explicit user
// actions bypass this window; a running request still remains single-flight.
const activationWindow = 250;
const activationDelay = 100;
const normalInterval = 15000;
const maximumInterval = 120000;

export function createLearningInboxPoller({
  load,
  onResult,
  random = Math.random,
}: {
  load: () => Promise<ApiResult<LearningInboxSnapshot>>;
  onResult: (result: ApiResult<LearningInboxSnapshot>) => void;
  random?: () => number;
}) {
  let active = true;
  let inFlight = false;
  let revision = 0;
  let mutations = 0;
  let pending = false;
  let failures = 0;
  let lastActivation = -Infinity;
  let timer: number | undefined;
  let activationTimer: number | undefined;
  const visible = () => document.visibilityState !== 'hidden';
  function clearTimer() {
    window.clearTimeout(timer);
    timer = undefined;
  }
  function schedule() {
    clearTimer();
    if (!active || !visible() || inFlight || mutations) return;
    const base = Math.min(maximumInterval, normalInterval * 2 ** failures);
    const delay = Math.min(maximumInterval, Math.round(base * (0.8 + random() * 0.4)));
    timer = window.setTimeout(() => {
      if (visible()) void refresh();
    }, delay);
  }
  async function refresh() {
    if (!active || inFlight || mutations) return;
    clearTimer();
    window.clearTimeout(activationTimer);
    activationTimer = undefined;
    pending = false;
    inFlight = true;
    lastActivation = Date.now();
    const atStart = revision;
    let result: ApiResult<LearningInboxSnapshot>;
    try {
      result = await load();
    } catch {
      result = {
        ok: false,
        status: 0,
        error: { code: 'network', message: 'Не удалось обновить оповещения.' },
      };
    }
    if (!active) return;
    inFlight = false;
    if (atStart === revision && mutations === 0) {
      failures = result.ok ? 0 : Math.min(failures + 1, 3);
      onResult(result);
    }
    // A read invalidates the old snapshot. Its replacement starts only after
    // both that request and the mutation have finished, never in parallel.
    if (pending && mutations === 0 && visible()) void refresh();
    else schedule();
  }
  function activate() {
    if (!active || !visible() || inFlight || mutations || activationTimer !== undefined) return;
    if (Date.now() - lastActivation < activationWindow) return;
    activationTimer = window.setTimeout(() => {
      activationTimer = undefined;
      if (visible()) void refresh();
    }, activationDelay);
  }
  function visibilityChanged() {
    if (visible()) activate();
    else {
      clearTimer();
      window.clearTimeout(activationTimer);
      activationTimer = undefined;
      lastActivation = -Infinity;
    }
  }
  window.addEventListener('focus', activate);
  document.addEventListener('visibilitychange', visibilityChanged);
  if (visible()) void refresh();
  return {
    refresh,
    isActive: () => active,
    beginMutation() {
      revision += 1;
      mutations += 1;
      pending = true;
      clearTimer();
      let finished = false;
      return () => {
        if (!active || finished) return;
        finished = true;
        revision += 1;
        mutations -= 1;
        if (mutations === 0 && visible()) void refresh();
      };
    },
    stop() {
      active = false;
      clearTimer();
      window.clearTimeout(activationTimer);
      window.removeEventListener('focus', activate);
      document.removeEventListener('visibilitychange', visibilityChanged);
    },
  };
}
