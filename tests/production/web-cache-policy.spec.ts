import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const caddy = readFileSync(new URL('../../docker/web/Caddyfile', import.meta.url), 'utf8');

describe('ASA Web immutable asset cache boundary', () => {
  it('does not make stable build revision metadata immutable', () => {
    expect(caddy).toMatch(
      /handle \/build-metadata\.json \{\s*root \* \/srv\s*header Cache-Control "no-store"\s*file_server\s*\}/,
    );
    expect(caddy).toMatch(
      /handle \/runtime-config\.js \{\s*root \* \/tmp\s*header Cache-Control "no-store"\s*file_server\s*\}/,
    );
  });

  it('only gives immutable caching to content-hashed assets', () => {
    const definition = caddy.match(/^\s*@hashed path_regexp hashed ([^\r\n]+)$/m);
    expect(definition?.[1]).toBeTruthy();
    const hashed = new RegExp(definition![1]!);
    for (const asset of [
      '/assets/index-DmX2XuAh.js',
      '/assets/project-draft-storage-Cq0SkLrw.js',
      '/assets/index-CPOsp9_1.css',
      '/assets/font-12345678.woff2',
    ]) {
      expect(hashed.test(asset), asset).toBe(true);
    }
    for (const asset of [
      '/build-metadata.json',
      '/runtime-config.js',
      '/index.html',
      '/seo.css',
      '/asa-lab-mark.svg',
      '/assets/electronics/owner-supplied/led-red.svg',
      '/assets/electronics/owner-supplied/arduino-pinout-diagram.svg',
      '/assets/subdirectory/font-12345678.woff2',
      '/assets/normal.js',
    ]) {
      expect(hashed.test(asset), asset).toBe(false);
    }
    expect(caddy).toMatch(/handle @hashed \{[\s\S]*?Cache-Control "public, max-age=31536000, immutable"/);
    expect(caddy).toMatch(/header Cache-Control "no-cache"/);
  });
});
