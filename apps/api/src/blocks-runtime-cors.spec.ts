import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isBlocksRuntimePath } from './blocks-runtime-transport.js';

const factorySource = readFileSync(join(process.cwd(), 'apps/api/src/app.factory.ts'), 'utf8');

describe('Blocks runtime app wiring', () => {
  it('classifies only the dedicated runtime prefix as runtime traffic', () => {
    expect(isBlocksRuntimePath('/api/blocks/runtime/projects/p/draft')).toBe(true);
    expect(isBlocksRuntimePath('/api/blocks/runtime/projects/p/assets/a.png')).toBe(true);
    expect(isBlocksRuntimePath('/api/projects/p/draft')).toBe(false);
    expect(isBlocksRuntimePath('/api/auth/session')).toBe(false);
  });

  it('keeps runtime trust separate from ordinary cookie mutation trust', () => {
    const runtimePath = factorySource.indexOf('const runtimePath = isBlocksRuntimePath(path);');
    const runtimeCors = factorySource.indexOf(
      'applyBlocksRuntimeCors(request, reply, blocksRuntimeOrigin)',
    );
    const runtimeAddressBudget = factorySource.indexOf(
      'blocksRuntimeAddressBudget.consume(request)',
    );
    const genericOrigin = factorySource.indexOf(
      "if (!runtimePath && path !== '/api/auth/max/webhook')",
    );
    const genericAbuse = factorySource.indexOf('if (!runtimePath) {', genericOrigin);

    expect(runtimePath).toBeGreaterThanOrEqual(0);
    expect(runtimeCors).toBeGreaterThan(runtimePath);
    expect(runtimeAddressBudget).toBeGreaterThan(runtimeCors);
    expect(genericOrigin).toBeGreaterThan(runtimeAddressBudget);
    expect(genericAbuse).toBeGreaterThan(genericOrigin);
  });

  it('registers runtime-only parsers and preflight on the Fastify instance', () => {
    expect(factorySource).toContain(
      'registerBlocksRuntimeTransport(fastify, blocksRuntimeOrigin);',
    );
    expect(factorySource).toContain('const blocksRuntimeOrigin = optionalBlocksRuntimeOrigin();');
  });
});
