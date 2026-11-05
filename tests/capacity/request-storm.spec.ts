import { describe, expect, it } from 'vitest';
import {
  assertStormEnvironment,
  stormRoute,
  summarizeStorm,
} from '../../tools/capacity/request-storm-contracts.mjs';

const fixture = () => ({
  ASA_REQUEST_STORM: '1',
  ASA_STORM_USERS: '60',
  ASA_STORM_VARIANT: 'candidate',
  ASA_STORM_SOURCE_SHA: 'a'.repeat(40),
  ASA_STORM_RUN_ID: '12345678-1234-4234-8234-123456789012',
  TEST_DATABASE_URL:
    'postgresql://postgres:fixture@127.0.0.1:5432/asa_request_storm_candidate_test',
  APP_TEST_DATABASE_URL:
    'postgresql://asalab_app:fixture@127.0.0.1:5432/asa_request_storm_candidate_test',
});

describe('request-storm workload boundaries and honest evidence', () => {
  it('accepts only the explicitly selected disposable fixture', () => {
    expect(assertStormEnvironment(fixture())).toMatchObject({ users: 60, variant: 'candidate' });
  });
  it.each([
    { ASA_REQUEST_STORM: '0' },
    { ASA_STORM_USERS: '3000' },
    { ASA_STORM_SOURCE_SHA: 'main' },
    { ASA_STORM_RUN_ID: '-'.repeat(36) },
    { ASA_STORM_VARIANT: 'baseline' },
    {
      TEST_DATABASE_URL:
        'postgresql://postgres:fixture@asa-lab.ru:5432/asa_request_storm_candidate_test',
    },
    { TEST_DATABASE_URL: 'postgresql://postgres:fixture@127.0.0.1:5432/asalab' },
    {
      APP_TEST_DATABASE_URL:
        'postgresql://postgres:fixture@127.0.0.1:5432/asa_request_storm_candidate_test',
    },
    {
      APP_TEST_DATABASE_URL:
        'postgresql://asalab_app:fixture@127.0.0.1:5432/asa_request_storm_baseline_test',
    },
  ])('rejects unsafe fixture override %j', (change) => {
    expect(() => assertStormEnvironment({ ...fixture(), ...change })).toThrow();
  });
  it('does not hide real 5xx among deliberate injected outages or count setup as load', () => {
    const records = [
      { client: -1, phase: 'setup', route: '/api/auth/register', status: 201, durationMs: 2 },
      {
        client: 0,
        phase: 'outage',
        route: '/api/projects',
        status: 503,
        durationMs: 4,
        injected: true,
      },
      {
        client: 1,
        phase: 'steady',
        route: '/api/projects',
        status: 503,
        durationMs: 100,
        injected: false,
      },
      {
        client: 1,
        phase: 'steady',
        route: '/api/modules',
        status: 200,
        durationMs: 20,
        injected: false,
      },
    ];
    expect(summarizeStorm(records, 1000, 2)).toMatchObject({
      requests: 3,
      requestsPerSecond: 3,
      requestsPerClient: 1.5,
      injectedFailures: 1,
      unexpected5xx: 1,
      latencyMs: { count: 2, p95: 100 },
    });
    expect(stormRoute('/api/projects/12345678-1234-4234-8234-123456789012?secret=redacted')).toBe(
      '/api/projects/:id',
    );
    expect(stormRoute('/api/games/chess/invites/synthetic-private-code/accept')).toBe(
      '/api/games/chess/invites/:code/accept',
    );
  });
});
