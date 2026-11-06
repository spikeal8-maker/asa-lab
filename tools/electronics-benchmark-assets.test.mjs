import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';
import { measureSchematicEditorCss } from './electronics-benchmark-assets.mjs';

const editorEntry = 'src/pages/SchematicEditor.tsx';

function fixture(context, manifest, assets = {}) {
  const root = mkdtempSync(resolve(tmpdir(), 'asa-electronics-css-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const dist = resolve(root, 'dist');
  mkdirSync(resolve(dist, '.vite'), { recursive: true });
  writeFileSync(resolve(dist, '.vite/manifest.json'), JSON.stringify(manifest));
  for (const [file, content] of Object.entries(assets)) {
    const path = resolve(dist, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  return { root, dist };
}

test('measures the original direct editor CSS and preserves numeric bundle fields', (context) => {
  const fileName = 'assets/SchematicEditor-old.css';
  const css = '.workbench { color: teal; }';
  const { dist } = fixture(
    context,
    { [editorEntry]: { file: 'assets/SchematicEditor-old.js', css: [fileName] } },
    { [fileName]: css },
  );
  assert.deepEqual(measureSchematicEditorCss(dist), {
    measurement: 'static-css-closure',
    entry: editorEntry,
    fileName,
    bytes: Buffer.byteLength(css),
    gzipBytes: gzipSync(css).byteLength,
    files: [{ fileName, bytes: Buffer.byteLength(css), gzipBytes: gzipSync(css).byteLength }],
  });
});

test('finds editor styles moved entirely into an arbitrarily named shared chunk', (context) => {
  const css = '.workbench { display: grid; }';
  const { dist } = fixture(
    context,
    {
      [editorEntry]: { file: 'assets/SchematicEditor-new.js', imports: ['_shared-helper.js'] },
      '_shared-helper.js': { file: 'assets/shared-helper.js', css: ['assets/shared-style.css'] },
    },
    { 'assets/shared-style.css': css },
  );
  const result = measureSchematicEditorCss(dist);
  assert.deepEqual(result.files, [
    {
      fileName: 'assets/shared-style.css',
      bytes: Buffer.byteLength(css),
      gzipBytes: gzipSync(css).byteLength,
    },
  ]);
  assert.equal(result.bytes, Buffer.byteLength(css));
});

test('counts own and shared static CSS once across a cycle and excludes dynamic destinations', (context) => {
  const editorCss = '.workbench::after { content: "Робот"; }';
  const sharedCss = '.mobile-properties { width: 100%; }';
  const { dist } = fixture(
    context,
    {
      [editorEntry]: {
        file: 'assets/SchematicEditor.js',
        css: ['assets/editor.css', './assets/editor.css'],
        imports: ['_shared.js', '_shared.js'],
        dynamicImports: ['_unrelated-editor.js'],
      },
      '_shared.js': {
        file: 'assets/shared.js',
        css: ['assets/shared.css', 'assets/editor.css'],
        imports: [editorEntry],
        dynamicImports: ['_missing-dynamic-destination.js'],
      },
      '_unrelated-editor.js': {
        file: 'assets/unrelated-editor.js',
        css: ['assets/unrelated-missing.css'],
      },
    },
    { 'assets/editor.css': editorCss, 'assets/shared.css': sharedCss },
  );
  const result = measureSchematicEditorCss(dist);
  assert.deepEqual(
    result.files.map((file) => file.fileName),
    ['assets/editor.css', 'assets/shared.css'],
  );
  assert.equal(result.fileName, 'assets/editor.css, assets/shared.css');
  assert.equal(result.bytes, Buffer.byteLength(editorCss) + Buffer.byteLength(sharedCss));
  assert.equal(result.gzipBytes, gzipSync(editorCss).byteLength + gzipSync(sharedCss).byteLength);
  assert.notEqual(result.gzipBytes, gzipSync(editorCss + sharedCss).byteLength);
});

test('fails when the canonical editor entry is absent', (context) => {
  const { dist } = fixture(context, { '_unrelated.js': { file: 'assets/unrelated.js' } });
  assert.throws(
    () => measureSchematicEditorCss(dist),
    /manifest dependency: src\/pages\/SchematicEditor/,
  );
});

test('fails when a static dependency is absent even if the entry has CSS', (context) => {
  const { dist } = fixture(
    context,
    {
      [editorEntry]: {
        file: 'assets/SchematicEditor.js',
        css: ['assets/editor.css'],
        imports: ['_missing.js'],
      },
    },
    { 'assets/editor.css': '.workbench {}' },
  );
  assert.throws(() => measureSchematicEditorCss(dist), /manifest dependency: _missing\.js/);
});

test('does not accept inherited object properties as manifest dependencies', (context) => {
  const { dist } = fixture(context, {
    [editorEntry]: { file: 'assets/SchematicEditor.js', imports: ['toString'] },
  });
  assert.throws(() => measureSchematicEditorCss(dist), /manifest dependency: toString/);
});

test('fails when no CSS is reachable in the static closure', (context) => {
  const { dist } = fixture(context, {
    [editorEntry]: { file: 'assets/SchematicEditor.js', imports: ['_shared.js'] },
    '_shared.js': { file: 'assets/shared.js', imports: [editorEntry] },
  });
  assert.throws(() => measureSchematicEditorCss(dist), /static CSS closure is empty/);
});

test('fails when an emitted CSS file is missing', (context) => {
  const { dist } = fixture(context, {
    [editorEntry]: { file: 'assets/SchematicEditor.js', css: ['assets/missing.css'] },
  });
  assert.throws(() => measureSchematicEditorCss(dist), { code: 'ENOENT' });
});

for (const [field, value] of [
  ['css', 'assets/editor.css'],
  ['css', null],
  ['css', [7]],
  ['imports', '_shared.js'],
  ['imports', null],
  ['imports', ['']],
]) {
  test(`rejects malformed ${field} list ${JSON.stringify(value)}`, (context) => {
    const { dist } = fixture(context, {
      [editorEntry]: { file: 'assets/SchematicEditor.js', [field]: value },
    });
    assert.throws(() => measureSchematicEditorCss(dist), new RegExp(`Invalid manifest ${field}`));
  });
}

test('rejects CSS traversal and absolute paths before reading files', (context) => {
  for (const path of ['../outside.css', '/outside.css', 'C:\\outside.css', 'assets/script.js']) {
    const { dist } = fixture(context, {
      [editorEntry]: { file: 'assets/SchematicEditor.js', css: [path] },
    });
    assert.throws(
      () => measureSchematicEditorCss(dist),
      /Invalid emitted CSS path|CSS escapes dist/,
    );
  }
});

test('rejects a CSS resource reached through a directory link outside dist', (context) => {
  const { root, dist } = fixture(context, {
    [editorEntry]: { file: 'assets/SchematicEditor.js', css: ['linked/editor.css'] },
  });
  const outside = resolve(root, 'outside');
  mkdirSync(outside);
  writeFileSync(resolve(outside, 'editor.css'), '.workbench {}');
  symlinkSync(outside, resolve(dist, 'linked'), 'junction');
  assert.throws(() => measureSchematicEditorCss(dist), /CSS escapes dist/);
});
