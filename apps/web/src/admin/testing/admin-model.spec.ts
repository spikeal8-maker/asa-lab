import { describe, expect, it } from 'vitest';
import type { AdminAuditEvent, AdminScope } from '../admin-api';
import {
  adminActionLabel,
  adminAreas,
  adminResultLabel,
  adminRoleLabel,
  adminScopeLabel,
} from '../admin-model';

const SCOPE: AdminScope = {
  kind: 'organization',
  id: '30000000-0000-4000-8000-000000000001',
  title: 'Школа № 1',
  role: 'school_admin',
  permissions: [
    'administration.open',
    'administration.accounts.read',
    'administration.security.read',
  ],
};

describe('administrative presentation model', () => {
  it('shows only areas granted by the server policy', () => {
    expect(adminAreas(SCOPE).map((area) => area.title)).toEqual(['Пользователи', 'Безопасность']);
    expect(adminAreas(SCOPE).map((area) => area.title)).not.toContain('Финансы');
  });

  it('renders human labels without hiding unknown audit actions', () => {
    expect(adminScopeLabel(SCOPE)).toBe('Школа № 1');
    expect(adminRoleLabel(SCOPE.role)).toBe('Администратор организации');
    expect(adminActionLabel({ action: 'administration.audit.read' })).toBe(
      'Просмотр журнала действий',
    );
    expect(adminActionLabel({ action: 'future.admin.action' })).toBe('future.admin.action');
    expect(adminResultLabel('denied' satisfies AdminAuditEvent['result'])).toBe('Отклонено');
  });
});
