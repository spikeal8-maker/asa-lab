// Independent source-of-tests challenge. No product/browser execution.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = '/workspace/scratch/927b9b969e63';
const ts = require(path.join(root, 'asa-lab-arduino/node_modules/typescript'));
const filename = process.argv[2] || path.join(root, 'asa-lab-arduino/e2e/electronics-ready-cadence.spec.ts');
const source = fs.readFileSync(filename, 'utf8');
const digest = crypto.createHash('sha256').update(source).digest('hex');
assert.equal(digest, '092ae57fdcd0395cee667aa627542371a46519a79d0e86cd4d7e7470ab5c604b');
const tree = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const wanted = new Set(['validTemporalPaint', 'temporalPhysicalBrightness', 'temporalPaintCausality', 'resetSetupPaintViolations']);
const fragments = tree.statements.filter(node =>
  (ts.isFunctionDeclaration(node) && wanted.has(node.name?.text)) ||
  (ts.isVariableStatement(node) && node.declarationList.declarations.some(d => d.name.getText(tree) === 'OWNER_TEMPORAL_PUBLICATION_LAG_MS'))
).map(node => node.getText(tree));
assert.equal(fragments.length, 5);
const js = ts.transpileModule(fragments.join('\n'), {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText;
const oracle = new Function(js + '\nreturn {temporalPaintCausality, resetSetupPaintViolations, lag:OWNER_TEMPORAL_PUBLICATION_LAG_MS};')();
assert.equal(oracle.lag, 50);
const program = 'independent-review-analytic-waveform';
function frame(at, brightness, options = {}) {
  const generationId = options.generationId ?? 1;
  return {
    at, requestAt: at - 1, requestId: `generation-${generationId}:at-${at}`, source: program,
    generationId, responseGenerationId: generationId, executionStatus: 'ready', solved: true,
    qualityPassed: true, committedHorizonMicroseconds: at * 1000,
    requestedHorizonMicroseconds: at * 1000,
    components: brightness.map((value, index) => ({componentId: `led${index}`, brightness: value})),
    ...options,
  };
}
function run(witnessAt, brightness) {
  return {
    first: {
      at: witnessAt[0] + 16, previousFrameAt: witnessAt[0], brightness,
      stablePreviousFrame: true,
      images: brightness.map(value => ({decoded: true, visible: true, unoccluded: true, opacity: 1, lit: value > 0})),
    },
    lastAt: witnessAt.at(-1), witnessAt, frames: witnessAt.length, maxGapMs: 20,
  };
}
function probe(frames, paintRuns) {return {frames, paintRuns, paintFrames: [], resetClicks: [], errors: []};}
const cases = [];
function check(label, data, {generation = 1, from = -Infinity, to = Infinity, reject = false, witnesses} = {}) {
  const result = oracle.temporalPaintCausality(data, program, generation, from, to);
  if (reject) assert(result.violations.length > 0, label + ' must reject');
  else assert.equal(result.violations.length, 0, label + ' must accept');
  if (witnesses !== undefined) assert.equal(result.witnesses.length, witnesses, label + ': clipped witnesses');
  cases.push({label, expected: reject ? 'REJECT' : 'ACCEPT', pass: true, accepted_witnesses: result.witnesses.length, violations: result.violations.length, first_violations: result.violations.slice(0, 2)});
  return result;
}
const A = [0, 67, 0], B = [67, 0, 67];
check('Exactly 50 ms after supersede is accepted', probe([frame(1000, A), frame(1050, B)], [run([1100], A)]), {witnesses: 1});
check('50.001 ms after supersede is rejected', probe([frame(1000, A), frame(1050, B)], [run([1100.001], A)]), {reject: true});
check('A currently held state has no artificial age limit', probe([frame(1000, A)], [run([11000], A)]), {witnesses: 1});
check('A matching future response is not causal evidence', probe([frame(1000, A), frame(1100, B)], [run([1050], B)]), {reject: true});
const generationFrames = [
  frame(1000, A, {generationId: 1, requestAt: 990}),
  frame(1050, A, {generationId: 2, requestAt: 1030}),
  frame(1080, A, {generationId: 1, requestAt: 1020}),
];
check('Late old response cannot reactivate its generation', probe(generationFrames, [run([1090], A)]), {generation: 1, reject: true});
check('New generation remains current after late old response', probe(generationFrames, [run([1090], A)]), {generation: 2, witnesses: 1});
check('Equal brightness from a newly active foreign source does not match', probe([frame(1000, A), frame(1050, A, {source: 'foreign-source'})], [run([1060], A)]), {reject: true});
check('Quality-failed response cannot establish a light state', probe([frame(1000, B, {qualityPassed: false})], [run([1100], B)]), {reject: true});
check('Incomplete ready cannot establish a light state', probe([frame(1000, B, {requestedHorizonMicroseconds: 1001000})], [run([1100], B)]), {reject: true});
check('Response/request generation mismatch cannot establish a light state', probe([frame(1000, B, {responseGenerationId: 2})], [run([1100], B)]), {reject: true});
check('Identical vector from an old phase expires after renewed supersede', probe([frame(1000, A), frame(1025, B), frame(1050, A), frame(1075, B)], [run([1125.001], A)]), {reject: true});
const interiorTimes = Array.from({length: 61}, (_, i) => 1000 + i * 10);
const interior = probe(interiorTimes.map(at => frame(at, at >= 1200 && at < 1400 ? B : A)), [run(interiorTimes, A)]);
const inside = check('One compressed run with matching endpoints cannot hide an entire wrong interior phase', interior, {reject: true});
assert(inside.witnesses.some(row => row.at === 1000) && inside.witnesses.some(row => row.at === 1600));
check('Window clips old matching run to its actual witnesses', interior, {from: 1450, to: 1500, witnesses: 6});
function millis(t) {
  return [Math.floor(t / 500) % 2 === 0 ? 67 : 0,
    t < 125 ? 0 : Math.floor((t - 125) / 200) % 2 === 0 ? 67 : 0,
    t < 50 ? 67 : Math.floor((t - 50) / 100) % 2 === 0 ? 0 : 67];
}
const electrical = Array.from({length: 91}, (_, i) => frame(1000 + i * 25, millis(i * 25)));
const paintTimes = Array.from({length: 103}, (_, i) => 200 + i * 20);
function millisProbe(delay, invert = false) {
  return probe(electrical, paintTimes.map(t => {
    const brightness = millis(t - delay);
    if (invert) brightness[1] = brightness[1] ? 0 : 67;
    return run([1000 + t], brightness);
  }));
}
check('Independent millis with real 25 ms ready spacing and 20 ms UI lag is accepted', millisProbe(20), {witnesses: 103});
check('D12 phase inversion is rejected despite unchanged per-channel period and duty', millisProbe(20, true), {reject: true});
check('100 ms publication lag is rejected', millisProbe(100), {reject: true});
const setupTimes = Array.from({length: 45}, (_, i) => 1060 + i * 10);
function setupCase(label, frames, reject) {
  const result = oracle.resetSetupPaintViolations({paintFrames: frames}, 1060, 1510, A);
  assert.equal(result.frames.length, 45);
  if (reject) assert(result.violations.length > 0, label);
  else assert.equal(result.violations.length, 0, label);
  cases.push({label, expected: reject ? 'REJECT' : 'ACCEPT', pass: true, frames: result.frames.length, violations: result.violations.length, first_violations: result.violations.slice(0, 2)});
  return result;
}
const correctSetup = setupTimes.map(at => ({at, brightness: A, imagesReady: true}));
setupCase('All setup interior frames with new physical 010 are accepted', correctSetup, false);
const stale = setupCase('Old fast mean in first 300 ms is rejected even with eight or more later good frames', setupTimes.map(at => ({at, brightness: at < 1300 ? [33, 33, 33] : A, imagesReady: true})), true);
assert(stale.frames.filter(row => row.brightness[0] === 0).length >= 8);
setupCase('One invalid image frame in setup interior is rejected', correctSetup.map((row, i) => i === 10 ? {...row, imagesReady: false} : row), true);
setupCase('One wrong channel in setup interior is rejected', correctSetup.map((row, i) => i === 10 ? {...row, brightness: [0, 0, 0]} : row), true);
const report = {
  schema: 'asa-electronics-independent-oracle-check-v1', reviewer: '/root/acceptance_review',
  reviewed_e2e_sha256: digest, source_helpers_sha256: crypto.createHash('sha256').update(fragments.join('\n')).digest('hex'),
  kind: 'Exact source helper extraction with independent analytic inputs; no browser or product run',
  publication_lag_ms: oracle.lag, model_wall_limit_ms: 250,
  count: cases.length, passed: cases.length, cases,
};
fs.writeFileSync(path.join(__dirname, 'r18-independent-oracle-check.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({reviewed_e2e_sha256: digest, cases: cases.length, passed: cases.length, rejected_mutation_cases: cases.filter(row => row.expected === 'REJECT').length}, null, 2));
