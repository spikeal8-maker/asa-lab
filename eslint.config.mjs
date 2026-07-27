// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import nxPlugin from '@nx/eslint-plugin';

/**
 * Module-boundary constraints enforce the modular-monolith invariants:
 * - core code never imports subject modules;
 * - subject modules never import core internals;
 * - identity, organization and classroom do not depend on one another;
 * - applications compose contexts through their public package roots.
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
    sourceTag: 'context:identity',
    onlyDependOnLibsWithTags: ['context:identity', 'scope:shared', 'scope:contract'],
  },
  {
    sourceTag: 'context:organization',
    onlyDependOnLibsWithTags: ['context:organization', 'scope:shared', 'scope:contract'],
  },
  {
    sourceTag: 'context:classroom',
    onlyDependOnLibsWithTags: ['context:classroom', 'scope:shared', 'scope:contract'],
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
    files: ['**/*.ts', '**/*.tsx'],
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
