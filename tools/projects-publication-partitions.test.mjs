import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import process from 'node:process';
import { URL } from 'node:url';
import {
  publicationBrowserPartitions,
  runPublicationBrowserPartitions,
} from './projects-publication-partitions.mjs';

test('keeps every original browser suite exactly once in ten separate lifecycles', () => {
  assert.deepEqual(publicationBrowserPartitions.flatMap((p) => p.files).sort(), [
    'e2e/gallery.spec.ts',
    'e2e/project-hub.spec.ts',
    'e2e/public-project-admin-moderation.spec.ts',
    'e2e/public-project-copy.spec.ts',
    'e2e/public-project-electronics-player.spec.ts',
    'e2e/public-project-electronics-viewer.spec.ts',
    'e2e/public-projects.spec.ts',
    'e2e/publication-comments.spec.ts',
    'e2e/publication-likes.spec.ts',
    'e2e/student-project-policy.spec.ts',
  ]);
  assert.equal(publicationBrowserPartitions.length, 10);
  assert.ok(publicationBrowserPartitions.every((partition) => partition.files.length === 1));
});

test('waits for each child to exit, preserves distinct artifacts and never retries', () => {
  const pids = [];
  const outputs = [];
  runPublicationBrowserPartitions((args) => {
    assert.ok(args.includes('--workers=1'));
    assert.ok(args.includes('--retries=0'));
    outputs.push(args.find((a) => a.startsWith('--output=')));
    const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], {
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.equal(child.signal, null);
    assert.equal(child.error, undefined);
    assert.equal(child.status, 0);
    pids.push(Number(child.stdout));
    return child.status;
  }, {});
  assert.equal(pids.length, 10);
  assert.equal(new Set(pids).size, 10);
  assert.equal(new Set(outputs).size, 10);
  assert.deepEqual(
    outputs,
    publicationBrowserPartitions.map(
      ({ name }) => `--output=reports/playwright/projects-publication/${name}`,
    ),
  );
});

test('a failed or unfinished child prevents the next partition', () => {
  for (const failedIndex of [0, 4, 9]) {
    for (const status of [1, null, undefined]) {
      let calls = 0;
      assert.throws(() =>
        runPublicationBrowserPartitions(() => {
          const index = calls++;
          return index === failedIndex ? status : 0;
        }, {}),
      );
      assert.equal(calls, failedIndex + 1);
    }
  }
});

test('refuses an external server before running any partition', () => {
  let calls = 0;
  assert.throws(() =>
    runPublicationBrowserPartitions(
      () => {
        calls++;
        return 0;
      },
      {
        ASA_E2E_EXTERNAL: 'true',
      },
    ),
  );
  assert.equal(calls, 0);
});

test('the real Playwright configuration owns a non-reused API against an isolated database', () => {
  const config = readFileSync(new URL('../playwright.config.ts', import.meta.url), 'utf8');
  const server = readFileSync(new URL('../e2e/server.mjs', import.meta.url), 'utf8');
  const workflow = readFileSync(
    new URL('../.github/workflows/projects-publication.yml', import.meta.url),
    'utf8',
  );
  assert.match(config, /command: 'node e2e\/server\.mjs'/);
  assert.match(config, /reuseExistingServer: false/);
  assert.match(server, /pathname\.endsWith\('_test'\)/);
  assert.doesNotMatch(workflow, /ASA_E2E_EXTERNAL\s*:/);
});
