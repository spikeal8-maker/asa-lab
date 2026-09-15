import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BlocksEditor } from '../BlocksEditor';

const PARENT_ORIGIN = 'http://127.0.0.1:4612';
const RUNTIME_ORIGIN = 'http://127.0.0.1:4613';

function renderPreview(runtimeOrigin: string, parentOrigin = PARENT_ORIGIN, enabled = true) {
  vi.stubGlobal('__ASA_BLOCKS_PREVIEW__', enabled);
  vi.stubGlobal('__ASA_BLOCKS_RUNTIME_ORIGIN__', runtimeOrigin);
  vi.stubGlobal('window', { location: { origin: parentOrigin } });
  return renderToStaticMarkup(
    createElement(BlocksEditor, {
      projectId: '11111111-1111-4111-8111-111111111111',
      onBack: vi.fn(),
      accountLabel: 'ASA test user',
      accountInitials: 'AT',
      onAccountClick: vi.fn(),
    }),
  );
}

function expectBlocked(html: string) {
  expect(html).not.toContain('<iframe');
  expect(html).toContain('role="alert"');
  expect(html).toContain('Среда Scratch не подключена');
  expect(html).toContain('К проектам');
}

describe('BlocksEditor runtime origin isolation', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([PARENT_ORIGIN, 'https://portal.example.test'])(
    'rejects the portal origin %s before creating an iframe',
    (origin) => {
      expectBlocked(renderPreview(origin, origin));
    },
  );

  it.each([
    [PARENT_ORIGIN, RUNTIME_ORIGIN],
    ['https://portal.example.test', 'https://scratch.example.test'],
  ])('preserves the separate-origin preview from %s to %s', (parent, runtime) => {
    const html = renderPreview(runtime, parent);
    expect(html).toContain(`<iframe title="Scratch runtime" src="${runtime}/?asaStatus=parent"`);
    expect(html).toContain('изменения пока не сохраняются');
    expect(html).not.toContain('role="alert"');
  });

  it.each([
    '',
    'null',
    '*',
    'javascript:alert(1)',
    'ftp://scratch.example.test',
    'http://127.0.0.1:4613/',
    'http://127.0.0.1:4613/scratch',
    'http://127.0.0.1:4613?token=fixture-token',
    'http://127.0.0.1:4613#fragment',
    'https://portal.example.test:443',
  ])('continues to reject non-canonical runtime configuration %s', (runtime) => {
    expectBlocked(renderPreview(runtime, 'https://portal.example.test'));
  });

  it('keeps preview disabled when the feature flag is off', () => {
    expectBlocked(renderPreview(RUNTIME_ORIGIN, PARENT_ORIGIN, false));
  });

  it('fails closed outside the browser without preview globals', () => {
    vi.stubGlobal('window', undefined);
    // No Vite preview constants exist in this non-browser environment.
    expect(typeof window).toBe('undefined');
    const html = renderToStaticMarkup(
      createElement(BlocksEditor, {
        projectId: '11111111-1111-4111-8111-111111111111',
        onBack: vi.fn(),
        accountLabel: 'ASA test user',
        accountInitials: 'AT',
        onAccountClick: vi.fn(),
      }),
    );
    expectBlocked(html);
  });
});
