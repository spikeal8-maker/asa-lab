/*
 * Figma use_figma script: update outdated status text on the handoff page.
 * Run through use_figma. Do not approve any visuals in this operation.
 */
const page = figma.root.children.find((p) => p.name === '03 · Связь с GitHub');
if (!page) throw new Error('Handoff page not found');
await figma.setCurrentPageAsync(page);
await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
const status = page.children.find((n) => n.type === 'FRAME' && n.name === 'Delivery status');
if (!status) throw new Error('Delivery status frame not found');

const labels = [
  'ГОТОВО: 38 переменных Figma; 3 базовых компонента',
  'ГОТОВО: реестр 42 контекстов в GitHub; в Figma 35 строк',
  'НЕ ПРИНЯТО: пара главной, mobile 390px — визуальный FAIL',
  'НЕ ГОТОВО: массовый браузерный перенос и desktop/mobile QA',
  'НЕ ГОТОВО: обратная синхронизация Figma → GitHub'
];
const mutatedNodeIds = [];
for (let i = 0; i < labels.length; i++) {
  const node = status.findOne((n) => n.name === 'Status ' + i && n.type === 'TEXT');
  if (!node || node.type !== 'TEXT') throw new Error('Missing Status ' + i);
  node.characters = labels[i];
  node.fills = [{
    type: 'SOLID',
    color: i < 2
      ? { r: 24 / 255, g: 131 / 255, b: 83 / 255 }
      : { r: 167 / 255, g: 100 / 255, b: 0 }
  }];
  mutatedNodeIds.push(node.id);
}
return { mutatedNodeIds, actualReady: false, sourceManifest: 'docs/product/figma-ui-atlas-manifest.json' };
