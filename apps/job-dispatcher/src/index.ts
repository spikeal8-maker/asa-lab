/** Foundation service surface for the job-dispatcher app. Compute-plane job dispatcher. */
export const APP_NAME = 'job-dispatcher';

export interface HealthStatus {
  readonly live: boolean;
  readonly ready: boolean;
}

export function health(): HealthStatus {
  return { live: true, ready: false };
}
