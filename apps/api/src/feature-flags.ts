/**
 * Server feature flags.
 *
 * Public registration stays off until principal-aware sessions (sessions_v2)
 * and a safe ActiveContext exist: an account whose Personal Workspace has no
 * tenant-scoped user cannot carry a legacy session, and faking one would hand
 * out authority the server never granted.
 */
export function isPublicRegistrationEnabled(): boolean {
  return (process.env['ASA_PUBLIC_REGISTRATION'] ?? 'off').toLowerCase() === 'on';
}
