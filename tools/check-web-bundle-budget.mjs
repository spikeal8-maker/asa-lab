import { readdir, stat } from 'node:fs/promises';
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
  // MATH-1 moved stamping, operating-point observations and authoritative
  // terminal currents behind DeviceModel. The measured slices total 208061
  // bytes (+1.50% from 204980); keep a narrow hard ceiling instead of disabling it.
  { label: 'electronics editor', prefix: 'SchematicEditor-', maximum: 208_500 },
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

if (failed) process.exit(1);
