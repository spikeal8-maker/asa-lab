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
      [entry]: { file: bundle.scene.fileName, isDynamicEntry: true, imports: ['_shared.js'] },
      '_shared.js': { file: bundle.shared.fileName },
    };
    mutate({ bundle, manifest, root, revision, write });
    renderedModuleEvidence({
      revision,
      repositoryRoot: root,
      output: resolve(root, 'apps/web/private-symbols'),
    }).generateBundle.handler({}, bundle);
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
]) {
  test(name, () => {
    const sample = fixture(({ bundle, manifest, root }) => {
      if (name === 'missing entry') delete manifest[entry];
      if (name === 'forbidden rendered module')
        bundle.shared.modules[
          resolve(root, 'apps/web/src/electronics/use-electronics-workbench.ts')
        ].renderedLength = 12;
    });
    try {
      if (name === 'stale revision')
        sample.write('apps/web/dist/build-metadata.json', { revision: '0'.repeat(40) });
      if (name === 'script hash mismatch')
        sample.write('apps/web/dist/assets/scene-abcdefgh.js', 'changed');
      const result = sample.run();
      assert.equal(result.status, name === 'valid graph' ? 0 : 1, result.stderr);
      assert.equal(result.receipt.status, name === 'valid graph' ? 'PASS' : 'FAIL');
      if (name === 'valid graph') {
        assert.equal(result.receipt.chunks.length, 2);
        assert.equal(result.receipt.sharedHelpers.length, 1);
        assert.equal(result.receipt.violations.length, 0);
        assert.equal(result.receipt.chunks[1].zeroLengthModules.length, 1);
        assert.ok(!JSON.stringify(result.receipt).includes('export const'));
        assert.ok(!JSON.stringify(result.receipt).includes(sample.root));
      } else {
        assert.match(
          result.receipt.error,
          {
            'stale revision': /revision mismatch/,
            'script hash mismatch': /hash mismatch/,
            'missing entry': /dynamic entry/,
            'forbidden rendered module': /forbidden executable/,
          }[name],
        );
      }
    } finally {
      rmSync(sample.root, { recursive: true, force: true });
    }
  });
}
