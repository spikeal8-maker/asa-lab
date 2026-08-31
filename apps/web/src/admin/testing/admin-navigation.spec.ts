import { describe, expect, it } from 'vitest';
import {
  ADMIN_HREF,
  adminHref,
  adminNavigationItems,
  adminSectionFromLocation,
  isAdminLocation,
} from '../admin-navigation';

describe('administrative portal route', () => {
  it('recognizes the overview and every addressable admin page', () => {
    expect(ADMIN_HREF).toBe('/#/admin');
    expect(isAdminLocation({ hash: '#/admin' })).toBe(true);
    expect(isAdminLocation({ hash: '#/admin/' })).toBe(true);
    expect(isAdminLocation({ hash: '#/admin?from=portal' })).toBe(true);
    expect(adminHref('accounts')).toBe('/#/admin/users');
    expect(adminSectionFromLocation({ hash: '#/admin/users' })).toBe('accounts');
    expect(adminSectionFromLocation({ hash: '#/admin/confirmations' })).toBe('confirmations');
    expect(adminSectionFromLocation({ hash: '#/admin/system' })).toBe('operations');
    expect(adminSectionFromLocation({ hash: '#/admin/history' })).toBe('audit');
    expect(adminSectionFromLocation({ hash: '#/admin/integrations' })).toBe('confirmations');
    expect(isAdminLocation({ hash: '#/admin/unknown' })).toBe(false);
    expect(isAdminLocation({ hash: '#/administrator' })).toBe(false);
    expect(isAdminLocation({ hash: '#/home' })).toBe(false);
  });

  it('builds the sidebar only from server-granted permissions', () => {
    const items = adminNavigationItems({
      administrator: true,
      principalId: 'principal',
      accountId: 'account',
      displayName: 'Администратор',
      activeWorkspaceId: 'organization',
      scopes: [
        {
          kind: 'organization',
          id: 'organization',
          title: 'Школа',
          role: 'school_admin',
          permissions: [
            'administration.open',
            'administration.accounts.read',
            'administration.audit.read',
          ],
        },
      ],
    });
    expect(items.map((item) => item.id)).toEqual(['overview', 'accounts', 'audit']);
  });
});
