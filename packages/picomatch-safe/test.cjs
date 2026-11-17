'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { fork } = require('node:child_process');
const path = require('node:path');
const pm = require('./index.js');

test('public picomatch API and ordinary glob matching remain available', () => {
  assert.equal(typeof pm, 'function');
  for (const name of ['makeRe', 'parse', 'scan', 'isMatch', 'matchBase']) {
    assert.equal(typeof pm[name], 'function', name);
  }
  assert.equal(pm.isMatch('src/a.ts', '**/*.ts'), true);
  assert.equal(pm.isMatch('src/a.js', '**/*.ts'), false);
  assert.equal(pm.isMatch('src/foo.spec.ts', 'src/*.spec.ts'), true);
  assert.equal(pm.isMatch('app/index.css', '**/*.{js,css}'), true);
  assert.equal(pm.isMatch('ABC.js', '*.js', { nocase: true }), true);
  assert.equal(pm.isMatch('Abc', '+(Abc)'), true);
  assert.equal(pm.isMatch('AbcAbc', '+(Abc)'), true);
  assert.equal(pm.isMatch('+(*a)', '+(*a)'), true);
});

test('repeated extglob wildcard literalization cannot be disabled', () => {
  for (const expression of ['+(*)', '*(*a)', '+(*a)', '+(a*)', '+(*a|b)', '+(*?a)', '*(*?)']) {
    for (const options of [{}, { maxExtglobRecursion: false }, { maxExtglobRecursion: 4 }]) {
      const matcher = pm(expression, options);
      assert.equal(matcher('a'.repeat(72) + '!'), false, expression);
      const regex = pm.makeRe(expression, options);
      assert.equal(regex.test('a'.repeat(72) + '!'), false, expression);
    }
  }
});

test('unmatched brackets and nobracket must not bypass the repeated-star guard', () => {
  for (const { pattern, options, input } of [
    { pattern: '+([*a)', options: {}, input: '[a'.repeat(36) + '!' },
    { pattern: '+([*])', options: { nobracket: true }, input: '[]'.repeat(36) + '!' },
    { pattern: '+([*])', options: {}, input: '[]'.repeat(36) + '!' }
  ]) {
    assert.equal(pm(pattern, options)(input), false, pattern);
    assert.equal(pm.makeRe(pattern, options).test(input), false, pattern);
  }
});

test('ordinary stars and safe bounded groups stay valid', () => {
  assert.equal(pm.isMatch('abc', '+(abc)'), true);
  assert.equal(pm.isMatch('abcabc', '+(abc)'), true);
  assert.equal(pm.isMatch('foobar', 'foo*'), true);
  assert.equal(pm.isMatch('a*a', 'a[a*]a'), true);
});

test('dangerous repeated extglobs do not block the Node event loop', async () => {
  const patterns = [
    ...['+(*)', '+(*a)', '*(*a)', '+(*?a)', '+(a*)'].map(pattern => ({
      pattern, options: { maxExtglobRecursion: false }, input: 'a'.repeat(160) + '!'
    })),
    { pattern: '+([*a)', options: {}, input: '[a'.repeat(36) + '!' },
    { pattern: '+([*])', options: { nobracket: true }, input: '[]'.repeat(36) + '!' }
  ];
  // The test invokes only bounded strings and uses an external kill timeout
  // so that a regression cannot hang CI indefinitely.
  await new Promise((resolve, reject) => {
    const child = fork(path.join(__dirname, 'redos-child.cjs'), {
      stdio: 'ignore',
      env: { NODE_ENV: 'test' }
    });
    const guard = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('CVE-2026-112366: matcher blocked beyond bounded budget'));
    }, 2400);
    child.once('exit', (code, signal) => {
      clearTimeout(guard);
      if (code === 0 && !signal) resolve();
      else reject(new Error('Security child failed: exit ' + code + ' signal ' + signal));
    });
    child.send(patterns);
  });
});
