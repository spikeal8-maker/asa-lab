import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BlocksEditor } from '../BlocksEditor';

const PARENT_ORIGIN = 'http://127.0.0.1:4612';
const RUNTIME_ORIGIN = 'http://127.0.0.1:4613';

function renderEditor(runtimeOrigin: string, parentOrigin = PARENT_ORIGIN, enabled = true) {
  vi.stubGlobal('__ASA_BLOCKS_PREVIEW__', enabled);
  vi.stubGlobal('__ASA_BLOCKS_RUNTIME_ORIGIN__', runtimeOrigin);
  vi.stubGlobal('window', {
    location: { origin: parentOrigin, hostname: new URL(parentOrigin).hostname },
  });
  return renderToStaticMarkup(
    createElement(BlocksEditor, {
      projectId: '11111111-1111-4111-8111-111111111111',
      recoveryPrincipalKey: '33333333-3333-4333-8333-333333333333',
      onBack: vi.fn(),
      onHomeClick: vi.fn(),
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
      expectBlocked(renderEditor(origin, origin));
    },
  );

  it.each([
    [PARENT_ORIGIN, RUNTIME_ORIGIN],
    ['https://portal.example.test', 'https://scratch.example.test'],
  ])('preserves the separate-origin preview from %s to %s', (parent, runtime) => {
    const html = renderEditor(runtime, parent);
    expect(html).toContain(`<iframe title="Scratch runtime" src="${runtime}/?asaStatus=parent"`);
    expect(html).toContain('Загружаем рабочую среду');
    expect(html).toContain('/asa-lab-mark.svg');
    expect(html).not.toContain('blocks-editor-connection-status');
    expect(html).not.toContain('Сохранить на компьютер');
    expect(html).not.toContain('role="alert"');
  });

  it.each(['http://127.0.0.1:4610', 'http://127.0.0.2:4610', 'http://[::1]:4610'])(
    'keeps the configured localhost runtime separate from loopback portal %s',
    (parent) => {
      const html = renderEditor('http://localhost:4613', parent);
      expect(html).toContain(
        '<iframe title="Scratch runtime" src="http://localhost:4613/?asaStatus=parent"',
      );
      expect(html).not.toContain('role="alert"');
    },
  );

  it.each([
    'http://100.105.67.69:4610',
    'http://desktop-i07qije.tail605710.ts.net:4610',
    'http://desktop-i07qije:4610',
  ])('maps the localhost runtime template onto the portal hostname for %s', (parent) => {
    const expected = `http://${new URL(parent).hostname}:4614`;
    const html = renderEditor('http://localhost:4614', parent);
    expect(html).toContain(`<iframe title="Scratch runtime" src="${expected}/?asaStatus=parent"`);
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
    expectBlocked(renderEditor(runtime, 'https://portal.example.test'));
  });

  it('opens the editor even when the legacy preview flag is off', () => {
    const html = renderEditor(RUNTIME_ORIGIN, PARENT_ORIGIN, false);
    expect(html).toContain('<iframe');
    expect(html).not.toContain('TEST ·');
    expect(html).not.toContain('не сохраняются в аккаунте');
    expect(html).not.toContain('(.sb3)');
  });

  it('rejects an HTTP runtime inside an HTTPS portal', () => {
    expectBlocked(renderEditor(RUNTIME_ORIGIN, 'https://portal.example.test'));
  });

  it('fails closed outside the browser without preview globals', () => {
    vi.stubGlobal('window', undefined);
    // No Vite preview constants exist in this non-browser environment.
    expect(typeof window).toBe('undefined');
    const html = renderToStaticMarkup(
      createElement(BlocksEditor, {
        projectId: '11111111-1111-4111-8111-111111111111',
        recoveryPrincipalKey: '33333333-3333-4333-8333-333333333333',
        onBack: vi.fn(),
        onHomeClick: vi.fn(),
        accountLabel: 'ASA test user',
        accountInitials: 'AT',
        onAccountClick: vi.fn(),
      }),
    );
    expectBlocked(html);
  });
});
