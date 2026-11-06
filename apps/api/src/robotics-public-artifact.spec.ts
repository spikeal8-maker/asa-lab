import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import { ModuleRegistry } from '@asa-lab/module-sdk';
import { ROBOTICS_MODULE } from '@asa-lab/robotics';
import { createInitialRoboticsProject } from '@asa-lab/robotics/document';
import { PublicArtifactService, createPublicArtifactAdapters } from './public-project-artifact';

const publicationId = '123e4567-e89b-42d3-a456-426614174001';
const revisionId = '123e4567-e89b-42d3-a456-426614174002';
function project() {
  const initial = createInitialRoboticsProject();
  return {
    ...initial,
    circuit: {
      ...initial.circuit,
      components: initial.circuit.components.map((component) =>
        component.id === initial.world.bindings.boardId
          ? {
              ...component,
              stateProperties: {
                ...component.stateProperties,
                arduinoSource: '// PRIVATE_SOURCE\nvoid setup(){}void loop(){}',
                arduinoWorkspace: JSON.stringify({ privateEditorLabel: 'PRIVATE_WORKSPACE' }),
              },
            }
          : component,
      ),
    },
  };
}
function setup(document: unknown = project()) {
  const registry = new ModuleRegistry([ROBOTICS_MODULE]);
  const row = {
    publication_id: publicationId,
    revision_id: revisionId,
    revision_no: 2,
    module_key: 'robotics',
    document_json: document,
  };
  const query = vi.fn().mockResolvedValue({ rows: [row] });
  return {
    row,
    query,
    pool: { query } as unknown as pg.Pool,
    service: new PublicArtifactService(registry),
    registry,
  };
}

describe('canonical Robotics public projection', () => {
  it('projects source geometry from a real provider without programs, physical/runtime data or bindings', async () => {
    const { service, pool } = setup();
    const artifact = await service.read(pool, publicationId, revisionId);
    expect(artifact).toMatchObject({
      schemaVersion: 5,
      viewerFamily: 'robotics',
      status: 'display',
      provenance: { publicationId, revisionNumber: 2 },
      capabilities: { readOnly: true, interactive: true, download: false },
      world: { field: { widthMeters: 1.8, heightMeters: 1.8 } },
    });
    expect(JSON.stringify(artifact)).not.toMatch(
      /PRIVATE|circuit|components|arduino|bindings|physicsProfile|massKg|friction|restitution|velocity|runtime|simulation/,
    );
  });

  it('uses the canonical provider to reject invalid electronics even when geometry is valid', async () => {
    const document = project();
    const { service, pool } = setup({ ...document, circuit: { schemaVersion: 999 } });
    expect(await service.read(pool, publicationId, revisionId)).toMatchObject({
      schemaVersion: 1,
      status: 'static-only',
      viewerFamily: 'robotics',
      capabilities: { interactive: false },
    });
  });

  it('reauthorizes cached geometry and rejects stale, revoked or mismatched published revisions', async () => {
    const { service, pool, query, row } = setup();
    const first = await service.read(pool, publicationId, revisionId);
    row.document_json = { private: 'NEW_PRIVATE_DRAFT' };
    expect(await service.read(pool, publicationId, revisionId)).toEqual(first);
    expect(query).toHaveBeenCalledTimes(2);
    query.mockResolvedValue({ rows: [] });
    await expect(service.read(pool, publicationId, revisionId)).rejects.toThrow();
    query.mockResolvedValue({ rows: [{ ...row, revision_id: publicationId }] });
    await expect(service.read(pool, publicationId, revisionId)).rejects.toThrow();
  });

  it('refuses oversized and accessor-bearing raw documents before invoking the provider', () => {
    const { registry } = setup();
    const adapter = createPublicArtifactAdapters(registry).get('robotics')!;
    const provenance = { publicationId, revisionNumber: 1 };
    expect(adapter({ ...project(), private: 'x'.repeat(1048577) }, provenance)).toBeNull();
    const accessor = project();
    const read = vi.fn(() => 'PRIVATE');
    Object.defineProperty(accessor, 'private', { get: read, enumerable: true });
    expect(adapter(accessor, provenance)).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });
});
