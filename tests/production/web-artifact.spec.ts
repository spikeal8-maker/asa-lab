import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { verifyWebArtifact } from '../../tools/verify-web-artifact.mjs';

function artifact(): string {
  const root = mkdtempSync(join(tmpdir(), 'asa-web-artifact-'));
  mkdirSync(join(root, 'assets'));
  writeFileSync(
    join(root, 'build-metadata.json'),
    JSON.stringify({ revision: 'abc123', builtAt: '2026-08-25T00:00:00.000Z' }),
  );
  writeFileSync(
    join(root, 'index.html'),
    '<link rel="stylesheet" href="/assets/index-12345678.css"><script type="module" src="/assets/index-12345678.js"></script>',
  );
  writeFileSync(
    join(root, 'assets/index-12345678.css'),
    'body{background:url("./font-12345678.woff2")}',
  );
  writeFileSync(join(root, 'assets/index-12345678.js'), 'import("./editor-12345678.js")');
  writeFileSync(join(root, 'assets/editor-12345678.js'), 'export const ready=true;');
  writeFileSync(join(root, 'assets/font-12345678.woff2'), 'font');
  return root;
}

describe('production web artifact verifier', () => {
  it('verifies the entry document and recursive chunks as one artifact', () => {
    const result = verifyWebArtifact({ webDist: artifact(), expectedRevision: 'abc123' });
    expect(result.files.map((file) => file.path)).toEqual([
      'assets/editor-12345678.js',
      'assets/font-12345678.woff2',
      'assets/index-12345678.css',
      'assets/index-12345678.js',
      'build-metadata.json',
      'index.html',
    ]);
  });

  it('refuses the exact broken-shell state: HTML exists but its JS does not', () => {
    const root = artifact();
    writeFileSync(
      join(root, 'index.html'),
      '<script type="module" src="/assets/missing-12345678.js"></script>',
    );
    expect(() => verifyWebArtifact({ webDist: root, expectedRevision: 'abc123' })).toThrow(
      /Web artifact is incomplete/,
    );
  });

  it('refuses metadata from another checkout', () => {
    expect(() => verifyWebArtifact({ webDist: artifact(), expectedRevision: 'different' })).toThrow(
      /revision does not match/,
    );
  });
});
