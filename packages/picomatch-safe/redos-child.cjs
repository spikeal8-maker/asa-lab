'use strict';
const pm = require('./index.js');
process.once('message', patterns => {
  try {
    for (const pattern of patterns) {
      const match = pm(pattern, { maxExtglobRecursion: false });
      if (match('a'.repeat(160) + '!')) throw new Error('dangerous match');
    }
    process.exit(0);
  } catch (error) {
    process.stderr.write(String(error));
    process.exit(1);
  }
});
