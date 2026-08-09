// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import nxPlugin from '@nx/eslint-plugin';

/**
 * Module-boundary constraints enforce the modular-monolith invariants:
 * - core code never imports subject modules;
 * - subject modules never import core internals;
 * - identity, organization and classroom do not depend on one another;
 * - chess rules stay transport-independent;
 * - chess-live may depend on chess rules, never the reverse;
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
    sourceTag: 'scope:platform-ui',
    onlyDependOnLibsWithTags: ['scope:platform-ui', 'scope:shared', 'scope:contract'],
  },
  {
    sourceTag: 'scope:contract',
    onlyDependOnLibsWithTags: ['scope:contract'],
  },
  {
    sourceTag: 'scope:app',
    onlyDependOnLibsWithTags: [
      'scope:core',
      'scope:module',
      'scope:platform-ui',
      'scope:shared',
      'scope:contract',
    ],
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
    sourceTag: 'context:projects',
    onlyDependOnLibsWithTags: ['context:projects', 'scope:shared', 'scope:contract'],
  },
  {
    sourceTag: 'context:electronics',
    onlyDependOnLibsWithTags: ['context:electronics', 'scope:shared', 'scope:contract'],
  },
  {
    sourceTag: 'context:chess',
    onlyDependOnLibsWithTags: ['context:chess', 'scope:shared', 'scope:contract'],
  },
  {
    sourceTag: 'context:chess-live',
    onlyDependOnLibsWithTags: [
      'context:chess-live',
      'context:chess',
      'scope:shared',
      'scope:contract',
    ],
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
