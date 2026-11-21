'use strict';
const assert = require('node:assert/strict');
const pm = require('./index.js');

// The parent owns the hard wall-clock deadline and memory budget. Never run
// these checks directly in test.cjs, even when a fixed version seems fast.
process.once('message', cases => {
  try {
    assert.ok(Array.isArray(cases) && cases.length <= 100);
    for (const { pattern, options = {}, parseOptions = options, input, tamperOutput } of cases) {
      assert.ok(typeof pattern === 'string' && pattern.length <= 2048);
      assert.ok(typeof input === 'string' && input.length <= 256);
      const state = pm.parse(pattern, parseOptions);
      const clone = JSON.parse(JSON.stringify(state));
      if (tamperOutput !== undefined) {
        state.output = tamperOutput;
        clone.output = tamperOutput;
      }
      const checks = [
        ['matcher', () => pm(pattern, options)(input)],
        ['makeRe', () => pm.makeRe(pattern, options).test(input)],
        ['compileRe', () => pm.compileRe(state, options).test(input)],
        ['state matcher', () => pm(state, options)(input)],
        ['serialized compileRe', () => pm.compileRe(clone, options).test(input)],
        ['serialized matcher', () => pm(clone, options)(input)],
        ['compiled source', () => pm.toRegex(pm.compileRe(state, options, true), options).test(input)]
      ];
      for (const [name, check] of checks) assert.equal(check(), false, name + ': ' + pattern);
    }
    process.exit(0);
  } catch (error) {
    process.stderr.write(String(error));
    process.exit(1);
  }
});
