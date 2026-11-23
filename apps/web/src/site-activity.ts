import { newClientId } from './client-id';
import { record, sendTelemetry, time, type TelemetryActor } from './telemetry-contract';
import {
  sameTelemetryBinding,
  subscribeTelemetry,
  type TelemetryContext,
} from './telemetry-context';

const idleMs = 30_000;
const maxAgeMs = 90_000;
const maxIntervals = 16;
const inputEvents = ['pointerdown', 'keydown', 'wheel'] as const;

function trackSiteActivity(actor: TelemetryActor, binding: TelemetryContext): () => void {
  const now = () => Math.floor(performance.now());
  const focused = () => document.visibilityState === 'visible' && document.hasFocus();
  const intervals: { from: number; to: number }[] = [];
  let active: { from: number; until: number } | undefined;
  let timer: number | undefined;
  let request: AbortController | undefined;
  let suspended = false;
  let rejected = false;

  const settle = (at: number) => {
    if (!active) return;
    const to = Math.min(at, active.until);
    const from = Math.max(active.from, to - maxAgeMs);
    if (to - from >= 1000) {
      if (intervals.length >= maxIntervals) intervals.shift();
      intervals.push({ from, to });
    }
    active = undefined;
  };
  const reset = () => {
    active = undefined;
    intervals.length = 0;
    window.clearTimeout(timer);
    timer = undefined;
    request?.abort();
    request = undefined;
  };
  const schedule = () => {
    timer ??= window.setTimeout(flush, 60_000 + Math.floor(Math.random() * 15_000));
  };
  const flush = () => {
    timer = undefined;
    if (suspended || rejected || !sameTelemetryBinding(binding)) return;
    const at = now();
    const until = active?.until;
    const hasFocus = focused();
    // If the browser did not deliver a blur event, only trust up to its last input.
    settle(!hasFocus && until !== undefined ? Math.min(at, until - idleMs) : at);
    if (until !== undefined && until > at && hasFocus) {
      active = { from: at, until };
      schedule();
    }
    const batch = intervals.splice(0).filter(({ from }) => from >= at - maxAgeMs);
    if (!batch.length || request) return;
    let eventId: string;
    try {
      eventId = newClientId();
    } catch {
      return;
    }
    const controller = new AbortController();
    request = controller;
    void sendTelemetry(
      '/api/analytics/v2/site-activity',
      {
        schemaVersion: 2,
        eventId,
        actorExpectation: actor,
        // The server anchors these monotonic ages at receipt. Browser clock skew
        // cannot move a sample into the future or outside the retention window.
        intervals: batch.map(({ from, to }) => ({
          fromAgoMs: at - from,
          toAgoMs: at - to,
        })),
      },
      {
        status: 200,
        confirmed: (value) =>
          record(value) &&
          value.schemaVersion === 2 &&
          value.operation === 'site.activity' &&
          value.eventId === eventId &&
          ((value.accepted === true &&
            value.state === 'persisted' &&
            value.receiptId === eventId &&
            time(value.receivedAt) &&
            time(value.persistedAt)) ||
            (value.accepted === false && value.state === 'skipped' && value.reason === 'capacity')),
      },
      (path, init) => fetch(path, { ...init, keepalive: false }),
      controller.signal,
    ).then((outcome) => {
      if (request !== controller) return;
      request = undefined;
      // Site samples never refresh the session or replay a failed batch.
      if (outcome.kind === 'rejected' && outcome.context) {
        rejected = true;
        reset();
      }
    });
  };
  const input = (event: Event) => {
    if (!event.isTrusted || suspended || rejected || !focused() || !sameTelemetryBinding(binding))
      return;
    const at = now();
    if (active && at >= active.until) settle(at);
    active = { from: active?.from ?? at, until: at + idleMs };
    schedule();
  };
  const blur = () => settle(now());
  const visibility = () => {
    if (document.visibilityState !== 'visible') blur();
  };
  const pagehide = () => {
    suspended = true;
    reset();
  };
  const pageshow = (event: PageTransitionEvent) => {
    if (event.persisted) suspended = false;
  };

  for (const type of inputEvents)
    document.addEventListener(type, input, { capture: true, passive: true });
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('blur', blur);
  window.addEventListener('pagehide', pagehide);
  window.addEventListener('pageshow', pageshow);
  return () => {
    suspended = true;
    reset();
    for (const type of inputEvents) document.removeEventListener(type, input, true);
    document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('blur', blur);
    window.removeEventListener('pagehide', pagehide);
    window.removeEventListener('pageshow', pageshow);
  };
}

let stopMeasurement: (() => void) | undefined;

/** Explicit activation for a verified rollout. Importing this module starts no collection. */
export function enableSiteActivityMeasurement(): () => void {
  if (typeof window === 'undefined') return () => undefined;
  if (stopMeasurement) return stopMeasurement;
  let binding: TelemetryContext | undefined;
  let stopTracker: (() => void) | undefined;
  const unsubscribe = subscribeTelemetry((context) => {
    if (binding && sameTelemetryBinding(binding)) return;
    stopTracker?.();
    binding = context.ready && context.actor ? context : undefined;
    stopTracker = binding?.actor ? trackSiteActivity(binding.actor, binding) : undefined;
  });
  const stop = () => {
    if (stopMeasurement !== stop) return;
    stopMeasurement = undefined;
    unsubscribe();
    stopTracker?.();
    stopTracker = undefined;
  };
  stopMeasurement = stop;
  return stop;
}
