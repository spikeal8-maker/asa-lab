import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(root, '../..');

/** Canonical ports per docs/delivery/LOCAL_PORT_POLICY.md. Overrides come from
 * the same ASA_* variables tools/dev.mjs uses; forbidden legacy dev ports are
 * rejected even via override. */
const FORBIDDEN_PORTS = new Set([3000, 3100, 5173]);

function resolvePort(variable: string, fallback: number): number {
  const raw = process.env[variable];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || String(value) !== raw.trim() || value < 1024 || value > 65535) {
    throw new Error(`${variable} must be an integer port in 1024..65535, got: ${raw}`);
  }
  if (FORBIDDEN_PORTS.has(value)) {
    throw new Error(`${variable}=${value} is forbidden by LOCAL_PORT_POLICY`);
  }
  return value;
}

const webPort = resolvePort('ASA_WEB_PORT', 4610);
const apiPort = resolvePort('ASA_API_PORT', 4611);

export default defineConfig({
  root,
  plugins: [react()],
  resolve: {
    alias: {
      '@asa-lab/electronics': resolve(repositoryRoot, 'contexts/electronics/index.ts'),
    },
  },
  define: {
    __ASA_BUILD_REVISION__: JSON.stringify(process.env['VITE_ASA_BUILD_REVISION'] ?? 'development'),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    commonjsOptions: {
      include: [/node_modules/, /contexts\/chess\/dist/, /packages\/module-sdk\/dist/],
    },
  },
  server: {
    port: webPort,
    strictPort: true,
    host: '127.0.0.1',
    proxy: {
      '/api': `http://127.0.0.1:${apiPort}`,
      '/health': `http://127.0.0.1:${apiPort}`,
    },
  },
});
