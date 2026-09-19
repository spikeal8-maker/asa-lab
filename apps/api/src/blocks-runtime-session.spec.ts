import { describe, expect, it, vi } from 'vitest';
import type { ProjectRepositoryPort } from '@asa-lab/projects';
import { BlocksRuntimeCapabilityService } from './blocks-runtime-capability.js';
import { BlocksRuntimeSessionService } from './blocks-runtime-session.js';

const TENANT = '11111111-1111-4111-8111-111111111111';
const PRINCIPAL = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const PROJECT = '44444444-4444-4444-8444-444444444444';
const ORIGIN = 'http://localhost:4613';
const asset = {
  assetId: 'a'.repeat(32),
  dataFormat: 'png' as const,
  sha256: 'b'.repeat(64),
  sizeBytes: 3,
};
const document = {
  schemaVersion: 1 as const,
  format: 'scratch-3' as const,
  projectJson: { targets: [], monitors: [], extensions: [] },
  assets: [asset],
};

function fixture(
  options: { moduleKey?: string; validDocument?: boolean; revokeAfterLoad?: boolean } = {},
) {
  let authorizeCalls = 0;
  const authorize = vi.fn(async () => {
    authorizeCalls += 1;
    if (options.revokeAfterLoad && authorizeCalls > 1) return null;
    return {
      tenantId: TENANT,
      userId: USER,
      projectId: PROJECT,
      moduleKey: options.moduleKey ?? 'blocks',
      status: 'active' as const,
    };
  });
  const load = vi.fn(async () => ({
    project: {
      id: PROJECT,
      scope: 'personal' as const,
      classroomId: null,
      moduleKey: options.moduleKey ?? 'blocks',
      title: 'Program',
      status: 'active' as const,
      createdAt: 'now',
      updatedAt: 'now',
      preview: null,
      snapshotRevision: null,
      description: null,
      tags: [],
      license: 'private',
      copiedFrom: null,
    },
    draft: {
      projectId: PROJECT,
      document: options.validDocument === false ? { bad: true } : document,
      revision: 7,
      updatedAt: 'now',
      preview: null,
    },
    versions: [],
  }));
  const repository = { authorize, load } as unknown as ProjectRepositoryPort;
  const capability = new BlocksRuntimeCapabilityService({
    key: new Uint8Array(32).fill(7),
    runtimeOrigin: ORIGIN,
    authority: { allows: async () => true },
    now: () => 1_700_000_000,
  });
  return {
    authorize,
    load,
    service: new BlocksRuntimeSessionService(repository, capability, ORIGIN),
  };
}
describe('BlocksRuntimeSessionService', () => {
  it('issues a real editor token with the exact durable Blocks bootstrap', async () => {
    const f = fixture();
    const result = await f.service.issueEditor(
      { tenantId: TENANT, principalId: PRINCIPAL, userId: USER },
      PROJECT,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      runtimeOrigin: ORIGIN,
      expiresAt: 1_700_000_600,
      draftRevision: 7,
      projectJson: document.projectJson,
      assets: [asset],
    });
    expect(result.value.runtimeToken.split('.')).toHaveLength(3);
    expect(f.authorize).toHaveBeenCalledTimes(2);
  });

  it('denies a project from another module before returning bootstrap bytes', async () => {
    const f = fixture({ moduleKey: 'electronics' });
    await expect(
      f.service.issueEditor({ tenantId: TENANT, principalId: PRINCIPAL, userId: USER }, PROJECT),
    ).resolves.toEqual({ ok: false, code: 'project_unavailable' });
    expect(f.load).not.toHaveBeenCalled();
  });
  it('rejects a corrupt Blocks draft instead of minting a usable bootstrap', async () => {
    const f = fixture({ validDocument: false });
    await expect(
      f.service.issueEditor({ tenantId: TENANT, principalId: PRINCIPAL, userId: USER }, PROJECT),
    ).resolves.toEqual({ ok: false, code: 'project_invalid' });
  });

  it('fails closed when project authority is revoked during session issuance', async () => {
    const f = fixture({ revokeAfterLoad: true });
    await expect(
      f.service.issueEditor({ tenantId: TENANT, principalId: PRINCIPAL, userId: USER }, PROJECT),
    ).resolves.toEqual({ ok: false, code: 'project_unavailable' });
  });

  it('maps storage/project exceptions to dependency_unavailable without raw details', async () => {
    const f = fixture();
    f.authorize.mockRejectedValueOnce(new Error('secret database details'));
    await expect(
      f.service.issueEditor({ tenantId: TENANT, principalId: PRINCIPAL, userId: USER }, PROJECT),
    ).resolves.toEqual({ ok: false, code: 'dependency_unavailable' });
  });
});
