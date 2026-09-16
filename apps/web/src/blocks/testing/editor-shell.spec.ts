import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { BlocksEditorShell } from '../BlocksEditorShell';

describe('BlocksEditorShell', () => {
  it('keeps ASA identity in the parent shell while the Scratch runtime stays a child surface', () => {
    const html = renderToStaticMarkup(
      createElement(BlocksEditorShell, {
        accountLabel: 'Александр',
        accountInitials: 'АА',
        onAccountClick: vi.fn(),
        onHomeClick: vi.fn(),
        avatarUrl: '/account-avatar.png',
        children: createElement('iframe', {
          title: 'Scratch runtime',
          src: 'https://scratch-runtime.example',
        }),
      }),
    );

    expect(html).toContain('data-asa-blocks-editor-shell');
    expect(html).toContain('data-asa-blocks-runtime-slot');
    expect(html).toContain('data-asa-blocks-account-overlay');
    expect(html).toContain('data-asa-blocks-home-overlay');
    expect(html).toContain('ASA Lab — на главную');
    expect(html).toContain('/account-avatar.png');
    expect(html).toContain('https://scratch-runtime.example');
    expect(html).not.toContain('runtimeToken');
    expect(html).not.toContain('document.cookie');
  });

  it('renders parent-provided initials when no avatar image exists', () => {
    const html = renderToStaticMarkup(
      createElement(BlocksEditorShell, {
        accountLabel: 'Пользователь ASA Lab',
        accountInitials: 'АС',
        onAccountClick: vi.fn(),
        onHomeClick: vi.fn(),
        children: createElement('iframe', {
          title: 'Scratch runtime',
          src: 'https://scratch-runtime.example',
        }),
      }),
    );

    expect(html).toContain('АС');
    expect(html).toContain('Открыть аккаунт: Пользователь ASA Lab');
  });
});
