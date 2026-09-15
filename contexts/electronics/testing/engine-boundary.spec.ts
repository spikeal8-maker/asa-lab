import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ELECTRONICS_ROOT = resolve(process.cwd(), 'contexts/electronics');
const DOMAIN_ROOT = join(ELECTRONICS_ROOT, 'domain');
const ENGINE_ENTRY = join(ELECTRONICS_ROOT, 'engine.ts');
const PACKAGE_JSON = join(ELECTRONICS_ROOT, 'package.json');

const FORBIDDEN_EXTERNAL_IMPORTS = [
  /^react(?:$|\/)/u,
  /^react-dom(?:$|\/)/u,
  /^@nestjs(?:$|\/)/u,
  /^(?:pg|postgres|postgresql)(?:$|\/)/u,
  /^@prisma(?:$|\/)/u,
  /^@asa-lab\/(?:web|api|portal|database|identity|projects|learning|authz)(?:$|\/)/u,
] as const;

function isWithin(root: string, file: string): boolean {
  const child = relative(root, file);
  return child === '' || (!child.startsWith('..') && !isAbsolute(child));
}

function moduleSpecifiers(file: string): readonly string[] {
  const sourceText = readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true);
  const specifiers = new Set<string>();

  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      specifiers.add(node.moduleSpecifier.text);
    }

    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteralLike(node.moduleReference.expression)
    ) {
      specifiers.add(node.moduleReference.expression.text);
    }

    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      specifiers.add(node.arguments[0].text);
    }

    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'require' &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      specifiers.add(node.arguments[0].text);
    }

    ts.forEachChild(node, visit);
  };

  visit(source);
  return [...specifiers];
}

function resolveLocalImport(fromFile: string, specifier: string): string {
  const raw = resolve(dirname(fromFile), specifier);
  const candidates = [
    raw,
    raw.replace(/\.m?js$/u, '.ts'),
    raw.replace(/\.cjs$/u, '.cts'),
    raw.replace(/\.jsx$/u, '.tsx'),
    `${raw}.ts`,
    `${raw}.tsx`,
    `${raw}.mts`,
    `${raw}.cts`,
    join(raw, 'index.ts'),
  ];

  const resolved = candidates.find(
    (candidate) => existsSync(candidate) && statSync(candidate).isFile(),
  );
  if (!resolved) throw new Error(`Unable to resolve ${specifier} from ${fromFile}`);
  return resolved;
}

function collectEngineDependencyClosure(): {
  readonly files: readonly string[];
  readonly externalImports: readonly string[];
} {
  const queue = [ENGINE_ENTRY];
  const visited = new Set<string>();
  const externalImports = new Set<string>();

  while (queue.length > 0) {
    const file = queue.pop();
    if (!file || visited.has(file)) continue;
    visited.add(file);

    for (const specifier of moduleSpecifiers(file)) {
      if (!specifier.startsWith('.')) {
        externalImports.add(specifier);
        continue;
      }

      const dependency = resolveLocalImport(file, specifier);
      if (!visited.has(dependency)) queue.push(dependency);
    }
  }

  return {
    files: [...visited].sort(),
    externalImports: [...externalImports].sort(),
  };
}

describe('Electronics engine dependency boundary', () => {
  it('keeps the package engine export explicit', () => {
    const manifest = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8')) as {
      exports?: Record<
        string,
        { readonly types?: string; readonly browser?: string; readonly default?: string }
      >;
    };

    expect(manifest.exports?.['./engine']).toEqual({
      types: './dist/engine.d.ts',
      browser: './engine.ts',
      default: './dist/engine.js',
    });
  });

  it('keeps the transitive source closure inside engine/domain production code', () => {
    const closure = collectEngineDependencyClosure();
    const escaped = closure.files.filter(
      (file) => file !== ENGINE_ENTRY && !isWithin(DOMAIN_ROOT, file),
    );

    expect(closure.files.length).toBeGreaterThan(1);
    expect(escaped).toEqual([]);
  });

  it('rejects host, UI, API and database package dependencies', () => {
    const closure = collectEngineDependencyClosure();
    const forbidden = closure.externalImports.filter((specifier) =>
      FORBIDDEN_EXTERNAL_IMPORTS.some((pattern) => pattern.test(specifier)),
    );

    expect(forbidden).toEqual([]);
  });
});
