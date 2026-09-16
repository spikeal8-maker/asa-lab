import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

// Precompress public static text once at build time, never on each editor start.
// HTML is deliberately excluded: its parent-origin configuration may still change.
export function precompressStaticAssets(directory) {
  let files = 0;
  function visit(folder) {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const filename = path.join(folder, entry.name);
      if (entry.isDirectory()) visit(filename);
      else if (entry.isFile() && /\.(js|css|json|svg)$/.test(entry.name)) {
        const bytes = fs.readFileSync(filename);
        if (bytes.length < 1024) continue;
        const gzip = gzipSync(bytes, { level: 5 });
        if (gzip.length >= bytes.length) continue;
        fs.writeFileSync(`${filename}.gz`, gzip);
        files += 1;
      }
    }
  }
  visit(path.resolve(directory));
  return { files };
}

export function configureArtifact(directory, revision, parentOrigin) {
  if (!/^[a-f0-9]{40}$/.test(revision ?? '')) throw new Error('Exact Git SHA is required');
  const origin = new URL(parentOrigin);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== parentOrigin) {
    throw new Error('Parent must be an exact HTTP(S) origin');
  }
  const root = path.resolve(directory);
  const actual = fs.readFileSync(path.join(root, 'asa-commit.txt'), 'utf8').trim();
  if (actual !== revision) throw new Error('Artifact revision does not match requested Git SHA');
  for (const file of [
    'main.js',
    'editor.js',
    'storage.js',
    'protocol.js',
    'vendor/scratch/scratch-gui-standalone.js',
    'library-assets/library-assets-manifest.json',
    'licenses/scratch-editor-upstream.env',
    'asa-lab-scratch-wordmark.svg',
  ]) {
    if (!fs.statSync(path.join(root, file)).isFile())
      throw new Error(`Missing artifact file: ${file}`);
  }
  const index = path.join(root, 'index.html');
  const html = fs.readFileSync(index, 'utf8');
  const marker = '<meta name="asa-parent-origin" content="" />';
  if (html.split(marker).length !== 2) throw new Error('Expected one unconfigured parent origin');
  fs.writeFileSync(
    index,
    html.replace(marker, `<meta name="asa-parent-origin" content="${parentOrigin}" />`),
  );
  precompressStaticAssets(root);
  return { revision, parentOrigin };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(configureArtifact(...process.argv.slice(2))));
}
