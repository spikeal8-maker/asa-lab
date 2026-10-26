import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../../..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const parents = { left: '2e0f6d29e1b8150de5f8cdabcc83af20ff0b69a68f4de444c69b22c11a07d720', right: '8622c1ef205518170b1a615ade4287b60489d718e409ecf5184312167ad41b25' };
const removed = '    <rect x="11.14" y="5.75" width="0.80" height="3.55" rx="0.30"/>';
const normalize = text => text.replace(/\r\n/g, '\n');
const drawing = text => normalize(text).replace(/  <title>.*?<\/title>\n|  <desc>.*?<\/desc>\n|  <!--.*?-->\n/g, '');
const inputs = [];
for (const state of ['left', 'right']) {
  const sourcePath = path.join(root, 'apps/web/public/assets/electronics/owner-supplied', `switch-${state}.svg`);
  const bytes = await fs.readFile(sourcePath);
  assert.equal(sha(bytes), parents[state], `${state} protected source hash`);
  const audit = await fs.readFile(path.join(root, 'apps/web/public/assets/electronics/owner-audit/components/switch', `${state}.svg`));
  assert.equal(sha(audit), parents[state], `${state} protected audit hash`);
  const original = bytes.toString('utf8');
  assert.equal(original.split(removed).length, 2, 'exactly one right outer metal leg');
  const expected = original.replace(removed + '\r\n', '').replace(removed + '\n', '')
    .replace(`Slide switch SPDT 3 pin — ${state}`, `Slide switch SPST 2 pin — ${state}`)
    .replace(`Slide switch in ${state} position.`, `Owner-authorized two-terminal derivative in ${state} position; right outer leg removed.`)
    .replace('<!-- pin centers: 6.46, 9.00, 11.54 ; pitch 2.54 mm -->', '<!-- retained pin centers: left 6.46, common 9.00 ; pitch 2.54 mm -->');
  const outputPath = path.join(here, `${state}.svg`);
  if (process.argv.includes('--write')) await fs.writeFile(outputPath, normalize(expected));
  const derived = await fs.readFile(outputPath, 'utf8');
  assert.equal(normalize(derived), normalize(expected), 'exact deterministic derivation');
  const parentWithoutLeg = original.replace(removed + '\r\n', '').replace(removed + '\n', '');
  assert.equal(drawing(derived), drawing(parentWithoutLeg), 'all retained drawing nodes and attributes unchanged');
  assert.equal((derived.match(/<rect x="(?:6\.06|8\.60)" y="5\.75"/g) || []).length, 2, 'left and common legs retained');
  assert.ok(!derived.includes('x="11.14"'), 'right outer leg absent');
  assert.ok(!/<(?:script|foreignObject|image)\b|\bon\w+\s*=|(?:href|src)\s*=\s*["'](?!#)/i.test(derived), 'safe SVG');
  assert.equal(sha(await fs.readFile(sourcePath)), parents[state], 'protected source still identical');
  inputs.push({ state, original, derived });
  console.log(`${state}: parent=${parents[state]} derived=${sha(Buffer.from(derived))}; retained drawing equality PASS; pins=left/common only`);
}
const renderIndex = process.argv.indexOf('--render');
if (renderIndex !== -1) {
  const destination = process.argv[renderIndex + 1];
  assert.ok(destination && path.isAbsolute(destination), 'absolute render output directory required');
  const sharp = createRequire(import.meta.url)('sharp');
  await fs.mkdir(destination, { recursive: true });
  const layers = [];
  for (const [row, item] of inputs.entries()) {
    for (const [column, variant] of ['original', 'derived'].entries()) {
      const png = await sharp(Buffer.from(item[variant])).resize(576, 320).png().toBuffer();
      await fs.writeFile(path.join(destination, `${item.state}-${variant}.png`), png);
      layers.push({ input: png, left: column * 600 + 12, top: row * 368 + 44 });
    }
  }
  const labels = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="736"><g font-family="sans-serif" font-size="20" fill="#263541" text-anchor="middle"><text x="300" y="30">LEFT: original · 3 legs</text><text x="900" y="30">LEFT: derived · 2 legs · closed</text><text x="300" y="398">RIGHT: original · 3 legs</text><text x="900" y="398">RIGHT: derived · 2 legs · open</text></g></svg>');
  await sharp({ create: { width: 1200, height: 736, channels: 4, background: '#f2f4f6' } }).composite([...layers, { input: labels, left: 0, top: 0 }]).png().toFile(path.join(destination, 'original-derived-both-states.png'));
  console.log(`PREVIEW ${path.join(destination, 'original-derived-both-states.png')}`);
}
