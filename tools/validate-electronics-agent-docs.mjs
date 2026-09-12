import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import YAML from 'yaml';

const root = process.cwd();
const docsRoot = 'docs/product/electronics';
const mapPath = `${docsRoot}/COMPONENT_MAP.yaml`;
const errors = [];

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

function pathExists(value) {
  const withoutAnchor = value.split('#', 1)[0];
  if (!isRepositoryPath(withoutAnchor)) return true;
  const wildcard = withoutAnchor.indexOf('*');
  const candidate =
    wildcard >= 0 ? withoutAnchor.slice(0, wildcard).replace(/\/$/, '') : withoutAnchor;
  return existsSync(resolve(root, candidate));
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
]) {
  if (!existsSync(resolve(root, required)))
    errors.push(`missing required routing document: ${required}`);
}

const map = readYaml(mapPath);
const cards = new Map();
const cardComponentOwners = new Map();

if (map) {
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
      if (!mapEntry) errors.push(`card component ${id} is missing from COMPONENT_MAP.yaml`);
      else if (mapEntry.card !== relativeCard) {
        errors.push(
          `card component ${id} maps to ${mapEntry.card}, but is declared in ${relativeCard}`,
        );
      }

      for (const field of ['contracts', 'sources', 'tests']) {
        for (const value of component?.[field] ?? []) {
          if (typeof value === 'string' && !pathExists(value)) {
            errors.push(`${id} ${field} path does not exist: ${value}`);
          }
        }
      }

      for (const dependency of component?.dependencies ?? []) {
        if (typeof dependency === 'string' && !map.components?.[dependency]) {
          errors.push(`${id} depends on unmapped component: ${dependency}`);
        }
      }
    }
  }
}

if (errors.length > 0) {
  console.error('Electronics agent routing validation: FAIL');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('Electronics agent routing validation: PASS');
console.log(`components=${Object.keys(map?.components ?? {}).length}`);
console.log(`cards=${cards.size}`);
