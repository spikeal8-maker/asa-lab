/** Foundation service surface for the realtime-gateway app. Realtime presence and live-update gateway. */
export const APP_NAME = 'realtime-gateway';

export interface HealthStatus {
  readonly live: boolean;
  readonly ready: boolean;
}

export function health(): HealthStatus {
  return { live: true, ready: false };
}
