/**
 * Server feature flags.
 *
 * Public registration is closed twice on purpose.
 *
 * A registration that succeeds must produce a whole identity — account,
 * profile, principal, Personal Workspace, an active session and an audit
 * event — or nothing at all. Principal-aware sessions (sessions_v2) do not
 * exist yet, so the session half cannot be delivered, and an account created
 * without one is an orphan: it can be signed up for but never signed into.
 *
 * `ASA_PUBLIC_REGISTRATION` is therefore not enough by itself. Turning it on
 * before sessions_v2 also requires `ASA_ALLOW_REGISTRATION_WITHOUT_SESSIONS_V2`,
 * a deliberate second switch that no demo or local run sets, so the flag cannot
 * be flipped by accident into writing half an account.
 */
export function isPublicRegistrationEnabled(): boolean {
  return (process.env['ASA_PUBLIC_REGISTRATION'] ?? 'off').toLowerCase() === 'on';
}

/** Do principal-aware sessions exist in this build? They do not yet. */
export function hasPrincipalAwareSessions(): boolean {
  return false;
}

/** The explicit override that acknowledges registering without sessions_v2. */
export function allowsRegistrationWithoutSessionsV2(): boolean {
  return (
    (process.env['ASA_ALLOW_REGISTRATION_WITHOUT_SESSIONS_V2'] ?? 'off').toLowerCase() === 'on'
  );
}

export type RegistrationAvailability =
  | { readonly available: true }
  | { readonly available: false; readonly code: string; readonly message: string };

/**
 * Whether a registration may touch the database at all. Checked before any
 * write, so a refusal leaves no account, no workspace and no audit event.
 */
export function registrationAvailability(): RegistrationAvailability {
  if (!isPublicRegistrationEnabled()) {
    return {
      available: false,
      code: 'registration_disabled',
      message:
        'публичная регистрация откроется на следующем этапе; сейчас доступен вход по коду класса или через организацию',
    };
  }
  if (!hasPrincipalAwareSessions() && !allowsRegistrationWithoutSessionsV2()) {
    return {
      available: false,
      code: 'registration_requires_sessions_v2',
      message: 'регистрация ждёт безопасную основу сессий: аккаунт без сессии не создаётся',
    };
  }
  return { available: true };
}
