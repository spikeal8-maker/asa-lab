// Independent counterexamples for the rejected frozen e2e source.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const ts = require('/workspace/scratch/927b9b969e63/asa-lab-arduino/node_modules/typescript');
const filename = path.join(__dirname, 'frozen-e2e-source.txt');
const source = fs.readFileSync(filename, 'utf8');
const sourceSha256 = crypto.createHash('sha256').update(source).digest('hex');
assert.equal(sourceSha256, 'd067f102d16f81390a92d68ebdc2c91ffa237dc1335503b7f92c93d9b8f751b4');
const tree = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const names = new Set(['blinkWallMetrics', 'paintEdges', 'validTemporalPaint']);
const parts = tree.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name?.text)).map(node => node.getText(tree));
assert.equal(parts.length, 3);
const js = ts.transpileModule(parts.join('\n'), {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText;
const {blinkWallMetrics, paintEdges, validTemporalPaint} = new Function(js + '\nreturn {blinkWallMetrics,paintEdges,validTemporalPaint};')();
const eventTimes = new Set([0]);
for (let t = 500; t <= 2250; t += 500) eventTimes.add(t);
for (let t = 125; t <= 2250; t += 200) eventTimes.add(t);
for (let t = 50; t <= 2250; t += 100) eventTimes.add(t);
function physical(t) {
  return [1 - Math.floor(t / 500) % 2,
    t < 125 ? 0 : 1 - Math.floor((t - 125) / 200) % 2,
    t < 50 ? 1 : Math.floor((t - 50) / 100) % 2];
}
function receipt(t, values, frames = 2, lastAt = t + 16) {
  const brightness = values.map(value => value === 1 ? 67 : value);
  return {first: {at: t + 16, previousFrameAt: t, stablePreviousFrame: true, brightness,
    images: brightness.map(value => ({decoded: true, visible: true, unoccluded: true, opacity: 1, lit: value > 0}))}, lastAt, frames, maxGapMs: 16};
}
const runs = [...eventTimes].sort((a, b) => a - b).map(t => {
  const vector = physical(t); vector[1] = 1 - vector[1]; return receipt(t + 10, vector);
});
const perLed = [500, 200, 100].map((halfMs, index) => {
  const visible = paintEdges(runs, index);
  const start = index === 2 ? visible.findIndex((row, i) => row.level === 0 && i > 0) : 0;
  const measured = blinkWallMetrics(visible.slice(start), halfMs);
  const highs = visible.slice(start).filter(row => row.level === 1);
  const periodMs = (highs.at(-1).at - highs[0].at) / (highs.length - 1);
  const passed = measured.cycles >= 2 && measured.halves.every(half => half >= halfMs * .5 && half <= halfMs * 1.5) && measured.duty >= .45 && measured.duty <= .55 && periodMs >= halfMs * 2 * .9 && periodMs <= halfMs * 2 * 1.1;
  return {id: `led${index}`, inverted: index === 1, cycles: measured.cycles, duty: measured.duty, halves: measured.halves, periodMs, original_new_paint_assertions_passed: passed};
});
const vectors = [...new Set(runs.map(row => row.first.brightness.map(value => Number(value > 0)).join('')))];
const vectorsPassed = ['101', '100', '110', '111', '000'].every(vector => vectors.includes(vector));
const wrong = receipt(25, [33, 33, 33], 18, 310);
const correct = receipt(325, [0, 67, 0], 10, 475);
const allSetup = validTemporalPaint({paintRuns: [wrong, correct]}, 25, 500);
const acceptedSetup = allSetup.filter(run => run.first.brightness[0] === 0 && run.first.brightness[1] > 60 && run.first.brightness[2] === 0);
const result = {
  reviewed_e2e_sha256: sourceSha256,
  method: 'Exact three frozen helper bodies with analytic paint counterexamples. Electrical checks remain unchanged and correct. No browser or product execution.',
  phase_inversion: {paint_delay_ms: 10, perLed, vectors, vectors_assertions_passed: vectorsPassed, false_pass: perLed.every(row => row.original_new_paint_assertions_passed) && vectorsPassed},
  reset_stale_mean: {wrong_vector: [33, 33, 33], wrong_window_ms: [25, 310], correct_vector: [0, 67, 0], correct_window_ms: [325, 475], wrong_frames_discarded_by_positive_filter: wrong.frames, correct_frames_counted: acceptedSetup.reduce((sum, row) => sum + row.frames, 0), false_pass: acceptedSetup.length > 0 && acceptedSetup.reduce((sum, row) => sum + row.frames, 0) >= 8},
};
assert(result.phase_inversion.false_pass && result.reset_stale_mean.false_pass);
fs.writeFileSync(path.join(__dirname, 'original-false-pass.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
