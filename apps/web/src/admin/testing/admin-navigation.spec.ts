import { describe, expect, it } from 'vitest';
import { ADMIN_HREF, isAdminLocation } from '../admin-navigation';

describe('administrative portal route', () => {
  it('recognizes only the exact admin destination', () => {
    expect(ADMIN_HREF).toBe('/#/admin');
    expect(isAdminLocation({ hash: '#/admin' })).toBe(true);
    expect(isAdminLocation({ hash: '#/admin/' })).toBe(true);
    expect(isAdminLocation({ hash: '#/admin?from=portal' })).toBe(true);
    expect(isAdminLocation({ hash: '#/administrator' })).toBe(false);
    expect(isAdminLocation({ hash: '#/home' })).toBe(false);
  });
});
