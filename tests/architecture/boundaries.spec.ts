import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { depConstraints } from '../../eslint.config.mjs';

/**
 * Architectural test: proves the enforced module-boundary constraints keep the
 * core platform invariant. Classroom Core must never import subject modules and
 * subject modules must never import Classroom Core.
 */
describe('module boundary constraints', () => {
  it('forbids Classroom Core (scope:core) from importing subject modules', () => {
    const core = depConstraints.find((constraint) => constraint.sourceTag === 'scope:core');
    expect(core).toBeDefined();
    expect(core?.onlyDependOnLibsWithTags).not.toContain('scope:module');
  });

  it('forbids subject modules (scope:module) from importing Classroom Core', () => {
    const subjectModule = depConstraints.find(
      (constraint) => constraint.sourceTag === 'scope:module',
    );
    expect(subjectModule).toBeDefined();
    expect(subjectModule?.onlyDependOnLibsWithTags).not.toContain('scope:core');
  });

  it('treats Electronics and Chess as subject modules instead of core platform code', () => {
    const electronics = JSON.parse(readFileSync('modules/electronics/project.json', 'utf8')) as {
      tags: string[];
    };
    const chess = JSON.parse(readFileSync('modules/chess/project.json', 'utf8')) as {
      tags: string[];
    };
    expect(electronics.tags).toContain('scope:module');
    expect(chess.tags).toContain('scope:module');
    expect(electronics.tags).not.toContain('scope:core');
    expect(chess.tags).not.toContain('scope:core');
  });

  it('keeps Portal and shared editor chrome outside subject modules', () => {
    const portal = JSON.parse(readFileSync('packages/portal-shell/project.json', 'utf8')) as {
      tags: string[];
    };
    const editorHost = JSON.parse(readFileSync('packages/editor-host/project.json', 'utf8')) as {
      tags: string[];
    };
    expect(portal.tags).toContain('scope:platform-ui');
    expect(editorHost.tags).toContain('scope:shared');
    expect(portal.tags).not.toContain('scope:module');
    expect(editorHost.tags).not.toContain('scope:module');
  });

  it('keeps subject documents out of the generic web API client', () => {
    const apiClient = readFileSync('packages/web-api-client/src/index.ts', 'utf8');
    expect(apiClient).not.toContain('SchematicDocument');
    expect(apiClient).not.toContain('SchematicComponent');
    expect(apiClient).not.toContain('SolveResult');
  });
});
