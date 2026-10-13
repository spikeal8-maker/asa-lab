import { newClientId } from './client-id';
import { AnalyticsDelivery, browserAnalytics } from './analytics-delivery';
import {
  actorKey,
  safeReferrer,
  type TelemetryActor,
  type TelemetryModule,
} from './telemetry-contract';
import { subscribeTelemetry, telemetryContext, type TelemetryContext } from './telemetry-context';

let delivery: AnalyticsDelivery | undefined;
let generation = -1;
let visitId = '';
function update(context: TelemetryContext): void {
  if (!context.ready) {
    delivery?.pause(true);
    return;
  }
  if (context.generation === generation) {
    delivery?.pause(false);
    return;
  }
  delivery?.retire();
  delivery = undefined;
  generation = context.generation;
  if (!context.actor) return;
  delivery = browserAnalytics(context.actor);
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
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    delivery?.retryNow();
  });
  window.addEventListener('pagehide', () => {
    void delivery?.quality.flush(true);
  });
}
export function analyticsSessionTransport(
  actor: TelemetryActor | null,
  moduleKey: TelemetryModule,
) {
  const expectedGeneration = telemetryContext().generation;
  const target = delivery;
  const current = () =>
    target &&
    delivery === target &&
    telemetryContext().ready &&
    expectedGeneration === telemetryContext().generation &&
    actorKey(actor) === actorKey(target.actor);
  return {
    start: (sessionId: string, projectId: string): Promise<boolean> =>
      current() ? target!.open(sessionId, projectId, moduleKey, visitId) : Promise.resolve(false),
    touch: (sessionId: string, closed: boolean): Promise<boolean> =>
      current() ? target!.touch(sessionId, closed) : Promise.resolve(false),
    closeIntent: (sessionId: string): void => {
      if (current()) void target!.touch(sessionId, true);
    },
  };
}
/** Ensure import has installed the subscriber; no anonymous fallback writer. */
export function observeAnalytics(): void {
  update(telemetryContext());
}
