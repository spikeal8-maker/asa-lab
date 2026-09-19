import { describe, expect, it, vi } from 'vitest';
import type { ProjectRepositoryPort } from '@asa-lab/projects';
import { BlocksProjectRuntimeAuthority } from './blocks-runtime-authority.js';

const TENANT = '11111111-1111-4111-8111-111111111111';
const PRINCIPAL = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const PROJECT = '44444444-4444-4444-8444-444444444444';
const VERSION = '55555555-5555-4555-8555-555555555555';

function repository(
  options: {
    moduleKey?: string;
    tenantId?: string;
    projectId?: string;
    allow?: boolean;
    versions?: readonly string[];
  } = {},
) {
  const authorize = vi.fn(async () =>
    options.allow === false
      ? null
      : {
          tenantId: options.tenantId ?? TENANT,
          userId: USER,
          projectId: options.projectId ?? PROJECT,
          moduleKey: options.moduleKey ?? 'blocks',
          status: 'active' as const,
        },
  );
  const listVersions = vi.fn(async () =>
    (options.versions ?? [VERSION]).map((id, index) => ({
      id,
      projectId: PROJECT,
      versionNo: index + 1,
      label: null,
      createdAt: 'now',
    })),
  );
  const port = { authorize, listVersions } as unknown as ProjectRepositoryPort;
  return { port, authorize, listVersions };
}

function editor(
  permissions: readonly (
    'project:read' | 'asset:read' | 'asset:write' | 'draft:write' | 'snapshot:write'
  )[],
) {
  return {
    tenantId: TENANT,
    principalId: PRINCIPAL,
    projectId: PROJECT,
    mode: 'editor' as const,
    versionId: null,
    permissions,
  };
}

function player(
  versionId: string,
  permissions: readonly ('project:read' | 'asset:read')[] = ['project:read'],
) {
  return {
    tenantId: TENANT,
    principalId: PRINCIPAL,
    projectId: PROJECT,
    mode: 'player' as const,
    versionId,
    permissions,
  };
}
describe('BlocksProjectRuntimeAuthority', () => {
  it('requires edit authority when any write permission is present', async () => {
    const h = repository();
    const authority = new BlocksProjectRuntimeAuthority(h.port);
    await expect(authority.allows(editor(['project:read', 'draft:write']))).resolves.toBe(true);
    expect(h.authorize).toHaveBeenCalledWith(TENANT, PROJECT, PRINCIPAL, 'edit');
  });

  it('uses read authority for read-only editor operations', async () => {
    const h = repository();
    const authority = new BlocksProjectRuntimeAuthority(h.port);
    await expect(authority.allows(editor(['asset:read']))).resolves.toBe(true);
    expect(h.authorize).toHaveBeenCalledWith(TENANT, PROJECT, PRINCIPAL, 'read');
  });

  it('denies missing, wrong-module, cross-tenant and mismatched-project authority', async () => {
    for (const options of [
      { allow: false },
      { moduleKey: 'electronics' },
      { tenantId: '66666666-6666-4666-8666-666666666666' },
      { projectId: '77777777-7777-4777-8777-777777777777' },
    ]) {
      const h = repository(options);
      await expect(
        new BlocksProjectRuntimeAuthority(h.port).allows(editor(['project:read'])),
      ).resolves.toBe(false);
    }
  });
  it('allows a player only for an exact authorised immutable version', async () => {
    const h = repository({ versions: [VERSION] });
    const authority = new BlocksProjectRuntimeAuthority(h.port);
    await expect(authority.allows(player(VERSION, ['project:read', 'asset:read']))).resolves.toBe(
      true,
    );
    expect(h.authorize).toHaveBeenCalledWith(TENANT, PROJECT, PRINCIPAL, 'read');
    expect(h.listVersions).toHaveBeenCalledTimes(1);
  });

  it('denies a player when the bound version is no longer related to the project', async () => {
    const h = repository({ versions: [] });
    await expect(new BlocksProjectRuntimeAuthority(h.port).allows(player(VERSION))).resolves.toBe(
      false,
    );
  });

  it('denies editor bindings with a version and player bindings without one', async () => {
    const h = repository();
    const authority = new BlocksProjectRuntimeAuthority(h.port);
    await expect(
      authority.allows({ ...editor(['project:read']), versionId: VERSION }),
    ).resolves.toBe(false);
    await expect(authority.allows({ ...player(VERSION), versionId: null })).resolves.toBe(false);
  });
});
