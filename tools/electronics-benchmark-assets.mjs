import { readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';

const editorEntry = 'src/pages/SchematicEditor.tsx';
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function insideDirectory(directory, path) {
  const fromDirectory = relative(directory, path);
  return (
    fromDirectory !== '' &&
    fromDirectory !== '..' &&
    !fromDirectory.startsWith(`..${sep}`) &&
    !isAbsolute(fromDirectory)
  );
}

function manifestList(chunk, key, entry) {
  const list = chunk[key] ?? [];
  if (
    (chunk[key] !== undefined && !Array.isArray(chunk[key])) ||
    !list.every((item) => typeof item === 'string' && item.length > 0)
  )
    throw new Error(`Invalid manifest ${key}: ${entry}`);
  return list;
}

// CSS can move from an editor chunk into a shared chunk when another editor
// imports the same styles. Measure the emitted static dependency graph instead
// of assuming that a CSS filename has the JavaScript entry's prefix.
export function measureSchematicEditorCss(distDirectory) {
  const directory = realpathSync(resolve(distDirectory));
  const manifest = JSON.parse(readFileSync(resolve(directory, '.vite/manifest.json'), 'utf8'));
  if (!isRecord(manifest)) throw new Error('Invalid Vite manifest');

  const visited = new Set();
  const cssFiles = new Set();
  const pending = [editorEntry];
  while (pending.length > 0) {
    const entry = pending.pop();
    if (visited.has(entry)) continue;
    const chunk = Object.hasOwn(manifest, entry) ? manifest[entry] : undefined;
    if (!isRecord(chunk) || typeof chunk.file !== 'string' || chunk.file.length === 0)
      throw new Error(`Missing or invalid manifest dependency: ${entry}`);
    visited.add(entry);
    for (const file of manifestList(chunk, 'css', entry)) {
      if (!file.endsWith('.css') || file.includes('\\') || isAbsolute(file))
        throw new Error(`Invalid emitted CSS path: ${file}`);
      const path = resolve(directory, file);
      if (!insideDirectory(directory, path)) throw new Error(`Emitted CSS escapes dist: ${file}`);
      cssFiles.add(relative(directory, path).split(sep).join('/'));
    }
    // Dynamic destinations are not part of the editor's mandatory CSS payload.
    pending.push(...manifestList(chunk, 'imports', entry));
  }
  if (cssFiles.size === 0) throw new Error('SchematicEditor static CSS closure is empty');

  const files = [...cssFiles].sort().map((fileName) => {
    const path = realpathSync(resolve(directory, fileName));
    if (!insideDirectory(directory, path)) throw new Error(`Emitted CSS escapes dist: ${fileName}`);
    if (!statSync(path).isFile()) throw new Error(`Emitted CSS is not a file: ${fileName}`);
    const contents = readFileSync(path);
    return { fileName, bytes: contents.byteLength, gzipBytes: gzipSync(contents).byteLength };
  });
  return {
    measurement: 'static-css-closure',
    entry: editorEntry,
    fileName: files.map((file) => file.fileName).join(', '),
    bytes: files.reduce((sum, file) => sum + file.bytes, 0),
    gzipBytes: files.reduce((sum, file) => sum + file.gzipBytes, 0),
    files,
  };
}
