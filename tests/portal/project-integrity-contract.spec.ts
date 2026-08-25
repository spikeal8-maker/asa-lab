import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const source = (path: string): string => readFileSync(resolve(root, path), 'utf8');

describe('project integrity contract', () => {
  it('requires an exact base revision and an idempotent mutation id', () => {
    const controller = source('apps/api/src/projects.controller.ts');
    const repository = source('contexts/projects/infrastructure/pg-project.repository.ts');
    expect(controller).toContain("['document', 'baseRevision', 'mutationId']");
    expect(repository).toContain('d.revision=$8');
    expect(repository).toContain('last_mutation_id=$9::uuid');
    expect(repository).toContain('d.document_json=$5::jsonb');
  });

  it('keeps a local journal and flush trigger in every project editor', () => {
    const editors = [
      'apps/web/src/electronics/use-workbench-project-state.ts',
      'apps/web/src/chess/use-chess-project.ts',
      'apps/web/src/checkers/use-checkers-project.ts',
      'apps/web/src/three-d/use-three-d-project.ts',
    ];
    for (const editor of editors) {
      const code = source(editor);
      expect(code, editor).toContain('localStorage');
      expect(code, editor).toContain(".addEventListener('visibilitychange'");
      expect(code, editor).toContain("window.addEventListener('pagehide'");
    }
  });

  it('stores a snapshot only for the revision represented by its canvas', () => {
    const repository = source('contexts/projects/infrastructure/pg-project.repository.ts');
    const client = source('apps/web/src/modules/project-snapshot.ts');
    expect(repository).toContain('AND d.revision=$9');
    expect(client).toContain('captured.sourceRevision');
    expect(client).toContain('registered.revision()');
  });
});
