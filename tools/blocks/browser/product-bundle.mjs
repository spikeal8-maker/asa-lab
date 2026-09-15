import fs from 'node:fs';
import { URL, fileURLToPath } from 'node:url';
import { build } from 'vite';
import { runtimeUrl } from './protocol.mjs';

let pending;
export function productBundle() {
  pending ??= build({
    configFile: false,
    root: fileURLToPath(new URL('../../../', import.meta.url)),
    publicDir: false,
    logLevel: 'error',
    esbuild: { jsx: 'automatic' },
    define: {
      __ASA_BLOCKS_PREVIEW__: 'false',
      __ASA_BLOCKS_RUNTIME_ORIGIN__: JSON.stringify(runtimeUrl),
      'process.env.NODE_ENV': JSON.stringify('production'),
    },
    build: {
      write: false,
      minify: false,
      lib: { entry: fileURLToPath(new URL('product-entry.tsx', import.meta.url)), formats: ['es'] },
    },
  }).then((result) => {
    const output = (Array.isArray(result) ? result[0] : result).output;
    const js = output.find((file) => file.type === 'chunk' && file.isEntry)?.code;
    const css = output
      .filter((file) => file.type === 'asset' && file.fileName.endsWith('.css'))
      .map((file) => file.source)
      .join('\n');
    if (!js || !css) throw new Error('Shipping BlocksEditor fixture build incomplete');
    return { js, css };
  });
  return pending;
}

export async function productFiles() {
  const bundle = await productBundle();
  const avatarBytes = fs.readFileSync(
    new URL('../../../apps/web/public/assets/avatars/default/avatar-01.webp', import.meta.url),
  );
  const avatarDataUrl = `data:image/webp;base64,${avatarBytes.toString('base64')}`;
  const files = new Map([
    [
      '/product',
      {
        type: 'text/html; charset=utf-8',
        body: '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/product.css"></head><body><div id="product-root"></div><script type="module" src="/product.js"></script></body></html>',
      },
    ],
    ['/product.js', { type: 'text/javascript', body: bundle.js }],
    ['/product.css', { type: 'text/css', body: bundle.css }],
    ['/api/account/avatar', { type: 'application/json', body: JSON.stringify({ avatarDataUrl }) }],
  ]);
  for (let index = 1; index <= 67; index += 1) {
    const name = `avatar-${String(index).padStart(2, '0')}.webp`;
    files.set(`/assets/avatars/default/${name}`, {
      type: 'image/webp',
      body: fs.readFileSync(
        new URL(`../../../apps/web/public/assets/avatars/default/${name}`, import.meta.url),
      ),
    });
  }
  const updatedAvatarDataUrl = `data:image/webp;base64,${fs.readFileSync(new URL('../../../apps/web/public/assets/avatars/default/avatar-02.webp', import.meta.url)).toString('base64')}`;
  return { files, avatarDataUrl, updatedAvatarDataUrl };
}
