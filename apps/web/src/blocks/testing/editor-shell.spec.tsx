import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { BlocksEditorShell } from '../BlocksEditorShell';

describe('BlocksEditorShell', () => {
  it('keeps ASA identity in the parent shell while the Scratch runtime stays a child surface', () => {
    const html = renderToStaticMarkup(
      <BlocksEditorShell
        accountLabel="Александр"
        accountInitials="АА"
        avatarUrl="/account-avatar.png"
        onAccountClick={vi.fn()}
      >
        <iframe title="Scratch runtime" src="https://scratch-runtime.example" />
      </BlocksEditorShell>,
    );

    expect(html).toContain('data-asa-blocks-editor-shell');
    expect(html).toContain('data-asa-blocks-runtime-slot');
    expect(html).toContain('data-asa-blocks-account-overlay');
    expect(html).toContain('/account-avatar.png');
    expect(html).toContain('https://scratch-runtime.example');
    expect(html).not.toContain('runtimeToken');
    expect(html).not.toContain('document.cookie');
  });

  it('renders parent-provided initials when no avatar image exists', () => {
    const html = renderToStaticMarkup(
      <BlocksEditorShell
        accountLabel="Пользователь ASA Lab"
        accountInitials="АС"
        onAccountClick={vi.fn()}
      >
        <iframe title="Scratch runtime" src="https://scratch-runtime.example" />
      </BlocksEditorShell>,
    );

    expect(html).toContain('АС');
    expect(html).toContain('Открыть аккаунт: Пользователь ASA Lab');
  });
});
