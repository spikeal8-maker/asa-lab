import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { resolve, dirname, relative, sep } from 'node:path';
import { digest, encryptSymbols } from './browser-error-symbols.mjs';

/** Private maps are encrypted, then removed from dist before build completes.
 * Runtime COPY sees only the public dist. No sourceMappingURL is generated. */
export function privateSymbols({ revision, repositoryRoot, output, publicKey }) {
  return {
    name: 'asa-private-web-symbols',
    apply: 'build',
    writeBundle(options, bundle) {
      if (!/^(?:[a-f0-9]{40}|unknown|development)$/.test(revision))
        throw new Error('Invalid web build revision');
      const assets = {},
        maps = [];
      for (const chunk of Object.values(bundle)) {
        // Vite emits Worker JS/maps as Rollup assets, not only chunks.
        if (!chunk.fileName.endsWith('.js')) continue;
        const script = `/${chunk.fileName}`;
        if (!/^\/assets\/[A-Za-z0-9_.-]{1,140}-[A-Za-z0-9_-]{8,16}\.js$/.test(script))
          throw new Error('Unexpected symbol chunk path');
        const generatedPath = resolve(options.dir, chunk.fileName);
        const mapPath = `${generatedPath}.map`;
        const map = JSON.parse(readFileSync(mapPath, 'utf8'));
        map.sources = map.sources.map((source) => {
          const path = relative(
            repositoryRoot,
            resolve(dirname(mapPath), map.sourceRoot || '', source),
          );
          return path.startsWith(`..${sep}`) || path === '..'
            ? '<external>'
            : path.split(sep).join('/');
        });
        delete map.sourcesContent;
        delete map.sourceRoot;
        delete map.names; // Names are unused by coordinate-only lookup.
        const generated = readFileSync(generatedPath, 'utf8');
        if (/sourceMappingURL=/.test(generated)) throw new Error('Public source map reference');
        assets[script] = { sha256: digest(generated), generated, map };
        maps.push(mapPath);
      }
      if (!maps.length) throw new Error('No web source maps produced');
      const encrypted = encryptSymbols(
        { format: 'asa-web-symbols-v1', revision, assets },
        publicKey,
      );
      mkdirSync(output, { recursive: true });
      writeFileSync(resolve(output, `web-symbols-${revision}.json`), encrypted);
      writeFileSync(
        resolve(output, `web-symbols-${revision}.manifest.json`),
        JSON.stringify({
          format: 'asa-web-symbol-digests-v1',
          revision,
          assets: Object.fromEntries(
            Object.entries(assets).map(([script, asset]) => [script, asset.sha256]),
          ),
        }),
      );
      // Only files produced by this exact Rollup build are removed, no recursive cleanup.
      for (const map of maps) unlinkSync(map);
    },
  };
}
