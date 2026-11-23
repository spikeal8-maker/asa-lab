import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyRuntimeScan } from '../security/verify-runtime-scan.mjs';

const imageId = `sha256:${'a'.repeat(64)}`;
const revision = 'b'.repeat(40);
const now = Date.parse('2026-11-02T12:00:00Z');
const options = { imageId, revision, now };

function cleanReport() {
  return {
    SchemaVersion: 2,
    ArtifactType: 'container_image',
    CreatedAt: '2026-11-02T11:59:00Z',
    Trivy: { Version: '0.76.1' },
    Metadata: {
      ImageID: imageId,
      OS: { Family: 'alpine', Name: '3.24.3' },
      ImageConfig: {
        os: 'linux',
        architecture: 'amd64',
        config: { Labels: { 'org.opencontainers.image.revision': revision } },
      },
    },
    Results: [
      {
        Target: 'runtime (alpine 3.24.3)',
        Class: 'os-pkgs',
        Type: 'alpine',
        Packages: [{ Name: 'musl' }],
      },
    ],
  };
}

test('accepts a fresh, complete runtime scan bound to the exact built bytes and source', () => {
  const summary = verifyRuntimeScan(cleanReport(), options);
  assert.equal(summary.imageId, imageId);
  assert.equal(summary.counts.CRITICAL, 0);
});

test('a clean base image or another source revision cannot stand in for the candidate', () => {
  const wrongImage = cleanReport();
  wrongImage.Metadata.ImageID = `sha256:${'c'.repeat(64)}`;
  assert.throws(() => verifyRuntimeScan(wrongImage, options), /built image/);
  const wrongSource = cleanReport();
  wrongSource.Metadata.ImageConfig.config.Labels['org.opencontainers.image.revision'] = 'd'.repeat(
    40,
  );
  assert.throws(() => verifyRuntimeScan(wrongSource, options), /candidate revision/);
});

test('EOSL and unsupported OS branches fail even when findings are empty', () => {
  for (const os of [
    { Family: 'alpine', Name: '3.24.3', EOSL: true },
    { Family: 'alpine', Name: '3.21.3' },
    { Family: 'unknown' },
  ]) {
    const report = cleanReport();
    report.Metadata.OS = os;
    assert.throws(() => verifyRuntimeScan(report, options));
  }
  assert.throws(() =>
    verifyRuntimeScan(cleanReport(), { ...options, now: Date.parse('2028-06-02') }),
  );
});

test('absent inventories and malformed scanner reports never become a clean result', () => {
  for (const mutate of [
    (r) => {
      delete r.Results;
    },
    (r) => {
      r.Results = [];
    },
    (r) => {
      delete r.Results[0].Packages;
    },
    (r) => {
      r.SchemaVersion = 999;
    },
    (r) => {
      r.Metadata.OS.EOSL = 'false';
    },
    (r) => {
      r.Results[0].Vulnerabilities = null;
    },
  ]) {
    const report = cleanReport();
    mutate(report);
    assert.throws(() => verifyRuntimeScan(report, options));
  }
});

test('HIGH and CRITICAL in any language target block, including unfixed vulnerabilities', () => {
  for (const Severity of ['HIGH', 'CRITICAL']) {
    const report = cleanReport();
    report.Results.push({
      Target: 'embedded package',
      Class: 'lang-pkgs',
      Type: 'node-pkg',
      Vulnerabilities: [{ Severity, VulnerabilityID: 'CVE-fixture' }],
    });
    assert.throws(() => verifyRuntimeScan(report, options), /unfixed findings also block/);
  }
});

test('stale, missing or future scans cannot reuse a previous clean receipt', () => {
  for (const CreatedAt of [undefined, 'bad-date', '2026-10-30T12:00:00Z', '2026-11-03T12:00:00Z']) {
    assert.throws(() => verifyRuntimeScan({ ...cleanReport(), CreatedAt }, options), /timestamp/);
  }
});

test('malformed and unclassified findings fail rather than disappearing from counts', () => {
  for (const finding of [
    { Severity: 'UNKNOWN', VulnerabilityID: 'CVE-fixture' },
    { Severity: 'critical', VulnerabilityID: 'CVE-fixture' },
    { Severity: 'LOW' },
  ]) {
    const report = cleanReport();
    report.Results[0].Vulnerabilities = [finding];
    assert.throws(() => verifyRuntimeScan(report, options));
  }
});

test('lower-severity findings remain visible without being described as zero vulnerabilities', () => {
  const report = cleanReport();
  report.Results[0].Vulnerabilities = [{ Severity: 'MEDIUM', VulnerabilityID: 'CVE-fixture' }];
  assert.equal(verifyRuntimeScan(report, options).counts.MEDIUM, 1);
});
