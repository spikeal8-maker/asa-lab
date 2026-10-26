import process from 'node:process';
import { URL } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderedModuleEvidence } from './web-rendered-module-evidence.mjs';

const checker = fileURLToPath(new URL('./public-electronics-emitted-graph.mjs', import.meta.url));
const entry = 'src/projects-public/ElectronicsPublicationScene.tsx';

function fixture(mutate = () => {}) {
  const root = mkdtempSync(resolve(tmpdir(), 'asa-rendered-evidence-'));
  const write = (path, value) => {
    const target = resolve(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, typeof value === 'string' ? value : JSON.stringify(value));
  };
  try {
    // A disposable local repository gives the CLI a real exact checkout revision.
    execFileSync('git', ['init', '--quiet'], { cwd: root });
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@isolated.test',
        'commit',
        '--quiet',
        '--allow-empty',
        '-m',
        'Synthetic graph fixture',
      ],
      { cwd: root },
    );
    const revision = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
    const moduleId = resolve(root, 'apps/web/src/projects-public/ElectronicsPublicationScene.tsx');
    const bundle = {
      public: {
        type: 'chunk',
        fileName: 'assets/public-abcdefgh.js',
        code: 'export const publicPage=1;',
        imports: [],
        dynamicImports: [],
        modules: {
          [resolve(root, 'apps/web/src/projects-public/PublicProjectsSurface.tsx')]: {
            renderedLength: 25,
          },
        },
      },
      scene: {
        type: 'chunk',
        fileName: 'assets/scene-abcdefgh.js',
        code: 'export const scene = 1;',
        imports: ['assets/shared-abcdefgh.js'],
        dynamicImports: [],
        modules: { [moduleId]: { renderedLength: 23 } },
      },
      shared: {
        type: 'chunk',
        fileName: 'assets/shared-abcdefgh.js',
        code: 'export const helper = 1;',
        imports: [],
        dynamicImports: [],
        modules: {
          [resolve(root, 'apps/web/src/modules/project-draft-storage.ts')]: { renderedLength: 24 },
          [resolve(root, 'apps/web/src/electronics/use-electronics-workbench.ts')]: {
            renderedLength: 0,
          },
        },
      },
    };
    const manifest = {
      'src/projects-public/PublicProjectsSurface.tsx': {
        file: bundle.public.fileName,
        isDynamicEntry: true,
      },
      [entry]: { file: bundle.scene.fileName, isDynamicEntry: true, imports: ['_shared.js'] },
      '_shared.js': { file: bundle.shared.fileName },
    };
    const dynamicOwners = new Map();
    mutate({ bundle, manifest, root, revision, write, dynamicOwners });
    renderedModuleEvidence({
      revision,
      repositoryRoot: root,
      output: resolve(root, 'apps/web/private-symbols'),
    }).generateBundle.handler.call(
      { getModuleInfo: (id) => ({ dynamicallyImportedIds: dynamicOwners.get(id) ?? [] }) },
      {},
      bundle,
    );
    for (const chunk of Object.values(bundle)) write(`apps/web/dist/${chunk.fileName}`, chunk.code);
    write('apps/web/dist/build-metadata.json', { revision, builtAt: 'fixture' });
    write('apps/web/dist/.vite/manifest.json', manifest);
    return {
      root,
      revision,
      write,
      run() {
        const result = spawnSync(process.execPath, [checker], {
          cwd: root,
          encoding: 'utf8',
          env: { ...process.env, ASA_BUILD_REVISION: revision },
        });
        const receipt = JSON.parse(
          readFileSync(
            resolve(root, 'reports/playwright/projects-publication/electronics-emitted-graph.json'),
            'utf8',
          ),
        );
        return { ...result, receipt };
      },
    };
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

for (const name of [
  'valid graph',
  'stale revision',
  'script hash mismatch',
  'missing entry',
  'forbidden rendered module',
  'direct static solver',
  'viewer lazy worker',
  'viewer lazy solver',
  'unknown lazy worker',
  'unrelated router lazy worker',
]) {
  test(name, () => {
    const sample = fixture(({ bundle, manifest, root, dynamicOwners }) => {
      if (name === 'missing entry') delete manifest[entry];
      if (name === 'forbidden rendered module')
        bundle.shared.modules[
          resolve(root, 'apps/web/src/electronics/use-electronics-workbench.ts')
        ].renderedLength = 12;
      if (/solver|worker/.test(name)) {
        const target = name.includes('solver')
          ? 'contexts/electronics/domain/solver.ts'
          : 'apps/web/src/electronics/simulation.worker.ts';
        const targetId = resolve(root, target);
        bundle.runtime = {
          type: 'chunk',
          fileName: 'assets/runtime-abcdefgh.js',
          code: 'export const runtime=1;',
          imports: [],
          dynamicImports: [],
          modules: { [targetId]: { renderedLength: 23 } },
        };
        manifest['_runtime.js'] = { file: bundle.runtime.fileName };
        if (name === 'direct static solver') {
          bundle.scene.imports.push(bundle.runtime.fileName);
          manifest[entry].imports.push('_runtime.js');
        } else {
          const unrelated = name === 'unrelated router lazy worker';
          const from = unrelated ? bundle.shared : bundle.scene;
          from.dynamicImports.push(bundle.runtime.fileName);
          const fromKey = unrelated ? '_shared.js' : entry;
          manifest[fromKey].dynamicImports = ['_runtime.js'];
          if (unrelated) {
            const app = resolve(root, 'apps/web/src/App.tsx');
            const route = resolve(root, 'apps/web/src/modules/ModuleEditorHost.tsx');
            bundle.shared.modules[app] = { renderedLength: 40 };
            bundle.runtime.modules[route] = { renderedLength: 21 };
            dynamicOwners.set(app, [route]);
          } else if (name !== 'unknown lazy worker')
            dynamicOwners.set(
              resolve(root, 'apps/web/src/projects-public/ElectronicsPublicationScene.tsx'),
              [targetId],
            );
        }
      }
    });
    try {
      if (name === 'stale revision')
        sample.write('apps/web/dist/build-metadata.json', { revision: '0'.repeat(40) });
      if (name === 'script hash mismatch')
        sample.write('apps/web/dist/assets/scene-abcdefgh.js', 'changed');
      const result = sample.run();
      const passes = name === 'valid graph' || name === 'unrelated router lazy worker';
      assert.equal(result.status, passes ? 0 : 1, result.stderr);
      assert.equal(result.receipt.status, passes ? 'PASS' : 'FAIL');
      if (name === 'valid graph') {
        assert.equal(result.receipt.chunks.length, 3);
        assert.equal(result.receipt.sharedHelpers.length, 1);
        assert.equal(result.receipt.violations.length, 0);
        assert.equal(
          result.receipt.chunks.find((chunk) => chunk.key === '_shared.js').zeroLengthModules
            .length,
          1,
        );
        assert.ok(!JSON.stringify(result.receipt).includes('export const'));
        assert.ok(!JSON.stringify(result.receipt).includes(sample.root));
      } else if (name === 'unrelated router lazy worker') {
        assert.equal(result.receipt.excludedOptionalEdges.length, 1);
        assert.equal(result.receipt.checkedPublicLazyEdges.length, 0);
        assert.equal(result.receipt.chunks.length, 3);
      } else {
        assert.match(
          result.receipt.error,
          {
            'stale revision': /revision mismatch/,
            'script hash mismatch': /hash mismatch/,
            'missing entry': /dynamic entry/,
            'forbidden rendered module': /forbidden executable/,
            'direct static solver': /forbidden executable/,
            'viewer lazy worker': /forbidden executable/,
            'viewer lazy solver': /forbidden executable/,
            'unknown lazy worker': /forbidden executable/,
          }[name],
        );
      }
    } finally {
      rmSync(sample.root, { recursive: true, force: true });
    }
  });
}
