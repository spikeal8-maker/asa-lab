'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { fork } = require('node:child_process');
const path = require('node:path');
const pm = require('./index.js');

// All adversarial expressions, including construction/parse/compile, stay in
// a killable child. A regression must not block the parent Node test runner.
const bounded = cases => new Promise((resolve, reject) => {
  let expired = false;
  let diagnostic = '';
  const child = fork(path.join(__dirname, 'redos-child.cjs'), {
    execArgv: ['--max-old-space-size=96'],
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    env: { ...process.env, NODE_ENV: 'test' }
  });
  child.stderr.on('data', data => {
    diagnostic = (diagnostic + String(data)).slice(-4096);
  });
  const guard = setTimeout(() => {
    expired = true;
    child.kill('SIGKILL');
  }, 2400);
  child.once('error', error => {
    clearTimeout(guard);
    reject(error);
  });
  child.once('exit', (code, signal) => {
    clearTimeout(guard);
    if (!expired && code === 0 && !signal) resolve();
    else reject(new Error('Security child failed: deadline=' + expired +
      ' exit=' + code + ' signal=' + signal + ' ' + diagnostic));
  });
  child.send(cases, error => {
    if (error) {
      clearTimeout(guard);
      child.kill('SIGKILL');
      reject(error);
    }
  });
});

test('public API, ordinary glob patterns and positive alternatives stay compatible', () => {
  assert.equal(typeof pm, 'function');
  for (const name of ['makeRe', 'parse', 'scan', 'isMatch', 'matchBase', 'compileRe']) {
    assert.equal(typeof pm[name], 'function', name);
  }
  assert.equal(pm.isMatch('src/a.ts', '**/*.ts'), true);
  assert.equal(pm.isMatch('src/a.js', '**/*.ts'), false);
  assert.equal(pm.isMatch('src/foo.spec.ts', 'src/*.spec.ts'), true);
  assert.equal(pm.isMatch('app/index.css', '**/*.{js,css}'), true);
  assert.equal(pm.isMatch('ABC.js', '*.js', { nocase: true }), true);
  assert.equal(pm.isMatch('AbcAbc', '+(Abc)'), true);
  assert.equal(pm.isMatch('+(*a)', '+(*a)'), true);
  assert.equal(pm.isMatch('foobar', '+(foo|bar)'), true);
  assert.equal(pm.isMatch('FOOBAR', '+(foo|bar)', { nocase: true }), true);
  assert.equal(pm.makeRe('+(foo|bar)', { flags: 'i' }).test('FOOBAR'), true);
  assert.equal(pm.isMatch('a*', '+(a\\*)'), true);
  assert.equal(pm.isMatch('a*a', 'a[a*]a'), true);
  assert.equal(pm.isMatch('src/index.ts', '**/*.@(js|ts)'), true);
  assert.equal(pm.isMatch('src/index.ts', '**/!(*.spec).ts'), true);
  assert.equal(pm.isMatch('src/a.spec.ts', '**/!(*.spec).ts'), false);
  assert.equal(pm.isMatch('aababb', '+(*(a)|*(b))'), true);
  assert.equal(pm.compileRe(pm.parse('*.TS'), { nocase: true }).test('file.ts'), true);
  assert.equal(pm(pm.parse('+(foo|bar)'), { flags: 'i' })('FOOBAR'), true);
});

test('repeated wildcard denial cannot be disabled', () => bounded(
  ['+(*)', '*(*a)', '+(*a)', '+(a*)', '+(*a|b)', '+(*?a)', '*(*?)']
    .flatMap(pattern => [{}, { maxExtglobRecursion: false }, { maxExtglobRecursion: 4 }]
      .map(options => ({ pattern, options, input: 'a'.repeat(72) + '!' })))
));

test('unmatched classes, escapes and recursion do not bypass the proof', () => bounded([
  { pattern: '+([*a)', options: {}, input: '[a'.repeat(36) + '!' },
  { pattern: '+([*])', options: { nobracket: true }, input: '[]'.repeat(36) + '!' },
  { pattern: '+([*])', options: {}, input: '[]'.repeat(36) + '!' },
  { pattern: '+(a\\*)', options: { unescape: true }, input: 'a'.repeat(36) + '!' },
  { pattern: '+(+(a))', options: { maxExtglobRecursion: 4 }, input: 'a'.repeat(36) + '!' },
  { pattern: '+(a+(a))', options: {}, input: 'a'.repeat(36) + '!' },
  { pattern: '+(a{a,aa})', options: {}, input: 'a'.repeat(36) + '!' },
  { pattern: '+(a+)', options: {}, input: 'a'.repeat(36) + '!' },
  { pattern: '+(a\\+)', options: { unescape: true }, input: 'a'.repeat(36) + '!' }
]));

test('alternation proof respects final matching flags and regex escapes', () => bounded([
  { pattern: '+(ab|abab)', input: 'ab'.repeat(36) + '!' },
  { pattern: '+([ab]|a)', input: 'a'.repeat(36) + '!' },
  { pattern: '+([a|a)', input: '[a'.repeat(36) + '!' },
  { pattern: '+(ab|ABAB)', options: { nocase: true }, input: 'ab'.repeat(36) + '!' },
  { pattern: '+(a|A)', options: { nocase: true }, input: 'a'.repeat(36) + '!' },
  { pattern: '+(ab|ABAB)', options: { flags: 'i' }, input: 'ab'.repeat(36) + '!' },
  { pattern: '+(k|K)', options: { flags: 'iu' }, input: 'k'.repeat(36) + '!' },
  { pattern: '+(ab|ABAB)', options: { nocase: 1 }, input: 'ab'.repeat(36) + '!' },
  { pattern: '+(a|A)', options: { nocase: 'true' }, input: 'a'.repeat(36) + '!' },
  { pattern: '+(a|A)', options: { flags: ['i'] }, input: 'a'.repeat(36) + '!' },
  { pattern: String.raw`+(\w|a)`, input: 'a'.repeat(36) + '!' },
  { pattern: String.raw`+(\x61|a)`, input: 'a'.repeat(36) + '!' },
  { pattern: '+(a|A)', parseOptions: {}, options: { nocase: true }, input: 'a'.repeat(36) + '!' },
  { pattern: '+(ab|ABAB)', parseOptions: {}, options: { flags: 'i' }, input: 'ab'.repeat(36) + '!' },
  { pattern: '+(k|K)', parseOptions: {}, options: { flags: 'iu' }, input: 'k'.repeat(36) + '!' }
]));

test('composition is rejected in ordinary and assertion contexts', () => bounded([
  ...['+(a)', '*(a)', '+(a|b)'].map(part => ({
    pattern: part.repeat(8), input: 'a'.repeat(64) + '!'
  })),
  { pattern: '+(a)' + '*a'.repeat(8), input: 'a'.repeat(64) + '!' },
  { pattern: '*a'.repeat(8) + '+(a)', input: 'a'.repeat(64) + '!' },
  { pattern: '?(a)'.repeat(8) + '+(a)', input: 'a'.repeat(64) + '!' },
  { pattern: '+(a)' + '@(a|aa)'.repeat(8), input: 'a'.repeat(64) + '!' },
  { pattern: '(?=' + '+(a)'.repeat(8) + 'b)a*', input: 'a'.repeat(64) + '!' },
  { pattern: '(?!' + '+(a)'.repeat(8) + 'b)a*', input: 'a'.repeat(64) + '!' },
  { pattern: '!(' + '+(a)'.repeat(8) + ')', input: 'a'.repeat(64) + '!' }
]));

test('raw regex syntax and mutable state output cannot bypass the boundary', () => bounded([
  { pattern: '(a+)+', input: 'a'.repeat(36) + '!' },
  { pattern: '((a|aa))+', input: 'a'.repeat(36) + '!' },
  { pattern: '@((a+)+)', input: 'a'.repeat(36) + '!' },
  { pattern: '@(a|aa)+', input: 'a'.repeat(36) + '!' },
  { pattern: '{a,aa}+', input: 'a'.repeat(36) + '!' },
  { pattern: '[a]+'.repeat(8), input: 'a'.repeat(64) + '!' },
  { pattern: '[a]+[a]+[a]+[a]+!', options: { regex: true }, input: 'a'.repeat(64) + '?' },
  { pattern: 'safe-file', tamperOutput: '(a+)+', input: 'a'.repeat(36) + '!' }
]));

test('serialized states are re-parsed and rejected states match only their literal spelling', () => {
  const state = pm.parse('*.ts');
  const clone = JSON.parse(JSON.stringify(state));
  assert.equal(pm.compileRe(clone).test('module.ts'), true);
  assert.equal(pm.compileRe(clone).test('module.js'), false);
  for (const expression of ['(a+)+', '+(a)+(a)', '+(a)*a']) {
    assert.equal(pm.makeRe(expression).test(expression), true);
    assert.equal(pm.compileRe(pm.parse(expression)).test(expression), true);
  }
  assert.throws(() => pm.compileRe({ output: '.*' }), /original string input/);
});
