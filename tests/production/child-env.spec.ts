import { describe, expect, it } from 'vitest';
import { apiChildEnv } from '../../tools/child-env.mjs';

describe('production API child environment', () => {
  it('uses the operating-system CA store without disabling TLS verification', () => {
    const env = apiChildEnv(
      {
        APP_DATABASE_URL: 'postgres://app@host/db',
        NODE_TLS_REJECT_UNAUTHORIZED: '1',
      },
      4611,
    );

    expect(env['NODE_USE_SYSTEM_CA']).toBe('1');
    expect(env['NODE_TLS_REJECT_UNAUTHORIZED']).toBe('1');
  });
});
