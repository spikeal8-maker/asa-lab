/** Live, derived dependency observations. No maintained dependency registry. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import process from 'node:process';
import { TextDecoder } from 'node:util';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const slash = (p) => p.split(path.sep).join('/');

export function importsFromSource(filename, source) {
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const imports = [];
  const unknown = ast.parseDiagnostics.map((d) => `${filename}: syntax ${d.code}`);
  const literal = (node) =>
    node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node));
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      if (literal(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
      else unknown.push(`${filename}: unsupported module specifier`);
    }
    if (ts.isImportEqualsDeclaration(node)) {
      const expr = node.moduleReference.expression;
      if (literal(expr)) imports.push(expr.text);
      else unknown.push(`${filename}: unsupported import assignment`);
    }
    if (ts.isImportTypeNode(node)) {
      if (ts.isLiteralTypeNode(node.argument) && literal(node.argument.literal))
        imports.push(node.argument.literal.text);
      else unknown.push(`${filename}: unsupported import type`);
    }
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'URL' &&
      node.arguments?.[1] &&
      ts.isPropertyAccessExpression(node.arguments[1]) &&
      ts.isMetaProperty(node.arguments[1].expression)
    ) {
      if (literal(node.arguments?.[0]) && node.arguments[0].text.startsWith('.'))
        imports.push(node.arguments[0].text);
      else unknown.push(`${filename}: nonliteral URL dependency`);
    }
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require') ||
        (ts.isPropertyAccessExpression(node.expression) &&
          ts.isIdentifier(node.expression.expression) &&
          node.expression.expression.text === 'require' &&
          node.expression.name.text === 'resolve'))
    ) {
      if (node.arguments.length === 1 && literal(node.arguments[0]))
        imports.push(node.arguments[0].text);
      else unknown.push(`${filename}: nonliteral/dynamic dependency`);
    }
    if (
      ts.isPropertyAccessExpression(node) &&
      ['glob', 'globEager'].includes(node.name.text) &&
      ts.isMetaProperty(node.expression)
    ) {
      unknown.push(`${filename}: glob dependency requires conservative coverage`);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return { imports, unknown };
}

export function sourceIndex(root, files) {
  const reverse = {};
  const unknown = [];
  const fileSet = new Set(files);
  const configCache = new Map();
  const postcss = createRequire(require.resolve('vite/package.json'))('postcss');
  for (const filename of files.filter((f) => /\.(?:scss|sass|less|vue|svelte)$/.test(f)))
    unknown.push(`${filename}: unsupported dependency syntax`);
  for (const filename of files.filter((f) => /\.(?:[cm]?[jt]sx?|css)$/.test(f))) {
    const absolute = path.join(root, filename);
    if (!fs.existsSync(absolute)) continue;
    const source = fs.readFileSync(absolute, 'utf8');
    let observed;
    if (filename.endsWith('.css')) {
      observed = { imports: [], unknown: [] };
      try {
        const css = postcss.parse(source, { from: filename });
        css.walkAtRules('import', (rule) => {
          const quoted = /^(?:"([^"]+)"|'([^']+)')(?:\s.*)?$/.exec(rule.params);
          if (quoted) observed.imports.push(quoted[1] || quoted[2]);
          else observed.unknown.push(`${filename}: unsupported CSS @import`);
        });
        // Asset URLs are consumers too; unsupported quoting/escapes fail closed.
        css.walkDecls((decl) => {
          if (decl.value.includes('url(')) {
            const urls = [
              ...decl.value.matchAll(/url\(\s*(?:"([^"\\]+)"|'([^'\\]+)'|([^\s()'"\\]+))\s*\)/g),
            ];
            if (!urls.length || urls.length !== decl.value.split('url(').length - 1)
              observed.unknown.push(`${filename}: unsupported CSS URL`);
            for (const match of urls) observed.imports.push(match[1] || match[2] || match[3]);
          }
        });
      } catch {
        observed.unknown.push(`${filename}: CSS parse failed`);
      }
    } else observed = importsFromSource(filename, source);
    unknown.push(...observed.unknown);
    let config = ts.findConfigFile(path.dirname(absolute), ts.sys.fileExists);
    if (config && !configCache.has(config)) {
      const read = ts.readConfigFile(config, ts.sys.readFile);
      const parsed = ts.parseJsonConfigFileContent(read.config || {}, ts.sys, path.dirname(config));
      configCache.set(config, parsed.options);
      if (read.error) unknown.push(`${filename}: unreadable tsconfig`);
      if (parsed.errors.some((e) => e.code !== 18003))
        unknown.push(`${filename}: unsupported tsconfig resolution`);
    }
    const options = configCache.get(config) || {};
    for (const specifier of observed.imports) {
      if (/^(?:https?:|data:|#)/.test(specifier)) continue;
      let resolved = ts.resolveModuleName(specifier, absolute, options, ts.sys).resolvedModule
        ?.resolvedFileName;
      if (!resolved && specifier.startsWith('.')) {
        const direct = path.resolve(path.dirname(absolute), specifier.split('?')[0]);
        if (fs.existsSync(direct) && fs.statSync(direct).isFile()) resolved = direct;
      }
      if (!resolved) {
        // Builtins and installed external packages have no workspace source edge.
        try {
          createRequire(absolute).resolve(specifier);
        } catch {
          unknown.push(`${filename}: unresolved import ${specifier}`);
        }
        continue;
      }
      const relative = slash(path.relative(root, resolved));
      if (relative.startsWith('../')) {
        unknown.push(`${filename}: resolved source outside workspace ${relative}`);
        continue;
      }
      if (relative.includes('/node_modules/') || relative.startsWith('node_modules/')) continue;
      if (!fileSet.has(relative))
        unknown.push(`${filename}: resolved source outside observed files ${relative}`);
      (reverse[relative] ||= []).push(filename);
    }
  }
  return {
    reverse_imports: Object.fromEntries(
      Object.entries(reverse).map(([key, value]) => [key, [...new Set(value)].sort()]),
    ),
    unknown: [...new Set(unknown)].sort(),
  };
}

export function liveDependencies(root) {
  const inputFingerprint = () => {
    const inputDigest = crypto.createHash('sha256');
    const listed = new TextDecoder('utf-8', { fatal: true }).decode(
      execFileSync('git', ['ls-files', '-c', '-o', '--exclude-standard', '-z'], { cwd: root }),
    );
    const files = [...new Set(listed.split('\0').filter(Boolean))];
    for (const filename of files
      .filter(
        (f) =>
          !f.startsWith('docs/testing/evidence/') && /\.(?:[cm]?[jt]sx?|css|json|ya?ml)$/.test(f),
      )
      .sort()) {
      const filenameAbsolute = path.join(root, filename);
      if (fs.existsSync(filenameAbsolute) && fs.statSync(filenameAbsolute).isFile()) {
        inputDigest
          .update(filename)
          .update('\0')
          .update(fs.readFileSync(filenameAbsolute))
          .update('\0');
      }
    }
    return inputDigest.digest('hex');
  };
  const before = inputFingerprint();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'asa-devex-nx-'));
  try {
    const manifest = require.resolve('nx/package.json');
    const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.nx;
    const output = path.join(directory, 'graph.json');
    execFileSync(
      process.execPath,
      [path.resolve(path.dirname(manifest), bin), 'graph', `--file=${output}`, '--open=false'],
      {
        cwd: root,
        env: { ...process.env, NX_DAEMON: 'false' },
        timeout: 150000,
        stdio: 'pipe',
      },
    );
    const raw = fs.readFileSync(output);
    const graph = JSON.parse(raw).graph;
    if (!graph?.nodes || !graph?.dependencies || !Object.keys(graph.nodes).length)
      throw new Error('invalid live Nx graph');
    const projects = {};
    const reverseProjects = {};
    for (const [name, node] of Object.entries(graph.nodes)) {
      if (!node.data?.root || node.data.root.includes('..') || path.isAbsolute(node.data.root))
        throw new Error('invalid Nx project root');
      projects[name] = { root: node.data.root, targets: Object.keys(node.data.targets || {}) };
    }
    for (const edges of Object.values(graph.dependencies)) {
      for (const edge of edges) {
        if (!projects[edge.source] || !projects[edge.target])
          throw new Error('unknown Nx edge endpoint');
        (reverseProjects[edge.target] ||= []).push(edge.source);
      }
    }
    const bytes = execFileSync('git', ['ls-files', '-c', '-o', '--exclude-standard', '-z'], {
      cwd: root,
    });
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const files = [...new Set(decoded.split('\0').filter(Boolean))];
    if (files.some((f) => f.includes('\\'))) throw new Error('nonportable Git path');
    const indexed = sourceIndex(root, files);
    const workspacePackages = files
      .filter((f) => f.endsWith('/package.json'))
      .map((f) => {
        const data = JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
        return { name: data.name, root: slash(path.dirname(f)) };
      })
      .filter((p) => p.name?.startsWith('@asa-lab/'));
    const issues = indexed.unknown.map((reason) => {
      const source = reason.split(': ')[0];
      const specifier = reason.split(': unresolved import ')[1];
      const potentialRoots = [];
      if (specifier?.startsWith('.'))
        potentialRoots.push(
          slash(path.normalize(path.join(path.dirname(source), specifier))).replace(
            /\.(?:[cm]?[jt]sx?)$/,
            '',
          ),
        );
      for (const pkg of workspacePackages)
        if (specifier === pkg.name || specifier?.startsWith(`${pkg.name}/`))
          potentialRoots.push(pkg.root);
      return {
        source,
        reason,
        potential_roots: potentialRoots,
        unbounded_code_consumer:
          /nonliteral|glob dependency|syntax|unsupported module|import assignment/.test(reason) ||
          Boolean(specifier?.startsWith('@asa-lab/') && !potentialRoots.length),
      };
    });
    const after = inputFingerprint();
    return {
      ...indexed,
      unknown: [
        ...issues,
        ...(before !== after ? ['workspace inputs changed during live dependency analysis'] : []),
      ],
      projects,
      reverse_projects: reverseProjects,
      provenance: {
        provider: 'live-nx-typescript',
        nx_version: pkg.version,
        graph_sha256: crypto.createHash('sha256').update(raw).digest('hex'),
        project_count: Object.keys(projects).length,
        edge_count: Object.values(graph.dependencies).flat().length,
        source_file_count: files.length,
        typescript_version: ts.version,
        git_head: execFileSync('git', ['rev-parse', 'HEAD'], {
          cwd: root,
          encoding: 'utf8',
        }).trim(),
        source_inputs_sha256: after,
      },
    };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(
      `${JSON.stringify(liveDependencies(path.resolve(process.argv[2] || '.')))}\n`,
    );
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 78;
  }
}
