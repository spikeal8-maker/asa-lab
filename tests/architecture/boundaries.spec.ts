import { describe, it, expect } from 'vitest';
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
});
