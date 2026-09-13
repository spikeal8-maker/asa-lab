import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import YAML from 'yaml';

const root = process.cwd();
const docsRoot = 'docs/product/electronics';
const mapPath = `${docsRoot}/COMPONENT_MAP.yaml`;
const errors = [];
const allowedRisk = new Set(['low', 'medium', 'high', 'critical']);
const allowedOwnership = new Set(['asa', 'infrastructure', 'owner_asset', 'cross_boundary']);
const largeSourceBytes = 50_000;

function readYaml(repoPath) {
  const full = resolve(root, repoPath);
  if (!existsSync(full)) {
    errors.push(`missing file: ${repoPath}`);
    return null;
  }
  try {
    return YAML.parse(readFileSync(full, 'utf8'));
  } catch (error) {
    errors.push(
      `invalid yaml: ${repoPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

function isRepositoryPath(value) {
  return /^(AGENTS\.md|apps\/|contexts\/|docs\/|e2e\/|tools\/|tests\/|docker\/|compose[^/]*\.ya?ml)/.test(
    value,
  );
}

function splitAnchor(value) {
  const index = value.indexOf('#');
  return index < 0
    ? { path: value, anchor: null }
    : { path: value.slice(0, index), anchor: value.slice(index + 1) };
}

function pathExists(value) {
  const { path } = splitAnchor(value);
  if (!isRepositoryPath(path)) return true;
  const wildcard = path.indexOf('*');
  const candidate = wildcard >= 0 ? path.slice(0, wildcard).replace(/\/$/, '') : path;
  return existsSync(resolve(root, candidate));
}

function markdownSlug(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s_-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function markdownAnchors(repoPath) {
  const content = readFileSync(resolve(root, repoPath), 'utf8');
  const anchors = new Set();
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (match) anchors.add(markdownSlug(match[1]));
  }
  return anchors;
}

function validateContract(id, value) {
  if (typeof value !== 'string') {
    errors.push(`${id} contracts entry must be a string`);
    return;
  }
  if (!pathExists(value)) {
    errors.push(`${id} contracts path does not exist: ${value}`);
    return;
  }
  const { path, anchor } = splitAnchor(value);
  if (extname(path).toLowerCase() !== '.md') return;
  if (!anchor) {
    errors.push(`${id} markdown contract must name an exact heading: ${value}`);
    return;
  }
  if (!markdownAnchors(path).has(anchor)) {
    errors.push(`${id} markdown heading does not exist: ${value}`);
  }
}

function asArray(id, component, field) {
  const value = component?.[field];
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    errors.push(`${id} ${field} must be an array`);
    return [];
  }
  return value;
}

function explicitSourceFiles(component) {
  return asArray('component', component, 'sources').filter(
    (value) => typeof value === 'string' && !value.includes('*') && pathExists(value),
  );
}

function validateSymbols(id, component) {
  const sources = explicitSourceFiles(component);
  const symbols = asArray(id, component, 'symbols');
  const largeSources = sources.filter((source) => {
    if (!/\.(?:ts|tsx|js|mjs)$/.test(source)) return false;
    try {
      return statSync(resolve(root, source)).size > largeSourceBytes;
    } catch {
      return false;
    }
  });
  if (largeSources.length > 0 && symbols.length === 0) {
    errors.push(`${id} maps large source(s) without symbols: ${largeSources.join(', ')}`);
  }
  const contents = sources.map((source) => readFileSync(resolve(root, source), 'utf8'));
  for (const symbol of symbols) {
    if (typeof symbol !== 'string' || !symbol.trim()) {
      errors.push(`${id} symbols entries must be non-empty strings`);
      continue;
    }
    if (!contents.some((content) => content.includes(symbol))) {
      errors.push(`${id} symbol is not present in mapped sources: ${symbol}`);
    }
  }
}

function validateComponentFields(id, component) {
  if (!component || typeof component !== 'object') {
    errors.push(`${id} component card entry must be a mapping`);
    return;
  }
  if ('implementation_state' in component) {
    errors.push(`${id} must not duplicate readiness via implementation_state`);
  }
  if (!allowedRisk.has(component.risk)) errors.push(`${id} risk invalid: ${component.risk}`);
  if (!allowedOwnership.has(component.ownership)) {
    errors.push(`${id} ownership invalid: ${component.ownership}`);
  }
  for (const contract of asArray(id, component, 'contracts')) validateContract(id, contract);

  for (const source of asArray(id, component, 'sources')) {
    if (typeof source !== 'string') {
      errors.push(`${id} sources entry must be a string`);
    } else if (!pathExists(source)) {
      errors.push(`${id} sources path does not exist: ${source}`);
    }
  }

  for (const test of asArray(id, component, 'tests')) {
    if (typeof test !== 'string') {
      errors.push(`${id} tests entry must be a string`);
      continue;
    }
    if (test.includes('*')) errors.push(`${id} tests must be exact, not wildcard: ${test}`);
    if (!pathExists(test)) errors.push(`${id} tests path does not exist: ${test}`);
  }

  for (const dependency of asArray(id, component, 'dependencies')) {
    if (typeof dependency !== 'string') errors.push(`${id} dependency must be a string`);
  }
  for (const field of ['prerequisites', 'forbidden']) {
    for (const value of asArray(id, component, field)) {
      if (typeof value !== 'string') errors.push(`${id} ${field} entry must be a string`);
    }
  }
  validateSymbols(id, component);
}

function validateDependencyCycles(map, cards) {
  const graph = new Map();
  for (const [id, entry] of Object.entries(map.components ?? {})) {
    const card = cards.get(entry.card)?.card;
    graph.set(id, [...(card?.components?.[id]?.dependencies ?? [])]);
  }
  const visiting = new Set();
  const visited = new Set();
  function visit(id, stack) {
    if (visiting.has(id)) {
      const start = stack.indexOf(id);
      errors.push(`component dependency cycle: ${[...stack.slice(start), id].join(' -> ')}`);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    stack.push(id);
    for (const dependency of graph.get(id) ?? []) {
      if (graph.has(dependency)) visit(dependency, stack);
    }
    stack.pop();
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of graph.keys()) visit(id, []);
}

function validateActiveElectronicsTask() {
  const current = readYaml('docs/execution/current.yaml');
  if (!current) return;
  const lanes = [
    { id: current.primary_lane?.id, task: current.task },
    ...(Array.isArray(current.parallel_lanes) ? current.parallel_lanes : []),
  ];
  const electronics = lanes.find((lane) => lane?.id === 'electronics');
  const task = electronics?.task;
  if (!task || typeof task !== 'object') return;
  const taskId = String(task.id ?? '');
  if (!/^TASK-ELECTRONICS-EOPT-/.test(taskId)) return;
  if (!['in_progress', 'in_review'].includes(String(task.status))) return;

  const taskDir = resolve(root, docsRoot, 'tasks');
  const matches = readdirSync(taskDir)
    .filter((name) => name.endsWith('.md'))
    .filter((name) => readFileSync(resolve(taskDir, name), 'utf8').includes(taskId));
  if (matches.length !== 1) {
    errors.push(
      `active Electronics task ${taskId} must map to exactly one task card; matches=${matches.join(', ') || 'none'}`,
    );
  }
}

for (const required of [
  `${docsRoot}/START_HERE.md`,
  `${docsRoot}/AGENT_GUIDE.md`,
  `${docsRoot}/DEVELOPMENT_SPEC.md`,
  `${docsRoot}/ASA_ELECTRONICS_OPTIMIZATION_PLAN_V2.md`,
  `${docsRoot}/tasks/IMPLEMENTATION_TASK_TEMPLATE.md`,
  `${docsRoot}/tasks/MAINTENANCE_TASK_TEMPLATE.md`,
  `${docsRoot}/tasks/DESIGN_TASK_TEMPLATE.md`,
  `${docsRoot}/tasks/DEPLOYMENT_TASK_TEMPLATE.md`,
  `${docsRoot}/tasks/E-OPT-1A.md`,
]) {
  if (!existsSync(resolve(root, required))) {
    errors.push(`missing required routing document: ${required}`);
  }
}

const map = readYaml(mapPath);
const cards = new Map();
const cardComponentOwners = new Map();
if (map) {
  if ((map.rules?.card_owns ?? []).includes('implementation_state')) {
    errors.push('COMPONENT_MAP card_owns must not duplicate readiness via implementation_state');
  }

  for (const [area, relativeCard] of Object.entries(map.areas ?? {})) {
    const repoPath = `${docsRoot}/${relativeCard}`;
    const card = readYaml(repoPath);
    if (card) cards.set(relativeCard, { area, repoPath, card });
  }

  for (const [id, entry] of Object.entries(map.components ?? {})) {
    if (!entry || typeof entry !== 'object' || typeof entry.card !== 'string') {
      errors.push(`invalid component map entry: ${id}`);
      continue;
    }
    const loaded = cards.get(entry.card);
    if (!loaded) {
      errors.push(`component ${id} routes to unknown card: ${entry.card}`);
      continue;
    }
    if (!loaded.card.components?.[id]) {
      errors.push(`component ${id} missing from routed card: ${entry.card}`);
    }
  }

  for (const [relativeCard, loaded] of cards) {
    for (const [id, component] of Object.entries(loaded.card.components ?? {})) {
      if (cardComponentOwners.has(id)) {
        errors.push(
          `component ${id} duplicated in ${cardComponentOwners.get(id)} and ${relativeCard}`,
        );
      } else {
        cardComponentOwners.set(id, relativeCard);
      }
      const mapEntry = map.components?.[id];
      if (!mapEntry) {
        errors.push(`card component ${id} is missing from COMPONENT_MAP.yaml`);
      } else if (mapEntry.card !== relativeCard) {
        errors.push(
          `card component ${id} maps to ${mapEntry.card}, but is declared in ${relativeCard}`,
        );
      }
      validateComponentFields(id, component);
      for (const dependency of component?.dependencies ?? []) {
        if (typeof dependency === 'string' && !map.components?.[dependency]) {
          errors.push(`${id} depends on unmapped component: ${dependency}`);
        }
      }
    }
  }

  validateDependencyCycles(map, cards);
}

validateActiveElectronicsTask();

if (errors.length > 0) {
  console.error('Electronics agent routing validation: FAIL');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('Electronics agent routing validation: PASS');
console.log(`components=${Object.keys(map?.components ?? {}).length}`);
console.log(`cards=${cards.size}`);
