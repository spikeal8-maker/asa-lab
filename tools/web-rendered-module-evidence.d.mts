import type { Plugin } from 'vite';
export function renderedModuleEvidence(options: {
  revision: string;
  repositoryRoot: string;
  output: string;
}): Plugin;
