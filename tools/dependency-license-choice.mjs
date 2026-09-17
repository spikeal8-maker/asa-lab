// Exact dependency-license choices for ASA's AGPL-3.0-only server build.
// No advisory exemptions or global permission for other copyleft packages.
// scratch-parser matches the pinned VM; JSZip is used under its MIT alternative.
export function approvedPinnedScratchLicense(license, entry) {
  const choice = {
    'scratch-parser': { license: 'AGPL-3.0-only', version: '6.0.1' },
    jszip: { license: '(MIT OR GPL-3.0-or-later)', version: '3.10.2' },
  };
  if (!entry || typeof entry.name !== 'string' || !Object.hasOwn(choice, entry.name)) return false;
  const expected = choice[entry.name];
  return (
    license === expected.license &&
    Array.isArray(entry.versions) &&
    entry.versions.length === 1 &&
    entry.versions[0] === expected.version
  );
}
