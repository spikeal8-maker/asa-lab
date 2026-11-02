import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import test from 'node:test';
import { productAliases } from './product-aliases.mjs';

test('fixture resolves both complete real pure 3D modules and leaves other imports alone', () => {
  assert.equal(productAliases.length, 2);
  for (const name of ['document', 'operations']) {
    const specifier = '@asa-lab/three-d/' + name;
    const aliases = productAliases.filter((alias) => alias.find.test(specifier));
    assert.equal(aliases.length, 1);
    assert.ok(
      aliases[0].replacement
        .replaceAll('\\', '/')
        .endsWith('/contexts/three-d/domain/' + name + '.ts'),
    );
    assert.ok(readFileSync(aliases[0].replacement, 'utf8').includes('export function'));
  }
  for (const name of [
    '@asa-lab/three-d',
    '@asa-lab/three-d/document/extra',
    '@asa-lab/blocks',
    'scratch-vm',
  ]) {
    assert.ok(productAliases.every((alias) => !alias.find.test(name)));
  }
  const bundle = readFileSync(new URL('./product-bundle.mjs', import.meta.url), 'utf8');
  assert.match(bundle, /resolve:\s*\{ alias: productAliases \}/);
});

test('resolved sources retain the real parser, defaults, node creation and operations exports', () => {
  const urls = productAliases.map((alias) => pathToFileURL(alias.replacement).href);
  const source = `
    import assert from 'node:assert/strict';
    const document = await import(${JSON.stringify(urls[0])});
    const operations = await import(${JSON.stringify(urls[1])});
    const empty = document.createEmptyThreeDDocument();
    assert.equal(document.parseThreeDDocument(empty).ok, true);
    assert.equal(document.parseThreeDDocument({schemaVersion: -1}).ok, false);
    assert.equal(typeof document.createThreeDNode, 'function');
    assert.equal(typeof document.cloneThreeDDocument, 'function');
    assert.equal(typeof operations.nodeBounds, 'function');
    assert.equal(typeof operations.selectionBounds, 'function');
    assert.equal(typeof operations.alignDocumentNodes, 'function');
  `;
  const child = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--input-type=module', '-e', source],
    { encoding: 'utf8', timeout: 10000 },
  );
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, child.stderr);
});
