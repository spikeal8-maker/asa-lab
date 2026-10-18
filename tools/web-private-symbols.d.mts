import type { Plugin } from 'vite';
export function privateSymbols(options: {
  revision: string;
  repositoryRoot: string;
  output: string;
  publicKey: string;
}): Plugin;
