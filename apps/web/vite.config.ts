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

export default defineConfig(({ command }) => ({
  root,
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: '@asa-lab/electronics/simulation',
        replacement: resolve(repositoryRoot, 'contexts/electronics/simulation.ts'),
      },
      {
        find: '@asa-lab/electronics',
        replacement: resolve(repositoryRoot, 'contexts/electronics/index.ts'),
      },
      {
        find: '@asa-lab/three-d',
        replacement: resolve(repositoryRoot, 'contexts/three-d/index.ts'),
      },
      // These resolve to CommonJS bundles. `vite build` converts them — see
      // commonjsOptions below — but the dev server served them raw as ES modules,
      // so the first named import threw and the whole application failed to
      // mount: the editor could not be opened at all. Serving reads the same
      // sources electronics already does. The build is left exactly as it was,
      // because a dev-server problem is no reason to change what ships.
      ...(command === 'serve'
        ? [
            {
              find: '@asa-lab/chess',
              replacement: resolve(repositoryRoot, 'contexts/chess/index.ts'),
            },
            {
              find: '@asa-lab/module-sdk',
              replacement: resolve(repositoryRoot, 'packages/module-sdk/src/index.ts'),
            },
          ]
        : []),
    ],
  },
  define: {
    __ASA_BUILD_REVISION__: JSON.stringify(process.env['VITE_ASA_BUILD_REVISION'] ?? 'development'),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/.pnpm/three@') || id.includes('/node_modules/three/')) {
            return 'three-vendor';
          }
          return undefined;
        },
      },
    },
    commonjsOptions: {
      include: [/node_modules/, /contexts\/chess\/dist/, /packages\/module-sdk\/dist/],
    },
  },
  server: {
    port: webPort,
    strictPort: true,
    host: '127.0.0.1',
    proxy: {
      // The API accepts a state-changing request from exactly one origin,
      // http://127.0.0.1:<web port>, and refuses every other — localhost
      // included, deliberately, so that another local service cannot become a
      // trusted origin by accident. Opening the dev server as localhost, or
      // through a WSL address, therefore loaded a working editor whose every save
      // came back "request origin is not allowed": a wall with nothing to do with
      // the work in front of it.
      //
      // The dev proxy states the canonical origin on the way through. It is the
      // dev server's own application it is forwarding, and this file's `server`
      // block has no effect on `vite build` — the shipped application still faces
      // the policy exactly as written.
      '/api': {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: false,
        headers: { Origin: `http://127.0.0.1:${webPort}` },
      },
      '/health': `http://127.0.0.1:${apiPort}`,
    },
  },
}));
