import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';
import YAML from 'yaml';
const read = (name) => fs.readFileSync(new URL(`../../${name}`, import.meta.url), 'utf8');

test('default distribution contains an internal source-built Scratch without machine artifacts', () => {
  const config = YAML.parse(read('compose.yaml'));
  const scratch = config.services.scratch;
  assert.equal(scratch.build.context, '.');
  assert.equal(scratch.build.dockerfile, 'infra/scratch-editor/Dockerfile');
  assert.equal(scratch.read_only, true);
  assert.equal(scratch.user, '101:101');
  assert.deepEqual(scratch.networks, ['scratch-runtime']);
  assert.notEqual(
    config.networks['scratch-runtime']?.internal,
    true,
    'internal-only runtime networks suppress Docker published ports',
  );
  assert.match(scratch.environment.ASA_BLOCKS_PARENT_ORIGIN, /ASA_BLOCKS_PARENT_ORIGIN/);
  assert.equal(scratch.volumes, undefined);
  assert.equal(scratch.profiles, undefined);
  assert.equal(config.services.web.depends_on.scratch.condition, 'service_healthy');
  assert.match(config.services.web.build.args.ASA_BLOCKS_RUNTIME_ORIGIN, /http:\/\/127\.0\.0\.1:/);
  assert.match(scratch.build.args.ASA_BLOCKS_PARENT_ORIGIN, /http:\/\/127\.0\.0\.1:/);
  assert.doesNotMatch(read('compose.yaml'), /C:\\|runtime-context|Dockerfile\.artifact|backups\//);
});

test('runtime signing material is generated once and exposed only to the API', () => {
  const config = YAML.parse(read('compose.yaml'));
  const api = config.services.api;
  const web = config.services.web;
  const scratch = config.services.scratch;
  assert.match(
    String(api.environment.ASA_BLOCKS_RUNTIME_SIGNING_KEY),
    /ASA_BLOCKS_RUNTIME_SIGNING_KEY/,
  );
  assert.match(String(api.environment.ASA_BLOCKS_RUNTIME_ORIGIN), /ASA_BLOCKS_RUNTIME_ORIGIN/);
  assert.equal(web.environment?.ASA_BLOCKS_RUNTIME_SIGNING_KEY, undefined);
  assert.equal(web.build.args.ASA_BLOCKS_RUNTIME_SIGNING_KEY, undefined);
  assert.equal(scratch.environment?.ASA_BLOCKS_RUNTIME_SIGNING_KEY, undefined);
  assert.equal(scratch.build.args.ASA_BLOCKS_RUNTIME_SIGNING_KEY, undefined);
  for (const file of ['tools/asa-lab.ps1', 'tools/asa-lab.sh']) {
    const source = read(file);
    assert.match(source, /ASA_BLOCKS_RUNTIME_SIGNING_KEY/);
    assert.match(source, /32/);
  }
  for (const file of ['tools/docker-update.ps1', 'tools/docker-update.sh']) {
    const source = read(file);
    assert.match(source, /ASA_BLOCKS_RUNTIME_SIGNING_KEY/);
    assert.match(source, /CHECK NOTE: full update will generate/);
    assert.match(source, /32/);
  }
});

test('private Blocks object storage stays inside the canonical Compose project', () => {
  const config = YAML.parse(read('compose.yaml'));
  const minio = config.services.minio;
  const init = config.services['minio-init'];
  const api = config.services.api;
  const web = config.services.web;
  const scratch = config.services.scratch;
  assert.equal(minio.image, '${ASA_MINIO_IMAGE:-asa-lab-minio:${ASA_IMAGE_TAG:-local}}');
  assert.equal(minio.build.context, '.');
  assert.equal(minio.build.dockerfile, 'infra/minio/Dockerfile');
  assert.equal(init.image, minio.image);
  assert.equal(minio.user, '1000:1000');
  assert.equal(init.user, '1000:1000');
  assert.equal(minio.read_only, true);
  assert.equal(init.read_only, true);
  assert.equal(minio.ports, undefined);
  assert.equal(init.ports, undefined);
  assert.deepEqual(minio.networks, ['application']);
  assert.deepEqual(init.networks, ['application']);
  assert.deepEqual(minio.volumes, ['blocks-object-data:/data']);
  assert.equal(Object.hasOwn(config.volumes, 'blocks-object-data'), true);
  assert.equal(api.depends_on['minio-init'].condition, 'service_completed_successfully');
  assert.match(String(init.entrypoint.join(' ')), /anonymous set none/);
  assert.doesNotMatch(String(minio.command), /console-address/);
  const recipe = read('infra/minio/Dockerfile');
  assert.match(recipe, /minio\.linux-amd64\.RELEASE\.2024-09-13T20-26-02Z/);
  assert.match(recipe, /mc\.linux-amd64\.RELEASE\.2024-09-16T17-43-14Z/);
  assert.equal((recipe.match(/ADD --checksum=sha256:[0-9a-f]{64}/g) ?? []).length, 2);
  assert.match(recipe, /USER 1000:1000/);
  assert.doesNotMatch(recipe, /:latest/);
  for (const name of ['ASA_OBJECT_STORAGE_ACCESS_KEY', 'ASA_OBJECT_STORAGE_SECRET_KEY']) {
    assert.match(String(api.environment[name]), new RegExp(name));
    assert.equal(web.environment?.[name], undefined);
    assert.equal(web.build.args[name], undefined);
    assert.equal(scratch.environment?.[name], undefined);
    assert.equal(scratch.build.args[name], undefined);
  }
  for (const file of ['tools/asa-lab.ps1', 'tools/asa-lab.sh']) {
    const source = read(file);
    assert.match(source, /ASA_OBJECT_STORAGE_ENDPOINT/);
    assert.match(source, /ASA_OBJECT_STORAGE_ACCESS_KEY/);
    assert.match(source, /ASA_OBJECT_STORAGE_SECRET_KEY/);
  }
  for (const file of ['tools/docker-update.ps1', 'tools/docker-update.sh']) {
    const source = read(file);
    assert.match(source, /incomplete ASA_OBJECT_STORAGE_/i);
    assert.match(source, /self-hosted Blocks object-storage configuration/);
  }
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

test('parent startup uses the full-screen ASA loader instead of a footer status strip', () => {
  const editor = read('apps/web/src/blocks/BlocksEditor.tsx');
  const css = read('apps/web/src/blocks/blocks-editor-shell.css');
  assert.match(editor, /data-asa-blocks-loading-overlay/);
  assert.match(editor, /\/asa-lab-mark\.svg/);
  assert.doesNotMatch(editor, /blocks-editor-connection-status/);
  assert.doesNotMatch(editor, /window\.confirm/);
  assert.doesNotMatch(editor, /Сохранить в ASA/);
  assert.match(editor, /Не удалось открыть среду/);
  assert.match(editor, /Повторить/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test('startup and guarded updates build every local image before no-build replacement', () => {
  for (const file of ['tools/asa-lab.ps1', 'tools/docker-update.ps1']) {
    const source = read(file);
    assert.match(source, /foreach \(\$service in @\('minio', 'scratch', 'api', 'web'\)\)/);
    assert.ok(source.indexOf("'minio', 'scratch', 'api', 'web'") < source.indexOf("'--no-build'"));
  }
  for (const file of ['tools/asa-lab.sh', 'tools/docker-update.sh']) {
    const source = read(file);
    assert.match(source, /for service in minio scratch api web; do/);
    assert.ok(source.indexOf('minio scratch api web') < source.indexOf('--no-build'));
    assert.doesNotMatch(source, /up.*--build/);
  }
  assert.match(read('tools/asa-lab.sh'), /if \[ -e \.git \]/);
  assert.match(read('tools/asa-lab.sh'), /synchronized/);
});

test('guarded updates inspect real migration history before replacing running services', () => {
  const ps = read('tools/docker-update.ps1');
  const sh = read('tools/docker-update.sh');
  const psPlan =
    "@('run', '--rm', '--no-deps', '--entrypoint', 'node', 'migration', 'tools/migrate.mjs', '--plan')";
  const shPlan = 'compose run --rm --no-deps --entrypoint node migration tools/migrate.mjs --plan';
  assert.ok(ps.includes(psPlan));
  assert.ok(sh.includes(shPlan));
  assert.ok(ps.indexOf(psPlan) < ps.indexOf("@('up', '-d', '--no-build')"));
  assert.ok(sh.indexOf(shPlan) < sh.indexOf('compose up -d --no-build'));
});
