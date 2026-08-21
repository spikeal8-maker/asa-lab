export const ADMIN_HREF = '/#/admin';

export function isAdminLocation(location: { readonly hash: string }): boolean {
  const path = location.hash.replace(/^#/, '').split('?')[0]?.replace(/\/+$/, '') ?? '';
  return path === '/admin';
}
