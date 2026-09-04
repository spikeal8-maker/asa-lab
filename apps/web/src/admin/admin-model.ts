import type { AdminAuditEvent, AdminPermission, AdminScope } from './admin-api';

export interface AdminArea {
  readonly permission: AdminPermission;
  readonly title: string;
  readonly description: string;
}

const AREAS: readonly AdminArea[] = [
  {
    permission: 'administration.accounts.read',
    title: 'Пользователи',
    description: 'Учётные записи, доступ и активность.',
  },
  {
    permission: 'administration.organizations.read',
    title: 'Организации',
    description: 'Школы, пространства и состав администраторов.',
  },
  {
    permission: 'administration.security.read',
    title: 'Безопасность',
    description: 'Сессии входа и устройства пользователей.',
  },
  {
    permission: 'administration.moderation.read',
    title: 'Модерация',
    description: 'Жалобы и решения по пользовательскому содержимому.',
  },
  {
    permission: 'administration.billing.read',
    title: 'Финансы',
    description: 'Платежи, тарифы и расчёты организации.',
  },
  {
    permission: 'administration.operations.read',
    title: 'Система',
    description: 'Состояние сервисов и эксплуатационные события.',
  },
];

const ROLE_LABELS: Readonly<Record<AdminScope['role'], string>> = {
  platform_admin: 'Администратор ASA Lab',
  owner: 'Владелец организации',
  school_admin: 'Администратор организации',
  moderator: 'Модератор',
  billing_admin: 'Администратор финансов',
};

const ACTION_LABELS: Readonly<Record<string, string>> = {
  'administration.platform_admin.bootstrap': 'Администратор ASA Lab подтверждён',
  'administration.audit.read': 'Просмотр журнала действий',
  'administration.operations.read': 'Просмотр состояния системы',
  'administration.account.suspend': 'Пользователь заблокирован',
  'administration.account.restore': 'Доступ пользователя восстановлен',
  'administration.platform_admin.grant': 'Назначен администратор',
  'administration.platform_admin.revoke': 'Снята роль администратора',
  'administration.session.revoke': 'Сессия пользователя завершена',
  'administration.account.note.add': 'Добавлена заметка о пользователе',
  'administration.ip.label.set': 'IP-адресу назначена метка',
  'administration.ip.label.clear': 'Метка IP-адреса снята',
  'administration.test': 'Проверка административного аудита',
};

export function adminAreas(scope: AdminScope): readonly AdminArea[] {
  return AREAS.filter((area) => scope.permissions.includes(area.permission));
}

export function adminRoleLabel(role: AdminScope['role'] | string): string {
  return ROLE_LABELS[role as AdminScope['role']] ?? role;
}

export function adminScopeLabel(scope: AdminScope): string {
  return scope.kind === 'platform' ? 'Вся платформа' : scope.title;
}

export function adminActionLabel(event: Pick<AdminAuditEvent, 'action'>): string {
  return ACTION_LABELS[event.action] ?? event.action;
}

export function adminResultLabel(result: AdminAuditEvent['result']): string {
  if (result === 'succeeded') return 'Выполнено';
  if (result === 'allowed') return 'Разрешено';
  if (result === 'denied') return 'Отклонено';
  return 'Ошибка';
}
