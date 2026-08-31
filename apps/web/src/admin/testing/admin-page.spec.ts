import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AdminPage } from '../AdminPage';
import type { AdminProfile } from '../admin-api';
import type { AdminSection } from '../admin-navigation';

const PROFILE: AdminProfile = {
  administrator: true,
  principalId: '10000000-0000-4000-8000-000000000001',
  accountId: '20000000-0000-4000-8000-000000000001',
  displayName: 'Администратор',
  activeWorkspaceId: '30000000-0000-4000-8000-000000000001',
  scopes: [
    {
      kind: 'organization',
      id: '30000000-0000-4000-8000-000000000001',
      title: 'Школа № 1',
      role: 'school_admin',
      permissions: [
        'administration.open',
        'administration.scopes.read',
        'administration.audit.read',
        'administration.accounts.read',
        'administration.security.read',
      ],
    },
  ],
};

function render(
  access: Parameters<typeof AdminPage>[0]['access'],
  section: AdminSection = 'overview',
): string {
  return renderToStaticMarkup(
    createElement(AdminPage, {
      access,
      section,
      onNavigate: vi.fn(),
      onRetry: vi.fn(),
      onBack: vi.fn(),
      onAccessDenied: vi.fn(),
    }),
  );
}

describe('administrative page access states', () => {
  it('does not render administrative data before access is confirmed', () => {
    const checking = render({ kind: 'checking' });
    expect(checking).toContain('Проверяем права доступа');
    expect(checking).not.toContain('Управление ASA Lab');

    const denied = render({ kind: 'denied' });
    expect(denied).toContain('Нет административного доступа');
    expect(denied).not.toContain('История');
  });

  it('renders one addressable section without the former tab strip', () => {
    const html = render({ kind: 'granted', profile: PROFILE });
    expect(html).toContain('Админ');
    expect(html).toContain('1 год');
    expect(html).not.toContain('Пульс ASA Lab');
    expect(html).not.toContain('admin-tabs');
    expect(html).not.toContain('>Пользователи</button>');
    expect(html).not.toContain('>Безопасность</button>');
    const users = render({ kind: 'granted', profile: PROFILE }, 'accounts');
    expect(users).toContain('Пользователи');
    expect(users).not.toContain('1 год');
    const unavailable = render({ kind: 'granted', profile: PROFILE }, 'confirmations');
    expect(unavailable).not.toContain('MAX Bot');
    expect(html).not.toContain('Выберите, чем хотите управлять');
    expect(html).not.toContain('Финансы');
    expect(html).not.toContain('Система</h3>');
    expect(html).not.toContain('Последний IP');
    expect(html).not.toContain('Риск-оценка');
    expect(html).not.toContain('Вернуться в ASA Lab');
  });
});
