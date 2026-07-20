#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const file = 'docs/project-map/viewer.html';
const text = readFileSync(file, 'utf8');

const requiredFragments = [
  'Простой режим',
  'Технический режим',
  'Что делает бот',
  'Следующий этап',
  'Путь разработки',
  'Текущий этап',
  'Кабинеты и классы',
  'Проекты и модули',
  'Электроника',
  'Детский доступ и задания',
  'Полная техническая карта',
  "fetch('project-map.yaml'",
  "fetch('../delivery/EXECUTION_MANIFEST.yaml'",
  'map.project.current_focus',
  'manifestOrder',
  'mapOrder',
  "'TASK-PORTAL-001':'Кабинет педагога и классы'",
  "'TASK-PROJECT-SHELL-001':'Универсальные проекты'",
  "'TASK-ELECTRONICS-ALPHA-001':'Первая электронная лаборатория'",
];

const failures = [];
for (const fragment of requiredFragments) {
  if (!text.includes(fragment)) failures.push(`missing fragment: ${fragment}`);
}

const ids = [...text.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
if (duplicateIds.length > 0) failures.push(`duplicate HTML ids: ${duplicateIds.join(', ')}`);

if (!text.includes("mode='simple'")) failures.push('simple mode is not the default');
if (!text.includes("if(JSON.stringify(manifestOrder)!==JSON.stringify(mapOrder))")) {
  failures.push('manifest/project-map queue equality check is missing');
}
if (/current_focus\s*[:=]\s*['\"]TASK-/.test(text)) {
  failures.push('current focus appears to be hardcoded in viewer.html');
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  console.error(`owner-view contract FAIL (${failures.length})`);
  process.exit(1);
}

console.log(
  `owner-view contract PASS (${ids.length} unique HTML ids; dynamic map + manifest loading; simple mode default)`,
);
