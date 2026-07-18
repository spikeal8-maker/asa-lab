/** Foundation service surface for the web app. Student and teacher experience shell. */
export const APP_NAME = 'web';

export interface HealthStatus {
  readonly live: boolean;
  readonly ready: boolean;
}

export function health(): HealthStatus {
  return { live: true, ready: false };
}
