import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import YAML from 'yaml';
import ts from 'typescript';

const root = process.cwd();
const docsRoot = 'docs/product/electronics';
const mapPath = `${docsRoot}/COMPONENT_MAP.yaml`;
const errors = [];
const allowedRisk = new Set(['low', 'medium', 'high', 'critical']);
const allowedOwnership = new Set(['asa', 'infrastructure', 'owner_asset', 'cross_boundary']);
const largeSourceBytes = 50_000;
const allowedKinds = new Set([
  'implementation',
  'maintenance',
  'repair',
  'design-decision',
  'component/peripheral',
  'deployment',
  'plan/governance',
]);
const taskIdPattern = /^TASK-ELECTRONICS-(?:[A-Z0-9]+-)+\d{3}$/;
const governanceTaskPattern = /^TASK-ELECTRONICS-(?:GOVERNANCE|CONTROL)-\d{3}$/;
const allowedAssetRoots = new Set([
  'apps/web/public/assets/electronics/owner-supplied',
  'apps/web/public/assets/electronics/owner-audit',
]);
const declarationCache = new Map();
const args = process.argv.slice(2);
const requestedTask = args.length === 2 && args[0] === '--task' ? args[1] : null;
if (args.length && !requestedTask)
  errors.push('usage: validate-electronics-agent-docs.mjs [--task TASK-ELECTRONICS-...]');
const stateFields = new Set([
  'implementation_state',
  'active_task',
  'task',
  'checkpoint',
  'head_sha',
  'ci_status',
  'deployment_status',
  'readiness',
  'status',
]);

function isMapping(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readYaml(repoPath) {
  const full = resolve(root, repoPath);
  if (!existsSync(full)) {
    errors.push(`missing file: ${repoPath}`);
    return null;
  }
  try {
    const value = YAML.parse(readFileSync(full, 'utf8'));
    if (!isMapping(value)) {
      errors.push(`yaml root must be a mapping: ${repoPath}`);
      return null;
    }
    return value;
  } catch (error) {
    errors.push(
      `invalid yaml: ${repoPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

function isRepositoryPath(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    !/^(?:\/|[A-Za-z]:)/.test(value) &&
    !value.includes('\\') &&
    !value.split('/').some((part) => !part || part === '.' || part === '..')
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
  if (!isRepositoryPath(path)) return false;
  const wildcard = path.indexOf('*');
  const candidate = wildcard >= 0 ? path.slice(0, wildcard).replace(/\/$/, '') : path;
  if (!existsSync(resolve(root, candidate))) return false;
  return wildcard >= 0
    ? path.endsWith('/**') &&
        !/[?\[\]{}*]/.test(candidate) &&
        statSync(resolve(root, candidate)).isDirectory()
    : !/[?\[\]{}]/.test(path) && statSync(resolve(root, path)).isFile();
}

function markdownSlug(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number} _-]/gu, '')
    .replace(/ /g, '-');
}

function markdownAnchors(repoPath) {
  const content = readFileSync(resolve(root, repoPath), 'utf8');
  const anchors = new Set();
  let fence = null;
  for (const line of content.split(/\r?\n/)) {
    const delimiter = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (delimiter) {
      if (!fence) fence = delimiter[1];
      else if (delimiter[1][0] === fence[0] && delimiter[1].length >= fence.length) fence = null;
      continue;
    }
    if (fence) continue;
    const match = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (match) {
      const base = markdownSlug(match[1]);
      let anchor = base;
      let duplicate = 0;
      while (anchors.has(anchor)) anchor = `${base}-${++duplicate}`;
      anchors.add(anchor);
    }
  }
  return anchors;
}

function validateContract(id, value) {
  if (typeof value !== 'string') {
    errors.push(`${id} contracts entry must be a string`);
    return;
  }
  if (/[?\[\]{}*]/.test(value) || !pathExists(value)) {
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
    (value) => typeof value === 'string' && !/[#?\[\]{}*]/.test(value) && pathExists(value),
  );
}

function sourceDeclarations(source) {
  if (declarationCache.has(source)) return declarationCache.get(source);
  const names = new Set();
  if (/\.(?:ts|tsx|js|mjs)$/.test(source)) {
    const ast = ts.createSourceFile(
      source,
      readFileSync(resolve(root, source), 'utf8'),
      ts.ScriptTarget.Latest,
      false,
    );
    function visit(node) {
      if (
        (ts.isFunctionDeclaration(node) ||
          ts.isClassDeclaration(node) ||
          ts.isVariableDeclaration(node) ||
          ts.isTypeAliasDeclaration(node) ||
          ts.isInterfaceDeclaration(node) ||
          ts.isEnumDeclaration(node)) &&
        node.name &&
        ts.isIdentifier(node.name)
      )
        names.add(node.name.text);
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
  declarationCache.set(source, names);
  return names;
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
  for (const source of largeSources) {
    if (!symbols.some((symbol) => sourceDeclarations(source).has(symbol))) {
      errors.push(`${id} maps large source without a matching symbol: ${source}`);
    }
  }
  for (const symbol of symbols) {
    if (typeof symbol !== 'string' || !symbol.trim()) {
      errors.push(`${id} symbols entries must be non-empty strings`);
      continue;
    }
    if (!sources.some((source) => sourceDeclarations(source).has(symbol))) {
      errors.push(`${id} symbol declaration is not present in mapped sources: ${symbol}`);
    }
  }
}

function validateComponentFields(id, component) {
  if (!isMapping(component)) {
    errors.push(`${id} component card entry must be a mapping`);
    return;
  }
  for (const field of stateFields) {
    if (field in component) errors.push(`${id} must not duplicate execution/progress via ${field}`);
  }
  if (!allowedRisk.has(component.risk)) errors.push(`${id} risk invalid: ${component.risk}`);
  if (!allowedOwnership.has(component.ownership)) {
    errors.push(`${id} ownership invalid: ${component.ownership}`);
  }
  for (const field of ['sources', 'tests', 'dependencies']) {
    if (!Array.isArray(component[field]))
      errors.push(`${id} ${field} must be an explicit array (empty is allowed)`);
  }
  const contracts = asArray(id, component, 'contracts');
  if (!contracts.length) errors.push(`${id} must name at least one exact contract`);
  for (const contract of contracts) validateContract(id, contract);

  for (const source of asArray(id, component, 'sources')) {
    if (typeof source !== 'string') {
      errors.push(`${id} sources entry must be a string`);
    } else if (/[#?\[\]{}*]/.test(source)) {
      errors.push(`${id} sources must name exact files: ${source}`);
    } else if (!pathExists(source)) {
      errors.push(`${id} sources path does not exist: ${source}`);
    }
  }

  for (const assetRoot of asArray(id, component, 'asset_roots')) {
    if (
      component.ownership !== 'owner_asset' ||
      !allowedAssetRoots.has(assetRoot) ||
      !existsSync(resolve(root, assetRoot)) ||
      !statSync(resolve(root, assetRoot)).isDirectory()
    ) {
      errors.push(`${id} invalid owner asset_root: ${assetRoot}`);
    }
  }

  for (const test of asArray(id, component, 'tests')) {
    if (typeof test !== 'string') {
      errors.push(`${id} tests entry must be a string`);
      continue;
    }
    if (/[?\[\]{}*]/.test(test)) errors.push(`${id} tests must be exact, not wildcard: ${test}`);
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
    const card = cards.get(entry?.card)?.card;
    const dependencies = card?.components?.[id]?.dependencies;
    graph.set(
      id,
      Array.isArray(dependencies) ? dependencies.filter((item) => typeof item === 'string') : [],
    );
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

function readTaskCards() {
  const taskCards = [];
  const taskDir = resolve(root, docsRoot, 'tasks');
  if (!existsSync(taskDir)) return taskCards;
  const fields = [
    'task_id',
    'kind',
    'risk',
    'semantic_change',
    'roadmap_slice',
    'prerequisites',
    'acceptance_boundary',
    'review',
  ];
  for (const name of readdirSync(taskDir).filter(
    (item) => item.endsWith('.md') && !item.endsWith('_TEMPLATE.md'),
  )) {
    const content = readFileSync(resolve(taskDir, name), 'utf8');
    const block = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    let metadata;
    try {
      if (!block) throw new Error('missing canonical YAML frontmatter');
      metadata = YAML.parse(block[1]);
      if (!isMapping(metadata)) throw new Error('metadata must be a mapping');
    } catch (error) {
      errors.push(`${name}: malformed task declaration: ${error.message}`);
      continue;
    }
    for (const field of fields) {
      if (!(field in metadata)) errors.push(`${name}: missing task metadata ${field}`);
    }
    for (const field of Object.keys(metadata)) {
      if (!fields.includes(field)) errors.push(`${name}: unknown task metadata ${field}`);
    }
    if (typeof metadata.task_id !== 'string' || !taskIdPattern.test(metadata.task_id))
      errors.push(`${name}: invalid task_id`);
    if (!allowedKinds.has(metadata.kind)) errors.push(`${name}: invalid task kind`);
    if (!allowedRisk.has(metadata.risk)) errors.push(`${name}: invalid task risk`);
    if (!['yes', 'no'].includes(metadata.semantic_change))
      errors.push(`${name}: invalid semantic_change (use yes or no)`);
    if (
      metadata.roadmap_slice !== null &&
      (typeof metadata.roadmap_slice !== 'string' ||
        !/^E-OPT-\d+[A-Z]?$/.test(metadata.roadmap_slice))
    )
      errors.push(`${name}: invalid roadmap_slice`);
    if (
      !Array.isArray(metadata.prerequisites) ||
      metadata.prerequisites.some((item) => typeof item !== 'string' || !item.trim())
    )
      errors.push(`${name}: prerequisites must be an array of non-empty strings`);
    if (!['slice', 'milestone'].includes(metadata.acceptance_boundary))
      errors.push(`${name}: invalid acceptance_boundary`);
    if (!['self', 'independent'].includes(metadata.review)) errors.push(`${name}: invalid review`);
    if (metadata.kind === 'deployment' && metadata.risk !== 'critical')
      errors.push(`${name}: deployment risk must be critical`);
    const independent =
      metadata.risk === 'critical' ||
      (metadata.risk === 'high' && metadata.semantic_change === 'yes') ||
      metadata.acceptance_boundary === 'milestone';
    if (independent && metadata.review !== 'independent')
      errors.push(`${name}: independent review is required`);
    if (metadata.kind === 'plan/governance' && !governanceTaskPattern.test(metadata.task_id))
      errors.push(`${name}: governance kind requires the GOVERNANCE/CONTROL ID convention`);
    if (
      /^\s*(?:-\s*)?(?:\*\*)?(?:Execution task ID|Task ID):/m.test(content.slice(block[0].length))
    )
      errors.push(`${name}: duplicate task declaration outside metadata`);
    if (taskCards.some((entry) => entry.task_id === metadata.task_id))
      errors.push(`${name}: duplicate Task ID ${metadata.task_id}`);
    taskCards.push({ ...metadata, path: `${docsRoot}/tasks/${name}` });
  }
  return taskCards;
}

function validateActiveElectronicsTask(taskCards) {
  const current = readYaml('docs/execution/current.yaml');
  if (!current) return;
  const lanes = [
    { id: current.primary_lane?.id, task: current.task },
    ...(Array.isArray(current.parallel_lanes) ? current.parallel_lanes : []),
  ];
  const electronics = lanes.find((lane) => lane?.id === 'electronics');
  const task = electronics?.task;
  if (!task || typeof task !== 'object') {
    errors.push('canonical Electronics lane/task is missing');
    return;
  }
  const taskId = String(task.id ?? '');
  if (!taskIdPattern.test(taskId)) errors.push('canonical Electronics task ID is invalid');
  if (requestedTask && (requestedTask !== taskId || task.status !== 'in_progress')) {
    errors.push(
      `requested task ${requestedTask} is not selected for execution; canonical=${taskId} status=${task.status}`,
    );
  }
  if (!['in_progress', 'in_review'].includes(String(task.status))) return;
  const matches = taskCards.filter((card) => card.task_id === taskId);
  // Reserved non-product namespaces; no list of current/future product IDs.
  if (governanceTaskPattern.test(taskId) && matches.length === 0) return;
  if (matches.length !== 1) {
    errors.push(
      `active Electronics task ${taskId} must map to exactly one task card; matches=${matches.map((card) => card.path).join(', ') || 'none'}`,
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
  for (const field of ['areas', 'components']) {
    if (!isMapping(map[field]) || !Object.keys(map[field]).length) {
      errors.push(`COMPONENT_MAP ${field} must be a non-empty mapping`);
      map[field] = {};
    }
  }
  if ((map.rules?.card_owns ?? []).includes('implementation_state')) {
    errors.push('COMPONENT_MAP card_owns must not duplicate readiness via implementation_state');
  }

  for (const [area, relativeCard] of Object.entries(map.areas ?? {})) {
    if (typeof relativeCard !== 'string' || !/^components\/[a-z0-9-]+\.yaml$/.test(relativeCard)) {
      errors.push(`invalid subsystem card route for ${area}`);
      continue;
    }
    const repoPath = `${docsRoot}/${relativeCard}`;
    const card = readYaml(repoPath);
    if (card) {
      if (card.area !== area || !isMapping(card.components)) {
        errors.push(`invalid area/components in ${repoPath}`);
        card.components = {};
      }
      cards.set(relativeCard, { area, repoPath, card });
    }
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
      for (const dependency of asArray(id, component, 'dependencies')) {
        if (typeof dependency === 'string' && !map.components?.[dependency]) {
          errors.push(`${id} depends on unmapped component: ${dependency}`);
        }
      }
    }
  }

  validateDependencyCycles(map, cards);
}

const taskCards = readTaskCards();
validateActiveElectronicsTask(taskCards);

if (errors.length > 0) {
  console.error('Electronics agent routing validation: FAIL');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('Electronics agent routing validation: PASS');
console.log(`components=${Object.keys(map?.components ?? {}).length}`);
console.log(`cards=${cards.size}`);
console.log(`task_cards=${taskCards.length}`);
if (requestedTask) console.log(`selected_task=${requestedTask}`);
