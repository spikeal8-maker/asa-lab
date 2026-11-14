import fs from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const SUPPORTED_BRANCH = '3.24';
const SUPPORT_UNTIL = Date.parse('2028-06-01T00:00:00Z');
const MAX_AGE = 24 * 60 * 60 * 1000;

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

/** A clean source tree/base scan is not evidence for the assembled runtime. */
export function verifyRuntimeScan(report, { imageId, revision, now = Date.now() }) {
  requireValue(/^sha256:[a-f0-9]{64}$/.test(imageId ?? ''), 'Expected an exact Docker image ID');
  requireValue(/^[a-f0-9]{40}$/.test(revision ?? ''), 'Expected an exact source revision');
  requireValue(report?.SchemaVersion === 2, 'Unsupported or missing scanner schema');
  requireValue(report.ArtifactType === 'container_image', 'Expected a complete container scan');
  requireValue(report.Trivy?.Version === '0.76.1', 'Unexpected scanner version');
  requireValue(report.Metadata?.ImageID === imageId, 'Scan does not describe the built image');
  const config = report.Metadata?.ImageConfig;
  requireValue(
    config?.os === 'linux' && config.architecture === 'amd64',
    'Unexpected runtime platform',
  );
  requireValue(
    config.config?.Labels?.['org.opencontainers.image.revision'] === revision,
    'Scanned runtime does not carry the candidate revision',
  );
  const created = Date.parse(report.CreatedAt);
  requireValue(
    Number.isFinite(created) && created <= now + 5 * 60 * 1000 && created >= now - MAX_AGE,
    'Missing, future or stale scan timestamp',
  );
  const os = report.Metadata.OS;
  requireValue(os?.Family === 'alpine', 'Expected an identified Alpine runtime');
  requireValue(
    /^3\.24\.\d+$/.test(os.Name ?? ''),
    'Runtime is outside the supported Alpine branch',
  );
  requireValue(
    os.EOSL === undefined || typeof os.EOSL === 'boolean',
    'Malformed OS support status',
  );
  requireValue(
    os.EOSL !== true && now < SUPPORT_UNTIL,
    'Runtime operating system is end of support',
  );
  requireValue(Array.isArray(report.Results) && report.Results.length > 0, 'Missing scan results');
  const osResults = report.Results.filter((r) => r.Class === 'os-pkgs' && r.Type === 'alpine');
  requireValue(osResults.length === 1, 'Missing or ambiguous OS package scan');
  requireValue(
    Array.isArray(osResults[0].Packages) && osResults[0].Packages.length > 0,
    'Missing full OS package inventory; scan with --list-all-pkgs',
  );
  const counts = { UNKNOWN: 0, LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
  for (const result of report.Results) {
    requireValue(result && typeof result.Target === 'string', 'Malformed scanner result');
    if (result.Vulnerabilities === undefined) continue;
    requireValue(Array.isArray(result.Vulnerabilities), 'Malformed vulnerability collection');
    for (const finding of result.Vulnerabilities) {
      requireValue(
        finding &&
          Object.hasOwn(counts, finding.Severity) &&
          typeof finding.VulnerabilityID === 'string',
        'Unclassified or malformed vulnerability',
      );
      counts[finding.Severity] += 1;
    }
  }
  requireValue(counts.UNKNOWN === 0, 'Scanner returned unclassified vulnerabilities');
  requireValue(
    counts.HIGH === 0 && counts.CRITICAL === 0,
    `Runtime contains HIGH=${counts.HIGH}, CRITICAL=${counts.CRITICAL}; unfixed findings also block`,
  );
  return {
    imageId,
    revision,
    os: os.Name,
    supportedBranch: SUPPORTED_BRANCH,
    scannedAt: report.CreatedAt,
    counts,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [filename, revision, imageId] = process.argv.slice(2);
    if (!filename || !revision || !imageId || process.argv.length !== 5) {
      throw new Error('Usage: node verify-runtime-scan.mjs REPORT_JSON SOURCE_SHA IMAGE_ID');
    }
    const report = JSON.parse(fs.readFileSync(filename, 'utf8'));
    console.log(JSON.stringify(verifyRuntimeScan(report, { revision, imageId })));
  } catch (error) {
    console.error(`Scratch runtime security: FAIL: ${error.message}`);
    process.exitCode = 1;
  }
}
