import assert from 'node:assert/strict';
import test from 'node:test';
import { approvedPinnedScratchLicense } from '../dependency-license-choice.mjs';

test('only the pinned parser and explicit MIT choice for JSZip are approved', () => {
  assert.equal(
    approvedPinnedScratchLicense('AGPL-3.0-only', {
      name: 'scratch-parser',
      versions: ['6.0.1'],
    }),
    true,
  );
  assert.equal(
    approvedPinnedScratchLicense('(MIT OR GPL-3.0-or-later)', {
      name: 'jszip',
      versions: ['3.10.2'],
    }),
    true,
  );
  for (const entry of [
    null,
    {},
    { name: '__proto__', versions: ['6.0.1'] },
    { name: 'another-package', versions: ['6.0.1'] },
    { name: 'scratch-parser', versions: ['6.0.2'] },
    { name: 'scratch-parser', versions: ['6.0.1', '6.0.2'] },
    { name: 'scratch-parser', versions: [] },
    { name: 'scratch-parser', versions: '6.0.1' },
  ])
    assert.equal(approvedPinnedScratchLicense('AGPL-3.0-only', entry), false);
  assert.equal(
    approvedPinnedScratchLicense('GPL-3.0-or-later', {
      name: 'jszip',
      versions: ['3.10.2'],
    }),
    false,
  );
  assert.equal(
    approvedPinnedScratchLicense('unknown', {
      name: 'scratch-parser',
      versions: ['6.0.1'],
    }),
    false,
  );
});
