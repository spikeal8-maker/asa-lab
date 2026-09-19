import { describe, expect, it, vi } from 'vitest';
import type { ProjectRepositoryPort } from '@asa-lab/projects';
import { BlocksRuntimeCapabilityService } from './blocks-runtime-capability.js';
import { BlocksProjectRuntimeAuthority } from './blocks-runtime-authority.js';
import { BlocksRuntimeRequestAuthorizer } from './blocks-runtime-request.js';

const TENANT = '11111111-1111-4111-8111-111111111111';
const PRINCIPAL = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const PROJECT = '44444444-4444-4444-8444-444444444444';
const OTHER_PROJECT = '55555555-5555-4555-8555-555555555555';
const ORIGIN = 'http://localhost:4613';

async function fixture() {
  let allowed = true;
  let moduleKey = 'blocks';
  const authorize = vi.fn(async (_tenant: string, projectId: string) =>
    allowed
      ? {
          tenantId: TENANT,
          userId: USER,
          projectId,
          moduleKey,
          status: 'active' as const,
        }
      : null,
  );
  const repository = { authorize } as unknown as ProjectRepositoryPort;
  const capability = new BlocksRuntimeCapabilityService({
    key: new Uint8Array(32).fill(9),
    runtimeOrigin: ORIGIN,
    authority: new BlocksProjectRuntimeAuthority(repository),
    now: () => 1_700_000_000,
  });
  const issued = await capability.issue({
    tenantId: TENANT,
    principalId: PRINCIPAL,
    projectId: PROJECT,
    mode: 'editor',
    versionId: null,
  });
  if (!issued.ok) throw new Error(`fixture capability issue failed: ${issued.code}`);
  authorize.mockClear();
  return {
    authorize,
    capability,
    token: issued.value.token,
    request: new BlocksRuntimeRequestAuthorizer(repository, capability, ORIGIN),
    revoke: () => {
      allowed = false;
    },
    setModule: (value: string) => {
      moduleKey = value;
    },
  };
}

describe('BlocksRuntimeRequestAuthorizer', () => {
  it('accepts exact Origin/Bearer/project and resolves the current Project Core actor', async () => {
    const f = await fixture();
    const result = await f.request.authorize({
      authorization: `Bearer ${f.token}`,
      origin: ORIGIN,
      projectId: PROJECT,
      permission: 'draft:write',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.actor).toEqual({ principalId: PRINCIPAL, userId: USER });
    expect(result.value.grant.projectId).toBe(PROJECT);
  });
  it('rejects wrong origin before capability or project checks', async () => {
    const f = await fixture();
    await expect(
      f.request.authorize({
        authorization: `Bearer ${f.token}`,
        origin: 'https://evil.example',
        projectId: PROJECT,
        permission: 'project:read',
      }),
    ).resolves.toEqual({ ok: false, code: 'forbidden_origin' });
    expect(f.authorize).not.toHaveBeenCalled();
  });

  it.each([undefined, '', `bearer token`, `Bearer ${'x'.repeat(20)}`])(
    'rejects missing or malformed Authorization %#',
    async (authorization) => {
      const f = await fixture();
      await expect(
        f.request.authorize({
          authorization,
          origin: ORIGIN,
          projectId: PROJECT,
          permission: 'asset:read',
        }),
      ).resolves.toEqual({ ok: false, code: 'unauthorized' });
    },
  );

  it('rejects a token replayed on another project path', async () => {
    const f = await fixture();
    await expect(
      f.request.authorize({
        authorization: `Bearer ${f.token}`,
        origin: ORIGIN,
        projectId: OTHER_PROJECT,
        permission: 'project:read',
      }),
    ).resolves.toEqual({ ok: false, code: 'invalid_token' });
  });
  it('rechecks current authority and denies a revoked token immediately', async () => {
    const f = await fixture();
    f.revoke();
    await expect(
      f.request.authorize({
        authorization: `Bearer ${f.token}`,
        origin: ORIGIN,
        projectId: PROJECT,
        permission: 'asset:read',
      }),
    ).resolves.toEqual({ ok: false, code: 'authority_denied' });
  });

  it('fails closed if the project is no longer a Blocks project', async () => {
    const f = await fixture();
    f.setModule('electronics');
    await expect(
      f.request.authorize({
        authorization: `Bearer ${f.token}`,
        origin: ORIGIN,
        projectId: PROJECT,
        permission: 'project:read',
      }),
    ).resolves.toEqual({ ok: false, code: 'authority_denied' });
  });

  it('requires the token profile to contain the requested write permission', async () => {
    const f = await fixture();
    await expect(
      f.request.authorize({
        authorization: `Bearer ${f.token}`,
        origin: ORIGIN,
        projectId: PROJECT,
        permission: 'snapshot:write',
      }),
    ).resolves.toMatchObject({ ok: true });
  });
});
