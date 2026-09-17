import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { ProjectActor, ProjectRepositoryPort } from '@asa-lab/projects';
import type { BlocksAssetReferenceV1 } from '@asa-lab/blocks';
import { BlocksDraftAssetReader } from './blocks-asset-read.js';
import type { BlocksAssetMetadataPort } from './blocks-persistence.guard.js';
import type { BlocksBlobStorePort } from './blocks-asset-storage.js';

const TENANT = '11111111-1111-4111-8111-111111111111';
const PROJECT = '22222222-2222-4222-8222-222222222222';
const PRINCIPAL = '33333333-3333-4333-8333-333333333333';
const USER = '44444444-4444-4444-8444-444444444444';
const actor: ProjectActor = { principalId: PRINCIPAL, userId: USER };
const reference: BlocksAssetReferenceV1 = {
  assetId: 'a'.repeat(32),
  dataFormat: 'png',
  sha256: 'b'.repeat(64),
  sizeBytes: 3,
};
const document = {
  schemaVersion: 1,
  format: 'scratch-3',
  projectJson: { targets: [], monitors: [], extensions: [] },
  assets: [reference],
};

type LoadedProject = NonNullable<Awaited<ReturnType<ProjectRepositoryPort['load']>>>;
function project(
  documentValue: unknown = document,
  moduleKey = 'blocks',
  status: 'active' | 'archived' | 'trashed' = 'active',
): LoadedProject {
  return {
    project: {
      id: PROJECT,
      scope: 'personal' as const,
      classroomId: null,
      moduleKey,
      title: 'Program',
      status,
      createdAt: 'now',
      updatedAt: 'now',
      preview: null,
      snapshotRevision: null,
      description: null,
      tags: [],
      license: 'CC-BY-4.0',
      copiedFrom: null,
    },
    draft: {
      projectId: PROJECT,
      document: documentValue,
      revision: 2,
      updatedAt: 'now',
      preview: null,
    },
    versions: [],
  };
}

function harness(loaded: ReturnType<typeof project> | null = project()) {
  const load = vi.fn(async (...args: Parameters<ProjectRepositoryPort['load']>) => {
    void args;
    return loaded;
  });
  const projects = { load } as unknown as ProjectRepositoryPort;
  const metadata: BlocksAssetMetadataPort = {
    resolve: vi.fn(async () => ({ ...reference, tenantId: TENANT, blobCommitted: true })),
  };
  const blobs: BlocksBlobStorePort = {
    exists: vi.fn(async () => true),
    putImmutable: vi.fn(async () => ({ objectKey: 'unused' })),
    open: vi.fn(async () => Readable.from([Buffer.from([1, 2, 3])])),
  };
  return {
    load,
    metadata,
    blobs,
    reader: new BlocksDraftAssetReader(projects, metadata, blobs),
  };
}

async function bytes(body: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const part of body) parts.push(Buffer.from(part));
  return Buffer.concat(parts);
}

const request = () => ({
  tenantId: TENANT,
  projectId: PROJECT,
  actor: { ...actor },
  assetId: reference.assetId,
  dataFormat: reference.dataFormat,
});

describe('reference-authorised Blocks draft asset read', () => {
  it('returns exact private bytes only after project, document and metadata checks', async () => {
    const h = harness();
    const result = await h.reader.read(request());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('read failed');
    expect(result.value.reference).toEqual(reference);
    expect(await bytes(result.value.body)).toEqual(Buffer.from([1, 2, 3]));
    expect(h.metadata.resolve).toHaveBeenCalledWith({
      tenantId: TENANT,
      assetId: reference.assetId,
      dataFormat: 'png',
    });
  });
  it('does not treat an unreferenced same-tenant alias as project authority', async () => {
    const h = harness(project({ ...document, assets: [] }));
    await expect(h.reader.read(request())).resolves.toEqual({
      ok: false,
      code: 'asset_not_found',
    });
    expect(h.metadata.resolve).not.toHaveBeenCalled();
    expect(h.blobs.open).not.toHaveBeenCalled();
  });

  it.each([
    ['inaccessible project', null],
    ['other module', project(document, 'electronics')],
    ['trashed project', project(document, 'blocks', 'trashed')],
  ])('denies %s before asset metadata lookup', async (_label, loaded) => {
    const h = harness(loaded);
    await expect(h.reader.read(request())).resolves.toEqual({
      ok: false,
      code: 'project_not_found',
    });
    expect(h.metadata.resolve).not.toHaveBeenCalled();
    expect(h.blobs.open).not.toHaveBeenCalled();
  });

  it('fails closed when stored metadata disagrees with the project reference', async () => {
    const h = harness();
    vi.mocked(h.metadata.resolve).mockResolvedValueOnce({
      ...reference,
      tenantId: TENANT,
      sha256: 'c'.repeat(64),
      blobCommitted: true,
    });
    await expect(h.reader.read(request())).resolves.toEqual({
      ok: false,
      code: 'dependency_unavailable',
    });
    expect(h.blobs.open).not.toHaveBeenCalled();
  });

  it('fails closed when the exact private blob is missing', async () => {
    const h = harness();
    vi.mocked(h.blobs.open).mockResolvedValueOnce(null);
    await expect(h.reader.read(request())).resolves.toEqual({
      ok: false,
      code: 'dependency_unavailable',
    });
  });

  it('rejects malformed bindings before Project Core is consulted', async () => {
    const h = harness();
    await expect(h.reader.read({ ...request(), projectId: 'not-a-uuid' })).resolves.toEqual({
      ok: false,
      code: 'invalid_request',
    });
    await expect(h.reader.read({ ...request(), assetId: 'A'.repeat(32) })).resolves.toEqual({
      ok: false,
      code: 'invalid_request',
    });
    expect(h.load).not.toHaveBeenCalled();
  });

  it('fails closed on a malformed persisted Blocks document', async () => {
    const h = harness(project({ nope: true }));
    await expect(h.reader.read(request())).resolves.toEqual({
      ok: false,
      code: 'dependency_unavailable',
    });
  });
  it('snapshots the actor before asynchronous project access', async () => {
    const h = harness(null);
    let release!: (value: ReturnType<typeof project>) => void;
    const pending = new Promise<ReturnType<typeof project>>((resolve) => {
      release = resolve;
    });
    let observed: ProjectActor | null = null;
    h.load.mockImplementationOnce(async (_tenant, _project, seen) => {
      observed = seen;
      return pending;
    });
    const input = request();
    const reading = h.reader.read(input);
    input.actor.principalId = '55555555-5555-4555-8555-555555555555';
    release(project());
    const result = await reading;
    expect(result.ok).toBe(true);
    expect(observed).toEqual(actor);
  });
});
