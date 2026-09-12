import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import YAML from 'yaml';

const ROOT = path.resolve(import.meta.dirname, '..');
const DOC_ROOT = 'docs/product/visual-programming';
const INDEX_PATH = `${DOC_ROOT}/COMPONENT_MAP.yaml`;
const TASK_ROOT = `${DOC_ROOT}/tasks`;
const GLOBAL_ENTRY_PATH = 'START_HERE_FOR_AI.md';
const UNSCOPED_CODE_SOURCE_MAX_BYTES = 12_000;
const TASK_CARD_MAX_BYTES = 12_000;
const errors = [];

const allowedStates = new Set(['implemented', 'planned', 'blocked']);
const allowedRisks = new Set(['low', 'medium', 'high', 'critical']);
const riskRank = new Map([
  ['low', 0],
  ['medium', 1],
  ['high', 2],
  ['critical', 3],
]);
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
  [`${TASK_ROOT}/README.md`, 6_000],
  [`${TASK_ROOT}/MAINTENANCE_TASK_TEMPLATE.md`, 8_000],
  [`${TASK_ROOT}/DESIGN_TASK_TEMPLATE.md`, 8_000],
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

function listFilesRecursive(relativeDir) {
  const output = [];
  const root = absolute(relativeDir);
  if (!fs.existsSync(root)) return output;

  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(full);
      } else if (entry.isFile()) {
        output.push(path.relative(ROOT, full).split(path.sep).join('/'));
      }
    }
  }

  visit(root);
  return output;
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

function isCodeSource(relative) {
  return /\.(?:cjs|mjs|js|jsx|cts|mts|ts|tsx)$/i.test(relative || '');
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

function validateSourceEntry(entry, owner) {
  const relative = sourcePath(entry);
  requireExactExistingPath(relative, owner);
  if (!relative || !exists(relative) || typeof entry === 'string') return;

  if (entry.symbols !== undefined) {
    if (!Array.isArray(entry.symbols) || entry.symbols.length === 0) {
      errors.push(`${owner}: symbols must be a non-empty array when present`);
      return;
    }
    const text = readText(relative);
    for (const symbol of entry.symbols) {
      if (typeof symbol !== 'string' || !symbol.trim()) {
        errors.push(`${owner}: symbol names must be non-empty strings`);
      } else if (!text.includes(symbol)) {
        errors.push(`${owner}: symbol ${symbol} not found in ${relative}`);
      }
    }
  }
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
    errors.push(
      `${retired}: retired historical/addendum file must not remain in active Scratch docs`,
    );
  }
}

const retiredNames = retiredActivePaths.map((relative) => path.basename(relative));
for (const relative of listFilesRecursive(DOC_ROOT).filter((value) => value.endsWith('.md'))) {
  const text = readText(relative);
  for (const retiredName of retiredNames) {
    if (text.includes(retiredName)) {
      errors.push(`${relative}: references retired active document ${retiredName}`);
    }
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

const implementedCodeSourceOwners = new Map();

for (const [id, component] of cardComponents) {
  const owner = `${component.cardPath}:${id}`;
  if (!allowedStates.has(component.state))
    errors.push(`${owner}: invalid state ${component.state}`);
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
  if (component.canonical_asset !== undefined) {
    requireExactExistingPath(component.canonical_asset, `${owner}.canonical_asset`);
  }

  if (component.state === 'implemented') {
    if (!Array.isArray(component.sources) || component.sources.length === 0) {
      errors.push(`${owner}: implemented component needs exact sources`);
    }
    if (!Array.isArray(component.tests) || component.tests.length === 0) {
      errors.push(`${owner}: implemented component needs exact tests`);
    }
    for (const entry of component.sources || []) {
      validateSourceEntry(entry, `${owner}.sources`);
      const relative = sourcePath(entry);
      if (relative && exists(relative) && isCodeSource(relative)) {
        const refs = implementedCodeSourceOwners.get(relative) || [];
        refs.push({ id, entry, owner });
        implementedCodeSourceOwners.set(relative, refs);
      }
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
      const taskPath = `${TASK_ROOT}/${component.task_card}`;
      requireExactExistingPath(taskPath, `${owner}.task_card`);
      if (exists(taskPath)) {
        const taskText = readText(taskPath);
        if (!taskText.includes(id)) {
          errors.push(`${owner}: task card ${component.task_card} does not name component ${id}`);
        }
        const taskId = component.task_card.replace(/\.md$/, '');
        if (component.task && component.task !== taskId) {
          errors.push(`${owner}: task ${component.task} does not match task_card ${taskId}`);
        }
      }
    }
  }
}

for (const [relative, refs] of implementedCodeSourceOwners) {
  const shared = refs.length > 1;
  const large = fs.statSync(absolute(relative)).size > UNSCOPED_CODE_SOURCE_MAX_BYTES;
  if (!shared && !large) continue;

  for (const ref of refs) {
    const symbols = typeof ref.entry === 'object' ? ref.entry.symbols : null;
    if (!Array.isArray(symbols) || symbols.length === 0) {
      const reason = shared ? 'shared by multiple mapped components' : 'larger than 12000 bytes';
      errors.push(
        `${ref.owner}: code source ${relative} is ${reason}; exact symbols are required for token-efficient routing`,
      );
    }
  }
}

const taskDir = absolute(TASK_ROOT);
if (fs.existsSync(taskDir)) {
  for (const name of fs.readdirSync(taskDir)) {
    if (!/^VSCR-.*\.md$/.test(name)) continue;
    const relative = `${TASK_ROOT}/${name}`;
    const bytes = fs.statSync(absolute(relative)).size;
    if (bytes > TASK_CARD_MAX_BYTES) {
      errors.push(`${relative}: ${bytes} bytes exceeds task-card budget ${TASK_CARD_MAX_BYTES}`);
    }

    const text = readText(relative);
    const taskId = name.replace(/\.md$/, '');
    if (text.includes('**Status:**')) {
      errors.push(`${relative}: task card must not duplicate readiness/status`);
    }
    if (!text.includes('## Goal')) errors.push(`${relative}: missing ## Goal`);
    if (!text.includes('## Bounded self-review')) {
      errors.push(`${relative}: missing ## Bounded self-review`);
    }

    const riskMatch = text.match(/\*\*Risk:\*\*\s*(low|medium|high|critical)\b/i);
    if (!riskMatch) {
      errors.push(`${relative}: missing valid **Risk:** low|medium|high|critical`);
    }
    const taskRisk = riskMatch?.[1]?.toLowerCase();
    const ownedComponents = [...cardComponents.values()].filter(
      (component) => component.task === taskId || component.design_gate === taskId,
    );
    if (taskRisk && ownedComponents.length) {
      const maximumComponentRisk = ownedComponents.reduce(
        (maximum, component) => Math.max(maximum, riskRank.get(component.risk) ?? 0),
        0,
      );
      if ((riskRank.get(taskRisk) ?? -1) < maximumComponentRisk) {
        const requiredRisk = [...riskRank.entries()].find(
          ([, rank]) => rank === maximumComponentRisk,
        )?.[0];
        errors.push(
          `${relative}: task risk ${taskRisk} is lower than owned/design-gated component risk ${requiredRisk}`,
        );
      }
    }

    const requiresExecutionMarker =
      text.includes('**Kind:** executable implementation slice') ||
      text.includes('**Kind:** acceptance/review slice') ||
      text.includes('**Kind:** design decision slice');
    if (requiresExecutionMarker) {
      const executionLine =
        text.split(/\r?\n/).find((line) => line.startsWith('**Execution:**')) ?? '';
      if (!executionLine) {
        errors.push(`${relative}: executable/review/design card must declare **Execution:**`);
      }
      if (!executionLine.includes('docs/execution/current.yaml.task.id')) {
        errors.push(`${relative}: execution marker must bind to current.yaml.task.id`);
      }
      if (!executionLine.includes('docs/execution/current.yaml.task.status')) {
        errors.push(`${relative}: execution marker must bind to current.yaml.task.status`);
      }
      if (!executionLine.includes('in_progress')) {
        errors.push(`${relative}: execution marker must require task.status=in_progress`);
      }
      if (!executionLine.includes(taskId)) {
        errors.push(`${relative}: execution marker must name exact task ID ${taskId}`);
      }
      if (/^VSCR-M1-002[A-E]$/.test(taskId)) {
        const milestoneMarkerPresent =
          executionLine.includes('docs/execution/current.yaml.primary_lane.milestone.id') &&
          executionLine.includes('VSCR-M1-002') &&
          executionLine.includes('owner_authorization') &&
          executionLine.includes('accepted');
        if (!milestoneMarkerPresent) {
          errors.push(
            `${relative}: M1-002 sub-slice execution must bind canonical owner-authorised milestone marker`,
          );
        }
      }

      const highRisk = taskRisk === 'high' || taskRisk === 'critical';
      if (highRisk && !text.includes('## Independent review')) {
        errors.push(
          `${relative}: HIGH/CRITICAL executable/review/design card needs ## Independent review`,
        );
      }
    }
  }
}

const currentExecution = readYaml('docs/execution/current.yaml');
const activeScratchTaskId = String(currentExecution?.task?.id ?? '');
const activeScratchTaskStatus = String(currentExecution?.task?.status ?? '');
const activeScratchMilestone = currentExecution?.primary_lane?.milestone;
if (activeScratchMilestone !== undefined) {
  if (!activeScratchMilestone || typeof activeScratchMilestone !== 'object') {
    errors.push(
      'docs/execution/current.yaml: primary_lane.milestone must be a mapping when present',
    );
  } else if (
    activeScratchMilestone.id !== 'VSCR-M1-002' ||
    activeScratchMilestone.owner_authorization !== 'accepted'
  ) {
    errors.push(
      'docs/execution/current.yaml: Scratch milestone marker must be VSCR-M1-002 with owner_authorization=accepted',
    );
  }
}
if (
  /^VSCR-M1-002[A-E]$/.test(activeScratchTaskId) &&
  ['in_progress', 'in_review'].includes(activeScratchTaskStatus)
) {
  if (
    !activeScratchMilestone ||
    activeScratchMilestone.id !== 'VSCR-M1-002' ||
    activeScratchMilestone.owner_authorization !== 'accepted'
  ) {
    errors.push(
      `docs/execution/current.yaml: active ${activeScratchTaskId} requires owner-authorised VSCR-M1-002 milestone marker`,
    );
  }
}

const activeRoutingDocs = [
  GLOBAL_ENTRY_PATH,
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
  'current.yaml` + explicit owner instruction',
];
for (const relative of activeRoutingDocs) {
  if (!exists(relative)) continue;
  const text = readText(relative);
  for (const forbidden of forbiddenActiveStrings) {
    if (text.includes(forbidden)) {
      errors.push(`${relative}: references retired/forbidden routing text ${forbidden}`);
    }
  }
}

const blocksBoundarySources = {
  eslint: readText('eslint.config.mjs'),
  validator: readText('tools/validate-context-boundaries.mjs'),
};
if (!blocksBoundarySources.eslint.includes("sourceTag: 'context:blocks'")) {
  errors.push('eslint.config.mjs: context:blocks dependency constraint is missing');
}
if (
  !blocksBoundarySources.eslint.includes(
    "onlyDependOnLibsWithTags: ['context:blocks', 'scope:shared', 'scope:contract']",
  )
) {
  errors.push('eslint.config.mjs: context:blocks dependency allowlist is not fail-closed');
}
if (!blocksBoundarySources.validator.includes('blocks: [],')) {
  errors.push('tools/validate-context-boundaries.mjs: blocks context registration is missing');
}

const graphPath = 'docs/project-map/nx-project-graph.json';
try {
  const graph = JSON.parse(readText(graphPath));
  const blockTags = graph?.graph?.nodes?.blocks?.data?.tags;
  if (!Array.isArray(blockTags) || !blockTags.includes('context:blocks')) {
    errors.push(`${graphPath}: node blocks with context:blocks tag is missing or stale`);
  }
} catch (error) {
  errors.push(`${graphPath}: cannot validate Blocks graph node (${error.message})`);
}

if (errors.length) {
  console.error('Scratch documentation routing validation: FAIL');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('Scratch documentation routing validation: PASS');
console.log(`- components: ${cardComponents.size}`);
console.log(`- subsystem cards: ${cardPaths.size}`);
console.log('- retired competing docs/addenda absent and unreferenced in active Scratch docs');
console.log('- implemented source/test paths, symbols and canonical contract headings verified');
console.log('- shared/large implemented code sources have symbol-level routing');
console.log(
  '- executable/design/review task cards bind exact current.yaml task IDs plus task.status=in_progress',
);
console.log('- task/design-gate risk cannot understate mapped component risk');
console.log('- HIGH/CRITICAL executable/design/review slices require independent review');
console.log('- active M1-002 sub-slices require canonical owner-authorised milestone marker');
console.log(
  '- blocks bounded-context enforcement is present in Nx rules, boundary validator and graph',
);
