import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const assetsDirectory = resolve('apps/web/dist/assets');
const files = await readdir(assetsDirectory, { withFileTypes: true });
const javascript = await Promise.all(
  files
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map(async (entry) => {
      const { size } = await stat(resolve(assetsDirectory, entry.name));
      return { name: entry.name, size };
    }),
);

const budgets = [
  { label: 'initial application', prefix: 'index-', maximum: 570_000 },
  // MATH-1 moved stamping, observations, diagnostics and terminal currents
  // behind DeviceModel, then added DC power-balance verification. The measured
  // slices total 208672 bytes (+1.80% from 204980); retain a narrow hard ceiling.
  { label: 'electronics editor', prefix: 'SchematicEditor-', maximum: 209_000 },
  { label: 'chess editor', prefix: 'ChessModuleExperience-', maximum: 255_000 },
  { label: 'checkers editor', prefix: 'CheckersModuleExperience-', maximum: 160_000 },
  { label: '3D editor', prefix: 'ThreeDEditor-', maximum: 2_900_000 },
  { label: 'Three.js vendor', prefix: 'three-vendor-', maximum: 620_000 },
  { label: 'Arduino editor', prefix: 'ArduinoCodePanel-', maximum: 2_000_000 },
];

let failed = false;
for (const budget of budgets) {
  const matches = javascript
    .filter((entry) => entry.name.startsWith(budget.prefix))
    .sort((left, right) => right.size - left.size);
  const asset = matches[0];
  if (!asset) {
    console.error(`BUNDLE BUDGET FAIL: ${budget.label} asset is missing`);
    failed = true;
    continue;
  }
  const status = asset.size <= budget.maximum ? 'PASS' : 'FAIL';
  console.log(`${status} ${budget.label}: ${asset.size}/${budget.maximum} bytes (${asset.name})`);
  if (status === 'FAIL') failed = true;
}

// The complete eager graph matters, not just index-*. Moving bytes into an
// eagerly imported chunk must not bypass the Home startup budget. Dynamic
// destination/editor imports are deliberately excluded until navigated to.
const manifest = JSON.parse(await readFile(resolve('apps/web/dist/.vite/manifest.json'), 'utf8'));
const graph = new Set();
const visited = new Set();
function visit(key) {
  if (visited.has(key)) return;
  visited.add(key);
  const chunk = manifest[key];
  if (!chunk) throw new Error(`Missing manifest entry: ${key}`);
  graph.add(chunk.file);
  for (const css of chunk.css ?? []) graph.add(css);
  for (const dependency of chunk.imports ?? []) visit(dependency);
}
const entries = Object.entries(manifest).filter(([, chunk]) => chunk.isEntry);
if (entries.length !== 1) throw new Error('Expected one web entrypoint');
visit(entries[0][0]);
const initialBytes = (
  await Promise.all(
    [...graph].map(async (file) => (await stat(resolve('apps/web/dist', file))).size),
  )
).reduce((sum, size) => sum + size, 0);
// Baseline before Home splitting: 739822 decoded JS/CSS bytes, measured on
// the same production build. Preserve a material reduction, with headroom.
const initialMaximum = 600_000;
console.log(
  `${initialBytes <= initialMaximum ? 'PASS' : 'FAIL'} initial JS/CSS graph: ${initialBytes}/${initialMaximum} bytes (${graph.size} assets)`,
);
if (initialBytes > initialMaximum) failed = true;
if (failed) process.exit(1);
