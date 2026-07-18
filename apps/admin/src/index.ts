/** Foundation service surface for the admin app. Administration console shell. */
export const APP_NAME = 'admin';

export interface HealthStatus {
  readonly live: boolean;
  readonly ready: boolean;
}

export function health(): HealthStatus {
  return { live: true, ready: false };
}
