#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const file = 'docs/project-map/viewer.html';
const text = readFileSync(file, 'utf8');

const requiredFragments = [
  'Простой режим',
  'Технический режим',
  'Что должно получиться',
  'Следующий этап',
  'Путь разработки',
  'Текущий этап',
  'Кабинеты и классы',
  'Проекты и модули',
  'Электроника',
  'Детский доступ и задания',
  'Полная техническая карта',
  "loadRequiredYaml('project-map.yaml'",
  "loadRequiredYaml('../delivery/EXECUTION_MANIFEST.yaml'",
  "loadOptionalYaml('../delivery/ASA_TARGET_PLATFORM_EXECUTION_PLAN.yaml')",
  "loadOptionalYaml('R0_TARGET_RELEASE_MAP.yaml')",
  'targetPlan.execution_order',
  'targetPlan.current_gate',
  'targetReleaseMap.execution_order',
  "sourceMode='target'",
  "sourceMode='legacy'",
  "R0:'R0 — Единый контракт и baseline'",
  "R1:'R1 — Аккаунт и личное пространство'",
  "R3:'R3 — Проекты и общий редактор'",
  "R4:'R4 — Электронная лаборатория'",
  "R5:'R5 — Класс и детский вход'",
  "R10:'R10 — Несколько учебных модулей'",
  'Старые TASK-* доступны только в техническом режиме как история',
  'После merge PR №43 viewer автоматически переключится на R0–R10',
];

const failures = [];
for (const fragment of requiredFragments) {
  if (!text.includes(fragment)) failures.push(`missing fragment: ${fragment}`);
}

const ids = [...text.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
if (duplicateIds.length > 0) failures.push(`duplicate HTML ids: ${duplicateIds.join(', ')}`);

if (!text.includes("mode='simple'")) failures.push('simple mode is not the default');
if (!text.includes("if(!buildTargetTasks())buildLegacyTasks()")) {
  failures.push('target-to-v1 fallback is missing');
}
if (!text.includes("JSON.stringify(targetPlan.execution_order)")) {
  failures.push('target execution-order equality check is missing');
}
if (!text.includes("JSON.stringify(targetReleaseMap.execution_order)")) {
  failures.push('target release-map equality check is missing');
}
if (!text.includes("map.project.current_focus=targetPlan.current_gate")) {
  failures.push('owner view does not derive current focus from target plan');
}
if (/current_focus\s*[:=]\s*['"](?:TASK-|R\d)/.test(text)) {
  failures.push('current focus appears to be hardcoded in viewer.html');
}
if (/targetPlan\.current_gate\s*=/.test(text)) {
  failures.push('viewer mutates targetPlan.current_gate');
}
if (!text.includes("sourceMode==='target'?targetGroups:legacyGroups")) {
  failures.push('presets do not switch between target and v1 models');
}
if (!text.includes("edge[type=\"next\"]")) {
  failures.push('strict release path is not visually distinguished');
}
if (!text.includes("kind:'release'")) {
  failures.push('target releases are not materialized as graph nodes');
}

const targetFriendlyCount = [...text.matchAll(/\bR(?:10|[0-9]):'R/g)].length;
if (targetFriendlyCount !== 11) {
  failures.push(`expected 11 target release friendly names, found ${targetFriendlyCount}`);
}

for (const port of ['3000', '3100', '5173']) {
  if (text.includes(`http://127.0.0.1:${port}`) || text.includes(`localhost:${port}`)) {
    failures.push(`viewer contains forbidden ASA Lab runtime URL on port ${port}`);
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  console.error(`owner-view contract FAIL (${failures.length})`);
  process.exit(1);
}

console.log(
  `owner-view contract PASS (${ids.length} unique HTML ids; target R0-R10 + v1 fallback; simple mode default)`,
);
