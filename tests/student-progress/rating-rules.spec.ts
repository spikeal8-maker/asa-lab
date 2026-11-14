import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const cli = resolve(repoRoot, 'tools/student-progress-rating-rules.mjs');
const rulesDir = resolve(repoRoot, 'docs/product/student-progress/rating-rules');
const created: string[] = [];

type ConfigMutation = (ruleDir: string) => void;

function invoke(directory = rulesDir) {
  return spawnSync(process.execPath, [cli, '--check', '--dir', directory], {
    encoding: 'utf8',
    cwd: repoRoot,
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
    env: { ...process.env, TZ: 'UTC' },
  });
}
function invalidFixture(mutate: ConfigMutation) {
  const temporary = mkdtempSync(join(tmpdir(), 'asa-sp05-negative-'));
  created.push(temporary);
  cpSync(rulesDir, temporary, { recursive: true });
  mutate(temporary);
  return invoke(temporary);
}
function updateJson(relativeDir: string, name: string, mutate: (data: any) => void) {
  const target = resolve(relativeDir, name);
  const data = JSON.parse(readFileSync(target, 'utf8'));
  mutate(data);
  writeFileSync(target, JSON.stringify(data, null, 2) + '\n');
}

afterEach(() => {
  for (const directory of created.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('SP-05 rating calibration: real CLI execution and fixed independent oracle', () => {
  it('runs the documented Node CLI, checks all 26 scenarios and reports a provisional single selection', () => {
    const executed = spawnSync(process.execPath, [cli, '--check'], {
      encoding: 'utf8',
      cwd: repoRoot,
      timeout: 30_000,
    });
    expect(executed.error).toBeUndefined();
    expect(executed.status, executed.stderr).toBe(0);
    expect(executed.stdout).toContain('SP05_CHECK_PASS ');
    const line = executed.stdout
      .trim()
      .split('\n')
      .find((value) => value.startsWith('SP05_CHECK_PASS '));
    expect(line).toBeDefined();
    const result = JSON.parse(line!.slice('SP05_CHECK_PASS '.length));
    expect(result).toMatchObject({
      status: 'PASS',
      candidates: 3,
      fixtures: 26,
      selected: 'SP05-B-1.0.0',
      checksum: '580cafabc35af618fceec96f32334bf6bfcda07f6a82c874b147109983d89335',
      basis: 'synthetic_only',
      sourceAcceptance: 'BLOCKED_C3',
    });
  });
  it.each([
    [
      'wrong fixed totals',
      (root: string) =>
        updateJson(root, 'expected-totals.json', (item) => {
          item.totals.find((row: { id: string }) => row.id === 'weekly_learner').B = 101;
        }),
      'wrong total',
    ],
    [
      'damaged oracle schema',
      (root: string) =>
        updateJson(root, 'expected-totals.json', (item) => {
          item.schemaVersion = 2;
        }),
      'oracle authority invalid',
    ],
    [
      'oracle version mismatch',
      (root: string) =>
        updateJson(root, 'expected-totals.json', (item) => {
          item.candidateVersions.B = 'SP05-B-0.9.9';
        }),
      'oracle version mismatch',
    ],
    [
      'invalid selected checksum',
      (root: string) =>
        updateJson(root, 'selected-rule.json', (item) => {
          item.checksum = '0'.repeat(64);
        }),
      'checksum mismatch',
    ],
    [
      'invalid selection version',
      (root: string) =>
        updateJson(root, 'selected-rule.json', (item) => {
          item.version = 'SP05-B-0.9.9';
        }),
      'version mismatch',
    ],
    [
      'multiple selections',
      (root: string) =>
        updateJson(root, 'selected-rule.json', (item) => {
          item.selected = ['A', 'B'];
        }),
      'exactly one selected',
    ],
    [
      'selected rule not approved by another human',
      (root: string) =>
        updateJson(root, 'selected-rule.json', (item) => {
          item.approvalState = 'approved';
        }),
      'unverified approval state',
    ],
    [
      'bad formula schema',
      (root: string) =>
        updateJson(root, 'candidate-a.json', (item) => {
          item.schemaVersion = 2;
        }),
      'schema/version mismatch',
    ],
    [
      'forbidden copies points',
      (root: string) =>
        updateJson(root, 'candidate-b.json', (item) => {
          item.weights.publicCopy = 10;
        }),
      'forbidden or unapproved weight',
    ],
    [
      'broken per-publication cap',
      (root: string) =>
        updateJson(root, 'candidate-c.json', (item) => {
          item.social.perPublicationMaxPoints = 2;
        }),
      'wrong rational coefficients',
    ],
    [
      'invalid identity links',
      (root: string) =>
        updateJson(root, 'fixtures.json', (item) => {
          const fixture = item.cases.find(
            (row: { id: string }) => row.id === 'linked_account_seat',
          );
          fixture.identityLinks.push({
            principal: 'owner',
            personId: 'person:not-owner',
            verified: true,
          });
        }),
      'conflicting verified identities',
    ],
    [
      'unknown history wrongly credited',
      (root: string) =>
        updateJson(root, 'expected-totals.json', (item) => {
          item.totals.find((row: { id: string }) => row.id === 'incomplete_historical_origin').B =
            8;
        }),
      'wrong total',
    ],
    [
      'conflicting same-version replay',
      (root: string) =>
        updateJson(root, 'fixtures.json', (item) => {
          const fixture = item.cases.find((row: { id: string }) => row.id === 'replayed_reaction');
          fixture.reactions[1].state = 'removed';
        }),
      'inconsistent same-version replay',
    ],
    [
      'invalid amount',
      (root: string) =>
        updateJson(root, 'candidate-b.json', (item) => {
          item.weights.canonicalLearningCompletion = 'Infinity';
        }),
      'invalid nonnegative integer',
    ],
    [
      'unqualified independent work',
      (root: string) =>
        updateJson(root, 'expected-totals.json', (item) => {
          item.totals.find((row: { id: string }) => row.id === 'known_copy_chain').B = 20;
        }),
      'wrong total',
    ],
    [
      'unexpected extra config',
      (root: string) =>
        updateJson(root, 'candidate-b.json', (item) => {
          item.debug = true;
        }),
      'invalid keys',
    ],
  ] as const)('rejects %s through a real child-process exit code', (_name, mutate, message) => {
    const result = invalidFixture(mutate);
    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('SP05_CHECK_FAIL');
    expect(result.stderr).toContain(message);
    expect(result.stdout).not.toContain('SP05_CHECK_PASS');
  });
});
