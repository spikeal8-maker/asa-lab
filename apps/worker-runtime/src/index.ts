/** Foundation service surface for the worker-runtime app. Isolated compute worker runtime host. */
export const APP_NAME = 'worker-runtime';

export interface HealthStatus {
  readonly live: boolean;
  readonly ready: boolean;
}

export function health(): HealthStatus {
  return { live: true, ready: false };
}
