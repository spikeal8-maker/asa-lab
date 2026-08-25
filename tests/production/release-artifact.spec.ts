import { linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createReleaseManifest,
  detachHardlinkedFiles,
  verifyReleaseArtifact,
} from '../../tools/release-artifact.mjs';

const roots: string[] = [];

function releaseFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'asa-release-'));
  roots.push(root);
  mkdirSync(join(root, 'api', 'dist'), { recursive: true });
  mkdirSync(join(root, 'web', 'dist', 'assets'), { recursive: true });
  mkdirSync(join(root, 'migrations'), { recursive: true });
  writeFileSync(join(root, '.release-immutable'), 'immutable\n');
  writeFileSync(join(root, 'api', 'dist', 'main.js'), 'console.log("api")\n');
  writeFileSync(join(root, 'api', 'package.json'), '{"name":"fixture"}\n');
  writeFileSync(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  writeFileSync(join(root, 'migrations', '0088_fixture.sql'), 'SELECT 1;\n');
  writeFileSync(
    join(root, 'web', 'dist', 'build-metadata.json'),
    JSON.stringify({ revision: 'a'.repeat(40), builtAt: '2026-08-25T00:00:00.000Z' }),
  );
  writeFileSync(
    join(root, 'web', 'dist', 'index.html'),
    '<script type="module" src="/assets/app.js"></script>',
  );
  writeFileSync(join(root, 'web', 'dist', 'assets', 'app.js'), 'console.log("web")\n');
  createReleaseManifest({
    releaseRoot: root,
    releaseRole: 'candidate',
    sourceRevision: 'a'.repeat(40),
    toolingRevision: 'b'.repeat(40),
  });
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('immutable production release artifact', () => {
  it('verifies the complete file set, web graph and schema as one unit', () => {
    const manifest = verifyReleaseArtifact(releaseFixture());
    expect(manifest.releaseRole).toBe('candidate');
    expect(manifest.expectedSchemaVersion).toBe(88);
    expect(
      manifest.files.some((entry: { path: string }) => entry.path === 'api/dist/main.js'),
    ).toBe(true);
  });

  it('fails closed when any packaged runtime file changes', () => {
    const root = releaseFixture();
    writeFileSync(join(root, 'api', 'dist', 'main.js'), 'console.log("tampered")\n');
    expect(() => verifyReleaseArtifact(root)).toThrow(/do not match/);
  });

  it('detaches deploy hardlinks so later source edits cannot mutate a release', () => {
    const root = releaseFixture();
    const source = join(root, 'workspace-source.js');
    const deployed = join(root, 'api', 'dist', 'workspace-package.js');
    writeFileSync(source, 'original\n');
    linkSync(source, deployed);

    expect(detachHardlinkedFiles(join(root, 'api'))).toBe(1);
    writeFileSync(source, 'changed later\n');

    expect(readFileSync(deployed, 'utf8')).toBe('original\n');
  });

  it('refuses environment files even if someone included them in a regenerated manifest', () => {
    const root = releaseFixture();
    writeFileSync(join(root, '.env.local'), 'SECRET=value\n');
    createReleaseManifest({
      releaseRoot: root,
      releaseRole: 'candidate',
      sourceRevision: 'a'.repeat(40),
      toolingRevision: 'b'.repeat(40),
    });
    expect(() => verifyReleaseArtifact(root)).toThrow(/Forbidden sensitive file/);
    expect(readFileSync(join(root, '.env.local'), 'utf8')).toContain('SECRET');
  });
});
