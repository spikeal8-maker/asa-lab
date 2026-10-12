/*
 * Figma use_figma script: correct misleading "Desktop · Mobile" labels in
 * the 35-row atlas inventory. Must run via use_figma, not node.
 * Existing 35 rows are catalogue entries, not imported UI screens.
 */
const page = figma.root.children.find((p) => p.name === '02 · Атлас экранов');
if (!page) throw new Error('Atlas page not found');
await figma.setCurrentPageAsync(page);
await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
await figma.loadFontAsync({ family: 'Inter', style: 'Bold' });

const sectionNames = [
  '01  Публичный сайт и вход',
  '02  Общий портал',
  '03  Ученик и преподаватель',
  '04  Редакторы',
  '05  Администрирование'
];
const mutatedNodeIds = [];
const details = [];
for (const name of sectionNames) {
  const section = page.children.find((n) => n.type === 'FRAME' && n.name === name);
  if (!section) throw new Error('Missing catalogue section: ' + name);
  let count = 0;
  for (const node of section.findAll((n) => n.type === 'TEXT')) {
    if (node.type !== 'TEXT') continue;
    if (node.characters === 'Фреймы' || node.characters === 'Статус макета') {
      node.characters = 'Статус макета';
      mutatedNodeIds.push(node.id);
    }
    if (node.characters === 'Desktop · Mobile' ||
        node.characters === 'НЕ ПЕРЕНЕСЕНО' ||
        node.characters === 'ЧЕРНОВИК: desktop/mobile') {
      const isHomeRow = name === '02  Общий портал' && Math.abs(node.y - 100) <= 1;
      node.characters = isHomeRow ? 'ЧЕРНОВИК: desktop/mobile' : 'НЕ ПЕРЕНЕСЕНО';
      node.fontSize = isHomeRow ? 12 : 13;
      mutatedNodeIds.push(node.id);
      count++;
    }
  }
  details.push({ sectionName: name, rows: count });
}
if (details.reduce((sum, item) => sum + item.rows, 0) !== 35) {
  throw new Error('Atlas row count mismatch; inspect before further edits');
}
return { mutatedNodeIds, details, clarification: '35 catalogue rows; only one unapproved home draft pair exists' };
