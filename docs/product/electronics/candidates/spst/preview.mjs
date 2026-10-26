import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Resolve an already installed renderer; this script never installs dependencies.
const require = createRequire(import.meta.url);
const sharp = require('sharp');
const directory = path.dirname(fileURLToPath(import.meta.url));
const destination = process.argv[2];
if (!destination) throw new Error('Usage: node preview.mjs <absolute-output-directory>');
if (!path.isAbsolute(destination)) throw new Error('Output directory must be absolute');
const source = await fs.readFile(path.join(directory, 'switch.svg'), 'utf8');
const map = JSON.parse(await fs.readFile(path.join(directory, 'pin-map.json'), 'utf8'));
if (map.terminalCount !== 2 || map.provenance !== 'asa_independent_candidate') throw new Error('Invalid candidate metadata');
if (/<(?:script|foreignObject|image)\b|\bon\w+\s*=|(?:href|src)\s*=\s*["'](?!#)/i.test(source)) throw new Error('Unsafe SVG content');
const marker = '<use id="display-state" href="#state-off"/>';
if (source.split(marker).length !== 2) throw new Error('Expected one display-state marker');
await fs.mkdir(destination, { recursive: true });
const layers = [];
for (const [index, state] of ['off', 'on'].entries()) {
  const svg = source.replace(marker, `<use id="display-state" href="#state-${state}"/>`)
    .replace('candidate — OFF', `candidate — ${state.toUpperCase()}`);
  const png = await sharp(Buffer.from(svg)).resize(384, 416).png().toBuffer();
  await fs.writeFile(path.join(destination, `${state}.png`), png);
  layers.push({ input: png, left: index * 416 + 16, top: 48 });
}
const headings = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="832" height="48"><g font-family="sans-serif" font-size="22" font-weight="bold" fill="#263541" text-anchor="middle"><text x="208" y="32">OFF · open</text><text x="624" y="32">ON · latched closed</text></g></svg>');
await sharp({ create: { width: 832, height: 480, channels: 4, background: '#f2f4f6' } })
  .composite([...layers, { input: headings, left: 0, top: 0 }]).png()
  .toFile(path.join(destination, 'off-on.png'));
console.log(JSON.stringify({ output: destination, states: ['off.png', 'on.png'], pairedPreview: 'off-on.png', terminals: map.terminals }));
