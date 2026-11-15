#!/usr/bin/env node
// TEST_ONLY R5. Inspection and packaging never launch Chromium or dispatch physics.
/* global window */
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import console from 'node:console';
import { createHash } from 'node:crypto';
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
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../../../../..');
const planned = [
  'apps/web/src/robotics/testing/r5-live/index.html',
  'apps/web/src/robotics/testing/r5-live/r5.worker.ts',
  'apps/web/src/robotics/testing/r5-live/stand.browser.mjs',
  'apps/web/src/robotics/testing/r5-live/stand.ts',
];
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
const outPrefix = 'asa-r5-live-browser-';
const host = 'http://127.0.0.1:4630';
const metadataMax = 1_048_576;
const combinedRawMax = 268_435_456;
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
  git('merge-base', '--is-ancestor', R5.registration, head);
  const added = git('diff', '--name-only', R5.registration, head)
    .toString()
    .trim()
    .split('\n')
    .sort();
  assert.deepEqual(added, planned, 'EXACT_FOUR_REGISTERED_SOURCE_PATHS');
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
      files.filter(({ path }) => /^assets\/r5-worker-[\w-]+\.js$/.test(path)).length === 1,
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
  const free = statfsSync(temp());
  requireThat(free.bavail * free.bsize > 350_000_000, 'LOCAL_STAND_BUILD_CAPACITY');
  const output = mkdtempSync(join(temp(), outPrefix));
  const root = join(output, 'bundle');
  const { build: vite } = await import('vite');
  await vite({
    configFile: false,
    envFile: false,
    root: here,
    base: './',
    publicDir: false,
    define: { __R5_BUILD_COMMIT__: JSON.stringify(head) },
    worker: {
      format: 'es',
      rollupOptions: { output: { entryFileNames: 'assets/r5-worker-[hash].js' } },
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
    schema: 'ASA_R5_STAND_BUNDLE_V1',
    scope: 'TEST_ONLY',
    head,
    sources,
    aotReceipt: { build: aot.build, browser: aot.browser },
    r5: R5,
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
    manifest.schema === 'ASA_R5_STAND_BUNDLE_V1' &&
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
  requireThat(free.bavail * free.bsize > 360_000_000, 'LOCAL_RECEIPT_CAPACITY');
}
function errorText(error) {
  return (error instanceof Error ? error.name + ': ' + error.message : String(error)).slice(
    0,
    1800,
  );
}

// The only active input is the stand UI. This observer has no module route or simulation command.
function proofRecorder(meta, raw, fixture) {
  const worlds = new Map();
  let metadataBytes = 0;
  let rawBytes = 0;
  let firstError;
  const line = (record) => {
    const bytes = Buffer.from(JSON.stringify(record) + '\n');
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

async function exercise(page, recorder, bundle, playedGenerations, retainScreenshot) {
  async function play(generation) {
    // A click can reach the UI before the automation reports a transport failure.
    // Without a native terminal counter this attempt must remain unknown.
    recorder.line({ kind: 'ui-play-attempt', generation });
    playedGenerations.push(generation);
    await page.getByTestId('r5-play').click();
  }
  await page.goto(bundle.url + 'index.html', { waitUntil: 'load', timeout: readyTimeout });
  await standTerminal(page, 'ready');
  const first = await observation(page);
  assertDisplayedPoses(first.poses);
  requireThat(
    first.generation > 0 && first.tickId === 0 && first.atMicroseconds === 0,
    'POWERED_FACTORY_T0',
  );
  await play(first.generation);
  await standPhase(page, 'running');
  await page.locator('#r5-app[data-r5-tick]:not([data-r5-tick="0"])').waitFor({ state: 'visible' });
  await page.getByTestId('r5-pause').click();
  await standPhase(page, 'paused');
  const paused = await observation(page);
  assertDisplayedPoses(paused.poses);
  requireThat(
    paused.generation === first.generation && paused.tickId > 0 && paused.atMicroseconds > 0,
    'PAUSED_REAL_COMMITTED_SAMPLE',
  );
  for (const [testId, mode] of [
    ['r5-view-top', 'top'],
    ['r5-view-spatial', 'spatial'],
  ]) {
    await page.getByTestId(testId).click();
    requireThat(
      (await page.getByTestId('r5-viewport').getAttribute('data-view')) === mode,
      'SHARED_CAMERA_ACTION',
    );
    assert.deepEqual(await observation(page), paused, 'CAMERA_CHANGED_SIMULATION_TICK');
  }
  // Observe ordinary time elapsing while the real Worker owns the pause.
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
  assert.deepEqual(await observation(page), paused, 'PAUSED_TIME_AND_POSES_FROZEN');
  recorder.line({
    kind: 'ui-pause-views',
    ...paused,
    views: ['top', 'spatial'],
    observedWallMs: 150,
  });
  await page.getByTestId('r5-pause').click();
  await standTerminal(page, 'complete');
  const powered = await observation(page);
  requireThat(
    powered.generation === first.generation && powered.atMicroseconds === 10_000_000,
    'POWERED_VISIBLE_TERMINAL',
  );
  requireThat(
    (await page.getByTestId('r5-viewport').getAttribute('data-view')) === 'spatial',
    'POWERED_TERMINAL_SPATIAL_VIEW',
  );
  await retainScreenshot();
  await page.getByTestId('r5-run-case').selectOption('control');
  await standTerminal(page, 'ready');
  const reset = await observation(page);
  assertDisplayedPoses(reset.poses);
  requireThat(
    reset.generation > powered.generation && reset.tickId === 0 && reset.atMicroseconds === 0,
    'CONTROL_FRESH_RESET_T0',
  );
  recorder.line({ kind: 'ui-reset', retired: powered, ready: reset });
  await play(reset.generation);
  await standTerminal(page, 'complete');
  const control = await observation(page);
  requireThat(
    control.generation === reset.generation && control.atMicroseconds === 10_000_000,
    'CONTROL_VISIBLE_TERMINAL',
  );
  recorder.line({ kind: 'ui-terminals', powered, control });
}

/* global PageTransitionEvent, setTimeout */
async function qualify(bundle, chromium, exe, data) {
  const http = await httpCheck(bundle);
  proveSpace(bundle.stage);
  const receipt = join(bundle.stage, 'qualification.jsonl');
  const tape = join(bundle.stage, 'qualification.bin');
  const screenshot = join(bundle.stage, 'powered-3d.png');
  const meta = openSync(receipt, 'wx');
  let raw;
  let browser;
  let page;
  let recorder;
  let execError;
  let physical = 'UNRESOLVED';
  let image = null;
  const faults = [];
  const playedGenerations = [];
  const urls = new Set(bundle.allowed.map(({ path }) => bundle.url + path));
  const boundedFault = (message) => {
    if (faults.length < 32) faults.push(message.slice(0, 500));
  };
  const requests = new Map();
  try {
    raw = openSync(tape, 'wx');
    recorder = proofRecorder(meta, raw, data);
    recorder.line({
      kind: 'start',
      scope: 'TEST_ONLY',
      head: bundle.manifest.head,
      url: bundle.url,
      http,
      acquisition: 'single-powered-and-LOW-real-4630',
      aot: bundle.manifest.aotReceipt,
    });
    browser = await chromium.launch({
      executablePath: exe,
      headless: true,
      args: ['--disable-background-networking'],
    });
    const context = await browser.newContext({ serviceWorkers: 'block', locale: 'ru-RU' });
    context.on('request', (request) => {
      const url = request.url();
      if (!urls.has(url) || request.method() !== 'GET') boundedFault('UNEXPECTED_REQUEST ' + url);
      else requests.set(url, 1 + (requests.get(url) ?? 0));
    });
    context.on('response', (response) => {
      if (!urls.has(response.url()) || response.status() !== 200) {
        boundedFault('UNEXPECTED_RESPONSE ' + response.status() + ' ' + response.url());
      }
    });
    context.on('requestfailed', (request) => boundedFault('REQUEST_FAILED ' + request.url()));
    page = await context.newPage();
    page.on('pageerror', (error) => boundedFault(errorText(error)));
    await page.exposeBinding('__asaR5Record', (source, event) => {
      if (
        source.page !== page ||
        source.frame !== page.mainFrame() ||
        source.frame.url() !== bundle.url + 'index.html'
      ) {
        boundedFault('UNTRUSTED_RAW_WITNESS_ORIGIN');
        return;
      }
      recorder.receive(event);
    });
    await page.addInitScript(() => {
      window.addEventListener('asa-r5-proof', (event) => {
        void window.__asaR5Record(event.detail);
      });
    });
    await exercise(page, recorder, bundle, playedGenerations, async () => {
      try {
        const bytes = await page.screenshot({ fullPage: true, timeout: 5000 });
        requireThat(bytes.length > 0 && bytes.length <= 6_000_000, 'POWERED_VIEW_IMAGE_WIDTH');
        writeFileSync(screenshot, bytes, { flag: 'wx' });
        image = { path: screenshot, sha256: sha(bytes), bytes: bytes.length };
      } catch (error) {
        recorder.line({ kind: 'powered-view-image-unavailable', error: errorText(error) });
      }
    });
  } catch (error) {
    execError = errorText(error);
  } finally {
    if (page && !page.isClosed()) {
      try {
        await page.evaluate(() =>
          window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })),
        );
        await standPhase(page, 'disposed', execError ? 1000 : 10000);
      } catch (error) {
        if (!execError) execError = errorText(error);
      }
    }
    if (browser) {
      try {
        await browser.close();
      } catch (error) {
        execError ??= errorText(error);
      }
    }
    try {
      requireThat(recorder, 'RAW_TAPE_CREATION_FAILURE');
      const details = recorder.result();
      const nativeStep2 = nativeStep2Count(
        playedGenerations,
        details,
        data.raw.maxIntervalsPerWorld,
      );
      if (!execError) {
        try {
          requireThat(
            faults.length === 0 &&
              ['engine/mujoco.js', 'engine/mujoco.wasm', 'engine/r5.fixture.json'].every((name) =>
                requests.has(bundle.url + name),
              ),
            'ACTUAL_CHROMIUM_REQUESTS',
          );
          physical = assertPair(details, data) ? 'PASS' : 'FAIL';
        } catch (error) {
          execError = errorText(error);
        }
      }
      recorder.line({
        kind: 'terminal',
        runtime: execError ? 'ERROR' : 'COMPLETE',
        physical,
        causal: 'GAP_CAUSAL_ALT',
        error: execError ?? null,
        faults,
        image,
        nativeStep2,
        playedGenerations,
        requests: Array.from(requests),
        ...details,
      });
      console.log(
        JSON.stringify({
          receipt,
          tape,
          physical,
          causal: 'GAP_CAUSAL_ALT',
          error: execError ?? null,
          rawBytes: details.rawBytes,
          nativeStep2,
          image,
          pairs: details.worlds.map(({ runCase, intervals }) => ({ runCase, intervals })),
        }),
      );
    } finally {
      for (const fd of [raw, meta]) {
        if (fd !== undefined) {
          try {
            fsyncSync(fd);
          } finally {
            closeSync(fd);
          }
        }
      }
    }
  }
  if (physical !== 'PASS') process.exitCode = 1;
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
try {
  if (command === '--inspect' && args.length === 0) {
    const { fixture, data } = browserInputFiles();
    chromiumPackage();
    checkReceiptGuards();
    console.log(
      JSON.stringify({
        status: 'PINNED_INPUTS_PASS',
        scope: 'TEST_ONLY',
        source: R5.source,
        fixture: sha(fixture),
        pairs: data.expected.pairs.length,
        nativeAdvances: 0,
      }),
    );
  } else if (command === '--build' && args.length === 1) {
    await build(args[0]);
  } else if ((command === '--check-http' || command === '--qualify-4630') && args.length === 3) {
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
      await qualify(bundle, chromium, exe, data);
    }
  } else {
    requireThat(
      false,
      'USAGE: --inspect | --build <HEAD> | --check-http <manifest> <SHA256> <HEAD> | --qualify-4630 <manifest> <SHA256> <HEAD>',
    );
  }
} catch (error) {
  console.error(errorText(error));
  process.exitCode = 1;
}
