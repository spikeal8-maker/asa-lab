import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

/** Opt-in private evidence from actual Rollup output, never original source text. */
export function renderedModuleEvidence({ revision, repositoryRoot, output }) {
  return {
    name: 'asa-publication-rendered-module-evidence',
    apply: 'build',
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        if (!/^[a-f0-9]{40}$/.test(revision)) throw Error('Invalid evidence revision');
        const sanitize = (id) => {
          const value = id.replaceAll('\0', '').replaceAll('\\', '/').split('?')[0];
          const path = relative(
            repositoryRoot,
            isAbsolute(value) ? value : resolve(repositoryRoot, value),
          );
          return path === '..' || path.startsWith(`..${sep}`)
            ? '<external>'
            : path.split(sep).join('/');
        };
        const assets = {};
        for (const chunk of Object.values(bundle)) {
          if (chunk.type !== 'chunk' || !chunk.fileName.endsWith('.js')) continue;
          const modules = Object.entries(chunk.modules).map(([id, module]) => ({
            id: sanitize(id),
            renderedLength: module.renderedLength,
          }));
          assets[`/${chunk.fileName}`] = {
            sha256: createHash('sha256').update(chunk.code).digest('hex'),
            bytes: Buffer.byteLength(chunk.code),
            imports: chunk.imports,
            dynamicImports: chunk.dynamicImports,
            modules: modules.filter((module) => module.renderedLength > 0),
            zeroLengthModules: modules
              .filter((module) => module.renderedLength === 0)
              .map((module) => module.id),
          };
        }
        if (!Object.keys(assets).length) throw Error('No rendered module evidence');
        mkdirSync(output, { recursive: true });
        writeFileSync(
          resolve(output, `web-rendered-modules-${revision}.json`),
          JSON.stringify({
            format: 'asa-web-rendered-modules-v1',
            revision,
            assets,
          }),
        );
      },
    },
  };
}
