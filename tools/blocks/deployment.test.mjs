import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';
import YAML from 'yaml';
const read = (name) => fs.readFileSync(new URL(`../../${name}`, import.meta.url), 'utf8');

test('default distribution contains an isolated source-built Scratch without machine artifacts', () => {
  const config = YAML.parse(read('compose.yaml'));
  const scratch = config.services.scratch;
  assert.equal(scratch.build.context, '.');
  assert.equal(scratch.build.dockerfile, 'infra/scratch-editor/Dockerfile');
  assert.equal(scratch.read_only, true);
  assert.equal(scratch.user, '101:101');
  assert.deepEqual(scratch.networks, ['scratch-runtime']);
  assert.equal(config.networks['scratch-runtime'].internal, true);
  assert.equal(scratch.environment, undefined);
  assert.equal(scratch.volumes, undefined);
  assert.equal(scratch.profiles, undefined);
  assert.equal(config.services.web.depends_on.scratch.condition, 'service_healthy');
  assert.match(config.services.web.build.args.ASA_BLOCKS_RUNTIME_ORIGIN, /http:\/\/localhost:/);
  assert.match(scratch.build.args.ASA_BLOCKS_PARENT_ORIGIN, /http:\/\/127\.0\.0\.1:/);
  assert.doesNotMatch(read('compose.yaml'), /C:\\|runtime-context|Dockerfile\.artifact|backups\//);
});

test('normal install and guarded update include Scratch in successful readiness', () => {
  for (const file of [
    'tools/asa-lab.ps1',
    'tools/asa-lab.sh',
    'tools/docker-update.ps1',
    'tools/docker-update.sh',
  ]) {
    const source = read(file);
    assert.match(source, /scratch.*http:\/\/127\.0\.0\.1:8080\/asa-commit\.txt/);
    assert.match(source, /scratch.*http:\/\/127\.0\.0\.1:8080\/healthz/);
    assert.doesNotMatch(source, /scratch-rollout-2026|asa-scratch-b-origin-runner/);
  }
  const recipe = read('infra/scratch-editor/Dockerfile');
  assert.match(recipe, /ARG ASA_BUILD_REVISION=unknown/);
  assert.match(recipe, /org\.opencontainers\.image\.revision/);
  assert.match(recipe, /asa-commit\.txt/);
});

test('ready editor omits the footer instead of visually obscuring it', () => {
  const editor = read('apps/web/src/blocks/BlocksEditor.tsx');
  assert.match(editor, /status !== 'editor-ready' \? \(/);
  assert.doesNotMatch(editor, /className="blocks-editor-preview-status"/);
  assert.match(editor, /window\.confirm/);
  assert.match(editor, /Повторить подключение/);
});

test('guarded updates build all three images before replacing containers', () => {
  for (const file of ['tools/docker-update.ps1', 'tools/docker-update.sh']) {
    const source = read(file);
    assert.ok(source.indexOf('scratch') < source.indexOf('--no-build'));
    assert.doesNotMatch(source, /up.*--build/);
  }
  assert.match(read('tools/asa-lab.sh'), /if \[ -e \.git \]/);
  assert.match(read('tools/asa-lab.sh'), /synchronized/);
});
