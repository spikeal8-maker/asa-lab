import { describe, expect, it } from 'vitest';
import {
  classifyProviderHttpFailure,
  classifyProviderTransportFailure,
} from './ai-provider-errors';

describe('sanitized provider failure contract', () => {
  it.each([
    [400, 'ai_provider_invalid_request', 502],
    [401, 'ai_provider_authentication_failed', 502],
    [402, 'ai_provider_insufficient_balance', 502],
    [403, 'ai_provider_access_denied', 502],
    [404, 'ai_provider_model_unavailable', 502],
    [422, 'ai_provider_invalid_parameters', 502],
    [429, 'ai_provider_rate_limit', 429],
    [500, 'ai_provider_error', 503],
    [503, 'ai_provider_error', 503],
    [418, 'ai_provider_error', 503],
  ])(
    'classifies upstream HTTP %i without conflating ASA authentication',
    (upstream, code, status) => {
      expect(classifyProviderHttpFailure(upstream as number)).toMatchObject({ code, status });
    },
  );
  it('distinguishes a timeout from an outgoing connection failure', () => {
    expect(classifyProviderTransportFailure(true)).toMatchObject({
      code: 'ai_provider_timeout',
      status: 504,
    });
    expect(classifyProviderTransportFailure(false)).toMatchObject({
      code: 'ai_provider_unavailable',
      status: 503,
    });
  });
});
