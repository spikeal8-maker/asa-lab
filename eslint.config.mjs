// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import nxPlugin from '@nx/eslint-plugin';

/**
 * Module-boundary constraints enforce the core platform invariant:
 * Classroom Core (scope:core) never imports subject modules (scope:module),
 * and subject modules never import core internals.
 */
export const depConstraints = [
  {
    sourceTag: 'scope:core',
    onlyDependOnLibsWithTags: ['scope:core', 'scope:shared', 'scope:contract'],
  },
  {
    sourceTag: 'scope:module',
    onlyDependOnLibsWithTags: ['scope:module', 'scope:shared', 'scope:contract'],
  },
  {
    sourceTag: 'scope:shared',
    onlyDependOnLibsWithTags: ['scope:shared', 'scope:contract'],
  },
  {
    sourceTag: 'scope:contract',
    onlyDependOnLibsWithTags: ['scope:contract'],
  },
  {
    sourceTag: 'scope:app',
    onlyDependOnLibsWithTags: ['scope:core', 'scope:module', 'scope:shared', 'scope:contract'],
  },
  {
    sourceTag: 'type:app',
    onlyDependOnLibsWithTags: ['type:lib'],
  },
  {
    sourceTag: 'type:lib',
    onlyDependOnLibsWithTags: ['type:lib'],
  },
];

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/out-tsc/**',
      '**/node_modules/**',
      '.nx/**',
      'reports/**',
      'coverage/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    plugins: { '@nx': nxPlugin },
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: [],
          depConstraints,
        },
      ],
    },
  },
);
