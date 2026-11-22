#!/usr/bin/env node
// TEST_ONLY. No build or browser action is implied by importing or inspecting this tool.
/* global window, document, self, performance, crypto, fetch, URL, Worker, WebAssembly, TextDecoder, TextEncoder, setTimeout, clearTimeout */
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  cpSync,
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
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';

const sourcePath = fileURLToPath(import.meta.url);
const fixturePath = sourcePath.replace(/\.mjs$/, '.fixture.json');
const repo = resolve(dirname(sourcePath), '../..');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
const sha = (value) => createHash('sha256').update(value).digest('hex');
const slash = (value) => value.replaceAll('\\', '/');
const TEMP_PREFIX = 'asa-mujoco-aot-worker-';
const LINK_RECEIPT = 'build-receipt.json';
const ARTIFACTS = ['mujoco.js', 'mujoco.wasm', 'mujoco.d.ts', 'mujoco.wasm.map'];
const MAX_INPUT = 512 * 1024 * 1024;
const MAX_RECEIPT = 4 * 1024 * 1024;

function demand(condition, code) {
  if (!condition) throw new Error(code);
}

function inside(root, path) {
  const child = relative(root, path);
  return child !== '' && child !== '..' && !child.startsWith('..' + sep) && !isAbsolute(child);
}

function digestArg(value) {
  demand(typeof value === 'string' && /^[\da-f]{64}$/i.test(value), 'EXPECTED_SHA256');
  return value.toLowerCase();
}

function sourcePins(expectedSource, expectedFixture) {
  const source = sha(readFileSync(sourcePath));
  const plan = sha(readFileSync(fixturePath));
  if (expectedSource !== undefined || expectedFixture !== undefined) {
    demand(
      source === digestArg(expectedSource) && plan === digestArg(expectedFixture),
      'REVIEWED_SOURCE_AND_FIXTURE',
    );
  }
  return { source, fixture: plan, registration: fixture.registration };
}

function localPath(path) {
  demand(
    process.platform === 'win32' &&
      process.env.LOCALAPPDATA &&
      isAbsolute(process.env.LOCALAPPDATA),
    'PINNED_WINDOWS_HOST',
  );
  const local = realpathSync(process.env.LOCALAPPDATA);
  const absolute = resolve(local, path);
  demand(
    inside(local, absolute) || inside(resolve(local, '../..', 'Projects'), absolute),
    'UNREGISTERED_INPUT_ROOT',
  );
  return absolute;
}

function fileBytes(path, expected = undefined, maxBytes = MAX_INPUT, minBytes = 1) {
  const stat = lstatSync(path);
  demand(
    stat.isFile() && !stat.isSymbolicLink() && stat.size >= minBytes && stat.size <= maxBytes,
    'BOUNDED_REGULAR_FILE ' + basename(path),
  );
  if (expected?.bytes !== undefined)
    demand(stat.size === expected.bytes, 'INPUT_BYTE_LENGTH ' + basename(path));
  const bytes = readFileSync(path);
  demand(bytes.length === stat.size, 'INPUT_READ_LENGTH ' + basename(path));
  if (expected) demand(sha(bytes) === expected.sha256, 'INPUT_SHA256 ' + basename(path));
  return bytes;
}

function input(entry) {
  return fileBytes(localPath(entry.path), entry);
}

function asJson(bytes) {
  return JSON.parse(bytes.toString('utf8'));
}

function skipCache(name) {
  // All Python invocations use an isolated, empty bytecode cache prefix and -B.
  return name === '__pycache__' || name.endsWith('.pyc');
}

function treeDigest(root, pin) {
  const canonical = realpathSync(root);
  demand(resolve(root) === canonical, 'CANONICAL_TREE_ROOT ' + basename(root));
  const entries = [];
  let bytes = 0;
  function visit(dir) {
    const children = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name === b.name ? 0 : a.name < b.name ? -1 : 1,
    );
    for (const child of children) {
      if (skipCache(child.name)) continue;
      const path = join(dir, child.name);
      demand(inside(canonical, path) && !child.isSymbolicLink(), 'EXACT_TREE_MEMBER');
      if (child.isDirectory()) {
        visit(path);
      } else {
        demand(child.isFile() && entries.length < pin.files, 'EXACT_TREE_CARDINALITY');
        const content = fileBytes(path, undefined, MAX_INPUT, 0);
        bytes += content.length;
        demand(bytes <= pin.bytes, 'EXACT_TREE_BYTES');
        entries.push([slash(relative(canonical, path)), content.length, sha(content)]);
      }
    }
  }
  visit(canonical);
  const result = { files: entries.length, bytes, sha256: sha(JSON.stringify(entries)) };
  demand(
    result.files === pin.files && result.bytes === pin.bytes && result.sha256 === pin.sha256,
    'INPUT_TREE_SHA256 ' + basename(root),
  );
  return result;
}

function archiveLinkPlan(staged, output, aot) {
  const plan = fixture.link;
  // The normalized Ninja recipe retains argv order, including repeated -lm.
  // Resolve path-only substitutions before appending the two registered settings.
  const inputs = new Set(plan.inputs.map(({ path }) => path.slice(plan.buildRoot.length + 1)));
  const argv = plan.normalizedArgv.map((word) => {
    if (inputs.has(word)) return join(staged, word);
    if (word === '-Llib') return '-L' + join(staged, 'lib');
    if (word === 'mujoco.js' || word === 'mujoco.d.ts') return join(output, word);
    return word;
  });
  return aot ? [...argv, ...plan.aotFlags] : argv;
}

function inspectBuild() {
  const plan = fixture.link;
  const original = asJson(input(plan.originalArtifact[0]));
  demand(
    original.upstream.commit === fixture.upstream &&
      original.patch.sha256 === plan.patchSha256 &&
      original.compiler.emcc === plan.toolchainVersion &&
      original.flags.wasmThreads === false &&
      original.flags.buildType === 'Release' &&
      original.admissions.dynamicCalls === 0,
    'ADMITTED_BUILD_RECEIPT',
  );
  demand(
    sha(fileBytes(join(repo, 'tools/robotics-field-core/mujoco-finite-cap-v1.patch'))) ===
      plan.patchSha256,
    'CANONICAL_COLLISION_PATCH',
  );
  const [ninja, rules] = plan.recipe
    .map(input)
    .map((bytes) => bytes.toString('utf8').replaceAll('\r', ''));
  demand(
    ninja.includes('CXX_EXECUTABLE_LINKER__mujoco_wasm_Release') &&
      rules.includes('$FLAGS $LINK_FLAGS $in -o $TARGET_FILE $LINK_PATH $LINK_LIBRARIES') &&
      !fixture.link.normalizedArgv.some((word) => /DYNAMIC_EXECUTION|EMBIND_AOT/.test(word)),
    'ORIGINAL_NINJA_LINK_RULE',
  );
  const recipe = ninja.match(
    /^build .*\/mujoco\.js: CXX_EXECUTABLE_LINKER__mujoco_wasm_Release ([^|\n]+).*\n((?: {2}.*\n)+)/m,
  );
  demand(recipe, 'EXACT_NINJA_TARGET');
  const words = (key) =>
    recipe[2]
      .match(new RegExp('^  ' + key + ' = (.+)$', 'm'))[1]
      .trim()
      .split(/\s+/);
  demand(
    words('LINK_PATH').length === 1 &&
      words('LINK_PATH')[0] === '-L' + slash(join(localPath(plan.buildRoot), 'lib')),
    'EXACT_NINJA_LIB_PATH',
  );
  assert.deepEqual(
    [
      ...words('FLAGS'),
      ...words('LINK_FLAGS'),
      ...recipe[1].trim().split(/\s+/),
      '-o',
      'mujoco.js',
      '-Llib',
      ...words('LINK_LIBRARIES'),
    ],
    plan.normalizedArgv,
    'EXACT_NORMALIZED_NINJA_ARGV',
  );
  const archive = input(plan.inputs.find(({ path }) => path.endsWith('/libmujoco.a')));
  const object = input(plan.collisionObject);
  const embedded = archive.indexOf(object);
  demand(
    archive.subarray(0, 8).toString() === '!<arch>\n' &&
      embedded >= 68 &&
      embedded === archive.lastIndexOf(object),
    'PATCHED_OBJECT_ARCHIVE_MEMBERSHIP',
  );
  input(plan.python);
  input(plan.node);
  for (const pin of [
    ...plan.originalArtifact.slice(1),
    ...plan.acquisition,
    ...plan.inputs,
    plan.collisionObject,
  ])
    input(pin);
  for (const pin of plan.licenses) {
    const originalPin = original.licenses[pin.name];
    demand(
      originalPin?.bytes === pin.bytes && originalPin.sha256 === pin.sha256,
      'ADMITTED_LICENSE_PROVENANCE',
    );
    input(pin);
  }
  const trees = plan.manifest.map((pin) => ({
    path: pin.path,
    ...treeDigest(localPath(pin.path), pin),
  }));
  return {
    sourceBuild: original.upstream,
    compiler: original.compiler,
    dependencies: original.dependencies,
    licenses: plan.licenses,
    artifactManifest: plan.originalArtifact,
    recipe: plan.recipe,
    inputs: [...plan.inputs, plan.collisionObject],
    trees,
    originalNormalizedArgv: plan.normalizedArgv,
    candidateNormalizedArgv: [...plan.normalizedArgv, ...plan.aotFlags],
  };
}

function ownTemp() {
  const root = realpathSync(tmpdir());
  demand(
    root === realpathSync(localPath('Temp')) && /^[\x20-\x7e]+$/.test(root) && !inside(repo, root),
    'EXTERNAL_ASCII_OS_TEMP',
  );
  return root;
}

function reserveReceipt(path) {
  return openSync(path, 'wx');
}

function saveReceipt(descriptor, receipt) {
  try {
    const bytes = Buffer.from(JSON.stringify(receipt, null, 2) + '\n');
    demand(bytes.length <= MAX_RECEIPT, 'RECEIPT_SIZE');
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    return sha(bytes);
  } finally {
    closeSync(descriptor);
  }
}

function summarize(error) {
  return { name: error?.name ?? 'Error', message: String(error?.message ?? error).slice(0, 2000) };
}

function stageLinkInput(pin, staged) {
  const name = pin.path.slice(fixture.link.buildRoot.length + 1);
  const target = join(staged, name);
  demand(inside(staged, target), 'LINK_INPUT_TARGET');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, input(pin), { flag: 'wx' });
}

function linkOnly(pins) {
  const build = inspectBuild();
  const temp = ownTemp();
  const capacity = statfsSync(temp);
  demand(capacity.bavail * capacity.bsize > 2_000_000_000, 'LOCAL_TEMP_LINK_CAPACITY');
  const root = mkdtempSync(join(temp, TEMP_PREFIX));
  const receiptPath = join(root, LINK_RECEIPT);
  const descriptor = reserveReceipt(receiptPath);
  const receipt = { mode: 'isolated-link', pins, build, accepted: false, error: null };
  try {
    const plan = fixture.link;
    const staged = join(root, 'input');
    const work = join(root, 'scratch');
    const output = join(root, 'artifact');
    const cache = join(root, 'cache');
    const pycache = join(work, 'pycache');
    const configPath = join(root, 'emscripten.config');
    for (const dir of [work, output]) mkdirSync(dir);
    for (const pin of plan.inputs) stageLinkInput(pin, staged);
    const seedCache = plan.manifest[1];
    cpSync(localPath(seedCache.path), cache, { recursive: true, errorOnExist: true, force: false });
    treeDigest(cache, seedCache);
    const sdk = localPath(plan.sdkRoot);
    const node = localPath(plan.node.path);
    const python = localPath(plan.python.path);
    const toPython = (path) => JSON.stringify(slash(path));
    const config = [
      'LLVM_ROOT = ' + toPython(join(sdk, 'bin')),
      'BINARYEN_ROOT = ' + toPython(sdk),
      'NODE_JS = [' + toPython(node) + ']',
      'CACHE = ' + toPython(cache),
      'PORTS = ' + toPython(join(cache, 'ports')),
      'FROZEN_CACHE = True',
      '',
    ].join('\n');
    writeFileSync(configPath, config, { flag: 'wx' });
    const windows = process.env.SystemRoot;
    demand(windows && isAbsolute(windows), 'WINDOWS_SYSTEM_ROOT');
    const compiler = localPath(plan.compiler);
    // Equivalent to the archived em++.bat driver. No shell or configure/Ninja invocation.
    const actual = [
      '-E',
      '-B',
      '-X',
      'pycache_prefix=' + pycache,
      compiler,
      ...archiveLinkPlan(staged, output, true),
    ];
    receipt.command = { executable: python, argv: actual, cwd: work, configSha256: sha(config) };
    const linked = spawnSync(python, actual, {
      cwd: work,
      encoding: 'utf8',
      timeout: plan.timeoutMs,
      windowsHide: true,
      maxBuffer: 1_048_576,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        SystemRoot: windows,
        WINDIR: windows,
        COMSPEC: join(windows, 'System32', 'cmd.exe'),
        PATH: [dirname(python), dirname(node), join(sdk, 'bin'), join(windows, 'System32')].join(
          sep === '\\' ? ';' : ':',
        ),
        TEMP: work,
        TMP: work,
        TMPDIR: work,
        EMCC_TEMP_DIR: work,
        EM_CONFIG: configPath,
        NODE_DISABLE_COMPILE_CACHE: '1',
        USERPROFILE: work,
        LOCALAPPDATA: work,
        APPDATA: work,
      },
    });
    receipt.child = {
      status: linked.status,
      signal: linked.signal,
      error: linked.error && summarize(linked.error),
      stdout: linked.stdout?.slice(0, 16000),
      stderr: linked.stderr?.slice(0, 16000),
    };
    demand(!linked.error && linked.status === 0, 'EMSCRIPTEN_LINK_FAILED');
    receipt.artifacts = ARTIFACTS.map((name) => {
      const bytes = fileBytes(join(output, name));
      return { name, bytes: bytes.length, sha256: sha(bytes) };
    });
    demand(
      receipt.artifacts[0].sha256 !== plan.originalArtifact[1].sha256,
      'RELINKED_AOT_GLUE_BYTES',
    );
    // Re-read the entire pinned source build inputs/cache/toolchain after the child.
    assert.deepEqual(inspectBuild(), build, 'ARCHIVED_BUILD_INPUTS_IMMUTABLE');
    receipt.accepted = true;
  } catch (error) {
    receipt.error = summarize(error);
  }
  const receiptSha256 = saveReceipt(descriptor, receipt);
  console.log(
    JSON.stringify({
      mode: receipt.mode,
      receiptPath,
      receiptSha256,
      accepted: receipt.accepted,
      artifacts: receipt.artifacts,
      error: receipt.error,
      child: receipt.accepted ? undefined : receipt.child,
    }),
  );
  return receipt.accepted;
}

function numberWord(value) {
  const number = value === '-0' ? -0 : value;
  demand(Number.isFinite(number), 'ARCHIVED_FINITE_F64');
  return number;
}

function f64le(values) {
  const bytes = Buffer.alloc(values.length * 8);
  values.forEach((value, i) => bytes.writeDoubleLE(numberWord(value), i * 8));
  return bytes;
}

function loadMotion() {
  const p = fixture.motion;
  input(p.source);
  const f = asJson(input(p.fixture));
  const raw = asJson(input(p.raw));
  demand(
    raw.sourceSha256 === p.source.sha256 &&
      raw.fixtureSha256 === p.fixture.sha256 &&
      raw.modelSha256 === p.xmlSha256 &&
      sha(raw.modelXml) === p.xmlSha256 &&
      raw.verdict.commonPass &&
      raw.error === null &&
      raw.returned === p.intervals &&
      raw.step1 === p.intervals &&
      raw.step2 === p.intervals &&
      f.limits.steps === p.intervals &&
      f.time.stepUs === p.stepUs &&
      f.time.horizonUs === p.horizonUs &&
      !raw.modelXml.includes('asa1168_finite_cap_can') &&
      !raw.modelXml.includes('asa1168_finite_top'),
    'ARCHIVED_SHARED_MOTION_TRACE',
  );
  const samples = raw.records.filter(
    ({ type, endUs }) => type === 'sample' && endUs % p.samplePeriodUs === 0,
  );
  demand(
    samples.length === p.samples &&
      samples.every(({ endUs }, index) => endUs === (index + 1) * p.samplePeriodUs),
    'COMPLETE_ARCHIVED_SAMPLE_ORDINALS',
  );
  const end = samples.at(-1).post;
  demand(end.qpos.length === 19 && end.qvel.length === 17, 'ARCHIVED_FINAL_SHAPE');
  const terminal = f64le([...end.qpos, ...end.qvel, end.time]);
  demand(
    terminal.length === p.terminalWords * 8 && sha(terminal) === p.finalSha256,
    'ARCHIVED_FINAL_BITS',
  );
  demand(
    samples.every(({ post }) => post.qpos.length === 19 && post.qvel.length === 17),
    'ARCHIVED_SAMPLE_NATIVE_SHAPE',
  );
  const sampleBytes = f64le(samples.flatMap(({ post }) => [...post.qpos, ...post.qvel, post.time]));
  const pulseStartUs = f.can.launchStartUs;
  const pulseEndUs = pulseStartUs + 5000;
  const pulse = raw.records.filter(
    ({ type, startUs }) => type === 'sample' && startUs >= pulseStartUs && startUs < pulseEndUs,
  );
  const barrier = 0.5 * 9.81 * (Math.hypot(0.033, 0.0575) - 0.0575);
  const expectedForce = (0.25 * Math.sqrt((2 * (16 * barrier)) / 0.25)) / 0.005;
  demand(
    pulse.length === 10 &&
      pulse.every(({ drive }) => Object.is(drive, expectedForce)) &&
      f.rolling.motorSettleUs === 2000000 &&
      f.rolling.torqueCapNm === 0.035 &&
      f.rolling.noLoadJointRadPS === 25 &&
      pulseStartUs === 5000000,
    'ARCHIVED_SHARED_DRIVE',
  );
  return {
    spec: {
      intervals: p.intervals,
      stepUs: p.stepUs,
      horizonUs: p.horizonUs,
      samplePeriodUs: p.samplePeriodUs,
    },
    xml: raw.modelXml,
    xmlSha256: p.xmlSha256,
    options: raw.records.find(({ type }) => type === 'model').actualOptions,
    drive: {
      motorSettleUs: f.rolling.motorSettleUs,
      torqueCapNm: f.rolling.torqueCapNm,
      noLoadRadPS: f.rolling.noLoadJointRadPS,
      force: expectedForce,
      pulseStartUs,
      pulseEndUs,
    },
    samplesHex: sampleBytes.toString('hex'),
    terminalHex: terminal.toString('hex'),
  };
}

function extractPositionXml(f) {
  const p = fixture.position;
  const rolling = input(p.rolling);
  const record = p.rollingInitialization;
  const start = record.offset + 4;
  const frame = rolling.subarray(start, start + record.bytes);
  demand(
    rolling.readUInt32LE(record.offset) === record.bytes &&
      sha(frame) === record.sha256 &&
      frame.subarray(record.xmlOffset - 8, record.xmlOffset - 5).toString('utf8') === 'xml' &&
      frame[record.xmlOffset - 5] === 4 &&
      frame.readUInt32LE(record.xmlOffset - 4) === record.xmlBytes,
    'ARCHIVED_POSITION_RAMP_FRAME',
  );
  const xmlBytes = frame.subarray(record.xmlOffset, record.xmlOffset + record.xmlBytes);
  demand(sha(xmlBytes) === record.xmlSha256, 'ARCHIVED_POSITION_RAMP_XML');
  const xml = xmlBytes.toString('utf8');
  const { deck, can } = f;
  const seam = '</worldbody><contact>';
  demand(
    xml.split(seam).length === 2 && xml.split('</contact>').length === 2,
    'ARCHIVED_POSITION_XML_SEAM',
  );
  // The published positional oracle inserts this exact pair in the archived R3 model.
  const support =
    '<geom name="' +
    deck.supportName +
    '" type="box" size="' +
    deck.halfSize.join(' ') +
    '" pos="0 ' +
    deck.y +
    ' ' +
    -deck.halfSize[2] +
    '" contype="0" conaffinity="0"/>';
  const cylinder =
    '<body name="asa1168_can_body" pos="0 ' +
    deck.y +
    ' ' +
    can.halfHeight +
    '"><freejoint name="asa1168_can_free"/><inertial pos="0 0 0" mass="' +
    can.mass +
    '" diaginertia="' +
    can.inertia.join(' ') +
    '"/><geom name="' +
    deck.canName +
    '" type="cylinder" size="' +
    can.radius +
    ' ' +
    can.halfHeight +
    '" contype="0" conaffinity="0"/></body>';
  const pair =
    '<pair geom1="' +
    deck.supportName +
    '" geom2="' +
    deck.canName +
    '" condim="3" margin="0" gap="0" friction="' +
    deck.friction +
    ' ' +
    deck.friction +
    ' 0 0 0" solref="0.004 1" solreffriction="0 0" solimp="0.99 0.99 0.001 0.5 2"/>';
  const result = xml
    .replace(seam, support + cylinder + seam)
    .replace('</contact>', pair + '</contact>');
  demand(
    sha(result) === p.xmlSha256 && f.engine.candidate.xmlSha256 === p.xmlSha256,
    'ADMITTED_POSITION_XML_SHA256',
  );
  return result;
}

function registeredContacts(contacts, pair) {
  return contacts.filter(
    ({ geom1, geom2 }) => pair.includes(geom1) && pair.includes(geom2) && geom1 !== geom2,
  );
}

function loadPosition() {
  const p = fixture.position;
  const f = asJson(
    fileBytes(
      join(
        repo,
        'tests/robotics/field-core-qualification/mujoco-finite-cap-admission.fixture.json',
      ),
      { sha256: p.fixtureSha256 },
    ),
  );
  const raw = asJson(input(p.raw));
  const retained = asJson(input(p.retained));
  demand(
    raw.status === 'PASS_POSITION_ONLY' &&
      raw.fixturePin === p.fixtureSha256 &&
      raw.xmlPin === p.xmlSha256 &&
      raw.dynamicCalls === 0 &&
      raw.candidate.returns === 407 &&
      raw.stock.returns === 6 &&
      raw.candidate.dataFreed &&
      raw.stock.dataFreed &&
      raw.candidate.modelFreed &&
      raw.stock.modelFreed &&
      retained.records.length === 401,
    'POSITION_ADMISSION_PROVENANCE',
  );
  const meta = raw.candidate.records[0];
  const pair = [meta.names.indexOf(f.deck.canName), meta.names.indexOf(f.deck.supportName)];
  demand(
    pair[0] === 8 && pair[1] === 2 && meta.pairs.length === 9,
    'POSITION_NAMED_PAIR_IDENTITIES',
  );
  const cases = p.witnesses.map((witness) => {
    const caseRecords = raw.candidate.records.filter(({ id }) => id === witness.id);
    demand(caseRecords.length === 1, 'UNIQUE_ARCHIVED_POSITION_WITNESS');
    const archived = caseRecords[0];
    demand(
      archived.ramp === witness.rampFrame &&
        (archived.tick ?? undefined) === witness.tick &&
        archived.before.length === 3 &&
        [18, 16, 1].every((n, i) => archived.before[i].length === n * 16) &&
        archived.before.every((word, i) => word === archived.after[i]) &&
        archived.measured.ncon === witness.ncon &&
        archived.measured.nefc === witness.nefc &&
        registeredContacts(archived.measured.contacts, pair).length === witness.pair,
      'FROZEN_POSITION_WITNESS',
    );
    if (witness.tick !== undefined) {
      const match = retained.records.find(({ tick }) => tick === witness.tick);
      demand(
        match?.recordSha256 === archived.sourceRecordSha256 &&
          archived.expected.length === 3 &&
          archived.capProof.margin >= f.math.minimumProjectedSupportM,
        'FINITE_CAP_RETAINED_PRE',
      );
    } else {
      const stock = raw.stock.records.find(({ id }) => id === witness.id);
      demand(
        stock &&
          stock.before.every((word, i) => word === archived.before[i]) &&
          stock.measured.ncon === witness.ncon &&
          stock.measured.nefc === witness.nefc,
        'STOCK_IMMERSED_SIDE_PROVENANCE',
      );
      assert.deepEqual(
        registeredContacts(stock.measured.contacts, pair),
        registeredContacts(archived.measured.contacts, pair),
        'STOCK_FALLBACK_RETAINED_GEOMETRY',
      );
    }
    return {
      ...witness,
      state: archived.before,
      measured: archived.measured,
      analytic: archived.expected,
    };
  });
  return {
    xml: extractPositionXml(f),
    xmlSha256: p.xmlSha256,
    options: meta.option,
    names: meta.names,
    pairs: meta.pairs,
    pair,
    cases,
    canMass: f.can.mass,
    canInertia: f.can.inertia,
    tolerances: {
      position: f.math.witnessAgreementM,
      frame: f.math.frameTolerance,
      deckY: f.deck.y,
    },
    contactCap: f.limits.roomContacts,
    rowCap: f.limits.roomConstraintRows,
  };
}

function readBrowserInputs() {
  const p = fixture.browser;
  const original = {
    module: input(p.legacyModule),
    wasm: input(p.legacyWasm),
  };
  const legacyPackage = asJson(input(p.legacyPackage));
  demand(
    legacyPackage.name === '@mujoco/mujoco' &&
      legacyPackage.version === fixture.engineVersion &&
      legacyPackage.license === 'Apache-2.0',
    'OFFICIAL_LEGACY_PACKAGE_LICENSE',
  );
  const priorDenied = asJson(input(p.priorDenied));
  const priorPermissive = asJson(input(p.priorPermissive));
  demand(
    !priorDenied.accepted &&
      priorDenied.result.error.startsWith('EvalError:') &&
      priorPermissive.accepted &&
      priorPermissive.chromium === p.version &&
      priorPermissive.result.result.replay.terminalActualSha256 === fixture.motion.finalSha256,
    'LEGACY_CHROMIUM_CONTROLS',
  );
  const policyFile = fileBytes(join(repo, 'apps/api/src/app.factory.ts'), {
    sha256: p.cspSource,
  }).toString('utf8');
  const source = policyFile.match(/'Content-Security-Policy': \[([\s\S]+?)\]\.join\('; '\)/)?.[1];
  demand(source, 'FASTIFY_CSP_SOURCE');
  const directives = Array.from(source.matchAll(/^\s*"([^"]+)",$/gm), (match) => match[1]);
  const policy = directives.join('; ') + '; upgrade-insecure-requests';
  demand(
    directives.length === 13 &&
      !policy.includes('unsafe-eval') &&
      directives.includes("script-src 'self' https://st.max.ru") &&
      directives.includes("worker-src 'self' blob:"),
    'FASTIFY_STRICT_PAGE',
  );
  const manifests = p.manifest.map((pin) => ({
    path: pin.path,
    ...treeDigest(localPath(pin.path), pin),
  }));
  const packageLock = asJson(input(p.playwright));
  input(p.executable);
  demand(packageLock.version === p.playwrightVersion, 'PLAYWRIGHT_PIN');
  return { original, policy, manifests, motion: loadMotion(), position: loadPosition() };
}

function decodeFloatHex(hex) {
  demand(/^(?:[0-9a-f]{16})+$/.test(hex), 'ARCHIVED_F64_HEX');
  const bytes = Uint8Array.from(hex.match(/../g), (byte) => Number.parseInt(byte, 16));
  const view = new DataView(bytes.buffer);
  return Array.from({ length: bytes.length / 8 }, (_, index) => view.getFloat64(index * 8, true));
}

function floatHex(numbers) {
  const view = new DataView(new ArrayBuffer(numbers.length * 8));
  numbers.forEach((value, index) => {
    demand(Number.isFinite(value), 'WORKER_FINITE_F64');
    view.setFloat64(index * 8, value, true);
  });
  return Array.from(new Uint8Array(view.buffer), (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
}

function readOptions(model, expected) {
  const readback = {};
  for (const [key, value] of Object.entries(expected)) {
    const actual = model.opt[key];
    const observed = Array.isArray(value) ? Array.from(actual) : actual;
    demand(
      Array.isArray(value)
        ? observed.length === value.length && observed.every((item, i) => Object.is(item, value[i]))
        : Object.is(value, observed),
      'WORKER_SOLVER_OPTION ' + key,
    );
    readback[key] = observed;
  }
  return readback;
}

function ownNative(value, result) {
  demand(value && typeof value.delete === 'function', 'WORKER_NATIVE_RESOURCE');
  result.owned += 1;
  return value;
}

function freeNative(value, result, label) {
  if (!value) return;
  try {
    value.delete();
    result.freed += 1;
  } catch (error) {
    result.cleanup.push({ label, name: error.name, message: String(error.message).slice(0, 500) });
  }
}

function runMotion(M, binding, result) {
  const sampleRows = [];
  result.samplesHex = '';
  result.stage = 'motion-model';
  result.modelAttempts += 1;
  const model = ownNative(M.MjModel.from_xml_string(binding.xml), result);
  let data;
  try {
    data = ownNative(new M.MjData(model), result);
    demand(
      model.nq === 19 &&
        model.nv === 17 &&
        model.nu === 4 &&
        model.npair === 10 &&
        data.time === 0 &&
        Array.from(data.qvel).every((v) => v === 0),
      'WORKER_MOTION_FACTORY',
    );
    result.options = readOptions(model, binding.options);
    const { intervals, stepUs, horizonUs, samplePeriodUs } = binding.spec;
    const drive = binding.drive;
    const start = performance.now();
    result.stage = 'motion-intervals';
    for (let step = 0; step < intervals; step += 1) {
      const t = step * stepUs;
      const prev = data.qvel;
      const ctrl = data.ctrl;
      for (let i = 0; i < 4; i += 1) {
        ctrl[i] =
          t < drive.motorSettleUs
            ? 0
            : drive.torqueCapNm * Math.min(1, Math.max(0, 1 - prev[6 + i] / drive.noLoadRadPS));
      }
      data.qfrc_applied[16] = t >= drive.pulseStartUs && t < drive.pulseEndUs ? drive.force : 0;
      result.step1 += 1;
      M.mj_step1(model, data);
      result.step1Returned += 1;
      result.step2 += 1;
      M.mj_step2(model, data);
      result.step2Returned += 1;
      const end = t + stepUs;
      result.lastTime = data.time;
      demand(Math.abs(data.time - end / 1e6) < 1e-9 && end <= horizonUs, 'WORKER_MOTION_CLOCK');
      if (end % samplePeriodUs === 0) {
        // Encode a complete finite row before committing it to the retained prefix.
        sampleRows.push(floatHex([...data.qpos, ...data.qvel, data.time]));
      }
    }
    result.loopMs = performance.now() - start;
    result.terminalHex = floatHex([...data.qpos, ...data.qvel, data.time]);
  } finally {
    freeNative(data, result, 'motion-data');
    freeNative(model, result, 'motion-model');
    // The caller retains this prefix and the primary error if the loop aborts.
    result.samplesHex = sampleRows.join('');
  }
}

function positionGeometry(data, result, model, binding) {
  const { ncon, nefc, nisland } = data;
  demand(
    Number.isSafeInteger(ncon) &&
      ncon >= 0 &&
      ncon <= binding.contactCap &&
      Number.isSafeInteger(nefc) &&
      nefc === 3 * ncon &&
      nefc <= binding.rowCap &&
      Number.isSafeInteger(nisland) &&
      nisland >= 0 &&
      nisland <= model.ntree,
    'WORKER_POSITION_NATIVE_BOUNDS',
  );
  const efcType = Array.from(data.efc_type);
  const efcId = Array.from(data.efc_id);
  demand(
    efcType.length === nefc && efcId.length === nefc && efcType.every((type) => type === 7),
    'WORKER_POSITION_ROW_SHAPE',
  );
  const contacts = [];
  const rows = new Set();
  const pairCounts = binding.pairs.map(() => 0);
  const vector = ownNative(data.contact, result);
  try {
    demand(vector.size() === ncon, 'WORKER_POSITION_CONTACT_VECTOR');
    for (let index = 0; index < ncon; index += 1) {
      const contact = ownNative(vector.get(index), result);
      try {
        const copy = { index };
        for (const key of [
          'dist',
          'includemargin',
          'dim',
          'geom1',
          'geom2',
          'exclude',
          'efc_address',
          'adhesion',
        ])
          copy[key] = contact[key];
        for (const [key, length] of Object.entries({
          pos: 3,
          frame: 9,
          friction: 5,
          solref: 2,
          solreffriction: 2,
          solimp: 5,
          geom: 2,
          flex: 2,
          elem: 2,
          vert: 2,
          surfacevel: 3,
        })) {
          copy[key] = Array.from(contact[key]);
          demand(
            copy[key].length === length && copy[key].every(Number.isFinite),
            'WORKER_POSITION_ARRAY ' + key,
          );
        }
        const pairId = binding.pairs.findIndex(
          ({ geom }) =>
            geom.includes(copy.geom1) && geom.includes(copy.geom2) && copy.geom1 !== copy.geom2,
        );
        demand(
          pairId >= 0 &&
            copy.dim === 3 &&
            copy.exclude === 0 &&
            copy.geom[0] === copy.geom1 &&
            copy.geom[1] === copy.geom2 &&
            [copy.dist, copy.includemargin, copy.adhesion].every(Number.isFinite) &&
            Number.isSafeInteger(copy.efc_address) &&
            copy.efc_address >= 0,
          'WORKER_POSITION_CONTACT_IDENTITY',
        );
        pairCounts[pairId] += 1;
        demand(
          pairCounts[pairId] <= binding.pairs[pairId].maxContacts,
          'WORKER_POSITION_PAIR_CAPACITY',
        );
        for (let offset = 0; offset < 3; offset += 1) {
          const row = copy.efc_address + offset;
          demand(
            row < nefc && efcId[row] === index && !rows.has(row),
            'WORKER_POSITION_NATIVE_ROW_ID',
          );
          rows.add(row);
        }
        contacts.push(copy);
      } finally {
        freeNative(contact, result, 'position-contact');
      }
    }
  } finally {
    freeNative(vector, result, 'position-contact-vector');
  }
  demand(rows.size === nefc && result.cleanup.length === 0, 'WORKER_POSITION_ROW_CLOSURE');
  const warnings = [];
  const statistics = data.warning; // Borrowed vector. get() produces an owned copy.
  demand(statistics.size() === 7, 'WORKER_WARNING_COUNT');
  for (let i = 0; i < 7; i += 1) {
    const warning = ownNative(statistics.get(i), result);
    try {
      const words = [warning.number, warning.lastinfo];
      demand(
        words.every((word) => word === 0),
        'WORKER_POSITION_WARNING',
      );
      warnings.push(words);
    } finally {
      freeNative(warning, result, 'position-warning');
    }
  }
  const poses = {};
  for (const [key, length] of Object.entries({
    xpos: model.nbody * 3,
    xipos: model.nbody * 3,
    xmat: model.nbody * 9,
    xquat: model.nbody * 4,
    geom_xpos: model.ngeom * 3,
    geom_xmat: model.ngeom * 9,
  })) {
    poses[key] = Array.from(data[key]);
    demand(
      poses[key].length === length && poses[key].every(Number.isFinite),
      'WORKER_POSITION_POSE_SHAPE',
    );
  }
  return { ncon, nefc, nisland, efcType, efcId, contacts, warnings, poses };
}

function positionState(data) {
  return [floatHex(Array.from(data.qpos)), floatHex(Array.from(data.qvel)), floatHex([data.time])];
}

function runPosition(M, binding, result) {
  result.stage = 'position-model';
  result.modelAttempts += 1;
  const model = ownNative(M.MjModel.from_xml_string(binding.xml), result);
  let data;
  try {
    demand(
      model.nq === 18 &&
        model.nv === 16 &&
        model.ngeom === 9 &&
        model.nbody === 7 &&
        model.npair === 9,
      'WORKER_POSITION_FACTORY',
    );
    result.options = readOptions(model, binding.options);
    const strings = new Uint8Array(model.names);
    const names = Array.from(model.name_geomadr, (start) =>
      new TextDecoder().decode(strings.subarray(start, strings.indexOf(0, start))),
    );
    const pairs = Array.from(model.pair_geom1, (first, i) => {
      const second = model.pair_geom2[i];
      demand(model.pair_dim[i] === 3, 'WORKER_POSITION_PAIR_DIM');
      return { geom: [first, second], maxContacts: M.mj_maxContact(model, first, second, 0) };
    });
    demand(
      JSON.stringify(names) === JSON.stringify(binding.names) &&
        JSON.stringify(pairs) === JSON.stringify(binding.pairs) &&
        model.geom_type[binding.pair[0]] === 5 &&
        model.geom_type[binding.pair[1]] === 6 &&
        model.body_mass[6] === binding.canMass &&
        binding.canInertia.every((value, i) => model.body_inertia[18 + i] === value),
      'WORKER_POSITION_NATIVE_IDENTITY',
    );
    data = ownNative(new M.MjData(model), result);
    result.positions = [];
    for (const witness of binding.cases) {
      result.stage = witness.id;
      demand(result.position < 2, 'WORKER_POSITION_CALL_CAP');
      // Only positional frozen-input rebinding. This world never calls a step.
      data.qpos.set(decodeFloatHex(witness.state[0]));
      data.qvel.set(decodeFloatHex(witness.state[1]));
      [data.time] = decodeFloatHex(witness.state[2]);
      const before = positionState(data);
      demand(
        witness.state.every((word, i) => word === before[i]),
        'WORKER_POSITION_RESTORE_READBACK',
      );
      result.position += 1;
      M.mj_fwdPosition(model, data);
      result.positionReturned += 1;
      const after = positionState(data);
      const observed = { id: witness.id, before, after, geometry: null };
      result.positions.push(observed);
      demand(
        before.every((word, i) => word === after[i]),
        'WORKER_POSITION_UNCHANGED_TIME_AND_STATE',
      );
      observed.geometry = positionGeometry(data, result, model, binding);
    }
  } finally {
    freeNative(data, result, 'position-data');
    freeNative(model, result, 'position-model');
  }
}

async function workerSha(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

async function workerFetch(path, mime) {
  const url = new URL(path, self.location.href);
  demand(url.origin === self.location.origin, 'WORKER_SAME_ORIGIN_RESOURCE');
  const response = await fetch(url, { redirect: 'error', cache: 'no-store', credentials: 'omit' });
  demand(
    response.ok && response.url === url.href && response.headers.get('content-type') === mime,
    'WORKER_RESOURCE_URL_AND_MIME',
  );
  return response.arrayBuffer();
}

async function nativeWorker({ type, hashes, binding }, result) {
  result.stage = 'artifact-pins';
  const [js, wasm] = await Promise.all([
    workerFetch('/mujoco.js', 'text/javascript; charset=utf-8'),
    workerFetch('/mujoco.wasm', 'application/wasm'),
  ]);
  result.artifact = { module: await workerSha(js), wasm: await workerSha(wasm) };
  demand(
    result.artifact.module === hashes.module && result.artifact.wasm === hashes.wasm,
    'WORKER_ARTIFACT_SHA256',
  );
  if (type === 'no-wasm') {
    result.stage = 'wasm-compile';
    result.compileAttempts += 1;
    // Compile the exact AOT WASM here so the browser-class denial is retained
    // before Embind can wrap it in a RuntimeError.
    await WebAssembly.compile(wasm);
    throw new Error('UNEXPECTED_WASM_COMPILE_SUCCESS');
  }
  result.stage = 'module-import';
  const { default: load } = await import('/mujoco.js');
  result.stage = 'wasm-factory';
  result.factoryAttempts += 1;
  const M = await load({
    wasmBinary: wasm,
    locateFile(name) {
      demand(name === 'mujoco.wasm', 'WORKER_UNREGISTERED_EMSCRIPTEN_ASSET');
      return new URL(name, self.location.href).href;
    },
  });
  demand(M.mj_versionString() === '4.0.0', 'WORKER_ENGINE_VERSION');
  result.version = '4.0.0';
  demand(type === 'position' || type === 'motion', 'UNEXPECTED_NEGATIVE_FACTORY_SUCCESS');
  demand(
    (await workerSha(new TextEncoder().encode(binding.xml))) === binding.xmlSha256,
    'WORKER_MODEL_INPUT_PIN',
  );
  if (type === 'position') runPosition(M, binding, result);
  else runMotion(M, binding, result);
  demand(
    result.cleanup.length === 0 && result.owned === result.freed,
    'WORKER_NATIVE_RESOURCE_CLOSURE',
  );
  result.stage = 'complete';
}

function newWorkerResult() {
  return {
    stage: 'worker-start',
    compileAttempts: 0,
    factoryAttempts: 0,
    modelAttempts: 0,
    step1: 0,
    step2: 0,
    step1Returned: 0,
    step2Returned: 0,
    position: 0,
    positionReturned: 0,
    owned: 0,
    freed: 0,
    cleanup: [],
    error: null,
  };
}

function wireNativeWorker() {
  self.onmessage = async ({ data: request }) => {
    self.onmessage = null;
    const result = newWorkerResult();
    try {
      await nativeWorker(request, result);
    } catch (error) {
      result.error = { name: error.name, message: String(error.message).slice(0, 1200) };
    }
    self.postMessage(result);
  };
}

function functionPolicyProbe() {
  const result = newWorkerResult();
  result.stage = 'string-function';
  try {
    Reflect.construct(Function, ['return 1']);
    result.error = { name: 'UnexpectedSuccess', message: 'CSP permitted dynamic JavaScript' };
  } catch (error) {
    result.error = { name: error.name, message: String(error.message).slice(0, 1200) };
  }
  return result;
}

function wireFunctionWorker() {
  self.onmessage = () => {
    self.onmessage = null;
    self.postMessage(functionPolicyProbe());
  };
}

function wirePage(config) {
  const runProbe = ({ type, payload, timeoutMs }) => {
    if (type === 'page-function') return { result: functionPolicyProbe(), terminated: null };
    return new Promise((resolve) => {
      const worker = new Worker('/physics-worker.mjs', {
        type: 'module',
        name: 'asa-mujoco-aot-test',
      });
      let finished = false;
      const finish = (result) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        worker.terminate();
        resolve({ result, terminated: true });
      };
      const timer = setTimeout(
        () => finish({ error: { name: 'Timeout', message: 'WORKER_DEADLINE' } }),
        timeoutMs,
      );
      worker.onmessage = ({ data }) => finish(data);
      worker.onmessageerror = () =>
        finish({ error: { name: 'MessageError', message: 'WORKER_CLONE' } });
      worker.onerror = (event) =>
        finish({ error: { name: 'WorkerError', message: event.message.slice(0, 1200) } });
      worker.postMessage(payload);
    });
  };

  // A real browser task owns the attempt. No Playwright evaluation launches it.
  setTimeout(async () => {
    try {
      window.asaProbeOutcome = await runProbe(config);
    } catch (error) {
      window.asaProbeOutcome = {
        result: { error: { name: error.name, message: String(error.message).slice(0, 1200) } },
      };
    }
    document.documentElement.setAttribute('data-asa-probe', 'complete');
  }, 0);
}

function moduleSource(declarations, main, config = undefined) {
  // Node serializes the authored module source into an actual HTTP response.
  // Chromium executes it as an ordinary URL module under the response's CSP.
  return (
    declarations.map((item) => item.toString()).join('\n') +
    '\n' +
    main.name +
    '(' +
    (config === undefined ? '' : JSON.stringify(config)) +
    ');\n'
  );
}

function pageProbeSource(config) {
  return moduleSource([newWorkerResult, functionPolicyProbe, wirePage], wirePage, config);
}

function expectNegative(type, value) {
  const result = value?.result;
  const error = result?.error;
  demand(
    result &&
      error &&
      result.modelAttempts === 0 &&
      result.step1 === 0 &&
      result.step2 === 0 &&
      result.position === 0 &&
      result.owned === 0 &&
      result.freed === 0 &&
      result.cleanup.length === 0,
    'NEGATIVE_CONTROL_ZERO_NATIVE ' + type,
  );
  if (type === 'legacy') {
    demand(
      result.stage === 'wasm-factory' &&
        result.factoryAttempts === 1 &&
        result.compileAttempts === 0 &&
        error.name === 'EvalError' &&
        /unsafe-eval/i.test(error.message),
      'LEGACY_EVAL_DENIAL',
    );
  } else if (type === 'no-wasm') {
    demand(
      result.stage === 'wasm-compile' &&
        result.compileAttempts === 1 &&
        result.factoryAttempts === 0 &&
        error.name === 'CompileError' &&
        /content security policy|wasm-unsafe-eval/i.test(error.message),
      'WASM_POLICY_DENIAL',
    );
  } else if (type === 'tamper') {
    demand(
      result.stage === 'artifact-pins' &&
        result.compileAttempts === 0 &&
        result.factoryAttempts === 0 &&
        error.message === 'WORKER_ARTIFACT_SHA256',
      'AOT_TAMPER_DENIAL',
    );
  } else {
    demand(
      result.stage === 'string-function' &&
        result.compileAttempts === 0 &&
        result.factoryAttempts === 0 &&
        error.name === 'EvalError' &&
        /unsafe-eval/i.test(error.message),
      'DYNAMIC_FUNCTION_DENIAL',
    );
  }
}

function requirePositive(value, binding) {
  const result = value?.result;
  demand(
    result?.stage === 'complete' &&
      result.error === null &&
      result.compileAttempts === 0 &&
      result.factoryAttempts === 1 &&
      result.modelAttempts === 1 &&
      result.version === fixture.engineVersion &&
      result.owned === result.freed &&
      result.owned >= 2 &&
      result.cleanup.length === 0 &&
      value.terminated === true,
    'POSITIVE_WORKER_COMPLETION',
  );
  assert.deepEqual(result.options, binding.options, 'PERSISTED_NATIVE_OPTIONS');
  return result;
}

function assessMotion(value, motion) {
  const result = requirePositive(value, motion);
  const p = fixture.motion;
  demand(
    result.step1 === p.intervals &&
      result.step2 === p.intervals &&
      result.step1Returned === p.intervals &&
      result.step2Returned === p.intervals &&
      result.position === 0 &&
      result.positionReturned === 0 &&
      result.owned === 2 &&
      Math.abs(result.lastTime - p.horizonUs / 1e6) < 1e-9,
    'EXACT_MOTION_CLOCK_AND_DISPATCH',
  );
  demand(
    result.samplesHex.length === p.samples * p.terminalWords * 16 &&
      result.terminalHex.length === p.terminalWords * 16,
    'COMPLETE_MOTION_WORD_COUNTS',
  );
  const rowWidth = p.terminalWords * 16;
  const mismatchedRows = Array.from({ length: p.samples }, (_, index) => index).filter((index) => {
    const start = index * rowWidth;
    const end = start + rowWidth;
    return result.samplesHex.slice(start, end) !== motion.samplesHex.slice(start, end);
  });
  const finalActual = sha(Buffer.from(result.terminalHex, 'hex'));
  const comparison = {
    sampleCount: p.samples,
    wordsPerSample: p.terminalWords,
    mismatchedSamples: mismatchedRows,
    sampleSha256: sha(Buffer.from(result.samplesHex, 'hex')),
    archivedSamplesSha256: sha(Buffer.from(motion.samplesHex, 'hex')),
    finalActual,
    finalExpected: p.finalSha256,
  };
  value.comparison = comparison;
  demand(
    mismatchedRows.length === 0 &&
      result.terminalHex === motion.terminalHex &&
      finalActual === p.finalSha256,
    'ARCHIVED_MOTION_F64_DIVERGENCE',
  );
}

function nearArray(actual, expected, tolerance, label) {
  demand(
    Array.isArray(actual) &&
      actual.length === expected.length &&
      actual.every(
        (value, i) => Number.isFinite(value) && Math.abs(value - expected[i]) <= tolerance,
      ),
    label,
  );
}

function assessPosition(value, position) {
  const result = requirePositive(value, position);
  demand(
    result.position === 2 &&
      result.positionReturned === 2 &&
      result.step1 === 0 &&
      result.step2 === 0 &&
      result.step1Returned === 0 &&
      result.step2Returned === 0 &&
      result.positions?.length === 2,
    'EXACT_POSITION_ONLY_DISPATCH',
  );
  const { position: posTolerance, frame: frameTolerance, deckY } = position.tolerances;
  value.comparison = [];
  for (const [i, observed] of result.positions.entries()) {
    const required = position.cases[i];
    const expected = required.measured;
    const actual = observed.geometry;
    demand(
      observed.id === required.id &&
        actual.ncon === required.ncon &&
        actual.nefc === required.nefc &&
        actual.nisland === expected.nisland &&
        actual.contacts.length === required.ncon,
      'ARCHIVED_POSITION_COUNTS ' + required.id,
    );
    assert.deepEqual(observed.before, required.state, 'ARCHIVED_POSITION_BEFORE');
    assert.deepEqual(observed.after, required.state, 'ARCHIVED_POSITION_AFTER');
    assert.deepEqual(actual.efcId, expected.efcId, 'ARCHIVED_POSITION_ROW_IDS');
    assert.deepEqual(actual.efcType, expected.efcType, 'ARCHIVED_POSITION_ROW_TYPES');
    assert.deepEqual(actual.warnings, expected.warnings, 'ARCHIVED_POSITION_WARNINGS');
    for (const [key, pose] of Object.entries(expected.poses)) {
      nearArray(actual.poses[key], pose, frameTolerance, 'ARCHIVED_POSITION_POSE ' + key);
    }
    for (const [contactIndex, contact] of actual.contacts.entries()) {
      const old = expected.contacts[contactIndex];
      for (const key of [
        'index',
        'dim',
        'geom1',
        'geom2',
        'exclude',
        'efc_address',
        'includemargin',
        'adhesion',
      ]) {
        demand(contact[key] === old[key], 'ARCHIVED_POSITION_CONTACT_FIELD ' + key);
      }
      demand(Math.abs(contact.dist - old.dist) <= posTolerance, 'ARCHIVED_POSITION_SIGNED_GAP');
      nearArray(contact.pos, old.pos, posTolerance, 'ARCHIVED_POSITION_CONTACT_POINT');
      nearArray(contact.frame, old.frame, frameTolerance, 'ARCHIVED_POSITION_CONTACT_FRAME');
      for (const key of [
        'friction',
        'solref',
        'solreffriction',
        'solimp',
        'geom',
        'flex',
        'elem',
        'vert',
        'surfacevel',
      ]) {
        nearArray(contact[key], old[key], 0, 'ARCHIVED_POSITION_MATERIAL_OR_IDENTITY ' + key);
      }
    }
    const named = registeredContacts(actual.contacts, position.pair);
    demand(named.length === required.pair, 'NAMED_PAIR_POSITION_COUNT');
    const unused = new Set(named);
    for (const { midpoint, gap } of required.analytic) {
      const point = [midpoint[0], midpoint[1] + deckY, midpoint[2]];
      const contact = Array.from(unused).find(
        (c) =>
          Math.abs(c.dist - gap) <= posTolerance &&
          c.pos.every((axis, j) => Math.abs(axis - point[j]) <= posTolerance),
      );
      demand(
        contact &&
          contact.geom1 === position.pair[0] &&
          contact.geom2 === position.pair[1] &&
          contact.frame[2] <= -1 + frameTolerance,
        'ANALYTIC_NAMED_PAIR_HALF_DEPTH_WITNESS',
      );
      unused.delete(contact);
    }
    value.comparison.push({
      id: required.id,
      namedPair: named.length,
      contacts: actual.ncon,
      constraintRows: actual.nefc,
    });
  }
}

function workerResponse(type) {
  if (type === 'worker-function') {
    return moduleSource(
      [newWorkerResult, functionPolicyProbe, wireFunctionWorker],
      wireFunctionWorker,
    );
  }
  const shared = [
    demand,
    readOptions,
    ownNative,
    freeNative,
    workerSha,
    workerFetch,
    nativeWorker,
    newWorkerResult,
    wireNativeWorker,
  ];
  return moduleSource(
    [...shared, decodeFloatHex, floatHex, runMotion, positionGeometry, positionState, runPosition],
    wireNativeWorker,
  );
}

const WORKER_CSP =
  "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; worker-src 'none'";
const JS_MIME = 'text/javascript; charset=utf-8';
const WASM_MIME = 'application/wasm';

async function chromiumCase(browser, type, inputs, artifacts, caseReceipt) {
  const { policy } = inputs;
  const origin = fixture.browser.origin;
  const context = await browser.newContext({
    offline: true,
    serviceWorkers: 'block',
    locale: 'en-US',
  });
  try {
    const stage = type === 'position' || type === 'motion' ? inputs[type] : null;
    const layer = type === 'legacy' ? inputs.original : artifacts;
    const hashes = { module: sha(layer.module), wasm: sha(layer.wasm) };
    const wasm = type === 'tamper' ? Buffer.from(layer.wasm) : layer.wasm;
    if (type === 'tamper') wasm[0] ^= 1;
    const workerCsp =
      type === 'no-wasm' ? WORKER_CSP.replace(" 'wasm-unsafe-eval'", '') : WORKER_CSP;
    const pageSource = pageProbeSource({
      type,
      payload: { type, hashes, binding: stage },
      timeoutMs: fixture.browser.timeoutMs,
    });
    const workerSource = workerResponse(type);
    const allow = new Map(
      [
        [
          '/',
          {
            contentType: 'text/html; charset=utf-8',
            csp: policy,
            body: '<!doctype html><title>ASA AOT Worker</title><link rel="icon" href="data:,"><script type="module" src="/page.mjs"></script>',
            cap: 1,
          },
        ],
        ['/page.mjs', { contentType: JS_MIME, body: pageSource, cap: 1 }],
        [
          '/physics-worker.mjs',
          { contentType: JS_MIME, csp: workerCsp, body: workerSource, cap: 1 },
        ],
        ['/mujoco.js', { contentType: JS_MIME, body: layer.module, cap: 2 }],
        ['/mujoco.wasm', { contentType: WASM_MIME, body: wasm, cap: 1 }],
      ].map(([path, item]) => [origin + path, { ...item, path, count: 0, digest: sha(item.body) }]),
    );
    caseReceipt.policy = { page: policy, worker: workerCsp };
    caseReceipt.requestedArtifacts = hashes;
    context.on('request', (request) => {
      const href = request.url();
      if (!href.startsWith('data:')) caseReceipt.seenRequests += 1;
    });
    await context.route('**/*', async (route) => {
      const request = route.request();
      const href = request.url();
      const record = allow.get(href);
      if (
        !record ||
        request.method() !== 'GET' ||
        request.redirectedFrom() ||
        record.count >= record.cap ||
        (record.path === '/') !== request.isNavigationRequest()
      ) {
        caseReceipt.deniedRequests += 1;
        await route.abort('blockedbyclient');
        return;
      }
      record.count += 1;
      const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
      if (record.csp) headers['content-security-policy'] = record.csp;
      caseReceipt.requests.push({
        url: href,
        contentType: record.contentType,
        sha256: record.digest,
        csp: record.csp,
      });
      await route.fulfill({
        status: 200,
        contentType: record.contentType,
        headers,
        body: record.body,
      });
    });
    const page = await context.newPage();
    page.on('worker', (worker) => {
      caseReceipt.createdWorkers += 1;
      const entry = { url: worker.url(), closed: false };
      worker.on('close', () => {
        entry.closed = true;
      });
      caseReceipt.workers.push(entry);
    });
    const navigation = await page.goto(origin + '/', { timeout: 10000, waitUntil: 'load' });
    demand(
      navigation?.status() === 200 && navigation.headers()['content-security-policy'] === policy,
      'STRICT_PAGE_ACTUAL_RESPONSE',
    );
    // The ordinary document module sets this marker after the probe has finished.
    await page.locator('html[data-asa-probe="complete"]').waitFor({
      state: 'attached',
      timeout: fixture.browser.timeoutMs + 5000,
    });
    caseReceipt.value = await page.evaluate(() => window.asaProbeOutcome);
  } finally {
    await context.close();
    caseReceipt.contextClosed = true;
  }
  const listens = (path) => caseReceipt.requests.filter(({ url }) => url === origin + path);
  demand(
    caseReceipt.contextClosed &&
      caseReceipt.deniedRequests === 0 &&
      caseReceipt.seenRequests === caseReceipt.requests.length &&
      listens('/').length === 1 &&
      listens('/page.mjs').length === 1,
    'SYNTHETIC_REQUEST_ISOLATION ' + type,
  );
  if (type === 'page-function') {
    demand(
      caseReceipt.createdWorkers === 0 && caseReceipt.requests.length === 2,
      'PAGE_PROBE_WITHOUT_WORKER',
    );
  } else {
    demand(
      caseReceipt.createdWorkers === 1 &&
        caseReceipt.workers.length === 1 &&
        caseReceipt.workers[0].url === origin + '/physics-worker.mjs' &&
        caseReceipt.workers[0].closed &&
        listens('/physics-worker.mjs').length === 1 &&
        caseReceipt.value?.terminated === true,
      'URL_WORKER_OWNERSHIP ' + type,
    );
    const compileInput = type !== 'worker-function';
    demand(
      listens('/mujoco.wasm').length === Number(compileInput) &&
        listens('/mujoco.js').length ===
          (['position', 'motion', 'legacy'].includes(type) ? 2 : Number(compileInput)),
      'EXACT_WORKER_ARTIFACT_REQUESTS ' + type,
    );
  }
  if (type === 'motion') assessMotion(caseReceipt.value, inputs.motion);
  else if (type === 'position') assessPosition(caseReceipt.value, inputs.position);
  else expectNegative(type, caseReceipt.value);
  caseReceipt.accepted = true;
}

function sealedArtifact(receiptPath, expectedReceipt, pins) {
  const root = ownTemp();
  demand(
    isAbsolute(receiptPath) &&
      resolve(receiptPath) === realpathSync(receiptPath) &&
      basename(receiptPath) === LINK_RECEIPT,
    'EXACT_EXTERNAL_LINK_RECEIPT',
  );
  const folder = dirname(receiptPath);
  demand(
    dirname(folder) === root && basename(folder).startsWith(TEMP_PREFIX),
    'ISOLATED_LINK_RECEIPT_DIRECTORY',
  );
  const bytes = fileBytes(receiptPath, { sha256: digestArg(expectedReceipt) }, MAX_RECEIPT);
  const receipt = asJson(bytes);
  demand(
    receipt.mode === 'isolated-link' &&
      receipt.accepted === true &&
      receipt.error === null &&
      receipt.child.status === 0 &&
      receipt.artifacts.length === ARTIFACTS.length,
    'ACCEPTED_LINK_RECEIPT',
  );
  assert.deepEqual(receipt.pins, pins, 'REVIEWED_BUILD_SOURCE_BINDING');
  assert.deepEqual(
    receipt.command.argv,
    [
      '-E',
      '-B',
      '-X',
      'pycache_prefix=' + join(folder, 'scratch', 'pycache'),
      localPath(fixture.link.compiler),
      ...archiveLinkPlan(join(folder, 'input'), join(folder, 'artifact'), true),
    ],
    'SEALED_LINK_ARGV',
  );
  assert.deepEqual(receipt.build.candidateNormalizedArgv, [
    ...fixture.link.normalizedArgv,
    ...fixture.link.aotFlags,
  ]);
  assert.deepEqual(receipt.build.inputs, [...fixture.link.inputs, fixture.link.collisionObject]);
  const artifactDir = join(folder, 'artifact');
  demand(realpathSync(artifactDir) === artifactDir, 'CANONICAL_LINK_ARTIFACT_DIRECTORY');
  const read = ARTIFACTS.map((name, i) => {
    const pin = receipt.artifacts[i];
    demand(pin.name === name, 'SEALED_ARTIFACT_NAME');
    return fileBytes(join(artifactDir, name), pin);
  });
  return {
    folder,
    artifacts: { module: read[0], wasm: read[1] },
    manifest: receipt.artifacts,
    receiptSha256: sha(bytes),
  };
}

async function browserOnly(pins, path, expectedReceipt) {
  const sealed = sealedArtifact(path, expectedReceipt, pins);
  const inputs = readBrowserInputs();
  const receiptPath = join(sealed.folder, 'browser-receipt.json');
  const file = reserveReceipt(receiptPath);
  const receipt = {
    mode: 'isolated-browser',
    pins,
    artifactManifest: sealed.manifest,
    buildReceiptSha256: sealed.receiptSha256,
    tools: inputs.manifests,
    accepted: false,
    browserClosed: false,
    cases: [],
    error: null,
  };
  let browser;
  try {
    const localRequire = createRequire(localPath(fixture.browser.playwright.path));
    const core = localRequire.resolve('playwright-core/package.json');
    demand(
      core === join(localPath(fixture.browser.manifest[1].path), 'package.json'),
      'EXACT_PLAYWRIGHT_CORE',
    );
    const { chromium } = localRequire('./index.js');
    browser = await chromium.launch({
      executablePath: localPath(fixture.browser.executable.path),
      headless: true,
      timeout: 15000,
      args: ['--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND'],
    });
    receipt.browserVersion = browser.version();
    demand(receipt.browserVersion === fixture.browser.version, 'EXACT_CHROMIUM_VERSION');
    for (const type of [
      'page-function',
      'worker-function',
      'legacy',
      'no-wasm',
      'tamper',
      'position',
      'motion',
    ]) {
      const stage = {
        type,
        accepted: false,
        requests: [],
        seenRequests: 0,
        deniedRequests: 0,
        workers: [],
        createdWorkers: 0,
        contextClosed: false,
      };
      receipt.cases.push(stage);
      await chromiumCase(browser, type, inputs, sealed.artifacts, stage);
    }
    receipt.accepted = true;
  } catch (error) {
    receipt.error = summarize(error);
  } finally {
    if (browser) {
      try {
        await browser.close();
        receipt.browserClosed = true;
      } catch (error) {
        receipt.cleanupError = summarize(error);
        receipt.accepted = false;
      }
    }
  }
  const receiptSha256 = saveReceipt(file, receipt);
  console.log(
    JSON.stringify({
      mode: receipt.mode,
      receiptPath,
      receiptSha256,
      accepted: receipt.accepted,
      error: receipt.error,
      cleanupError: receipt.cleanupError,
      cases: receipt.cases.map(({ type, accepted }) => ({ type, accepted })),
    }),
  );
  return receipt.accepted;
}

function parseCommand(args) {
  if (args.length === 0 || (args.length === 1 && args[0] === '--self-test'))
    return { mode: 'self-test' };
  if (args.length === 1 && args[0] === '--inspect') return { mode: 'inspect' };
  if (args.length === 3 && args[0] === '--link') {
    return { mode: 'link', source: digestArg(args[1]), fixture: digestArg(args[2]) };
  }
  if (args.length === 5 && args[0] === '--browser') {
    return {
      mode: 'browser',
      path: args[1],
      receipt: digestArg(args[2]),
      source: digestArg(args[3]),
      fixture: digestArg(args[4]),
    };
  }
  throw new Error(
    'USAGE: [--self-test | --inspect | --link SOURCE_SHA FIXTURE_SHA | --browser BUILD_RECEIPT BUILD_SHA SOURCE_SHA FIXTURE_SHA]',
  );
}

function testMotionFailureReceipt() {
  const failure = new Error('INJECTED_MOTION_STEP_FAILURE');
  const releases = [];
  const data = {
    time: 0,
    qpos: new Float64Array(19),
    qvel: new Float64Array(17),
    ctrl: new Float64Array(4),
    qfrc_applied: new Float64Array(17),
    delete() {
      releases.push('data');
      throw new Error('INJECTED_DATA_CLEANUP_FAILURE');
    },
  };
  const engine = {
    MjModel: {
      from_xml_string: () => ({
        nq: 19,
        nv: 17,
        nu: 4,
        npair: 10,
        opt: {},
        delete: () => releases.push('model'),
      }),
    },
    MjData: function () {
      return data;
    },
    mj_step1() {},
    mj_step2() {
      if (data.time > 0) throw failure;
      data.time = 0.0005;
    },
  };
  const result = newWorkerResult();
  assert.throws(
    () =>
      runMotion(
        engine,
        {
          xml: '',
          options: {},
          spec: { intervals: 2, stepUs: 500, horizonUs: 1000, samplePeriodUs: 500 },
          drive: { motorSettleUs: 1000, pulseStartUs: 1000, pulseEndUs: 1500 },
        },
        result,
      ),
    (error) => error === failure,
  );
  assert.equal(result.samplesHex, floatHex([...data.qpos, ...data.qvel, 0.0005]));
  assert.equal(result.lastTime, 0.0005);
  assert.equal(result.terminalHex, undefined);
  assert.deepEqual(
    [result.step1, result.step1Returned, result.step2, result.step2Returned],
    [2, 2, 2, 1],
  );
  assert.deepEqual(releases, ['data', 'model']);
  assert.deepEqual(result.cleanup, [
    {
      label: 'motion-data',
      name: 'Error',
      message: 'INJECTED_DATA_CLEANUP_FAILURE',
    },
  ]);
}

async function testPageProbeTask() {
  const window = {};
  const tasks = [];
  const attributes = [];
  let functionAttempts = 0;
  const source = pageProbeSource({ type: 'page-function', payload: null, timeoutMs: 1 });
  new Script(source).runInNewContext({
    window,
    document: { documentElement: { setAttribute: (...words) => attributes.push(words) } },
    setTimeout: (task) => tasks.push(task),
    Reflect: {
      construct() {
        functionAttempts += 1;
        const error = new Error('mock script-src denied unsafe-eval');
        error.name = 'EvalError';
        throw error;
      },
    },
  });
  assert.equal(functionAttempts, 0);
  assert.equal(window.asaProbeOutcome, undefined);
  assert.deepEqual(attributes, []);
  assert.equal(tasks.length, 1);
  await tasks[0]();
  assert.equal(functionAttempts, 1);
  expectNegative('page-function', window.asaProbeOutcome);
  assert.deepEqual(attributes, [['data-asa-probe', 'complete']]);
}

async function selfTest() {
  await testPageProbeTask();
  testMotionFailureReceipt();
  demand(
    fixture.schema === 'ASA-MUJOCO-AOT-WORKER-CSP-1' &&
      fixture.scope === 'TEST_ONLY' &&
      fixture.link.inputs.length === 8 &&
      fixture.link.licenses.length === 16,
    'REGISTERED_FIXTURE',
  );
  assert.deepEqual(parseCommand([]), { mode: 'self-test' });
  assert.deepEqual(parseCommand(['--inspect']), { mode: 'inspect' });
  assert.throws(() => parseCommand(['--link']), /USAGE/);
  assert.throws(() => parseCommand(['--link', 'xyz', 'abc']), /EXPECTED_SHA256/);
  assert.throws(() => parseCommand(['--browser', 'path']), /USAGE/);
  assert.throws(() => sourcePins('0'.repeat(64), '0'.repeat(64)), /REVIEWED_SOURCE_AND_FIXTURE/);
  const normal = archiveLinkPlan('inputs', 'outputs', false);
  const candidate = archiveLinkPlan('inputs', 'outputs', true);
  assert.deepEqual(candidate.slice(0, normal.length), normal);
  assert.deepEqual(candidate.slice(normal.length), ['-sDYNAMIC_EXECUTION=0', '-sEMBIND_AOT=1']);
  assert.equal(normal.filter((word) => word === '-lm').length, 2);
  assert(
    normal.includes(join('outputs', 'mujoco.js')) &&
      normal.includes(join('outputs', 'mujoco.d.ts')),
  );
  const sample = [0, -0, 3, -0.002, Number.MAX_VALUE];
  assert.deepEqual(decodeFloatHex(floatHex(sample)), sample);
  assert.throws(() => floatHex([NaN]), /WORKER_FINITE_F64/);
  assert.throws(() => decodeFloatHex('ff'), /ARCHIVED_F64_HEX/);
  assert.equal(fixture.motion.intervals * fixture.motion.stepUs, fixture.motion.horizonUs);
  assert.equal(fixture.motion.samples * fixture.motion.samplePeriodUs, fixture.motion.horizonUs);
  assert.deepEqual(
    fixture.position.witnesses.map(({ pair, ncon, nefc }) => [pair, ncon, nefc]),
    [
      [3, 11, 33],
      [1, 9, 27],
    ],
  );
  assert(!/\bFunction\s*\(|\beval\s*\(/.test(workerResponse('motion')));
  assert(!/\bFunction\s*\(|\beval\s*\(/.test(workerResponse('position')));
  for (const kind of ['motion', 'position', 'legacy', 'no-wasm', 'worker-function']) {
    assert.doesNotThrow(() => new Script(workerResponse(kind)));
  }
  const rejected = newWorkerResult();
  rejected.stage = 'artifact-pins';
  rejected.error = { name: 'Error', message: 'WORKER_ARTIFACT_SHA256' };
  expectNegative('tamper', { result: rejected });
  assert.throws(
    () => expectNegative('tamper', { result: { ...rejected, modelAttempts: 1 } }),
    /NEGATIVE_CONTROL_ZERO_NATIVE/,
  );
  const wasmDenied = {
    ...newWorkerResult(),
    stage: 'wasm-compile',
    compileAttempts: 1,
    error: { name: 'CompileError', message: 'Content Security Policy denied WebAssembly' },
  };
  expectNegative('no-wasm', { result: wasmDenied });
  assert.throws(
    () =>
      expectNegative('no-wasm', {
        result: { ...wasmDenied, error: { name: 'RuntimeError', message: 'abort' } },
      }),
    /WASM_POLICY_DENIAL/,
  );
  assert.throws(
    () => nearArray([0.001], [0], 1e-10, 'ALTERED_POSITION_WITNESS'),
    /ALTERED_POSITION_WITNESS/,
  );
  return {
    mode: 'self-test',
    status: 'PASS',
    actualLink: 0,
    actualBrowser: 0,
    actualPhysics: 0,
    pins: sourcePins(),
  };
}

async function main(args) {
  const command = parseCommand(args);
  if (command.mode === 'self-test') {
    console.log(JSON.stringify(await selfTest()));
    return;
  }
  demand(process.version === 'v22.23.3' && process.arch === 'x64', 'PINNED_NODE_RUNTIME');
  const pins = sourcePins(command.source, command.fixture);
  if (command.mode === 'inspect') {
    await selfTest();
    const build = inspectBuild();
    const browser = readBrowserInputs();
    console.log(
      JSON.stringify({
        mode: 'inspect',
        status: 'PASS',
        pins,
        actualLink: 0,
        actualBrowser: 0,
        actualPhysics: 0,
        build,
        pagePolicy: browser.policy,
        browserTools: browser.manifests,
        motion: {
          intervals: fixture.motion.intervals,
          modelSha256: browser.motion.xmlSha256,
          sampleSha256: sha(Buffer.from(browser.motion.samplesHex, 'hex')),
          finalSha256: fixture.motion.finalSha256,
        },
        position: {
          modelSha256: browser.position.xmlSha256,
          cases: browser.position.cases.map(({ id, pair, ncon, nefc }) => ({
            id,
            pair,
            ncon,
            nefc,
          })),
        },
      }),
    );
    return;
  }
  if (command.mode === 'link') {
    if (!linkOnly(pins)) process.exitCode = 1;
  } else if (!(await browserOnly(pins, command.path, command.receipt))) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === sourcePath) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(JSON.stringify({ status: 'FAIL', error: summarize(error) }));
    process.exitCode = 1;
  }
}
