// @ts-check
// Dedicated configuration for `pnpm boundaries:check`: it enables ONLY the
// module-boundary rule so architectural isolation is verifiable independently
// of general linting.
import tseslint from 'typescript-eslint';
import nxPlugin from '@nx/eslint-plugin';
import { depConstraints } from './eslint.config.mjs';

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
  {
    files: ['**/*.ts'],
    languageOptions: { parser: tseslint.parser },
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
