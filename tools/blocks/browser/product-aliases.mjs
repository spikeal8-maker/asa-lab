import { URL, fileURLToPath } from 'node:url';

// Match the shipping Web build's pure 3D subpath resolution. Workspace dist is
// CommonJS; this configFile:false fixture must consume the real TypeScript
// modules rather than asking Rollup to infer named exports from workspace CJS.
export const productAliases = [
  {
    find: /^@asa-lab\/three-d\/document$/,
    replacement: fileURLToPath(
      new URL('../../../contexts/three-d/domain/document.ts', import.meta.url),
    ),
  },
  {
    find: /^@asa-lab\/three-d\/operations$/,
    replacement: fileURLToPath(
      new URL('../../../contexts/three-d/domain/operations.ts', import.meta.url),
    ),
  },
];
