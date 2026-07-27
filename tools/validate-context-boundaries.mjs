#!/usr/bin/env node
/**
 * TST-BOUNDARY-001 companion validator.
 *
 * Nx tags protect project-to-project dependencies. This script closes the two
 * gaps that tag-only checks cannot prove reliably:
 *   1. direct relative/internal imports between bounded contexts;
 *   2. framework or transport imports inside domain layers.
 *
 * It also verifies that the committed Nx graph was regenerated after context
 * tags changed, so the visual/project evidence cannot silently lag behind code.
 */
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

const ROOT = resolve(process.cwd());
const CONTEXTS = ['identity', 'organization', 'classroom'];
const CONTEXT_ROOT = join(ROOT, 'contexts');
const REPORT_DIR = join(ROOT, 'reports');
const REPORT_FILE = join(REPORT_DIR, 'context-boundaries.json');

const DOMAIN_FORBIDDEN = [
  /^@nestjs(?:\/|$)/,
  /^@fastify(?:\/|$)/,
  /^fastify$/,
  /^pg$/,
  /^react(?:\/|$)/,
  /^react-dom(?:\/|$)/,
  /^express(?:\/|$)/,
  /^koa(?:\/|$)/,
  /^hapi(?:\/|$)/,
  /^node:https?$/,
  /^https?$/,
];

function walk(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    if (entry === 'dist' || entry === 'node_modules' || entry === 'coverage') continue;
    const path = join(directory, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) files.push(...walk(path));
    else if (/\.(?:ts|tsx)$/.test(entry)) files.push(path);
  }
  return files;
}

function importsOf(file, source) {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const imports = new Set();

  function addLiteral(node) {
    if (node && ts.isStringLiteralLike(node)) imports.add(node.text);
  }

  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      addLiteral(node.moduleSpecifier);
    } else if (ts.isImportEqualsDeclaration(node)) {
      const reference = node.moduleReference;
      if (ts.isExternalModuleReference(reference)) addLiteral(reference.expression);
    } else if (ts.isCallExpression(node) && node.arguments.length === 1) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      if (isDynamicImport || isRequire) addLiteral(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return [...imports];
}

function contextOfResolvedPath(path) {
  const rel = relative(CONTEXT_ROOT, path);
  if (rel.startsWith('..') || rel === '') return null;
  return rel.split(sep)[0] ?? null;
}

function asRepoPath(path) {
  return relative(ROOT, path).split(sep).join('/');
}

const errors = [];
const checkedFiles = [];
const contextSummary = {};

for (const context of CONTEXTS) {
  const root = join(CONTEXT_ROOT, context);
  const projectFile = join(root, 'project.json');
  const project = JSON.parse(readFileSync(projectFile, 'utf8'));
  const expectedTag = `context:${context}`;
  if (!Array.isArray(project.tags) || !project.tags.includes(expectedTag)) {
    errors.push(`${asRepoPath(projectFile)} must include tag ${expectedTag}`);
  }

  const files = walk(root);
  contextSummary[context] = { files: files.length, imports: 0 };
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const imports = importsOf(file, source);
    contextSummary[context].imports += imports.length;
    checkedFiles.push(asRepoPath(file));

    for (const specifier of imports) {
      for (const other of CONTEXTS) {
        if (
          other !== context &&
          (specifier === `@asa-lab/${other}` || specifier.startsWith(`@asa-lab/${other}/`))
        ) {
          errors.push(`${asRepoPath(file)} imports bounded context ${other} via ${specifier}`);
        }
      }

      if (specifier.startsWith('.')) {
        const resolved = resolve(dirname(file), specifier);
        const targetContext = contextOfResolvedPath(resolved);
        if (targetContext && targetContext !== context) {
          errors.push(`${asRepoPath(file)} escapes into context ${targetContext} via ${specifier}`);
        }
      }

      const normalized = asRepoPath(file);
      if (
        normalized.includes('/domain/') &&
        DOMAIN_FORBIDDEN.some((pattern) => pattern.test(specifier))
      ) {
        errors.push(
          `${normalized} domain layer imports forbidden framework/transport package ${specifier}`,
        );
      }
    }
  }
}

const graphFile = join(ROOT, 'docs', 'project-map', 'nx-project-graph.json');
try {
  const graph = JSON.parse(readFileSync(graphFile, 'utf8'));
  const nodes = graph?.graph?.nodes ?? {};
  for (const context of CONTEXTS) {
    const tags = nodes?.[context]?.data?.tags;
    const expectedTag = `context:${context}`;
    if (!Array.isArray(tags) || !tags.includes(expectedTag)) {
      errors.push(
        `nx-project-graph.json is stale: node ${context} lacks ${expectedTag}; run pnpm graph:report`,
      );
    }
  }
} catch (error) {
  errors.push(
    `cannot validate nx-project-graph.json: ${error instanceof Error ? error.message : String(error)}`,
  );
}

const report = {
  generatedAt: new Date().toISOString(),
  contexts: contextSummary,
  filesChecked: checkedFiles.length,
  errors,
};
mkdirSync(REPORT_DIR, { recursive: true });
writeFileSync(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

if (errors.length > 0) {
  console.error(`context-boundaries FAIL (${errors.length} error(s))`);
  for (const error of errors) console.error(`  - ${error}`);
  console.error(`report: ${asRepoPath(REPORT_FILE)}`);
  process.exit(1);
}

console.log(
  `context-boundaries PASS: ${checkedFiles.length} file(s), ${CONTEXTS.length} isolated context(s), domain layers framework-free`,
);
console.log(`report: ${asRepoPath(REPORT_FILE)}`);
