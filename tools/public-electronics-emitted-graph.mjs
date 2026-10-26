#!/usr/bin/env node
import process from 'node:process';
import console from 'node:console';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';

// Read production artifacts only. Module IDs and rendered sizes come from actual
// Rollup OutputChunks. The private source-map pipeline remains unchanged.
const root = process.cwd();
const dist = resolve(root, 'apps/web/dist');
const receiptPath = resolve(
  root,
  'reports/playwright/projects-publication/electronics-emitted-graph.json',
);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const receipt = {
  format: 'asa-public-electronics-emitted-graph-v1',
  revision,
  status: 'FAIL',
  scope:
    'PublicProjectsSurface and ElectronicsPublicationScene mandatory static closure plus checked viewer/public lazy imports. Known unrelated App router optional imports are reported separately, not asserted loaded. Shared helper presence does not imply mounted persistence.',
  mandatoryStaticEdges: [],
  checkedPublicLazyEdges: [],
  excludedOptionalEdges: [],
  chunks: [],
  sharedHelpers: [],
  violations: [],
};
function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}
function insideDist(file) {
  if (typeof file !== 'string' || !file.endsWith('.js')) throw Error('invalid emitted script path');
  const path = resolve(dist, file);
  const rel = relative(dist, path);
  if (rel === '..' || rel.startsWith(`..${sep}`) || resolve(dist, rel) !== path)
    throw Error('script escapes dist');
  return path;
}
const forbidden = [
  /apps\/web\/src\/pages\/SchematicEditor\.tsx$/,
  /apps\/web\/src\/electronics\/(?:use-electronics-workbench|use-workbench-project-state|workbench-autosave|workbench-runtime-controls|WorkbenchStage|WorkbenchSidebars|WorkbenchHeader|AlternateWorkbenchViews)(?:\.|\/)/,
  /apps\/web\/src\/electronics\/(?:.*worker.*|live-simulation|use-piezo-audio|ArduinoSerialMonitor|ArduinoCodePanel|ArduinoBlocksEditor)(?:\.|\/)/i,
  /apps\/web\/src\/electronics\/(?:arduino-blocks|arduino-block-ui|arduino-program-state|arduino-pin-inputs)(?:\.|\/)/,
  /contexts\/electronics\/(?:engine|simulation|module)\.ts$/,
  /contexts\/electronics\/domain\/(?:solver|simulation|arduino-.*runtime|models\/.*(?:runtime|transient-model|audio-model))(?:\.|\/)/,
  /apps\/web\/src\/modules\/(?:use-project|project-autosave|use-module-project)/,
];
try {
  if (
    !/^[a-f0-9]{40}$/.test(revision) ||
    (process.env.ASA_BUILD_REVISION && process.env.ASA_BUILD_REVISION !== revision)
  )
    throw Error('checkout revision mismatch');
  const metadataPath = resolve(dist, 'build-metadata.json');
  const metadata = readJson(metadataPath);
  if (metadata.revision !== revision) throw Error('build metadata revision mismatch');
  receipt.build = { ...metadata, metadataSha256: sha256(readFileSync(metadataPath)) };
  const manifestPath = resolve(dist, '.vite/manifest.json');
  const manifest = readJson(manifestPath);
  receipt.manifestSha256 = sha256(readFileSync(manifestPath));
  const indexPath = resolve(root, `apps/web/private-symbols/web-rendered-modules-${revision}.json`);
  const index = readJson(indexPath);
  if (index.format !== 'asa-web-rendered-modules-v1' || index.revision !== revision)
    throw Error('missing exact emitted rendered-module index');
  receipt.moduleIndexSha256 = sha256(readFileSync(indexPath));
  const entries = ['ElectronicsPublicationScene', 'PublicProjectsSurface'].map((name) => {
    const matches = Object.keys(manifest).filter((key) => key.endsWith(`/${name}.tsx`));
    if (matches.length !== 1 || !manifest[matches[0]].isDynamicEntry)
      throw Error(`missing unique ${name} dynamic entry`);
    return matches[0];
  });
  receipt.entries = entries;
  const queue = [...entries],
    seen = new Set();
  while (queue.length) {
    const key = queue.shift();
    if (seen.has(key)) continue;
    seen.add(key);
    const chunk = manifest[key];
    if (!chunk || typeof chunk.file !== 'string')
      throw Error(`missing manifest dependency: ${key}`);
    const js = readFileSync(insideDist(chunk.file));
    const emitted = index.assets[`/${chunk.file}`];
    if (
      !emitted ||
      !Array.isArray(emitted.modules) ||
      !emitted.modules.length ||
      !Array.isArray(emitted.zeroLengthModules)
    )
      throw Error(`missing emitted module evidence: ${key}`);
    if (emitted.sha256 !== sha256(js) || emitted.bytes !== js.length)
      throw Error(`emitted script hash mismatch: ${key}`);
    for (const module of emitted.modules) {
      if (
        typeof module.id !== 'string' ||
        !Number.isSafeInteger(module.renderedLength) ||
        module.renderedLength < 1
      )
        throw Error('invalid emitted rendered module');
      const normalized = module.id.replaceAll('\\', '/');
      if (forbidden.some((rule) => rule.test(normalized)))
        receipt.violations.push({ chunk: chunk.file, source: normalized });
      if (
        /(?:project-draft-storage|project-local-draft|commonjsHelpers)(?:\.|\/|$)/i.test(normalized)
      )
        receipt.sharedHelpers.push({
          chunk: chunk.file,
          source: normalized,
          interpretation:
            'Shared helper definition present; this alone does not demonstrate a mounted editor save hook.',
        });
    }
    for (const edge of ['imports', 'dynamicImports']) {
      if (
        !Array.isArray(emitted[edge]) ||
        (chunk[edge] !== undefined && !Array.isArray(chunk[edge]))
      )
        throw Error('invalid manifest edges');
      const manifestFiles = (chunk[edge] ?? []).map((dependency) => {
        if (!manifest[dependency]) throw Error(`missing manifest dependency: ${dependency}`);
        return manifest[dependency].file;
      });
      if (JSON.stringify([...manifestFiles].sort()) !== JSON.stringify([...emitted[edge]].sort()))
        throw Error(`manifest/emitted dependency mismatch: ${key}`);
      for (const dependency of chunk[edge] ?? []) {
        if (edge === 'imports') {
          receipt.mandatoryStaticEdges.push({ from: key, to: dependency });
          queue.push(dependency);
          continue;
        }
        if (!Array.isArray(emitted.dynamicImportOwners))
          throw Error('missing dynamic import ownership');
        const targetFile = manifest[dependency].file;
        const owners = emitted.dynamicImportOwners.filter(
          (owner) => owner.targetFile === targetFile,
        );
        // No provenance means conservative inclusion, never silent exclusion.
        const unrelated =
          owners.length > 0 &&
          owners.every(
            (owner) =>
              owner.importer === 'apps/web/src/App.tsx' &&
              /^apps\/web\/src\/(?:pages\/[A-Za-z]+Page\.tsx|ai\/AiChatWorkspace\.tsx|modules\/ModuleEditorHost\.tsx|admin\/AdminPage\.tsx)$/.test(
                owner.targetModule,
              ),
          );
        const evidence = {
          from: key,
          to: dependency,
          owners,
          reason: unrelated
            ? 'Known App bootstrap-router optional edge; not loaded by the public viewer path.'
            : owners.length
              ? 'Viewer/public or conservatively checked non-router lazy edge.'
              : 'Unknown owner: conservatively checked.',
        };
        if (unrelated) receipt.excludedOptionalEdges.push(evidence);
        else {
          receipt.checkedPublicLazyEdges.push(evidence);
          queue.push(dependency);
        }
      }
    }
    receipt.chunks.push({
      key,
      file: chunk.file,
      bytes: js.length,
      sha256: emitted.sha256,
      modules: emitted.modules,
      zeroLengthModules: emitted.zeroLengthModules,
      imports: chunk.imports ?? [],
      dynamicImports: chunk.dynamicImports ?? [],
    });
  }
  if (receipt.violations.length)
    throw Error('forbidden executable editor/runtime modules reachable');
  receipt.totalBytes = receipt.chunks.reduce((sum, chunk) => sum + chunk.bytes, 0);
  receipt.status = 'PASS';
} catch (cause) {
  receipt.error = cause.message;
  process.exitCode = 1;
}
mkdirSync(resolve(root, 'reports/playwright/projects-publication'), { recursive: true });
writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(
  `Electronics emitted graph: ${receipt.status}; ${receipt.chunks.length} chunks; ${receipt.totalBytes ?? 0} bytes; ${receipt.violations.length} forbidden sources; receipt ${relative(root, receiptPath)}`,
);
if (receipt.error) console.error(receipt.error);
