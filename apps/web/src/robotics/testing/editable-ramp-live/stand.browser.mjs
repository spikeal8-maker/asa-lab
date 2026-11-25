#!/usr/bin/env node
// TEST_ONLY R5. Inspection and packaging never launch Chromium or dispatch physics.
/* global window, PageTransitionEvent, requestAnimationFrame */
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import console from 'node:console';
import {
  createHash,
  generateKeyPairSync,
  createPrivateKey,
  createPublicKey,
  sign,
} from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statfsSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../../../../..');
const registrationMain = '08fa611382206d2be83e0b629a087680352b6c7f';
const integrationBase = 'ad58932209bb87fb47d83d4f2f85f88e34782fb2';
const registryBlob = '0b3a76c21c841288f45da2e49b470e75152b01c8';
const planned = [
  'index.html',
  'stand.ts',
  'ramp.worker.ts',
  'stand.browser.mjs',
  'scene.ts',
  'scene.fixture.json',
  'scene.spec.ts',
]
  .map((p) => 'apps/web/src/robotics/testing/editable-ramp-live/' + p)
  .sort();
const configuration = JSON.parse(readFileSync(join(here, 'scene.fixture.json'), 'utf8'));
const aot = {
  root: 'asa-mujoco-aot-worker-nC9CkB',
  build: 'c065ffc9b16ccaa5ed4c9798f5f962fbfe2476526de016d158abdc2c669ea4e9',
  browser: '70262f08f232705bbacf5050c095c6d35cf3f2a6bb0edb5bfc7ca12285b6b3b5',
  glue: '9507aabcc8d80deea66e7f93053092a98857381f087ff0a7e19cefe412ccc1d8',
  wasm: 'd2caf28d73afa997a2534ef0aa940587757c16797653bf476c22994bd2405241',
  declarations: '779287fbb2f116717d533055c737ecf3453e9007e9fea26453ff0464c2cb69ff',
};
const R5 = {
  registration: 'be6d93c5dd76ff2fca86a7beaa77e7bcf237504a',
  source: 'cb068c9baa9ff5ce2208ec3cbd7968962e8e3f42',
  fixture: '6a1b46d96489db96e927f24cdbc59d497a11b864b36572287adc05fa51dcf07d',
  spec: 'd4effe95f81ad99523cc1f434b7e595f8d4b04fe33f20f6779ca5a612c937413',
  xml: 'acc67614d9a64117311867895679719ac1c9bd5031ee2e2718e7ad41d94673c0',
  motorProfileSource: 'd39047ff800115bceff63d6ee8e94f34ddd02886c213d4f6ea1db5a1ece678bc',
  powered: 'ce2494ba0736c27b045096f38324174df2691eb241317aefdb6c53fc1cebd49e',
  control: '4a4b9d3d8cedec0cfdc25ffc91ca8b7fb0a5e411e8b8f65b0356dee0879fbf06',
};
const chromiumSha =
  'fe844627cb1b2131d63eaeF5c272519c3d03f6caafeeBD16D569d6a22a7b793a'.toLowerCase();
const manifestName = 'bundle.manifest.json';
const outPrefix = 'asa-editable-ramp-live-';
const host = 'http://127.0.0.1:4630';
const metadataMax = 1_048_576;
const combinedRawMax = 253_920_000;
const maxBundleBytes = 25_000_000;
const sha = (value) => createHash('sha256').update(value).digest('hex');

function requireThat(condition, code) {
  if (!condition) throw new Error(code);
}
function hashArg(value) {
  requireThat(/^[\da-f]{64}$/.test(value ?? ''), 'EXPECTED_SOURCE_SHA256_ARGUMENT');
  return value;
}
function sourceHead(value) {
  requireThat(/^[\da-f]{40}$/.test(value ?? ''), 'EXPECTED_GIT_SHA');
  return value;
}
function shaPath(path, pin, maximum = 12_000_000) {
  const stat = lstatSync(path);
  requireThat(
    stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= maximum,
    'BOUNDED_LOCAL_FILE ' + path,
  );
  const data = readFileSync(path);
  requireThat(
    data.length === stat.size && (!pin || sha(data) === pin),
    'LOCAL_BYTES_SHA256 ' + path,
  );
  return data;
}
function temp() {
  const root = realpathSync(tmpdir());
  requireThat(isAbsolute(root) && resolve(root) === root, 'EXTERNAL_TEMP_ROOT');
  return root;
}
function within(path, root) {
  const rel = relative(root, path);
  return rel && !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep);
}
function git(...args) {
  return execFileSync('git', ['-C', repo, ...args], { maxBuffer: 4_194_304, windowsHide: true });
}
function exactSources(expectedHead) {
  const head = git('rev-parse', 'HEAD').toString().trim();
  requireThat(
    head === sourceHead(expectedHead) && git('status', '--porcelain=v1', '-uall').length === 0,
    'CLEAN_EXACT_SOURCE_WORKTREE',
  );
  git('merge-base', '--is-ancestor', registrationMain, head);
  requireThat(
    git('rev-parse', head + '^')
      .toString()
      .trim() === integrationBase,
    'ONE_SOURCE_COMMIT_ON_REVIEWED_INTEGRATION_BASE',
  );
  requireThat(
    git('rev-parse', head + ':docs/execution/current.yaml')
      .toString()
      .trim() === registryBlob &&
      git('rev-parse', integrationBase + ':docs/execution/current.yaml')
        .toString()
        .trim() === registryBlob,
    'UNCHANGED_CANONICAL_SELECTION_REGISTRY',
  );
  const added = git('diff', '--name-only', integrationBase, head)
    .toString()
    .trim()
    .split('\n')
    .sort();
  assert.deepEqual(added, planned, 'EXACT_SEVEN_REGISTERED_SOURCE_PATHS');
  return planned.map((path) => {
    const source = shaPath(resolve(repo, path));
    requireThat(source.equals(git('show', head + ':' + path)), 'WORKING_SOURCE_BLOB_EQUALITY');
    return { path, bytes: source.length, sha256: sha(source) };
  });
}
function browserInputFiles() {
  requireThat(
    process.platform === 'win32' && process.version === 'v22.23.3' && process.arch === 'x64',
    'PINNED_D2R2_NODE',
  );
  const root = join(temp(), aot.root);
  shaPath(
    join(temp(), 'a1168b-2678fb17/src/LICENSE'),
    configuration.history.license.sha256,
    configuration.history.license.bytes,
  );
  const build = shaPath(join(root, 'build-receipt.json'), aot.build, 65536);
  const browser = shaPath(join(root, 'browser-receipt.json'), aot.browser, 1_000_000);
  requireThat(
    JSON.parse(build).accepted === true &&
      JSON.parse(browser).accepted === true &&
      JSON.parse(browser).buildReceiptSha256 === aot.build,
    'AOT_RECEIPT_BINDING',
  );
  const glue = shaPath(join(root, 'artifact', 'mujoco.js'), aot.glue);
  const wasm = shaPath(join(root, 'artifact', 'mujoco.wasm'), aot.wasm);
  shaPath(join(root, 'artifact', 'mujoco.d.ts'), aot.declarations);
  requireThat(glue.length === 331846 && wasm.length === 11229000, 'PINNED_ARTIFACT_WIDTHS');
  const fixturePath =
    'tests/robotics/field-core-qualification/arduino-tt-rover-ramp-can.fixture.json';
  const fixture = git('show', R5.source + ':' + fixturePath);
  const spec = git('show', R5.source + ':' + fixturePath.replace('.fixture.json', '.spec.ts'));
  requireThat(sha(fixture) === R5.fixture && sha(spec) === R5.spec, 'IMMUTABLE_R5_ARCHIVE_INPUTS');
  shaPath(
    join(repo, 'contexts/electronics/domain/models/brushed-motor-profiles.ts'),
    R5.motorProfileSource,
  );
  const data = JSON.parse(fixture);
  assert.deepEqual(data, configuration.baselineFixture, 'UNCHANGED_FROZEN_BASELINE_INPUTS');
  shaPath(
    join(repo, 'tests/robotics/field-core-qualification/editable-ramp-geometry.ts'),
    '80d21f82acc576990b825b588adb539bcdd9aef7a784e45dab332eec177ff848',
  );
  requireThat(
    sha(data.xml.join('\n') + '\n') === R5.xml &&
      data.budgets.horizonUs === 10_000_000 &&
      data.expected.pairs.length === 27 &&
      data.expected.geoms.length === 10 &&
      data.comparison.interventionUs === 250003 &&
      data.comparison.prefixIntervals === 503,
    'FROZEN_R5_XML_AND_LIMITS',
  );
  return { fixture, glue, wasm, data };
}
function mime(path) {
  if (path.endsWith('.html')) return 'text/html';
  if (path.endsWith('.js')) return 'text/javascript';
  if (path.endsWith('.json')) return 'application/json';
  if (path.endsWith('.wasm')) return 'application/wasm';
  if (path.endsWith('.css')) return 'text/css';
  throw new Error('UNREGISTERED_OUTPUT_TYPE ' + path);
}
function fileManifest(root) {
  const files = [];
  let bytes = 0;
  const visit = (dir) => {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, item.name);
      requireThat(!item.isSymbolicLink() && within(path, root), 'OUTPUT_REGULAR_PATH');
      if (item.isDirectory()) visit(path);
      else {
        requireThat(item.isFile(), 'OUTPUT_REGULAR_FILE');
        const name = relative(root, path).replaceAll('\\', '/');
        if (name === manifestName) continue;
        requireThat(
          !name.split('/').some((part) => !/^[A-Za-z0-9_.-]+$/.test(part)),
          'OUTPUT_SAFE_NAME',
        );
        const data = shaPath(path);
        bytes += data.length;
        requireThat(bytes <= maxBundleBytes && files.length < 32, 'BOUNDED_STAND_BUNDLE');
        files.push({ path: name, bytes: data.length, sha256: sha(data), mime: mime(name) });
      }
    }
  };
  visit(root);
  return files.sort((left, right) =>
    left.path < right.path ? -1 : Number(left.path > right.path),
  );
}
function checkLayer(root, files) {
  for (const [path, digest] of [
    ['engine/mujoco.js', aot.glue],
    ['engine/mujoco.wasm', aot.wasm],
    ['engine/r5.fixture.json', R5.fixture],
  ])
    requireThat(
      files.find((entry) => entry.path === path)?.sha256 === digest,
      'UNCHANGED_RAW_LAYER',
    );
  requireThat(
    files.some(({ path }) => path === 'index.html') &&
      files.filter(({ path }) => /^assets\/ramp-worker-[\w-]+\.js$/.test(path)).length === 1,
    'NAMED_MODULE_WORKER_OUTPUT',
  );
  const html = shaPath(join(root, 'index.html'), undefined, 100000).toString('utf8');
  requireThat(
    /type="module"[^>]+src="\.\/assets\//.test(html) &&
      !html.includes('/@vite/') &&
      !/src="\/assets\/|https?:\/\/127\.0\.0\.1|src="data:/.test(html),
    'RELATIVE_BUILT_TEST_ENTRY',
  );
}

async function build(head) {
  const sources = exactSources(head);
  const inputs = browserInputFiles();
  const prior = historyAdmission(head);
  const free = statfsSync(temp());
  requireThat(free.bavail * free.bsize > 350_000_000, 'LOCAL_STAND_BUILD_CAPACITY');
  const output = mkdtempSync(join(temp(), outPrefix));
  const root = join(output, 'bundle');
  const keyPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const publicJwk = keyPair.publicKey.export({ format: 'jwk' });
  const privateBytes = keyPair.privateKey.export({ format: 'pem', type: 'pkcs8' });
  writeFileSync(join(output, 'controller-private.pem'), privateBytes, { flag: 'wx', mode: 0o600 });
  const { build: vite } = await import('vite');
  await vite({
    configFile: false,
    envFile: false,
    root: here,
    base: './',
    publicDir: false,
    define: {
      __R5_BUILD_COMMIT__: JSON.stringify(head),
      __RAMP_PUBLIC_JWK__: JSON.stringify(publicJwk),
    },
    worker: {
      format: 'es',
      rollupOptions: { output: { entryFileNames: 'assets/ramp-worker-[hash].js' } },
    },
    build: {
      target: 'es2022',
      outDir: root,
      emptyOutDir: false,
      assetsInlineLimit: 0,
      sourcemap: false,
      assetsDir: 'assets',
      rollupOptions: { input: join(here, 'index.html') },
    },
  });
  mkdirSync(join(root, 'engine'));
  for (const [name, bytes] of [
    ['mujoco.js', inputs.glue],
    ['mujoco.wasm', inputs.wasm],
    ['r5.fixture.json', inputs.fixture],
  ])
    writeFileSync(join(root, 'engine', name), bytes, { flag: 'wx' });
  const files = fileManifest(root);
  checkLayer(root, files);
  assert.deepEqual(exactSources(head), sources, 'SOURCES_UNCHANGED_DURING_BUILD');
  const manifest = {
    schema: 'ASA_EDITABLE_RAMP_STAND_BUNDLE_V1',
    integrationBase,
    registryBlob,
    controllerPublicJwk: publicJwk,
    controllerPrivateSha256: sha(privateBytes),
    scope: 'TEST_ONLY',
    head,
    sources,
    aotReceipt: { build: aot.build, browser: aot.browser },
    r5: R5,
    prior,
    files,
  };
  const bytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  const path = join(root, manifestName);
  writeFileSync(path, bytes, { flag: 'wx' });
  console.log(
    JSON.stringify({
      status: 'BUILT_STATIC_TEST_ONLY',
      manifestPath: path,
      manifestSha256: sha(bytes),
      head,
      nativeAdvances: 0,
      files: files.length,
    }),
  );
}

function openBundle(path, expectedSha, head) {
  const root = dirname(path);
  const stage = dirname(root);
  requireThat(
    isAbsolute(path) &&
      realpathSync(path) === resolve(path) &&
      dirname(stage) === temp() &&
      root === join(stage, 'bundle') &&
      relative(temp(), stage).startsWith(outPrefix) &&
      path === join(root, manifestName),
    'REVIEWED_TEMP_BUNDLE_RECEIPT',
  );
  const manifestBytes = shaPath(path, hashArg(expectedSha), 65536);
  const manifest = JSON.parse(manifestBytes);
  requireThat(
    manifest.schema === 'ASA_EDITABLE_RAMP_STAND_BUNDLE_V1' &&
      manifest.integrationBase === integrationBase &&
      manifest.registryBlob === registryBlob &&
      manifest.scope === 'TEST_ONLY' &&
      manifest.head === sourceHead(head) &&
      manifest.aotReceipt.build === aot.build &&
      manifest.aotReceipt.browser === aot.browser,
    'REVIEWED_BUILD_IDENTITY',
  );
  assert.deepEqual(manifest.sources, exactSources(head), 'REVIEWED_SOURCE_BYTES');
  assert.deepEqual(manifest.r5, R5);
  assert.deepEqual(manifest.files, fileManifest(root), 'REVIEWED_ARTIFACT_BYTES');
  checkLayer(root, manifest.files);
  const allowed = [
    ...manifest.files,
    {
      path: manifestName,
      bytes: manifestBytes.length,
      sha256: expectedSha,
      mime: 'application/json',
    },
  ];
  return {
    root,
    stage,
    allowed,
    manifest,
    url: host + '/__asa_robotics_test/' + expectedSha + '/',
  };
}

async function httpCheck(bundle) {
  const responses = [];
  for (const item of bundle.allowed) {
    const expectedUrl = bundle.url + item.path;
    const response = await globalThis.fetch(expectedUrl, {
      redirect: 'error',
      cache: 'no-store',
      signal: globalThis.AbortSignal.timeout(10000),
      headers: { accept: item.mime, 'accept-encoding': 'identity' },
    });
    requireThat(
      response.status === 200 &&
        response.url === expectedUrl &&
        response.headers.get('content-type')?.split(';')[0] === item.mime,
      'ACTUAL_4630_HTTP_TYPE ' + item.path,
    );
    const raw = Buffer.from(await response.arrayBuffer());
    requireThat(
      raw.length === item.bytes && sha(raw) === item.sha256,
      'ACTUAL_4630_HTTP_SHA256 ' + item.path,
    );
    responses.push({
      path: item.path,
      bytes: raw.length,
      sha256: item.sha256,
      mime: item.mime,
      csp: response.headers.get('content-security-policy'),
    });
  }
  for (const path of [
    bundle.url + 'controller-private.pem',
    new URL('../controller-private.pem', bundle.url).href,
  ]) {
    const denied = await globalThis.fetch(path, {
      redirect: 'error',
      cache: 'no-store',
      signal: globalThis.AbortSignal.timeout(10000),
    });
    const bytes = Buffer.from(await denied.arrayBuffer());
    requireThat(
      sha(bytes) !== bundle.manifest.controllerPrivateSha256,
      'PRIVATE_CONTROLLER_KEY_WAS_SERVED',
    );
    responses.push({ path: new URL(path).pathname, status: denied.status, privateKeyAbsent: true });
  }
  return responses;
}

function chromiumPackage() {
  const local = createRequire(join(repo, 'package.json'));
  requireThat(local('@playwright/test/package.json').version === '1.55.1', 'PINNED_PLAYWRIGHT');
  const { chromium } = local('@playwright/test');
  const exe = chromium.executablePath();
  requireThat(
    exe.replaceAll('\\', '/').endsWith('/chromium-1193/chrome-win/chrome.exe'),
    'PINNED_CHROMIUM_LOCATION',
  );
  shaPath(exe, chromiumSha);
  return { chromium, exe };
}

function writeAll(fd, buffer) {
  writeFileSync(fd, buffer);
}
function proveSpace(path) {
  const free = statfsSync(path);
  requireThat(free.bavail * free.bsize > 1_200_000_000, 'LOCAL_RECEIPT_CAPACITY');
}
function errorText(error) {
  return (error instanceof Error ? error.name + ': ' + error.message : String(error)).slice(
    0,
    1800,
  );
}

function stringifyRecord(value) {
  return JSON.stringify(value, (_key, v) => (Object.is(v, -0) ? { $asaF64: '-0' } : v));
}
function parseRecord(text) {
  return JSON.parse(text, (_key, v) => {
    if (v && typeof v === 'object' && '$asaF64' in v) {
      requireThat(Object.keys(v).length === 1 && v.$asaF64 === '-0', 'INVALID_SIGNED_ZERO_LABEL');
      return -0;
    }
    return v;
  });
}
function historyAdmission(head) {
  const path = process.env.ASA_EDITABLE_RAMP_HISTORY_DIR;
  requireThat(
    isAbsolute(path ?? '') && within(realpathSync(path), temp()),
    'IMMUTABLE_HISTORY_DIRECTORY',
  );
  shaPath(
    join(path, 'qualification.bin'),
    configuration.history.binary.sha256,
    configuration.history.binary.bytes,
  );
  shaPath(
    join(path, 'qualification.jsonl'),
    configuration.history.metadata.sha256,
    configuration.history.metadata.bytes,
  );
  const executable = join(
    dirname(createRequire(join(repo, 'package.json')).resolve('vitest/package.json')),
    'vitest.mjs',
  );
  const output = execFileSync(
    process.execPath,
    [
      executable,
      'run',
      join(here, 'scene.spec.ts'),
      '--maxWorkers=1',
      '-t',
      'replays retained full R5',
    ],
    {
      cwd: repo,
      env: { ...process.env, ASA_EDITABLE_RAMP_HISTORY_DIR: path },
      encoding: 'utf8',
      maxBuffer: 4194304,
      windowsHide: true,
    },
  );
  const match = /ASA_RAMP_HISTORY_REPLAY (\{[^\n]+\})/.exec(output);
  requireThat(match, 'FULL_IMMUTABLE_HISTORY_REPLAY_RECEIPT');
  const result = JSON.parse(match[1]);
  requireThat(
    result.noNative === true &&
      result.intervals === 40180 &&
      result.source === configuration.history.source &&
      result.binary === configuration.history.binary.sha256 &&
      result.metadata === configuration.history.metadata.sha256,
    'HISTORY_REPLAY_BINDING',
  );
  return {
    head,
    result,
    verifier: {
      file: 'scene.spec.ts',
      bytes: shaPath(join(here, 'scene.spec.ts')).length,
      sha256: sha(shaPath(join(here, 'scene.spec.ts'))),
    },
    sourceSha256: sha(shaPath(join(here, 'scene.ts'))),
  };
}
// The only active input is the stand UI. This observer has no module route or simulation command.
function proofRecorder(meta, raw, fixture) {
  const worlds = new Map();
  let metadataBytes = 0;
  let rawBytes = 0;
  let firstError;
  const line = (record) => {
    const bytes = Buffer.from(stringifyRecord(record) + '\n');
    requireThat(metadataBytes + bytes.length <= metadataMax, 'PAIR_METADATA_CAP');
    writeAll(meta, bytes);
    metadataBytes += bytes.length;
  };
  function world(generation) {
    let owner = worlds.get(generation);
    if (!owner) {
      requireThat(
        worlds.size < 2 && Number.isSafeInteger(generation) && generation > 0,
        'EXACT_TWO_FRESH_GENERATIONS',
      );
      owner = {
        generation,
        count: 0,
        at: 0,
        nativeTime: 0,
        bytes: 0,
        prefixIntervals: 0,
        census: 0,
        prefix: createHash('sha256'),
        rows: createHash('sha256'),
        pauses: [],
      };
      worlds.set(generation, owner);
    }
    return owner;
  }
  function chunk(owner, record) {
    const { firstTick, count, binary, runCase } = record;
    requireThat(
      owner.factory &&
        !owner.finish &&
        runCase === owner.factory.runCase &&
        firstTick === owner.count + 1 &&
        Number.isSafeInteger(count) &&
        count >= 1 &&
        count <= 32 &&
        typeof binary === 'string' &&
        binary.length < 1_400_000 &&
        owner.count + count <= fixture.raw.maxIntervalsPerWorld,
      'ORDERED_PROOF_CHUNK',
    );
    const bytes = Buffer.from(binary, 'base64');
    requireThat(
      bytes.length > 0 &&
        bytes.toString('base64') === binary &&
        rawBytes + bytes.length <= combinedRawMax &&
        owner.bytes + bytes.length <= combinedRawMax / 2,
      'PAIR_RAW_BYTE_CAP',
    );
    const offset = rawBytes;
    writeAll(raw, bytes);
    rawBytes += bytes.length;
    owner.bytes += bytes.length;
    owner.rows.update(bytes);
    line({
      kind: 'binary-chunk',
      generation: owner.generation,
      runCase,
      firstTick,
      count,
      offset,
      bytes: bytes.length,
      sha256: sha(bytes),
    });
    let cursor = 0;
    for (let i = 0; i < count; i++) {
      requireThat(cursor + 210 * 8 <= bytes.length, 'RAW_INTERVAL_HEADER');
      const words = bytes.readDoubleLE(cursor);
      const word = (n) => bytes.readDoubleLE(cursor + 8 * (1 + n));
      const to = word(1);
      const rawTime = word(3);
      const contacts = word(207);
      const active = word(208);
      const byteWidth = 8 * (words + 1);
      owner.census += contacts;
      requireThat(owner.census <= 450000, 'ALL_NATIVE_CONTACT_CUMULATIVE_CAP');
      requireThat(
        Number.isSafeInteger(contacts) &&
          contacts >= 0 &&
          contacts <= fixture.raw.maxContactsPerInterval &&
          Number.isSafeInteger(active) &&
          active >= 0 &&
          active <= contacts &&
          words === 209 + contacts + 24 * active &&
          cursor + byteWidth <= bytes.length &&
          word(0) === owner.at &&
          Object.is(word(2), owner.nativeTime) &&
          Number.isSafeInteger(to) &&
          to > owner.at &&
          to - owner.at <= fixture.budgets.maxStepUs &&
          to <= fixture.budgets.horizonUs &&
          Math.abs(rawTime * 1e6 - to) <= fixture.budgets.clockToleranceUs,
        'RAW_INTERVAL_CLOCK_IDENTITY',
      );
      for (let k = 0; k < words; k++) requireThat(Number.isFinite(word(k)), 'RAW_FINITE_WORD');
      if (to <= fixture.comparison.interventionUs) {
        owner.prefix.update(bytes.subarray(cursor, cursor + byteWidth));
        owner.prefixIntervals++;
      }
      owner.at = to;
      owner.nativeTime = rawTime;
      owner.count++;
      cursor += byteWidth;
    }
    requireThat(cursor === bytes.length, 'EXACT_BINARY_CHUNK_LENGTH');
  }
  function endpointDigest(generation, endpoint, value) {
    requireThat(
      value &&
        typeof value.f64leHex === 'string' &&
        /^[0-9a-f]+$/.test(value.f64leHex) &&
        value.f64leHex.length % 16 === 0 &&
        value.f64leHex.length <= 4096,
      'BOUNDED_NATIVE_ENDPOINT_PACKET',
    );
    const bytes = Buffer.from(value.f64leHex, 'hex');
    line({
      kind: 'endpoint-energy-digest',
      generation,
      endpoint,
      atNativeSeconds: value.state.time,
      bytes: bytes.length,
      sha256: sha(bytes),
    });
  }
  function receive(event) {
    try {
      requireThat(
        event?.kind === 'proof' && event.record && typeof event.record.kind === 'string',
        'TYPED_WORKER_PROOF_RECEIPT',
      );
      const owner = world(event.generation);
      const { record } = event;
      if (record.kind === 'intervals') {
        chunk(owner, record);
        return;
      }
      line(event);
      if (record.kind === 'factory') {
        requireThat(
          !owner.factory &&
            (record.runCase === 'powered' || record.runCase === 'control') &&
            record.runTimeUs === 0 &&
            record.ledger.step1 === 0 &&
            record.ledger.step2 === 0 &&
            record.pins.circuitSha256 === R5[record.runCase],
          'EXACT_FACTORY_AND_CIRCUIT_RECEIPT',
        );
        owner.factory = record;
        endpointDigest(event.generation, 'initial', record.energy);
      } else if (record.kind === 'pause') {
        requireThat(
          owner.factory &&
            !owner.finish &&
            record.atMicroseconds === owner.at &&
            record.tickId === owner.count &&
            owner.count > 0 &&
            record.ledger.step2 === owner.count &&
            Object.is(record.native.time, owner.nativeTime),
          'PAUSE_NATIVE_COMMITTED_TICK',
        );
        owner.pauses.push(record);
      } else if (record.kind === 'finish') {
        requireThat(!owner.finish, 'ONE_FINISH_PER_WORLD');
        owner.finish = record;
        if (record.runtime === 'COMPLETE')
          endpointDigest(event.generation, 'final', record.endpointEnergy);
      } else if (record.kind === 'startup-error') {
        requireThat(!owner.startupError, 'ONE_STARTUP_ERROR');
        owner.startupError = record;
      } else if (record.kind === 'cleanup') {
        requireThat(!owner.cleanup, 'ONE_CLEANUP_PER_WORLD');
        owner.cleanup = record;
      } else throw new Error('UNREGISTERED_WORKER_PROOF ' + record.kind);
    } catch (error) {
      firstError ??= errorText(error);
    }
  }
  function result() {
    const seen = Array.from(worlds.values(), (owner) => ({
      generation: owner.generation,
      startupError: owner.startupError ?? null,
      runCase: owner.factory?.runCase ?? owner.cleanup?.runCase,
      intervals: owner.count,
      atMicroseconds: owner.at,
      bytes: owner.bytes,
      sha256: owner.rows.copy().digest('hex'),
      prefixIntervals: owner.prefixIntervals,
      prefixSha256: owner.prefix.copy().digest('hex'),
      pauseCount: owner.pauses.length,
      finish: owner.finish ?? null,
      cleanup: owner.cleanup ?? null,
    }));
    return { rawBytes, worlds: seen, observerError: firstError ?? null };
  }
  return { world, receive, line, result };
}

function nativeStep2Count(playedGenerations, details, maxIntervals) {
  if (playedGenerations.length === 0) return 0;
  if (details.observerError) return null;
  let count = 0;
  for (const generation of playedGenerations) {
    const world = details.worlds.find((item) => item.generation === generation);
    if (!world) return null;
    const counters = [world.cleanup?.step2, world.finish?.ledger?.step2].filter(
      (value) => value !== undefined,
    );
    const steps = counters[0];
    if (
      !Number.isSafeInteger(steps) ||
      steps < world.intervals ||
      steps > maxIntervals ||
      !counters.every((value) => value === steps)
    )
      return null;
    count += steps;
  }
  return count;
}

function assertPair(details, data) {
  requireThat(!details.observerError && details.worlds.length === 2, 'VALID_EXACT_PAIR_PROOF');
  const [powered, control] = details.worlds;
  requireThat(
    powered.runCase === 'powered' &&
      control.runCase === 'control' &&
      powered.generation < control.generation &&
      powered.pauseCount === 1 &&
      control.pauseCount === 0 &&
      powered.prefixSha256 === control.prefixSha256,
    'MATCHED_LIVE_PRE_D5_AND_PAUSE',
  );
  for (const owner of details.worlds) {
    const { finish, cleanup } = owner;
    requireThat(
      owner.atMicroseconds === data.budgets.horizonUs &&
        owner.prefixIntervals === data.comparison.prefixIntervals &&
        finish?.runtime === 'COMPLETE' &&
        finish.atMicroseconds === owner.atMicroseconds &&
        finish.tickId === owner.intervals &&
        finish.bytes === owner.bytes &&
        finish.causal === 'GAP_CAUSAL_ALT' &&
        cleanup?.runCase === owner.runCase &&
        cleanup.step1 === owner.intervals &&
        cleanup.step1Returned === owner.intervals &&
        cleanup.step2 === owner.intervals &&
        cleanup.step2Returned === owner.intervals &&
        cleanup.owned === cleanup.freed &&
        cleanup.cleanupFailures.length === 0,
      'COMPLETE_EXACT_NATIVE_CLOCKS_COUNTS_AND_CLEANUP',
    );
    assert.deepEqual(cleanup.persistent, { session: 1, buffer: 3, data: 1, model: 1 });
  }
  return powered.finish.physical === 'PASS' && control.finish.physical === 'PASS';
}

const readyTimeout = 30000;
function standPhase(page, phase, timeout = readyTimeout) {
  return page
    .locator('[data-testid="r5-run-state"][data-state="' + phase + '"]')
    .waitFor({ state: 'visible', timeout });
}
async function standTerminal(page, expected) {
  const status = page.locator(
    '[data-testid="r5-run-state"][data-state="' +
      expected +
      '"], [data-testid="r5-run-state"][data-state="fault"]',
  );
  await status.waitFor({ state: 'visible', timeout: 360000 });
  requireThat(
    (await status.getAttribute('data-state')) === expected,
    'STAND_RUNTIME_FAULT ' + (await page.locator('[data-testid="r5-run-state"]').innerText()),
  );
}
function observation(page) {
  return page.locator('#r5-app').evaluate((app) => ({
    generation: Number(app.dataset.r5Generation),
    tickId: Number(app.dataset.r5Tick),
    atMicroseconds: Number(app.dataset.r5TimeUs),
    poses: app.dataset.poses ?? null,
  }));
}
function assertDisplayedPoses(raw) {
  requireThat(
    typeof raw === 'string' && raw.length > 0 && raw.length <= 2500,
    'VISIBLE_POSES_PRESENT',
  );
  const rows = JSON.parse(raw);
  const names = ['rover', 'rear-axle', 'front-left-wheel', 'front-right-wheel', 'empty-can'];
  const vector = (values, width) =>
    Array.isArray(values) && values.length === width && values.every(Number.isFinite);
  requireThat(
    Array.isArray(rows) &&
      rows.length === names.length &&
      rows.every(
        (row, i) =>
          Array.isArray(row) &&
          row.length === 3 &&
          row[0] === names[i] &&
          vector(row[1], 3) &&
          vector(row[2], 4) &&
          Math.hypot(...row[2]) > 0,
      ),
    'VISIBLE_FIVE_NATIVE_POSES',
  );
}

async function enterParameters(page, p) {
  for (const [testId, value] of [
    ['ramp-width', p.widthMeters],
    ['ramp-height', p.heightMeters],
    ['ramp-x', 0],
    ['ramp-y', 0],
  ]) {
    const input = page.getByTestId(testId);
    await input.fill(String(value));
    await input.press('Tab');
  }
  const angle = page.getByTestId('ramp-angle');
  await angle.fill(p.id === 'edited6' ? '6' : '5');
  await angle.press('Tab');
  requireThat(
    Number(await page.getByTestId('ramp-height').inputValue()) === p.heightMeters,
    'HEIGHT_ANGLE_UI_INVERSE',
  );
  await page.getByTestId('r5-view-top').click();
  const viewport = page.getByTestId('r5-viewport');
  await page.locator('#r5-viewport[data-ramp-projection]').waitFor({ state: 'visible' });
  // Read two ordinary renderer frames so the matrix is the selected real Top camera.
  await viewport.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  const drop = await viewport.evaluate((element, p) => {
    const canvas = element.querySelector('canvas');
    if (!canvas) throw new Error('ACTUAL_RENDER_CANVAS');
    const rect = canvas.getBoundingClientRect(),
      matrices = JSON.parse(element.dataset.rampProjection);
    const mul = (m, v) =>
      [0, 1, 2, 3].map((row) => [0, 1, 2, 3].reduce((sum, k) => sum + m[k * 4 + row] * v[k], 0));
    const point = mul(
      matrices.projection,
      mul(matrices.inverseWorld, [p.originXMeters, 0, -p.originYMeters, 1]),
    );
    if (!point.every(Number.isFinite) || point[3] <= 0) throw new Error('ACTUAL_TOP_PROJECTION');
    return {
      x: rect.left + ((point[0] / point[3] + 1) * rect.width) / 2,
      y: rect.top + ((1 - point[1] / point[3]) * rect.height) / 2,
    };
  }, p);
  const box = await page.getByTestId('ramp-item').boundingBox();
  requireThat(box, 'VISIBLE_SIDEBAR_CARD');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 12, box.y + box.height / 2, { steps: 4 });
  await page.mouse.move(drop.x - 1, drop.y, { steps: 12 });
  await page.mouse.move(drop.x, drop.y);
  requireThat(
    (await viewport.getAttribute('data-placement')) === 'true',
    'REAL_SIDEBAR_DRAG_PREVIEW',
  );
  requireThat(
    (await viewport.getAttribute('data-invalid')) === null,
    'VALID_SIDEBAR_DRAG_CANDIDATE',
  );
  await page.mouse.up();
  requireThat(
    (await viewport.getAttribute('data-placement')) === null,
    'DRAG_PREVIEW_CLEARED_ON_DROP',
  );
  requireThat(
    Number(await page.getByTestId('ramp-x').inputValue()) === p.originXMeters &&
      Number(await page.getByTestId('ramp-y').inputValue()) === p.originYMeters,
    'REAL_SIDEBAR_PLACEMENT',
  );
  await page.getByTestId('r5-view-spatial').click();
}
function admissionPayload(nonce, generation, runCase, p) {
  requireThat(
    /^[a-f0-9]{64}$/.test(nonce) &&
      Number.isSafeInteger(generation) &&
      generation >= 1 &&
      generation <= 8 &&
      ['powered', 'control'].includes(runCase),
    'SIGNED_ADMISSION_FIELDS',
  );
  const parameters = {};
  for (const key of ['widthMeters', 'heightMeters', 'originXMeters', 'originYMeters']) {
    const value = p?.[key],
      range = configuration.limits[key];
    requireThat(
      Number.isFinite(value) && value >= range[0] && value <= range[1],
      'SIGNED_ADMISSION_PARAMETERS',
    );
    parameters[key] = Object.is(value, -0) ? 0 : value;
  }
  return { nonce, generation, runCase, parameters };
}
function createAdmissionController(key, persist) {
  let count = 0,
    nonce = null,
    operatorOpen = false,
    closed = false;
  const entries = [];
  return {
    reserve(request) {
      requireThat(!closed && count < 8 && (count < 4 || operatorOpen), 'CONTROLLER_WINDOW_AND_CAP');
      const payload = admissionPayload(
        request.nonce,
        count + 1,
        request.runCase,
        request.parameters,
      );
      requireThat(nonce === null || nonce === payload.nonce, 'ONE_WORKER_MODULE_NO_RELOAD_RESTART');
      if (count < 4) {
        const expected = count < 2 ? configuration.baseline : configuration.edited,
          runCase = count % 2 === 0 ? 'powered' : 'control';
        assert.deepEqual(
          payload.parameters,
          admissionPayload(payload.nonce, 1, runCase, expected).parameters,
        );
        requireThat(payload.runCase === runCase, 'FROZEN_FOUR_WORLD_ORDER');
      }
      nonce ??= payload.nonce;
      count = payload.generation;
      entries.push(payload);
      try {
        persist(payload);
      } catch (error) {
        closed = true;
        throw error;
      }
      const signature = sign('sha256', Buffer.from(JSON.stringify(payload)), {
        key,
        dsaEncoding: 'ieee-p1363',
      }).toString('base64');
      return { ...payload, signature };
    },
    openOperator() {
      requireThat(count === 4 && !closed, 'FOUR_QUALIFICATIONS_FIRST');
      operatorOpen = true;
    },
    close() {
      closed = true;
      operatorOpen = false;
    },
    count: () => count,
    entries: () => entries.slice(),
  };
}
async function exerciseWorld(page, runCase, p, generation, recorder, screenshot) {
  await page.getByTestId('r5-run-case').selectOption(runCase);
  await enterParameters(page, p);
  await page.getByTestId('r5-reset').click();
  await standTerminal(page, 'ready');
  const first = await observation(page);
  assertDisplayedPoses(first.poses);
  requireThat(
    first.generation === generation && first.tickId === 0 && first.atMicroseconds === 0,
    'FRESH_SIGNED_NATIVE_FACTORY',
  );
  requireThat(
    (await page.locator('#r5-app').getAttribute('data-scene-authority')) === 'native',
    'COMPILED_GEOMETRY_AUTHORITY',
  );
  assert.deepEqual(
    JSON.parse(await page.locator('#r5-app').getAttribute('data-parameters')),
    admissionPayload('00'.repeat(32), 1, runCase, p).parameters,
  );
  recorder.line({ kind: 'ui-play-action', generation });
  await page.getByTestId('r5-play').click();
  await standPhase(page, 'running');
  if (runCase === 'powered') {
    await page
      .locator('#r5-app[data-r5-tick]:not([data-r5-tick="0"])')
      .waitFor({ state: 'visible' });
    await page.getByTestId('r5-pause').click();
    await standPhase(page, 'paused');
    const paused = await observation(page);
    assertDisplayedPoses(paused.poses);
    for (const [id, view] of [
      ['r5-view-top', 'top'],
      ['r5-view-spatial', 'spatial'],
    ]) {
      await page.getByTestId(id).click();
      requireThat(
        (await page.getByTestId('r5-viewport').getAttribute('data-view')) === view,
        'VIEW_ACTION',
      );
      assert.deepEqual(await observation(page), paused, 'SAME_COMMITTED_VIEW_TICK');
    }
    await new Promise((resolve) => globalThis.setTimeout(resolve, 150));
    assert.deepEqual(await observation(page), paused, 'PAUSED_NATIVE_POSES_AND_CLOCK');
    await page.getByTestId('r5-pause').click();
  }
  await standTerminal(page, 'complete');
  const final = await observation(page);
  requireThat(
    final.generation === generation && final.atMicroseconds === 10000000,
    'COMPLETE_VISIBLE_NATIVE_HORIZON',
  );
  if (runCase === 'powered') {
    const bytes = await page.screenshot({ fullPage: true, timeout: 5000 });
    requireThat(bytes.length > 0 && bytes.length < 6000000, 'SCREENSHOT_BOUND');
    writeFileSync(screenshot, bytes, { flag: 'wx' });
    recorder.line({
      kind: 'screenshot',
      file: screenshot,
      bytes: bytes.length,
      sha256: sha(bytes),
    });
  }
}
function acquisitionIssue(faults, details) {
  if (faults.length) return faults[0];
  for (const pair of details) {
    if (pair.observerError) return pair.observerError;
    for (const world of pair.worlds) {
      if (world.startupError) return world.startupError.error ?? 'STARTUP_ERROR';
      if (world.finish?.runtime === 'ERROR') return world.finish.error ?? 'WORKER_RUNTIME_ERROR';
      if (
        world.cleanup &&
        (world.cleanup.owned !== world.cleanup.freed || world.cleanup.cleanupFailures.length)
      )
        return world.cleanup.cleanupFailures[0] ?? 'NATIVE_RESOURCE_LEAK';
    }
  }
  return null;
}
async function qualify(bundle, chromium, exe, data, operator = false) {
  requireThat(
    process.env.ASA_EDITABLE_RAMP_NATIVE === 'one-four-world-programme-1071',
    'EXPLICIT_NEW_CONTROLLER_TOKEN',
  );
  requireThat(
    !Object.keys(process.env).some(
      (k) => /^(ASA_R5|ASA_TT_|ASA_PHY|ASA_EPA).*NATIVE/.test(k) && process.env[k],
    ),
    'HISTORICAL_NATIVE_TOKENS_DENIED',
  );
  proveSpace(bundle.stage);
  const prior = historyAdmission(bundle.manifest.head);
  const http = await httpCheck(bundle);
  const keyBytes = shaPath(
    join(bundle.stage, 'controller-private.pem'),
    bundle.manifest.controllerPrivateSha256,
    8192,
  );
  const key = createPrivateKey(keyBytes);
  assert.deepEqual(
    createPublicKey(key).export({ format: 'jwk' }),
    bundle.manifest.controllerPublicJwk,
    'CONTROLLER_KEY_PAIR_MATCH',
  );
  const opened = [];
  const recorders = [];
  const pairPaths = [];
  const played = [];
  const faults = [];
  let closeController = () => undefined;
  let browser,
    page,
    firstError,
    qualification = null,
    operatorOutcome = operator ? 'NOT_OPENED' : 'NOT_REQUESTED',
    attempts = 0;
  const observeFault = (error) => {
    const cause = errorText(error);
    if (faults.length < 32) faults.push(cause);
    firstError ??= cause;
  };
  // All eight possible construction reservations share this ONE closure across reloads/contexts.
  const admissionLedger = [];
  const pair = (index) => {
    if (recorders[index]) return recorders[index];
    requireThat(index >= 0 && index < 4, 'MAX_FOUR_PAIR_RECEIPTS');
    const name = ['baseline', 'edited', 'operator-a', 'operator-b'][index];
    const metadata = join(bundle.stage, name + '.qualification.jsonl'),
      binary = join(bundle.stage, name + '.qualification.bin');
    const meta = openSync(metadata, 'wx');
    opened.push(meta);
    const raw = openSync(binary, 'wx');
    opened.push(raw);
    const recorder = proofRecorder(meta, raw, data);
    recorders[index] = recorder;
    pairPaths[index] = { metadata, binary };
    recorder.line({
      kind: 'start',
      head: bundle.manifest.head,
      scenario: name,
      http,
      prior,
      scope: 'TEST_ONLY',
      engine: aot,
      source: bundle.manifest.sources,
    });
    return recorder;
  };
  pair(0);
  pair(1);
  try {
    browser = await chromium.launch({
      executablePath: exe,
      headless: !operator,
      args: ['--disable-background-networking'],
    });
    const context = await browser.newContext({ serviceWorkers: 'block', locale: 'ru-RU' });
    page = await context.newPage();
    const urls = new Set(bundle.allowed.map((v) => bundle.url + v.path));
    context.on('request', (r) => {
      if (!urls.has(r.url()) || r.method() !== 'GET') observeFault('UNEXPECTED_REQUEST ' + r.url());
    });
    context.on('response', (r) => {
      if (!urls.has(r.url()) || r.status() !== 200)
        observeFault('UNEXPECTED_RESPONSE ' + r.status() + ' ' + r.url());
    });
    context.on('requestfailed', (r) => observeFault('REQUEST_FAILED ' + r.url()));
    page.on('pageerror', observeFault);
    const trusted = (source) =>
      source.page === page &&
      source.frame === page.mainFrame() &&
      source.frame.url() === bundle.url + 'index.html';
    const controller = createAdmissionController(key, (payload) => {
      attempts = payload.generation;
      admissionLedger.push(payload);
      const owner = pair(Math.floor((attempts - 1) / 2));
      owner.line({ kind: 'controller-reservation', ...payload });
      fsyncSync(opened[Math.floor((attempts - 1) / 2) * 2]);
    });
    closeController = () => controller.close();
    await page.exposeBinding('__asaRampReserve', (source, request) => {
      requireThat(trusted(source), 'CONTROLLER_SAME_REVIEWED_CONTEXT');
      try {
        return controller.reserve(request);
      } catch (error) {
        observeFault(error);
        throw error;
      }
    });
    await page.exposeBinding('__asaRampControl', (source, event) => {
      requireThat(
        trusted(source) &&
          event?.kind === 'play-attempt' &&
          Number.isSafeInteger(event.generation) &&
          event.generation >= 1 &&
          event.generation <= attempts,
        'TRUSTED_PLAY_ATTEMPT',
      );
      if (!played.includes(event.generation)) played.push(event.generation);
      pair(Math.floor((event.generation - 1) / 2)).line({
        kind: 'ui-play-attempt',
        generation: event.generation,
      });
    });
    await page.exposeBinding('__asaR5Record', (source, event) => {
      requireThat(
        trusted(source) &&
          event?.kind === 'proof' &&
          Number.isSafeInteger(event.generation) &&
          event.generation >= 1 &&
          event.generation <= attempts,
        'TRUSTED_GENERATION_WITNESS',
      );
      const recorder = pair(Math.floor((event.generation - 1) / 2));
      recorder.receive(event);
      const issue = acquisitionIssue([], [recorder.result()]);
      if (issue) observeFault(issue);
    });
    await page.addInitScript(() => {
      window.addEventListener('asa-r5-proof', (event) => {
        void window.__asaR5Record(event.detail);
      });
      window.addEventListener('asa-ramp-control', (event) => {
        void window.__asaRampControl(event.detail);
      });
    });
    await page.goto(bundle.url + 'index.html', { waitUntil: 'load', timeout: 30000 });
    await standPhase(page, 'idle');
    requireThat(
      attempts === 0 && recorders.every((r) => r.result().worlds.length === 0),
      'PASSIVE_ENTRY_ZERO_NATIVE',
    );
    // Palette and one real preview precede any native permit. The edited input is frozen.
    await page.getByTestId('ramp-item').click();
    await page.keyboard.press('Escape');
    for (const [scenario, p] of [
      ['baseline', configuration.baseline],
      ['edited', configuration.edited],
    ]) {
      const index = scenario === 'baseline' ? 0 : 1,
        recorder = pair(index);
      for (const runCase of ['powered', 'control']) {
        const issue = acquisitionIssue(
          faults,
          recorders.map((r) => r.result()),
        );
        requireThat(!issue, 'BEFORE_NEXT_WORLD_RUNTIME_HEALTH ' + issue);
        await exerciseWorld(
          page,
          runCase,
          p,
          attempts + 1,
          recorder,
          join(bundle.stage, scenario + '-powered-3d.png'),
        );
      }
      const details = recorder.result();
      const physical = assertPair(details, data);
      const files = pairPaths[index];
      for (const fd of opened.slice(index * 2, index * 2 + 2)) fsyncSync(fd);
      recorder.line({
        kind: 'pair-complete',
        runtime: 'COMPLETE',
        physical: physical ? 'PASS' : 'FAIL',
        causal: 'GAP_CAUSAL_ALT',
        ...details,
      });
      fsyncSync(opened[index * 2]);
      const replay = currentPairReplay(bundle, files, p);
      recorder.line({ kind: 'shared-offline-replay', replay });
      if (index === 0)
        requireThat(
          sha(readFileSync(files.binary)) === configuration.history.binary.sha256,
          'BASELINE_ACTUAL_RAW_TRANSFER_PARITY',
        );
    }
    qualification = {
      runtime: 'COMPLETE',
      physical: recorders.slice(0, 2).map((r) => r.result().worlds.map((w) => w.finish?.physical)),
      causal: 'GAP_CAUSAL_ALT',
    };
    requireThat(faults.length === 0, 'BROWSER_FAULTS');
    if (operator) {
      controller.openOperator();
      console.log(
        JSON.stringify({
          status: 'OPERATOR_WINDOW_OPEN',
          url: bundle.url + 'index.html',
          remaining: 8 - attempts,
          maxWallSeconds: 600,
          qualification,
        }),
      );
      operatorOutcome = 'OPEN';
      const until = Date.now() + 600000;
      while (Date.now() < until && !page.isClosed()) {
        const issue = acquisitionIssue(
          faults,
          recorders.map((r) => r.result()),
        );
        if (issue) throw new Error(issue);
        await new Promise((resolve) => globalThis.setTimeout(resolve, 250));
      }
      operatorOutcome = page.isClosed() ? 'CANCELLED_BY_OWNER' : 'WINDOW_ENDED';
    }
  } catch (error) {
    firstError ??= errorText(error);
    if (operatorOutcome === 'OPEN') operatorOutcome = 'ERROR';
  } finally {
    closeController();
    if (page && !page.isClosed())
      try {
        await page.evaluate(() =>
          window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })),
        );
        await standPhase(page, 'disposed', 10000);
      } catch (error) {
        firstError ??= errorText(error);
      }
    if (browser)
      try {
        await browser.close();
      } catch (error) {
        firstError ??= errorText(error);
      }
    const all = recorders.map((r) => r?.result());
    const issue = acquisitionIssue(faults, all);
    if (issue) firstError ??= issue;
    if (firstError && operatorOutcome !== 'NOT_REQUESTED' && operatorOutcome !== 'NOT_OPENED')
      operatorOutcome = 'ERROR';
    let total = 0,
      known = true;
    for (const details of all) {
      const gens = details.worlds.map((w) => w.generation);
      const count = nativeStep2Count(gens, details, 22000);
      if (count === null) known = false;
      else total += count;
    }
    if (
      admissionLedger.some(
        (v) => !all.some((d) => d.worlds.some((w) => w.generation === v.generation)),
      )
    )
      known = false;
    if (!known) firstError ??= 'UNRESOLVED_NATIVE_DISPATCH_OR_CLEANUP';
    for (const details of all)
      for (const world of details.worlds)
        if (!world.cleanup) firstError ??= 'MISSING_NATIVE_CLEANUP_RECEIPT';
    if (firstError && operatorOutcome !== 'NOT_REQUESTED' && operatorOutcome !== 'NOT_OPENED')
      operatorOutcome = 'ERROR';
    const result = {
      schema: 'ASA_EDITABLE_RAMP_QUALIFICATION_V1',
      head: bundle.manifest.head,
      runtime: firstError ? 'ERROR' : 'COMPLETE',
      firstError: firstError ?? null,
      qualification,
      operatorOutcome,
      attempts,
      admissionLedger,
      playAttempts: played,
      nativeStep2: known ? total : null,
      acquisition: known ? (total > 0 ? 'CONSUMED' : 'PRE_DISPATCH') : 'UNKNOWN',
      faults,
      pairs: pairPaths,
      details: all,
    };
    try {
      writeFileSync(
        join(bundle.stage, 'qualification-summary.json'),
        stringifyRecord(result) + '\n',
        { flag: 'wx' },
      );
      console.log(JSON.stringify(result));
    } finally {
      for (const fd of opened) {
        try {
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
      }
    }
    if (firstError || !qualification || qualification.physical.flat().some((v) => v !== 'PASS'))
      process.exitCode = 1;
  }
}
function currentPairReplay(bundle, files, parameters) {
  const executable = join(
    dirname(createRequire(join(repo, 'package.json')).resolve('vitest/package.json')),
    'vitest.mjs',
  );
  const output = execFileSync(
    process.execPath,
    [
      executable,
      'run',
      join(here, 'scene.spec.ts'),
      '--maxWorkers=1',
      '-t',
      'replays current paired receipt',
    ],
    {
      cwd: repo,
      env: {
        ...process.env,
        ASA_RAMP_PAIR_META: files.metadata,
        ASA_RAMP_PAIR_BIN: files.binary,
        ASA_RAMP_PAIR_SOURCE: bundle.manifest.head,
        ASA_RAMP_PAIR_PARAMETERS: JSON.stringify(parameters),
        ASA_RAMP_PAIR_META_SHA: sha(readFileSync(files.metadata)),
        ASA_RAMP_PAIR_BIN_SHA: sha(readFileSync(files.binary)),
      },
      encoding: 'utf8',
      maxBuffer: 4194304,
      windowsHide: true,
    },
  );
  const match = /ASA_RAMP_CURRENT_REPLAY (\{[^\n]+\})/.exec(output);
  requireThat(match, 'CURRENT_PAIRED_OFFLINE_REPLAY');
  return JSON.parse(match[1]);
}

function checkReceiptGuards() {
  const world = { generation: 1, intervals: 0 };
  const bare = { worlds: [world], observerError: null };
  const withCleanup = (step2) => ({ ...bare, worlds: [{ ...world, cleanup: { step2 } }] });
  assert.equal(nativeStep2Count([], bare, 10), 0);
  assert.equal(nativeStep2Count([1], bare, 10), null);
  assert.equal(nativeStep2Count([1], withCleanup(0), 10), 0);
  assert.equal(nativeStep2Count([1, 2], withCleanup(3), 10), null);
  assert.equal(
    nativeStep2Count([1], { ...withCleanup(3), observerError: 'bad receipt' }, 10),
    null,
  );
  assert.equal(nativeStep2Count([1], withCleanup(3), 10), 3);
  assert.throws(() => assertDisplayedPoses(null), /VISIBLE_POSES_PRESENT/);
  assert.throws(() => assertDisplayedPoses('[]'), /VISIBLE_FIVE_NATIVE_POSES/);
}

const [, , command, ...args] = process.argv;
requireThat(
  !Object.keys(process.env).some(
    (k) => /^(ASA_R5|ASA_TT_|ASA_PHY|ASA_EPA).*NATIVE/.test(k) && process.env[k],
  ),
  'OLD_NATIVE_ADMISSIONS_FORBIDDEN',
);
try {
  requireThat(
    !process.env.ASA_EDITABLE_RAMP_NATIVE ||
      ['--qualify-4630', '--qualify-operator-4630'].includes(command),
    'CONTROLLER_TOKEN_ONLY_IN_QUALIFY',
  );
  if (command === '--self-test' && args.length === 0) {
    checkReceiptGuards();
    assert.equal(
      acquisitionIssue([], [{ worlds: [{ finish: { runtime: 'COMPLETE', physical: 'FAIL' } }] }]),
      null,
    );
    assert.equal(
      acquisitionIssue(
        [],
        [
          {
            worlds: [
              {
                startupError: { error: 'construction-first' },
                cleanup: { owned: 2, freed: 1, cleanupFailures: ['destructor-second'] },
              },
            ],
          },
        ],
      ),
      'construction-first',
    );
    assert.equal(acquisitionIssue(['network'], []), 'network');
    assert.equal(
      acquisitionIssue([], [{ worlds: [{ startupError: { error: 'async-prepare' } }] }]),
      'async-prepare',
    );
    assert.equal(acquisitionIssue([], [{ observerError: 'raw-write', worlds: [] }]), 'raw-write');
    assert.equal(
      acquisitionIssue([], [{ worlds: [{ finish: { runtime: 'ERROR', error: 'solver' } }] }]),
      'solver',
    );
    assert.equal(
      acquisitionIssue(
        [],
        [{ worlds: [{ cleanup: { owned: 2, freed: 1, cleanupFailures: ['delete'] } }] }],
      ),
      'delete',
    );
    const value = { n: -0 };
    requireThat(Object.is(parseRecord(stringifyRecord(value)).n, -0), 'SIGNED_ZERO_SELF_TEST');
    assert.throws(() => parseRecord('{"x":{"$asaF64":"nan"}}'), /INVALID_SIGNED_ZERO_LABEL/);
    const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }),
      persisted = [];
    const controller = createAdmissionController(keys.privateKey, (p) => persisted.push(p));
    const nonce = '01'.repeat(32),
      payload = { nonce, runCase: 'powered', parameters: configuration.baseline };
    const permit = controller.reserve(payload);
    assert.throws(
      () => controller.reserve({ ...payload, nonce: '02'.repeat(32), runCase: 'control' }),
      /ONE_WORKER_MODULE_NO_RELOAD_RESTART/,
    );
    assert.throws(() => controller.reserve(payload), /FROZEN_FOUR_WORLD_ORDER/);
    requireThat(controller.count() === 1, 'REJECTED_ADMISSION_NO_MODEL_BUDGET');
    controller.reserve({ ...payload, runCase: 'control' });
    controller.reserve({ ...payload, parameters: configuration.edited });
    controller.reserve({ ...payload, runCase: 'control', parameters: configuration.edited });
    assert.throws(() => controller.reserve(payload), /CONTROLLER_WINDOW_AND_CAP/);
    controller.openOperator();
    for (let i = 0; i < 4; i++) controller.reserve(payload);
    assert.throws(() => controller.reserve(payload), /CONTROLLER_WINDOW_AND_CAP/);
    requireThat(persisted.length === 8 && controller.count() === 8, 'GLOBAL_EIGHT_ATTEMPT_LEDGER');
    console.log(
      'PURE_RUNNER_GUARDS_PASS ' +
        JSON.stringify({
          publicJwk: keys.publicKey.export({ format: 'jwk' }),
          permit,
          nativeInitializations: 0,
          attempts: controller.count(),
        }),
    );
  } else if (command === '--inspect' && args.length === 0) {
    const sources = exactSources(git('rev-parse', 'HEAD').toString().trim());
    const { fixture, data } = browserInputFiles();
    chromiumPackage();
    checkReceiptGuards();
    const prior = historyAdmission(git('rev-parse', 'HEAD').toString().trim());
    console.log(
      JSON.stringify({
        status: 'PINNED_INPUTS_PASS',
        sources,
        scope: 'TEST_ONLY',
        source: R5.source,
        fixture: sha(fixture),
        pairs: data.expected.pairs.length,
        nativeAdvances: 0,
        prior,
      }),
    );
  } else if (command === '--build' && args.length === 1) {
    await build(args[0]);
  } else if (
    (command === '--check-http' ||
      command === '--qualify-4630' ||
      command === '--qualify-operator-4630') &&
    args.length === 3
  ) {
    const bundle = openBundle(...args);
    if (command === '--check-http') {
      console.log(
        JSON.stringify({
          status: 'EXACT_4630_BYTES_PASS',
          url: bundle.url,
          responses: await httpCheck(bundle),
          nativeAdvances: 0,
        }),
      );
    } else {
      const { data } = browserInputFiles();
      const { chromium, exe } = chromiumPackage();
      await qualify(bundle, chromium, exe, data, command === '--qualify-operator-4630');
    }
  } else {
    requireThat(
      false,
      'USAGE: --self-test | --inspect | --build <HEAD> | --check-http <manifest> <SHA256> <HEAD> | --qualify-4630 <manifest> <SHA256> <HEAD>',
    );
  }
} catch (error) {
  console.error(errorText(error));
  process.exitCode = 1;
}
