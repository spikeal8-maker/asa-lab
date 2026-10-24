import { newClientId } from './client-id';

/** The API still requires a public handle; never derive it from private email. */
export function newRegistrationUsername(): string {
  return `u_${newClientId().replaceAll('-', '')}`;
}

export function registrationDisplayName(value: string): string {
  return value.trim() || 'Пользователь';
}
