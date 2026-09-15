import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);

const mode = args[0];
const base = mode === '--changed' ? args[1] : null;
if ((mode !== '--changed' && mode !== '--full') || (mode === '--changed' && !base)) {
  console.error('Usage: pnpm games:hygiene --changed <base> | pnpm games:hygiene --full');
  process.exit(2);
}

const GAME_SCOPE = [
  /^contexts\/(games|checkers|chess|chess-live)\//,
  /^apps\/web\/src\/(games|checkers|chess)\//,
  /^apps\/api\/src\/(games|checkers|chess)/,
  /^tests\/(games|checkers|chess|chess-live)\//,
  /^e2e\/(games|checkers|chess)/,
  /^docs\/product\/games-platform\//,
  /^docs\/product\/ASA_(CHECKERS|CHESS)/,
  /^migrations\/\d+_.*(games|checkers|chess)/i,
  /^tools\/games-/,
];

const GRANDFATHERED_HARD = new Set([
  'apps/web/src/checkers/CheckersModuleExperience.tsx',
  'apps/web/src/checkers/checkers.css',
]);

const TRANSIENT_PATH =
  /(^|\/)(dist|build|out-tsc|tmp|coverage|playwright-report|test-results|reports\/games)(\/|$)|(^|\/)([^/]+\.(bak|old|orig|tmp|log)|[^/]+~)$/i;
const SOURCE_EXT = /\.(?:ts|tsx|js|mjs|cjs|py)$/;
const STYLE_EXT = /\.(?:css|scss)$/;
const TEST_PATH = /(^|\/)(testing|tests|e2e)(\/|$)|\.(?:spec|test)\.[cm]?[jt]sx?$/;

function git(argv, options = {}) {
  return execFileSync('git', argv, {
    cwd: root,
    encoding: options.encoding ?? 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 32 * 1024 * 1024,
  });
}

function inScope(file) {
  return GAME_SCOPE.some((pattern) => pattern.test(file));
}

function classify(file) {
  if (file.endsWith('.sql'))
    return { kind: 'sql', target: 32 * 1024, review: 32 * 1024, hard: null };
  if (TEST_PATH.test(file) && SOURCE_EXT.test(file)) {
    return { kind: 'test', target: 32 * 1024, review: 48 * 1024, hard: 64 * 1024 };
  }
  if (STYLE_EXT.test(file)) {
    return { kind: 'style', target: 24 * 1024, review: 36 * 1024, hard: 48 * 1024 };
  }
  if (SOURCE_EXT.test(file)) {
    return { kind: 'source', target: 24 * 1024, review: 32 * 1024, hard: 48 * 1024 };
  }
  if (file.startsWith('docs/product/games-platform/') && file.endsWith('.md')) {
    const name = path.basename(file);
    if (name === 'README.md' || name.endsWith('_AGENT_GUIDE.md')) {
      return { kind: 'compact-doc', target: 4 * 1024, review: 6 * 1024, hard: 8 * 1024 };
    }
    if (/ARCHITECTURE_FREEZE|ENGINEERING_HYGIENE|TECHNICAL_SPECIFICATION/.test(name)) {
      return { kind: 'master-doc', target: 12 * 1024, review: 16 * 1024, hard: 24 * 1024 };
    }
    return { kind: 'task-doc', target: 8 * 1024, review: 10 * 1024, hard: 12 * 1024 };
  }
  return null;
}

function currentBytes(file) {
  const absolute = path.join(root, file);
  return existsSync(absolute) ? readFileSync(absolute).byteLength : 0;
}

function baseBytes(file) {
  if (!base) return null;
  try {
    return Buffer.from(git(['show', `${base}:${file}`], { encoding: 'buffer' })).byteLength;
  } catch {
    return null;
  }
}

function addedText(file) {
  if (!base) return '';
  try {
    return git(['diff', '--unified=0', `${base}...HEAD`, '--', file])
      .split('\n')
      .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
      .map((line) => line.slice(1))
      .join('\n');
  } catch {
    return '';
  }
}

function changedFiles() {
  const rows = git(['diff', '--name-status', '--no-renames', `${base}...HEAD`]).trim();
  if (!rows) return [];
  return rows
    .split('\n')
    .map((line) => {
      const [status, file] = line.split('\t');
      return { status, file };
    })
    .filter(({ status, file }) => status !== 'D' && file && inScope(file));
}

function fullFiles() {
  const rows = git(['ls-files']).trim();
  if (!rows) return [];
  return rows
    .split('\n')
    .filter(inScope)
    .map((file) => ({ status: 'T', file }));
}

const entries = (mode === '--changed' ? changedFiles() : fullFiles()).sort((a, b) =>
  a.file.localeCompare(b.file),
);
const violations = [];
const warnings = [];
const garbage = [];
const legacyTouched = [];
const measurements = [];

for (const entry of entries) {
  const file = entry.file;
  const size = currentBytes(file);
  const before = baseBytes(file);
  const delta = before === null ? null : size - before;
  const budget = classify(file);
  const isNew = entry.status === 'A' || before === null;
  const grandfathered = GRANDFATHERED_HARD.has(file);

  measurements.push({ file, size, before, delta, budget });

  if (TRANSIENT_PATH.test(file)) {
    garbage.push(file);
    violations.push(`${file}: tracked transient/debug artifact path`);
  }

  if (budget?.hard && size > budget.hard) {
    if (grandfathered) {
      if (mode === '--changed') legacyTouched.push(`${file} (${before ?? '?'} -> ${size})`);
      if (mode === '--changed' && delta !== null && delta > 0) {
        violations.push(`${file}: grandfathered hard-limit file grew by ${delta} bytes`);
      }
    } else if (isNew || mode === '--full') {
      violations.push(`${file}: ${size} bytes exceeds ${budget.kind} hard limit ${budget.hard}`);
    }
  } else if (budget?.review && size > budget.review) {
    warnings.push(`${file}: ${size} bytes exceeds review threshold ${budget.review}`);
  }

  if (mode === '--changed' && before && delta !== null && delta > before * 0.25) {
    warnings.push(`${file}: grew more than 25% (${before} -> ${size})`);
  }

  if (mode === '--changed' && SOURCE_EXT.test(file)) {
    const added = addedText(file);
    if (/(^|\n)\s*(?:console\.log\s*\(|debugger\s*;?)/.test(added)) {
      violations.push(`${file}: newly added debug marker`);
    }
    for (const line of added.split('\n')) {
      if (/\b(?:TODO|FIXME)\b/.test(line) && !/(?:GP-|TASK-|#\d+)/.test(line)) {
        violations.push(`${file}: new TODO/FIXME lacks requirement/task id`);
        break;
      }
    }
  }
}

measurements.sort((a, b) => b.size - a.size || a.file.localeCompare(b.file));
const baseline = base ?? 'HEAD';
const openDebt =
  warnings.length +
  (mode === '--full'
    ? measurements.filter(
        (m) => GRANDFATHERED_HARD.has(m.file) && m.budget?.hard && m.size > m.budget.hard,
      ).length
    : 0);

console.log(`BASE_SHA=${baseline}`);
console.log(`FILES_SCANNED=${entries.length}`);
console.log(`NEW_HARD_VIOLATIONS=${violations.length}`);
console.log(`LEGACY_HOTSPOTS_TOUCHED=${legacyTouched.length ? legacyTouched.join(' | ') : 'none'}`);
console.log(`GARBAGE_FOUND=${garbage.length ? garbage.join(' | ') : 'none'}`);
console.log('EXTRACTIONS_DONE=0');
console.log(
  `OPEN_DEBT_WITH_REASON=${openDebt ? `${openDebt} review/baseline finding(s); see details` : 'none'}`,
);

for (const item of violations) console.log(`ERROR ${item}`);
for (const item of warnings) console.log(`WARN ${item}`);
for (const item of measurements.slice(0, 10)) {
  const deltaText = item.delta === null ? '' : ` delta=${item.delta >= 0 ? '+' : ''}${item.delta}`;
  console.log(`SIZE ${item.size} ${item.file}${deltaText}`);
}

const verdict = violations.length ? 'NEEDS_FIX' : 'PASS';
console.log(`VERDICT=${verdict}`);
if (violations.length) process.exitCode = 1;
