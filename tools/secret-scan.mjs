#!/usr/bin/env node
// Baseline secret scan. Fails if a likely committed secret is found in tracked
// source. This is a foundation baseline, not a replacement for a dedicated
// secret-scanning service.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const PATTERNS = [
  { name: 'AWS access key id', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'Private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  {
    name: 'Generic API secret assignment',
    re: /(?:api[_-]?key|secret|token)\s*[:=]\s*['"][A-Za-z0-9/+]{24,}['"]/i,
  },
];

const ALLOW_SUBSTRINGS = ['local-dev-password', 'strong-password', 'jwt-or-session-token'];

function trackedFiles() {
  const output = execSync('git ls-files', { encoding: 'utf8' });
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((file) => !file.startsWith('tools/secret-scan.mjs'))
    .filter(
      (file) =>
        /\.(ts|tsx|js|mjs|cjs|json|yaml|yml|env|sql|md)$/.test(file) ||
        file.endsWith('.env.example'),
    );
}

let findings = 0;
for (const file of trackedFiles()) {
  let content;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  const lines = content.split('\n');
  lines.forEach((line, index) => {
    if (ALLOW_SUBSTRINGS.some((allowed) => line.includes(allowed))) {
      return;
    }
    for (const pattern of PATTERNS) {
      if (pattern.re.test(line)) {
        console.error(`Potential secret (${pattern.name}) at ${file}:${index + 1}`);
        findings += 1;
      }
    }
  });
}

if (findings > 0) {
  console.error(`security:secrets FAIL (${findings} finding(s))`);
  process.exit(1);
}
console.log('security:secrets PASS (no committed secrets detected)');
