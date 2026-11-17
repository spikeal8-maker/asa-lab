'use strict';
const pm = require('./index.js');
process.once('message', cases => {
  try {
    for (const { pattern, options, input } of cases) {
      const match = pm(pattern, options);
      if (match(input) || pm.makeRe(pattern, options).test(input)) {
        throw new Error('dangerous matcher generated for ' + pattern);
      }
    }
    process.exit(0);
  } catch (error) {
    process.stderr.write(String(error));
    process.exit(1);
  }
});
