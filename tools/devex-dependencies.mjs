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
  const imports = ast.referencedFiles.map((reference) =>
    reference.fileName.startsWith('.') || path.isAbsolute(reference.fileName)
      ? reference.fileName
      : `./${reference.fileName}`,
  );
  const unknown = ast.parseDiagnostics.map((d) => `${filename}: syntax ${d.code}`);
  const literal = (node) =>
    node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node));
  const member = (node) => {
    if (ts.isPropertyAccessExpression(node)) return { base: node.expression, name: node.name.text };
    if (ts.isElementAccessExpression(node))
      return {
        base: node.expression,
        name: literal(node.argumentExpression) ? node.argumentExpression.text : null,
      };
    return null;
  };
  const identifier = (node, name) => ts.isIdentifier(node) && node.text === name;
  const factories = new Set(['createRequire']);
  const namespaces = new Set(['module']);
  const aliases = new Set();
  const importMeta = (node) =>
    ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword;
  const currentBase = (node) =>
    identifier(node, '__filename') ||
    (member(node)?.name === 'url' && importMeta(member(node).base));
  const factory = (node) =>
    (ts.isIdentifier(node) && factories.has(node.text)) || member(node)?.name === 'createRequire';
  const boundedFactory = (node) =>
    ts.isCallExpression(node) &&
    factory(node.expression) &&
    node.arguments.length === 1 &&
    currentBase(node.arguments[0]);
  const constant = (node) =>
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    Boolean(node.parent.flags & ts.NodeFlags.Const);
  function collect(node) {
    if (
      ts.isImportDeclaration(node) &&
      ['node:module', 'module'].includes(node.moduleSpecifier.text)
    ) {
      const bindings = node.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings))
        for (const entry of bindings.elements)
          if ((entry.propertyName || entry.name).text === 'createRequire')
            factories.add(entry.name.text);
      if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
      if (node.importClause?.name) namespaces.add(node.importClause.name.text);
    }
    if (
      ts.isBindingElement(node) &&
      (node.propertyName || node.name).text === 'createRequire' &&
      ts.isIdentifier(node.name)
    )
      factories.add(node.name.text);
    ts.forEachChild(node, collect);
  }
  collect(ast);
  function collectAliases(node) {
    if (constant(node) && node.initializer && boundedFactory(node.initializer))
      aliases.add(node.name.text);
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      literal(node.initializer.arguments[0]) &&
      ['node:module', 'module'].includes(node.initializer.arguments[0].text)
    )
      namespaces.add(node.name.text);
    ts.forEachChild(node, collectAliases);
  }
  collectAliases(ast);
  const loader = (node) => {
    if (
      identifier(node, 'require') ||
      (ts.isIdentifier(node) && aliases.has(node.text)) ||
      boundedFactory(node)
    )
      return true;
    const access = member(node);
    return Boolean(
      access &&
      ((identifier(access.base, 'module') && access.name === 'require') ||
        (loader(access.base) && access.name === 'resolve') ||
        (importMeta(access.base) && access.name === 'resolve')),
    );
  };
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
      (node.expression.kind === ts.SyntaxKind.ImportKeyword || loader(node.expression))
    ) {
      if (node.arguments.length === 1 && literal(node.arguments[0]))
        imports.push(node.arguments[0].text);
      else unknown.push(`${filename}: nonliteral/dynamic dependency`);
    }
    const access = member(node);
    const namePosition =
      (node.parent?.name === node ||
        (node.parent && ts.isBindingElement(node.parent) && node.parent.propertyName === node)) &&
      !ts.isShorthandPropertyAssignment(node.parent) &&
      !ts.isExportSpecifier(node.parent);
    const importPosition = Boolean(
      node.parent && (ts.isImportSpecifier(node.parent) || ts.isImportClause(node.parent)),
    );
    if (
      factory(node) &&
      !namePosition &&
      !importPosition &&
      !(ts.isCallExpression(node.parent) && node.parent.expression === node)
    )
      unknown.push(`${filename}: opaque module-loader factory/alias`);
    if (
      ts.isCallExpression(node) &&
      factory(node.expression) &&
      (!boundedFactory(node) ||
        !(
          (constant(node.parent) && node.parent.initializer === node) ||
          (ts.isCallExpression(node.parent) && node.parent.expression === node) ||
          (member(node.parent)?.base === node && loader(node.parent))
        ))
    )
      unknown.push(`${filename}: opaque module-loader factory base/usage`);
    if (
      access &&
      access.name === null &&
      ((ts.isIdentifier(access.base) && namespaces.has(access.base.text)) ||
        loader(access.base) ||
        importMeta(access.base))
    )
      unknown.push(`${filename}: computed module-loader member`);
    if (
      loader(node) &&
      !namePosition &&
      !importPosition &&
      !(constant(node.parent) && node.parent.initializer === node && boundedFactory(node)) &&
      !(ts.isCallExpression(node.parent) && node.parent.expression === node) &&
      !(member(node.parent)?.base === node && loader(node.parent))
    )
      unknown.push(`${filename}: opaque module-loader value/alias`);
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
  return {
    imports,
    typeReferences: ast.typeReferenceDirectives.map((reference) => reference.fileName),
    unknown,
  };
}

export function sourceIndex(root, files) {
  const reverse = {};
  const unknown = [];
  const uncertainties = [];
  const issue = (filename, message, potentialRoots = [], unbounded = true) => {
    const reason = `${filename}: ${message}`;
    unknown.push(reason);
    uncertainties.push({
      source: filename,
      reason,
      potential_roots: potentialRoots,
      unbounded_code_consumer: unbounded,
    });
  };
  const fileSet = new Set(files);
  const workspacePackages = files
    .filter((filename) => filename.endsWith('/package.json'))
    .map((filename) => ({
      name: JSON.parse(fs.readFileSync(path.join(root, filename), 'utf8')).name,
      root: slash(path.dirname(filename)),
    }))
    .filter((pkg) => typeof pkg.name === 'string');
  const configCache = new Map();
  const postcss = createRequire(require.resolve('vite/package.json'))('postcss');
  let cssValues, cssTokens;
  try {
    const fromVite = createRequire(require.resolve('vite/package.json'));
    cssValues = fromVite('@csstools/css-parser-algorithms');
    cssTokens = fromVite('@csstools/css-tokenizer');
  } catch {
    // Transitive parser availability is not assumed on another installation.
    // Every CSS consumer remains uncertain until values can actually be parsed.
  }
  for (const filename of files.filter((f) => /\.(?:scss|sass|less|vue|svelte)$/.test(f)))
    issue(filename, 'unsupported dependency syntax');
  for (const filename of files.filter((f) => /\.(?:[cm]?[jt]sx?|css)$/.test(f))) {
    const absolute = path.join(root, filename);
    if (!fs.existsSync(absolute)) continue;
    const source = fs.readFileSync(absolute, 'utf8');
    let observed;
    if (filename.endsWith('.css')) {
      observed = { imports: [], unknown: [] };
      try {
        const css = postcss.parse(source, { from: filename });
        const values = (value, importRule = false, imageProperty = false) => {
          if (!cssValues || !cssTokens) {
            observed.unknown.push(`${filename}: CSS value parser unavailable`);
            return;
          }
          const parseOptions = {
            onParseError: () => observed.unknown.push(`${filename}: CSS value parse failed`),
          };
          const nodes = cssValues.parseListOfComponentValues(
            cssTokens.tokenize({ css: value }, parseOptions),
            parseOptions,
          );
          const meaningful = (items) =>
            items.filter((node) => !cssValues.isWhiteSpaceOrCommentNode(node));
          const string = (node) =>
            cssValues.isTokenNode(node) && cssTokens.isTokenString(node.value);
          if (importRule) {
            const first = meaningful(nodes)[0];
            if (first && string(first)) observed.imports.push(first.value[4].value);
            else if (
              !first ||
              (!(cssValues.isFunctionNode(first) && first.getName().toLowerCase() === 'url') &&
                !(cssValues.isTokenNode(first) && cssTokens.isTokenURL(first.value)))
            )
              observed.unknown.push(`${filename}: unsupported CSS @import`);
          }
          const computation =
            /^(?:(?:repeating-)?(?:linear|radial|conic)-gradient|rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark|calc|min|max|clamp|round|mod|rem|abs|sign|sin|cos|tan|asin|acos|atan|atan2|pow|sqrt|hypot|log|exp|var|env|attr|type|format|local|tech)$/;
          const imageFunction =
            /(?:^|-)(?:image|image-set|cross-fade|paint|element|url|src)(?:-|$)/;
          cssValues.walk(nodes, ({ node, parent }) => {
            if (cssValues.isTokenNode(node) && cssTokens.isTokenURL(node.value))
              observed.imports.push(node.value[4].value);
            if (!cssValues.isFunctionNode(node)) return;
            const name = node.getName().toLowerCase();
            if (name === 'url') {
              const children = meaningful(node.value);
              if (children.length === 1 && string(children[0]))
                observed.imports.push(children[0].value[4].value);
              else observed.unknown.push(`${filename}: unsupported CSS URL`);
            } else if (['image-set', '-webkit-image-set'].includes(name)) {
              for (const child of node.value)
                if (string(child)) observed.imports.push(child.value[4].value);
              let imageExpected = true;
              for (const child of meaningful(node.value)) {
                if (cssValues.isTokenNode(child) && cssTokens.isTokenComma(child.value)) {
                  imageExpected = true;
                  continue;
                }
                if (!imageExpected) continue;
                imageExpected = false;
                const staticImage =
                  string(child) ||
                  (cssValues.isTokenNode(child) && cssTokens.isTokenURL(child.value)) ||
                  (cssValues.isFunctionNode(child) &&
                    /^(?:url|(?:repeating-)?(?:linear|radial|conic)-gradient)$/.test(
                      child.getName().toLowerCase(),
                    ));
                if (!staticImage)
                  observed.unknown.push(`${filename}: unsupported CSS image-set candidate`);
              }
            } else if (
              imageProperty &&
              ['var', 'attr'].includes(name) &&
              !cssValues.isFunctionNode(parent)
            ) {
              observed.unknown.push(
                `${filename}: unresolved CSS resource-valued ${name} in image property`,
              );
            } else if (
              imageFunction.test(name) ||
              (imageProperty &&
                !computation.test(name) &&
                node.value.some((child) => string(child)))
            ) {
              // Value substitution, math, colors and gradients do not load files.
              // Retain uncertainty for explicit resource functions or possible
              // image strings, while still walking every nested literal URL.
              observed.unknown.push(`${filename}: unsupported CSS function ${name}`);
            }
          });
        };
        // Escaped identifiers/paths need a CSS value resolver. Retain uncertainty
        // rather than silently overlooking escaped url/import spellings.
        if (source.includes('\\')) observed.unknown.push(`${filename}: unsupported CSS escape`);
        css.walkAtRules((rule) => {
          values(rule.params, rule.name.toLowerCase() === 'import');
        });
        // Asset URLs are consumers too; unsupported quoting/escapes fail closed.
        css.walkDecls((decl) => {
          const before = observed.imports.length;
          values(
            decl.value,
            false,
            /^(?:-webkit-)?(?:background(?:-image)?|mask(?:-image)?|border-image(?:-source)?|list-style(?:-image)?|content|cursor|shape-outside|src)$/.test(
              decl.prop.toLowerCase(),
            ),
          );
          // Resource URLs in custom properties are resolved at the consuming
          // stylesheet, not necessarily where the value was declared.
          if (decl.prop.startsWith('--') && observed.imports.length > before)
            observed.unknown.push(`${filename}: CSS custom-property resource consumer unresolved`);
        });
      } catch {
        observed.unknown.push(`${filename}: CSS parse failed`);
      }
    } else observed = importsFromSource(filename, source);
    for (const reason of new Set(observed.unknown))
      issue(filename, reason.slice(filename.length + 2));
    let config = ts.findConfigFile(path.dirname(absolute), ts.sys.fileExists);
    if (config && !configCache.has(config)) {
      const read = ts.readConfigFile(config, ts.sys.readFile);
      const parsed = ts.parseJsonConfigFileContent(read.config || {}, ts.sys, path.dirname(config));
      configCache.set(config, parsed.options);
      if (read.error) issue(filename, 'unreadable tsconfig');
      if (parsed.errors.some((e) => e.code !== 18003))
        issue(filename, 'unsupported tsconfig resolution');
    }
    const options = configCache.get(config) || {};
    for (const { specifier, typeReference } of [
      ...observed.imports.map((specifier) => ({ specifier, typeReference: false })),
      ...(observed.typeReferences || []).map((specifier) => ({ specifier, typeReference: true })),
    ]) {
      if (/^(?:https?:|data:|\/\/)/i.test(specifier)) continue;
      if (filename.endsWith('.css') && specifier.startsWith('#')) continue;
      const clean = specifier.startsWith('#') ? specifier : specifier.split(/[?#]/)[0];
      const candidates = [];
      // CSS URLs/imports are relative to the stylesheet even without './'.
      if (filename.endsWith('.css') && !clean.startsWith('/'))
        candidates.push(path.resolve(path.dirname(absolute), clean));
      else if (clean.startsWith('.')) candidates.push(path.resolve(path.dirname(absolute), clean));
      // TypeScript's module resolver omits non-module assets such as CSS/SVG.
      // Derive fallback candidates from the actual parsed paths, never a registry.
      let matchedAlias = false;
      for (const [pattern, substitutions] of Object.entries(options.paths || {})) {
        const star = pattern.indexOf('*');
        const matches =
          star < 0
            ? clean === pattern
            : clean.startsWith(pattern.slice(0, star)) && clean.endsWith(pattern.slice(star + 1));
        if (!matches) continue;
        matchedAlias = true;
        const captured =
          star < 0 ? '' : clean.slice(star, clean.length - (pattern.length - star - 1));
        for (const substitution of substitutions)
          candidates.push(
            path.resolve(
              options.baseUrl || options.pathsBasePath || path.dirname(config),
              substitution.replace('*', captured),
            ),
          );
      }
      if (!candidates.length && options.baseUrl && !clean.startsWith('/'))
        candidates.push(path.resolve(options.baseUrl, clean));
      const resolved = typeReference
        ? ts.resolveTypeReferenceDirective(specifier, absolute, options, ts.sys)
            .resolvedTypeReferenceDirective?.resolvedFileName
        : ts.resolveModuleName(specifier, absolute, options, ts.sys).resolvedModule
            ?.resolvedFileName;
      // Ambiguous asset aliases retain every existing candidate. Selecting just
      // the first alternative could omit the actual bundler consumer relation.
      const resolutions = [
        ...new Set([
          ...(resolved ? [resolved] : []),
          ...candidates.filter(
            (candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile(),
          ),
        ]),
      ];
      if (!resolutions.length) {
        // Builtins and installed external packages have no workspace source edge.
        const potentialRoots = candidates.map((candidate) =>
          slash(path.relative(root, candidate)).replace(/\.(?:[cm]?[jt]sx?)$/, ''),
        );
        const packages = workspacePackages.filter(
          (pkg) => specifier === pkg.name || specifier.startsWith(`${pkg.name}/`),
        );
        potentialRoots.push(...packages.map((pkg) => pkg.root));
        if (
          filename.endsWith('.css') ||
          matchedAlias ||
          clean.startsWith('.') ||
          clean.startsWith('/')
        ) {
          issue(
            filename,
            `unresolved import ${specifier}`,
            potentialRoots,
            filename.endsWith('.css') || !potentialRoots.length,
          );
          continue;
        }
        try {
          createRequire(absolute).resolve(specifier);
        } catch {
          issue(filename, `unresolved import ${specifier}`, potentialRoots, !packages.length);
        }
        continue;
      }
      for (const resolution of resolutions) {
        const relative = slash(path.relative(root, resolution));
        if (relative.startsWith('../')) {
          issue(filename, `resolved source outside workspace ${relative}`);
          continue;
        }
        if (relative.includes('/node_modules/') || relative.startsWith('node_modules/')) continue;
        if (!fileSet.has(relative))
          issue(filename, `resolved source outside observed files ${relative}`, [relative]);
        (reverse[relative] ||= []).push(filename);
      }
    }
  }
  return {
    reverse_imports: Object.fromEntries(
      Object.entries(reverse).map(([key, value]) => [key, [...new Set(value)].sort()]),
    ),
    unknown: [...new Set(unknown)].sort(),
    uncertainties,
  };
}

export function liveDependencies(root) {
  const inputFingerprint = () => {
    const inputDigest = crypto.createHash('sha256');
    const listed = new TextDecoder('utf-8', { fatal: true }).decode(
      execFileSync('git', ['ls-files', '-c', '-o', '--exclude-standard', '-z'], { cwd: root }),
    );
    const files = [...new Set(listed.split('\0').filter(Boolean))];
    for (const filename of files.filter((f) => !f.startsWith('docs/testing/evidence/')).sort()) {
      const filenameAbsolute = path.join(root, filename);
      inputDigest.update(filename).update('\0');
      if (fs.existsSync(filenameAbsolute) && fs.statSync(filenameAbsolute).isFile()) {
        inputDigest.update('file\0');
        if (/\.(?:[cm]?[jt]sx?|css|scss|sass|less|vue|svelte|py|json|ya?ml)$/.test(filename))
          inputDigest.update(fs.readFileSync(filenameAbsolute)).update('\0');
      } else {
        inputDigest.update('absent\0');
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
    const after = inputFingerprint();
    return {
      reverse_imports: indexed.reverse_imports,
      unknown: [
        ...indexed.uncertainties,
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
