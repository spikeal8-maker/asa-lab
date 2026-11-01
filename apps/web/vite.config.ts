import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { privateSymbols } from '../../tools/web-private-symbols.mjs';

/** Opt-in private evidence from actual Rollup output, never original source text. */
function renderedModuleEvidence({
  revision,
  repositoryRoot,
  output,
  electronicsWorker = false,
}: {
  revision: string;
  repositoryRoot: string;
  output: string;
  electronicsWorker?: boolean;
}): Plugin {
  return {
    name: 'asa-publication-rendered-module-evidence',
    apply: 'build',
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        if (!/^[a-f0-9]{40}$/.test(revision)) throw Error('Invalid evidence revision');
        const sanitize = (id: string) => {
          const value = id.replaceAll('\0', '').replaceAll('\\', '/').split('?')[0];
          const path = relative(
            repositoryRoot,
            isAbsolute(value) ? value : resolve(repositoryRoot, value),
          );
          return path === '..' || path.startsWith(`..${sep}`)
            ? '<external>'
            : path.split(sep).join('/');
        };
        const assets: Record<
          string,
          {
            sha256: string;
            bytes: number;
            imports: string[];
            dynamicImports: string[];
            dynamicImportOwners: {
              importer: string;
              targetModule: string;
              targetFile: string | null;
            }[];
            modules: { id: string; renderedLength: number }[];
            zeroLengthModules: string[];
          }
        > = {};
        const moduleChunks = new Map<string, string>();
        for (const chunk of Object.values(bundle)) {
          if (chunk.type !== 'chunk') continue;
          for (const id of Object.keys(chunk.modules)) moduleChunks.set(id, chunk.fileName);
        }
        for (const chunk of Object.values(bundle)) {
          if (chunk.type !== 'chunk' || !chunk.fileName.endsWith('.js')) continue;
          const modules = Object.entries(chunk.modules).map(([id, module]) => ({
            id: sanitize(id),
            renderedLength: module.renderedLength,
          }));
          assets[`/${chunk.fileName}`] = {
            sha256: createHash('sha256').update(chunk.code).digest('hex'),
            bytes: Buffer.byteLength(chunk.code),
            imports: chunk.imports,
            dynamicImports: chunk.dynamicImports,
            dynamicImportOwners: Object.keys(chunk.modules).flatMap((importer) =>
              (this.getModuleInfo(importer)?.dynamicallyImportedIds ?? []).map((target) => ({
                importer: sanitize(importer),
                targetModule: sanitize(target),
                targetFile: moduleChunks.get(target) ?? null,
              })),
            ),
            modules: modules.filter((module) => module.renderedLength > 0),
            zeroLengthModules: modules
              .filter((module) => module.renderedLength === 0)
              .map((module) => module.id),
          };
        }
        if (!Object.keys(assets).length) throw Error('No rendered module evidence');
        if (
          electronicsWorker &&
          !Object.values(assets).some((asset) =>
            asset.modules.some(
              (module) => module.id === 'apps/web/src/electronics/simulation.worker.ts',
            ),
          )
        )
          return;
        mkdirSync(output, { recursive: true });
        writeFileSync(
          resolve(
            output,
            `${electronicsWorker ? 'web-electronics-worker' : 'web'}-rendered-modules-${revision}.json`,
          ),
          JSON.stringify({
            format: 'asa-web-rendered-modules-v1',
            revision,
            assets,
          }),
        );
      },
    },
  };
}

const root = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(root, '../..');
// A shared content fingerprint keeps fixed upstream filenames cache-safe while
// letting Blockly resolve all four existing media files from one directory.
const scratchMediaHash = createHash('sha256');
for (const name of ['sprites.png', 'zoom-in.svg', 'zoom-out.svg', 'zoom-reset.svg']) {
  scratchMediaHash.update(name);
  scratchMediaHash.update(readFileSync(resolve(root, 'node_modules/scratch-blocks/media', name)));
}
const scratchMediaDirectory = `assets/arduino-blockly-${scratchMediaHash.digest('hex').slice(0, 16)}`;

function isArduinoScratchMedia(path: string): boolean {
  return /[/\\]scratch-blocks[/\\]media[/\\](?:sprites\.png|zoom-(?:in|out|reset)\.svg)$/.test(
    path,
  );
}

/** Canonical ports per docs/delivery/LOCAL_PORT_POLICY.md. Overrides come from
 * the same ASA_* variables tools/dev.mjs uses; forbidden legacy dev ports are
 * rejected even via override. */
const FORBIDDEN_PORTS = new Set([3000, 3100, 5173]);

function gitRevision(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      windowsHide: true,
    }).trim();
  } catch {
    return 'development';
  }
}

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

export default defineConfig(({ command }) => {
  const buildRevision = process.env['VITE_ASA_BUILD_REVISION']?.trim() || gitRevision();
  const builtAt = process.env['VITE_ASA_BUILT_AT']?.trim() || new Date().toISOString();
  const blocksPreview = process.env['VITE_ASA_BLOCKS_PREVIEW'] === '1';
  const blocksRuntimeOrigin = process.env['VITE_ASA_BLOCKS_RUNTIME_ORIGIN']?.trim() || '';
  const metadata = JSON.stringify({ revision: buildRevision, builtAt });

  return {
    root,
    worker: {
      format: 'es',
      plugins: () =>
        process.env['ASA_CAPTURE_PUBLICATION_GRAPH'] === 'true'
          ? [
              renderedModuleEvidence({
                revision: buildRevision,
                repositoryRoot,
                output: resolve(root, 'private-symbols'),
                electronicsWorker: true,
              }),
            ]
          : [],
    },
    plugins: [
      react(),
      ...(process.env['ASA_CAPTURE_PUBLICATION_GRAPH'] === 'true'
        ? [
            renderedModuleEvidence({
              revision: buildRevision,
              repositoryRoot,
              output: resolve(root, 'private-symbols'),
            }),
          ]
        : []),
      privateSymbols({
        revision: buildRevision,
        repositoryRoot,
        output: resolve(root, 'private-symbols'),
        publicKey: readFileSync(resolve(repositoryRoot, 'tools/web-symbols-public.pem'), 'utf8'),
      }),
      {
        name: 'asa-lab-build-metadata',
        generateBundle() {
          this.emitFile({ type: 'asset', fileName: 'build-metadata.json', source: metadata });
        },
      },
    ],
    resolve: {
      alias: [
        {
          find: '@asa-lab/electronics/timed-state',
          replacement: resolve(repositoryRoot, 'contexts/electronics/timed-state.ts'),
        },
        {
          find: /^@asa-lab\/contracts$/,
          replacement: resolve(repositoryRoot, 'packages/contracts/src/index.ts'),
        },
        {
          find: '@asa-lab/electronics/rendering',
          replacement: resolve(repositoryRoot, 'contexts/electronics/rendering.ts'),
        },
        {
          find: '@asa-lab/electronics/engine',
          replacement: resolve(repositoryRoot, 'contexts/electronics/engine.ts'),
        },
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
                find: '@asa-lab/checkers',
                replacement: resolve(repositoryRoot, 'contexts/checkers/index.ts'),
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
      __ASA_BUILD_REVISION__: JSON.stringify(buildRevision),
      __ASA_BUILT_AT__: JSON.stringify(builtAt),
      __ASA_BLOCKS_PREVIEW__: JSON.stringify(blocksPreview),
      __ASA_BLOCKS_RUNTIME_ORIGIN__: JSON.stringify(blocksRuntimeOrigin),
    },
    build: {
      sourcemap: 'hidden',
      manifest: true,
      outDir: 'dist',
      emptyOutDir: true,
      assetsInlineLimit(path) {
        return isArduinoScratchMedia(path) ? false : undefined;
      },
      rollupOptions: {
        output: {
          // Blockly appends fixed filenames to its media option during inject.
          // Keep only these already imported vendor bytes together, without
          // inlining or renaming them. Other assets retain Vite's default names.
          assetFileNames(asset) {
            return asset.originalFileNames.some(isArduinoScratchMedia)
              ? `${scratchMediaDirectory}/[name][extname]`
              : 'assets/[name]-[hash][extname]';
          },
          manualChunks(id) {
            // Static block metadata is shared with read-only publication code.
            // Keep Rollup from absorbing it into the solver's dependency chunk.
            if (id.includes('/contexts/electronics/domain/arduino-block-support.')) {
              return 'electronics-block-support';
            }
            // Pure rendering topology must not be absorbed into the solver chunk.
            if (id.includes('/contexts/electronics/domain/switch-topology.')) {
              return 'electronics-rendering-topology';
            }
            // Shared storage and CommonJS interop are also used on Home. Keep
            // them separate so Home does not eagerly load the Electronics engine.
            if (
              id.includes('commonjsHelpers') ||
              /\/(modules\/project-local-draft|components\/sha256)\./.test(id)
            ) {
              return 'project-draft-storage';
            }
            if (/\/electronics\/electronics-(document-repair|project-recovery)\./.test(id)) {
              return 'electronics-recovery';
            }
            if (id.includes('/node_modules/.pnpm/three@') || id.includes('/node_modules/three/')) {
              return 'three-vendor';
            }
            if (id.includes('/contexts/electronics/domain/models/capacitor-transient-model.')) {
              return 'electronics-transient-models';
            }
            if (id.includes('/contexts/electronics/domain/solver.')) {
              return 'electronics-simulation-core';
            }
            return undefined;
          },
        },
      },
      commonjsOptions: {
        include: [
          /node_modules/,
          /contexts\/chess\/dist/,
          /contexts\/checkers\/dist/,
          /packages\/module-sdk\/dist/,
        ],
      },
    },
    server: {
      port: webPort,
      strictPort: true,
      host: '127.0.0.1',
      proxy: {
        '/internal/blocks/': {
          target: `http://127.0.0.1:${resolvePort('ASA_BLOCKS_PORT', 4613)}`,
          rewrite: (path) => path.replace(/^\/internal\/blocks/, ''),
          configure(proxy) {
            proxy.on('proxyReq', (request) => {
              request.removeHeader('cookie');
              request.removeHeader('authorization');
            });
          },
        },
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
  };
});
