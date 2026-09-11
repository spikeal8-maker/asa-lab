import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import YAML from 'yaml';

const ROOT = path.resolve(import.meta.dirname, '..');
const DOC_ROOT = 'docs/product/visual-programming';
const INDEX_PATH = `${DOC_ROOT}/COMPONENT_MAP.yaml`;
const TASK_ROOT = `${DOC_ROOT}/tasks`;
const errors = [];

const allowedStates = new Set(['implemented', 'planned', 'blocked']);
const allowedRisks = new Set(['low', 'medium', 'high', 'critical']);
const allowedOwnership = new Set([
  'asa',
  'upstream_config',
  'upstream_patch',
  'infrastructure',
  'cross_boundary',
  'shared_existing',
]);

const retiredActivePaths = [
  `${DOC_ROOT}/VSCR-AUDIT-2026-09-10-READINESS-NOTE.md`,
  `${DOC_ROOT}/VSCR-MASTER-V2-REPAIR-ADDENDUM-2026-09-10.md`,
  `${DOC_ROOT}/VSCR-IMPLEMENTATION-PACKAGES-M0.1-M1.md`,
  `${DOC_ROOT}/VSCR-IMPLEMENTATION-PACKAGE-M0.1-002-UPSTREAM-PIN.md`,
  `${DOC_ROOT}/VSCR-D0-001A-CANONICAL-ASA-BRAND-ASSET.md`,
  `${DOC_ROOT}/VSCR-D0-004A-CURRENT-AUTHORIZATION-RECHECK.md`,
];

const sizeBudgets = new Map([
  [`${DOC_ROOT}/README.md`, 7_000],
  [`${DOC_ROOT}/AGENT_GUIDE.md`, 9_000],
  [INDEX_PATH, 6_000],
]);

function absolute(relative) {
  return path.join(ROOT, relative);
}

function exists(relative) {
  return fs.existsSync(absolute(relative));
}

function readText(relative) {
  try {
    return fs.readFileSync(absolute(relative), 'utf8');
  } catch (error) {
    errors.push(`${relative}: cannot read (${error.message})`);
    return '';
  }
}

function readYaml(relative) {
  const text = readText(relative);
  if (!text) return null;
  try {
    return YAML.parse(text);
  } catch (error) {
    errors.push(`${relative}: invalid YAML (${error.message})`);
    return null;
  }
}

function normalizeHeading(value) {
  return String(value)
    .trim()
    .replace(/^§+\s*/, '')
    .replace(/^\d+(?:\.\d+)*[.)]?\s+/, '')
    .replace(/[`*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function markdownHeadings(relative) {
  const headings = new Set();
  for (const line of readText(relative).split(/\r?\n/)) {
    const match = line.match(/^#{1,6}\s+(.+?)\s*$/);
    if (match) headings.add(normalizeHeading(match[1]));
  }
  return headings;
}

function pathHasGlob(value) {
  return /[*?{}[\]]/.test(String(value));
}

function sourcePath(entry) {
  if (typeof entry === 'string') return entry;
  if (entry && typeof entry === 'object' && typeof entry.path === 'string') return entry.path;
  return null;
}

function requireExactExistingPath(relative, owner) {
  if (!relative) {
    errors.push(`${owner}: missing path`);
    return;
  }
  if (pathHasGlob(relative)) {
    errors.push(`${owner}: implemented routing must use an exact path, not glob ${relative}`);
    return;
  }
  if (!exists(relative)) errors.push(`${owner}: missing path ${relative}`);
}

function validateContract(contract, owner) {
  if (!contract || typeof contract !== 'object') {
    errors.push(`${owner}: contract entry must be a mapping`);
    return;
  }
  const contractPath = contract.path;
  const section = contract.section;
  requireExactExistingPath(contractPath, `${owner}.contract`);
  if (!contractPath || !exists(contractPath)) return;
  if (typeof section !== 'string' || !section.trim()) {
    errors.push(`${owner}: contract section is required`);
    return;
  }
  const headings = markdownHeadings(contractPath);
  const expected = normalizeHeading(section);
  if (!headings.has(expected)) {
    errors.push(
      `${owner}: section ${JSON.stringify(section)} is not an exact heading in ${contractPath}`,
    );
  }
}

for (const retired of retiredActivePaths) {
  if (exists(retired)) {
    errors.push(`${retired}: retired historical/addendum file must not remain in active Scratch docs`);
  }
}

for (const [relative, maximum] of sizeBudgets) {
  if (!exists(relative)) {
    errors.push(`${relative}: required routing document is missing`);
    continue;
  }
  const bytes = fs.statSync(absolute(relative)).size;
  if (bytes > maximum) {
    errors.push(`${relative}: ${bytes} bytes exceeds routing budget ${maximum}`);
  }
}

const index = readYaml(INDEX_PATH);
const indexComponents = index?.components;
const areas = index?.areas;
if (!index || typeof index !== 'object') errors.push(`${INDEX_PATH}: root must be a mapping`);
if (!areas || typeof areas !== 'object' || Array.isArray(areas)) {
  errors.push(`${INDEX_PATH}: areas must be a mapping`);
}
if (!indexComponents || typeof indexComponents !== 'object' || Array.isArray(indexComponents)) {
  errors.push(`${INDEX_PATH}: components must be a mapping`);
}

const cardPaths = new Set();
for (const [area, relative] of Object.entries(areas || {})) {
  if (typeof relative !== 'string') {
    errors.push(`${INDEX_PATH}: area ${area} must point to one card path`);
    continue;
  }
  const fullCard = `${DOC_ROOT}/${relative}`;
  requireExactExistingPath(fullCard, `${INDEX_PATH}.areas.${area}`);
  cardPaths.add(fullCard);
}

const keywordOwners = new Map();
for (const [id, route] of Object.entries(indexComponents || {})) {
  if (!route || typeof route !== 'object' || Array.isArray(route)) {
    errors.push(`${INDEX_PATH}: component ${id} route must be a mapping`);
    continue;
  }
  const allowedRouteKeys = new Set(['card', 'keywords']);
  for (const key of Object.keys(route)) {
    if (!allowedRouteKeys.has(key)) {
      errors.push(
        `${INDEX_PATH}: component ${id} duplicates non-routing field ${key}; keep state/risk/ownership in subsystem card`,
      );
    }
  }
  if (typeof route.card !== 'string') {
    errors.push(`${INDEX_PATH}: component ${id} missing card`);
  } else {
    const fullCard = `${DOC_ROOT}/${route.card}`;
    if (!cardPaths.has(fullCard)) {
      errors.push(`${INDEX_PATH}: component ${id} points outside declared areas: ${route.card}`);
    }
  }
  if (!Array.isArray(route.keywords) || route.keywords.length === 0) {
    errors.push(`${INDEX_PATH}: component ${id} needs human lookup keywords`);
  } else {
    for (const keyword of route.keywords) {
      const normalized = String(keyword).trim().toLowerCase();
      if (!normalized) {
        errors.push(`${INDEX_PATH}: component ${id} has empty keyword`);
        continue;
      }
      const previous = keywordOwners.get(normalized);
      if (previous && previous !== id) {
        errors.push(
          `${INDEX_PATH}: keyword ${JSON.stringify(normalized)} is ambiguous between ${previous} and ${id}`,
        );
      } else {
        keywordOwners.set(normalized, id);
      }
    }
  }
}

const cardComponents = new Map();
for (const cardPath of cardPaths) {
  const bytes = exists(cardPath) ? fs.statSync(absolute(cardPath)).size : 0;
  if (bytes > 6_000) errors.push(`${cardPath}: ${bytes} bytes exceeds subsystem-card budget 6000`);
  const card = readYaml(cardPath);
  if (!card || !Array.isArray(card.components)) {
    errors.push(`${cardPath}: components must be an array`);
    continue;
  }
  for (const component of card.components) {
    const id = component?.id;
    if (typeof id !== 'string' || !id) {
      errors.push(`${cardPath}: component without id`);
      continue;
    }
    if (cardComponents.has(id)) {
      errors.push(`${cardPath}: duplicate component id ${id}; already defined elsewhere`);
      continue;
    }
    cardComponents.set(id, { ...component, cardPath });
  }
}

for (const [id, route] of Object.entries(indexComponents || {})) {
  const component = cardComponents.get(id);
  if (!component) {
    errors.push(`${INDEX_PATH}: component ${id} not found in subsystem cards`);
    continue;
  }
  const expectedCard = `${DOC_ROOT}/${route.card}`;
  if (component.cardPath !== expectedCard) {
    errors.push(
      `${INDEX_PATH}: component ${id} routed to ${expectedCard} but defined in ${component.cardPath}`,
    );
  }
}
for (const id of cardComponents.keys()) {
  if (!(id in (indexComponents || {}))) {
    errors.push(`${INDEX_PATH}: missing routing entry for card component ${id}`);
  }
}

for (const [id, component] of cardComponents) {
  const owner = `${component.cardPath}:${id}`;
  if (!allowedStates.has(component.state)) errors.push(`${owner}: invalid state ${component.state}`);
  if (!allowedRisks.has(component.risk)) errors.push(`${owner}: invalid risk ${component.risk}`);
  if (!allowedOwnership.has(component.ownership)) {
    errors.push(`${owner}: invalid/missing ownership ${component.ownership}`);
  }
  if (typeof component.purpose !== 'string' || !component.purpose.trim()) {
    errors.push(`${owner}: purpose is required`);
  }
  if (!Array.isArray(component.contracts) || component.contracts.length === 0) {
    errors.push(`${owner}: at least one canonical contract is required`);
  } else {
    component.contracts.forEach((contract, indexValue) =>
      validateContract(contract, `${owner}.contracts[${indexValue}]`),
    );
  }
  for (const dependency of component.depends_on || []) {
    if (!cardComponents.has(dependency)) errors.push(`${owner}: unknown dependency ${dependency}`);
  }

  if (component.state === 'implemented') {
    if (!Array.isArray(component.sources) || component.sources.length === 0) {
      errors.push(`${owner}: implemented component needs exact sources`);
    }
    if (!Array.isArray(component.tests) || component.tests.length === 0) {
      errors.push(`${owner}: implemented component needs exact tests`);
    }
    for (const entry of component.sources || []) {
      requireExactExistingPath(sourcePath(entry), `${owner}.sources`);
    }
    for (const test of component.tests || []) requireExactExistingPath(test, `${owner}.tests`);
    if (component.planned_sources || component.planned_tests) {
      errors.push(`${owner}: implemented component must not keep planned source/test paths`);
    }
  }

  if (component.state === 'blocked' && (component.planned_sources || component.planned_tests)) {
    errors.push(`${owner}: blocked future component must not freeze speculative source/test paths`);
  }

  if (component.planned_sources || component.planned_tests) {
    if (component.state !== 'planned') {
      errors.push(`${owner}: planned source/test paths allowed only for planned component`);
    }
    if (typeof component.task_card !== 'string') {
      errors.push(`${owner}: planned source/test paths require an exact task_card`);
    } else {
      requireExactExistingPath(`${TASK_ROOT}/${component.task_card}`, `${owner}.task_card`);
    }
  }
}

const taskDir = absolute(TASK_ROOT);
if (fs.existsSync(taskDir)) {
  for (const name of fs.readdirSync(taskDir)) {
    if (!/^VSCR-.*\.md$/.test(name)) continue;
    const relative = `${TASK_ROOT}/${name}`;
    const text = readText(relative);
    if (text.includes('**Status:**')) {
      errors.push(`${relative}: task card must not duplicate readiness/status`);
    }
    if (!text.includes('## Goal')) errors.push(`${relative}: missing ## Goal`);
    if (!text.includes('## Bounded self-review')) {
      errors.push(`${relative}: missing ## Bounded self-review`);
    }
  }
}

const activeRoutingDocs = [
  `${DOC_ROOT}/README.md`,
  `${DOC_ROOT}/AGENT_GUIDE.md`,
  'docs/product/ASA_VISUAL_PROGRAMMING_SCRATCH_MASTER_SPEC.md',
  'docs/architecture/ADR-VSCR-001-SCRATCH-EDITOR-INTEGRATION.md',
  `${DOC_ROOT}/VSCR-M1-FORWARD-PLAN-2026-09-11.md`,
];
const forbiddenActiveStrings = [
  'asa-blocks-mark.svg',
  'VSCR-IMPLEMENTATION-PACKAGES-M0.1-M1.md',
  'VSCR-MASTER-V2-REPAIR-ADDENDUM-2026-09-10.md',
  'VSCR-AUDIT-2026-09-10-READINESS-NOTE.md',
  'VSCR-IMPLEMENTATION-PACKAGE-M0.1-002-UPSTREAM-PIN.md',
  'VSCR-D0-004A-CURRENT-AUTHORIZATION-RECHECK.md',
];
for (const relative of activeRoutingDocs) {
  if (!exists(relative)) continue;
  const text = readText(relative);
  for (const forbidden of forbiddenActiveStrings) {
    if (text.includes(forbidden)) {
      errors.push(`${relative}: references retired active-history/addendum ${forbidden}`);
    }
  }
}

if (errors.length) {
  console.error('Scratch documentation routing validation: FAIL');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('Scratch documentation routing validation: PASS');
console.log(`- components: ${cardComponents.size}`);
console.log(`- subsystem cards: ${cardPaths.size}`);
console.log('- retired competing docs/addenda absent from active tree');
console.log('- implemented source/test paths and canonical contract headings verified');
