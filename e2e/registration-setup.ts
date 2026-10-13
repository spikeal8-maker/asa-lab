import type { APIRequestContext, APIResponse, TestInfo } from '@playwright/test';

type RegistrationOptions = NonNullable<Parameters<APIRequestContext['post']>[1]>;

/** Only account setup may wait out the shared mutation window; admissions never retry. */
export async function registerAccountSetup(
  request: APIRequestContext,
  options: RegistrationOptions,
  testInfo: TestInfo,
): Promise<APIResponse> {
  const response = await request.post('/api/auth/register', options);
  if (response.status() !== 429) return response;

  const retryAfter = response.headers()['retry-after'];
  if (retryAfter === undefined || !/^[1-9]\d{0,2}$/.test(retryAfter)) return response;
  const seconds = Number(retryAfter);
  if (seconds > 300) return response;

  const body = (await response.json().catch(() => undefined)) as
    { error?: { code?: unknown; retryAfterSeconds?: unknown } } | undefined;
  if (body?.error?.code !== 'too_many_requests' || body.error.retryAfterSeconds !== seconds) {
    return response;
  }

  const originalTimeout = testInfo.timeout;
  const waitMs = seconds * 1000;
  const waitStarted = performance.now();
  // Provision the directed wait before sleeping, then charge only elapsed waiting.
  testInfo.setTimeout(originalTimeout + waitMs);
  try {
    await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
  } finally {
    testInfo.setTimeout(originalTimeout + Math.ceil(performance.now() - waitStarted));
  }
  return request.post('/api/auth/register', options);
}
