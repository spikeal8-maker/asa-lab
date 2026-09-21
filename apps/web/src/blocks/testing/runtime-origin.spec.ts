import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BlocksEditor } from '../BlocksEditor';

function renderEditor(origin: string) {
  vi.stubGlobal('window', { location: { origin } });
  return renderToStaticMarkup(
    createElement(BlocksEditor, {
      projectId: '11111111-1111-4111-8111-111111111111',
      recoveryPrincipalKey: '33333333-3333-4333-8333-333333333333',
      onBack: vi.fn(),
      onHomeClick: vi.fn(),
      onAccountClick: vi.fn(),
      accountLabel: 'ASA test user',
      accountInitials: 'AT',
    }),
  );
}

describe('BlocksEditor single ASA entry', () => {
  afterEach(() => vi.unstubAllGlobals());
  it.each(['http://127.0.0.1:4610', 'https://asa-lab.ru', 'https://school.example.test'])(
    'embeds the editor within %s without another origin or port',
    (origin) => {
      const html = renderEditor(origin);
      expect(html).toContain('src="/internal/blocks/?asaStatus=parent"');
      expect(html).toContain('Загружаем рабочую среду');
      expect(html).not.toContain('role="alert"');
    },
  );
  it.each(['https://scratch.example.test', 'http://localhost:4613', 'javascript:alert(1)'])(
    'never sends editor capabilities to legacy configuration %s',
    (foreign) => {
      vi.stubGlobal('__ASA_RUNTIME_CONFIG__', { blocksRuntimeOrigin: foreign });
      vi.stubGlobal('__ASA_BLOCKS_RUNTIME_ORIGIN__', foreign);
      const html = renderEditor('https://asa-lab.ru');
      expect(html).toContain('src="/internal/blocks/?asaStatus=parent"');
      expect(html).not.toContain(foreign);
    },
  );
  it.each(['null', 'file://', 'javascript:alert(1)'])(
    'does not create an editor outside an HTTP(S) application: %s',
    (origin) => {
      const html = renderEditor(origin);
      expect(html).not.toContain('<iframe');
      expect(html).toContain('Откройте проект через приложение ASA Lab.');
    },
  );
});
