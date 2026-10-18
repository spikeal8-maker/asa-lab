import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { digest } from './browser-error-symbols.mjs';

const [directory, manifestFile, revision] = process.argv.slice(2);
const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
if (
  !/^[a-f0-9]{40}$/.test(revision) ||
  manifest.revision !== revision ||
  manifest.format !== 'asa-web-symbol-digests-v1'
)
  throw new Error('Manifest revision mismatch');
if (
  JSON.parse(readFileSync(resolve(directory, 'build-metadata.json'), 'utf8')).revision !== revision
)
  throw new Error('Runtime revision mismatch');
const actual = {};
function inspect(path, prefix = '') {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const name = `${prefix}/${entry.name}`;
    const file = resolve(path, entry.name);
    if (entry.isDirectory()) inspect(file, name);
    else {
      if (name.endsWith('.map')) throw new Error('Source map leaked to runtime');
      if (name.endsWith('.js')) {
        const bytes = readFileSync(file);
        if (bytes.includes(Buffer.from('sourceMappingURL=')))
          throw new Error('Map URL leaked to runtime');
        actual[name] = digest(bytes);
      }
    }
  }
}
inspect(directory);
// Vite can copy public JS verbatim. Every generated JS in the map manifest must
// match runtime; every hashed asset chunk must be represented by this manifest.
for (const [script, hash] of Object.entries(manifest.assets))
  if (actual[script] !== hash) throw new Error('Runtime/symbol generated digest mismatch');
for (const script of Object.keys(actual))
  if (
    /^\/assets\/.+-[A-Za-z0-9_-]{8,16}\.js$/.test(script) &&
    !Object.hasOwn(manifest.assets, script)
  )
    throw new Error('Missing chunk map');
if (!Object.keys(manifest.assets).length) throw new Error('Empty symbol manifest');
console.info(
  JSON.stringify({ revision, matchedChunks: Object.keys(manifest.assets).length, publicMaps: 0 }),
);
