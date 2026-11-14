/*
 * Figma use_figma repair script (NOT a Node CLI script).
 * Target file: vbRPijeR6IeTw1F8lkfsGr
 * Target page: 02 · Атлас экранов
 * Source context: apps/web/src/pages/CreatorHomePage.tsx
 *
 * Run through Figma.use_figma after the Starter MCP quota resets.
 * Each Figma API write returns mutated IDs. Re-running is safe: coordinates
 * are set to fixed target values and the missing link is created once.
 */
const page = figma.root.children.find((p) => p.name === '02 · Атлас экранов');
if (!page) throw new Error('Figma atlas page not found');
await figma.setCurrentPageAsync(page);
await figma.loadFontAsync({ family: 'Inter', style: 'Bold' });

const mobile = await figma.getNodeByIdAsync('8:48');
if (!mobile || mobile.type !== 'FRAME' ||
    mobile.name !== 'ASA / account / home / EMPTY / mobile 390 / SOURCE-STRUCTURE') {
  throw new Error('Guard mismatch: wrong home mobile frame or owner renamed it');
}
const feed = mobile.findOne((n) => n.name === 'Home module feed / empty state');
if (!feed || feed.type !== 'FRAME') throw new Error('Home feed not found');

const mutatedNodeIds = [];
for (const [name, x, y] of [
  ['Component instance / Создать программу', 6, 436],
  ['No programs', 7, 494],
  ['All projects', 6, 564],
  ['Section delimiter', 5, 623],
  ['Public gallery section', 6, 650],
  ['Gallery loading state', 6, 701],
  ['Knowledge section', 6, 767],
  ['Knowledge loading state', 6, 818],
]) {
  const node = feed.findOne((n) => n.name === name);
  if (!node) throw new Error('Missing expected element: ' + name);
  node.x = x;
  node.y = y;
  mutatedNodeIds.push(node.id);
}

let knowledge = feed.findOne((n) => n.name === 'Empty-state knowledge CTA');
if (!knowledge) {
  knowledge = figma.createText();
  knowledge.name = 'Empty-state knowledge CTA';
  knowledge.fontName = { family: 'Inter', style: 'Bold' };
  knowledge.fontSize = 14;
  knowledge.characters = 'Открыть знания';
  knowledge.fills = [{ type: 'SOLID', color: { r: 8 / 255, g: 119 / 255, b: 179 / 255 } }];
  feed.appendChild(knowledge);
}
if (knowledge.type !== 'TEXT') throw new Error('Unexpected knowledge CTA node type');
knowledge.x = 6;
knowledge.y = 10;
mutatedNodeIds.push(knowledge.id);
return { mutatedNodeIds, mobileNodeId: mobile.id, revision: 'repair-source-empty-state-v1' };
