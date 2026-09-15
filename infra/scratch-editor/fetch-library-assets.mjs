import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const sourceRoot = process.argv[2];
const outputDir = process.argv[3];
if (!sourceRoot || !outputDir) {
  throw new Error('usage: node fetch-library-assets.mjs <scratch-source-root> <output-dir>');
}

const libraryFiles = ['sprites.json', 'backdrops.json', 'costumes.json', 'sounds.json'];
const assets = new Set();

function collect(value) {
  if (Array.isArray(value)) {
    for (const entry of value) collect(entry);
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (typeof value.md5ext === 'string') assets.add(value.md5ext);
  for (const entry of Object.values(value)) collect(entry);
}

for (const name of libraryFiles) {
  const file = path.join(sourceRoot, 'packages/scratch-gui/src/lib/libraries', name);
  collect(JSON.parse(await readFile(file, 'utf8')));
}
const names = [...assets].sort();
for (const name of names) {
  if (!/^[a-f0-9]{32}\.(svg|png|jpg|jpeg|wav|mp3)$/.test(name)) {
    throw new Error(`Invalid Scratch library asset name: ${name}`);
  }
}
await mkdir(outputDir, { recursive: true });
let cursor = 0;
let downloadedBytes = 0;
const failures = [];

async function fetchAsset(name) {
  const url = `https://cdn.assets.scratch.mit.edu/internalapi/asset/${name}/get/`;
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { 'user-agent': 'ASA-Lab-Scratch-Build/1.0' },
        signal: AbortSignal.timeout(30000),
        redirect: 'error',
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      const expected = name.slice(0, name.indexOf('.'));
      const actual = createHash('md5').update(bytes).digest('hex');
      if (actual !== expected) throw new Error(`md5 mismatch ${actual} != ${expected}`);
      await writeFile(path.join(outputDir, name), bytes);
      downloadedBytes += bytes.length;
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 400));
    }
  }
  failures.push(`${name}: ${String(lastError)}`);
}
async function worker() {
  while (true) {
    const current = cursor;
    cursor += 1;
    if (current >= names.length) return;
    await fetchAsset(names[current]);
    const completed = current + 1;
    if (completed % 100 === 0 || completed === names.length) {
      console.log(`Scratch library ${completed}/${names.length}`);
    }
  }
}

await Promise.all(Array.from({ length: 16 }, () => worker()));
if (failures.length > 0) {
  throw new Error(`Scratch library fetch failed (${failures.length}):\n${failures.join('\n')}`);
}

await writeFile(
  path.join(outputDir, 'library-assets-manifest.json'),
  `${JSON.stringify({ count: names.length, bytes: downloadedBytes, assets: names }, null, 2)}\n`,
  'utf8',
);
console.log(`Scratch library ready: ${names.length} assets, ${downloadedBytes} bytes`);
