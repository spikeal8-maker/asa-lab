export function isValidEmail(value: unknown): value is string {
  return (
    typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 255
  );
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** Workspace slug is only a tenant locator during authentication. */
export function isValidWorkspace(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(value.trim());
}

/**
 * An IANA time zone this runtime can actually resolve.
 *
 * The shape check keeps nonsense out of the column; the resolution check is the
 * one that matters, because a stored name the platform cannot read would make
 * every date on a class page throw rather than merely look wrong. Anything the
 * browser reports and this server does not recognise is refused at the door.
 */
export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+){0,2}$/.test(value))
    return false;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
