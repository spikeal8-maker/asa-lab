import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';

const ENTRY_REFERENCE = /\b(?:src|href)=["']([^"']+)["']/g;
const BUNDLED_REFERENCE =
  /["'(]((?:\/assets\/|\.\.?\/)[^"'()?#]+\.(?:js|css|json|png|webp|svg|woff2?|wasm))(?:[?#][^"'()]*)?["')]/g;
const FILE_REFERENCE = /\.(?:js|css|json|png|webp|svg|woff2?|wasm)$/i;

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function resolveInside(root, fromFile, reference) {
  const clean = reference.split(/[?#]/, 1)[0];
  if (!clean || clean.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(clean)) return null;
  const absolute = clean.startsWith('/')
    ? resolve(root, clean.slice(1))
    : resolve(dirname(fromFile), clean);
  const within = relative(root, absolute);
  if (within === '..' || within.startsWith(`..${sep}`) || resolve(root, within) !== absolute) {
    throw new Error(`Web artifact reference escapes dist: ${reference}`);
  }
  return absolute;
}

function requireFile(root, file, source) {
  if (!existsSync(file) || !statSync(file).isFile() || statSync(file).size === 0) {
    throw new Error(
      `Web artifact is incomplete: ${relative(root, file).replaceAll('\\', '/')} referenced by ${source}`,
    );
  }
}

export function verifyWebArtifact({ webDist, expectedRevision }) {
  const root = resolve(webDist);
  const indexFile = resolve(root, 'index.html');
  const metadataFile = resolve(root, 'build-metadata.json');
  requireFile(root, indexFile, 'release entry');
  requireFile(root, metadataFile, 'release entry');

  let metadata;
  try {
    metadata = JSON.parse(readFileSync(metadataFile, 'utf8'));
  } catch {
    throw new Error('Web build metadata is malformed');
  }
  if (
    typeof metadata?.revision !== 'string' ||
    typeof metadata?.builtAt !== 'string' ||
    Number.isNaN(Date.parse(metadata.builtAt))
  ) {
    throw new Error('Web build metadata is incomplete');
  }
  if (expectedRevision && metadata.revision !== expectedRevision) {
    throw new Error('Web artifact revision does not match the checkout');
  }

  const queue = [];
  const discovered = new Set([indexFile, metadataFile]);
  const index = readFileSync(indexFile, 'utf8');
  for (const match of index.matchAll(ENTRY_REFERENCE)) {
    if (!FILE_REFERENCE.test(match[1].split(/[?#]/, 1)[0])) continue;
    const file = resolveInside(root, indexFile, match[1]);
    if (file) queue.push({ file, source: 'index.html' });
  }

  while (queue.length > 0) {
    const { file, source } = queue.shift();
    requireFile(root, file, source);
    if (discovered.has(file)) continue;
    discovered.add(file);
    if (!/\.(?:js|css)$/i.test(file)) continue;
    const content = readFileSync(file, 'utf8');
    for (const match of content.matchAll(BUNDLED_REFERENCE)) {
      const referenced = resolveInside(root, file, match[1]);
      if (referenced) queue.push({ file: referenced, source: relative(root, file) });
    }
  }

  const files = [...discovered].sort().map((file) => ({
    path: relative(root, file).replaceAll('\\', '/'),
    bytes: statSync(file).size,
    sha256: sha256(file),
  }));
  return { metadata, files };
}
