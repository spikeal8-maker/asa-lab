import { analyticsSessionTransport } from '../analytics-runtime';
import { trackInputActivity, type ActivityTransport } from '../activity-lifecycle';
import type { TelemetryActor } from '../telemetry-contract';

export const BLOCKS_ACTIVITY_POLL_MS = 30_000;
export const BLOCKS_ACTIVITY_IDLE_MS = 30_000;

/** Sole Scratch writer; readiness/liveness alone is never user input. */
export function trackBlocksActivity(
  projectId: string,
  api?: ActivityTransport,
  actor: TelemetryActor | null = null,
) {
  return trackInputActivity(
    projectId,
    api ?? analyticsSessionTransport(actor, 'blocks'),
    BLOCKS_ACTIVITY_IDLE_MS,
  );
}
