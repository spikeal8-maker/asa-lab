import { newClientId } from './client-id';
import { finalizeInputActivitiesForPageHide } from './activity-lifecycle';
import { AnalyticsDelivery, browserAnalytics } from './analytics-delivery';
import {
  actorKey,
  record,
  safeReferrer,
  uuid,
  type TelemetryActor,
  type TelemetryModule,
} from './telemetry-contract';
import {
  renewTelemetryContext,
  sameTelemetryBinding,
  subscribeProductConfirmation,
  subscribeTelemetry,
  telemetryContext,
  type TelemetryContext,
} from './telemetry-context';

let delivery: AnalyticsDelivery | undefined;
let generation = -1;
let continuity = -1;
let visitId = '';
let proof: { context: TelemetryContext; controller: AbortController } | undefined;
type ProductObservation = { readonly context: TelemetryContext; readonly deadline: number };
let productObservation: ProductObservation | undefined;
let observationTimer: ReturnType<typeof setTimeout> | undefined;
function clearProductObservation(): void {
  productObservation = undefined;
  if (observationTimer) clearTimeout(observationTimer);
  observationTimer = undefined;
}
function update(context: TelemetryContext): void {
  if (proof && !sameTelemetryBinding(proof.context)) proof.controller.abort();
  if (productObservation && !sameTelemetryBinding(productObservation.context))
    clearProductObservation();
  if (!context.ready) {
    delivery?.pause(true);
    return;
  }
  if (context.generation === generation) {
    delivery?.pause(false);
    return;
  }
  const recovery = context.continuity === continuity;
  delivery?.retire();
  delivery = undefined;
  generation = context.generation;
  continuity = context.continuity;
  if (!context.actor) return;
  const created = browserAnalytics(context.actor, () => {
    if (delivery === created && productObservation) recoverAuthentication(productObservation);
  });
  delivery = created;
  if (recovery) {
    // The document did not navigate. Its rejected original visit stays an honest coverage gap.
    delivery.pause(false);
    return;
  }
  visitId = newClientId();
  let referrer: string | null = null;
  try {
    referrer = safeReferrer(document.referrer);
  } catch {
    /* No raw URL fallback. */
  }
  delivery.visit(visitId, context.route, referrer);
  delivery.pause(false);
}
subscribeTelemetry(update);
/** Bounded canonical identity read; it cannot refresh credentials or alter the product response. */
async function freshActor(
  signal: AbortSignal,
  outOfTime: () => boolean,
): Promise<TelemetryActor | null> {
  try {
    const response = await fetch('/api/auth/me', {
      credentials: 'same-origin',
      cache: 'no-store',
      signal,
      headers: { accept: 'application/json' },
    });
    if (outOfTime() || !response.ok || !response.body) {
      void response.body?.cancel().catch(() => undefined);
      return null;
    }
    const reader = response.body.getReader();
    const cancel = () => {
      void reader.cancel().catch(() => undefined);
    };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      const bytes = new Uint8Array(64_000);
      let length = 0;
      while (!outOfTime()) {
        const { done, value } = await reader.read();
        if (outOfTime()) return null;
        if (done) break;
        if (length + value.byteLength > bytes.length) {
          cancel();
          return null;
        }
        bytes.set(value, length);
        length += value.byteLength;
      }
      if (outOfTime()) return null;
      const value: unknown = JSON.parse(new TextDecoder().decode(bytes.subarray(0, length)));
      if (
        !record(value) ||
        value.authenticated !== true ||
        !record(value.account) ||
        !uuid(value.account.id) ||
        !record(value.activeWorkspace) ||
        !uuid(value.activeWorkspace.workspaceId)
      )
        return null;
      return {
        kind: 'account',
        accountId: value.account.id,
        workspaceId: value.activeWorkspace.workspaceId,
      };
    } finally {
      signal.removeEventListener('abort', cancel);
      reader.releaseLock();
    }
  } catch {
    return null;
  }
}
function recoverAuthentication(observation: ProductObservation): void {
  if (Date.now() >= observation.deadline) {
    clearProductObservation();
    return;
  }
  const context = observation.context;
  const target = delivery;
  if (
    proof ||
    context.actor?.kind !== 'account' ||
    !sameTelemetryBinding(context) ||
    !target?.canRecoverAuthentication()
  )
    return;
  // Consume one independent product observation at most once, including a delayed old-cookie401.
  clearProductObservation();
  const pending = { context, controller: new AbortController() };
  proof = pending;
  const signal = pending.controller.signal;
  const deadline = Date.now() + 12_000;
  const outOfTime = (): boolean => {
    if (Date.now() >= deadline) pending.controller.abort();
    return signal.aborted;
  };
  const timeout = setTimeout(() => pending.controller.abort(), 12_000);
  let aborted!: () => void;
  const cancelled = new Promise<null>((resolve) => {
    aborted = () => resolve(null);
    signal.addEventListener('abort', aborted, { once: true });
  });
  void Promise.race([freshActor(signal, outOfTime), cancelled])
    .then((actor) => {
      if (
        !outOfTime() &&
        actor &&
        delivery === target &&
        target.canRecoverAuthentication() &&
        sameTelemetryBinding(context) &&
        actorKey(actor) === actorKey(context.actor)
      )
        renewTelemetryContext(context);
    })
    .finally(() => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', aborted);
      if (proof === pending) proof = undefined;
    });
}
subscribeProductConfirmation((context, deadline) => {
  if (proof || context.actor?.kind !== 'account' || Date.now() >= deadline) return;
  clearProductObservation();
  productObservation = { context, deadline };
  // A telemetry request has a 12s deadline; a healthy refresh needs no speculative identity read.
  observationTimer = setTimeout(clearProductObservation, Math.max(0, deadline - Date.now()));
  recoverAuthentication(productObservation);
});
if (typeof window !== 'undefined') {
  let suspended = false;
  let suspendedDelivery: AnalyticsDelivery | undefined;
  window.addEventListener('online', () => {
    delivery?.retryNow();
  });
  window.addEventListener('pagehide', () => {
    const target = delivery;
    suspended = true;
    suspendedDelivery = target;
    finalizeInputActivitiesForPageHide();
    if (delivery === target) void target?.quality.flush(true);
  });
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted || !suspended) return;
    suspended = false;
    const target = suspendedDelivery;
    suspendedDelivery = undefined;
    if (!target || delivery !== target) return;
    target.quality.resumeAfterPageShow();
    if (telemetryContext().ready) target.retryNow();
  });
}
export function analyticsSessionTransport(
  actor: TelemetryActor | null,
  moduleKey: TelemetryModule,
) {
  const expectedContinuity = telemetryContext().continuity;
  let ownerGeneration = telemetryContext().generation;
  const owners = new Map<string, AnalyticsDelivery>();
  const current = () => {
    if (
      ownerGeneration !== telemetryContext().generation ||
      expectedContinuity !== telemetryContext().continuity
    ) {
      owners.clear();
      ownerGeneration = telemetryContext().generation;
    }
    return (
      delivery &&
      telemetryContext().ready &&
      expectedContinuity === telemetryContext().continuity &&
      actorKey(actor) === actorKey(delivery.actor)
    );
  };
  return {
    bindingVersion: () => {
      current();
      return `${telemetryContext().continuity}:${telemetryContext().generation}`;
    },
    start: (sessionId: string, projectId: string): Promise<boolean> => {
      if (!current() || (!owners.has(sessionId) && owners.size >= 32))
        return Promise.resolve(false);
      const target = delivery!;
      owners.set(sessionId, target);
      return target.open(sessionId, projectId, moduleKey, visitId).then((accepted) => {
        if (!accepted && owners.get(sessionId) === target) owners.delete(sessionId);
        return accepted;
      });
    },
    touch: (sessionId: string, closed: boolean): Promise<boolean> => {
      if (!current() || owners.get(sessionId) !== delivery) return Promise.resolve(false);
      const target = delivery!;
      return target.touch(sessionId, closed).then((accepted) => {
        if (closed && owners.get(sessionId) === target) owners.delete(sessionId);
        return accepted;
      });
    },
    closeIntent: (sessionId: string): void => {
      if (current() && owners.get(sessionId) === delivery) {
        void delivery!.touch(sessionId, true);
        owners.delete(sessionId);
      }
    },
  };
}
/** Ensure import has installed the subscriber; no anonymous fallback writer. */
export function observeAnalytics(): void {
  update(telemetryContext());
}
